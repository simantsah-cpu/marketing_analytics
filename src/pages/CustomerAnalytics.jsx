/**
 * CustomerAnalytics.jsx — Customer & Cohort Analytics
 * Elite UI redesign: Chart.js charts, proper layout grid, clean typography.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'

import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, PointElement,
  LineElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import { Bar } from 'react-chartjs-2'
import { supabase } from '../services/supabase'
import { useFilters } from '../context/FiltersContext'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler)

// ─── Design tokens — identical to LeadershipDashboard ────────────────────────
const T = {
  bg:       '#ffffff',
  bg2:      '#F8FAFC',
  bg3:      '#F1F5F9',
  bg4:      '#E2EAF0',
  text:     '#1A2B3C',
  text2:    '#374151',
  text3:    '#64748B',
  border:   '#E2EAF0',
  border2:  '#CBD5E1',
  green:    '#1D9E75',
  blue:     '#185FA5',
  red:      '#E24B4A',
  purple:   '#7F77DD',
  coral:    '#D85A30',
  teal:     '#0E8E8E',
  amber:    '#D97706',
  amberInk: '#92400E',
  navy:     '#1e3a5f',
  greenBg:  'rgba(29,158,117,.10)',
  blueBg:   'rgba(24,95,165,.09)',
  amberBg:  'rgba(217,119,6,.12)',
  redBg:    'rgba(226,75,74,.09)',
  lift:     '0 1px 3px rgba(0,0,0,.04), 0 4px 12px rgba(0,0,0,.06)',
  lift2:    '0 2px 8px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.08)',
}

// ─── Formatters ───────────────────────────────────────────────────────────────
const n = (v) => { const x = (v == null || v === '') ? NaN : Number(v); return isFinite(x) ? x : 0 }
// A8: null/undefined must never render as "$0". Check BEFORE calling n(), which coerces null→0.
const isDash = (v) => v === null || v === undefined
const usdC = (v) => { if (isDash(v)) return '—'; const x = n(v), a = Math.abs(x), s = x < 0 ? '-$' : '$'; if (a >= 1e6) return s+(a/1e6).toFixed(2)+'M'; if (a >= 1e3) return s+(a/1e3).toFixed(1)+'k'; return s+a.toFixed(0) }
const usd = (v, d = 0) => { if (isDash(v)) return '—'; const x = n(v), s = x < 0 ? '-$' : '$'; return s + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) }
const pct = (v, d = 1) => v == null || !isFinite(n(v)) ? '—' : n(v).toFixed(d) + '%'
const nfmt = (v) => isDash(v) ? '—' : Math.round(n(v)).toLocaleString('en-US')

// ─── Date picker presets ──────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().slice(0, 10)
const fmtD = (d) => format(d instanceof Date ? d : new Date(d + 'T00:00:00'), 'yyyy-MM-dd')

const PRESETS = [
  { group: 'Months',   value: 'last3m',  label: 'Last 3 months',  get: () => ({ s: fmtD(startOfMonth(subMonths(new Date(), 3))),  e: fmtD(endOfMonth(subMonths(new Date(), 1))) }) },
  { group: 'Months',   value: 'last6m',  label: 'Last 6 months',  get: () => ({ s: fmtD(startOfMonth(subMonths(new Date(), 6))),  e: fmtD(endOfMonth(subMonths(new Date(), 1))) }) },
  { group: 'Months',   value: 'last12m', label: 'Last 12 months', get: () => ({ s: fmtD(startOfMonth(subMonths(new Date(), 12))), e: fmtD(endOfMonth(subMonths(new Date(), 1))) }) },
  { group: 'Year',     value: 'ytd',     label: 'Year to date',   get: () => ({ s: fmtD(startOfYear(new Date())),                 e: todayStr() }) },
  { group: 'All time', value: 'alltime', label: 'All time',       get: () => ({ s: '2019-01-01',                                  e: todayStr() }) },
]
const PRESET_GROUPS = []
PRESETS.forEach(p => { const g = PRESET_GROUPS.find(g => g.label === p.group); if (g) g.items.push(p); else PRESET_GROUPS.push({ label: p.group, items: [p] }) })

function presetLabel(val, cStart, cEnd) {
  if (val === 'custom' && cStart && cEnd) {
    const s = new Date(cStart + 'T00:00:00'), e = new Date(cEnd + 'T00:00:00')
    return `${format(s, 'MMM d')} – ${format(e, 'MMM d yyyy')}`
  }
  return PRESETS.find(p => p.value === val)?.label ?? 'Select period'
}

// ─── Affiliates-style date picker ─────────────────────────────────────────────
function DatePicker({ preset, start, end, onApply }) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(start ?? '')
  const [to, setTo]     = useState(end   ?? '')
  const [err, setErr]   = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const pickPreset = p => { const r = p.get(); onApply(p.value, r.s, r.e); setOpen(false) }
  const applyCustom = () => {
    if (!from || !to) { setErr('Select both dates.'); return }
    if (from > to) { setErr('"From" must be before "To".'); return }
    if (to > todayStr()) { setErr('"To" cannot be in the future.'); return }
    setErr(''); onApply('custom', from, to); setOpen(false)
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
        border: `1px solid ${open ? T.blue : T.border2}`, borderRadius: 7,
        background: open ? T.blueBg : T.bg, color: open ? T.blue : T.text,
        fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        {presetLabel(preset, start, end)}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points={open ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 2000,
          width: 460, background: '#fff', border: `1px solid ${T.border}`,
          borderRadius: 12, boxShadow: T.lift2, display: 'flex', overflow: 'hidden',
        }}>
          <div style={{ width: 190, borderRight: `1px solid ${T.border}`, overflowY: 'auto', maxHeight: 320, padding: '8px 0' }}>
            {PRESET_GROUPS.map(g => (
              <div key={g.label}>
                <div style={{ padding: '8px 14px 3px', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', color: T.text3, textTransform: 'uppercase' }}>{g.label}</div>
                {g.items.map(p => {
                  const active = preset === p.value
                  return (
                    <button key={p.value} onClick={() => pickPreset(p)} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                      textAlign: 'left', padding: '7px 14px', border: 'none',
                      background: active ? T.blueBg : 'transparent', color: active ? T.blue : T.text,
                      fontSize: 13, fontWeight: active ? 600 : 400, fontFamily: 'inherit', cursor: 'pointer',
                    }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.bg3 }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
                      {p.label}{active && <span style={{ fontSize: 12 }}>✓</span>}
                    </button>
                  )
                })}
              </div>
            ))}
            <div style={{ padding: '8px 14px 3px', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', color: T.text3, textTransform: 'uppercase' }}>Custom</div>
            <button style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', textAlign: 'left', padding: '7px 14px', border: 'none', background: preset === 'custom' ? T.blueBg : 'transparent', color: preset === 'custom' ? T.blue : T.text, fontSize: 13, fontWeight: preset === 'custom' ? 600 : 400, fontFamily: 'inherit', cursor: 'default' }}>
              Custom range {preset === 'custom' && <span>✓</span>}
            </button>
          </div>
          <div style={{ flex: 1, padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.navy }}>Custom date range</div>
            {[['From', from, setFrom], ['To', to, setTo]].map(([lbl, val, setter]) => (
              <div key={lbl} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: T.text3 }}>{lbl}</label>
                <input type="date" value={val} max={todayStr()} onChange={e => { setter(e.target.value); setErr('') }} style={{ padding: '8px 10px', border: `1px solid ${T.border}`, borderRadius: 7, fontSize: 13, fontFamily: 'inherit', color: T.navy, outline: 'none', width: '100%', boxSizing: 'border-box' }} />
              </div>
            ))}
            {err && <div style={{ fontSize: 11, color: T.red }}>{err}</div>}
            <button onClick={applyCustom} style={{ marginTop: 'auto', padding: '9px 0', background: T.blue, color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.opacity = '.85'} onMouseLeave={e => e.currentTarget.style.opacity = '1'}>Apply</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────
function Card({ children, style }) {
  return (
    <div style={{ background: T.bg, borderRadius: 12, border: `1px solid ${T.border}`, boxShadow: T.lift, overflow: 'hidden', ...style }}>
      {children}
    </div>
  )
}

// ─── Section header inside a card ─────────────────────────────────────────────
function CardHead({ title, sub, right }) {
  return (
    <div style={{ padding: '16px 20px 14px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text, lineHeight: 1.3 }}>{title}</div>
        {sub && <div style={{ fontSize: 11.5, color: T.text3, marginTop: 2 }}>{sub}</div>}
      </div>
      {right}
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Sk({ h = 80, w = '100%' }) {
  return <div style={{ height: h, width: w, borderRadius: 10, background: 'rgba(0,0,0,.055)', animation: 'caPulse 1.4s ease-in-out infinite' }} />
}

// ─── KPI tiles — identical structure to LeadershipDashboard ─────────────────
// Row-1 tile: label / big-value / sub-description / optional goal row + bar
function KpiTile1({ label, value, valueColor, sub, goal, goalLabel, goalLabelColor, bar, tooltip }) {
  return (
    <div title={tooltip ?? ''} style={{
      background: T.bg, borderRadius: 10, padding: '20px 18px',
      boxShadow: T.lift, border: `1px solid ${T.border}`,
      display: 'flex', flexDirection: 'column', gap: 3,
      cursor: tooltip ? 'help' : 'default',
    }}>
      <div style={{ fontSize: 11, color: T.text3, fontWeight: 500, lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: valueColor ?? T.text, lineHeight: 1.2, marginTop: 3, letterSpacing: '-0.3px' }}>{value}</div>
      <div style={{ fontSize: 11.5, color: T.text3, lineHeight: 1.4, marginTop: 1 }}>{sub}</div>
      {goal && (
        <div style={{ fontSize: 11, color: T.text3, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
          <span>{goal}</span>
          {goalLabel && <span style={{ fontWeight: 700, color: goalLabelColor ?? T.text2 }}>{goalLabel}</span>}
        </div>
      )}
      {bar && (
        <div style={{ height: 4, background: 'rgba(0,0,0,.08)', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 2, width: `${Math.min(100, bar.pct * 100)}%`, background: bar.color, transition: 'width .5s ease' }} />
        </div>
      )}
    </div>
  )
}

// Row-2 tile: label / large coloured delta value / sub
function KpiTile2({ label, value, valueColor, sub }) {
  return (
    <div style={{
      background: T.bg, borderRadius: 10, padding: '20px 18px',
      boxShadow: T.lift, border: `1px solid ${T.border}`,
    }}>
      <div style={{ fontSize: 11, color: T.text3, fontWeight: 500, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: valueColor ?? T.text, lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: T.text3, marginTop: 5 }}>{sub}</div>
    </div>
  )
}

// ─── Chart.js — Monthly trend ─────────────────────────────────────────────────
const CHART_METRICS = [
  { key: 'complete_gmv',    label: 'Complete GMV',  color: T.blue,   fmt: usdC },
  { key: 'profit',          label: 'Profit',        color: T.green,  fmt: usdC },
  { key: 'cancel_pct',     label: 'Cancel %',      color: T.red,    fmt: v => pct(v) },
  { key: 'avg_gmv_per_trip', label: 'AOV',          color: T.coral,  fmt: v => usd(v, 2) },
]

function MonthlyTrendChart({ monthly }) {
  const [metric, setMetric] = useState('complete_gmv')
  const cfg = CHART_METRICS.find(m => m.key === metric)
  if (!monthly?.length) return <div style={{ padding: '40px 20px', textAlign: 'center', color: T.text3, fontSize: 13 }}>No monthly data in this date range</div>

  const labels = monthly.map(m => m.m)
  const values = monthly.map(m => n(m[metric]))

  const chartData = {
    labels,
    datasets: [{
      label: cfg.label,
      data: values,
      backgroundColor: cfg.color + 'CC',
      hoverBackgroundColor: cfg.color,
      borderRadius: 4,
      borderSkipped: false,
    }],
  }

  const opts = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    layout: { padding: { top: 24 } },   // headroom for top labels
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: T.navy,
        titleColor: '#94a3b8',
        bodyColor: '#fff',
        padding: { x: 12, y: 8 },
        cornerRadius: 8,
        callbacks: { label: ctx => cfg.fmt(ctx.raw) },
      },
      // per-chart datalabels — shown on top of each bar
      datalabels: {
        anchor: 'end',
        align: 'end',
        offset: 4,
        color: T.text,
        font: { size: 10.5, weight: '600' },
        formatter: v => cfg.fmt(v),
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: T.text2, font: { size: 11 }, maxRotation: 0 },
      },
      y: {
        grid: { color: T.border, lineWidth: 1 },
        border: { display: false, dash: [3, 3] },
        ticks: { color: T.text2, font: { size: 11 }, callback: v => cfg.fmt(v) },
      },
    },
  }

  return (
    <div>
      {/* Metric pills */}
      <div style={{ display: 'flex', gap: 6, padding: '14px 20px 0', flexWrap: 'wrap' }}>
        {CHART_METRICS.map(m => (
          <button key={m.key} onClick={() => setMetric(m.key)} style={{
            padding: '4px 14px', borderRadius: 20, fontFamily: 'inherit',
            border: `1.5px solid ${metric === m.key ? m.color : T.border}`,
            background: metric === m.key ? m.color + '14' : 'transparent',
            color: metric === m.key ? m.color : T.text3,
            fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all .15s',
          }}>{m.label}</button>
        ))}
      </div>
      <div style={{ height: 260, padding: '12px 20px 16px' }}>
        <Bar data={chartData} options={opts} plugins={[ChartDataLabels]} />
      </div>
    </div>
  )
}


// compact K/M/B formatter for data labels
const cmpct = (v) => {
  const a = Math.abs(v)
  if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B'
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'k'
  return String(Math.round(v))
}

function AccountFlowChart({ flow }) {
  if (!flow?.length) return <div style={{ padding: '40px 20px', textAlign: 'center', color: T.text3, fontSize: 13 }}>No flow data</div>

  const labels = flow.map(m => m.m)
  const datasets = [
    { label: 'New',         data: flow.map(m => n(m.new_accounts)), backgroundColor: T.green + 'E0', stack: 's', borderRadius: 0, borderSkipped: false },
    { label: 'Retained',    data: flow.map(m => n(m.retained)),     backgroundColor: T.blue  + 'CC', stack: 's', borderSkipped: false },
    { label: 'Reactivated', data: flow.map(m => n(m.reactivated)),  backgroundColor: T.amber + 'D0', stack: 's', borderRadius: 4,  borderSkipped: false },
  ]
  const chartData = { labels, datasets }

  const opts = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    layout: { padding: { top: 22 } },   // room for the top labels
    plugins: {
      legend: {
        position: 'bottom',
        labels: { boxWidth: 12, boxHeight: 12, font: { size: 11 }, color: T.text2, padding: 16 },
      },
      tooltip: {
        backgroundColor: T.navy, titleColor: '#94a3b8', bodyColor: '#fff', padding: { x: 12, y: 8 }, cornerRadius: 8,
        mode: 'index',
        callbacks: { label: ctx => `${ctx.dataset.label}: ${nfmt(ctx.raw)}` },
      },
      // ChartDataLabels — per-chart only, shows total on top of each stack
      datalabels: {
        display: ctx => ctx.datasetIndex === datasets.length - 1,  // only on top dataset
        anchor: 'end',
        align: 'end',
        offset: 4,
        color: T.text,
        font: { size: 11, weight: '600' },
        formatter: (_, ctx) => {
          const total = datasets.reduce((sum, ds) => sum + (ds.data[ctx.dataIndex] ?? 0), 0)
          return cmpct(total)
        },
      },
    },
    scales: {
      x: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { color: T.text2, font: { size: 11 }, maxRotation: 0 } },
      y: { stacked: true, grid: { color: T.border }, border: { display: false }, ticks: { color: T.text2, font: { size: 11 }, callback: v => cmpct(v) } },
    },
  }

  return (
    <div style={{ height: 280, padding: '4px 20px 4px' }}>
      <Bar data={chartData} options={opts} plugins={[ChartDataLabels]} />
    </div>
  )
}

// ─── Cohort heatmap ───────────────────────────────────────────────────────────
function retColor(p) {
  if (p == null) return T.bg3
  const f = Math.min(1, Math.max(0, p / 100))
  return `rgba(24,95,165,${0.12 + f * 0.82})`
}
function revColor(rev, mLog) {
  if (!rev || rev <= 0) return T.bg3
  const f = Math.min(1, Math.log10(Math.max(1, rev)) / mLog)
  return `rgba(29,158,117,${0.12 + f * 0.82})`
}

function toGrid(cells) {
  const map = new Map()
  for (const c of cells) {
    if (!map.has(c.cohort)) map.set(c.cohort, new Map())
    map.get(c.cohort).set(c.mi, c)
  }
  const maxMi = cells.length ? Math.max(...cells.map(c => c.mi)) : 0
  const order = [...map.keys()].sort((a, b) => a === '__PRE__' ? -1 : b === '__PRE__' ? 1 : a.localeCompare(b))
  return { order, map, maxMi }
}

function cLabel(k, sd) { return k === '__PRE__' ? `Pre-${sd?.slice(0, 4) ?? 'window'} base` : k }

function CohortHeatmap({ cells, startDate, sizeKey = 'accounts', mode = 'retention' }) {
  if (!cells?.length) return <div style={{ padding: '32px 20px', textAlign: 'center', color: T.text3, fontSize: 13 }}>No cohort data in this date range</div>
  const { order, map, maxMi } = toGrid(cells)
  const sizes = {}
  order.forEach(c => { sizes[c] = map.get(c)?.get(0)?.[sizeKey] ?? 0 })
  const allRevs = cells.map(c => c.gmv).filter(v => v > 0)
  const mLog = allRevs.length ? Math.log10(Math.max(...allRevs)) : 1
  const cols = Math.min(maxMi + 1, 20)

  return (
    <div style={{ padding: '0 20px 20px', overflowX: 'auto' }}>
      <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: '2px 2px', fontSize: 11 }}>
        <colgroup>
          <col style={{ width: '120px' }} />
          <col style={{ width: '38px' }} />
          {Array.from({ length: cols }, (_, i) => <col key={i} />)}
        </colgroup>
        <thead>
          <tr>
            <th style={{ padding: '4px 6px', textAlign: 'left', color: T.text3, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Cohort</th>
            <th style={{ padding: '4px 4px', textAlign: 'right', color: T.text3, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>N</th>
            {Array.from({ length: cols }, (_, i) => (
              <th key={i} style={{ padding: '4px 0', color: T.text3, fontWeight: 500, textAlign: 'center', fontSize: 10 }}>+{i}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.map(cohort => {
            const row = map.get(cohort), sz = sizes[cohort]
            return (
              <tr key={cohort}>
                <td style={{ padding: '3px 6px', color: T.text, fontWeight: cohort === '__PRE__' ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                  {cLabel(cohort, startDate)}
                </td>
                <td style={{ padding: '3px 4px', textAlign: 'right', color: T.text3, fontSize: 11 }}>{nfmt(sz)}</td>
                {Array.from({ length: cols }, (_, mi) => {
                  const c = row?.get(mi)
                  let bg = T.bg3, label = '', textColor = T.text3, fontWeight = 500

                  if (c) {
                    if (mode === 'retention') {
                      const rp = sz > 0 ? (c[sizeKey] / sz) * 100 : null
                      bg = retColor(rp)
                      label = rp != null ? rp.toFixed(0) + '%' : ''
                      textColor = rp != null && rp > 60 ? '#fff' : T.navy
                      fontWeight = mi === 0 ? 700 : 500
                    } else {
                      bg = revColor(c.gmv, mLog)
                      label = usdC(c.gmv)
                      textColor = c.gmv > 50000 ? '#fff' : T.navy
                    }
                  }

                  return (
                    <td key={mi}
                      title={c ? `${cLabel(cohort, startDate)} +${mi}: ${nfmt(c[sizeKey])} ${sizeKey}, ${usd(c.gmv)}` : ''}
                      style={{ height: 28, textAlign: 'center', background: bg, borderRadius: 3, color: textColor, fontSize: 10, fontWeight, verticalAlign: 'middle', cursor: c ? 'help' : 'default' }}>
                      {label}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Data table ───────────────────────────────────────────────────────────────
function DataTable({ cols, rows, keyField, defaultSort, defaultDir = 'desc', pageSize }) {
  const [sortKey, setSortKey] = React.useState(defaultSort ?? null)
  const [sortDir, setSortDir] = React.useState(defaultDir)
  const [showAll, setShowAll]  = React.useState(false)

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  // A8: Warn if a numeric column is all-zero across all rows — catches silent field-name failures.
  React.useEffect(() => {
    if (!rows?.length || rows.length < 2) return
    cols.forEach(c => {
      if (!c.key || c.align === 'left') return
      const allMissing = rows.every(r => r[c.key] === 0 || r[c.key] === '0' || r[c.key] == null)
      if (allMissing) {
        console.warn(`[DataTable] ⚠️ Column "${c.label ?? c.key}" is all-zero/null on ${rows.length} rows — field-name mismatch?`, rows[0])
      }
    })
  }, [rows]) // eslint-disable-line

  const sorted = React.useMemo(() => {
    if (!sortKey || !rows?.length) return rows ?? []
    return [...rows].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      const n = (v) => typeof v === 'number' ? v : parseFloat(String(v ?? '')) || 0
      const cmp = typeof av === 'string' && typeof bv === 'string' && isNaN(parseFloat(av))
        ? av.localeCompare(bv)
        : n(av) - n(bv)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, sortKey, sortDir])

  const visible = pageSize && !showAll ? sorted.slice(0, pageSize) : sorted
  const hiddenCount = pageSize ? sorted.length - pageSize : 0

  const Chevron = ({ col }) => {
    if (sortKey !== col.key) return <span style={{ opacity: 0.25, fontSize: 9, marginLeft: 4 }}>⇅</span>
    return <span style={{ fontSize: 9, marginLeft: 4, color: T.blue }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
  }

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${T.border}` }}>
              {cols.map(c => (
                <th key={c.key}
                  onClick={() => handleSort(c.key)}
                  style={{
                    padding: '10px 16px', textAlign: c.align ?? 'right',
                    color: sortKey === c.key ? T.blue : T.text3,
                    fontWeight: 600, fontSize: 10.5,
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    whiteSpace: 'nowrap', background: T.bg2,
                    cursor: 'pointer', userSelect: 'none',
                    transition: 'color 0.15s',
                  }}>
                  {c.label}<Chevron col={c} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={keyField ? r[keyField] : i} style={{ borderBottom: `1px solid ${T.border}` }}
                onMouseEnter={e => e.currentTarget.style.background = T.bg2}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                {cols.map(c => (
                  <td key={c.key} style={{
                    padding: '10px 16px', textAlign: c.align ?? 'right',
                    color: c.color ? c.color(r) : T.text,
                    fontWeight: c.bold ? (c.bold(r) ? 600 : 400) : 400,
                    whiteSpace: 'nowrap',
                  }}>
                    {c.render ? c.render(r) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Show more / Show less toggle */}
      {pageSize && hiddenCount > 0 && (
        <div style={{ borderTop: `1px solid ${T.border}`, padding: '12px 16px', textAlign: 'center' }}>
          <button
            onClick={() => setShowAll(s => !s)}
            style={{
              background: 'none', border: `1px solid ${T.border}`,
              borderRadius: 8, padding: '7px 20px',
              fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              color: T.blue, display: 'inline-flex', alignItems: 'center', gap: 6,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = T.bg2; e.currentTarget.style.borderColor = T.blue }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.borderColor = T.border }}
          >
            {showAll
              ? '▲ Show less'
              : `▼ Show ${hiddenCount} more partner${hiddenCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Bar pill for tables ──────────────────────────────────────────────────────
function BarPill({ value, max, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
      <div style={{ width: 64, height: 4, background: T.bg4, borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ height: '100%', width: `${Math.min(100, (value / max) * 100)}%`, background: color ?? T.blue, borderRadius: 2 }} />
      </div>
      <span style={{ minWidth: 42, textAlign: 'right' }}>{pct(value, 1)}</span>
    </div>
  )
}



// ─── Default preset ───────────────────────────────────────────────────────────
const DEF = 'last12m'
const getDefRange = () => { const p = PRESETS.find(x => x.value === DEF); const r = p.get(); return r }

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
export default function CustomerAnalytics() {
  const { filters, actions } = useFilters()
  // Keep a ref so async callbacks always have latest actions (avoids stale closure)
  const actionsRef = useRef(actions)
  useEffect(() => { actionsRef.current = actions })

  const start = filters.dateRanges.primary.startDate
  const end   = filters.dateRanges.primary.endDate

  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [cohortMode, setCM]   = useState('retention')

  // Auto-select Last 12 months when landing on this tab.
  // Restore the previous default (last30d) on unmount only if the user
  // hasn't manually changed the preset while on this page.
  useEffect(() => {
    const prevPreset = filters.preset
    if (prevPreset === 'last30d') {
      actions.setPreset('last12months')
    }
    return () => {
      // On unmount: only reset if still at the auto-set value
      actions.setPreset(p => p === 'last12months' ? 'last30d' : p)
    }
  }, []) // eslint-disable-line

  // Clear customer options + filter on unmount
  useEffect(() => {
    return () => {
      actionsRef.current.setCustomerOptions([])
      actionsRef.current.setCustomerFilter([])
    }
  }, []) // eslint-disable-line

  const loadIdRef = useRef(0)

  const loadData = useCallback(async (s, e, accountNames) => {
    const myId = ++loadIdRef.current   // stamp this request
    setLoading(true); setError(null)
    try {
      const body = { start_date: s, end_date: e }
      if (accountNames?.length) body.account_names = accountNames
      const { data: d, error: fe } = await supabase.functions.invoke('customer_analysis', { body })
      if (myId !== loadIdRef.current) return  // ← stale: a newer call already fired, discard
      if (fe || d?.error) throw new Error(fe?.message || d?.error || 'Edge function error')
      setData(d)
      // Populate customer dropdown from first unfiltered load
      if (!accountNames?.length && d?.top_accounts?.length) {
        const names = [...new Set(
          d.top_accounts.map(a => a.account_name).filter(Boolean)
        )].sort((a, b) => a.localeCompare(b))
        actionsRef.current.setCustomerOptions(names)
      }
    } catch (ex) {
      if (myId !== loadIdRef.current) return  // discard stale errors too
      setError(ex?.message ?? 'Failed to load')
    } finally {
      if (myId === loadIdRef.current) setLoading(false)
    }
  }, []) // eslint-disable-line

  // Reload whenever global date range or customer filter changes
  const customerFilter = filters.customerFilter
  useEffect(() => { loadData(start, end, customerFilter) }, [start, end, customerFilter]) // eslint-disable-line

  // A8: All-zero guard — if every monetary KPI reads 0 the response shape is almost certainly wrong.
  // Never let a silent-zero page ship unnoticed again.
  useEffect(() => {
    const k = data?.kpis
    if (!k) return
    const monetary = ['complete_gmv', 'profit', 'service_trips', 'cancelled_trips']
    if (monetary.every(f => !n(k[f]))) {
      console.warn('[CustomerAnalytics] ⚠️ ALL monetary KPIs are zero — field-name or response-shape failure', k)
    }
  }, [data])

  const meta      = data?.meta
  const kpis      = data?.kpis
  const monthly   = data?.monthly      ?? []
  const acCohort  = data?.account_cohort   ?? []
  const ptCohort  = data?.customer_cohort  ?? []
  const flow      = data?.flow             ?? []
  const tiers     = data?.tiers            ?? []
  const partners  = data?.partners         ?? []
  const pax       = data?.passengers       ?? []

  const cancelPct = kpis?.cancel_pct ?? 0
  const TIER_COLORS = { 'A. $1M+': T.purple, 'B. $100k-1M': T.blue, 'C. $10k-100k': T.teal, 'D. $1k-10k': T.amber, 'E. <$1k': T.text3 }
  const maxPaxGmv = Math.max(...pax.map(p => n(p.pct_gmv)), 1)
  // A7: Cohort base = count at mi=0 — only entities with an identifiable first-trip month can be cohorted
  const acBase      = acCohort.filter(r => r.mi === 0).reduce((s, r) => s + n(r.accounts), 0)
  const ptBase      = ptCohort.filter(r => r.mi === 0).reduce((s, r) => s + n(r.customers), 0)
  // A6: Passenger-attributed GMV (only trips where ride_customer.person_id matched)
  const paxGmvTotal = pax.reduce((s, r) => s + n(r.gmv), 0)

  return (
    <>
      <style>{`
        @keyframes caPulse { 0%,100%{opacity:.55} 50%{opacity:1} }
        @keyframes spin { to { transform: rotate(360deg) } }
        .ca-root { font-family: 'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; -webkit-font-smoothing:antialiased; }
      `}</style>

      <div className="ca-root" style={{ minHeight: '100%', background: T.bg2 }}>
        <div style={{ padding: '20px 10px 60px', display: 'flex', flexDirection: 'column', gap: 20 }}>


          {/* Error */}
          {error && (
            <div style={{ padding: '12px 16px', background: T.redBg, border: `1px solid ${T.red}30`, borderRadius: 10, color: T.red, fontSize: 13, fontWeight: 500 }}>
              ⚠ {error}
            </div>
          )}

          {/* Loading skeletons */}
          {loading && !data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                <Sk h={96} /><Sk h={96} /><Sk h={96} />
                <Sk h={96} /><Sk h={96} /><Sk h={96} />
                <Sk h={96} /><Sk h={96} /><Sk h={96} />
              </div>
              <Sk h={280} /><Sk h={260} /><Sk h={320} />
            </div>
          )}

          {kpis && (
            <>
              {/* ══ 1. KPI OVERVIEW ═══════════════════════════════════════════ */}
              <Card>
                <CardHead title="Overview" sub={`${start} → ${meta?.end_date ?? end}${meta?.cached ? ' · ⚡ cached' : ''}`} />
                <div style={{ padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>

                  {/* Row 1 — Primary metrics */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10 }}>
                    <KpiTile1
                      label="Complete GMV"
                      value={usdC(kpis.complete_gmv)}
                      valueColor={T.navy}
                      sub="Completed rides only"
                    />
                    <KpiTile1
                      label="Profit"
                      value={usdC(kpis.profit)}
                      valueColor={n(kpis.profit) >= 0 ? T.green : T.red}
                      sub={`${pct(kpis.profit_margin_pct, 1)} margin rate`}
                    />
                    <KpiTile1
                      label="Avg GMV / Trip"
                      value={usd(kpis.avg_gmv_per_trip, 2)}
                      valueColor={T.blue}
                      sub="Per service trip"
                    />
                    <KpiTile1
                      label="Service Trips"
                      value={nfmt(kpis.service_trips)}
                      valueColor={T.text}
                      sub={`${nfmt(kpis.service_rides)} distinct rides`}
                      goal={`Delivered: ${nfmt(kpis.delivered_trips)}`}
                      tooltip="Excludes ~6,949 'Unpaid' ride_stat rows per data dictionary (Wilson sign-off). These carry $1.28M GMV at near-100% margin and are internal adjustment rows, not customer rides."
                    />
                    <KpiTile1
                      label="Cancelled Trips"
                      value={nfmt(kpis.cancelled_trips)}
                      valueColor={cancelPct > 35 ? T.red : T.text}
                      sub={`${pct(kpis.cancel_pct, 1)} cancel rate`}
                      goalLabel={cancelPct > 35 ? '⚠ High' : null}
                      goalLabelColor={T.red}
                      bar={kpis.service_trips > 0 ? { pct: n(kpis.cancelled_trips) / n(kpis.service_trips), color: cancelPct > 35 ? T.red : T.amber } : null}
                    />
                  </div>

                  {/* Row 2 — Accounts, customers, complaints */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
                    <KpiTile2
                      label="Accounts"
                      value={nfmt(kpis.accounts)}
                      valueColor={T.text}
                      sub={`${nfmt(kpis.customer_names)} named customers`}
                    />
                    <KpiTile2
                      label="Partners"
                      value={nfmt(kpis.partners)}
                      valueColor={T.text}
                      sub="Distinct partner-org groups (dim_fleet_as_customer)"
                    />
                    <KpiTile2
                      label="Valid Trips"
                      value={nfmt(kpis.valid_trips)}
                      valueColor={T.text}
                      sub="Accepted/Pending + complained cancels"
                    />
                    <KpiTile2
                      label="Cancel Rate"
                      value={pct(kpis.cancel_pct, 1)}
                      valueColor={cancelPct > 35 ? T.red : cancelPct > 25 ? T.amber : T.green}
                      sub="Of all service trips"
                    />
                  </div>
                </div>
              </Card>

              {/* ══ 2. MONTHLY TREND ══════════════════════════════════════════ */}
              <Card>
                <CardHead title="Monthly Trend" sub="Complete GMV, profit, cancellation rate and avg GMV/trip — click a metric to switch" />
                <MonthlyTrendChart monthly={monthly} />
              </Card>

              {/* ══ 3 + 4. COHORTS (2-col) ════════════════════════════════════ */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                {/* Account cohort */}
                <Card>
                  <CardHead
                    title="Account Cohort Retention"
                    sub={acBase > 0
                      ? `% retained · base: ${nfmt(acBase)} of ${nfmt(n(kpis?.accounts))} accounts have a known first-trip month`
                      : '% of accounts active at +0 still booking in +N'}
                    right={
                      <div style={{ display: 'flex', border: `1px solid ${T.border}`, borderRadius: 7, overflow: 'hidden', flexShrink: 0 }}>
                        {['retention', 'revenue'].map(m => (
                          <button key={m} onClick={() => setCM(m)} style={{
                            padding: '4px 10px', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                            background: cohortMode === m ? T.blue : 'transparent',
                            color: cohortMode === m ? '#fff' : T.text3,
                            fontSize: 11.5, fontWeight: 600, transition: 'all .12s',
                          }}>{m === 'retention' ? '%' : '$'}</button>
                        ))}
                      </div>
                    }
                  />
                  <CohortHeatmap cells={acCohort} startDate={start} sizeKey="accounts" mode={cohortMode} />
                </Card>

                {/* Customer cohort */}
                <Card>
                  <CardHead
                    title="Customer Cohort Retention"
                    sub={ptBase > 0
                      ? `% retained · base: ${nfmt(ptBase)} of ${nfmt(n(kpis?.customer_names))} named customers have a known first-trip month`
                      : 'Customer % retained by cohort × months since first trip'}
                  />
                  <CohortHeatmap cells={ptCohort} startDate={start} sizeKey="customers" mode="retention" />
                </Card>
              </div>

              {/* ══ 5. ACCOUNT FLOW ═══════════════════════════════════════════ */}
              <Card>
                <CardHead title="Account Flow" sub="New, retained and reactivated accounts per month" />
                <AccountFlowChart flow={flow} />

                {/* Flow detail table */}
                {flow.length > 0 && (
                  <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 4 }}>
                    <DataTable
                      keyField="m"
                      cols={[
                        { key: 'm',           label: 'Month',       align: 'left', bold: () => true, color: () => T.navy },
                        { key: 'active',      label: 'Active',      render: r => nfmt(r.active) },
                        { key: 'new_accounts',label: 'New',         render: r => nfmt(r.new_accounts),  color: () => T.green },
                        { key: 'retained',    label: 'Retained',    render: r => nfmt(r.retained),       color: () => T.blue },
                        { key: 'reactivated', label: 'Reactivated', render: r => nfmt(r.reactivated),    color: () => T.amber },
                        { key: 'gmv',         label: 'GMV',         render: r => usdC(r.gmv),            bold: () => true },
                        { key: 'expansion',   label: 'Expansion',   render: r => usdC(r.expansion),      color: () => T.green },
                        { key: 'contraction', label: 'Contraction', render: r => usdC(r.contraction),    color: () => T.red },
                      ]}
                      rows={[...flow].reverse()}
                    />
                  </div>
                )}
              </Card>

              {/* ══ 6. VALUE TIERS (full-width) ════════════════════════════════ */}
              <Card>
                <CardHead title="Account Value Tiers" sub="All accounts in window, bucketed by Complete GMV" />
                <DataTable
                  keyField="tier"
                  cols={[
                    { key: 'tier',             label: 'Tier',          align: 'left', bold: () => true, color: r => TIER_COLORS[r.tier] ?? T.text },
                    { key: 'accounts',         label: 'Accounts',      render: r => nfmt(r.accounts) },
                    { key: 'gmv',              label: 'Complete GMV',  render: r => usd(r.gmv),    bold: () => true, color: () => T.navy },
                    { key: 'pct_gmv',          label: '% GMV',         render: r => <BarPill value={n(r.pct_gmv)} max={100} color={TIER_COLORS[r.tier] ?? T.blue} /> },
                    { key: 'profit',           label: 'Profit',        render: r => usd(r.profit),  color: r => n(r.profit) < 0 ? T.red : T.green },
                    { key: 'trips',            label: 'Trips',         render: r => nfmt(r.trips),  color: () => T.text3 },
                    { key: 'avg_months_active',label: 'Avg Active Mo.',render: r => r.avg_months_active ?? '—', color: () => T.text3 },
                    { key: 'dormant_90d',      label: 'Dormant 90d',   render: r => nfmt(r.dormant_90d), color: r => n(r.dormant_90d) > 0 ? T.red : T.text3 },
                  ]}
                  rows={tiers}
                />
              </Card>

              {/* ══ 7. PARTNER PROFITABILITY (full-width, all columns) ══════════ */}
              <Card>
                <CardHead title="Partner Profitability" sub="All partners active in the selected date range — click any column header to sort" />
                <DataTable
                  keyField="customer_name"
                  defaultSort="complete_gmv"
                  defaultDir="desc"
                  pageSize={50}
                  cols={[
                    { key: 'customer_name',    label: 'Customer',   align: 'left', bold: () => true, color: () => T.navy },
                    { key: 'partner',          label: 'Partner',    align: 'left', color: () => T.text3 },
                    { key: 'accounts',         label: 'Accounts',   render: r => nfmt(r.accounts),   color: () => T.text3 },
                    { key: 'service_trips',    label: 'Trips',      render: r => nfmt(r.service_trips),  color: () => T.text3 },
                    { key: 'service_rides',    label: 'Rides',      render: r => nfmt(r.service_rides),  color: () => T.text3 },
                    { key: 'cancel_pct',       label: 'Cancel %',   render: r => pct(r.cancel_pct, 1), color: r => n(r.cancel_pct) > 30 ? T.red : T.text3 },
                    { key: 'complaint_rate',   label: 'Complaint %', render: r => pct(r.complaint_rate, 2), color: r => n(r.complaint_rate) > 3 ? T.red : T.text3 },
                    { key: 'avg_gmv_per_trip', label: 'Avg GMV',    render: r => usd(r.avg_gmv_per_trip, 2) },
                    { key: 'complete_gmv',     label: 'Complete GMV', render: r => usd(r.complete_gmv), bold: () => true, color: () => T.navy },
                    { key: 'profit',           label: 'Profit',     render: r => usd(r.profit), color: () => T.green },
                    { key: 'profit_margin_pct', label: 'Margin %',  bold: () => true,
                      render: r => pct(r.profit_margin_pct, 1),
                      color: r => n(r.profit_margin_pct) < 5 ? T.amber : T.green },
                  ]}
                  rows={partners}
                />
              </Card>

              {/* ══ 8. PASSENGERS ════════════════════════════════════════════ */}
              <Card>
                <CardHead
                  title="Passenger Repeat Purchase"
                  sub={kpis && n(kpis.complete_gmv) > 0
                    ? `Passenger-attributed trips only — ${usdC(paxGmvTotal)} of ${usdC(n(kpis.complete_gmv))} total GMV (${Math.round(paxGmvTotal / n(kpis.complete_gmv) * 100)}%) · bucketed by distinct bookings, not trips`
                    : 'Person-level frequency — bucketed by distinct bookings (ride_id), not trips'}
                />
                <DataTable
                  keyField="bucket"
                  cols={[
                    { key: 'bucket',        label: 'Frequency',    align: 'left', bold: () => true, color: () => T.navy },
                    { key: 'customers',     label: 'Customers',    render: r => nfmt(r.customers) },
                    { key: 'pct_customers', label: '% Customers',  render: r => pct(r.pct_customers, 2), color: () => T.text3 },
                    { key: 'bookings',      label: 'Bookings',     render: r => nfmt(r.bookings),   color: () => T.text3 },
                    { key: 'trips',         label: 'Trips',        render: r => nfmt(r.trips),      color: () => T.text3 },
                    { key: 'gmv',           label: 'Complete GMV', render: r => usd(r.gmv),         bold: () => true, color: () => T.navy },
                    { key: 'pct_gmv',       label: '% GMV',        render: r => <BarPill value={n(r.pct_gmv)} max={maxPaxGmv} color={T.blue} /> },
                    { key: 'avg_ltv',       label: 'Avg LTV',      render: r => usd(r.avg_ltv, 2),  color: () => T.text3 },
                  ]}
                  rows={pax}
                />
              </Card>


              {/* Footer */}
              {meta && (
                <div style={{ textAlign: 'center', fontSize: 11, color: T.text3, paddingBottom: 4 }}>
                  Generated {meta.generated_at ? new Date(meta.generated_at).toLocaleString() : '—'}
                  {meta.bytes_processed ? ` · ${(meta.bytes_processed / 1e9).toFixed(2)} GB scanned` : ''}
                  {meta.cached ? ' · served from cache' : meta.elapsed_ms ? ` · ${(meta.elapsed_ms / 1000).toFixed(1)}s query` : ''}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </>
  )
}
