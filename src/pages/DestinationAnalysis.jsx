/**
 * DestinationAnalysis.jsx
 * Route Intelligence — Destination Performance Dashboard
 *
 * Redesigned to match the Orbit analytics design system:
 *   - DM Sans font throughout
 *   - Navy #0A2540 primary text, #5A6A7A subtext
 *   - White cards with #E2E8F0 borders, 12px border-radius
 *   - Teal #0D8A72 positive / Red #C0392B negative deltas
 *   - Clean pill-style filter rows (no dark bars)
 *   - Orbit KPI card style with large values + comparison badges
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import zoneMap from './zoneMap.json'
import { supabase } from '../services/supabase'
import { useFilters } from '../context/FiltersContext'
import { IATA_NAMES } from '../utils/iataNames'

// Resolve a clean English airport name.
// If the code is a valid IATA code present in our OurAirports database,
// always use that standard English name regardless of what hoppa's DB stores.
function cleanAirportName(code, storedName) {
  if (code && /^[A-Z]{3}$/.test(code) && IATA_NAMES[code]) {
    return IATA_NAMES[code]
  }
  return storedName
}

// ─────────────────────────────────────────────────────────────────────────────
// Orbit design tokens (matches Report 109 + global CSS variables)
// ─────────────────────────────────────────────────────────────────────────────
const O = {
  navy:      '#0A2540',
  blue:      '#0F5FA6',
  blueMid:   '#1A7FD4',
  blueLight: '#E8F3FC',
  bluePale:  '#F0F7FF',
  teal:      '#0D8A72',
  tealLight: '#E6F5F2',
  red:       '#C0392B',
  redLight:  '#FDEDEB',
  amber:     '#D97706',
  amberLight:'#FEF3C7',
  green:     '#166534',
  greenLight:'#DCFCE7',
  muted:     '#5A6A7A',
  border:    '#E2E8F0',
  bg:        '#F8FAFC',
  white:     '#FFFFFF',
  grid:      '#F1F5F9',
}

const FONT = "'DM Sans', sans-serif"

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

function dateRangeToWeeksYears(startDate, endDate) {
  if (!startDate || !endDate) {
    const { week: cw, year: cy } = getISOWeek()
    const weeks = Array.from({ length: 6 }, (_, i) => { const w = cw - 5 + i; return w < 1 ? w + 52 : w })
    return { weeks, years: [cy - 1, cy] }
  }
  const start = new Date(startDate + 'T00:00:00')
  const end   = new Date(endDate   + 'T00:00:00')
  const weeksSet = new Set()
  const yearsSet = new Set()
  const cursor = new Date(start)
  while (cursor <= end) {
    const { week, year } = getISOWeek(cursor)
    weeksSet.add(week)
    yearsSet.add(year)
    cursor.setDate(cursor.getDate() + 1)
  }
  const weeks = Array.from(weeksSet).sort((a, b) => a - b)
  const years = Array.from(yearsSet).sort((a, b) => a - b)
  const minYear = years[0]
  if (!years.includes(minYear - 1)) years.unshift(minYear - 1)
  return { weeks, years }
}

const DEFAULT_WY = dateRangeToWeeksYears(null, null)

// ─────────────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────────────
function fmtNum(n) {
  if (n == null || isNaN(n)) return '—'
  const a = Math.abs(n), s = n < 0 ? '-' : ''
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`
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

// ─────────────────────────────────────────────────────────────────────────────
// Aggregation helpers
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
  const counts = {}, ttvs = {}
  for (const r of rows) {
    if (!weeks.includes(+r.iso_week)) continue
    if (!years.includes(+r.year))    continue
    const key = `${r.year}-${r.iso_week}`
    counts[key] = (counts[key] || 0) + (+r.booking_count || 0)
    ttvs[key]   = 0
  }
  return { counts, ttvs }
}

function aggregateByDestination(rows, { weeks, years }) {
  const dest = {}
  const curYear = years[years.length - 1]
  for (const r of rows) {
    if (!weeks.includes(+r.iso_week)) continue
    if (!years.includes(+r.year))    continue
    const code = r.dropoff_code
    if (!code || code === '?') continue
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
// Canvas chart primitives — updated to use Orbit colours
// ─────────────────────────────────────────────────────────────────────────────
const CHART_PAD = { left: 54, right: 16, top: 14, bottom: 28 }

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

  // Grid lines
  ctx.strokeStyle = O.grid; ctx.lineWidth = 0.8
  for (let i = 0; i <= 4; i++) {
    const y = PT + plotH - (i / 4) * plotH
    ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(PL + plotW, y); ctx.stroke()
    ctx.fillStyle = O.muted; ctx.font = `10px ${FONT}`; ctx.textAlign = 'right'
    ctx.fillText(yLabel(maxVal * i / 4), PL - 6, y + 3.5)
  }

  const groupW = plotW / n
  const barW   = Math.min(groupW * 0.34, 20)
  const gap    = 3

  for (let i = 0; i < n; i++) {
    const cx  = PL + i * groupW + groupW / 2
    const x25 = cx - barW - gap / 2
    const x26 = cx + gap / 2
    const isLast = i === n - 1

    // 2025 bar (prev year — muted grey)
    if (data2025[i] != null) {
      const bh = (data2025[i] / maxVal) * plotH
      ctx.globalAlpha = 0.55
      ctx.fillStyle = O.border
      ctx.beginPath()
      ctx.roundRect?.(x25, PT + plotH - bh, barW, bh, 2) || ctx.rect(x25, PT + plotH - bh, barW, bh)
      ctx.fill()
      ctx.globalAlpha = 1
    }

    // 2026 bar (current year — teal)
    if (data2026[i] != null) {
      const bh = (data2026[i] / maxVal) * plotH
      ctx.fillStyle = isLast ? O.blueMid : O.teal
      ctx.globalAlpha = isLast ? 0.75 : 1
      ctx.beginPath()
      ctx.roundRect?.(x26, PT + plotH - bh, barW, bh, 2) || ctx.rect(x26, PT + plotH - bh, barW, bh)
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }

  // X labels
  ctx.fillStyle = O.muted; ctx.font = `10px ${FONT}`; ctx.textAlign = 'center'
  weekLabels.forEach((lbl, i) => {
    ctx.fillText(lbl, PL + i * groupW + groupW / 2, PT + plotH + 18)
  })

  // Legend
  const legends = [
    { label: 'Prev Year', color: O.border },
    { label: 'This Year', color: O.teal },
  ]
  let lx = PL
  const ly = 10
  ctx.font = `10px ${FONT}`; ctx.textAlign = 'left'
  legends.forEach(({ label, color }) => {
    ctx.fillStyle = color
    ctx.beginPath(); ctx.roundRect?.(lx, ly - 7, 10, 7, 2) || ctx.rect(lx, ly - 7, 10, 7)
    ctx.fill()
    ctx.fillStyle = O.muted; ctx.fillText(label, lx + 13, ly)
    lx += ctx.measureText(label).width + 30
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
  ctx.strokeStyle = O.grid; ctx.lineWidth = 0.8
  for (let i = 0; i <= 4; i++) {
    const y = PT + plotH - (i / 4) * plotH
    ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(PL + plotW, y); ctx.stroke()
    ctx.fillStyle = O.muted; ctx.font = `10px ${FONT}`; ctx.textAlign = 'right'
    ctx.fillText(fmtPct(minVal + range * i / 4, 2), PL - 6, y + 3.5)
  }

  const groupW = plotW / Math.max(n - 1, 1)

  const drawLine = (data, color, dashed = false) => {
    const pts = data.map((v, i) => ({ x: PL + i * groupW, y: v != null ? toY(v) : null }))
    ctx.strokeStyle = color; ctx.lineWidth = 2
    if (dashed) ctx.setLineDash([5, 4])
    else ctx.setLineDash([])
    ctx.beginPath(); let started = false
    pts.forEach(p => {
      if (p.y == null) { started = false; return }
      if (!started) { ctx.moveTo(p.x, p.y); started = true } else ctx.lineTo(p.x, p.y)
    })
    ctx.stroke()
    ctx.setLineDash([])
    pts.forEach((p, i) => {
      if (p.y == null) return
      ctx.beginPath(); ctx.arc(p.x, p.y, i === data.length - 1 ? 4 : 3, 0, Math.PI * 2)
      ctx.fillStyle = color; ctx.fill()
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke()
    })
  }

  drawLine(data2025, O.border, true)
  drawLine(data2026, O.teal)

  ctx.fillStyle = O.muted; ctx.font = `10px ${FONT}`; ctx.textAlign = 'center'
  weekLabels.forEach((lbl, i) => ctx.fillText(lbl, PL + i * groupW, PT + plotH + 18))

  // Legend
  const ly = 10; let lx = PL
  ctx.font = `10px ${FONT}`; ctx.textAlign = 'left'
  ;[{ label: 'Prev Year', color: O.border, dashed: true }, { label: 'This Year', color: O.teal }].forEach(({ label, color, dashed }) => {
    ctx.strokeStyle = color; ctx.lineWidth = 1.5
    if (dashed) ctx.setLineDash([4, 3]); else ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(lx, ly - 3); ctx.lineTo(lx + 14, ly - 3); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = O.muted; ctx.fillText(label, lx + 17, ly)
    lx += ctx.measureText(label).width + 36
  })

  ctx.restore()
}

// ─────────────────────────────────────────────────────────────────────────────
// CanvasChart component
// ─────────────────────────────────────────────────────────────────────────────
function CanvasChart({ drawFn, drawArgs, title, subtitle, height = 200, tooltipFn }) {
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
  })

  const handleMouseMove = useCallback(e => {
    if (!tooltipFn || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const content = tooltipFn(x, canvasRef.current.offsetWidth)
    if (content && tooltipRef.current) {
      tooltipRef.current.style.display = 'block'
      tooltipRef.current.style.left = `${Math.min(x + 12, rect.width - 170)}px`
      tooltipRef.current.style.top  = '28px'
      tooltipRef.current.innerHTML  = content
    }
  }, [tooltipFn])

  const handleMouseLeave = useCallback(() => {
    if (tooltipRef.current) tooltipRef.current.style.display = 'none'
  }, [])

  return (
    <div style={{ background: O.white, border: `1px solid ${O.border}`, borderRadius: 12, overflow: 'hidden', position: 'relative', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
      {(title || subtitle) && (
        <div style={{ padding: '14px 18px 10px', borderBottom: `1px solid ${O.grid}` }}>
          {title   && <div style={{ fontSize: 12, fontWeight: 700, color: O.navy }}>{title}</div>}
          {subtitle && <div style={{ fontSize: 11, color: O.muted, marginTop: 2 }}>{subtitle}</div>}
        </div>
      )}
      <div style={{ padding: '12px 8px 6px', position: 'relative' }}>
        <canvas ref={canvasRef} style={{ width: '100%', display: 'block' }}
          onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} />
        <div ref={tooltipRef} style={{
          display: 'none', position: 'absolute', background: O.navy, color: '#fff',
          borderRadius: 8, padding: '10px 14px', fontSize: 11, lineHeight: 1.7,
          pointerEvents: 'none', zIndex: 10, minWidth: 160, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        }} />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Orbit-style KPI Card
// ─────────────────────────────────────────────────────────────────────────────
function KpiCard({ label, val26, val25, yoy, format = 'number', isPP = false, curYear, prevYear }) {
  const fmt = format === 'currency' ? fmtUSD : format === 'pct' ? v => fmtPct(v, 2) : fmtNum

  const hasDelta = yoy != null && !isNaN(yoy)
  const deltaUp  = yoy >= 0
  const sign     = yoy >= 0 ? '+' : ''
  const deltaText = isPP
    ? `${sign}${yoy?.toFixed(2)}pp`
    : hasDelta ? `${sign}${yoy?.toFixed(1)}%` : null

  const badgeColor = !hasDelta ? O.muted : deltaUp ? O.green : O.red
  const badgeBg    = !hasDelta ? O.bg    : deltaUp ? O.greenLight : O.redLight
  const arrow      = !hasDelta ? '' : deltaUp ? '▲' : '▼'

  return (
    <div style={{
      background: O.white, border: `1px solid ${O.border}`, borderRadius: 12,
      padding: '20px 22px', boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)',
      display: 'flex', flexDirection: 'column', minWidth: 0,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: O.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: O.navy, letterSpacing: '-0.5px', lineHeight: 1, marginBottom: 12 }}>
        {fmt(val26)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {deltaText && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600,
            background: badgeBg, color: badgeColor,
          }}>
            {arrow} {deltaText}
          </span>
        )}
        <span style={{ fontSize: 11, color: O.muted }}>
          {prevYear}: <span style={{ fontWeight: 600, color: O.muted }}>{fmt(val25)}</span>
        </span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Funnel section — Orbit-styled
// ─────────────────────────────────────────────────────────────────────────────
const FUNNEL_STEPS = [
  { key: 'view_search_results', label: 'Searches', step: 1 },
  { key: 'begin_checkout',      label: 'Vehicle Select', step: 2 },
  { key: 'checkout',            label: 'Payment Form', step: 3 },
  { key: 'purchase',            label: 'Bookings', step: 4 },
]

function FunnelSection({ funnelData, weeks, selectedWeek, onWeekChange }) {
  if (!funnelData) return (
    <div style={{ background: O.white, border: `1px solid ${O.border}`, borderRadius: 12, padding: 32, textAlign: 'center', color: O.muted, fontSize: 13, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
      No funnel data for this selection
    </div>
  )

  const { steps, curYear, prevYear } = funnelData
  const allCounts = FUNNEL_STEPS.flatMap(s => [steps[s.key]?.[curYear] || 0, steps[s.key]?.[prevYear] || 0])
  const maxCount  = Math.max(...allCounts, 1)
  const s2bCur  = (steps.view_search_results[curYear]  || 0) > 0 ? (steps.purchase[curYear]  / steps.view_search_results[curYear]  * 100) : 0
  const s2bPrev = (steps.view_search_results[prevYear] || 0) > 0 ? (steps.purchase[prevYear] / steps.view_search_results[prevYear] * 100) : 0
  const s2bDelta = s2bCur - s2bPrev

  return (
    <div style={{ background: O.white, border: `1px solid ${O.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
      <div style={{ padding: '14px 20px', borderBottom: `1px solid ${O.grid}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: O.navy }}>Booking Funnel</div>
          <div style={{ fontSize: 11, color: O.muted, marginTop: 2 }}>W{weeks[0]}–W{weeks[weeks.length-1]} · {curYear} vs {prevYear}</div>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: O.muted, marginRight: 4 }}>Week</span>
          {[null, ...weeks].map(w => {
            const active = selectedWeek === w
            return (
              <button key={w ?? 'all'} onClick={() => onWeekChange(w)} style={{
                padding: '3px 9px', fontSize: 11, fontWeight: 600, borderRadius: 6,
                border: `1px solid ${active ? O.blue : O.border}`,
                background: active ? O.blue : 'transparent',
                color: active ? '#fff' : O.muted,
                cursor: 'pointer', fontFamily: FONT, transition: 'all 0.12s',
              }}>{w === null ? 'All' : `W${w}`}</button>
            )
          })}
        </div>
      </div>
      <div style={{ padding: '16px 20px' }}>
        {FUNNEL_STEPS.map((step, idx) => {
          const cur  = steps[step.key]?.[curYear]  || 0
          const prev = steps[step.key]?.[prevYear] || 0
          const deltaPct = prev > 0 ? ((cur - prev) / prev * 100) : 0
          const up = deltaPct >= 0
          let dropCur = null
          if (idx < FUNNEL_STEPS.length - 1) {
            const nk = FUNNEL_STEPS[idx + 1].key
            const nc = steps[nk]?.[curYear] || 0
            dropCur = cur > 0 ? ((cur - nc) / cur * 100) : null
          }
          return (
            <div key={step.key} style={{ marginBottom: idx < FUNNEL_STEPS.length - 1 ? 16 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', background: O.bluePale, color: O.blue, fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {step.step}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: O.navy }}>{step.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: O.navy }}>{fmtNum(cur)}</span>
                  {prev > 0 && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                      background: up ? O.greenLight : O.redLight,
                      color: up ? O.green : O.red,
                    }}>
                      {up ? '▲' : '▼'} {Math.abs(deltaPct).toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
              {/* Bar pair */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 36, fontSize: 10, color: O.muted, textAlign: 'right', flexShrink: 0 }}>{prevYear}</span>
                  <div style={{ flex: 1, height: 10, background: O.bg, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${(prev / maxCount) * 100}%`, height: '100%', background: O.border, borderRadius: 4 }} />
                  </div>
                  <span style={{ width: 52, fontSize: 10, color: O.muted, textAlign: 'right', flexShrink: 0 }}>{fmtNum(prev)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 36, fontSize: 10, fontWeight: 600, color: O.navy, textAlign: 'right', flexShrink: 0 }}>{curYear}</span>
                  <div style={{ flex: 1, height: 10, background: O.bg, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${(cur / maxCount) * 100}%`, height: '100%', background: O.teal, borderRadius: 4 }} />
                  </div>
                  <span style={{ width: 52, fontSize: 10, fontWeight: 700, color: O.navy, textAlign: 'right', flexShrink: 0 }}>{fmtNum(cur)}</span>
                </div>
              </div>
              {/* Drop-off arrow */}
              {dropCur !== null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, padding: '4px 10px', background: O.bg, borderRadius: 6 }}>
                  <span style={{ color: O.muted, fontSize: 10 }}>↓ Drop-off:</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: dropCur > 50 ? O.red : O.amber }}>{dropCur.toFixed(1)}%</span>
                </div>
              )}
            </div>
          )
        })}

        {/* S2B summary */}
        <div style={{ marginTop: 18, padding: '12px 16px', background: O.bg, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: O.navy }}>Search → Book Rate</span>
          <span style={{ fontSize: 12, color: O.muted }}>{prevYear}: <strong style={{ color: O.navy }}>{fmtPct(s2bPrev)}</strong></span>
          <span style={{ fontSize: 12, color: O.navy }}>{curYear}: <strong>{fmtPct(s2bCur)}</strong></span>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
            background: s2bDelta >= 0 ? O.greenLight : O.redLight,
            color: s2bDelta >= 0 ? O.green : O.red,
          }}>
            {s2bDelta >= 0 ? '+' : ''}{s2bDelta.toFixed(2)}pp
          </span>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes Table — Orbit-styled
// ─────────────────────────────────────────────────────────────────────────────
function RoutesTable({ destData, airportMap, weeks, curYear, prevYear, selectedWeek, onWeekChange, onSelectDest, originName }) {
  const CY = curYear  || new Date().getFullYear()
  const PY = prevYear || CY - 1
  if (!destData) return null

  const rows = Object.entries(destData)
    .map(([code, { b2026, b2025 }]) => {
      const isIATA = /^[A-Z0-9]{2,4}$/.test(code)
      const name = isIATA ? (airportMap[code] || code) : code
      const displayCode = isIATA ? code : '—'
      return {
        code, name, displayCode, b2026, b2025,
        yoyPct: b2025 > 0 ? ((b2026 - b2025) / b2025 * 100) : null,
        yoyDelta: b2026 - b2025,
      }
    })
    .filter(r => r.b2026 > 0 || r.b2025 > 0)
    .sort((a, b) => b.b2026 - a.b2026)
    .slice(0, 25)

  const thStyle = {
    padding: '10px 14px', fontSize: 11, fontWeight: 600, color: O.muted,
    textTransform: 'uppercase', letterSpacing: '0.05em',
    borderBottom: `2px solid ${O.border}`, background: O.bg,
    whiteSpace: 'nowrap', userSelect: 'none',
  }

  return (
    <div style={{ background: O.white, border: `1px solid ${O.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
      <div style={{ padding: '14px 20px', borderBottom: `1px solid ${O.grid}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: O.navy }}>Top Routes from {originName || '—'}</div>
          <div style={{ fontSize: 11, color: O.muted, marginTop: 2 }}>Click a row to drill into that route · W{weeks[0]}–W{weeks[weeks.length-1]} {CY}</div>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: O.muted, marginRight: 4 }}>Week</span>
          {[null, ...weeks].map(w => {
            const active = selectedWeek === w
            return (
              <button key={w ?? 'all'} onClick={() => onWeekChange(w)} style={{
                padding: '3px 9px', fontSize: 11, fontWeight: 600, borderRadius: 6,
                border: `1px solid ${active ? O.blue : O.border}`,
                background: active ? O.blue : 'transparent',
                color: active ? '#fff' : O.muted,
                cursor: 'pointer', fontFamily: FONT, transition: 'all 0.12s',
              }}>{w === null ? 'All' : `W${w}`}</button>
            )
          })}
        </div>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: O.muted, fontSize: 13 }}>No destination data available.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: 'left' }}>Destination</th>
                <th style={{ ...thStyle, textAlign: 'left' }}>Code</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>W{weeks[0]}–W{weeks[weeks.length-1]} {CY}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>W{weeks[0]}–W{weeks[weeks.length-1]} {PY}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>YoY %</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>YoY Δ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const up = r.yoyPct >= 0
                return (
                  <tr key={r.code}
                    onClick={() => onSelectDest(r.code)}
                    style={{ borderBottom: `1px solid ${O.grid}`, background: i % 2 === 0 ? '#fff' : O.bg, cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = O.bluePale}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#fff' : O.bg}
                  >
                    <td style={{ padding: '9px 14px', fontSize: 12, color: O.navy, fontWeight: 500 }}>{r.name}</td>
                    <td style={{ padding: '9px 14px', fontSize: 11, color: O.muted, fontFamily: 'monospace' }}>{r.displayCode}</td>
                    <td style={{ padding: '9px 14px', fontSize: 12, color: O.teal, fontWeight: 700, textAlign: 'right' }}>{Math.round(r.b2026).toLocaleString()}</td>
                    <td style={{ padding: '9px 14px', fontSize: 12, color: O.muted, textAlign: 'right' }}>{Math.round(r.b2025).toLocaleString()}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right' }}>
                      {r.yoyPct != null ? (
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                          background: up ? O.greenLight : O.redLight,
                          color: up ? O.green : O.red,
                        }}>
                          {up ? '▲' : '▼'} {Math.abs(r.yoyPct).toFixed(1)}%
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '9px 14px', fontSize: 12, fontWeight: 600, color: r.yoyDelta >= 0 ? O.teal : O.red, textAlign: 'right' }}>
                      {r.yoyDelta >= 0 ? '+' : ''}{Math.round(r.yoyDelta).toLocaleString()}
                    </td>
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
// AirportList sidebar — Orbit-styled
// ─────────────────────────────────────────────────────────────────────────────
function AirportList({ airports, selected, onSelect, searchPlaceholder = 'Search...', topItem = null, query = '', onQueryChange }) {
  const filtered = airports.filter(a =>
    !query || a.name.toLowerCase().includes(query.toLowerCase()) || a.code.toLowerCase().includes(query.toLowerCase())
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${O.border}` }}>
        <div style={{ position: 'relative' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={O.muted} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            value={query}
            onChange={e => onQueryChange && onQueryChange(e.target.value)}
            placeholder={searchPlaceholder}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '7px 10px 7px 28px',
              fontSize: 12, border: `1px solid ${O.border}`, borderRadius: 8,
              outline: 'none', fontFamily: FONT, color: O.navy, background: O.bg,
              transition: 'border-color 0.15s',
            }}
            onFocus={e => e.target.style.borderColor = O.blueMid}
            onBlur={e => e.target.style.borderColor = O.border}
          />
        </div>
      </div>
      <div className="da-scroll" style={{ flex: 1, overflowY: 'auto' }}>
        {topItem && (
          <div onClick={() => onSelect(topItem.code)} style={{
            padding: '9px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderLeft: selected === topItem.code ? `3px solid ${O.teal}` : '3px solid transparent',
            background: selected === topItem.code ? O.tealLight : 'transparent',
            borderBottom: `1px solid ${O.border}`,
            transition: 'background 0.1s',
          }}
            onMouseEnter={e => { if (selected !== topItem.code) e.currentTarget.style.background = O.bg }}
            onMouseLeave={e => { if (selected !== topItem.code) e.currentTarget.style.background = 'transparent' }}
          >
            <span style={{ fontSize: 12, color: selected === topItem.code ? O.teal : O.navy, fontWeight: 600 }}>{topItem.name}</span>
          </div>
        )}
        {filtered.map(a => (
          <div key={a.code} onClick={() => onSelect(a.code)} style={{
            padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderLeft: selected === a.code ? `3px solid ${O.teal}` : '3px solid transparent',
            background: selected === a.code ? O.tealLight : 'transparent',
            transition: 'background 0.1s',
          }}
            onMouseEnter={e => { if (selected !== a.code) e.currentTarget.style.background = O.bg }}
            onMouseLeave={e => { if (selected !== a.code) e.currentTarget.style.background = 'transparent' }}
          >
            <span style={{
              fontSize: 12, color: selected === a.code ? O.teal : O.navy,
              fontWeight: selected === a.code ? 600 : 400,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160,
            }}>
              {a.name}
            </span>
            <span style={{ fontSize: 10, color: O.muted, fontFamily: 'monospace', marginLeft: 6, flexShrink: 0 }}>
              {a.displayCode ?? a.code}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter Pill button — Orbit-style
// ─────────────────────────────────────────────────────────────────────────────
function FilterPill({ label, active, onClick, color = O.blue }) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 12px', fontSize: 11, fontWeight: active ? 700 : 500, borderRadius: 20,
      border: `1.5px solid ${active ? color : O.border}`,
      background: active ? color : '#fff',
      color: active ? '#fff' : O.muted,
      cursor: 'pointer', fontFamily: FONT, transition: 'all 0.12s', whiteSpace: 'nowrap',
      boxShadow: active ? `0 2px 6px ${color}30` : 'none',
    }}>{label}</button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function DestinationAnalysis() {
  // ── Inject scrollbar style once ────────────────────────────────────────────
  useEffect(() => {
    if (!document.getElementById('da-scrollbar-style')) {
      const s = document.createElement('style')
      s.id = 'da-scrollbar-style'
      s.textContent = `.da-scroll::-webkit-scrollbar{width:5px}.da-scroll::-webkit-scrollbar-track{background:transparent}.da-scroll::-webkit-scrollbar-thumb{background:${O.border};border-radius:4px}.da-scroll::-webkit-scrollbar-thumb:hover{background:#c5d0dc}`
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
  const [pickupQuery,  setPickupQuery]  = useState('')
  const [dropoffQuery, setDropoffQuery] = useState('')

  const handleTabSwitch = (tab) => {
    setSidebarTab(tab)
    if (tab === 'pickup') setDropoffQuery('')
    else                  setPickupQuery('')
  }

  const handleDestSelect = (code) => {
    setDest(code)
    setDropoffQuery('')
    if (code !== '__all__') setSidebarTab('pickup')
  }

  const handleOriginSelect = (code) => {
    setOrigin(code)
    setPickupQuery('')
    setSidebarTab('dropoff')
  }

  // ── Date range → ISO weeks/years ───────────────────────────────────────────
  const { filters } = useFilters()
  const primaryRange    = filters?.dateRanges?.primary
  const comparisonRange = filters?.dateRanges?.comparison

  const { weeks: primaryWeeks, years: primaryYears } = useMemo(
    () => dateRangeToWeeksYears(primaryRange?.startDate, primaryRange?.endDate),
    [primaryRange?.startDate, primaryRange?.endDate]
  )
  const { weeks: compWeeks, years: compYears } = useMemo(
    () => comparisonRange
      ? dateRangeToWeeksYears(comparisonRange.startDate, comparisonRange.endDate)
      : { weeks: primaryWeeks, years: [primaryYears[0] - 1] },
    [comparisonRange?.startDate, comparisonRange?.endDate, primaryWeeks, primaryYears]
  )

  const curYear  = primaryYears[primaryYears.length - 1]
  const prevYear = curYear - 1
  const lastWeek = primaryWeeks[primaryWeeks.length - 1]
  const weeks    = primaryWeeks
  const years    = useMemo(() => [prevYear, curYear], [prevYear, curYear])

  // ── Data ───────────────────────────────────────────────────────────────────
  const [airports,       setAirports]       = useState([])
  const [airportMap,     setAirportMap]     = useState({})
  const [searchRows,     setSearchRows]     = useState([])
  const [bookingRows,    setBookingRows]    = useState([])
  const [funnelRows,     setFunnelRows]     = useState([])
  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState(null)
  const [readyToFetch,   setReadyToFetch]   = useState(false)
  const [sidebarRows,    setSidebarRows]    = useState([])
  const [sidebarLoading, setSidebarLoading] = useState(false)

  // ── Fetch airports ─────────────────────────────────────────────────────────
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
        const list = rawList
          .filter(a => {
            const n = a.name
            if (!n || typeof n !== 'string') return false
            const trimmed = n.trim()
            if (trimmed.length < 4) return false
            if (!isNaN(Number(trimmed))) return false
            if (/^[?]+$/.test(trimmed)) return false
            if (!/[A-Za-z]/.test(trimmed)) return false
            return true
          })
          .map(a => ({ ...a, name: cleanAirportName(a.code, a.name) }))
        setAirports(list)
        const map = {}
        list.forEach(a => { map[a.code] = a.name })
        setAirportMap(map)
      } catch (e) {
        console.error('[DA] airports error:', e.message)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // ── Fetch sidebar destinations ─────────────────────────────────────────────
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

  useEffect(() => {
    fetchSidebarDests(origin)
  }, [origin, fetchSidebarDests])

  // ── Main fetch ─────────────────────────────────────────────────────────────
  const fetchMain = useCallback(async () => {
    setLoading(true)
    setError(null)
    const normDestName = (s) => s.trim().toLowerCase()
      .replace(/['']/g, '').replace(/ç/g,'c').replace(/[úù]/g,'u')
      .replace(/[óò]/g,'o').replace(/[àâ]/g,'a').replace(/[èê]/g,'e')
      .replace(/[íî]/g,'i').replace(/ï/g,'i').replace(/ñ/g,'n')
      .replace(/[áä]/g,'a').replace(/[éë]/g,'e').replace(/ü/g,'u')
      .replace(/&/g,'and').replace(/,/g,'').replace(/-/g,' ')
      .replace(/\s+/g,' ').trim()
    const isIATAAirport = destination && /^[A-Z]{3}$/.test(destination)
    const dropoffZoneCode = destination
      ? (isIATAAirport ? destination : (zoneMap.normToCode[normDestName(destination)] || destination))
      : undefined
    const dropoffName = destination && destination !== '__all__'
      ? (isIATAAirport ? (airportMap[destination] || destination) : (zoneMap.codeToName?.[destination] || destination))
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
    if (!readyToFetch) return
    fetchMain()
  }, [fetchMain, readyToFetch])

  // ── Handlers ───────────────────────────────────────────────────────────────
  const setOrigin = useCallback(code => {
    setOriginState(code); setDestState('__all__'); setWeek(null)
    setReadyToFetch(false); setSearchRows([]); setBookingRows([]); setFunnelRows([]); setError(null)
  }, [])
  const setDest = useCallback(code => { setDestState(code); setReadyToFetch(true) }, [])
  const setDevice = useCallback(d => { setDeviceState(d); if (d !== 'all') { setVehicleState('all'); setCohortState('all') } }, [])
  const setVehicle = useCallback(v => { setVehicleState(v); if (v !== 'all') { setDeviceState('all'); setCohortState('all') } }, [])
  const setCohort = useCallback(c => { setCohortState(c); if (c !== 'all') { setDeviceState('all'); setVehicleState('all') } }, [])

  // ── Derived aggregations ───────────────────────────────────────────────────
  const searchByWkYr = useMemo(() => aggregateSearches(searchRows, { channel, device, weeks, years }), [searchRows, channel, device, weeks, years])
  const { counts: bookByWkYr, ttvs: ttvByWkYr } = useMemo(() => aggregateBookings(bookingRows, { weeks, years }), [bookingRows, weeks, years])

  const sv = (yr, wk) => searchByWkYr[`${yr}-${wk}`] || 0
  const bv = (yr, wk) => bookByWkYr[`${yr}-${wk}`]   || 0
  const tv = (yr, wk) => ttvByWkYr[`${yr}-${wk}`]    || 0

  const sSum26 = useMemo(() => primaryWeeks.reduce((a, w) => a + sv(curYear,  w), 0), [searchByWkYr, primaryWeeks, curYear])
  const sSum25 = useMemo(() => primaryWeeks.reduce((a, w) => a + sv(prevYear, w), 0), [searchByWkYr, primaryWeeks, prevYear])
  const bSum26 = useMemo(() => primaryWeeks.reduce((a, w) => a + bv(curYear,  w), 0), [bookByWkYr,   primaryWeeks, curYear])
  const bSum25 = useMemo(() => primaryWeeks.reduce((a, w) => a + bv(prevYear, w), 0), [bookByWkYr,   primaryWeeks, prevYear])
  const tSum26 = useMemo(() => primaryWeeks.reduce((a, w) => a + tv(curYear,  w), 0), [ttvByWkYr,    primaryWeeks, curYear])
  const tSum25 = useMemo(() => primaryWeeks.reduce((a, w) => a + tv(prevYear, w), 0), [ttvByWkYr,    primaryWeeks, prevYear])

  const aSum26 = bSum26 > 0 ? tSum26 / bSum26 : null
  const aSum25 = bSum25 > 0 ? tSum25 / bSum25 : null
  const s2bSum26 = sSum26 > 0 ? bSum26 / sSum26 * 100 : null
  const s2bSum25 = sSum25 > 0 ? bSum25 / sSum25 * 100 : null

  const wYoY  = (a, b) => b > 0 ? (a - b) / b * 100 : null
  const ppDiff = (a, b) => (a != null && b != null) ? a - b : null

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

  const sidebarDestAgg = useMemo(() =>
    aggregateByDestination(sidebarRows, { weeks, years }),
  [sidebarRows, weeks, years])

  const dropoffAirports = useMemo(() => {
    const normZoneName = (s) => s.trim().toLowerCase()
      .replace(/['']/g, '').replace(/ç/g,'c').replace(/[úù]/g,'u')
      .replace(/[óò]/g,'o').replace(/[àâ]/g,'a').replace(/[èê]/g,'e')
      .replace(/[íî]/g,'i').replace(/ï/g,'i').replace(/ñ/g,'n')
      .replace(/[áä]/g,'a').replace(/[éë]/g,'e').replace(/ü/g,'u')
      .replace(/&/g,'and').replace(/,/g,'').replace(/-/g,' ')
      .replace(/\s+/g,' ').trim()
    const getZoneCode = (zoneName) => (zoneMap.normToCode)[normZoneName(zoneName)] || null
    return Object.entries(sidebarDestAgg)
      .filter(([, { b2026, b2025 }]) => b2026 + b2025 > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, { name }]) => {
        const isIATAAirport = /^[A-Z]{3}$/.test(code) && airportMap[code]
        if (isIATAAirport) return { code, displayCode: code, name: airportMap[code] || name || code }
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
    const up = diff >= 0
    return `<div style="font-size:11px;font-weight:700;margin-bottom:5px;color:#94A3B8">W${w}</div>
      <div style="margin-bottom:2px">${curYear}: <b style="color:#fff">${Math.round(v26).toLocaleString()}</b></div>
      <div style="margin-bottom:4px;color:#94A3B8">${prevYear}: ${Math.round(v25).toLocaleString()}</div>
      <div style="color:${up ? '#4ADE80' : '#F87171'}">${up ? '▲' : '▼'} ${Math.abs(+diff).toLocaleString()} (${pct}%)</div>`
  }, [weeks, curYear, prevYear])

  const s2bTooltipFn = useCallback((mouseX, canvasW) => {
    const plotW = canvasW - CHART_PAD.left - CHART_PAD.right
    const groupW = plotW / Math.max(weeks.length - 1, 1)
    const idx = Math.min(Math.max(Math.round((mouseX - CHART_PAD.left) / groupW), 0), weeks.length - 1)
    const w = weeks[idx], v25 = c25[idx], v26 = c26[idx]
    const diff = v26 != null && v25 != null ? v26 - v25 : null
    const up = diff >= 0
    return `<div style="font-size:11px;font-weight:700;margin-bottom:5px;color:#94A3B8">W${w}</div>
      <div style="margin-bottom:2px">${curYear}: <b style="color:#fff">${v26 != null ? fmtPct(v26) : '—'}</b></div>
      <div style="margin-bottom:4px;color:#94A3B8">${prevYear}: ${v25 != null ? fmtPct(v25) : '—'}</div>
      ${diff != null ? `<div style="color:${up ? '#4ADE80' : '#F87171'}">${up ? '▲' : '▼'} ${Math.abs(diff).toFixed(2)}pp</div>` : ''}`
  }, [weeks, c25, c26, curYear, prevYear])

  const originName = airportMap[origin] || origin
  const destName   = destination === '__all__' ? 'All destinations' : (airportMap[destination] || destination)
  const showNotice = vehicle !== 'all' || cohort !== 'all'

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: FONT, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, background: O.bg, color: O.navy }}>

      {/* ── DA filter bar — single row ── */}
      <div style={{
        background: O.white, borderBottom: `1px solid ${O.border}`,
        padding: '20px 24px 10px', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 8,
        overflowX: 'auto', flexWrap: 'nowrap',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: O.muted, whiteSpace: 'nowrap' }}>Channel</span>
        {[{ key: 'all', label: 'All channels' }, { key: 'search', label: 'Search' }, { key: 'email', label: 'Email' }, { key: 'affiliates', label: 'Affiliates' }, { key: 'direct', label: 'Direct' }, { key: 'other', label: 'Other' }].map(({ key, label }) => (
          <FilterPill key={key} label={label} active={channel === key} onClick={() => setChannel(key)} color={O.teal} />
        ))}
        <div style={{ width: 1, height: 18, background: O.border, flexShrink: 0, margin: '0 4px' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: O.muted, whiteSpace: 'nowrap' }}>Device</span>
        {[{ key: 'all', label: 'All' }, { key: 'mobile', label: 'Mobile' }, { key: 'desktop', label: 'Desktop' }, { key: 'tablet', label: 'Tablet' }].map(({ key, label }) => (
          <FilterPill key={key} label={label} active={device === key} onClick={() => setDevice(key)} />
        ))}
        <div style={{ width: 1, height: 18, background: O.border, flexShrink: 0, margin: '0 4px' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: O.muted, whiteSpace: 'nowrap' }}>Vehicle</span>
        {[{ key: 'all', label: 'All' }, { key: 'private', label: 'Private' }, { key: 'shuttle', label: 'Shuttle' }, { key: 'minibus', label: 'Mini Bus' }].map(({ key, label }) => (
          <FilterPill key={key} label={label} active={vehicle === key} onClick={() => setVehicle(key)} />
        ))}
        <div style={{ width: 1, height: 18, background: O.border, flexShrink: 0, margin: '0 4px' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: O.muted, whiteSpace: 'nowrap' }}>Cohort</span>
        {[{ key: 'all', label: 'All' }, { key: 'solo', label: 'Solo' }, { key: 'couple', label: 'Couple' }, { key: 'adult_group', label: 'Adult Group' }, { key: 'family', label: 'Family' }].map(({ key, label }) => (
          <FilterPill key={key} label={label} active={cohort === key} onClick={() => setCohort(key)} />
        ))}
      </div>



      {/* Notice banner */}
      {showNotice && (
        <div style={{ background: O.amberLight, borderBottom: `1px solid #FCD34D`, padding: '8px 24px', fontSize: 11, color: O.amber, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={O.amber} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>Vehicle &amp; Cohort filters apply to <b>Bookings only</b> — GA4 search events do not carry vehicle or cohort data.</span>
        </div>
      )}

      {/* ── Body: sidebar + main panel ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Sidebar */}
        <div style={{ width: 268, flexShrink: 0, borderRight: `1px solid ${O.border}`, display: 'flex', flexDirection: 'column', background: O.white }}>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${O.border}` }}>
            {[['pickup', 'Pick-Up'], ['dropoff', 'Drop-Off']].map(([tab, label]) => (
              <button key={tab} onClick={() => handleTabSwitch(tab)} style={{
                flex: 1, padding: '11px 0', fontSize: 11, fontWeight: 700, border: 'none', background: 'transparent',
                fontFamily: FONT, cursor: 'pointer', letterSpacing: '0.04em',
                color: sidebarTab === tab ? O.teal : O.muted,
                borderBottom: sidebarTab === tab ? `2px solid ${O.teal}` : '2px solid transparent',
                transition: 'all 0.15s',
              }}>{label}</button>
            ))}
          </div>

          {/* Airport list */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {sidebarTab === 'pickup' ? (
              <AirportList
                airports={[...airports].sort((a, b) => a.name.localeCompare(b.name))}
                selected={origin}
                onSelect={handleOriginSelect}
                searchPlaceholder="Search origins…"
                query={pickupQuery}
                onQueryChange={setPickupQuery}
              />
            ) : sidebarLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 10, color: O.muted }}>
                <div style={{ width: 24, height: 24, border: `2px solid ${O.border}`, borderTopColor: O.teal, borderRadius: '50%', animation: 'da-spin 0.8s linear infinite' }} />
                <span style={{ fontSize: 12 }}>Loading destinations…</span>
              </div>
            ) : (
              <AirportList
                airports={[...dropoffAirports].sort((a, b) => a.name.localeCompare(b.name))}
                selected={destination}
                onSelect={handleDestSelect}
                searchPlaceholder="Search destinations…"
                topItem={{ code: '__all__', name: 'All destinations' }}
                query={dropoffQuery}
                onQueryChange={setDropoffQuery}
              />
            )}
          </div>

          {/* Selected Route pill */}
          <div style={{ padding: '12px 16px', borderTop: `1px solid ${O.border}`, background: O.bg }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: O.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Selected Route</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                background: O.tealLight, color: O.teal,
                padding: '3px 10px', borderRadius: 8, fontSize: 14, fontWeight: 700, fontFamily: 'monospace',
                border: `1px solid ${O.teal}30`,
              }}>
                {origin}
              </span>
              <span style={{ color: O.muted, fontSize: 16 }}>→</span>
              <span style={{
                background: destination === '__all__' ? O.bg : O.tealLight,
                color: destination === '__all__' ? O.muted : O.teal,
                padding: '3px 10px', borderRadius: 8, fontSize: 14, fontWeight: 700, fontFamily: 'monospace',
                border: `1px solid ${destination === '__all__' ? O.border : O.teal + '30'}`,
              }}>
                {destination === '__all__' ? 'ALL' : destination}
              </span>
            </div>
          </div>
        </div>

        {/* Main panel */}
        <div className="da-scroll" style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', position: 'relative' }}>
          <style>{`@keyframes da-spin{to{transform:rotate(360deg)}} @keyframes da-fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}`}</style>

          {/* Loading overlay */}
          {loading && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(248,250,252,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20, flexDirection: 'column', gap: 14, backdropFilter: 'blur(2px)' }}>
              <div style={{ width: 36, height: 36, border: `3px solid ${O.border}`, borderTopColor: O.teal, borderRadius: '50%', animation: 'da-spin 0.8s linear infinite' }} />
              <div style={{ fontSize: 13, color: O.muted, fontWeight: 500 }}>Loading route data…</div>
            </div>
          )}

          {/* ── Empty / prompt state ── */}
          {!readyToFetch && !loading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 480, gap: 20, textAlign: 'center', animation: 'da-fade 0.3s ease' }}>
              <div style={{
                width: 80, height: 80, borderRadius: '50%', background: O.tealLight,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36,
              }}>
                ✈️
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: O.navy, marginBottom: 8 }}>Select a destination</div>
                <div style={{ fontSize: 13, color: O.muted, maxWidth: 340, lineHeight: 1.7 }}>
                  You've picked <strong style={{ color: O.teal }}>{airportMap[origin] || origin}</strong> as your origin.
                  Switch to the <strong>Drop-Off</strong> tab to choose a destination and load the dashboard.
                </div>
              </div>
              <button
                onClick={() => { setSidebarTab('dropoff'); setDropoffQuery('') }}
                style={{
                  background: O.teal, color: '#fff', border: 'none', borderRadius: 10,
                  padding: '11px 28px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 8,
                  boxShadow: '0 4px 14px rgba(13,138,114,0.25)', transition: 'transform 0.15s, box-shadow 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(13,138,114,0.35)' }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(13,138,114,0.25)' }}
              >
                Go to Drop-Off tab →
              </button>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div style={{ background: O.redLight, border: `1px solid ${O.red}`, borderRadius: 10, padding: '12px 18px', marginBottom: 16, fontSize: 12, color: O.red, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>⚠</span>
              <span style={{ flex: 1 }}>{error}</span>
              <button onClick={fetchMain} style={{ background: O.red, color: '#fff', border: 'none', borderRadius: 7, padding: '5px 12px', fontSize: 11, cursor: 'pointer', fontFamily: FONT, fontWeight: 600 }}>Retry</button>
            </div>
          )}

          {/* ── Dashboard content ── */}
          {readyToFetch && (
            <div style={{ animation: 'da-fade 0.25s ease' }}>

              {/* Route heading */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: O.navy }}>{originName}</span>
                    <span style={{ fontSize: 16, color: O.teal, fontWeight: 300 }}>→</span>
                    <span style={{ fontSize: 18, fontWeight: 700, color: destination === '__all__' ? O.muted : O.navy }}>{destName}</span>
                  </div>
                  <div style={{ fontSize: 12, color: O.muted, marginTop: 3 }}>
                    {channel === 'all' ? 'All channels' : channel} · GA4 · W{primaryWeeks[0]}–W{primaryWeeks[primaryWeeks.length-1]}&nbsp;
                    <span style={{ fontWeight: 600, color: O.navy }}>{curYear}</span> vs <span style={{ fontWeight: 600 }}>{prevYear}</span>
                  </div>
                </div>
              </div>

              {/* KPI Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 16 }}>
                <KpiCard label="Searches"    val26={sSum26} val25={sSum25} yoy={wYoY(sSum26, sSum25)} format="number"   curYear={curYear} prevYear={prevYear} />
                <KpiCard label="Bookings"    val26={bSum26} val25={bSum25} yoy={wYoY(bSum26, bSum25)} format="number"   curYear={curYear} prevYear={prevYear} />
                <KpiCard label="TTV (USD)"   val26={tSum26} val25={tSum25} yoy={wYoY(tSum26, tSum25)} format="currency" curYear={curYear} prevYear={prevYear} />
                <KpiCard label="Avg Sell"    val26={aSum26} val25={aSum25} yoy={wYoY(aSum26, aSum25)} format="currency" curYear={curYear} prevYear={prevYear} />
                <KpiCard label="Search→Book" val26={s2bSum26} val25={s2bSum25} yoy={ppDiff(s2bSum26, s2bSum25)} format="pct" isPP curYear={curYear} prevYear={prevYear} />
              </div>

              {/* Charts */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 16 }}>
                <CanvasChart
                  drawFn={drawBarChart}
                  drawArgs={[wkLabels, s25, s26, v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : Math.round(v)]}
                  title="Searches"
                  subtitle={`${channel !== 'all' ? channel : 'All channels'} · ${device !== 'all' ? device : 'All devices'} · ${curYear} vs ${prevYear}`}
                  height={200}
                  tooltipFn={barTooltipFn(s25, s26)}
                />
                <CanvasChart
                  drawFn={drawBarChart}
                  drawArgs={[wkLabels, b25, b26, v => Math.round(v).toString()]}
                  title="Bookings"
                  subtitle={`${vehicle !== 'all' ? vehicle : 'All vehicles'} · ${cohort !== 'all' ? cohort : 'All cohorts'}`}
                  height={200}
                  tooltipFn={barTooltipFn(b25, b26)}
                />
                <CanvasChart
                  drawFn={drawLineChart}
                  drawArgs={[wkLabels, c25, c26]}
                  title="Search → Book Rate"
                  subtitle={`${curYear} vs ${prevYear}`}
                  height={200}
                  tooltipFn={s2bTooltipFn}
                />
              </div>

              {/* Funnel + Routes Table */}
              <div style={{ display: 'grid', gridTemplateColumns: destination === '__all__' ? '1fr 1fr' : '1fr', gap: 14, marginBottom: 16 }}>
                <FunnelSection funnelData={funnelData} weeks={primaryWeeks} selectedWeek={week} onWeekChange={setWeek} />
                {destination === '__all__' && (
                  <RoutesTable
                    destData={destAgg}
                    airportMap={airportMap}
                    weeks={primaryWeeks}
                    curYear={curYear}
                    prevYear={prevYear}
                    selectedWeek={week}
                    onWeekChange={setWeek}
                    onSelectDest={code => setDest(code)}
                    originName={originName}
                  />
                )}
              </div>

              {/* Empty state after selection */}
              {!loading && !error && searchRows.length === 0 && bookingRows.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: O.muted }}>
                  <div style={{ fontSize: 36, marginBottom: 14 }}>📭</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: O.navy, marginBottom: 6 }}>No data for this selection</div>
                  <div style={{ fontSize: 12 }}>Try a different origin or extend your date range.</div>
                  <button onClick={fetchMain} style={{ marginTop: 16, background: O.teal, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 22px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>↻ Retry</button>
                </div>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  )
}
