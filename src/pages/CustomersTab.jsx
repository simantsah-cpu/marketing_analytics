/**
 * CustomersTab.jsx — Weekly EAM Performance, Customers tab
 *
 * Data flow:
 *  - `cust`     : pre-normalized rows from LeadershipDashboard.normCust()
 *                 { dept, cust, sales, lm_sales, profit, lm_profit, revenue, lm_revenue, ly_sales, ly_profit }
 *  - `custPrev` : same normCust() output for the previous snapshot (already normalized)
 *  - `prevSnapDate` : ISO date string, e.g. '2026-08-21'
 *  - `asAt`     : resolved snapshot date, e.g. '2026-08-24'
 *  - `targets`  : buildTargets() result — { dept: { 'EAM Chris': 1146863, ... }, ... }
 *
 * §2.1 IMPORTANT: key on (dept, cust), NOT cust alone.
 *   "Other" appears in both EAM Renaldo and B2C Matt. Keying on name alone
 *   would assign Renaldo's +$513 to B2C Matt's Other row.
 *
 * §2.2: profit is null when SAFE_DIVIDE(cp,cr) returns NULL for rows with no
 *   completed revenue. Do NOT substitute 0. Render as '—'.
 *
 * §3: (Unknown) has profit $268 — show it, muted/italic.
 *
 * §4: Do not add IFNULL to the ratio. Nothing moves a reported number.
 */
import { useState, useMemo, useCallback } from 'react'

// ─── Constants ───────────────────────────────────────────────────────────────

const DEPT_ROLLUP = { 'Sales Mo': 'EAM Chris', 'Sales Jojo': 'EAM Gloria' }
const DEPT_COLORS = {
  'EAM Chris':   '#185FA5',
  'B2C Matt':    '#D85A30',
  'EAM Gloria':  '#0E8E8E',
  'EAM Renaldo': '#7F77DD',
  'Sales Mo':    '#1D9E75',
  'Sales Jojo':  '#EAB308',
}

// §1.2: Sub-team targets are read from the snapshot-pinned targets prop (targets.dept),
// which is populated from Q_TARGETS → mapping table. No hardcoded values here.
// Fall-back chain: targets.dept[subTeamName] → targets.dept[parentDept] → null

const rollupDept = d => DEPT_ROLLUP[d] || d || '(Unassigned)'

// ─── Design tokens ───────────────────────────────────────────────────────────

const T = {
  bg:'#ffffff', bg2:'#FAFBFC', bg3:'#F1F5F9', bg4:'#E2EAF0',
  text:'#1A2B3C', text2:'#374151', text3:'#64748B',
  border:'#E2EAF0', border2:'#B8C4D0',
  green:'#1D9E75', blue:'#185FA5', red:'#E24B4A',
  amber:'#EAB308', amberInk:'#9A6B0C',
  lift:'0 1px 2px rgba(26,26,24,.05), 0 6px 16px -6px rgba(26,26,24,.10)',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _num(v) { const x = (v===null||v===undefined||v==='')?NaN:Number(v); return isFinite(x)?x:0 }

// §2.2: profitNull — true when the original value was null/undefined (no completed rev).
// Do NOT treat as 0. Used to render '—' instead of '$0'.
const profitNull = v => v === null || v === undefined

const usd  = (v,d=0) => '$' + _num(v).toLocaleString('en-US', {minimumFractionDigits:d, maximumFractionDigits:d})
function usdC(v){const x=_num(v),a=Math.abs(x),s=x<0?'-$':'$';if(a>=1e6)return s+(a/1e6).toFixed(2)+'M';if(a>=1e5)return s+(a/1e3).toFixed(0)+'k';if(a>=1e3)return s+(a/1e3).toFixed(1)+'k';return s+a.toFixed(a<10?2:0)}
const pctFmt = (v,d=1) => (v===null||v===undefined||!isFinite(Number(v))) ? '—' : (_num(v)*100).toFixed(d)+'%'
const numFmt = v => _num(v).toLocaleString('en-US')
const signed = v => (_num(v)>0?'+':'')+usd(_num(v),0)
function salesPct(s,b){const sv=_num(s),bv=_num(b);if(sv===0&&bv===0)return null;if(bv===0)return 1.0;return(sv-bv)/bv}
function profitPct(p,b){const pv=_num(p),bv=_num(b);if(bv<0)return 1.0;if(pv===0&&bv===0)return null;if(bv===0)return 1.0;return(pv-bv)/bv}
const deltaColor = v => _num(v)>0 ? T.green : _num(v)<0 ? T.red : T.text3

// Gap in days between two ISO date strings (a − b)
function gapDays(a, b) {
  if (!a || !b) return null
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000)
}

// MTD month that a snapshot covers: snapshot_date − 1 day → YYYY-MM
// e.g. '2026-08-24' → '2026-08-23' → '2026-08'
function snapMtdMonth(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 7)
}

// ─── Build rows ───────────────────────────────────────────────────────────────

function buildCustRows(cust, filters, sort) {
  const { dept, search, active, basis } = filters
  const q = (search || '').toLowerCase().trim()

  const rows = (cust || []).filter(r => {
    if (dept && rollupDept(r.dept) !== dept) return false
    if (q && (r.cust || '').toLowerCase().indexOf(q) < 0) return false
    if (active === 'active' && _num(r.sales) === 0 && _num(r.profit) === 0) return false
    return true
  }).map(r => {
    const bs = basis === 'ly' ? _num(r.ly_sales)  : _num(r.lm_sales)
    const bp = basis === 'ly' ? _num(r.ly_profit) : _num(r.lm_profit)
    const s  = _num(r.sales)
    // §2.2: preserve null profit — do NOT collapse to 0
    const p  = profitNull(r.profit) ? null : _num(r.profit)
    const rv = _num(r.revenue)
    return {
      dept:        r.dept,
      cust:        r.cust,
      sales:       s,
      base_sales:  bs,
      s_delta:     s - bs,
      s_pct:       salesPct(s, bs),
      profit:      p,
      base_profit: bp,
      p_delta:     p !== null ? p - bp : null,
      p_pct:       p !== null ? profitPct(p, bp) : null,
      revenue:     rv,
      margin:      rv > 0 && p !== null ? p / rv : null,
    }
  })

  const { key, dir } = sort
  rows.sort((a, b) => {
    let x = a[key], y = b[key]
    if (typeof x === 'string') return dir * x.localeCompare(y)
    x = (x === null || !isFinite(x)) ? -Infinity : x
    y = (y === null || !isFinite(y)) ? -Infinity : y
    return dir * (x - y)
  })
  return rows
}

// ─── CSV export ───────────────────────────────────────────────────────────────

function exportCsv(rows, basis, asAt, prevSnapDate, prevMap, targets) {
  const bl    = basis === 'ly' ? 'LY' : 'LM'
  const gapDy = gapDays(asAt, prevSnapDate)
  const gapLabel = gapDy !== null ? `${gapDy}-day` : 'snapshot'
  // FIX 2: 'Hoppa Non-Hoppa' → 'Department' (raw dept, e.g. 'Sales Mo')
  // Add 'Team' column (rolled-up, e.g. 'EAM Chris') so the file reconciles to the screen.
  // Someone pivoting by Team gets 19 (16+3) for EAM Chris, matching the grouped view.
  const head = [
    'Department', 'Team', 'customer_name',
    `Original Sales Amount vs ${bl}`, `Original Sales Amount %vs ${bl}`,
    'Sales Amount', `${bl} MTD Sales Amount`,
    `Total Profit vs ${bl}`, `Total Profit %vs ${bl}`,
    'Total Profit', `${bl} Total Profit`,
    'Revenue', 'Margin',
    `${gapLabel} growth (${prevSnapDate ?? '?'} → ${asAt ?? '?'})`,
    `${gapLabel} growth pts vs parent`,
  ]
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`
  const lines = [head.join(',')]
  rows.forEach(r => {
    const key        = `${r.dept}||${r.cust}`
    const delta      = prevMap[key] ?? null
    const parentDept = rollupDept(r.dept)
    const tgt        = targets?.dept?.[r.dept] ?? targets?.dept?.[parentDept] ?? null
    const growthProfit = delta !== undefined && delta !== null
      ? (_num(r.profit) - delta)
      : delta === null ? '' : ''
    const curP = r.profit !== null ? _num(r.profit) : null
    const prevP = (prevMap[key] !== undefined && prevMap[key] !== null) ? prevMap[key] : null
    const dp = (curP !== null && prevP !== null) ? curP - prevP
      : (curP !== null && prevMap[key] === null) ? curP - 0
      : null
    const growthPts = (dp !== null && tgt && tgt > 0)
      ? (dp / tgt * 100).toFixed(2) : ''
    lines.push([
      q(r.dept), q(parentDept), q(r.cust),
      r.s_delta?.toFixed(2) ?? '',
      r.s_pct !== null ? r.s_pct.toFixed(4) : '',
      r.sales.toFixed(2),
      r.base_sales.toFixed(2),
      r.p_delta !== null ? r.p_delta.toFixed(2) : '',
      r.p_pct  !== null ? r.p_pct.toFixed(4) : '',
      r.profit !== null ? r.profit.toFixed(2) : '',
      r.base_profit.toFixed(2),
      r.revenue.toFixed(2),
      r.margin !== null ? r.margin.toFixed(4) : '',
      dp !== null ? dp.toFixed(2) : '',
      growthPts,
    ].join(','))
  })
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  const tag = (asAt && prevSnapDate) ? `_${prevSnapDate}_to_${asAt}` : `_${new Date().toISOString().slice(0,10)}`
  a.download = `EAM Customer Performance${tag}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PairCell({ main, sub, subColor }) {
  return (
    <td style={{ padding:'8px 14px', textAlign:'right', verticalAlign:'middle' }}>
      <div style={{ display:'flex', flexDirection:'column', gap:1, alignItems:'flex-end' }}>
        <span style={{ fontVariantNumeric:'tabular-nums', fontWeight:500, fontSize:13 }}>{main}</span>
        <span style={{ fontSize:11, color:subColor||T.text3, fontVariantNumeric:'tabular-nums' }}>{sub}</span>
      </div>
    </td>
  )
}

function DeltaCell({ abs, pctVal }) {
  const c = deltaColor(abs)
  return (
    <td style={{ padding:'8px 14px', textAlign:'right', verticalAlign:'middle' }}>
      <div style={{ display:'flex', flexDirection:'column', gap:1, alignItems:'flex-end' }}>
        <span style={{ fontVariantNumeric:'tabular-nums', fontWeight:600, fontSize:13, color:c }}>{signed(abs)}</span>
        <span style={{ fontSize:11, color:c, fontVariantNumeric:'tabular-nums' }}>{pctFmt(pctVal, 1)}</span>
      </div>
    </td>
  )
}

// §2.2: profit display — null profit renders as '—' not '$0'
function ProfitCell({ profit, basePt, pDelta, pPct }) {
  const isNull = profit === null
  const c = !isNull && _num(profit) < 0 ? T.red : T.text
  return (
    <td style={{ padding:'8px 14px', textAlign:'right', verticalAlign:'middle' }}>
      <div style={{ display:'flex', flexDirection:'column', gap:1, alignItems:'flex-end' }}>
        <span
          title={isNull ? 'No completed revenue — SAFE_DIVIDE returns NULL' : undefined}
          style={{ fontVariantNumeric:'tabular-nums', fontWeight:500, fontSize:13, color: isNull ? T.text3 : c, fontStyle: isNull ? 'italic' : 'normal' }}
        >
          {isNull ? '—' : usd(profit)}
        </span>
        <span style={{ fontSize:11, color:T.text3, fontVariantNumeric:'tabular-nums' }}>{usd(basePt)}</span>
      </div>
    </td>
  )
}

function ProfitDeltaCell({ pDelta, pPct }) {
  if (pDelta === null) {
    return (
      <td style={{ padding:'8px 14px', textAlign:'right', verticalAlign:'middle', color:T.text3, fontSize:13 }}>—</td>
    )
  }
  const c = deltaColor(pDelta)
  return (
    <td style={{ padding:'8px 14px', textAlign:'right', verticalAlign:'middle' }}>
      <div style={{ display:'flex', flexDirection:'column', gap:1, alignItems:'flex-end' }}>
        <span style={{ fontVariantNumeric:'tabular-nums', fontWeight:600, fontSize:13, color:c }}>{signed(pDelta)}</span>
        <span style={{ fontSize:11, color:c, fontVariantNumeric:'tabular-nums' }}>{pctFmt(pPct, 1)}</span>
      </div>
    </td>
  )
}

// §1 — Growth cell: currency delta + pts-vs-parent sub-line
// isUnknown: (Unknown) placeholder row — show delta but '—' pts
function GrowthCell({ deltaProfit, deltaPts, parentLabel, isUnknown }) {
  if (deltaProfit === null) {
    return <td style={{ padding:'8px 14px', textAlign:'right', verticalAlign:'middle', color:T.text3, fontSize:13 }}>—</td>
  }
  const c = deltaProfit > 0 ? T.green : deltaProfit < 0 ? T.red : T.text3
  return (
    <td style={{ padding:'8px 14px', textAlign:'right', verticalAlign:'middle' }}>
      <div style={{ display:'flex', flexDirection:'column', gap:1, alignItems:'flex-end' }}>
        <span style={{ fontVariantNumeric:'tabular-nums', fontWeight:600, fontSize:13, color:c }}>
          {deltaProfit > 0 ? '+' : ''}{usd(deltaProfit)}
        </span>
        {(!isUnknown && deltaPts !== null) ? (
          <span style={{ fontSize:11, color:c, fontVariantNumeric:'tabular-nums' }}>
            {deltaPts > 0 ? '+' : ''}{deltaPts.toFixed(2)} pts vs {parentLabel}
          </span>
        ) : (
          <span style={{ fontSize:11, color:T.text3 }}>—</span>
        )}
      </div>
    </td>
  )
}

function CustCells({ r }) {
  return (<>
    <PairCell   main={usd(r.sales)} sub={usd(r.base_sales)} />
    <DeltaCell  abs={r.s_delta} pctVal={r.s_pct} />
    <ProfitCell profit={r.profit} basePt={r.base_profit} pDelta={r.p_delta} pPct={r.p_pct} />
    <ProfitDeltaCell pDelta={r.p_delta} pPct={r.p_pct} />
    <td style={{ padding:'8px 14px', textAlign:'right', fontVariantNumeric:'tabular-nums', fontSize:13, verticalAlign:'middle' }}>
      {r.margin !== null ? pctFmt(r.margin, 1) : '—'}
    </td>
  </>)
}

function DeptTag({ dept }) {
  const rolled = rollupDept(dept)
  if (rolled === dept) return null
  return (
    <span style={{ display:'inline-flex', alignItems:'center', fontSize:10, fontWeight:500, color:T.text3, background:T.bg2, border:`1px solid ${T.border}`, borderRadius:9, padding:'1px 7px', marginLeft:7, whiteSpace:'nowrap' }}>{dept}</span>
  )
}

function DeptDot({ dept }) {
  return (
    <span style={{ display:'inline-block', width:9, height:9, borderRadius:'50%', background:DEPT_COLORS[dept]||T.text3, marginRight:7, flexShrink:0 }} />
  )
}

function KpiTile({ label, value, sub, subColor }) {
  return (
    <div style={{ background:T.bg, borderRadius:10, padding:'14px 16px', boxShadow:T.lift, border:`1px solid ${T.border}`, display:'flex', flexDirection:'column', gap:3, flex:1 }}>
      <div style={{ fontSize:11, color:T.text3, fontWeight:500 }}>{label}</div>
      <div style={{ fontSize:24, fontWeight:700, color:T.text, lineHeight:1.2, marginTop:2 }}>{value}</div>
      <div style={{ fontSize:11, color:subColor||T.text3 }}>{sub}</div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CustomersTab({ cust, custPrev, prevSnapDate, asAt, period, CUR_MONTH, PC, targets }) {
  const [custGroup, setCustGroup] = useState(() => localStorage.getItem('eam.custGroup') || 'eam')
  const [custOpen,  setCustOpen]  = useState({})
  const [custSort,  setCustSort]  = useState({ key:'sales', dir:-1 })
  const [filters,   setFilters]   = useState({ dept:'', search:'', active:'active', basis:'lm' })

  const sortCust = useCallback(k => {
    setCustSort(s => s.key === k ? { key:k, dir:-s.dir } : { key:k, dir:(k==='cust'||k==='dept')?1:-1 })
  }, [])

  const toggleGrp = useCallback(dept => {
    setCustOpen(prev => {
      const next = { ...prev, [dept]: !prev[dept] }
      localStorage.setItem('eam.custOpen', JSON.stringify(next))
      return next
    })
  }, [])

  const setAll = useCallback(open => {
    setCustOpen(prev => {
      const next = {}
      ;(cust || []).forEach(r => { next[rollupDept(r.dept)] = open })
      localStorage.setItem('eam.custOpen', JSON.stringify(next))
      return next
    })
  }, [cust])

  const setGroup = v => { setCustGroup(v); localStorage.setItem('eam.custGroup', v) }
  const resetFilters = () => { setFilters({ dept:'', search:'', active:'active', basis:'lm' }); setCustSort({ key:'sales', dir:-1 }) }

  const rows = useMemo(() => buildCustRows(cust, filters, custSort), [cust, filters, custSort])

  const deptOptions = useMemo(() => {
    const counts = {}
    ;(cust || []).forEach(r => {
      const d = rollupDept(r.dept)
      if (_num(r.sales) !== 0 || _num(r.profit) !== 0) counts[d] = (counts[d] || 0) + 1
    })
    return Object.entries(counts).sort((a,b) => a[0].localeCompare(b[0]))
  }, [cust])

  // Summary totals — null profit rows contribute 0 to the sum (they have no completed rev)
  const st = useMemo(() => rows.reduce((a, r) => {
    a.sales        += r.sales
    a.base_sales   += r.base_sales
    a.profit       += r.profit !== null ? r.profit : 0
    a.base_profit  += r.base_profit
    a.revenue      += r.revenue
    return a
  }, { sales:0, base_sales:0, profit:0, base_profit:0, revenue:0 }), [rows])

  const bl      = filters.basis === 'ly' ? 'LY' : 'LM'
  const blLabel = filters.basis === 'ly' ? 'Last year MTD' : 'Last month MTD'
  const short   = PC?.short || 'MTD'
  const stx = {
    ...st,
    s_delta:  st.sales   - st.base_sales,
    s_pct:    salesPct(st.sales, st.base_sales),
    p_delta:  st.profit  - st.base_profit,
    p_pct:    profitPct(st.profit, st.base_profit),
    margin:   st.revenue > 0 ? st.profit / st.revenue : null,
  }

  // ── §2.1 Growth delta map — keyed on "(dept)||(cust)", NOT cust alone ──────
  // This is the trap: "Other" exists in both EAM Renaldo and B2C Matt.
  // Keying on name alone would give B2C Matt's Other row Renaldo's +$513.
  const prevMap = useMemo(() => {
    const m = {}
    ;(custPrev || []).forEach(r => {
      const key = `${r.dept}||${r.cust}`
      // profit field on normalized rows is already numeric (normCust called in LeadershipDashboard)
      m[key] = r.profit !== null && r.profit !== undefined ? _num(r.profit) : null
    })
    return m
  }, [custPrev])

  // ── Snap delta metadata ───────────────────────────────────────────────────
  const asAtMtdMonth  = snapMtdMonth(asAt)
  const prevMtdMonth  = snapMtdMonth(prevSnapDate)
  const sameMonth     = asAtMtdMonth && prevMtdMonth && asAtMtdMonth === prevMtdMonth
  const deltaGapDays  = gapDays(asAt, prevSnapDate)
  const hasDelta      = Boolean(sameMonth && (custPrev || []).length > 0 && deltaGapDays !== null)
  const deltaLabel    = deltaGapDays === 7 ? 'Weekly growth'
    : deltaGapDays !== null ? `${deltaGapDays}-day growth`
    : null

  // ── Groups (EAM mode) ─────────────────────────────────────────────────────
  const groups = useMemo(() => {
    const g = {}
    rows.forEach(r => {
      const k = rollupDept(r.dept)
      if (!g[k]) g[k] = { dept:k, items:[], sales:0, base_sales:0, profit:0, base_profit:0, revenue:0 }
      const gd = g[k]
      gd.items.push(r)
      gd.sales       += r.sales
      gd.base_sales  += r.base_sales
      gd.profit      += r.profit !== null ? r.profit : 0
      gd.base_profit += r.base_profit
      gd.revenue     += r.revenue
    })
    const gl = Object.values(g).map(gd => ({
      ...gd,
      s_delta: gd.sales  - gd.base_sales,
      s_pct:   salesPct(gd.sales, gd.base_sales),
      p_delta: gd.profit - gd.base_profit,
      p_pct:   profitPct(gd.profit, gd.base_profit),
      margin:  gd.revenue > 0 ? gd.profit / gd.revenue : null,
    }))
    const gk = (custSort.key==='cust'||custSort.key==='dept') ? 'sales' : custSort.key
    gl.sort((a,b) => {
      let x=a[gk], y=b[gk]
      x=(x===null||!isFinite(x))?-Infinity:x
      y=(y===null||!isFinite(y))?-Infinity:y
      return custSort.dir*(x-y)
    })
    return gl
  }, [rows, custSort])

  // ── Style atoms ───────────────────────────────────────────────────────────
  const SEL = { fontSize:12.5, padding:'5px 8px', border:`1px solid ${T.border}`, borderRadius:6, background:T.bg, color:T.text, fontFamily:'inherit' }
  const TD1 = { padding:'9px 14px', fontSize:13, verticalAlign:'middle', fontWeight:500, color:T.text }
  const ROW = { borderBottom:`1px solid ${T.border}`, transition:'background 0.1s' }

  const colSpan = hasDelta ? 7 : 6

  // TH: sortable column header
  const TH = ({ k, label, right, sub }) => (
    <th
      onClick={() => sortCust(k)}
      style={{ padding:'8px 14px', fontSize:10, fontWeight:600, color:T.text3, textTransform:'uppercase', letterSpacing:'0.05em', background:T.bg2, borderBottom:`1px solid ${T.border}`, whiteSpace:'nowrap', cursor:'pointer', userSelect:'none', textAlign:right?'right':'left' }}
    >
      <div style={{ display:'flex', flexDirection:'column', gap:1, alignItems:right?'flex-end':'flex-start' }}>
        <span>{label}{custSort.key===k && <span style={{ fontSize:9, opacity:.75, marginLeft:3 }}>{custSort.dir<0?'▼':'▲'}</span>}</span>
        {sub && <span style={{ fontWeight:400, fontSize:9, opacity:.8 }}>{sub}</span>}
      </div>
    </th>
  )

  // ── Per-customer growth cell ─────────────────────────────────────────────
  // §1: currency delta (main) + pts vs parent dept's target (sub)
  // §2.1: key = (dept, cust) to avoid the "Other" ambiguity
  // §1.2: sub-team rows use their own target
  const growthCell = (r) => {
    const key  = `${r.dept}||${r.cust}`
    const prev = prevMap[key]   // undefined = not in prev snapshot; null = was there but profit null
    if (prev === undefined) {
      // Customer wasn't in previous snapshot — show '—'
      return <td style={{ padding:'8px 14px', textAlign:'right', verticalAlign:'middle', color:T.text3, fontSize:13 }}>—</td>
    }
    const curProfit  = r.profit !== null ? _num(r.profit) : null
    const prevProfit = prev !== null ? prev : 0   // null prev → 0 (no completed rev → treat as 0 base)
    const dp         = curProfit !== null ? curProfit - prevProfit : null
    // §1.2: sub-team uses its own target; parent uses parent dept's target
    const parentDept = rollupDept(r.dept)
    const tgt        = targets?.dept?.[r.dept] ?? targets?.dept?.[parentDept] ?? null
    const dPts       = (dp !== null && tgt && tgt > 0) ? (dp / tgt) * 100 : null
    const isUnknown  = r.cust === '(Unknown)'
    return (
      <GrowthCell
        deltaProfit={dp}
        deltaPts={dPts}
        parentLabel={r.dept}   // §1.2: name the actual dept, not the rolled-up parent
        isUnknown={isUnknown}
      />
    )
  }

  // FIX 1: Group-level growth aggregated from items.
  // Sum deltaProfit over all customers in the group (rollupDept maps Sales Mo → EAM Chris etc.).
  // deltaPts = sumDp / parentTarget. (Unassigned) has no target → pts null.
  const groupGrowthCell = (g) => {
    if (!hasDelta) return null
    let sumDp = 0; let anyDelta = false
    g.items.forEach(r => {
      const key  = `${r.dept}||${r.cust}`
      const prev = prevMap[key]
      if (prev === undefined) return     // not in prev snapshot
      anyDelta = true
      const curP  = r.profit !== null ? _num(r.profit) : null
      const prevP = prev !== null ? prev : 0
      if (curP !== null) sumDp += curP - prevP
    })
    if (!anyDelta) {
      return <td style={{ padding:'8px 14px', textAlign:'right', verticalAlign:'middle', color:T.text3, fontSize:13 }}>—</td>
    }
    const isUnassigned = g.dept === '(Unassigned)'
    const tgt  = isUnassigned ? null : (targets?.dept?.[g.dept] ?? null)
    const dPts = (tgt && tgt > 0) ? (sumDp / tgt) * 100 : null
    const c    = sumDp > 0 ? T.green : sumDp < 0 ? T.red : T.text3
    return (
      <td style={{ padding:'8px 14px', textAlign:'right', verticalAlign:'middle' }}>
        <div style={{ display:'flex', flexDirection:'column', gap:1, alignItems:'flex-end' }}>
          <span style={{ fontVariantNumeric:'tabular-nums', fontWeight:700, fontSize:13, color:c }}>
            {sumDp > 0 ? '+' : ''}{usd(sumDp)}
          </span>
          {(!isUnassigned && dPts !== null) ? (
            <span style={{ fontSize:11, color:c, fontVariantNumeric:'tabular-nums' }}>
              {dPts > 0 ? '+' : ''}{dPts.toFixed(2)} pts
            </span>
          ) : (
            <span style={{ fontSize:11, color:T.text3 }}>—</span>
          )}
        </div>
      </td>
    )
  }

  // ── Row renderers ─────────────────────────────────────────────────────────

  const renderFlatRow = r => {
    const isUnknown    = r.cust === '(Unknown)'
    const isUnassigned = r.dept === '(Unassigned)'
    const muted        = isUnknown || isUnassigned
    return (
      <tr
        key={`flat_${r.dept}|${r.cust}`}
        style={{ ...ROW, background:T.bg }}
        onMouseEnter={e => { if (!muted) e.currentTarget.style.background = '#EFF6FF' }}
        onMouseLeave={e => { e.currentTarget.style.background = T.bg }}
      >
        <td style={{ ...TD1, fontStyle: muted ? 'italic' : 'normal', color: muted ? T.text3 : T.text }}>
          <span>{r.cust}</span>
          <DeptTag dept={r.dept} />
        </td>
        <CustCells r={r} />
        {hasDelta && growthCell(r)}
      </tr>
    )
  }

  const renderGrouped = () => groups.map(g => {
    const open    = !!custOpen[g.dept]
    const grpRows = []

    // Group header row
    grpRows.push(
      <tr
        key={`grp_${g.dept}`}
        onClick={() => toggleGrp(g.dept)}
        style={{ ...ROW, background:T.bg, cursor:'pointer' }}
        onMouseEnter={e => { e.currentTarget.style.background = '#EFF6FF' }}
        onMouseLeave={e => { e.currentTarget.style.background = T.bg }}
      >
        <td style={{ ...TD1, fontWeight:700 }}>
          <div style={{ display:'flex', alignItems:'center', gap:7 }}>
            <span style={{ fontSize:9, color:T.text3, display:'inline-block', transform:open?'rotate(90deg)':'rotate(0deg)', transition:'transform 0.15s', lineHeight:1, flexShrink:0 }}>▶</span>
            <DeptDot dept={g.dept} />
            <span>{g.dept}</span>
            <span style={{ fontSize:10, color:T.text3, background:T.bg4, borderRadius:8, padding:'1px 6px', marginLeft:2, flexShrink:0 }}>{g.items.length}</span>
          </div>
        </td>
        <CustCells r={g} />
        {hasDelta && groupGrowthCell(g)}
      </tr>
    )

    if (open) {
      if (g.items.length === 0) {
        grpRows.push(
          <tr key={`ge_${g.dept}`} style={{ background:T.bg }}>
            <td colSpan={colSpan} style={{ padding:'8px 14px 8px 46px', fontSize:12, color:T.text3, fontStyle:'italic' }}>
              No accounts match the current filters.
            </td>
          </tr>
        )
      } else {
        // Sub-team summary rows (e.g. Sales Mo inside EAM Chris)
        const subs = {}
        g.items.forEach(r => {
          if (rollupDept(r.dept) === r.dept) return
          const k = r.dept
          if (!subs[k]) subs[k] = { sales:0, base_sales:0, profit:0, base_profit:0, revenue:0, items:0 }
          subs[k].sales       += r.sales
          subs[k].base_sales  += r.base_sales
          subs[k].profit      += r.profit !== null ? r.profit : 0
          subs[k].base_profit += r.base_profit
          subs[k].revenue     += r.revenue
          subs[k].items++
        })
        Object.keys(subs).sort().forEach(k => {
          const v   = subs[k]
          const row = {
            sales:       v.sales,       base_sales:  v.base_sales,
            profit:      v.profit,      base_profit: v.base_profit,
            s_delta:     v.sales - v.base_sales,
            s_pct:       salesPct(v.sales, v.base_sales),
            p_delta:     v.profit - v.base_profit,
            p_pct:       profitPct(v.profit, v.base_profit),
            margin:      v.revenue > 0 ? v.profit / v.revenue : null,
            revenue:     v.revenue,
          }
          grpRows.push(
            <tr key={`sub_${k}`} style={{ ...ROW, background:T.bg }}>
              <td style={{ ...TD1, paddingLeft:36, fontWeight:600 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ color:T.text3, fontSize:11, minWidth:10 }}>└</span>
                  <DeptDot dept={k} />
                  <span>{k}</span>
                  <span style={{ fontSize:10, color:T.text3, background:T.bg4, border:`1px solid ${T.border}`, borderRadius:9, padding:'1px 7px', marginLeft:6, whiteSpace:'nowrap' }}>
                    {v.items} account{v.items!==1?'s':''} · in {g.dept}
                  </span>
                </div>
              </td>
              <CustCells r={row} />
              {/* Sub-team summary row growth: always '—' (individual rows show deltas) */}
              {hasDelta && <td style={{ padding:'8px 14px', textAlign:'right', verticalAlign:'middle', color:T.text3, fontSize:13 }}>—</td>}
            </tr>
          )
        })

        // Individual customer rows
        g.items.forEach(r => {
          const isUnknown    = r.cust === '(Unknown)'
          const isUnassigned = r.dept === '(Unassigned)'
          const muted        = isUnknown || isUnassigned
          grpRows.push(
            <tr
              key={`ch_${r.dept}|${r.cust}`}
              style={{ ...ROW, background:T.bg }}
              onMouseEnter={e => { if (!muted) e.currentTarget.style.background = '#EFF6FF' }}
              onMouseLeave={e => { e.currentTarget.style.background = T.bg }}
            >
              <td style={{ ...TD1, paddingLeft:46, fontStyle:muted?'italic':'normal', color:muted?T.text3:T.text }}>
                <span>{r.cust}</span>
                <DeptTag dept={r.dept} />
              </td>
              <CustCells r={r} />
              {hasDelta && growthCell(r)}
            </tr>
          )
        })
      }
    }

    return grpRows
  })

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom:16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <h1 style={{ fontSize:20, fontWeight:700, color:T.text, margin:0 }}>Customer Performance</h1>
          {/* Snapshot badge — replaces LIVE; source is snap.class_c_raw_weekly */}
          <span style={{ fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:10, background:T.bg4, color:T.text3, letterSpacing:'0.04em' }}>
            Data as of {asAt ?? '…'}
          </span>
        </div>
        <div style={{ fontSize:13, color:T.text3, marginTop:4 }}>
          Aggregated to (department, customer) grain from snapshot data · sorted by Sales Amount
        </div>
      </div>

      {/* §4.2 cross-month notice */}
      {prevSnapDate && !sameMonth && (custPrev||[]).length > 0 && (
        <div style={{ background:'rgba(234,179,8,.12)', border:'1px solid #EAB308', borderRadius:8, padding:'10px 14px', marginBottom:12, fontSize:12.5, color:'#78590A', lineHeight:1.6 }}>
          Growth column hidden — snapshots {asAt} and {prevSnapDate} span a month boundary (MTD resets). Will show once both snapshots share the same month.
        </div>
      )}

      {/* Filter bar */}
      <div style={{ display:'flex', alignItems:'flex-end', gap:14, flexWrap:'wrap', padding:'12px 14px', background:T.bg2, border:`1px solid ${T.border}`, borderRadius:10, marginBottom:14 }}>
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <span style={{ fontSize:10.5, textTransform:'uppercase', letterSpacing:'.04em', color:T.text3, fontWeight:600 }}>Department</span>
          <select style={SEL} value={filters.dept} onChange={e => setFilters(f => ({...f, dept:e.target.value}))}>
            <option value="">All departments</option>
            {deptOptions.map(([d,cnt]) => <option key={d} value={d}>{d} ({cnt})</option>)}
          </select>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <span style={{ fontSize:10.5, textTransform:'uppercase', letterSpacing:'.04em', color:T.text3, fontWeight:600 }}>Customer Search</span>
          <input type="text" placeholder="e.g. Booking" value={filters.search} onChange={e => setFilters(f => ({...f, search:e.target.value}))} style={{ ...SEL, minWidth:210 }} />
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <span style={{ fontSize:10.5, textTransform:'uppercase', letterSpacing:'.04em', color:T.text3, fontWeight:600 }}>Activity</span>
          <select style={SEL} value={filters.active} onChange={e => setFilters(f => ({...f, active:e.target.value}))}>
            <option value="active">Active only (sales or profit ≠ 0)</option>
            <option value="all">Include dormant accounts</option>
          </select>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <span style={{ fontSize:10.5, textTransform:'uppercase', letterSpacing:'.04em', color:T.text3, fontWeight:600 }}>Compare Against</span>
          <select style={SEL} value={filters.basis} onChange={e => setFilters(f => ({...f, basis:e.target.value}))}>
            <option value="lm">Last month MTD</option>
            <option value="ly">Last year MTD</option>
          </select>
        </div>
        <button onClick={resetFilters} style={{ fontSize:12, color:T.blue, background:'none', border:'none', cursor:'pointer', textDecoration:'underline', fontFamily:'inherit', padding:'5px 0', alignSelf:'flex-end' }}>Reset filters</button>
        <div style={{ marginLeft:'auto' }}>
          <button
            onClick={() => exportCsv(rows, filters.basis, asAt, prevSnapDate, prevMap, targets)}
            style={{ fontSize:12, fontWeight:600, padding:'6px 14px', border:`1px solid ${T.border2}`, borderRadius:6, background:T.bg, color:T.text2, cursor:'pointer', fontFamily:'inherit' }}
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:16 }}>
        {/* FIX 4: distinct customer count (118 = 117 named + (Unknown)), same definition as Exec Summary */}
        <KpiTile
          label="Accounts shown"
          value={numFmt(rows.length)}
          sub={`of ${numFmt(new Set((cust||[]).map(r => r.cust)).size)} on file`}
        />
        {/* FIX 3: sub-label makes explicit that delta is against active-only baseline when filter is active */}
        <KpiTile
          label={`Sales Amount (${short})`}
          value={usdC(st.sales)}
          sub={`${signed(stx.s_delta)} vs ${blLabel}${filters.active==='active'?' · active accounts only':''}`}
          subColor={deltaColor(stx.s_delta)}
        />
        <KpiTile
          label={`Total Profit (${short})`}
          value={usdC(st.profit)}
          sub={`${signed(stx.p_delta)} vs ${blLabel}${filters.active==='active'?' · active accounts only':''}`}
          subColor={deltaColor(stx.p_delta)}
        />
        <KpiTile label="Blended margin" value={pctFmt(stx.margin, 1)} sub={`Revenue ${usdC(st.revenue)}`} />
      </div>

      {/* View mode controls */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12, flexWrap:'wrap' }}>
        <span style={{ fontSize:10.5, textTransform:'uppercase', letterSpacing:'.04em', color:T.text3, fontWeight:600 }}>Group</span>
        <div style={{ display:'inline-flex', border:`1px solid ${T.border}`, borderRadius:6, overflow:'hidden' }}>
          {[['eam','By EAM'],['flat','Flat list']].map(([v,lbl]) => (
            <button key={v} onClick={() => setGroup(v)} style={{ fontSize:12, padding:'5px 11px', fontFamily:'inherit', border:'none', cursor:'pointer', background:custGroup===v?T.blue:T.bg, color:custGroup===v?'#fff':T.text2, transition:'background 0.15s,color 0.15s' }}>{lbl}</button>
          ))}
        </div>
        {custGroup==='eam' && (<>
          <button onClick={() => setAll(true)}  style={{ fontSize:12, fontWeight:600, padding:'5px 12px', border:`1px solid ${T.border}`, borderRadius:6, background:T.bg, color:T.text2, cursor:'pointer', fontFamily:'inherit' }}>Expand all</button>
          <button onClick={() => setAll(false)} style={{ fontSize:12, fontWeight:600, padding:'5px 12px', border:`1px solid ${T.border}`, borderRadius:6, background:T.bg, color:T.text2, cursor:'pointer', fontFamily:'inherit' }}>Collapse all</button>
        </>)}
        <div style={{ marginLeft:'auto', fontSize:12, color:T.text3, background:T.bg4, padding:'4px 10px', borderRadius:6 }}>
          {rows.length} account{rows.length!==1?'s':''}{custGroup==='eam'&&` · ${groups.length} team${groups.length!==1?'s':''}`}
        </div>
      </div>

      {/* Table */}
      <div style={{ background:T.bg, borderRadius:12, boxShadow:T.lift, border:`1px solid ${T.border}`, overflow:'hidden', marginBottom:16 }}>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'auto' }}>
            <thead>
              <tr>
                <TH k="cust" label={custGroup==='eam'?'Team / Customer':'Customer'} />
                {/* §2.3: unambiguous header labels to prevent "two positive numbers" confusion */}
                <TH k="sales"   label="Sales Amount"        right sub={`${blLabel} ▼`} />
                <TH k="s_delta" label={`Sales vs ${blLabel}`} right />
                <TH k="profit"  label="Total Profit"        right sub={blLabel} />
                <TH k="p_delta" label={`Profit vs ${blLabel}`} right />
                <TH k="margin"  label="Margin" right />
                {hasDelta && (
                  <TH k="_growth" label={deltaLabel ?? 'Growth'} right sub={`vs ${prevSnapDate ?? '?'}`} />
                )}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={colSpan} style={{ padding:'32px 20px', textAlign:'center', fontSize:13, color:T.text3 }}>No accounts match the current filters.</td></tr>
              ) : custGroup === 'flat' ? (
                rows.map(renderFlatRow)
              ) : (
                renderGrouped()
              )}

              {/* Total row */}
              {rows.length > 0 && (
                <tr style={{ background:T.bg, borderTop:`2px solid ${T.border}` }}>
                  <td style={{ ...TD1, fontWeight:700 }}>Total — {rows.length} account{rows.length!==1?'s':''}</td>
                  <CustCells r={stx} />
                  {hasDelta && (
                    // §5.13: sum of all customer growth cells = Departments Total (+$144,011)
                    (() => {
                      let sumDp = 0
                      rows.forEach(r => {
                        const key     = `${r.dept}||${r.cust}`
                        const prev    = prevMap[key]
                        if (prev === undefined) return
                        const curP    = r.profit !== null ? _num(r.profit) : null
                        const prevP   = prev !== null ? prev : 0
                        if (curP !== null) sumDp += curP - prevP
                      })
                      const c = sumDp >= 0 ? T.green : T.red
                      return (
                        <td style={{ padding:'8px 14px', textAlign:'right', verticalAlign:'middle' }}>
                          <span style={{ fontVariantNumeric:'tabular-nums', fontWeight:700, color:c }}>
                            {sumDp > 0 ? '+' : ''}{usd(sumDp)}
                          </span>
                        </td>
                      )
                    })()
                  )}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* §10.3 — LY=LM warning on single-month reconstructed periods */}
      {filters.basis==='ly' && /^\d{4}-\d{2}$/.test(period) && (
        <div style={{ background:'rgba(234,179,8,.16)', border:'1px solid #EAB308', borderRadius:8, padding:'10px 14px', marginTop:8, fontSize:12, color:'#9A6B0C', lineHeight:1.65 }}>
          ⚠️ <strong>Last year MTD equals Last month MTD on single-month selections.</strong> The reconstructed monthly source ({period}) carries no prior-year data, so LY and LM comparisons are identical here. Switch to MTD for a true year-on-year comparison.
        </div>
      )}
    </div>
  )
}
