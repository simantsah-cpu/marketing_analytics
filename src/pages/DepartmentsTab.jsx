/**
 * DepartmentsTab.jsx
 * Weekly EAM Performance — Departments tab
 *
 * Reuses Q_CUST + Q_TARGETS already fetched by the leadership-dashboard edge function.
 * No new queries. Spec: ORBIT_DEPT_SPEC.md
 *
 * Key invariants (§0):
 *  - Sales Mo folds into EAM Chris, Sales Jojo into EAM Gloria (actuals + targets)
 *  - Sub-teams are NEVER added to the Total — they are already inside their parent
 *  - Company target = exactly 4 depts, not the sum of the target column
 *  - Profit is summed from Q_CUST rows, never recomputed
 *
 * §3 — snap-based weekly growth:
 *  - custPrev holds Q_CUST run against the previous snapshot date (same subquery)
 *  - deltaProfit = mtdProfit(asAt) − mtdProfit(prevSnapshot), per department
 *  - deltaPts    = deltaProfit / target × 100 (exact, because target is constant)
 *  - §4.1 gap labelling: N-day, not "weekly", until a genuine 7-day pair exists
 *  - §4.2 month boundary: only compare when both snapshots share the same MTD month
 */

import { useState, useMemo } from 'react'
import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale, LinearScale,
  BarElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { Doughnut, Bar } from 'react-chartjs-2'

// Register chart primitives needed for this tab
ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

// ─────────────────────────────────────────────────────────────────────────────
// §5 — Custom Chart.js plugins, registered once at module level.
// Guard prevents double-registration on hot reload.
// ─────────────────────────────────────────────────────────────────────────────

const _reg = new Set()
function safeRegister(plugin) {
  if (_reg.has(plugin.id)) return
  _reg.add(plugin.id)
  try { ChartJS.register(plugin) } catch {}
}

// §5.1 barLabels — draws value labels above/beside bars
safeRegister({
  id: 'barLabels',
  // defaults.enabled:false means charts that don't pass barLabels opts stay clean
  defaults: { enabled: false },
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || opts.enabled === false) return
    const fmt    = opts.fmt    || 'usd'
    const inside = !!opts.inside
    const minPx  = opts.minPx  || 0
    const horiz  = chart.options.indexAxis === 'y'
    const ctx    = chart.ctx
    ctx.save()
    ctx.font = `${opts.weight || '600'} ${opts.size || 10}px ${ChartJS.defaults.font.family}`
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di)
      if (meta.hidden || !meta.data?.length) return
      if ((meta.type || chart.config.type) !== 'bar') return
      if (ds.noLabel) return                                 // background "Target" tracks unlabelled
      meta.data.forEach((el, i) => {
        const v = ds.data[i]
        if (v === null || v === undefined || !isFinite(v) || Number(v) === 0) return
        const txt  = fmt === 'pct' ? Number(v).toFixed(1) + '%' : _usdC(v)
        const span = horiz ? Math.abs(el.x - el.base) : Math.abs(el.base - el.y)
        if (minPx && span < minPx) return
        if (inside) {
          ctx.fillStyle = '#ffffff'
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          horiz ? ctx.fillText(txt, (el.x + el.base) / 2, el.y)
                : ctx.fillText(txt, el.x, (el.y + el.base) / 2)
        } else {
          ctx.fillStyle = opts.color || '#5f5e5a'
          if (horiz) {
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
            ctx.fillText(txt, el.x + 6, el.y)
          } else {
            ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
            ctx.fillText(txt, el.x, el.y - 6)
          }
        }
      })
    })
    ctx.restore()
  },
})

// §5.2 centerTotal — writes label + value + sub into a doughnut hole
safeRegister({
  id: 'centerTotal',
  defaults: { enabled: false },
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || !opts.value) return
    const a = chart.chartArea; if (!a) return
    const cx = (a.left + a.right) / 2, cy = (a.top + a.bottom) / 2
    const ctx = chart.ctx; ctx.save(); ctx.textAlign = 'center'
    ctx.fillStyle = '#8b8a83'; ctx.font = `500 10px ${ChartJS.defaults.font.family}`
    ctx.textBaseline = 'alphabetic'
    ctx.fillText((opts.label || 'TOTAL').toUpperCase(), cx, cy - 9)
    ctx.fillStyle = '#1a1a18'; ctx.font = `700 19px ${ChartJS.defaults.font.family}`
    ctx.fillText(opts.value, cx, cy + 13)
    if (opts.sub) {
      ctx.fillStyle = '#8b8a83'; ctx.font = `500 10px ${ChartJS.defaults.font.family}`
      ctx.fillText(opts.sub, cx, cy + 28)
    }
    ctx.restore()
  },
})

// §5.3 refLine — dashed benchmark line with pill label
safeRegister({
  id: 'refLine',
  defaults: { enabled: false },
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || opts.value === undefined || opts.value === null) return
    const vertical = !!opts.vertical
    const sc = vertical ? chart.scales.x : chart.scales.y
    if (!sc) return
    const pv = sc.getPixelForValue(opts.value), a = chart.chartArea
    const ctx = chart.ctx; ctx.save()
    ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5
    ctx.strokeStyle = opts.color || 'rgba(26,26,24,.45)'
    ctx.beginPath()
    if (vertical) { ctx.moveTo(pv, a.top);   ctx.lineTo(pv, a.bottom) }
    else          { ctx.moveTo(a.left, pv);  ctx.lineTo(a.right, pv) }
    ctx.stroke(); ctx.setLineDash([])
    if (opts.label) {
      ctx.font = `600 10px ${ChartJS.defaults.font.family}`
      const w = ctx.measureText(opts.label).width + 12
      const bx = vertical ? Math.min(pv + 5, a.right - w) : a.right - w
      const by = vertical ? a.top + 1 : pv - 17
      ctx.fillStyle = opts.color || 'rgba(26,26,24,.72)'
      ctx.beginPath()
      if (ctx.roundRect) { ctx.roundRect(bx, by, w, 15, 4); ctx.fill() }
      else ctx.fillRect(bx, by, w, 15)
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(opts.label, bx + w / 2, by + 8)
    }
    ctx.restore()
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// Constants (§1)
// ─────────────────────────────────────────────────────────────────────────────

const DEPT_TARGET_KEYS = ['EAM Chris', 'EAM Renaldo', 'EAM Gloria', 'B2C Matt']
const DEPT_ROLLUP      = { 'Sales Mo': 'EAM Chris', 'Sales Jojo': 'EAM Gloria' }

// §6 — colours
const DEPT_COLOR = {
  'EAM Chris':   '#185FA5',
  'B2C Matt':    '#D85A30',
  'EAM Gloria':  '#0E8E8E',
  'EAM Renaldo': '#7F77DD',
  'Sales Mo':    '#1D9E75',
  'Sales Jojo':  '#EAB308',
}
const deptHex = d => DEPT_COLOR[d] || '#8b8a83'

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens — keep in sync with LeadershipDashboard.jsx §8
// ─────────────────────────────────────────────────────────────────────────────

const T = {
  bg: '#ffffff', bg2: '#FAFBFC', bg3: '#F1F5F9', bg4: '#E2EAF0',
  text: '#1A2B3C', text2: '#374151', text3: '#64748B',
  border: '#E2EAF0', border2: '#B8C4D0',
  green: '#1D9E75', blue: '#185FA5', red: '#E24B4A',
  amber: '#EAB308', amberInk: '#9A6B0C',
  lift: '0 1px 3px rgba(15,47,90,.06), 0 6px 16px -6px rgba(15,47,90,.10)',
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (local copies — same logic as LeadershipDashboard)
// ─────────────────────────────────────────────────────────────────────────────

function _num(v) {
  const x = (v === null || v === undefined || v === '') ? NaN : Number(v)
  return isFinite(x) ? x : 0
}

const _usd  = (v, d = 0) => '$' + _num(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

function _usdC(v) {
  const x = _num(v), a = Math.abs(x), s = x < 0 ? '-$' : '$'
  if (a >= 1e6) return s + (a / 1e6).toFixed(2) + 'M'
  if (a >= 1e5) return s + (a / 1e3).toFixed(0)  + 'k'
  if (a >= 1e3) return s + (a / 1e3).toFixed(1)  + 'k'
  return s + a.toFixed(a < 10 ? 2 : 0)
}

const _pctFmt  = (v, d = 1) =>
  (v === null || v === undefined || !isFinite(Number(v))) ? '—'
  : (_num(v) * 100).toFixed(d) + '%'

const _signed  = v => (_num(v) > 0 ? '+' : '') + _usd(_num(v), 0)

function _salesPct(sales, lm) {
  if (_num(sales) === 0 && _num(lm) === 0) return null
  if (_num(lm) === 0) return 1.0
  return (_num(sales) - _num(lm)) / _num(lm)
}

function _profitPct(profit, lm) {
  if (_num(lm) < 0) return 1.0
  if (_num(profit) === 0 && _num(lm) === 0) return null
  if (_num(lm) === 0) return 1.0
  return (_num(profit) - _num(lm)) / _num(lm)
}

const _achColor = p =>
  (p === null || !isFinite(Number(p))) ? T.text3
  : p >= 0.95 ? T.green
  : p >= 0.80 ? T.amberInk
  : T.red

// ─────────────────────────────────────────────────────────────────────────────
// buildDepts (§1.1)
// ─────────────────────────────────────────────────────────────────────────────

function buildDepts(custRows, targets) {
  const m = {}, kids = {}

  const blank = k => ({
    dept: k, sales: 0, lm_sales: 0, ly_sales: 0,
    revenue: 0, lm_revenue: 0,
    profit: 0, lm_profit: 0, ly_profit: 0,
    customers: 0, active: 0,
  })

  const accum = (o, r) => {
    o.sales      += r.sales;      o.lm_sales   += r.lm_sales
    o.ly_sales   += r.ly_sales
    o.revenue    += r.revenue;    o.lm_revenue += r.lm_revenue
    o.profit     += r.profit;     o.lm_profit  += r.lm_profit
    o.ly_profit  += r.ly_profit
    o.customers++
    if (r.sales !== 0 || r.profit !== 0) o.active++
  }

  custRows.forEach(r => {
    const rawDept = r.dept
    const k = DEPT_ROLLUP[rawDept] ?? rawDept
    if (!m[k]) m[k] = blank(k)
    accum(m[k], r)
    // Also accumulate into the sub-team bucket (never into totals)
    if (DEPT_ROLLUP[rawDept]) {
      if (!kids[rawDept]) kids[rawDept] = blank(rawDept)
      accum(kids[rawDept], r)
    }
  })

  // Attach targets + derived fields to sub-team rows
  const deptKids = {}
  Object.keys(kids).forEach(c => {
    const o = kids[c]
    o.target = targets.dept?.[c] ?? null
    o.ach    = (o.target && o.target > 0 && isFinite(o.target)) ? o.profit / o.target : null
    o.margin = o.revenue > 0 ? o.profit / o.revenue : null
    const p = DEPT_ROLLUP[c]
    ;(deptKids[p] = deptKids[p] || []).push(o)
  })

  // Attach targets + derived fields to parent rows
  const depts = Object.values(m)
    .map(o => {
      o.target = targets.dept?.[o.dept] ?? null
      o.ach    = (o.target && o.target > 0 && isFinite(o.target)) ? o.profit / o.target : null
      o.margin = o.revenue > 0 ? o.profit / o.revenue : null
      return o
    })
    // §1.1 — hide (Unassigned) and entirely-empty rows with no target
    .filter(o => o.dept !== '(Unassigned)' && o.dept !== 'Unassigned')
    .filter(o => o.target !== null || o.profit !== 0 || o.revenue !== 0 || o.sales !== 0
              || o.lm_profit !== 0 || o.ly_profit !== 0)
    .sort((a, b) => b.profit - a.profit)

  return { depts, deptKids }
}

// ─────────────────────────────────────────────────────────────────────────────
// §1.2 — totals
// Iterates depts only. deptKids must not be reachable from here.
// ─────────────────────────────────────────────────────────────────────────────

function deptTotals(depts) {
  const t = { sales: 0, lm_sales: 0, ly_sales: 0, revenue: 0, lm_revenue: 0, profit: 0, lm_profit: 0, ly_profit: 0 }
  depts.forEach(d => Object.keys(t).forEach(k => { t[k] += _num(d[k]) }))
  return t
}

// ─────────────────────────────────────────────────────────────────────────────
// Month label helper (e.g., "2026-08" → "Aug 2026")
// ─────────────────────────────────────────────────────────────────────────────

function fmtMonth(ym) {
  if (!ym) return ''
  const d = new Date(ym + '-02')
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric' })
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared button style
// ─────────────────────────────────────────────────────────────────────────────

const BTN = {
  fontSize: 12, fontWeight: 600, padding: '5px 12px',
  border: `1px solid ${T.border2}`, borderRadius: 6,
  background: T.bg, color: T.text2, cursor: 'pointer',
  fontFamily: 'inherit',
}

// ─────────────────────────────────────────────────────────────────────────────
// AttainmentBar — §3.2. display:block on the fill is load-bearing.
// ─────────────────────────────────────────────────────────────────────────────

function AttainmentBar({ ach }) {
  if (ach === null || !isFinite(ach)) {
    return <span style={{ color: T.text3, fontSize: 13 }}>—</span>
  }
  const w = Math.min(100, ach * 100).toFixed(1) // §3.2: toFixed(1) prevents absurd style attrs
  const color = _achColor(ach)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <div style={{ flex: 1, height: 5, background: 'rgba(0,0,0,.08)', borderRadius: 3, overflow: 'hidden', minWidth: 60 }}>
        {/* display:block is load-bearing — inline <span> ignores width §3.2 */}
        <div style={{ display: 'block', height: '100%', width: `${w}%`, background: color, borderRadius: 3, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 36 }}>
        {_pctFmt(ach, 0)}
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DepartmentsTab
// ─────────────────────────────────────────────────────────────────────────────

export default function DepartmentsTab({ cust, custPrev, prevSnapDate, asAt, period, CUR_MONTH, targets, tgtSpan, PC }) {
  // §2 — collapse state, persisted in localStorage
  const [expandedDepts, setExpandedDepts] = useState(() => {
    return {} // always start collapsed
  })

  // Data arrives pre-normalized from LeadershipDashboard.normCust() — no period resolution needed
  const { depts, deptKids } = useMemo(() => buildDepts(cust, targets), [cust, targets])
  const t = useMemo(() => deptTotals(depts), [depts])

  // ── §3 — snap-based weekly growth ──────────────────────────────────────────
  // prevDepts: buildDepts on the previous snapshot rows (same function, same parser)
  const prevDepts = useMemo(
    () => custPrev?.length ? buildDepts(custPrev, targets).depts : [],
    [custPrev, targets]
  )

  // MTD month of a snapshot_date: snapshot_date − 1 day, then YYYY-MM.
  // Example: '2026-08-24' → '2026-08-23' → '2026-08'
  // §4.2: v2's MTD belongs to the month containing (snapshot_date − 1 day).
  function snapMtdMonth(dateStr) {
    if (!dateStr) return null
    const d = new Date(dateStr + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() - 1)
    return d.toISOString().slice(0, 7) // 'YYYY-MM'
  }

  // Gap in days between two ISO date strings (asAt − prevSnapDate)
  function gapDays(a, b) {
    if (!a || !b) return null
    return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000)
  }

  const asAtMtdMonth  = snapMtdMonth(asAt)
  const prevMtdMonth  = snapMtdMonth(prevSnapDate)
  // §4.2: only show delta when both snapshots' MTD belongs to the same month
  const sameMonth     = asAtMtdMonth && prevMtdMonth && asAtMtdMonth === prevMtdMonth
  const deltaGapDays  = gapDays(asAt, prevSnapDate)
  const hasDelta      = Boolean(sameMonth && prevDepts.length > 0 && deltaGapDays !== null)

  // Build delta map: dept → { deltaProfit, deltaPts }
  const deptDelta = useMemo(() => {
    if (!hasDelta) return {}
    const prevMap = {}
    prevDepts.forEach(d => { prevMap[d.dept] = d.profit })
    const out = {}
    depts.forEach(d => {
      const prev = prevMap[d.dept] ?? null
      if (prev === null) { out[d.dept] = null; return }
      const dp = d.profit - prev
      const tgt = d.target
      // §3.1: deltaPts = deltaProfit / target × 100 — exact because target is constant
      const dPts = (tgt && tgt > 0) ? (dp / tgt) * 100 : null
      out[d.dept] = { deltaProfit: dp, deltaPts: dPts }
    })
    return out
  }, [hasDelta, depts, prevDepts])

  // §4.1: label the gap correctly — "3-day" for the 21→24 Aug pair, "7-day" for weekly pairs.
  // Do NOT label as "weekly" until deltaGapDays === 7.
  const deltaLabel = deltaGapDays === 7 ? 'Weekly growth'
    : deltaGapDays !== null ? `${deltaGapDays}-day growth`
    : null

  // Company target from parent's tgtSpan (already spans full period, §6)
  const company    = tgtSpan?.total ?? targets.company ?? 0
  const totalAch   = company > 0 ? t.profit / company : null
  const hasDeptKids = Object.keys(deptKids).length > 0

  // §3.7 — unexpected department banner
  const tgtSum = depts.reduce((a, d) => a + _num(d.target), 0)
  const showUnexpBanner = company > 0 && Math.abs(tgtSum - company) > 1

  // ── Expand / collapse (§2) ──────────────────────────────────────────────────
  const toggleDept = dept => {
    const next = { ...expandedDepts, [dept]: !expandedDepts[dept] }
    setExpandedDepts(next)
    localStorage.setItem('eam.deptOpen', JSON.stringify(next))
  }
  const setAll = open => {
    const next = {}
    Object.keys(deptKids).forEach(k => { next[k] = open })
    setExpandedDepts(next)
    localStorage.setItem('eam.deptOpen', JSON.stringify(next))
  }

  // ── Chart data ──────────────────────────────────────────────────────────────
  const donutDepts = depts.filter(d => d.profit > 0)
  const shareTot   = donutDepts.reduce((a, d) => a + d.profit, 0)

  const marginDepts = depts.filter(d => d.profit > 0)
  const blend = t.revenue > 0 ? (t.profit / t.revenue) * 100 : 0

  // Month label for table header
  const monthLabel = fmtMonth(CUR_MONTH)

  // ── Table cell styles ───────────────────────────────────────────────────────
  const TH = {
    padding: '8px 14px', fontSize: 10, fontWeight: 600, color: T.text3,
    textTransform: 'uppercase', letterSpacing: '0.05em',
    background: T.bg2, borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap',
  }
  const TD = { padding: '10px 14px', fontSize: 13, verticalAlign: 'middle' }

  // ── Row renderer ─────────────────────────────────────────────────────────────
  const renderDeptRow = (d, isKid = false, parentName = '') => {
    const hasKids  = !isKid && Boolean(deptKids[d.dept]?.length)
    const isOpen   = expandedDepts[d.dept]
    const delta    = d.profit - d.lm_profit
    const pp       = _profitPct(d.profit, d.lm_profit)
    const sp       = _salesPct(d.sales, d.lm_sales)
    const dColor   = delta > 0 ? T.green : delta < 0 ? T.red : T.text3

    // §3 — snap-based delta for parent rows only (sub-teams excluded per §6)
    const snapDelta = !isKid && hasDelta ? (deptDelta[d.dept] ?? null) : null
    const sdColor   = snapDelta ? (snapDelta.deltaProfit > 0 ? T.green : T.red) : T.text3

    return (
      <tr
        key={`${d.dept}${isKid ? '_kid' : ''}`}
        onClick={hasKids ? () => toggleDept(d.dept) : undefined}
        style={{
          background: isKid ? T.bg2 : T.bg,
          cursor: hasKids ? 'pointer' : 'default',
          borderBottom: `1px solid ${T.border}`,
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { if (!isKid) e.currentTarget.style.background = '#EFF6FF' }}
        onMouseLeave={e => { e.currentTarget.style.background = isKid ? T.bg2 : T.bg }}
      >
        {/* Col 1 — Department */}
        <td style={{ ...TD, paddingLeft: isKid ? 36 : 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* §2 — only departments with sub-teams get a chevron */}
            {hasKids && (
              <span style={{
                fontSize: 9, color: T.text3, flexShrink: 0,
                display: 'inline-block',
                transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s ease',
                lineHeight: 1,
              }}>▶</span>
            )}
            {/* §3.4 — └ prefix for sub-team rows */}
            {isKid && (
              <span style={{ display: 'inline-block', width: 14, fontSize: 11, color: T.text3, flexShrink: 0 }}>└</span>
            )}
            {/* §6 — colour dot */}
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: deptHex(d.dept), flexShrink: 0 }} />
            <span style={{ fontWeight: isKid ? 500 : 600, color: T.text }}>{d.dept}</span>
            {/* Child count badge */}
            {hasKids && (
              <span style={{ fontSize: 10, color: T.text3, background: T.bg4, borderRadius: 8, padding: '1px 6px', marginLeft: 2, flexShrink: 0 }}>
                {deptKids[d.dept].length}
              </span>
            )}
            {/* §3.4 — containment chip */}
            {isKid && parentName && (
              <span
                title={`Already counted inside ${parentName} — not added to the Total`}
                style={{
                  marginLeft: 8, fontSize: 10, fontWeight: 500, letterSpacing: '.02em',
                  color: T.text3, background: T.bg2, border: `1px solid ${T.border}`,
                  borderRadius: 9, padding: '1px 7px', whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >in {parentName}</span>
            )}
          </div>
        </td>

        {/* Col 2 — Profit / vs target */}
        <td style={{ ...TD, textAlign: 'right' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end' }}>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{_usd(d.profit)}</span>
            <span style={{ fontSize: 11, color: T.text3, fontVariantNumeric: 'tabular-nums' }}>
              {d.target != null && d.target > 0 ? _usd(d.target) : 'no target'}
            </span>
          </div>
        </td>

        {/* Col 3 — Attainment */}
        <td style={{ ...TD, minWidth: 140 }}>
          <AttainmentBar ach={d.ach} />
        </td>

        {/* Col 4 — vs LM (absolute + %) */}
        <td style={{ ...TD, textAlign: 'right' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
            {/* §3.3 — both lines coloured by the absolute delta */}
            <span style={{ fontWeight: 600, color: dColor, fontVariantNumeric: 'tabular-nums' }}>{_signed(delta)}</span>
            <span style={{ fontSize: 11, color: dColor, fontVariantNumeric: 'tabular-nums' }}>{_pctFmt(pp, 1)}</span>
          </div>
        </td>

        {/* Col 5 — Revenue */}
        <td style={{ ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {_usd(d.revenue)}
        </td>

        {/* Col 6 — Margin */}
        <td style={{ ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {_pctFmt(d.margin, 1)}
        </td>

        {/* Col 7 — Sales Amount / vs LM */}
        <td style={{ ...TD, textAlign: 'right' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{_usd(d.sales)}</span>
            <span style={{ fontSize: 11, color: T.text3, fontVariantNumeric: 'tabular-nums' }}>{_pctFmt(sp, 1)}</span>
          </div>
        </td>

        {/* Col 8 — Accounts */}
        <td style={{ ...TD, textAlign: 'right', color: T.text3, fontVariantNumeric: 'tabular-nums' }}>
          {d.active} / {d.customers}
        </td>

        {/* Col 9 — Snap-based growth (§3) — parent rows only */}
        {hasDelta && (
          <td style={{ ...TD, textAlign: 'right' }}>
            {isKid ? (
              <span style={{ color: T.text3 }}>—</span>
            ) : snapDelta ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                <span style={{ fontWeight: 600, color: sdColor, fontVariantNumeric: 'tabular-nums' }}>
                  {snapDelta.deltaProfit > 0 ? '+' : ''}{_usd(snapDelta.deltaProfit)}
                </span>
                {snapDelta.deltaPts !== null && (
                  <span style={{ fontSize: 11, color: sdColor, fontVariantNumeric: 'tabular-nums' }}>
                    {snapDelta.deltaPts > 0 ? '+' : ''}{snapDelta.deltaPts.toFixed(2)} pts
                  </span>
                )}
              </div>
            ) : (
              <span style={{ color: T.text3 }}>—</span>
            )}
          </td>
        )}
      </tr>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div>

      {/* Section header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, margin: 0 }}>Departments</h1>
          {/* Snap date badge — replaces LIVE badge (this tab reads from snap) */}
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
            background: 'rgba(0,0,0,.06)', color: T.text3, letterSpacing: '0.04em',
          }}>
            Data as of {asAt ?? '…'}
          </span>
        </div>
        <div style={{ fontSize: 13, color: T.text3, marginTop: 4 }}>
          {PC.short} Total Profit, Complete GMV and Original Sales Amount by owning team, versus target and versus {PC.baseShort}
        </div>
      </div>

      {/* §3.7 — unexpected department banner */}
      {showUnexpBanner && (
        <div style={{
          background: 'rgba(234,179,8,.16)', border: '1px solid #EAB308',
          borderRadius: 8, padding: '10px 14px', marginBottom: 12,
          fontSize: 13, color: '#9A6B0C', lineHeight: 1.6,
        }}>
          ⚠️ <strong>Unexpected department.</strong> Targets on screen sum to {_usd(tgtSum)} against a company
          target of {_usd(company)}. A department outside the agreed four is carrying a target — worth
          checking the mapping table.
        </div>
      )}

      {/* §4.2 — month boundary notice: cross-month pair suppressed */}
      {prevSnapDate && !sameMonth && prevDepts.length > 0 && (
        <div style={{
          background: 'rgba(234,179,8,.12)', border: '1px solid #EAB308',
          borderRadius: 8, padding: '10px 14px', marginBottom: 12,
          fontSize: 12.5, color: '#78590A', lineHeight: 1.6,
        }}>
          {deltaLabel ?? 'Growth'} column hidden — snapshots {asAt} and {prevSnapDate} span a month boundary (MTD resets). Will show once both snapshots share the same month.
        </div>
      )}

      {/* §2 — Expand / collapse controls */}
      {hasDeptKids && (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setAll(true)}  style={BTN}>Expand all</button>
            <button onClick={() => setAll(false)} style={BTN}>Collapse all</button>
          </div>
          <span style={{
            marginLeft: 'auto', fontSize: 12, color: T.text3,
            background: T.bg4, padding: '4px 10px', borderRadius: 6,
          }}>
            Expand a department to see its sub-teams
          </span>
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────────── */}
      <div style={{
        background: T.bg, borderRadius: 12, boxShadow: T.lift,
        border: `1px solid ${T.border}`, overflow: 'hidden', marginBottom: 20,
      }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
            <thead>
              <tr>
                <th style={{ ...TH, textAlign: 'left', minWidth: 180 }}>Department</th>
                <th style={{ ...TH, textAlign: 'right' }}>
                  {PC.short} Total Profit<br />
                  <span style={{ fontWeight: 400, fontSize: 9 }}>vs target</span>
                </th>
                <th style={{ ...TH, textAlign: 'left', minWidth: 145 }}>Attainment</th>
                <th style={{ ...TH, textAlign: 'right' }}>
                  vs {PC.baseShort}<br />
                  <span style={{ fontWeight: 400, fontSize: 9 }}>&nbsp;</span>
                </th>
                <th style={{ ...TH, textAlign: 'right' }}>Complete GMV</th>
                <th style={{ ...TH, textAlign: 'right' }}>Margin</th>
                <th style={{ ...TH, textAlign: 'right' }}>
                  Original Sales Amount<br />
                  <span style={{ fontWeight: 400, fontSize: 9 }}>vs {PC.baseShort}</span>
                </th>
                <th style={{ ...TH, textAlign: 'right' }}>Accounts</th>
                {hasDelta && (
                  <th style={{ ...TH, textAlign: 'right', minWidth: 130 }}>
                    {deltaLabel}<br />
                    <span style={{ fontWeight: 400, fontSize: 9 }}>Δ profit · Δ pts</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {depts.flatMap(d => {
                const rows = [renderDeptRow(d)]
                // §2 — sub-team rows appear only when parent is open
                if (deptKids[d.dept] && expandedDepts[d.dept]) {
                  deptKids[d.dept].forEach(kid => rows.push(renderDeptRow(kid, true, d.dept)))
                }
                return rows
              })}

              {/* §3.5 — Total row */}
              <tr style={{ background: T.bg, borderTop: `2px solid ${T.border}` }}>
                <td style={{ ...TD, fontWeight: 700, color: T.text }}>Total</td>
                <td style={{ ...TD, textAlign: 'right' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end' }}>
                    <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{_usd(t.profit)}</span>
                    {/* §3.5 — uses company target, not the sum of the target column */}
                    <span style={{ fontSize: 11, color: T.text3, fontVariantNumeric: 'tabular-nums' }}>
                      {company > 0 ? _usd(company) : 'no target'}
                    </span>
                  </div>
                </td>
                <td style={{ ...TD, minWidth: 145 }}>
                  <AttainmentBar ach={totalAch} />
                </td>
                <td style={{ ...TD, textAlign: 'right' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                    {(() => {
                      const d = t.profit - t.lm_profit, c = d >= 0 ? T.green : T.red
                      return (
                        <>
                          <span style={{ fontWeight: 700, color: c, fontVariantNumeric: 'tabular-nums' }}>{_signed(d)}</span>
                          <span style={{ fontSize: 11, color: c, fontVariantNumeric: 'tabular-nums' }}>{_pctFmt(_profitPct(t.profit, t.lm_profit), 1)}</span>
                        </>
                      )
                    })()}
                  </div>
                </td>
                <td style={{ ...TD, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{_usd(t.revenue)}</td>
                <td style={{ ...TD, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {_pctFmt(t.revenue > 0 ? t.profit / t.revenue : null, 1)}
                </td>
                <td style={{ ...TD, textAlign: 'right' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                    <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{_usd(t.sales)}</span>
                    <span style={{ fontSize: 11, color: T.text3, fontVariantNumeric: 'tabular-nums' }}>{_pctFmt(_salesPct(t.sales, t.lm_sales), 1)}</span>
                  </div>
                </td>
                <td style={{ ...TD, textAlign: 'right', color: T.text3, fontVariantNumeric: 'tabular-nums' }}>
                  {cust.length}
                </td>
                {/* Total row delta — company-level (§3.1) */}
                {hasDelta && (() => {
                  const prevTotalProfit = prevDepts.reduce((a, d) => a + d.profit, 0)
                  const dp = t.profit - prevTotalProfit
                  const dPts = company > 0 ? (dp / company) * 100 : null
                  const c = dp >= 0 ? T.green : T.red
                  return (
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                        <span style={{ fontWeight: 700, color: c, fontVariantNumeric: 'tabular-nums' }}>
                          {dp > 0 ? '+' : ''}{_usd(dp)}
                        </span>
                        {dPts !== null && (
                          <span style={{ fontSize: 11, color: c, fontVariantNumeric: 'tabular-nums' }}>
                            {dPts > 0 ? '+' : ''}{dPts.toFixed(2)} pts
                          </span>
                        )}
                      </div>
                    </td>
                  )
                })()}
              </tr>
            </tbody>
          </table>
        </div>

      </div>

      {/* ── Charts row (§4) ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* §4.1 — Total profit contribution (doughnut + value legend) */}
        <div style={{
          background: T.bg, borderRadius: 12, padding: '18px 20px',
          boxShadow: T.lift, border: `1px solid ${T.border}`,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Total profit contribution</div>
          <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
            Share of {PC.short} total profit · {_usdC(shareTot)} across {donutDepts.length} teams
          </div>

          <div style={{ display: 'flex', gap: 20, marginTop: 18, alignItems: 'center' }}>
            {/* Chart */}
            <div style={{ width: 196, height: 196, flexShrink: 0 }}>
              {donutDepts.length > 0 ? (
                <Doughnut
                  data={{
                    labels: donutDepts.map(d => d.dept),
                    datasets: [{
                      data:            donutDepts.map(d => d.profit),
                      backgroundColor: donutDepts.map(d => deptHex(d.dept)),
                      borderWidth:     2,
                      borderColor:     '#ffffff',
                      hoverOffset:     6,
                    }],
                  }}
                  options={{
                    cutout: '68%',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { display: false },
                      tooltip: {
                        callbacks: {
                          label: ctx => ` ${_usd(ctx.raw)}  ·  ${_pctFmt(ctx.raw / shareTot, 1)}`,
                        },
                      },
                      // Custom plugins
                      centerTotal: { value: _usdC(shareTot), label: `${PC.short} total profit`, sub: `${donutDepts.length} teams` },
                      barLabels:   { enabled: false },
                      refLine:     { enabled: false },
                      datalabels:  { display: false },
                    },
                  }}
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: T.text3, fontSize: 13 }}>
                  No data
                </div>
              )}
            </div>

            {/* §4.1 — Value legend (sorted by profit desc) */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0 }}>
              {donutDepts.map(d => (
                <div key={d.dept} style={{
                  display: 'grid',
                  gridTemplateColumns: '10px 1fr auto auto',
                  alignItems: 'center', gap: 8, padding: '4px 0',
                  fontSize: 12, borderBottom: `1px solid ${T.border}`,
                }}>
                  {/* §6 colour swatch */}
                  <div style={{ width: 9, height: 9, borderRadius: 2, background: deptHex(d.dept) }} />
                  <span style={{ color: T.text2 }}>{d.dept}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {_usdC(d.profit)}
                  </span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', color: T.text3, minWidth: 44, textAlign: 'right' }}>
                    {_pctFmt(shareTot > 0 ? d.profit / shareTot : null, 1)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* §4.2 — Profit margin by department (bar + refLine) */}
        <div style={{
          background: T.bg, borderRadius: 12, padding: '18px 20px',
          boxShadow: T.lift, border: `1px solid ${T.border}`,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Profit margin by department</div>
          <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
            {PC.short} profit ÷ {PC.short} revenue · dashed line is the company blend at {_pctFmt(blend / 100, 1)}
          </div>

          <div style={{ height: 210, marginTop: 14 }}>
            {marginDepts.length > 0 ? (
              <Bar
                data={{
                  labels: marginDepts.map(d => d.dept),
                  datasets: [{
                    data:            marginDepts.map(d => d.margin != null ? d.margin * 100 : 0),
                    backgroundColor: marginDepts.map(d => deptHex(d.dept)),
                    borderRadius: 6,
                    barPercentage: 0.52,
                    categoryPercentage: 0.72,
                  }],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  layout: { padding: { top: 20 } },  // §4.2 — room for labels above tallest bar
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      callbacks: {
                        label: ctx => {
                          const d = marginDepts[ctx.dataIndex]
                          return [
                            ` Margin ${_pctFmt(d.margin, 1)}`,
                            ` Total Profit ${_usd(d.profit)}`,
                            ` Complete GMV ${_usd(d.revenue)}`,
                          ]
                        },
                      },
                    },
                    barLabels:  { enabled: true, fmt: 'pct', color: T.text2 },
                    centerTotal:{ enabled: false },
                    // §4.2 — refLine, dashed benchmark
                    refLine:    { value: blend, label: `Blend ${blend.toFixed(1)}%`, color: 'rgba(26,26,24,.55)' },
                    datalabels: { display: false },
                  },
                  scales: {
                    x: {
                      grid: { display: false },
                      border: { display: false },
                      ticks: { font: { size: 11 }, color: T.text3 },
                    },
                    y: {
                      // §4.2 — beginAtZero is deliberate (truncated axis exaggerated gaps)
                      beginAtZero: true,
                      grace: '12%',
                      grid: { color: 'rgba(0,0,0,.05)' },
                      border: { display: false },
                      ticks: {
                        callback: v => v + '%',
                        maxTicksLimit: 5,
                        font: { size: 10 }, color: T.text3,
                      },
                    },
                  },
                }}
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: T.text3, fontSize: 13 }}>
                No margin data
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
