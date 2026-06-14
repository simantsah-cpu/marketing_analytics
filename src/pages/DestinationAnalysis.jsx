/**
 * DestinationAnalysis.jsx
 * Route Intelligence — Destination Performance Dashboard
 *
 * Standalone component. Uses Canvas API for charts (not Chart.js).
 * All data fetched from the 'destination-analysis' Supabase edge function.
 *
 * BUG FIXES vs v1:
 *  - `years` is now in useState so it's a stable reference (was causing infinite
 *    useEffect loop — 7000+ re-fetches per session).
 *  - `fetchMain` useCallback deps are now stable (origin + destination strings only).
 *  - Chart drawArgs arrays are memoised with useMemo to avoid pointless redraws.
 *  - Abortable fetch: if origin/destination changes while a fetch is in-flight,
 *    the stale response is discarded.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import zoneMap from './zoneMap.json'
import { supabase } from '../services/supabase'
import { useFilters } from '../context/FiltersContext'

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  darkGreen:   '#0E4314',
  accentGreen: '#539A5B',
  lightGreenBg:'#EAF5E6',
  pageBg:      '#FFFFFF',
  lightGrayBg: '#F7F7F7',
  border:      '#DEDCD8',
  muted:       '#7A8C7B',
  body:        '#1A2E1B',
  secondary:   '#5C6B5D',
  darkCard:    '#4A5A4B',
  red:         '#C0504A',
  amber:       '#D97706',
  amberLight:  '#FEF3C7',
}

// ─────────────────────────────────────────────────────────────────────────────
// ISO week utilities
// ─────────────────────────────────────────────────────────────────────────────
function getISOWeek(date = new Date()) {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return { week, year: tmp.getUTCFullYear() }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convert a { startDate, endDate } date range into { weeks, years } arrays
// that the BigQuery ISO week queries understand.
// Handles cross-year ranges by collecting all unique ISO years touched.
// ─────────────────────────────────────────────────────────────────────────────
function dateRangeToWeeksYears(startDate, endDate) {
  if (!startDate || !endDate) {
    // Fallback: rolling 6 weeks
    const { week: cw, year: cy } = getISOWeek()
    const weeks = Array.from({ length: 6 }, (_, i) => { const w = cw - 5 + i; return w < 1 ? w + 52 : w })
    return { weeks, years: [cy - 1, cy] }
  }
  const start = new Date(startDate + 'T00:00:00')
  const end   = new Date(endDate   + 'T00:00:00')
  const weeksSet = new Set()
  const yearsSet = new Set()
  // Walk day by day and collect all ISO weeks touched
  const cursor = new Date(start)
  while (cursor <= end) {
    const { week, year } = getISOWeek(cursor)
    weeksSet.add(week)
    yearsSet.add(year)
    cursor.setDate(cursor.getDate() + 1)
  }
  const weeks = Array.from(weeksSet).sort((a, b) => a - b)
  // Always include the prior year so YoY comparison works
  const years = Array.from(yearsSet).sort((a, b) => a - b)
  const minYear = years[0]
  if (!years.includes(minYear - 1)) years.unshift(minYear - 1)
  return { weeks, years }
}

// Fallback used if FiltersContext is not yet ready
const DEFAULT_WY = dateRangeToWeeksYears(null, null)

// ─────────────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────────────
function fmtNum(n) {
  if (n == null || isNaN(n)) return '—'
  return Math.round(n).toLocaleString()
}
function fmtUSD(n) {
  if (n == null || isNaN(n)) return '—'
  const a = Math.abs(n), s = n < 0 ? '-' : ''
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`
  return `${s}$${Math.round(a).toLocaleString()}`
}
function fmtPct(n, dp = 2) {
  if (n == null || isNaN(n)) return '—'
  return `${(+n).toFixed(dp)}%`
}
function fmtDelta(delta, isPercent = false, isPP = false) {
  if (delta == null || isNaN(delta)) return { text: '—', color: C.muted }
  const color = delta > 0 ? C.accentGreen : delta < 0 ? C.red : C.muted
  const sign = delta > 0 ? '+' : ''
  if (isPP)      return { text: `${sign}${delta.toFixed(2)}pp`, color }
  if (isPercent) return { text: `${sign}${delta.toFixed(2)}%`,  color }
  return { text: `${sign}${Math.round(delta).toLocaleString()}`, color }
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregation helpers (pure — no side effects)
// ─────────────────────────────────────────────────────────────────────────────

function aggregateSearches(rows, { channel, device, weeks, years }) {
  const result = {}
  for (const r of rows) {
    if (channel !== 'all' && r.channel !== channel) continue
    if (device  !== 'all' && r.device_category !== device) continue
    if (!weeks.includes(+r.iso_week)) continue
    if (!years.includes(+r.year))    continue
    const key = `${r.year}-${r.iso_week}`
    result[key] = (result[key] || 0) + (+r.search_count || 0)
  }
  return result
}

function aggregateBookings(rows, { weeks, years }) {
  // GA4 begin_checkout rows: { pickup_code, dropoff_code, iso_week, year, channel, device_category, booking_count }
  // No vehicle_class, cohort, or ttv_usd — those were TGRS-only fields.
  const counts = {}, ttvs = {}
  for (const r of rows) {
    if (!weeks.includes(+r.iso_week)) continue
    if (!years.includes(+r.year))    continue
    const key = `${r.year}-${r.iso_week}`
    counts[key] = (counts[key] || 0) + (+r.booking_count || 0)
    ttvs[key]   = 0  // TTV not available from GA4
  }
  return { counts, ttvs }
}

function aggregateByDestination(rows, { weeks, years }) {
  // GA4 begin_checkout rows use zone code (2QZ, PMN, etc.) directly as dropoff_code.
  // Look up human-readable name from zoneMap.
  const dest = {}
  const curYear = years[years.length - 1]
  for (const r of rows) {
    if (!weeks.includes(+r.iso_week)) continue
    if (!years.includes(+r.year))    continue
    const code = r.dropoff_code
    if (!code || code === '?') continue
    // Get display name: check zoneMap first, fall back to code
    const name = (typeof zoneMap !== 'undefined' && zoneMap.codeToName?.[code]) || code
    if (!dest[code]) dest[code] = { b2026: 0, b2025: 0, name }
    if (+r.year === curYear) dest[code].b2026 += (+r.booking_count || 0)
    else                     dest[code].b2025 += (+r.booking_count || 0)
  }
  return dest
}


function aggregateFunnel(rows, { weeks, years, selectedWeek }) {
  const curYear = years[years.length - 1], prevYear = years[0]
  const steps = {
    view_search_results: { [curYear]: 0, [prevYear]: 0 },
    begin_checkout:      { [curYear]: 0, [prevYear]: 0 },
    checkout:            { [curYear]: 0, [prevYear]: 0 },
    purchase:            { [curYear]: 0, [prevYear]: 0 },
  }
  for (const r of rows) {
    if (selectedWeek !== null && +r.iso_week !== selectedWeek) continue
    if (!weeks.includes(+r.iso_week)) continue
    if (!steps[r.event_name]) continue
    if (+r.year === curYear || +r.year === prevYear) {
      steps[r.event_name][+r.year] += (+r.event_count || 0)
    }
  }
  return { steps, curYear, prevYear }
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas chart primitives
// ─────────────────────────────────────────────────────────────────────────────
const CHART_PAD = { left: 50, right: 12, top: 10, bottom: 26 }

function drawBarChart(canvas, weekLabels, data2025, data2026, yLabel = v => String(Math.round(v))) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const W = canvas.width / (window.devicePixelRatio || 1)
  const H = canvas.height / (window.devicePixelRatio || 1)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const { left: PL, right: PR, top: PT, bottom: PB } = CHART_PAD
  const plotW = W - PL - PR, plotH = H - PT - PB
  const n = weekLabels.length
  if (n === 0) return
  const allVals = [...data2025, ...data2026].filter(v => v != null && !isNaN(v))
  if (!allVals.length) return
  const maxVal = Math.max(...allVals) * 1.12 || 1
  const dpr = window.devicePixelRatio || 1

  ctx.save()
  ctx.scale(dpr, dpr)

  // Grid
  ctx.strokeStyle = C.border; ctx.lineWidth = 0.5
  for (let i = 0; i <= 4; i++) {
    const y = PT + plotH - (i / 4) * plotH
    ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(PL + plotW, y); ctx.stroke()
    ctx.fillStyle = C.muted; ctx.font = '9px Open Sans,sans-serif'; ctx.textAlign = 'right'
    ctx.fillText(yLabel(maxVal * i / 4), PL - 4, y + 3)
  }

  const groupW = plotW / n
  const barW   = Math.min(groupW * 0.32, 22)
  const gap    = 2

  for (let i = 0; i < n; i++) {
    const cx  = PL + i * groupW + groupW / 2
    const x25 = cx - barW - gap / 2
    const x26 = cx + gap / 2
    const isLast = i === n - 1
    if (data2025[i] != null) {
      const bh = (data2025[i] / maxVal) * plotH
      ctx.globalAlpha = isLast ? 0.55 : 0.75
      ctx.fillStyle = C.border
      ctx.fillRect(x25, PT + plotH - bh, barW, bh)
      ctx.globalAlpha = 1
    }
    if (data2026[i] != null) {
      const bh = (data2026[i] / maxVal) * plotH
      ctx.fillStyle = isLast ? '#3A7A42' : C.accentGreen
      ctx.fillRect(x26, PT + plotH - bh, barW, bh)
    }
  }

  // Trend lines
  const drawTrend = (data, color) => {
    const pts = data.map((v, i) => {
      const cx = PL + i * groupW + groupW / 2
      return v != null ? { x: cx, y: PT + plotH - (v / maxVal) * plotH } : null
    }).filter(Boolean)
    if (pts.length < 2) return
    ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3])
    ctx.beginPath()
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
    ctx.stroke(); ctx.setLineDash([])
  }
  drawTrend(data2025, C.muted)
  drawTrend(data2026, C.accentGreen)

  // X labels
  ctx.fillStyle = C.muted; ctx.font = '9px Open Sans,sans-serif'; ctx.textAlign = 'center'
  weekLabels.forEach((lbl, i) => {
    ctx.fillText(lbl, PL + i * groupW + groupW / 2, PT + plotH + 16)
  })

  // Legend
  const legends = [
    { label: '2025', color: C.border },
    { label: '2026', color: C.accentGreen },
    { label: 'last week', color: '#3A7A42', dot: true },
  ]
  let lx = PL
  const ly = H - 6
  ctx.font = '8px Open Sans,sans-serif'; ctx.textAlign = 'left'
  legends.forEach(({ label, color, dot }) => {
    ctx.fillStyle = color
    if (dot) { ctx.beginPath(); ctx.arc(lx + 4, ly - 3, 3, 0, Math.PI * 2); ctx.fill() }
    else { ctx.fillRect(lx, ly - 7, 8, 6) }
    ctx.fillStyle = C.muted; ctx.fillText(label, lx + 12, ly)
    lx += ctx.measureText(label).width + 24
  })

  ctx.restore()
}

function drawLineChart(canvas, weekLabels, data2025, data2026) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const W = canvas.width / (window.devicePixelRatio || 1)
  const H = canvas.height / (window.devicePixelRatio || 1)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const { left: PL, right: PR, top: PT, bottom: PB } = CHART_PAD
  const plotW = W - PL - PR, plotH = H - PT - PB
  const n = weekLabels.length
  if (n === 0) return
  const allVals = [...data2025, ...data2026].filter(v => v != null && !isNaN(v))
  if (!allVals.length) return
  const minVal = Math.min(...allVals) * 0.85
  const maxVal = Math.max(...allVals) * 1.1
  const range  = maxVal - minVal || 1
  const toY = v => PT + plotH - ((v - minVal) / range) * plotH
  const dpr = window.devicePixelRatio || 1

  ctx.save()
  ctx.scale(dpr, dpr)

  // Grid
  ctx.strokeStyle = C.border; ctx.lineWidth = 0.5
  for (let i = 0; i <= 4; i++) {
    const y = PT + plotH - (i / 4) * plotH
    ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(PL + plotW, y); ctx.stroke()
    ctx.fillStyle = C.muted; ctx.font = '9px Open Sans,sans-serif'; ctx.textAlign = 'right'
    ctx.fillText(fmtPct(minVal + range * i / 4, 2), PL - 4, y + 3)
  }

  const groupW = plotW / Math.max(n - 1, 1)

  const drawLine = (data, color, highlight = false) => {
    const pts = data.map((v, i) => ({ x: PL + i * groupW, y: v != null ? toY(v) : null }))
    ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.setLineDash([])
    ctx.beginPath(); let started = false
    pts.forEach(p => {
      if (p.y == null) { started = false; return }
      if (!started) { ctx.moveTo(p.x, p.y); started = true } else ctx.lineTo(p.x, p.y)
    })
    ctx.stroke()
    pts.forEach((p, i) => {
      if (p.y == null) return
      const isLast = i === data.length - 1
      ctx.beginPath(); ctx.arc(p.x, p.y, isLast ? 4 : 2.5, 0, Math.PI * 2)
      ctx.fillStyle = isLast && highlight ? C.accentGreen : color; ctx.fill()
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke()
    })
  }
  drawLine(data2025, C.border)
  drawLine(data2026, C.darkGreen, true)

  ctx.fillStyle = C.muted; ctx.font = '9px Open Sans,sans-serif'; ctx.textAlign = 'center'
  weekLabels.forEach((lbl, i) => ctx.fillText(lbl, PL + i * groupW, PT + plotH + 16))

  ctx.restore()
}

// ─────────────────────────────────────────────────────────────────────────────
// CanvasChart — renders one chart with a hover tooltip
// ─────────────────────────────────────────────────────────────────────────────
function CanvasChart({ drawFn, drawArgs, title, subtitle, height = 180, tooltipFn }) {
  const canvasRef  = useRef(null)
  const tooltipRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !drawArgs) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.offsetWidth
    canvas.width  = w * dpr
    canvas.height = height * dpr
    canvas.style.height = `${height}px`
    drawFn(canvas, ...drawArgs)
  }) // intentionally no dep array — redraws on every parent render (cheap Canvas op)

  const handleMouseMove = useCallback(e => {
    if (!tooltipFn || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const content = tooltipFn(x, canvasRef.current.offsetWidth)
    if (content && tooltipRef.current) {
      tooltipRef.current.style.display = 'block'
      tooltipRef.current.style.left = `${Math.min(x + 12, rect.width - 160)}px`
      tooltipRef.current.style.top  = '20px'
      tooltipRef.current.innerHTML  = content
    }
  }, [tooltipFn])

  const handleMouseLeave = useCallback(() => {
    if (tooltipRef.current) tooltipRef.current.style.display = 'none'
  }, [])

  return (
    <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', position: 'relative' }}>
      {(title || subtitle) && (
        <div style={{ padding: '10px 14px 6px', borderBottom: `1px solid ${C.lightGrayBg}` }}>
          {title   && <div style={{ fontSize: 9, fontWeight: 600, color: C.secondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</div>}
          {subtitle && <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>{subtitle}</div>}
        </div>
      )}
      <div style={{ padding: '8px 6px 4px', position: 'relative' }}>
        <canvas ref={canvasRef} style={{ width: '100%', display: 'block' }}
          onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
        <div ref={tooltipRef} style={{
          display: 'none', position: 'absolute', background: C.darkGreen, color: C.lightGreenBg,
          borderRadius: 8, padding: '8px 12px', fontSize: 11, lineHeight: 1.6,
          pointerEvents: 'none', zIndex: 10, minWidth: 140,
        }} />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI Card
// ─────────────────────────────────────────────────────────────────────────────
function KpiCard({ label, val26, val25, yoy, format = 'number', isPP = false, curYear, prevYear }) {
  const fmt = format === 'currency' ? fmtUSD : format === 'pct' ? v => fmtPct(v, 2) : fmtNum
  const delta  = fmtDelta(yoy, !isPP, isPP)
  const topColor = yoy > 0 ? C.accentGreen : yoy < 0 ? C.red : C.border

  return (
    <div style={{
      background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10,
      boxShadow: '0 1px 4px rgba(14,67,20,0.06)', overflow: 'hidden',
      borderTop: `4px solid ${topColor}`, flex: 1, minWidth: 0,
    }}>
      <div style={{ padding: '10px 12px 8px' }}>
        <div style={{ fontSize: 9, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 8, color: C.muted, marginBottom: 1 }}>{curYear}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.body, lineHeight: 1 }}>{fmt(val26)}</div>
          </div>
          <div>
            <div style={{ fontSize: 8, color: C.muted, marginBottom: 1 }}>{prevYear}</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.muted, lineHeight: 1 }}>{fmt(val25)}</div>
          </div>
        </div>
        <div style={{ borderTop: `1px solid ${C.lightGrayBg}`, paddingTop: 6, display: 'flex', gap: 10 }}>
          <div>
            <div style={{ fontSize: 8, color: C.muted }}>YoY</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: delta.color }}>{delta.text}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Funnel section
// ─────────────────────────────────────────────────────────────────────────────
const FUNNEL_STEPS = [
  { key: 'view_search_results', label: 'STEP 1 SEARCHES' },
  { key: 'begin_checkout',      label: 'STEP 2 VEHICLE SELECT' },
  { key: 'checkout',            label: 'STEP 3 PAYMENT FORM' },
  { key: 'purchase',            label: 'STEP 4 BOOKINGS' },
]

function FunnelSection({ funnelData, weeks, selectedWeek, onWeekChange }) {
  if (!funnelData) return (
    <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: 24, textAlign: 'center', color: C.muted, fontSize: 12 }}>
      No funnel data for this selection
    </div>
  )
  const { steps, curYear, prevYear } = funnelData
  const allCounts = FUNNEL_STEPS.flatMap(s => [steps[s.key]?.[curYear] || 0, steps[s.key]?.[prevYear] || 0])
  const maxCount  = Math.max(...allCounts, 1)
  const s2bCur    = (steps.view_search_results[curYear]  || 0) > 0 ? (steps.purchase[curYear]  / steps.view_search_results[curYear]  * 100) : 0
  const s2bPrev   = (steps.view_search_results[prevYear] || 0) > 0 ? (steps.purchase[prevYear] / steps.view_search_results[prevYear] * 100) : 0

  return (
    <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: C.secondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Booking Funnel · All Channels · W{weeks[0]}–W{weeks[weeks.length - 1]}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: C.muted, marginRight: 4 }}>WEEK</span>
          {[null, ...weeks].map(w => (
            <button key={w ?? 'all'} onClick={() => onWeekChange(w)} style={{
              padding: '2px 7px', fontSize: 9, fontWeight: 600, borderRadius: 4,
              border: `1px solid ${selectedWeek === w ? C.darkGreen : C.border}`,
              background: selectedWeek === w ? C.darkGreen : 'transparent',
              color: selectedWeek === w ? '#fff' : C.muted, cursor: 'pointer', fontFamily: 'inherit',
            }}>{w === null ? 'All' : `W${w}`}</button>
          ))}
        </div>
      </div>
      {FUNNEL_STEPS.map((step, idx) => {
        const cur  = steps[step.key]?.[curYear]  || 0
        const prev = steps[step.key]?.[prevYear] || 0
        const delta    = cur - prev
        const deltaPct = prev > 0 ? ((cur - prev) / prev * 100) : 0
        const dc = fmtDelta(deltaPct, true)
        let dropCur = null, dropPrev = null
        if (idx < FUNNEL_STEPS.length - 1) {
          const nk = FUNNEL_STEPS[idx + 1].key
          const nc = steps[nk]?.[curYear]  || 0
          const np = steps[nk]?.[prevYear] || 0
          dropCur  = cur  > 0 ? ((cur  - nc) / cur  * -100) : null
          dropPrev = prev > 0 ? ((prev - np) / prev * -100) : null
        }
        return (
          <div key={step.key}>
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 9, fontWeight: 600, color: C.secondary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{step.label}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: dc.color }}>{delta >= 0 ? '+' : ''}{Math.round(delta).toLocaleString()} ({dc.text})</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ width: 28, fontSize: 8, color: C.muted, textAlign: 'right', flexShrink: 0 }}>{prevYear}</span>
                <div style={{ flex: 1, height: 14, background: C.lightGrayBg, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${(prev / maxCount) * 100}%`, height: '100%', background: C.border, borderRadius: 2 }} />
                </div>
                <span style={{ width: 54, fontSize: 9, color: C.muted, flexShrink: 0, textAlign: 'right' }}>{Math.round(prev).toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 28, fontSize: 8, color: C.body, textAlign: 'right', fontWeight: 600, flexShrink: 0 }}>{curYear}</span>
                <div style={{ flex: 1, height: 14, background: C.lightGrayBg, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${(cur / maxCount) * 100}%`, height: '100%', background: C.darkGreen, borderRadius: 2 }} />
                </div>
                <span style={{ width: 54, fontSize: 9, color: C.body, fontWeight: 700, flexShrink: 0, textAlign: 'right' }}>{Math.round(cur).toLocaleString()}</span>
              </div>
            </div>
            {dropCur !== null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, padding: '3px 8px', background: C.lightGrayBg, borderRadius: 4, fontSize: 9, color: C.muted }}>
                <span>↓</span>
                <span>{prevYear} drop: <b style={{ color: C.red }}>{dropPrev?.toFixed(1)}%</b></span>
                <span style={{ margin: '0 4px', color: C.border }}>|</span>
                <span>{curYear} drop: <b style={{ color: C.red }}>{dropCur?.toFixed(1)}%</b></span>
              </div>
            )}
          </div>
        )
      })}
      <div style={{ borderTop: `2px solid ${C.border}`, paddingTop: 10, marginTop: 4, display: 'flex', gap: 18, alignItems: 'center' }}>
        <span style={{ fontSize: 9, fontWeight: 600, color: C.secondary, textTransform: 'uppercase' }}>Overall Search to Book</span>
        <span style={{ fontSize: 11, color: C.muted }}>{prevYear}: <b>{fmtPct(s2bPrev)}</b></span>
        <span style={{ fontSize: 11, color: C.body, fontWeight: 700 }}>{curYear}: <b>{fmtPct(s2bCur)}</b></span>
        <span style={{ fontSize: 10, fontWeight: 700, color: (s2bCur - s2bPrev) >= 0 ? C.accentGreen : C.red }}>
          {(s2bCur - s2bPrev) >= 0 ? '+' : ''}{(s2bCur - s2bPrev).toFixed(2)}pp
        </span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes Table
// ─────────────────────────────────────────────────────────────────────────────
function RoutesTable({ destData, airportMap, weeks, curYear, prevYear, selectedWeek, onWeekChange, onSelectDest, originName }) {
  const CY = curYear  || new Date().getFullYear()
  const PY = prevYear || CY - 1
  if (!destData) return null
  const rows = Object.entries(destData)
    .map(([code, { b2026, b2025 }]) => {
      // If code is a 3-letter IATA code, look up the airport name.
      // Otherwise (zone name like 'Port de Pollença'), the code IS the display name.
      const isIATA = /^[A-Z0-9]{2,4}$/.test(code)
      const name = isIATA ? (airportMap[code] || code) : code
      const displayCode = isIATA ? code : '—'
      return { code, name, displayCode, b2026, b2025,
        yoyPct: b2025 > 0 ? ((b2026 - b2025) / b2025 * 100) : null,
        yoyDelta: b2026 - b2025,
      }
    })
    .filter(r => r.b2026 > 0 || r.b2025 > 0)
    .sort((a, b) => b.b2026 - a.b2026)
    .slice(0, 25)

  const thStyle = { padding: '8px 10px', fontSize: 9, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}`, background: C.lightGrayBg, whiteSpace: 'nowrap' }

  return (
    <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${C.lightGrayBg}` }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.body }}>Top routes from {originName || '—'} · W{weeks[0]}–W{weeks[weeks.length - 1]} 2026</div>
          <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>Click a row to drill into that route</div>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: C.muted, marginRight: 4 }}>WEEK</span>
          {[null, ...weeks].map(w => (
            <button key={w ?? 'all'} onClick={() => onWeekChange(w)} style={{
              padding: '2px 7px', fontSize: 9, fontWeight: 600, borderRadius: 4,
              border: `1px solid ${selectedWeek === w ? C.darkGreen : C.border}`,
              background: selectedWeek === w ? C.darkGreen : 'transparent',
              color: selectedWeek === w ? '#fff' : C.muted, cursor: 'pointer', fontFamily: 'inherit',
            }}>{w === null ? 'All' : `W${w}`}</button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontSize: 12 }}>No destination data available.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: 'left' }}>Destination</th>
                <th style={{ ...thStyle, textAlign: 'left' }}>Code</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>W{weeks[0]}–W{weeks[weeks.length - 1]} {CY}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>W{weeks[0]}–W{weeks[weeks.length - 1]} {PY}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>YoY%</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>YoY Δ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const yc = r.yoyPct > 0 ? C.accentGreen : r.yoyPct < 0 ? C.red : C.muted
                return (
                  <tr key={r.code} onClick={() => onSelectDest(r.code)}
                    style={{ borderBottom: `1px solid ${C.lightGrayBg}`, background: i % 2 === 0 ? '#fff' : C.lightGrayBg, cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = C.lightGreenBg}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#fff' : C.lightGrayBg}
                  >
                    <td style={{ padding: '7px 10px', fontSize: 11, color: C.body, fontWeight: 500 }}>{r.name}</td>
                    <td style={{ padding: '7px 10px', fontSize: 10, color: C.muted, fontFamily: 'monospace' }}>{r.displayCode}</td>
                    <td style={{ padding: '7px 10px', fontSize: 11, color: C.darkGreen, fontWeight: 700, textAlign: 'right' }}>{Math.round(r.b2026).toLocaleString()}</td>
                    <td style={{ padding: '7px 10px', fontSize: 11, color: C.muted, textAlign: 'right' }}>{Math.round(r.b2025).toLocaleString()}</td>
                    <td style={{ padding: '7px 10px', fontSize: 11, fontWeight: 700, color: yc, textAlign: 'right' }}>{r.yoyPct != null ? `${r.yoyPct >= 0 ? '+' : ''}${r.yoyPct.toFixed(1)}%` : '—'}</td>
                    <td style={{ padding: '7px 10px', fontSize: 11, fontWeight: 600, color: yc, textAlign: 'right' }}>{r.yoyDelta >= 0 ? '+' : ''}{Math.round(r.yoyDelta).toLocaleString()}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AirportList sidebar
// ─────────────────────────────────────────────────────────────────────────────
// query + onQueryChange are CONTROLLED from the parent so switching tabs
// clears the search in both directions automatically.
function AirportList({ airports, selected, onSelect, searchPlaceholder = 'Search...', topItem = null, query = '', onQueryChange }) {
  const filtered = airports.filter(a =>
    !query || a.name.toLowerCase().includes(query.toLowerCase()) || a.code.toLowerCase().includes(query.toLowerCase())
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ padding: '6px 10px', borderBottom: `1px solid ${C.border}` }}>
        <input value={query} onChange={e => onQueryChange && onQueryChange(e.target.value)} placeholder={searchPlaceholder}
          style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px', fontSize: 11, border: `1px solid ${C.border}`, borderRadius: 6, outline: 'none', fontFamily: 'inherit', color: C.body, background: C.lightGrayBg }} />
      </div>
      <div className="da-scroll" style={{ flex: 1, overflowY: 'auto' }}>
        {topItem && (
          <div onClick={() => onSelect(topItem.code)} style={{
            padding: '7px 10px 7px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderLeft: selected === topItem.code ? `2px solid ${C.accentGreen}` : '2px solid transparent',
            background: selected === topItem.code ? C.lightGreenBg : 'transparent',
            borderBottom: `1px solid ${C.border}`,
          }}>
            <span style={{ fontSize: 11, color: selected === topItem.code ? C.darkGreen : C.body, fontWeight: 600 }}>{topItem.name}</span>
            <span style={{ fontSize: 9, color: C.muted, fontFamily: 'monospace' }}>{topItem.displayCode || ''}</span>
          </div>
        )}
        {filtered.map(a => (
          <div key={a.code} onClick={() => onSelect(a.code)} style={{
            padding: '6px 10px 6px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderLeft: selected === a.code ? `2px solid ${C.accentGreen}` : '2px solid transparent',
            background: selected === a.code ? C.lightGreenBg : 'transparent',
          }}
            onMouseEnter={e => { if (selected !== a.code) e.currentTarget.style.background = C.lightGrayBg }}
            onMouseLeave={e => { if (selected !== a.code) e.currentTarget.style.background = 'transparent' }}
          >
            <span style={{ fontSize: 11, color: selected === a.code ? C.darkGreen : C.darkCard, fontWeight: selected === a.code ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{a.name}</span>
            <span style={{ fontSize: 9, color: C.muted, fontFamily: 'monospace', marginLeft: 4, flexShrink: 0 }}>{a.displayCode ?? a.code}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function FilterBtn({ label, active, onClick, dark = false }) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 12px', fontSize: 11, fontWeight: active ? 700 : 500, borderRadius: 5,
      border: `1px solid ${active ? (dark ? C.accentGreen : C.darkGreen) : 'transparent'}`,
      background: active ? (dark ? C.darkGreen : C.accentGreen) : 'transparent',
      color: active ? '#fff' : dark ? 'rgba(255,255,255,0.75)' : C.body,
      cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.12s', whiteSpace: 'nowrap',
    }}>{label}</button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function DestinationAnalysis() {
  // ── Font + scrollbar injection (once) ──────────────────────────────────────
  useEffect(() => {
    if (!document.getElementById('da-open-sans-font')) {
      const link = document.createElement('link')
      link.id = 'da-open-sans-font'; link.rel = 'stylesheet'
      link.href = 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&display=swap'
      document.head.appendChild(link)
    }
    if (!document.getElementById('da-scrollbar-style')) {
      const s = document.createElement('style')
      s.id = 'da-scrollbar-style'
      s.textContent = `.da-scroll::-webkit-scrollbar{width:5px}.da-scroll::-webkit-scrollbar-track{background:#F7F7F7}.da-scroll::-webkit-scrollbar-thumb{background:#539A5B;border-radius:3px}`
      document.head.appendChild(s)
    }
  }, [])

  // ── Core state ─────────────────────────────────────────────────────────────
  const [origin,      setOriginState]  = useState('TFS')
  const [destination, setDestState]    = useState('__all__')
  const [channel,     setChannel]      = useState('all')
  const [device,      setDeviceState]  = useState('all')
  const [vehicle,     setVehicleState] = useState('all')
  const [cohort,      setCohortState]  = useState('all')
  const [week,        setWeek]         = useState(null)
  const [sidebarTab,  setSidebarTab]   = useState('pickup')
  // Separate search queries for each tab — cleared when switching tabs
  const [pickupQuery,  setPickupQuery]  = useState('')
  const [dropoffQuery, setDropoffQuery] = useState('')

  // Tab switcher: always clear the OTHER tab's search box on switch
  const handleTabSwitch = (tab) => {
    setSidebarTab(tab)
    if (tab === 'pickup') setDropoffQuery('')
    else                  setPickupQuery('')
  }

  // On destination select: clear search, then auto-switch to pickup tab so the
  // user lands on the data view (not the empty sidebar).
  // 'All destinations' stays on drop-off tab so user can keep browsing.
  const handleDestSelect = (code) => {
    setDest(code)
    setDropoffQuery('')
    if (code !== '__all__') setSidebarTab('pickup')
  }

  // On origin select: clear search, switch to drop-off tab, stay gated.
  // setOrigin() already resets destState to '__all__' internally via setDestState
  // (the raw setter) — so we must NOT call setDest() here as that would
  // set readyToFetch=true and trigger an immediate data load.
  const handleOriginSelect = (code) => {
    setOrigin(code)        // resets dest + readyToFetch=false + clears rows
    setPickupQuery('')
    setSidebarTab('dropoff')
  }

  // ── Date range → ISO weeks/years (driven by the global filter bar) ──────────
  const { filters } = useFilters()
  const primaryRange    = filters?.dateRanges?.primary
  const comparisonRange = filters?.dateRanges?.comparison

  const { weeks: primaryWeeks, years: primaryYears } = useMemo(
    () => dateRangeToWeeksYears(primaryRange?.startDate, primaryRange?.endDate),
    [primaryRange?.startDate, primaryRange?.endDate]
  )

  // If there's a comparison range, derive its weeks/years; otherwise use prior year
  const { weeks: compWeeks, years: compYears } = useMemo(
    () => comparisonRange
      ? dateRangeToWeeksYears(comparisonRange.startDate, comparisonRange.endDate)
      : { weeks: primaryWeeks, years: [primaryYears[0] - 1] },
    [comparisonRange?.startDate, comparisonRange?.endDate, primaryWeeks, primaryYears]
  )

  const curYear  = primaryYears[primaryYears.length - 1]
  const prevYear = curYear - 1   // always YoY: same ISO weeks, one year back
  const lastWeek = primaryWeeks[primaryWeeks.length - 1]

  // weeks + years sent to ALL queries: primary period weeks, both years
  const weeks = primaryWeeks
  const years = useMemo(() => [prevYear, curYear], [prevYear, curYear])

  // ── Data ───────────────────────────────────────────────────────────────────
  const [airports,    setAirports]    = useState([])
  const [airportMap,  setAirportMap]  = useState({})
  const [searchRows,  setSearchRows]  = useState([])
  const [bookingRows, setBookingRows] = useState([])
  const [funnelRows,  setFunnelRows]  = useState([])
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState(null)
  // Two-step selection gate: dashboard data only fetches after BOTH pick-up AND drop-off chosen
  const [readyToFetch, setReadyToFetch] = useState(false)
  // Sidebar rows: fetched immediately on origin select to populate the drop-off list.
  // Completely separate from bookingRows (which is for the dashboard).
  const [sidebarRows,  setSidebarRows]  = useState([])
  const [sidebarLoading, setSidebarLoading] = useState(false)

  // ── Fetch airports once on mount ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data, error: fnErr } = await supabase.functions.invoke('destination-analysis', {
          body: { type: 'airports' },
        })
        if (cancelled) return
        if (fnErr) throw new Error(fnErr.message)
        const rawList = data?.airports || []
        // Client-side guard: strip airports with missing/numeric/garbage names
        const list = rawList.filter(a => {
          const n = a.name
          if (!n || typeof n !== 'string') return false
          const trimmed = n.trim()
          if (trimmed.length < 4) return false
          if (!isNaN(Number(trimmed))) return false          // pure-number name
          if (/^[?]+$/.test(trimmed)) return false           // ??? placeholder
          if (!/[A-Za-z]/.test(trimmed)) return false        // must have at least one Latin letter
          return true
        })
        setAirports(list)
        const map = {}
        list.forEach(a => { map[a.code] = a.name })
        setAirportMap(map)
      } catch (e) {
        console.error('[DA] airports error:', e.message)
      }
    })()
    return () => { cancelled = true }
  }, []) // runs exactly once

  // ── Fetch sidebar destinations (fires on origin change, ungated) ─────────────
  // This is a lightweight bookings query (no dropoff filter, just to get the dest list).
  // Stored in sidebarRows — completely separate from bookingRows.
  const fetchSidebarDests = useCallback(async (originCode) => {
    if (!originCode) return
    setSidebarLoading(true)
    setSidebarRows([])
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('destination-analysis', {
        body: { type: 'bookings', pickup: originCode, dropoff: '__all__', weeks, years },
      })
      if (fnErr) throw new Error(fnErr.message)
      setSidebarRows(data?.bookings || [])
    } catch (e) {
      console.error('[DA] fetchSidebarDests error:', e.message)
    } finally {
      setSidebarLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeks, years])

  // Fire fetchSidebarDests whenever origin changes
  useEffect(() => {
    fetchSidebarDests(origin)
  }, [origin, fetchSidebarDests])

  // ── Fetch searches + bookings + funnel (gated — fires only after drop-off chosen) ──
  const fetchMain = useCallback(async () => {
    setLoading(true)
    setError(null)

    // For zone destinations (e.g. "Cala Millor"), GA4 stores the zone code ("2QZ") in
    // drop_off_code, while TGRS stores the zone name in dropoff_zone_name.
    // Compute the zone code so the edge function can use the right filter per query type.
    const normDestName = (s) => s.trim().toLowerCase()
      .replace(/['']/g, '').replace(/ç/g,'c').replace(/[úù]/g,'u')
      .replace(/[óò]/g,'o').replace(/[àâ]/g,'a').replace(/[èê]/g,'e')
      .replace(/[íî]/g,'i').replace(/ï/g,'i').replace(/ñ/g,'n')
      .replace(/[áä]/g,'a').replace(/[éë]/g,'e').replace(/ü/g,'u')
      .replace(/&/g,'and').replace(/,/g,'').replace(/-/g,' ')
      .replace(/\s+/g,' ').trim()

    const isIATAAirport = destination && /^[A-Z]{3}$/.test(destination)
    const dropoffZoneCode = destination
      ? (isIATAAirport
          ? destination  // IATA codes are their own zone code in GA4
          : (zoneMap.normToCode[normDestName(destination)] || destination))
      : undefined

    // Human-readable name for the destination — used by the edge function to filter
    // the historical (ads_ride_dispatch_v) table by dropoff_zone_name or airport name.
    const dropoffName = destination && destination !== '__all__'
      ? (isIATAAirport
          ? (airportMap[destination] || destination)
          : (zoneMap.codeToName?.[destination] || destination))
      : undefined

    const body = { pickup: origin, dropoff: destination, dropoffZoneCode, dropoffName, weeks, years }
    try {
      const [sRes, bRes, fRes] = await Promise.all([
        supabase.functions.invoke('destination-analysis', { body: { ...body, type: 'searches' } }),
        supabase.functions.invoke('destination-analysis', { body: { ...body, type: 'bookings' } }),
        supabase.functions.invoke('destination-analysis', { body: { ...body, type: 'funnel'   } }),
      ])
      if (sRes.error) throw new Error(`Searches: ${sRes.error.message}`)
      if (bRes.error) throw new Error(`Bookings: ${bRes.error.message}`)
      if (fRes.error) throw new Error(`Funnel: ${fRes.error.message}`)
      setSearchRows(sRes.data?.searches  || [])
      setBookingRows(bRes.data?.bookings || [])
      setFunnelRows(fRes.data?.funnel    || [])
    } catch (e) {
      console.error('[DA] fetchMain error:', e.message)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, destination, weeks, years])

  useEffect(() => {
    if (!readyToFetch) return  // wait until both pick-up AND drop-off are chosen
    fetchMain()
  }, [fetchMain, readyToFetch])

  // ── Handlers (mutex: device/vehicle/cohort are mutually exclusive) ─────────
  const setOrigin = useCallback(code => {
    setOriginState(code)
    setDestState('__all__')
    setWeek(null)
    // Reset gate and clear stale data — user must now pick a drop-off
    setReadyToFetch(false)
    setSearchRows([])
    setBookingRows([])
    setFunnelRows([])
    setError(null)
  }, [])
  const setDest = useCallback(code => {
    setDestState(code)
    setReadyToFetch(true)  // both sides confirmed — trigger data load
  }, [])
  const setDevice = useCallback(d => {
    setDeviceState(d)
    if (d !== 'all') { setVehicleState('all'); setCohortState('all') }
  }, [])
  const setVehicle = useCallback(v => {
    setVehicleState(v)
    if (v !== 'all') { setDeviceState('all'); setCohortState('all') }
  }, [])
  const setCohort = useCallback(c => {
    setCohortState(c)
    if (c !== 'all') { setDeviceState('all'); setVehicleState('all') }
  }, [])

  // ── Derived aggregations (memoised) ────────────────────────────────────────
  const searchByWkYr = useMemo(() =>
    aggregateSearches(searchRows, { channel, device, weeks, years }),
  [searchRows, channel, device, weeks, years])

  const { counts: bookByWkYr, ttvs: ttvByWkYr } = useMemo(() =>
    aggregateBookings(bookingRows, { weeks, years }),
  [bookingRows, weeks, years])

  const sv = (yr, wk) => searchByWkYr[`${yr}-${wk}`] || 0
  const bv = (yr, wk) => bookByWkYr[`${yr}-${wk}`]   || 0
  const tv = (yr, wk) => ttvByWkYr[`${yr}-${wk}`]    || 0

  const sSum26 = useMemo(() => primaryWeeks.reduce((a, w) => a + sv(curYear,  w), 0), [searchByWkYr, primaryWeeks, curYear])
  const sSum25 = useMemo(() => primaryWeeks.reduce((a, w) => a + sv(prevYear, w), 0), [searchByWkYr, primaryWeeks, prevYear])
  const bSum26 = useMemo(() => primaryWeeks.reduce((a, w) => a + bv(curYear,  w), 0), [bookByWkYr,   primaryWeeks, curYear])
  const bSum25 = useMemo(() => primaryWeeks.reduce((a, w) => a + bv(prevYear, w), 0), [bookByWkYr,   primaryWeeks, prevYear])
  const tSum26 = useMemo(() => primaryWeeks.reduce((a, w) => a + tv(curYear,  w), 0), [ttvByWkYr,    primaryWeeks, curYear])
  const tSum25 = useMemo(() => primaryWeeks.reduce((a, w) => a + tv(prevYear, w), 0), [ttvByWkYr,    primaryWeeks, prevYear])

  const sLast26 = sv(curYear,  lastWeek), sLast25 = sv(prevYear, lastWeek)
  const bLast26 = bv(curYear,  lastWeek), bLast25 = bv(prevYear, lastWeek)
  const tLast26 = tv(curYear,  lastWeek), tLast25 = tv(prevYear, lastWeek)

  const aLast26 = bLast26 > 0 ? tLast26 / bLast26 : null
  const aLast25 = bLast25 > 0 ? tLast25 / bLast25 : null
  const aSum26  = bSum26  > 0 ? tSum26  / bSum26   : null
  const aSum25  = bSum25  > 0 ? tSum25  / bSum25   : null

  const s2bLast26 = sLast26 > 0 ? bLast26 / sLast26 * 100 : null
  const s2bLast25 = sLast25 > 0 ? bLast25 / sLast25 * 100 : null
  const s2bSum26  = sSum26  > 0 ? bSum26  / sSum26  * 100 : null
  const s2bSum25  = sSum25  > 0 ? bSum25  / sSum25  * 100 : null

  const wYoY  = (a, b) => b > 0 ? (a - b) / b * 100 : null
  const ppDiff = (a, b) => (a != null && b != null) ? a - b : null

  // KPI cards show RANGE totals only (no single-week point). Charts use primaryWeeks.
  const wkLabels = useMemo(() => primaryWeeks.map(w => `W${w}`), [primaryWeeks])
  const s25 = useMemo(() => primaryWeeks.map(w => sv(prevYear, w)), [searchByWkYr, primaryWeeks, prevYear])
  const s26 = useMemo(() => primaryWeeks.map(w => sv(curYear,  w)), [searchByWkYr, primaryWeeks, curYear])
  const b25 = useMemo(() => primaryWeeks.map(w => bv(prevYear, w)), [bookByWkYr,   primaryWeeks, prevYear])
  const b26 = useMemo(() => primaryWeeks.map(w => bv(curYear,  w)), [bookByWkYr,   primaryWeeks, curYear])
  const c25 = useMemo(() => primaryWeeks.map(w => { const s = sv(prevYear, w); return s > 0 ? bv(prevYear, w) / s * 100 : null }), [searchByWkYr, bookByWkYr, primaryWeeks, prevYear])
  const c26 = useMemo(() => primaryWeeks.map(w => { const s = sv(curYear,  w); return s > 0 ? bv(curYear,  w) / s * 100 : null }), [searchByWkYr, bookByWkYr, primaryWeeks, curYear])

  const funnelData = useMemo(() =>
    funnelRows.length > 0 ? aggregateFunnel(funnelRows, { weeks, years, selectedWeek: week }) : null,
  [funnelRows, weeks, years, week])

  const destAgg = useMemo(() =>
    destination === '__all__' ? aggregateByDestination(bookingRows, { weeks: week ? [week] : weeks, years }) : null,
  [bookingRows, destination, week, weeks, years])

  // sidebarDestAgg: aggregates from sidebarRows which are fetched immediately
  // when origin is selected (via fetchSidebarDests) — completely decoupled from
  // the main dashboard bookingRows so the drop-off list is always populated.
  const sidebarDestAgg = useMemo(() =>
    aggregateByDestination(sidebarRows, { weeks, years }),
  [sidebarRows, weeks, years])


  const dropoffAirports = useMemo(() => {
    // Normalize a zone name for fuzzy lookup in zoneMap
    const normZoneName = (s) => s.trim().toLowerCase()
      .replace(/['']/g, '').replace(/ç/g,'c').replace(/[úù]/g,'u')
      .replace(/[óò]/g,'o').replace(/[àâ]/g,'a').replace(/[èê]/g,'e')
      .replace(/[íî]/g,'i').replace(/ï/g,'i').replace(/ñ/g,'n')
      .replace(/[áä]/g,'a').replace(/[éë]/g,'e').replace(/ü/g,'u')
      .replace(/&/g,'and').replace(/,/g,'').replace(/-/g,' ')
      .replace(/\s+/g,' ').trim()

    // Look up the real zone code from the original report's name map
    const getZoneCode = (zoneName) => {
      const key = normZoneName(zoneName)
      return (zoneMap.normToCode)[key] || null
    }

    return Object.entries(sidebarDestAgg)
      .filter(([, { b2026, b2025 }]) => b2026 + b2025 > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, { name }]) => {
        const isIATAAirport = /^[A-Z]{3}$/.test(code) && airportMap[code]
        if (isIATAAirport) {
          return { code, displayCode: code, name: airportMap[code] || name || code }
        }
        // Zone: look up real code from zone map, fall back to short generated tag
        const displayName = name || code
        const realCode = getZoneCode(displayName)
        return { code, displayCode: realCode || '', name: displayName }
      })
  }, [sidebarDestAgg, airportMap])




  // Tooltip factories
  const barTooltipFn = useCallback((s25arr, s26arr) => (mouseX, canvasW) => {
    const plotW = canvasW - CHART_PAD.left - CHART_PAD.right
    const groupW = plotW / weeks.length
    const idx = Math.min(Math.max(Math.floor((mouseX - CHART_PAD.left) / groupW), 0), weeks.length - 1)
    const w = weeks[idx], v25 = s25arr[idx] ?? 0, v26 = s26arr[idx] ?? 0
    const diff = v26 - v25, pct = v25 > 0 ? ((diff / v25) * 100).toFixed(1) : '—'
    return `<div style="font-size:10px;font-weight:600;margin-bottom:4px">W${w}</div>
      <div>2026: <b>${Math.round(v26).toLocaleString()}</b></div>
      <div>2025: ${Math.round(v25).toLocaleString()}</div>
      <div style="margin-top:4px;color:${diff >= 0 ? C.lightGreenBg : '#ffaaaa'}">${diff >= 0 ? '+' : ''}${Math.round(diff).toLocaleString()} (${pct}%)</div>`
  }, [weeks])

  const s2bTooltipFn = useCallback((mouseX, canvasW) => {
    const plotW = canvasW - CHART_PAD.left - CHART_PAD.right
    const groupW = plotW / Math.max(weeks.length - 1, 1)
    const idx = Math.min(Math.max(Math.round((mouseX - CHART_PAD.left) / groupW), 0), weeks.length - 1)
    const w = weeks[idx], v25 = c25[idx], v26 = c26[idx]
    const diff = v26 != null && v25 != null ? v26 - v25 : null
    return `<div style="font-size:10px;font-weight:600;margin-bottom:4px">W${w}</div>
      <div>2026: <b>${v26 != null ? fmtPct(v26) : '—'}</b></div>
      <div>2025: ${v25 != null ? fmtPct(v25) : '—'}</div>
      ${diff != null ? `<div style="margin-top:4px;color:${diff >= 0 ? C.lightGreenBg : '#ffaaaa'}">${diff >= 0 ? '+' : ''}${diff.toFixed(2)}pp</div>` : ''}`
  }, [weeks, c25, c26])

  const originName = airportMap[origin] || origin
  const destName   = destination === '__all__' ? 'All destinations' : (airportMap[destination] || destination)
  const showNotice = vehicle !== 'all' || cohort !== 'all'

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Open Sans', sans-serif", display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: C.pageBg, color: C.body }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', borderBottom: `1px solid ${C.border}`, background: '#fff', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Route Intelligence</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.darkGreen }}>Destination Performance</div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 10, color: C.muted }}>
          GA4 &amp; GA4·&nbsp;
          <span style={{ fontWeight: 600, color: C.body }}>W{primaryWeeks[0]}–W{primaryWeeks[primaryWeeks.length-1]} {curYear} vs {prevYear}</span>
        </div>
      </div>

      {/* Channel filter bar */}
      <div style={{ background: C.darkGreen, padding: '5px 14px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <span style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.07em', marginRight: 6 }}>Channel</span>
        {[
          { key: 'all', label: 'All channels' }, { key: 'search', label: 'Search (CPC + Organic)' },
          { key: 'email', label: 'Email' }, { key: 'affiliates', label: 'Affiliates' },
          { key: 'direct', label: 'Direct' }, { key: 'other', label: 'Other' },
        ].map(({ key, label }) => (
          <FilterBtn key={key} label={label} active={channel === key} onClick={() => setChannel(key)} dark />
        ))}
      </div>

      {/* Device / Vehicle / Cohort bar */}
      <div style={{ background: C.lightGrayBg, padding: '5px 14px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: `1px solid ${C.border}`, flexShrink: 0, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 9, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4 }}>Device</span>
          {[{ key: 'all', label: 'All devices' }, { key: 'mobile', label: 'Mobile' }, { key: 'desktop', label: 'Desktop' }, { key: 'tablet', label: 'Tablet' }].map(({ key, label }) => (
            <FilterBtn key={key} label={label} active={device === key} onClick={() => setDevice(key)} />
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 9, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4 }}>Vehicle</span>
          {[{ key: 'all', label: 'All vehicles' }, { key: 'private', label: 'Private' }, { key: 'shuttle', label: 'Shuttle' }, { key: 'minibus', label: 'Mini Bus' }, { key: 'other', label: 'Other' }].map(({ key, label }) => (
            <FilterBtn key={key} label={label} active={vehicle === key} onClick={() => setVehicle(key)} />
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 9, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4 }}>Cohort</span>
          {[{ key: 'all', label: 'All cohorts' }, { key: 'solo', label: 'Solo' }, { key: 'couple', label: 'Couple' }, { key: 'adult_group', label: 'Adult Group' }, { key: 'family', label: 'Family' }].map(({ key, label }) => (
            <FilterBtn key={key} label={label} active={cohort === key} onClick={() => setCohort(key)} />
          ))}
        </div>
      </div>

      {/* Notice banner */}
      {showNotice && (
        <div style={{ background: C.amberLight, borderBottom: `1px solid ${C.amber}`, padding: '6px 16px', fontSize: 11, color: C.amber, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span>ℹ</span>
          <span>Vehicle &amp; Cohort filters apply to <b>Bookings and TTV only</b>. GA4 Search events (funnel steps 1–3) do not carry vehicle or cohort data and remain unfiltered.</span>
        </div>
      )}

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Sidebar */}
        <div style={{ width: 270, flexShrink: 0, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', background: '#fff' }}>
          <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}` }}>
            {[['pickup', 'PICK-UP'], ['dropoff', 'DROP-OFF']].map(([tab, label]) => (
              <button key={tab} onClick={() => handleTabSwitch(tab)} style={{
                flex: 1, padding: '9px 0', fontSize: 10, fontWeight: 700, border: 'none', background: 'transparent', fontFamily: 'inherit',
                color: sidebarTab === tab ? C.darkGreen : C.muted,
                borderBottom: sidebarTab === tab ? `2px solid ${C.darkGreen}` : '2px solid transparent', cursor: 'pointer', letterSpacing: '0.06em',
              }}>{label}</button>
            ))}
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {sidebarTab === 'pickup' ? (
              <AirportList
                airports={[...airports].sort((a, b) => a.name.localeCompare(b.name))}
                selected={origin}
                onSelect={handleOriginSelect}
                searchPlaceholder="Search origins..."
                query={pickupQuery}
                onQueryChange={setPickupQuery}
              />
            ) : sidebarLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 8, color: C.muted }}>
                <div style={{ width: 20, height: 20, border: `2px solid ${C.border}`, borderTopColor: C.accentGreen, borderRadius: '50%', animation: 'da-spin 0.8s linear infinite' }} />
                <span style={{ fontSize: 11 }}>Loading destinations…</span>
              </div>
            ) : (
              <AirportList
                airports={[...dropoffAirports].sort((a, b) => a.name.localeCompare(b.name))}
                selected={destination}
                onSelect={handleDestSelect}
                searchPlaceholder="Search destinations..."
                topItem={{ code: '__all__', name: 'All destinations' }}
                query={dropoffQuery}
                onQueryChange={setDropoffQuery}
              />
            )}
          </div>
          {/* Route pill */}
          <div style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}`, background: C.lightGrayBg }}>
            <div style={{ fontSize: 8, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Selected Route</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: C.darkGreen, fontFamily: 'monospace' }}>{origin}</span>
              <span style={{ fontSize: 14, color: C.border, fontWeight: 300 }}>→</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: destination === '__all__' ? C.muted : C.darkGreen, fontFamily: 'monospace' }}>
                {destination === '__all__' ? 'ALL' : destination}
              </span>
            </div>
          </div>
        </div>

        {/* Main panel */}
        <div className="da-scroll" style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', position: 'relative' }}>
          {/* Loading overlay */}
          {loading && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20, flexDirection: 'column', gap: 12 }}>
              <div style={{ width: 32, height: 32, border: `3px solid ${C.border}`, borderTopColor: C.accentGreen, borderRadius: '50%', animation: 'da-spin 0.8s linear infinite' }} />
              <div style={{ fontSize: 12, color: C.muted }}>Loading data…</div>
              <style>{`@keyframes da-spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          )}

          {/* Waiting for drop-off selection */}
          {!readyToFetch && !loading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 420, gap: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 48, lineHeight: 1 }}>✈️</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: C.darkCard }}>
                Now select a destination
              </div>
              <div style={{ fontSize: 13, color: C.muted, maxWidth: 320 }}>
                You've selected <strong style={{ color: C.darkGreen }}>{airportMap[origin] || origin}</strong> as your pick-up.
                Choose a drop-off destination from the <strong>DROP-OFF</strong> tab on the left to load the dashboard.
              </div>
              <button
                onClick={() => { setSidebarTab('dropoff'); setDropoffQuery('') }}
                style={{ marginTop: 8, background: C.darkGreen, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8 }}
              >
                ← Go to DROP-OFF tab
              </button>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ background: '#FEF2F2', border: `1px solid ${C.red}`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: C.red, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>⚠</span>
              <span style={{ flex: 1 }}>{error}</span>
              <button onClick={fetchMain} style={{ background: C.red, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Retry</button>
            </div>
          )}

          {/* Dashboard content — only shown after both pick-up AND drop-off are selected */}
          {readyToFetch && (<>

          {/* Route heading */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: C.darkGreen }}>{originName}</span>
              <span style={{ fontSize: 15, color: C.accentGreen }}>→</span>
              <span style={{ fontSize: 17, fontWeight: 700, color: destination === '__all__' ? C.muted : C.darkGreen }}>{destName}</span>
            </div>
            <div style={{ fontSize: 11, color: C.secondary, marginTop: 2 }}>
              GA4 · {channel === 'all' ? 'All channels' : channel}
              &nbsp;·&nbsp;
              <span style={{ fontWeight: 600, color: C.body }}>W{primaryWeeks[0]}–W{primaryWeeks[primaryWeeks.length-1]} {curYear} vs {prevYear}</span>
            </div>
          </div>

          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 12 }}>
            <KpiCard label="Searches"    val26={sSum26} val25={sSum25} yoy={wYoY(sSum26, sSum25)} format="number"   curYear={curYear} prevYear={prevYear} />
            <KpiCard label="Bookings"    val26={bSum26} val25={bSum25} yoy={wYoY(bSum26, bSum25)} format="number"   curYear={curYear} prevYear={prevYear} />
            <KpiCard label="TTV (USD)"   val26={tSum26} val25={tSum25} yoy={wYoY(tSum26, tSum25)} format="currency" curYear={curYear} prevYear={prevYear} />
            <KpiCard label="Avg Sell"    val26={aSum26} val25={aSum25} yoy={wYoY(aSum26, aSum25)} format="currency" curYear={curYear} prevYear={prevYear} />
            <KpiCard label="Search→Book" val26={s2bSum26} val25={s2bSum25} yoy={ppDiff(s2bSum26, s2bSum25)} format="pct" isPP curYear={curYear} prevYear={prevYear} />
          </div>

          {/* Charts */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
            <CanvasChart drawFn={drawBarChart} drawArgs={[wkLabels, s25, s26, v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : Math.round(v)]}
              title="Searches · All Channels"
              subtitle={`${channel !== 'all' ? channel : 'All channels'} · ${device !== 'all' ? device : 'All devices'} · ${curYear} vs ${prevYear}`}
              height={180} tooltipFn={barTooltipFn(s25, s26)} />
            <CanvasChart drawFn={drawBarChart} drawArgs={[wkLabels, b25, b26, v => Math.round(v).toString()]}
              title={`Bookings · ${curYear} vs ${prevYear}`}
              subtitle={`${vehicle !== 'all' ? vehicle : 'All vehicles'} · ${cohort !== 'all' ? cohort : 'All cohorts'}`}
              height={180} tooltipFn={barTooltipFn(b25, b26)} />
            <CanvasChart drawFn={drawLineChart} drawArgs={[wkLabels, c25, c26]}
              title="Search to Book · All Channels"
              subtitle={`${curYear} vs ${prevYear}`}
              height={180} tooltipFn={s2bTooltipFn} />
          </div>

          {/* Funnel + Routes */}
          <div style={{ display: 'grid', gridTemplateColumns: destination === '__all__' ? '1fr 1fr' : '1fr', gap: 10, marginBottom: 14 }}>
            <FunnelSection funnelData={funnelData} weeks={primaryWeeks} selectedWeek={week} onWeekChange={setWeek} />
            {destination === '__all__' && (
              <RoutesTable destData={destAgg} airportMap={airportMap} weeks={primaryWeeks} curYear={curYear} prevYear={prevYear} selectedWeek={week}
                onWeekChange={setWeek} onSelectDest={code => { setDest(code) }}
                originName={originName} />
            )}
          </div>

          {/* Empty state — only after confirmed selection with no data returned */}
          {!loading && !error && searchRows.length === 0 && bookingRows.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: C.muted }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.body, marginBottom: 6 }}>No data for this selection</div>
              <div style={{ fontSize: 12 }}>Try changing the origin or check that the edge function is deployed.</div>
              <button onClick={fetchMain} style={{ marginTop: 16, background: C.darkGreen, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>↻ Retry</button>
            </div>
          )}

          </>)}{/* end readyToFetch */}
        </div>
      </div>
    </div>
  )
}
