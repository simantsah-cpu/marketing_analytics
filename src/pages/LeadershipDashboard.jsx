/**
 * LeadershipDashboard.jsx
 * Weekly EAM Performance — Executive Summary tab
 *
 * Data source: BigQuery only via `leadership-dashboard` Supabase edge function.
 * No GA4 calls anywhere in this file.
 *
 * Key invariants enforced here (build spec 0):
 *  - Profit evaluated at (dept, customer) grain in Q_CUST; this layer only sums pre-computed columns.
 *  - Company target = sum of exactly four departments (4.1). Sales Mo / Sales Jojo are rolled up.
 *  - salesPct / profitPct edge cases reproduced verbatim (5.1).
 *  - Null renders as '—', never '$0' or 'NaN'.
 *  - QA log on every render (9.3).
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../services/supabase'
import DepartmentsTab  from './DepartmentsTab'
import CustomersTab    from './CustomersTab'
import ForecastTab     from './ForecastTab'
import GeoProductTab   from './GeoProductTab'
import B2CTab          from './B2CTab'
import RideHailingTab   from './RideHailingTab'
import QualityTab       from './QualityTab'
import AIEngineeringTab from './AIEngineeringTab'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarElement, PointElement, LineElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import { Bar } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, PointElement, LineElement,
  Title, Tooltip, Legend, Filler, ChartDataLabels,
)

// ─────────────────────────────────────────────────────────────────────────────
// Constants (4.1)
// ─────────────────────────────────────────────────────────────────────────────

const DEPT_TARGET_KEYS = ['EAM Chris', 'EAM Renaldo', 'EAM Gloria', 'B2C Matt']
const DEPT_ROLLUP      = { 'Sales Mo': 'EAM Chris', 'Sales Jojo': 'EAM Gloria' }
// Cache key is a function — keyed on both asAt and period to prevent
// cross-period or cross-snapshot collisions in localStorage.
const cacheKey = (asAt, period) => `ld_cache_${asAt ?? 'latest'}_${period ?? 'mtd'}`
const EDGE_FN          = 'leadership-dashboard'

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens (8)
// ─────────────────────────────────────────────────────────────────────────────

const T = {
  bg:       '#ffffff',
  bg2:      '#FAFBFC',
  bg3:      '#F1F5F9',
  bg4:      '#E2EAF0',
  text:     '#1A2B3C',
  text2:    '#374151',
  text3:    '#64748B',
  border:   '#E2EAF0',
  border2:  '#B8C4D0',
  green:    '#1D9E75',
  blue:     '#185FA5',
  red:      '#E24B4A',
  purple:   '#7F77DD',
  coral:    '#D85A30',
  teal:     '#0E8E8E',
  amber:    '#EAB308',
  amberInk: '#9A6B0C',
  navy:     '#1e3a5f',
  greenBg:  'rgba(29,158,117,.11)',
  blueBg:   'rgba(24,95,165,.10)',
  amberBg:  'rgba(234,179,8,.16)',
  redBg:    'rgba(226,75,74,.11)',
  lift:     '0 1px 2px rgba(26,26,24,.05), 0 6px 16px -6px rgba(26,26,24,.10)',
}

// ─────────────────────────────────────────────────────────────────────────────
// num() — coerce BigQuery string values to finite numbers (5.2)
// The BigQuery REST API returns every value as a string. This is load-bearing.
// ─────────────────────────────────────────────────────────────────────────────

function num(v) {
  const x = (v === null || v === undefined || v === '') ? NaN : Number(v)
  return isFinite(x) ? x : 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatters (6)
// ─────────────────────────────────────────────────────────────────────────────

const usd = (v, d = 0) =>
  '$' + num(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

function usdC(v) {
  const x = num(v), a = Math.abs(x), s = x < 0 ? '-$' : '$'
  if (a >= 1e6) return s + (a / 1e6).toFixed(2) + 'M'
  if (a >= 1e5) return s + (a / 1e3).toFixed(0)  + 'k'
  if (a >= 1e3) return s + (a / 1e3).toFixed(1)  + 'k'  // keeps $17.2k distinct from $16.5k
  return s + a.toFixed(a < 10 ? 2 : 0)
}

const pctFmt = (v, d = 1) =>
  (v === null || v === undefined || !isFinite(Number(v)))
    ? '—'
    : (num(v) * 100).toFixed(d) + '%'

const signed = v => (num(v) > 0 ? '+' : '') + usd(num(v), 0)

const numFmt = (v, d = 0) =>
  num(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

// ─────────────────────────────────────────────────────────────────────────────
// Percentage formulas (5.1) — reproduce verbatim, edge cases are intentional
// ─────────────────────────────────────────────────────────────────────────────

function salesPct(sales, lm) {
  if (num(sales) === 0 && num(lm) === 0) return null   // blank → '—'
  if (num(lm) === 0) return 1.0                         // 100%
  return (num(sales) - num(lm)) / num(lm)
}

function profitPct(profit, lm) {
  if (num(lm) < 0) return 1.0                           // base was a loss → 100%
  if (num(profit) === 0 && num(lm) === 0) return null
  if (num(lm) === 0) return 1.0
  return (num(profit) - num(lm)) / num(lm)
}

// ─────────────────────────────────────────────────────────────────────────────
// Attainment colour (6) — thresholds 95% and 80% are load-bearing
// ─────────────────────────────────────────────────────────────────────────────

const achColor = p =>
  (p === null || !isFinite(Number(p))) ? T.text3
    : p >= 0.95 ? T.green
    : p >= 0.80 ? T.amberInk
    : T.red

// ─────────────────────────────────────────────────────────────────────────────
// 5.3 — Pace: straight-line, not seasonality-adjusted.
// MUST use the snapshot month, not wall-clock today.
// Receives CUR_MONTH (YYYY-MM) so viewing a past snapshot shows that month's pace.
// e.g. snapshot 2026-08-25 → CUR_MONTH='2026-08' → elapsed=25, days=31, frac=25/31=80.6%
// NOT wall-clock today (Sept 1) → that would give frac=3.3% and make ach comparisons nonsense.
// ─────────────────────────────────────────────────────────────────────────────

function monthPace(curMonth, snapDate) {
  // curMonth is YYYY-MM from the snapshot, e.g. '2026-08'
  // The snap date is at most the last day of that month.
  // We know the snapshot date exactly from D.asAt — use its day as elapsed.
  // But monthPace is a pure helper that only needs the month string;
  // caller passes snapDate so we can extract the exact day.
  // Signature: monthPace(snapMonth, snapDateFull)
  // snapDateFull = YYYY-MM-DD or null; falls back to last day of month if null.
  // This function is intentionally kept pure (no external state).
  const [year, month] = curMonth.split('-').map(Number)
  const daysInMonth = new Date(year, month, 0).getDate()
  // elapsed: use the snapshot day if available, otherwise end-of-month (conservative)
  const elapsed = snapDate ? parseInt(snapDate.slice(8, 10), 10) : daysInMonth
  return { elapsed, days: daysInMonth, frac: elapsed / daysInMonth }
}

// ─────────────────────────────────────────────────────────────────────────────
// Current month helper
// ─────────────────────────────────────────────────────────────────────────────

function curMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 — Month helpers
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
// MONTH_FLOOR is derived from the snapshot year at render time (see monthFloor() below).
// It is NOT hardcoded to 2026 so that viewing older snapshots shows the full year of that snapshot.
// Dec of the prior year is included as that month's prev-month comparison base.

const monthFloor = snapYm => {
  if (!snapYm || snapYm.length < 4) return '2026-01'
  return `${snapYm.slice(0, 4)}-01`
}

const monthLabel = ym =>
  `${MONTH_NAMES[+ym.slice(5,7) - 1]} ${ym.slice(0,4)}`

function prevYm(ym) {
  let y = +ym.slice(0,4), m = +ym.slice(5,7) - 1
  if (m === 0) { m = 12; y -= 1 }
  return `${y}-${String(m).padStart(2,'0')}`
}

const availableMonths = (rows, snapYm) =>
  [...new Set(rows.filter(r => r.ym >= monthFloor(snapYm)).map(r => r.ym))].sort()

// ─────────────────────────────────────────────────────────────────────────────
// buildDepts for Exec Summary — rollup onto neutral field names
// Returns a Map<deptName, aggregated neutral fields>
// ─────────────────────────────────────────────────────────────────────────────

const NEUTRAL_FIELDS = [
  'sales','lm_sales','ly_sales',
  'profit','lm_profit','ly_profit',
  'revenue','lm_revenue',
]

function buildDepts(normRows) {
  const map = new Map()
  for (const row of normRows) {
    const rawDept = row.dept || '(Unassigned)'
    const dept    = DEPT_ROLLUP[rawDept] ?? rawDept
    if (!map.has(dept)) {
      const zero = { dept }
      NEUTRAL_FIELDS.forEach(f => { zero[f] = 0 })
      map.set(dept, zero)
    }
    const d = map.get(dept)
    NEUTRAL_FIELDS.forEach(f => { d[f] += num(row[f] ?? 0) })
  }
  return map
}

// ─────────────────────────────────────────────────────────────────────────────
// totals — sum all department rows
// ─────────────────────────────────────────────────────────────────────────────

function totals(depts) {
  const t = {}
  NEUTRAL_FIELDS.forEach(f => { t[f] = 0 })
  for (const d of depts.values()) {
    NEUTRAL_FIELDS.forEach(f => { t[f] += d[f] })
  }
  return t
}

// ─────────────────────────────────────────────────────────────────────────────
// buildTargets (4.2)
// ─────────────────────────────────────────────────────────────────────────────

function buildTargets(targetsRows, CUR_MONTH) {
  const months = [...new Set(targetsRows.map(r => r.ym))].sort()
  let month, monthIsFallback, missing

  if (months.includes(CUR_MONTH)) {
    month = CUR_MONTH; monthIsFallback = false; missing = false
  } else if (months.length) {
    month = months[months.length - 1]; monthIsFallback = true; missing = true
  } else {
    month = CUR_MONTH; monthIsFallback = false; missing = true
  }

  const dept = {}
  targetsRows
    .filter(r => r.ym === month && r.kind === 'dept')
    .forEach(r => { dept[r.dim] = num(r.tgt) })

  // Company target = exactly the four departments (4.1).
  // Sales Mo is already inside EAM Chris; Sales Jojo inside EAM Gloria.
  const company = DEPT_TARGET_KEYS.reduce((a, k) => a + (dept[k] || 0), 0)

  return { month, monthIsFallback, missing, available: months, dept, company }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache helpers (9.2)
// Keyed on (asAt, period) so week and MTD requests for the same snapshot don't collide,
// and different snapshot selections don't overwrite each other.
// ─────────────────────────────────────────────────────────────────────────────

function cacheRead(asAt, period) {
  try {
    const raw = localStorage.getItem(cacheKey(asAt, period))
    if (!raw) return null
    return JSON.parse(raw) // { data, ts }
  } catch { return null }
}

function cacheWrite(asAt, period, data) {
  try {
    localStorage.setItem(cacheKey(asAt, period), JSON.stringify({ data, ts: new Date().toISOString() }))
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Department badge colours
// ─────────────────────────────────────────────────────────────────────────────

const DEPT_BADGE = {
  'EAM Chris':   { bg: T.blueBg,   color: T.blue },
  'EAM Renaldo': { bg: T.greenBg,  color: T.green },
  'EAM Gloria':  { bg: T.amberBg,  color: T.amberInk },
  'B2C Matt':    { bg: T.redBg,    color: T.red },
  'Sales Mo':    { bg: T.blueBg,   color: T.blue },
  'Sales Jojo':  { bg: T.greenBg,  color: T.green },
}

function DeptBadge({ dept }) {
  const c = DEPT_BADGE[dept] ?? { bg: 'rgba(0,0,0,.07)', color: T.text2 }
  return (
    <span style={{
      display: 'inline-block', fontSize: 10, fontWeight: 600,
      padding: '1px 6px', borderRadius: 4,
      background: c.bg, color: c.color, marginTop: 3,
    }}>{dept}</span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 — Period metadata
// ─────────────────────────────────────────────────────────────────────────────

const PERIOD_META = {
  mtd: { label:'Month to date',   short:'MTD', base:'Last month MTD',   baseShort:'LM',
         sales:'m_sales',  profit:'m_profit',  rev:'m_rev',
         bSales:'lm_sales', bProfit:'lm_profit', bRev:'lm_rev' },
  qtd: { label:'Quarter to date', short:'QTD', base:'Previous quarter', baseShort:'PQ',
         sales:'q_sales',  profit:'q_profit',  rev:'q_rev',
         bSales:'pq_sales', bProfit:'pq_profit', bRev:'pq_rev' },
  ytd: { label:'Year to date',    short:'YTD', base:'Last year YTD',    baseShort:'LY',
         sales:'y_sales',  profit:'y_profit',  rev:'y_rev',
         bSales:'lyy_sales', bProfit:'lyy_profit', bRev:'lyy_rev' },
  // week: simple margin (revenue-cost). No complete/dispatched split exists at weekly grain.
  // Uses distinct prev_* fields — NOT lm_* — to avoid collision with month-semantics fields.
  // Only surfaced in the Geo & Product tab period selector.
  week: { label:'Last complete week', short:'Week', base:'Previous week', baseShort:'PW',
          sales:'sales', profit:'profit', rev:'revenue',
          bSales:'prev_sales', bProfit:'prev_profit', bRev:'prev_revenue' },
}

// Tab-specific period allowlists.
// Only Geo & Product (tab 4) supports the week period — other tabs use D.months client-side.
const GEO_PRODUCT_PERIODS = ['mtd', 'qtd', 'ytd', 'week']
const STANDARD_PERIODS    = ['mtd', 'qtd', 'ytd']

// ─────────────────────────────────────────────────────────────────────────────
// 4 — Period metadata resolver
// Call PM(period) instead of branching on period everywhere.
// ─────────────────────────────────────────────────────────────────────────────

const isMonthKey = k => /^\d{4}-\d{2}$/.test(k ?? '')

function PM(period) {
  if (isMonthKey(period)) {
    return {
      label:     monthLabel(period),
      short:     monthLabel(period),
      base:      monthLabel(prevYm(period)),
      baseShort: 'prev',
      recon:     true,
    }
  }
  return PERIOD_META[period] || PERIOD_META.mtd
}

// ─────────────────────────────────────────────────────────────────────────────
// 5 — normCust — the key mechanism
// Maps the active period onto neutral field names so every downstream renderer
// stays period-agnostic. custRaw must never be mutated.
// ─────────────────────────────────────────────────────────────────────────────

function normCust(period, custRaw, months) {
  if (isMonthKey(period)) {
    // Single month: rebuild from the monthly source (ads_ride_summary)
    const cur = period, prev = prevYm(period), by = {}
    ;(months || []).forEach(r => {
      if (r.ym !== cur && r.ym !== prev) return
      const k = `${r.dept}||${r.cust}`
      if (!by[k]) by[k] = {
        dept: r.dept, cust: r.cust,
        sales: 0, lm_sales: 0,
        profit: 0, lm_profit: 0,
        revenue: 0, lm_revenue: 0,
      }
      if (r.ym === cur) {
        by[k].sales   += num(r.sales)
        by[k].profit  += num(r.profit)
        by[k].revenue += num(r.revenue)
      } else {
        by[k].lm_sales   += num(r.sales)
        by[k].lm_profit  += num(r.profit)
        by[k].lm_revenue += num(r.revenue)
      }
    })
    return Object.values(by).map(o => {
      // No prior-year month available from this source
      o.ly_sales  = o.lm_sales
      o.ly_profit = o.lm_profit
      return o
    })
  }

  // Cumulative: pick the right columns from v2
  const m = PM(period)
  return (custRaw || []).map(r => ({
    dept:       r.dept, cust: r.cust,
    sales:      num(r[m.sales]),   lm_sales:   num(r[m.bSales]),
    profit:     num(r[m.profit]),  lm_profit:  num(r[m.bProfit]),
    revenue:    num(r[m.rev]),     lm_revenue: num(r[m.bRev]),
    // 5.2 — only MTD carries a distinct last-year column
    ly_sales:   period === 'mtd' ? num(r.ly_sales)  : num(r[m.bSales]),
    ly_profit:  period === 'mtd' ? num(r.ly_profit) : num(r[m.bProfit]),
  }))
}

// ─────────────────────────────────────────────────────────────────────────────
// 6 — periodMonths + targetAcross
// Targets are stored per-month; cumulative periods must sum across covered months.
// Returning null when any month is missing is deliberate — 6.1.
// ─────────────────────────────────────────────────────────────────────────────

function periodMonths(period, CUR_MONTH) {
  if (isMonthKey(period)) return [period]
  const y = +CUR_MONTH.slice(0, 4), mo = +CUR_MONTH.slice(5, 7), out = []
  const from = period === 'mtd' ? mo
             : period === 'qtd' ? Math.floor((mo - 1) / 3) * 3 + 1
             : 1                                              // ytd
  for (let i = from; i <= mo; i++) out.push(`${y}-${String(i).padStart(2, '0')}`)
  return out
}

function targetAcross(period, CUR_MONTH, targetsRows) {
  const months = periodMonths(period, CUR_MONTH)
  const missing = []
  let total = 0
  months.forEach(ym => {
    let hit = null
    targetsRows.forEach(r => {
      if (r.kind === 'dept' && r.ym === ym && DEPT_TARGET_KEYS.includes(r.dim)) {
        hit = (hit ?? 0) + num(r.tgt)
      }
    })
    if (hit === null) missing.push(ym); else total += hit
  })
  return { total: missing.length ? null : total, missing, months }
}

// buildPeriodTargets — period-summed targets for Geo & Product and Departments tabs.
// Applies stable label mapping for geo (Europe-partition) and product line
// (Private Transfer and variants → Prebooked; Ride Hailing stays).
// Returns empty maps (company=0) for periods where attainment cannot be shown:
//   week          — no weekly targets exist in the source tables.
//   ytdUnavailable — YTD with any month missing (Jan–Apr 2026 absent from mapping tables).
function buildPeriodTargets(period, CUR_MONTH, targetsRows) {
  if (period === 'week') {
    return { dept:{}, geo:{}, product:{}, company:0, ytdUnavailable:false, weekView:true, missingMonths:[] }
  }

  const months = periodMonths(period, CUR_MONTH)
  const availableYms = new Set(targetsRows.map(r => r.ym))
  const missingMonths = months.filter(m => !availableYms.has(m))

  // YTD with any month missing — cannot show a correct full-year cumulative target.
  // Suppressing rather than showing a partial sum (which would overstate attainment 2×).
  if (period === 'ytd' && missingMonths.length > 0) {
    return { dept:{}, geo:{}, product:{}, company:0, ytdUnavailable:true, weekView:false, missingMonths }
  }

  const dept = {}, product = {}
  let geoEurope = 0, geoRest = 0

  months.forEach(ym => {
    targetsRows.filter(r => r.ym === ym).forEach(r => {
      if (r.kind === 'dept') {
        dept[r.dim] = (dept[r.dim] || 0) + num(r.tgt)
      }
      if (r.kind === 'geo') {
        // Europe-partition: sum all non-Europe rows into combined bucket.
        // Robust to BI renaming every month (Americas, Africa/Asia/Oceania, etc.).
        r.dim === 'Europe' ? (geoEurope += num(r.tgt)) : (geoRest += num(r.tgt))
      }
      if (r.kind === 'pl') {
        // Stable mapping: Ride Hailing keeps its label; everything else folds to Prebooked.
        // Covers 'Private Transfer' (May–Jul) and 'Prebooked' (Aug 2026 onward).
        const key = r.dim === 'Ride Hailing' ? 'Ride Hailing' : 'Prebooked'
        product[key] = (product[key] || 0) + num(r.tgt)
      }
    })
  })

  const geo = {
    'Europe':                       geoEurope,
    'Americas/Asia/Africa/Oceania': geoRest,
  }
  const company = DEPT_TARGET_KEYS.reduce((a, k) => a + (dept[k] || 0), 0)

  return { dept, geo, product, company, ytdUnavailable:false, weekView:false, missingMonths }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function KpiTile1({ label, value, valueColor, sub, goal, goalLabel, goalLabelColor, bar, tooltip }) {
  return (
    <div
      title={tooltip ?? ''}
      style={{
        background: T.bg, borderRadius: 10, padding: '14px 16px',
        boxShadow: T.lift, border: `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column', gap: 3,
        cursor: tooltip ? 'help' : 'default',
      }}
    >
      <div style={{ fontSize: 11, color: T.text3, fontWeight: 500, lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: valueColor ?? T.text, lineHeight: 1.2, marginTop: 2 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: T.text3, lineHeight: 1.4 }}>{sub}</div>
      {goal && (
        <div style={{
          fontSize: 11, color: T.text3, display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', marginTop: 2,
        }}>
          <span>{goal}</span>
          {goalLabel && (
            <span style={{ fontWeight: 700, color: goalLabelColor ?? T.text2 }}>{goalLabel}</span>
          )}
        </div>
      )}
      {bar && (
        <div style={{
          height: 4, background: 'rgba(0,0,0,.08)', borderRadius: 2,
          marginTop: 5, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', borderRadius: 2,
            width: `${Math.min(100, bar.pct * 100)}%`,
            background: bar.color,
            transition: 'width 0.5s ease',
          }} />
        </div>
      )}
    </div>
  )
}

function KpiTile2({ label, value, valueColor, sub }) {
  return (
    <div style={{
      background: T.bg, borderRadius: 10, padding: '14px 16px',
      boxShadow: T.lift, border: `1px solid ${T.border}`,
    }}>
      <div style={{ fontSize: 11, color: T.text3, fontWeight: 500, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: valueColor ?? T.text, lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 11, color: T.text3, marginTop: 4 }}>{sub}</div>
    </div>
  )
}

function Banner({ kind, children }) {
  const styles = {
    warn:  { bg: T.amberBg, border: T.amber,  color: T.amberInk },
    info:  { bg: T.blueBg,  border: T.blue,   color: T.blue },
    error: { bg: T.redBg,   border: T.red,    color: T.red },
  }
  const s = styles[kind] ?? styles.info
  return (
    <div style={{
      background: s.bg, border: `1px solid ${s.border}`, borderRadius: 8,
      padding: '10px 14px', marginBottom: 12, fontSize: 13, color: s.color, lineHeight: 1.6,
    }}>
      {children}
    </div>
  )
}

function MoversTable({ title, subtitle, rows, positive, periodShort = 'MTD', baseShort = 'LM' }) {
  return (
    <div style={{
      background: T.bg, borderRadius: 12, boxShadow: T.lift,
      border: `1px solid ${T.border}`, overflow: 'hidden',
    }}>
      <div style={{ padding: '16px 18px 10px' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{title}</div>
        <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{subtitle}</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${T.border}` }}>
            {['CUSTOMER', 'Δ TOTAL PROFIT', periodShort.toUpperCase(), baseShort.toUpperCase()].map((h, i) => (
              <th key={h} style={{
                padding: '6px 16px', fontSize: 10, fontWeight: 600,
                color: T.text3, textAlign: i === 0 ? 'left' : 'right',
                textTransform: 'uppercase', letterSpacing: '0.05em',
                background: T.bg2, whiteSpace: 'nowrap',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} style={{
                padding: '28px 16px', textAlign: 'center',
                fontSize: 13, color: T.text3,
              }}>
                No movers in this direction this month.
              </td>
            </tr>
          ) : rows.map((r, i) => (
            <tr key={i} style={{
              borderBottom: i < rows.length - 1 ? `1px solid ${T.border}` : 'none',
            }}>
              <td style={{ padding: '8px 16px' }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{r.cust}</div>
                <DeptBadge dept={r.rawDept ?? r.dept} />
              </td>
              <td style={{
                padding: '8px 16px', textAlign: 'right',
                fontWeight: 700, fontSize: 13,
                color: r.delta > 0 ? T.green : T.red,
              }}>
                {r.delta > 0 ? '+' : ''}{usd(r.delta, 0)}
              </td>
              <td style={{ padding: '8px 16px', textAlign: 'right', fontSize: 13, color: T.text }}>
                {usd(r.profit, 0)}
              </td>
              <td style={{ padding: '8px 16px', textAlign: 'right', fontSize: 13, color: T.text3 }}>
                {usd(r.lmProfit, 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SkeletonGrid({ cols, rows: rowCount, height = 130 }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 12, marginBottom: 12,
    }}>
      {[...Array(cols * rowCount)].map((_, i) => (
        <div key={i} style={{
          height, borderRadius: 10,
          background: 'rgba(0,0,0,.06)',
          animation: 'ldPulse 1.5s ease-in-out infinite',
        }} />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

const TABS = [
  'Executive Summary', 'Forecast', 'Departments', 'Customers',
  'GEO & Product', 'B2C',
  'Ride Hailing', 'Quality', 'AI Code & Test',
]

export default function LeadershipDashboard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = parseInt(searchParams.get('tab') || '0', 10)
  const activeTab = isNaN(tabParam) ? 0 : Math.max(0, Math.min(8, tabParam))
  const [period,     setPeriodState] = useState('mtd') // MTD by default; month-picker mode only when user explicitly selects a YYYY-MM key
  // Read `snapshot` (or `asAt`) param on mount — stored raw; validated against snapDates after first fetch
  const pendingSnapRef = React.useRef(
    searchParams.get('snapshot') || searchParams.get('asAt') || null
  )
  const [asAt,       setAsAt]        = useState(null)       // null = latest snapshot
  const [D,          setD]           = useState({ cust: [], targets: [], fc: [], months: [], fcc: [], prod: [], geo: [], b2c: [], b2cM: [], rh: [], mq: [], ai: [], wilson: [], snapDates: [], asAt: null, queried_at: null, staleness: null, fcVintage: null, fccVintage: null, custPrev: [], prevSnapDate: null, prodWeekEmpty: false, geoWeekEmpty: false })
  const [loading,    setLoading]     = useState(false)
  const [error,      setError]       = useState(null)
  const [usingCache, setUsingCache]  = useState(false)
  const [cachedAt,   setCachedAt]    = useState(null)
  const [refreshKey, setRefreshKey]  = useState(0)

  // CUR_MONTH derives from the selected snapshot date (first 7 chars of YYYY-MM-DD).
  // Falls back to system clock only before first fetch. This ensures Achievement,
  // Gap to target, forecast and all target lookups always match the snapshot.
  const snapMonth = (D.asAt ?? D.snapDates[0] ?? '').slice(0, 7)
  const CUR_MONTH = snapMonth || curMonth()
  const PC        = PM(period)           // 4 — always use PM(), never branch on period directly

  // 2.1 — correct guard: month keys are valid even though they're not in PERIOD_META
  const setPeriod = k => {
    if (!PERIOD_META[k] && !isMonthKey(k)) return
    setPeriodState(k)
  }

  // Derived: is the selected asAt the latest available snapshot?
  const isLatestSnap = !asAt || asAt === D.snapDates[0]

  // periodRef: lets the snapshot auto-set useEffect read the current period value
  // without adding it to the dependency array (which would cause an infinite loop).
  const periodRef = React.useRef(period)
  useEffect(() => { periodRef.current = period }, [period])

  // Auto-set period to the snapshot month ONLY when already in month-picker mode.
  // If the user is on MTD / QTD / YTD / Week, do NOT clobber their selection.
  useEffect(() => {
    if (!isMonthKey(periodRef.current)) return  // preserve MTD/QTD/YTD/Week
    const sm = (D.asAt ?? D.snapDates[0] ?? '').slice(0, 7)
    if (sm && isMonthKey(sm)) setPeriodState(sm)
  }, [D.asAt, D.snapDates]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Data fetch (9.2) ──────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    setUsingCache(false)

    try {
      // Pass asAt and period so the edge function selects the right query branch.
      // Month-key periods ('2026-08') use D.months client-side; map to 'mtd' for edge call.
      const edgePeriod = PERIOD_META[period] ? period : 'mtd'
      const { data, error: fnErr } = await supabase.functions.invoke(EDGE_FN, { body: { asAt, period: edgePeriod } })
      if (fnErr || data?.error) {
        throw new Error(fnErr?.message || data?.error || 'Edge function returned an error')
      }
      const result = {
        cust:      Array.isArray(data.cust)      ? data.cust      : [],
        targets:   Array.isArray(data.targets)   ? data.targets   : [],
        fc:        Array.isArray(data.fc)        ? data.fc        : [],
        months:    Array.isArray(data.months)    ? data.months    : [],
        fcc:       Array.isArray(data.fcc)       ? data.fcc       : [],
        prod:      Array.isArray(data.prod)      ? data.prod      : [],
        geo:       Array.isArray(data.geo)       ? data.geo       : [],
        b2c:       Array.isArray(data.b2c)       ? data.b2c       : [],
        b2cM:      Array.isArray(data.b2cM)      ? data.b2cM      : [],
        rh:        Array.isArray(data.rh)        ? data.rh        : [],
        mq:        Array.isArray(data.mq)        ? data.mq        : [],
        ai:        Array.isArray(data.ai)        ? data.ai        : [],
        wilson:    Array.isArray(data.wilson)    ? data.wilson    : [],
        snapDates: Array.isArray(data.snapDates) ? data.snapDates : [],
        asAt:      data.asAt      ?? null,
        queried_at: data.queried_at ?? null,
        staleness: data.staleness ?? null,
        fcVintage:    data.fcVintage   ?? null,
        fccVintage:   data.fccVintage  ?? null,
        custPrev:     Array.isArray(data.custPrev) ? data.custPrev : [],
        prevSnapDate: data.prevSnapDate ?? null,
        prodWeekEmpty: data.prod_week_empty ?? false,
        geoWeekEmpty:  data.geo_week_empty  ?? false,
      }
      setD(result)
      cacheWrite(asAt, edgePeriod, result)
      setCachedAt(null)
    } catch (err) {
      // Fall back to last good cache (9.2)
      const cached = cacheRead(asAt, edgePeriod)
      if (cached?.data) {
        setD(cached.data)
        setUsingCache(true)
        setCachedAt(cached.ts)
      } else {
        setError(err?.message || 'Failed to load data from edge function.')
      }
    } finally {
      setLoading(false)
    }
  }, [asAt, period]) // re-fetch whenever asAt or period changes

  // After the first successful fetch, apply pendingSnapRef if it's a valid date
  useEffect(() => {
    if (!pendingSnapRef.current) return
    if (!D.snapDates.length) return
    const candidate = pendingSnapRef.current
    pendingSnapRef.current = null // consume it — only runs once
    if (D.snapDates.includes(candidate)) {
      setAsAt(candidate)
    }
    // if candidate isn't a known date, silently fall back to latest (no-op)
  }, [D.snapDates]) // runs whenever snapDates loads (first fetch only in practice)

  useEffect(() => { fetchData() }, [fetchData, refreshKey])

  // ── Derived data ───────────────────────────────────────────────────────────
  // cust is normalized once here — never pass D.cust directly to renderers
  const cust       = normCust(period, D.cust,     D.months)  // 5 — neutral field names
  // custPrev must go through the same normCust() so DepartmentsTab.buildDepts
  // receives field names {profit, sales, revenue, lm_profit, ...} not {m_profit, m_sales, ...}
  // Fix 1a+1b (Departments fix guide): raw rows have m_profit, not profit.
  const custPrevNorm = normCust(period, D.custPrev, D.months) // normalized prev snapshot rows
  const depts  = buildDepts(cust)                       // Map<dept, neutralAgg>
  const t      = totals(depts)
  const targets = buildTargets(D.targets, CUR_MONTH)    // dept targets for Exec Summary compat
  const pace   = monthPace(CUR_MONTH, D.asAt ?? D.snapDates[0] ?? null)

  // All reads use neutral names — no more PC.profitF etc.
  const profit   = t.profit
  const lmProfit = t.lm_profit
  const sales    = t.sales
  const lmSales  = t.lm_sales
  const revenue  = t.revenue
  const lmRev    = t.lm_revenue
  const lyProfit = t.ly_profit

  // 6 — company target spans the full period (null if any month missing)
  const tgtSpan    = targetAcross(period, CUR_MONTH, D.targets)
  const periodTgts = buildPeriodTargets(period, CUR_MONTH, D.targets || [])
  const company    = tgtSpan.total ?? 0
  const targetOk   = company > 0

  const ach    = targetOk ? profit / company : null
  const gap    = targetOk ? company - profit : null
  const behind = ach !== null && ach < pace.frac

  // Forecast (5.4)
  const fcByMonth = {}
  for (const r of D.fc) {
    if (!fcByMonth[r.ym]) fcByMonth[r.ym] = { pro: 0, pro_lo: 0, pro_hi: 0, committed: 0 }
    fcByMonth[r.ym].pro       += num(r.pro)
    fcByMonth[r.ym].pro_lo    += num(r.pro_lo)
    fcByMonth[r.ym].pro_hi    += num(r.pro_hi)
    fcByMonth[r.ym].committed += num(r.committed)
  }
  const fcMonths  = Object.keys(fcByMonth).sort()
  const fcCurData = fcByMonth[CUR_MONTH]
  const fcProfit  = fcCurData?.pro  ?? 0
  const fcLo      = fcCurData?.pro_lo ?? 0
  const fcHi      = fcCurData?.pro_hi ?? 0
  const fcAch     = (fcProfit && company) ? fcProfit / company : null
  const fcDate    = D.fc[0]?.fdate ?? null

  // Margin
  const margin      = revenue > 0 ? profit   / revenue   : null
  const lmMargin    = lmRev   > 0 ? lmProfit / lmRev     : null
  const marginDelta = (margin !== null && lmMargin !== null) ? margin - lmMargin : null

  // Active customers — unique customer names.
  // FIX 4 (Customers tab fix guide 4): align to Customers tab — use 118 on both.
  //  - 117 distinct named customers + 1 '(Unknown)' = 118 total.
  //  - (Unknown) has $268 profit and IS shown on the Customers tab.
  //  - Showing it as 'on file' is consistent with showing its row rather than silently dropping $268.
  //  - Active: 76 named + 1 (Unknown) with profit ≠ 0 = 77.
  //  - D.cust.length (119) is at (dept × customer) grain — overcounts when a cust appears in >1 dept.
  const custNames = new Set(
    D.cust.map(r => r.cust).filter(n => n)   // include (Unknown); exclude empty/null only
  )
  const activeCustNames = new Set(
    cust.filter(r => r.sales !== 0 || r.profit !== 0)
        .map(r => r.cust)
        .filter(n => n)                        // include (Unknown) if it is active
  )
  const activeCust    = activeCustNames.size   // 77 (76 named + (Unknown))
  const totalCustFile = custNames.size         // 118 (117 named + (Unknown))

  // 7.1 — guard: if months failed and user had a month selected, fall back to mtd
  const monthList = availableMonths(D.months, CUR_MONTH)
  if (monthList.length === 0 && isMonthKey(period)) setPeriod('mtd')

  // ── QA log (9.3) — permanent audit trail ─────────────────────────────────
  if (D.cust.length > 0) {
    const deptSum = [...depts.values()].reduce((a, d) => a + d.profit, 0)
    console.log(
      `QA|profit=${profit.toFixed(2)}|revenue=${revenue.toFixed(2)}|sales=${sales.toFixed(2)}` +
      `|lm_profit=${lmProfit.toFixed(2)}|ly_profit=${lyProfit.toFixed(2)}` +
      `|deptSum=${deptSum.toFixed(2)}|period=${period}|target=${company.toFixed(2)}` +
      `|ach=${ach?.toFixed(6) ?? 'null'}|pace=${pace.elapsed}/${pace.days}` +
      `|fcCur=${fcProfit.toFixed(0)}|nDepts=${depts.size}|nCust=${D.cust.length}`
    )
    if (Math.abs(deptSum - profit) > 0.02) {
      console.error(`QA FAIL: deptSum(${deptSum.toFixed(2)}) !== profit(${profit.toFixed(2)}) — rollup broken`)
    }
    const deptLog = [...depts.entries()]
      .map(([k, d]) => {
        const tgt = targets.dept[k]
        const rat = tgt ? (d.profit / tgt).toFixed(6) : 'n/a'
        return `${k}:${d.profit.toFixed(2)}/${tgt ?? 0}=${rat}`
      })
      .join(' ')
    console.log(`QA|depts=${deptLog}`)
  }

  // contextChip removed — was computed but never rendered and showed the
  // current render date, which contradicts the snapshot selector.

  // ── Movers ─────────────────────────────────────────────────────────────────
  const moversRaw = cust
    .map(r => ({
      cust:     r.cust,
      dept:     DEPT_ROLLUP[r.dept] ?? r.dept ?? '(Unassigned)',
      rawDept:  r.dept,
      profit:   r.profit,
      lmProfit: r.lm_profit,
      delta:    r.profit - r.lm_profit,
    }))
    .filter(r => r.delta !== 0)

  const topGains    = [...moversRaw].filter(r => r.delta > 0)
                        .sort((a, b) => b.delta - a.delta).slice(0, 10)
  const topDeclines = [...moversRaw].filter(r => r.delta < 0)
                        .sort((a, b) => a.delta - b.delta).slice(0, 10)
  const gainsSum    = topGains.reduce((a, r) => a + r.delta, 0)
  const declinesSum = topDeclines.reduce((a, r) => a + r.delta, 0)

  // ── Department bar chart (left, 7.5) ─────────────────────────────────────
  const deptRows = DEPT_TARGET_KEYS
    .map(k => ({
      dept:   k,
      profit: depts.get(k)?.profit ?? 0,
      target: targets.dept[k] ?? 0,
    }))
    .filter(r => r.target > 0 || r.profit > 0)
    .sort((a, b) => (b.target || b.profit) - (a.target || a.profit))

  const deptChartData = {
    labels: deptRows.map(r => r.dept),
    datasets: [
      {
        label: `${PC.short} total profit`,
        data:  deptRows.map(r => r.profit),
        backgroundColor: T.blue,
        borderRadius: 3,
        barPercentage: 0.62,
        categoryPercentage: 0.85,
      },
      {
        label: 'Target',
        data:  deptRows.map(r => r.target),
        backgroundColor: 'rgba(0,0,0,.11)',
        borderRadius: 3,
        barPercentage: 0.62,
        categoryPercentage: 0.85,
      },
    ],
  }

  const deptChartOpts = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: { boxWidth: 10, font: { size: 11 }, padding: 14 },
      },
      datalabels: {
        display: true,
        anchor: 'end',
        align: 'end',
        formatter: v => v > 0 ? usdC(v) : '',
        font: { size: 10, weight: '600' },
        color: T.text2,
      },
      tooltip: {
        callbacks: {
          label: ctx => `${ctx.dataset.label}: ${usd(ctx.raw)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: 'rgba(0,0,0,.06)' },
        border: { display: false },
        ticks: { callback: v => usdC(v), font: { size: 10 }, color: T.text3 },
        grace: '16%',
      },
      y: {
        grid: { display: false },
        border: { display: false },
        ticks: { font: { size: 11 }, color: T.text2 },
      },
    },
  }

  // ── Forecast outlook chart (right, 7.5) ──────────────────────────────────
  const fcChartData = {
    labels: fcMonths,
    datasets: [
      {
        type: 'bar',
        label: 'Booked to date',
        data:  fcMonths.map(m => m === CUR_MONTH ? profit : null),
        backgroundColor: T.green,
        order: 2,
        borderRadius: 3,
      },
      {
        type: 'bar',
        label: 'Forecast profit',
        data:  fcMonths.map(m => m !== CUR_MONTH ? (fcByMonth[m]?.pro ?? null) : null),
        backgroundColor: T.blue,
        order: 2,
        borderRadius: 3,
      },
      {
        type: 'line',
        label: 'Target',
        data:  fcMonths.map(() => company > 0 ? company : null),
        borderColor: 'rgba(0,0,0,.25)',
        borderWidth: 1.5,
        borderDash: [4, 4],
        pointRadius: 0,
        tension: 0,
        fill: false,
        order: 1,
      },
      {
        type: 'line',
        label: 'Forecast high',
        data:  fcMonths.map(m => fcByMonth[m]?.pro_hi ?? null),
        borderColor: 'rgba(24,95,165,.4)',
        borderWidth: 1,
        borderDash: [3, 3],
        pointRadius: 0,
        tension: 0.3,
        fill: '+1',
        backgroundColor: 'rgba(24,95,165,.06)',
        order: 1,
      },
      {
        type: 'line',
        label: 'Forecast low',
        data:  fcMonths.map(m => fcByMonth[m]?.pro_lo ?? null),
        borderColor: 'rgba(24,95,165,.4)',
        borderWidth: 1,
        borderDash: [3, 3],
        pointRadius: 0,
        tension: 0.3,
        fill: false,
        order: 1,
      },
    ],
  }

  const fcChartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: { boxWidth: 10, font: { size: 11 }, padding: 14 },
      },
      datalabels: {
        display: ctx => ctx.dataset.type === 'bar' && ctx.raw != null,
        anchor: 'end', align: 'end',
        formatter: v => v != null ? usdC(v) : '',
        font: { size: 10, weight: '600' },
        color: T.text2,
      },
      tooltip: { mode: 'index', intersect: false },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 11 }, color: T.text3 },
      },
      y: {
        grid: { color: 'rgba(0,0,0,.06)' },
        border: { display: false },
        ticks: { callback: v => usdC(v), font: { size: 10 }, color: T.text3 },
        beginAtZero: true,
      },
    },
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const hasData = D.cust.length > 0

  return (
    <div style={{
      minHeight: '100%',
      background: 'var(--bg)',
      fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      WebkitFontSmoothing: 'antialiased',
    }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ background: T.bg, borderBottom: `1px solid ${T.border}` }}>
        {/* Controls bar — period selector + refresh, right-aligned */}
        <div style={{
          padding: '0 24px',
          display: 'flex', alignItems: 'center', gap: 10, height: 52,
        }}>
          <div style={{ flex: 1 }} />

          {/* Period selector — hidden in month-picker mode (when a specific YYYY-MM is active).
              'Last complete week' only shown on Geo & Product (tab 4). */}
          {!isMonthKey(period) && (
            <div style={{ position: 'relative' }}>
              <select
                id="ld-period-select"
                value={period}
                onChange={e => setPeriod(e.target.value)}
                style={{
                  fontSize: 13, fontWeight: 600,
                  border: `1px solid ${T.border2}`, borderRadius: 6,
                  padding: '5px 30px 5px 10px', background: T.bg,
                  color: T.text, cursor: 'pointer', outline: 'none',
                  fontFamily: 'inherit', appearance: 'none',
                  minWidth: 150,
                }}
              >
                {(activeTab === 4 ? GEO_PRODUCT_PERIODS : STANDARD_PERIODS).map(k => (
                  <option key={k} value={k}>{PERIOD_META[k].label}</option>
                ))}
              </select>
              <svg style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: T.text3 }}
                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          )}

          {/* 'As at' snapshot selector — only shown when snap metadata is loaded */}
          {D.snapDates.length > 0 && (
            <div style={{ position: 'relative' }}>
              <select
                id="ld-snap-select"
                value={asAt ?? ''}
                onChange={e => {
                  const val = e.target.value || null
                  setAsAt(val)
                  // Write back to URL so the view is shareable
                  setSearchParams(prev => {
                    const next = new URLSearchParams(prev)
                    if (val) next.set('snapshot', val)
                    else next.delete('snapshot')
                    return next
                  }, { replace: true })
                }}
                style={{
                  fontSize: 13, fontWeight: 600,
                  border: `1px solid ${T.border2}`, borderRadius: 6,
                  padding: '5px 30px 5px 10px', background: T.bg,
                  color: T.text, cursor: 'pointer', outline: 'none',
                  fontFamily: 'inherit', appearance: 'none',
                  minWidth: 160,
                }}
              >
                <option value="">Latest ({D.snapDates[0] ?? '…'})</option>
                {D.snapDates.slice(1).map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <svg
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: T.text3 }}
                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              >
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
          )}


          {/* Refresh */}
          <button
            id="ld-refresh-btn"
            onClick={() => setRefreshKey(k => k + 1)}
            disabled={loading}
            style={{
              fontSize: 13, fontWeight: 600, padding: '5px 14px',
              border: `1px solid ${T.border2}`, borderRadius: 6,
              background: T.bg, color: T.text2, cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', opacity: loading ? 0.6 : 1,
              transition: 'opacity 0.2s',
            }}
          >
            {loading ? '…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Page content ────────────────────────────────────────────────────── */}
      <div style={{ padding: '20px 24px 48px' }}>

        {/* ── B2C tab ─────────────────────────────────────────────────── */}
        {activeTab === 5 ? (
          !loading ? (
            <B2CTab D={D} period={period} CUR_MONTH={CUR_MONTH} PC={PC} PM={PC}/>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: T.text3, fontSize: 13 }}>Loading…</div>
          )
        ) : null}

        {/* ── Ride Hailing tab ─────────────────────────────────────────────── */}
        {activeTab === 6 ? (
          !loading ? (
            <RideHailingTab D={D} period={period} CUR_MONTH={CUR_MONTH} PM={PC}/>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: T.text3, fontSize: 13 }}>Loading…</div>
          )
        ) : null}

        {/* ── Quality tab ──────────────────────────────────────────────────── */}
        {activeTab === 7 ? (
          !loading ? (
            <QualityTab D={D} period={period} CUR_MONTH={CUR_MONTH} PM={PC}/>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: T.text3, fontSize: 13 }}>Loading…</div>
          )
        ) : null}

        {/* ── AI Code & Test tab ───────────────────────────────────────────── */}
        {activeTab === 8 ? (
          <AIEngineeringTab D={D}/>
        ) : null}

        {/* ── GEO & Product tab ─────────────────────────────────────────── */}
        {activeTab === 4 ? (
          !loading ? (
          <GeoProductTab
              D={D}
              period={period}
              CUR_MONTH={CUR_MONTH}
              PC={PC}
              asAt={D.asAt}
              periodTgts={periodTgts}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: T.text3, fontSize: 13 }}>Loading…</div>
          )
        ) : null}

        {/* ── Forecast tab ──────────────────────────────────────────────── */}
        {activeTab === 1 ? (
          !loading && D.fc.length > 0 ? (
          <ForecastTab
              D={D}
              period={period}
              CUR_MONTH={CUR_MONTH}
              targets={targets}
              PC={PC}
              fcVintage={D.fcVintage}
              fccVintage={D.fccVintage}
              asAt={D.asAt}
            />
          ) : loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: T.text3, fontSize: 13 }}>Loading…</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 16 }}>
              <div style={{ fontSize: 13, color: T.text3 }}>No forecast data — click Refresh to load.</div>
              <button onClick={() => setRefreshKey(k => k + 1)} style={{ background: T.blue, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>↻ Load Data</button>
            </div>
          )
        ) : null}

        {/* ── Customers tab ──────────────────────────────────────────────── */}
        {activeTab === 3 ? (
          !loading && cust.length > 0 ? (
            <CustomersTab
              cust={cust}
              custPrev={custPrevNorm}
              prevSnapDate={D.prevSnapDate}
              asAt={D.asAt ?? D.snapDates[0] ?? null}
              period={period}
              CUR_MONTH={CUR_MONTH}
              PC={PC}
              targets={targets}
            />
          ) : loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: T.text3, fontSize: 13 }}>Loading…</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 16 }}>
              <div style={{ fontSize: 13, color: T.text3 }}>No data yet — click Refresh to load.</div>
              <button onClick={() => setRefreshKey(k => k + 1)} style={{ background: T.blue, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>↻ Load Data</button>
            </div>
          )
        ) : null}

        {/* ── Departments tab ──────────────────────────────────────────────── */}
        {activeTab === 2 ? (
          !loading && cust.length > 0 ? (
            <DepartmentsTab
              cust={cust}
              custPrev={custPrevNorm}
              prevSnapDate={D.prevSnapDate}
              asAt={D.asAt}
              period={period}
              CUR_MONTH={CUR_MONTH}
              targets={targets}
              tgtSpan={tgtSpan}
              periodTgts={periodTgts}
              PC={PC}
            />
          ) : loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: T.text3, fontSize: 13 }}>
              Loading…
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 16 }}>
              <div style={{ fontSize: 13, color: T.text3 }}>No data yet — click Refresh to load.</div>
              <button onClick={() => setRefreshKey(k => k + 1)} style={{ background: T.blue, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>↻ Load Data</button>
            </div>
          )
        ) : activeTab === 0 ? (<>

        {/* Section header */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, margin: 0 }}>
              Executive Summary
            </h1>
            {/* Snapshot date badge — single instance, beside the page title. */}
            {/* FIX 2: fall back to snapDates[0] so badge never shows '...' */}
            {/* after data loads. D.asAt is null until the first fetch succeeds. */}
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
              background: T.bg4, color: T.text3, letterSpacing: '0.04em',
            }}>
              Data as of {D.asAt ?? D.snapDates[0] ?? '…'}
            </span>
          </div>
          <div style={{ fontSize: 13, color: T.text3, marginTop: 4 }}>
            {isMonthKey(period) ? PC.label : monthLabel(CUR_MONTH)} total profit against target, compared with{' '}
            {PC.base}
            {PC.recon ? ' — reconstructed source' : ''}
          </div>
        </div>

        {/* ── Banners ─────────────────────────────────────────────────────── */}
        {usingCache && (
          <Banner kind="warn">
            ⚠️ Some figures are cached, not live. Cached at{' '}
            {cachedAt ? new Date(cachedAt).toLocaleString() : 'unknown time'}.{' '}
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              style={{
                marginLeft: 8, fontSize: 12, fontWeight: 600, padding: '2px 10px',
                borderRadius: 5, border: `1px solid ${T.amberInk}`, background: 'transparent',
                color: T.amberInk, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >Retry now</button>
          </Banner>
        )}

        {/* Staleness banner — shown when source was stale at capture (7 migration spec) */}
        {D.staleness?.is_stale && (
          <Banner kind="warn">
            ⚠️ Source data was {D.staleness.staleness_days} day(s) stale when this snapshot was captured.
          </Banner>
        )}

        {/* Historical snapshot banner — shown when viewing a past snapshot */}
        {!isLatestSnap && D.asAt && (
          <Banner kind="info">
            Showing snapshot {D.asAt} · not the current week
          </Banner>
        )}

        {targets.missing && period === 'mtd' && (
          <Banner kind="warn">
            ⚠️ No total profit target loaded for <strong>{CUR_MONTH}</strong>. Using{' '}
            <strong>{targets.month}</strong> targets instead. Actuals are complete.
          </Banner>
        )}

        {error && (
          <Banner kind="error">
            ⚠️ {error}{' '}
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              style={{
                marginLeft: 8, fontSize: 12, fontWeight: 600, padding: '2px 10px',
                borderRadius: 5, border: `1px solid ${T.red}`, background: 'transparent',
                color: T.red, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >Retry now</button>
            <button
              onClick={() => { cacheWrite(asAt, PERIOD_META[period] ? period : 'mtd', null); localStorage.removeItem(cacheKey(asAt, PERIOD_META[period] ? period : 'mtd')); setRefreshKey(k => k + 1) }}
              style={{
                marginLeft: 6, fontSize: 12, fontWeight: 600, padding: '2px 10px',
                borderRadius: 5, border: `1px solid ${T.red}`, background: 'transparent',
                color: T.red, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >Clear cache & retry</button>
          </Banner>
        )}


        {/* Section label */}
        {!loading && hasData && (
          <div style={{
            fontSize: 11, fontWeight: 700, color: T.text3,
            letterSpacing: '0.07em', textTransform: 'uppercase',
            marginBottom: 12, paddingBottom: 8,
            borderBottom: `1px solid ${T.border}`,
          }}>
            {isMonthKey(period) ? PC.label : monthLabel(CUR_MONTH)} — TOTAL PROFIT AGAINST TARGET
          </div>
        )}

        {/* ── KPI Row 1 ────────────────────────────────────────────────────── */}
        {loading ? (
          <SkeletonGrid cols={5} rows={1} height={130} />
        ) : hasData ? (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 12, marginBottom: 12,
          }}>
            {/* 1 — Total Profit */}
            <KpiTile1
              label={`${PC.short} Total Profit`}
              value={usdC(profit)}
              sub={`Complete GMV ${usdC(revenue)}`}
              goal={targetOk ? `vs target ${usdC(company)}` : 'No target loaded'}
              goalLabel={ach !== null ? pctFmt(ach, 0) : null}
              goalLabelColor={achColor(ach)}
              bar={ach !== null ? { pct: Math.min(1, ach), color: achColor(ach) } : null}
            />

            {/* 2 — Achievement */}
            <KpiTile1
              label="Achievement"
              value={ach !== null ? pctFmt(ach, 1) : '—'}
              valueColor={ach !== null ? achColor(ach) : T.text3}
              sub={ach !== null
                ? (behind ? 'Behind straight-line pace' : 'Ahead of straight-line pace')
                : 'No target loaded'}
              goal={ach !== null ? `vs pace ${pctFmt(pace.frac, 0)}` : null}
              goalLabel={ach !== null
                ? `${ach - pace.frac >= 0 ? '+' : ''}${((ach - pace.frac) * 100).toFixed(1)} pts`
                : null}
              goalLabelColor={ach !== null && ach >= pace.frac ? T.green : T.red}
              bar={ach !== null ? { pct: Math.min(1, ach), color: achColor(ach) } : null}
            />

            {/* 3 — Gap to target */}
            <KpiTile1
              label="Gap to target"
              value={gap !== null ? usdC(Math.abs(gap)) : 'n/a'}
              valueColor={gap !== null ? (gap > 0 ? T.red : T.green) : T.text3}
              sub={gap !== null
                ? (gap > 0 ? 'still to book' : 'target exceeded')
                : `targets incomplete for ${PC.short}`}
            />

            {/* 4 — Projected Month-End Profit */}
            <KpiTile1
              label="Projected Month-End Total Profit"
              value={fcProfit ? usdC(fcProfit) : '—'}
              sub={fcProfit
                ? `Likely range ${usdC(fcLo)} – ${usdC(fcHi)}`
                : 'No forecast data'}
              goal={fcAch !== null ? 'vs target' : null}
              goalLabel={fcAch !== null ? pctFmt(fcAch, 0) : null}
              goalLabelColor={achColor(fcAch)}
              bar={fcAch !== null ? { pct: Math.min(1, fcAch), color: achColor(fcAch) } : null}
              tooltip={
                `Where the full month is projected to finish, from the forward-booking model (fwd_v2` +
                (fcDate ? `, run ${String(fcDate).slice(0, 10)}` : '') +
                `). Not a straight-line extrapolation — built from bookings already on the books for the rest of the month plus modelled pickup.`
              }
            />

            {/* 5 — Profit margin */}
            <KpiTile1
              label="Profit margin"
              value={pctFmt(margin, 1)}
              sub={marginDelta !== null
                ? (
                  <span style={{ color: marginDelta >= 0 ? T.green : T.red }}>
                    {marginDelta >= 0 ? '+' : ''}{(marginDelta * 100).toFixed(1)} pts vs {PC.baseShort}
                  </span>
                )
                : '—'}
            />
          </div>
        ) : null}

        {/* ── KPI Row 2 ────────────────────────────────────────────────────── */}
        {loading ? (
          <SkeletonGrid cols={4} rows={1} height={110} />
        ) : hasData ? (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 12, marginBottom: 20,
          }}>
            <KpiTile2
              label={`Total Profit vs ${PC.baseShort}`}
              value={signed(profit - lmProfit)}
              valueColor={(profit - lmProfit) > 0 ? T.green : (profit - lmProfit) < 0 ? T.red : T.text3}
              sub={`${pctFmt(profitPct(profit, lmProfit), 1)} · ${PC.baseShort} ${usdC(lmProfit)}`}
            />
            <KpiTile2
              label={`Original Sales Amount vs ${PC.base}`}
              value={signed(sales - lmSales)}
              valueColor={(sales - lmSales) > 0 ? T.green : (sales - lmSales) < 0 ? T.red : T.text3}
              sub={`${pctFmt(salesPct(sales, lmSales), 1)} · ${PC.short} ${usdC(sales)}`}
            />
            <KpiTile2
              label={`Total Profit vs last year ${PC.short}`}
              value={signed(profit - lyProfit)}
              valueColor={(profit - lyProfit) > 0 ? T.green : (profit - lyProfit) < 0 ? T.red : T.text3}
              sub={`${pctFmt(profitPct(profit, lyProfit), 1)} · LY ${usdC(lyProfit)}`}
            />
            <KpiTile2
              label="Active customers"
              value={numFmt(activeCust)}
              sub={`of ${numFmt(totalCustFile)} accounts on file`}
            />
          </div>
        ) : null}

        {/* ── Charts row ───────────────────────────────────────────────────── */}
        {!loading && hasData && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>

            {/* Left: Total Profit vs target by department */}
            <div style={{
              background: T.bg, borderRadius: 12, padding: '18px 20px',
              boxShadow: T.lift, border: `1px solid ${T.border}`,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
                Total Profit vs target by department
              </div>
              <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
                {PC.short} {isMonthKey(period) ? PC.label : monthLabel(CUR_MONTH)}
                {targets.monthIsFallback ? ` · target ${targets.month} (fallback)` : ''}
              </div>
              <div style={{ height: 260, marginTop: 14 }}>
                {deptRows.length > 0 ? (
                  <Bar data={deptChartData} options={deptChartOpts} />
                ) : (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    height: '100%', color: T.text3, fontSize: 13,
                  }}>
                    No department data
                  </div>
                )}
              </div>
            </div>

            {/* Right: Total Profit outlook by pickup month */}
            <div style={{
              background: T.bg, borderRadius: 12, padding: '18px 20px',
              boxShadow: T.lift, border: `1px solid ${T.border}`,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
                Total Profit outlook by pickup month
              </div>
              <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
                Booked to date vs forward-booking forecast, with model range
              </div>
              <div style={{ height: 260, marginTop: 14 }}>
                {fcMonths.length > 0 ? (
                  <Bar data={fcChartData} options={fcChartOpts} />
                ) : (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    height: '100%', color: T.text3, fontSize: 13,
                  }}>
                    No forecast data available
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Loading skeleton for charts */}
        {loading && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            {[...Array(2)].map((_, i) => (
              <div key={i} style={{
                height: 320, borderRadius: 12,
                background: 'rgba(0,0,0,.06)',
                animation: 'ldPulse 1.5s ease-in-out infinite',
              }} />
            ))}
          </div>
        )}

        {/* ── Movers row ───────────────────────────────────────────────────── */}
        {!loading && hasData && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <MoversTable
              title={`Top 10 total profit gains vs ${PC.base}`}
              subtitle={`Where the growth is coming from · ${usdC(gainsSum)} combined`}
              rows={topGains}
              positive
              periodShort={PC.short}
              baseShort={PC.baseShort}
            />
            <MoversTable
              title={`Top 10 total profit declines vs ${PC.base}`}
              subtitle={`Where the leak is, the action list · ${usdC(declinesSum)} combined`}
              rows={topDeclines}
              positive={false}
              periodShort={PC.short}
              baseShort={PC.baseShort}
            />
          </div>
        )}

        {/* ── Empty state (no data, no error) ─────────────────────────────── */}
        {!loading && !hasData && !error && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', minHeight: 380, gap: 18,
            background: T.bg, borderRadius: 12, boxShadow: T.lift,
          }}>
            <div style={{ fontSize: 44 }}>📊</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: T.navy }}>
              Weekly EAM Performance
            </div>
            <div style={{
              fontSize: 13, color: T.text3, textAlign: 'center',
              maxWidth: 420, lineHeight: 1.75,
            }}>
              Leadership dashboard powered by BigQuery.<br />
              Click <strong>Refresh</strong> to load live data via the{' '}
              <code style={{ background: T.bg4, padding: '1px 6px', borderRadius: 4 }}>
                leadership-dashboard
              </code>{' '}
              edge function.
            </div>
            <button
              onClick={() => setRefreshKey(k => k + 1)}
              style={{
                marginTop: 8, background: T.blue, color: '#fff', border: 'none',
                borderRadius: 10, padding: '12px 28px', fontFamily: 'inherit',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(24,95,165,.28)',
                transition: 'transform 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-1px)'
                e.currentTarget.style.boxShadow = '0 6px 20px rgba(24,95,165,.38)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'none'
                e.currentTarget.style.boxShadow = '0 4px 14px rgba(24,95,165,.28)'
              }}
            >
              ↻ Load Data
            </button>
          </div>
        )}
        </>): null}
      </div>

      <style>{`
        @keyframes ldPulse {
          0%, 100% { opacity: 1 }
          50%       { opacity: 0.45 }
        }
      `}</style>
    </div>
  )
}
