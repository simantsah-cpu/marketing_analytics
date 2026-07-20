/**
 * FullFunnelTab.jsx
 * Page 3 of the Destination Intelligence dashboard — "Full Funnel"
 *
 * Four blocks:
 *   (a) Funnel visual — 4 stages, current vs comparison, inline SVG
 *   (b) Three rate cards — Search→Book, Search→Select, Payment→Booking
 *   (c) Stage-conversion trend — FIXED 56-week chart (not bar-driven)
 *   (d) Weekly funnel table — chronological, period-exact tx
 *
 * Checkout redefinition caveat (C1-C3):
 *   pf (checkout event) was redefined during 2025; YoY comparisons for pf are not
 *   like-for-like. Always attach caveat; never rescale historical values.
 *
 * Data: SITEW from Q6 (56 ISO weeks, period-exact deduped tx)
 *       SD from DestinationAnalysisNew (daily grain, site-wide, for dynamic range sums)
 */

import { memo, useMemo } from 'react'
import { SITEW } from '../data/siteWeekly.js'

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  pine:'#0A2540', leaf:'#0D8A72', ink:'#1A2B3C', inkSoft:'#5A6A7A',
  paper:'#F8FAFC', card:'#FFFFFF', line:'#E2EAF0', prior:'#0F5FA6',
  cmpBar:'#9FB6C9', amber:'#D97706', coral:'#C0392B',
  leafLight:'#E6F5F2', coralLight:'#FDEDEB', grey:'#E2EAF0',
}

// ─── Constants ────────────────────────────────────────────────────────────────
const GA4_S = 382   // offset 2025-06-16
const GA4_E = 767   // offset 2026-07-08
const BASE  = new Date('2024-06-01T00:00:00Z')

// ─── SD daily data ————————————————————————————————————————————————————————————
// Re-parse from SITEW is not needed — we use the passed-in siteGa4Range fn from parent
// The parent passes in curFunnel = {s,vs,pf,p,tx,r} and prvFunnel for the dynamic blocks

// ─── Formatters ──────────────────────────────────────────────────────────────
function fmtNum(n) {
  if (n==null||isNaN(n)) return '—'
  return Math.round(n).toLocaleString('en-GB')
}
function fmtGBP(n) {
  if (n==null||isNaN(n)||n===0) return '—'
  const a=Math.abs(n),sg=n<0?'-':''
  if(a>=1e6) return sg+'£'+(a/1e6).toFixed(2)+'M'
  if(a>=1e3) return sg+'£'+Math.round(a/1e3).toLocaleString('en-GB')
  return sg+'£'+Math.round(n).toLocaleString('en-GB')
}
function fmtPct(n, dp=2) {
  if (n==null||!isFinite(n)) return '—'
  return n.toFixed(dp)+'%'
}
function fmtPp(d) {
  if (d==null||!isFinite(d)) return '—'
  return (d>=0?'+':'')+d.toFixed(1)+'pp'
}

// ─── ISO week label ───────────────────────────────────────────────────────────
function ywLabel(yw, days) {
  // yw = '2627' -> 'W27 2026'
  const yr = '20' + yw.slice(0, 2)
  const wk = yw.slice(2)
  return `W${wk} ${yr}${days < 7 ? ` (${days}d)` : ''}`
}

// ─── Rate card ────────────────────────────────────────────────────────────────
function RateCard({ title, rate, cmpRate, caveat, footnote, webValid }) {
  const pp = (webValid && cmpRate != null) ? rate - cmpRate : null
  const up = pp != null ? pp >= 0 : null
  return (
    <div style={{background:T.card,border:`1px solid ${T.line}`,borderRadius:12,
      padding:'16px 18px',flex:'1 1 220px',boxShadow:'0 1px 3px rgba(0,0,0,.05)'}}>
      <div style={{fontSize:11,fontWeight:700,color:T.inkSoft,textTransform:'uppercase',
        letterSpacing:'.07em',marginBottom:8}}>{title}</div>
      <div style={{fontSize:28,fontWeight:700,color:T.ink,letterSpacing:'-.5px',fontVariantNumeric:'tabular-nums'}}>
        {fmtPct(rate)}
      </div>
      {webValid && cmpRate != null && (
        <div style={{fontSize:12,color:T.inkSoft,margin:'4px 0 6px'}}>
          cmp: {fmtPct(cmpRate)}{caveat ? <span style={{color:T.amber,fontSize:10,marginLeft:4}}>{caveat}</span> : null}
        </div>
      )}
      {pp != null && (
        <span style={{display:'inline-flex',alignItems:'center',gap:3,padding:'3px 9px',
          borderRadius:20,fontSize:11,fontWeight:700,
          background:up?T.leafLight:T.coralLight,color:up?'#0A7A52':T.coral}}>
          {up?'▲':'▼'} {fmtPp(pp)}
        </span>
      )}
      {!webValid && (
        <span style={{display:'inline-block',padding:'3px 9px',borderRadius:20,fontSize:11,
          fontWeight:700,background:T.grey,color:T.inkSoft}}>no basis</span>
      )}
      {footnote && <div style={{fontSize:10,color:T.inkSoft,marginTop:6,lineHeight:1.5}}>{footnote}</div>}
    </div>
  )
}

// ─── (a) Funnel visual SVG ────────────────────────────────────────────────────
function FunnelVisual({ cur, prv, webValid, width }) {
  const W = width || 1100, H = 266
  const labelW = 130, rightW = 140, barAreaW = W - labelW - rightW - 32
  const rowH = H / 4
  const stages = [
    { label: '1. Searches',      curV: cur?.s,  prvV: prv?.s,  key: 's'  },
    { label: '2. Vehicle select',curV: cur?.vs, prvV: prv?.vs, key: 'vs' },
    { label: '3. Payment form',  curV: cur?.pf, prvV: prv?.pf, key: 'pf', redef: true },
    { label: '4. Bookings',      curV: cur?.p,  prvV: prv?.p,  key: 'p'  },
  ]
  const maxV = cur?.s || 1
  const elems = []

  // Horizontal dividers
  for (let i = 1; i < 4; i++) {
    const y = rowH * i
    elems.push(<line key={'div'+i} x1={0} y1={y} x2={W} y2={y} stroke={T.line} strokeWidth={0.5}/>)
  }

  stages.forEach(({ label, curV, prvV, redef }, i) => {
    const cy = rowH * i
    const midY = cy + rowH / 2
    const barH = 14
    const cmpBarH = 10

    // Current bar (green)
    const curW = Math.max(2, (curV / maxV) * barAreaW)
    elems.push(
      <rect key={'cb'+i} x={labelW} y={midY - barH/2 + 4} width={curW} height={barH}
        rx={3} fill={T.leaf}/>
    )
    // Current value label on bar right
    elems.push(
      <text key={'cv'+i} x={labelW + curW + 6} y={midY + 5 + 4} fontSize={11}
        fontWeight={600} fill={T.ink}>{fmtNum(curV)}</text>
    )

    // Comparison bar (pale blue) — above current, only when valid
    if (webValid && prvV != null && prvV > 0) {
      const prvW = Math.max(2, (prvV / maxV) * barAreaW)
      elems.push(
        <rect key={'pb'+i} x={labelW} y={midY - barH/2 - cmpBarH - 2} width={prvW}
          height={cmpBarH} rx={2} fill={T.cmpBar} opacity={0.8}/>
      )
      elems.push(
        <text key={'pv'+i} x={labelW + prvW + 6} y={midY - barH/2 - 2} fontSize={10}
          fill={T.inkSoft}>{fmtNum(prvV)} (cmp)</text>
      )
    }

    // Stage label (left)
    elems.push(
      <text key={'lbl'+i} x={labelW - 8} y={midY + 5} textAnchor="end" fontSize={11}
        fontWeight={600} fill={T.ink}>{label}</text>
    )

    // Step conversion + pp delta (right)
    if (i > 0) {
      const prevStage = stages[i - 1]
      const prevV = prevStage.curV || 1
      const conv = curV / prevV * 100
      const cmpConv = (webValid && prevStage.prvV && prvV)
        ? (prvV / prevStage.prvV * 100) : null
      const pp = cmpConv != null ? conv - cmpConv : null
      const ppUp = pp != null ? pp >= 0 : null

      elems.push(
        <text key={'sc'+i} x={W - 8} y={midY - 2} textAnchor="end" fontSize={10}
          fontWeight={600} fill={T.inkSoft}>step conv {fmtPct(conv, 1)}</text>
      )
      if (pp != null) {
        const ppColor = redef ? T.amber : (ppUp ? '#0A7A52' : T.coral)
        elems.push(
          <text key={'pp'+i} x={W - 8} y={midY + 13} textAnchor="end" fontSize={11}
            fontWeight={700} fill={ppColor}>
            {(ppUp ? '+' : '') + fmtPp(pp)}{redef ? ' ⚠' : ''}
          </text>
        )
      }
    }
  })

  return (
    <svg width={W} height={H} style={{display:'block',fontFamily:'Inter,system-ui,sans-serif',overflow:'visible'}}>
      {elems}
    </svg>
  )
}

// ─── (c) Stage-conversion trend chart ────────────────────────────────────────
function TrendChart({ width }) {
  const W = width || 1150, H = 260
  const PAD = { l: 52, r: 24, t: 20, b: 44 }
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b

  // Compute rates for all 56 weeks
  const weeks = SITEW.map(w => ({
    yw: w.yw, days: w.days,
    ss: w.s > 0 ? w.vs / w.s * 100 : null,         // search→select
    sp: w.vs > 0 ? w.pf / w.vs * 100 : null,        // select→payment
    pb: w.pf > 0 ? w.p / w.pf * 100 : null,         // payment→booking
  }))

  const n = weeks.length
  const allVals = weeks.flatMap(w => [w.ss, w.sp, w.pb].filter(v => v != null))
  const maxY = Math.min(Math.ceil(Math.max(...allVals) * 1.1 / 25) * 25, 120)

  const xOf = i => PAD.l + (i / (n - 1)) * plotW
  const yOf = v => PAD.t + plotH - (v / maxY) * plotH

  const elems = []

  // Gridlines
  for (let g = 0; g <= maxY; g += 25) {
    const y = yOf(g)
    elems.push(<line key={'g'+g} x1={PAD.l} y1={y} x2={W-PAD.r} y2={y} stroke={T.line} strokeWidth={0.7}/>)
    elems.push(<text key={'yl'+g} x={PAD.l-5} y={y+3.5} textAnchor="end" fontSize={9} fill={T.inkSoft}>{g}%</text>)
  }

  // Build line paths
  const buildPath = (key) => {
    let d = ''
    weeks.forEach((w, i) => {
      const v = w[key]
      if (v == null) return
      const x = xOf(i).toFixed(1), y = yOf(v).toFixed(1)
      d += (d === '' ? 'M' : 'L') + x + ',' + y + ' '
    })
    return d.trim()
  }

  const lines = [
    { key: 'ss', color: T.leaf,  label: 'Search→Select' },
    { key: 'sp', color: T.prior, label: 'Select→Payment' },
    { key: 'pb', color: T.coral, label: 'Payment→Booking' },
  ]

  lines.forEach(({ key, color }) => {
    const d = buildPath(key)
    if (d) elems.push(<path key={'line-'+key} d={d} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round"/>)

    // Points (hollow for partial weeks)
    weeks.forEach((w, i) => {
      const v = w[key]
      if (v == null) return
      const x = xOf(i).toFixed(1), y = yOf(v).toFixed(1)
      if (w.days < 7) {
        elems.push(<circle key={'pt-'+key+i} cx={x} cy={y} r={4} fill="white" stroke={color} strokeWidth={1.5}>
          <title>{ywLabel(w.yw, w.days)}: {v.toFixed(1)}%</title>
        </circle>)
      } else {
        elems.push(<circle key={'pt-'+key+i} cx={x} cy={y} r={2.5} fill={color}>
          <title>{ywLabel(w.yw, w.days)}: {v.toFixed(1)}%</title>
        </circle>)
      }
    })
  })

  // X labels every 4th week
  weeks.forEach((w, i) => {
    if (i % 4 !== 0) return
    const x = xOf(i).toFixed(1)
    const yr = '2' + w.yw.slice(1, 2), wk = w.yw.slice(2)
    elems.push(<text key={'xl'+i} x={x} y={H-PAD.b+14} textAnchor="middle" fontSize={9} fill={T.inkSoft}>{yr}W{wk}</text>)
  })

  return (
    <svg width={W} height={H} style={{display:'block',fontFamily:'Inter,system-ui,sans-serif'}}>
      {elems}
      {/* Legend */}
      {lines.map(({ key, color, label }, i) => (
        <g key={'leg'+key} transform={`translate(${PAD.l + i * 130}, ${H - 12})`}>
          <circle cx={5} cy={0} r={5} fill={color}/>
          <text x={12} y={4} fontSize={9} fill={T.inkSoft}>{label}</text>
        </g>
      ))}
    </svg>
  )
}

// ─── (d) Weekly funnel table ──────────────────────────────────────────────────
const thS = {
  padding:'8px 10px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.05em',
  color:T.inkSoft,background:T.card,position:'sticky',top:0,zIndex:2,
  borderBottom:`2px solid ${T.line}`,whiteSpace:'nowrap',textAlign:'right',
}
const tdS = {
  padding:'6px 10px',fontSize:12,color:T.ink,borderBottom:`1px solid ${T.line}`,
  whiteSpace:'nowrap',textAlign:'right',fontVariantNumeric:'tabular-nums',
}

function WeeklyTable() {
  // Show most recent first for usability, but brief says chronological
  return (
    <div style={{maxHeight:480,overflowY:'auto',overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse'}}>
        <thead>
          <tr>
            <th style={{...thS,textAlign:'left',minWidth:110}}>Week</th>
            <th style={thS}>Searches</th>
            <th style={thS}>Vehicle select</th>
            <th style={thS}>Payment</th>
            <th style={thS}>Purchases</th>
            <th style={thS}>Transactions</th>
            <th style={thS}>Revenue</th>
            <th style={thS}>S→B</th>
          </tr>
        </thead>
        <tbody>
          {SITEW.map((w, idx) => {
            const sb = w.s > 0 ? w.p / w.s * 100 : 0
            return (
              <tr key={w.yw} style={{background: idx%2===0?T.card:T.paper}}>
                <td style={{...tdS,textAlign:'left',fontWeight:600}}>
                  {`W${w.yw.slice(2)} 20${w.yw.slice(0,2)}`}
                  {w.days < 7 && <span style={{fontSize:10,color:T.inkSoft,fontWeight:400,marginLeft:4}}>({w.days}d)</span>}
                </td>
                <td style={tdS}>{fmtNum(w.s)}</td>
                <td style={tdS}>{fmtNum(w.vs)}</td>
                <td style={tdS}>{fmtNum(w.pf)}</td>
                <td style={tdS}>{fmtNum(w.p)}</td>
                <td style={{...tdS,fontWeight:600,color:T.pine}}>{fmtNum(w.tx)}</td>
                <td style={tdS}>{fmtGBP(w.r)}</td>
                <td style={{...tdS,color:T.inkSoft}}>{fmtPct(sb)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main Full Funnel Tab ─────────────────────────────────────────────────────
export default memo(function FullFunnelTab({ curFunnel, prvFunnel, webValid, tfLabel, cmpLabel, chartWidth }) {
  const cur = curFunnel || {}
  const prv = prvFunnel || {}

  const s2b    = cur.s  > 0 ? cur.p  / cur.s  * 100 : null
  const s2vs   = cur.s  > 0 ? cur.vs / cur.s  * 100 : null
  const p2b    = cur.pf > 0 ? cur.p  / cur.pf * 100 : null
  const cs2b   = (webValid && prv.s  > 0) ? prv.p  / prv.s  * 100 : null
  const cs2vs  = (webValid && prv.s  > 0) ? prv.vs / prv.s  * 100 : null
  const cp2b   = (webValid && prv.pf > 0) ? prv.p  / prv.pf * 100 : null

  const hasData = cur.s > 0

  const secHead = (title, sub) => (
    <div style={{display:'flex',alignItems:'baseline',gap:10,margin:'0 0 6px',borderLeft:`4px solid ${T.leaf}`,paddingLeft:10}}>
      <h2 style={{fontFamily:"'DM Sans',system-ui,sans-serif",fontSize:13,fontWeight:700,color:T.ink}}>{title}</h2>
      {sub && <span style={{fontSize:11,color:T.inkSoft}}>{sub}</span>}
    </div>
  )

  return (
    <div>
      {/* Page header */}
      <div style={{marginBottom:12}}>
        <div style={{fontSize:12,color:T.inkSoft,margin:'0 0 4px'}}>
          <span>Search → vehicle select → payment → booking, whole site. </span>
          <details style={{display:'inline-block',verticalAlign:'bottom'}}>
            <summary style={{cursor:'pointer',color:T.leaf,fontWeight:600,fontSize:11,listStyle:'none',display:'inline'}}>
              definitions &amp; caveat ▾
            </summary>
            <div style={{background:T.card,border:`1px solid ${T.line}`,borderRadius:8,
              padding:'10px 14px',marginTop:6,fontSize:11,color:T.inkSoft,lineHeight:1.7,
              position:'relative',zIndex:10}}>
              <strong style={{color:T.ink}}>Stage mapping:</strong><br/>
              Stage 1 Searches = <code>view_search_results</code><br/>
              Stage 2 Vehicle select = <code>begin_checkout</code> (user saw quotes &amp; picked vehicle)<br/>
              Stage 3 Payment form = <code>checkout</code> (user reached payment step)<br/>
              Stage 4 Bookings = <code>purchase</code><br/>
              Scope: whole site (hoppa.com + app, all routes).<br/><br/>
              <strong style={{color:T.amber}}>⚠ Checkout event redefinition:</strong> The <code>checkout</code> event was redefined during 2025 — it now fires on a wider set of payment-step views than mid-2025.
              Consequence: pf counts grew ~+54% YoY while purchases fell — the payment→booking rate looks like it collapsed YoY; it did not.
              This asymmetry is a definitional artefact. Read the within-2026 trend (Stage-conversion chart below), not cross-2025 levels.
              Raw values are shown as-is; no rescaling.
            </div>
          </details>
        </div>
        <div style={{fontSize:11,fontWeight:600,color:T.ink,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
          <span>{tfLabel}</span>
          {cmpLabel && <span style={{color:T.inkSoft,fontWeight:400}}>· {cmpLabel}</span>}
          <span style={{
            padding:'2px 8px',borderRadius:20,fontSize:10,fontWeight:700,
            background:webValid?'rgba(20,160,107,.15)':'rgba(0,0,0,.06)',
            color:webValid?'#0A7A52':T.inkSoft,
            border:webValid?'1px solid rgba(20,160,107,.4)':`1px solid ${T.line}`,
          }}>{webValid?'web valid':'no basis'}</span>
          <span style={{fontSize:10,color:T.inkSoft,fontWeight:400}}>
            · funnel stages use events; deduped transactions in the weekly table
          </span>
        </div>
      </div>

      {/* ── (a) Funnel visual ── */}
      {secHead('Site-wide booking funnel')}
      <div style={{background:T.card,border:`1px solid ${T.line}`,borderRadius:12,
        padding:'16px 18px',boxShadow:'0 1px 3px rgba(0,0,0,.05)',marginBottom:20}}>
        {!hasData ? (
          <div style={{fontSize:12,color:T.inkSoft,padding:'12px 0'}}>
            Selected range is outside the GA4 export (16 Jun 2025 – 8 Jul 2026).
          </div>
        ) : (
          <FunnelVisual cur={cur} prv={webValid ? prv : null} webValid={webValid}
            width={chartWidth || 900}/>
        )}
        {hasData && webValid && (
          <div style={{fontSize:10,color:T.inkSoft,marginTop:8,display:'flex',gap:16,flexWrap:'wrap'}}>
            <span><span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:T.leaf,marginRight:4,verticalAlign:'middle'}}/>Current period</span>
            <span><span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:T.cmpBar,marginRight:4,verticalAlign:'middle'}}/>Comparison (same scale)</span>
            <span style={{color:T.amber}}>⚠ Payment form step — checkout event redefined in 2025, not like-for-like</span>
          </div>
        )}
      </div>

      {/* ── (b) Three rate cards ── */}
      {secHead('Conversion rates')}
      <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:20}}>
        <RateCard
          title="Search → book"
          rate={s2b} cmpRate={cs2b}
          webValid={webValid}
          footnote="purchase events ÷ searches"
        />
        <RateCard
          title="Search → vehicle select"
          rate={s2vs} cmpRate={cs2vs}
          webValid={webValid}
          footnote="supply visibility: are we quoting when people search?"
        />
        <RateCard
          title="Payment → booking"
          rate={p2b} cmpRate={cp2b}
          caveat="(checkout event redefined in 2025)"
          webValid={webValid}
          footnote="read within-2026 trend below, not cross-2025 levels"
        />
      </div>

      {/* ── (c) Stage-conversion trend — FIXED, not bar-driven ── */}
      {secHead('Stage conversion, week by week', `Fixed view: all ${SITEW.length} weeks`)}
      <div style={{background:T.card,border:`1px solid ${T.line}`,borderRadius:12,
        padding:'16px 18px 12px',boxShadow:'0 1px 3px rgba(0,0,0,.05)',marginBottom:20}}>
        <div style={{fontSize:11,color:T.inkSoft,marginBottom:8}}>
          Hollow points = partial weeks · payment→booking is where the 2026 story is decided.
        </div>
        <div style={{overflowX:'auto'}}>
          <TrendChart width={chartWidth || 1100}/>
        </div>
        <div style={{fontSize:10,color:T.amber,marginTop:6}}>
          ⚠ Payment→Booking line: checkout event redefined in 2025. The reliable read is the within-2026 trend (right half of chart).
        </div>
      </div>

      {/* ── (d) Weekly funnel table ── */}
      {secHead('Weekly funnel table')}
      <div style={{background:T.card,border:`1px solid ${T.line}`,borderRadius:12,
        overflow:'hidden',boxShadow:'0 1px 3px rgba(0,0,0,.05)',marginBottom:20}}>
        <div style={{padding:'10px 14px',fontSize:11,color:T.inkSoft,borderBottom:`1px solid ${T.line}`}}>
          Period-exact deduped transactions (COUNT DISTINCT transaction_id) — this is the source of truth for tx per R4.
          Purchases (p) ≠ Transactions (tx): purchase events fire once per checkout attempt; tx dedupes by transaction_id.
          {' '}<strong style={{color:T.ink}}>W27-2026: tx=1,911 · purchases=2,582 · difference expected per R4.</strong>
        </div>
        <WeeklyTable/>
      </div>

      {/* Method note */}
      <div style={{fontSize:10,color:T.inkSoft,lineHeight:1.7}}>
        <strong style={{color:T.ink,fontWeight:600}}>Data & method.</strong> Q6: GA4 analytics_259261360 events_20250616–20260708, four events:
        view_search_results / begin_checkout / checkout / purchase. Transactions = COUNT(DISTINCT transaction_id) per ISO week.
        Revenue = SUM(ecommerce.purchase_revenue). Checkout event redefined during 2025 — C1/C2/C3 rules applied.
        <strong style={{color:T.ink}}> Validation: W27-2026 s=57,589 tx=1,911 r=£178,950 ✅ | W24-W28 2026 sum s=252,951 p=10,281 tx=7,552 r=£699,844 ✅</strong>
      </div>
    </div>
  )
})
