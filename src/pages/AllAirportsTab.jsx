/**
 * AllAirportsTab.jsx — Page 4: All Airports
 * Four views: Both | From (pick-up) | To (drop-off) | Routes explorer
 * League table, drill-down, routes explorer — all data embedded, no network calls.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { AP_ROSTER } from '../data/overviewRoster.js'
import { AP_GA4 } from '../data/overviewGa4.js'
import { AP_OPS } from '../data/overviewOps.js'
import { AP_MONTHLY_GA4, AP_MONTHLY_OPS } from '../data/apMonthly.js'
import { AP_ROUTES } from '../data/apRoutes.js'

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  pine: '#0A2540', leaf: '#0D8A72', ink: '#1A2B3C', inkSoft: '#5A6A7A',
  paper: '#F8FAFC', card: '#FFFFFF', line: '#E2EAF0', prior: '#0F5FA6',
  amber: '#D97706', coral: '#C0392B', salmon: '#D98C7A',
  leafLight: '#E6F5F2', amberLight: '#FDF4E3', coralLight: '#FDEDEB',
  grey: '#E2EAF0', pine2: '#0D6B55',
}

// ─── Constants ────────────────────────────────────────────────────────────────
const BASE = new Date('2024-06-01T00:00:00Z')
const GA4_START = 382, GA4_END = 767

function dayOffset(dateStr) {
  return Math.round((new Date(dateStr + 'T00:00:00Z') - BASE) / 86400000)
}
function offsetToDate(o) {
  return new Date(BASE.getTime() + o * 86400000).toISOString().slice(0, 10)
}

// ─── Daily parsers ────────────────────────────────────────────────────────────
const _ga4Cache = {}
function parseGA4Daily(cd) {
  if (_ga4Cache[cd]) return _ga4Cache[cd]
  const dl = AP_GA4[cd] || ''
  const map = {}
  dl.split('|').forEach(seg => {
    const parts = seg.split(':')
    if (parts.length < 2) return
    const o = parseInt(parts[0])
    map[o] = [parseInt(parts[1])||0, parts[2]!=null?parseInt(parts[2]):0, parts[3]!=null?parseInt(parts[3]):0]
  })
  return (_ga4Cache[cd] = map)
}
const _opsCache = {}
function parseOpsDaily(cd) {
  if (_opsCache[cd]) return _opsCache[cd]
  const dl = AP_OPS[cd] || ''
  const map = {}
  dl.split('|').forEach(seg => {
    const parts = seg.split(':').map(Number)
    if (parts.length >= 4) map[parts[0]] = [parts[1], parts[2], parts[3]]
  })
  return (_opsCache[cd] = map)
}

function sumGA4(cd, lo, hi) {
  const map = parseGA4Daily(cd)
  let s=0, p=0, r=0
  for (let o=Math.max(lo,GA4_START); o<=Math.min(hi,GA4_END); o++) {
    const d=map[o]; if(!d) continue; s+=d[0]; p+=d[1]; r+=d[2]
  }
  return {s,p,r}
}
function sumOps(cd, lo, hi) {
  const map = parseOpsDaily(cd)
  let b=0,c=0,tn=0
  for (let o=lo; o<=hi; o++) { const d=map[o]; if(!d) continue; b+=d[0]; c+=d[1]; tn+=d[2] }
  return {b,c,tn}
}

// ─── Monthly parsers ──────────────────────────────────────────────────────────
function parseMonthlyGA4(cd, role) {
  const str = AP_MONTHLY_GA4[cd]?.[role] || ''
  const out = {}
  str.split('|').forEach(seg => {
    const [ym,s,p,r] = seg.split(':')
    if (ym) out[ym] = [Number(s)||0, Number(p)||0, Number(r)||0]
  })
  return out
}
function parseMonthlyOps(cd, role) {
  const str = AP_MONTHLY_OPS[cd]?.[role] || ''
  const out = {}
  str.split('|').forEach(seg => {
    const [ym,b,c,tn] = seg.split(':')
    if (ym) out[ym] = [Number(b)||0, Number(c)||0, Number(tn)||0]
  })
  return out
}

// ─── Full months within a date range ─────────────────────────────────────────
function fullMonthsIn(startStr, endStr) {
  const s = new Date(startStr + 'T00:00:00Z')
  const e = new Date(endStr + 'T00:00:00Z')
  const months = []
  let cur = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1))
  while (cur <= e) {
    const lastDay = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth()+1, 0))
    if (lastDay <= e) {
      const y = cur.getUTCFullYear(), m = cur.getUTCMonth()+1
      months.push(`${String(y).slice(2)}${String(m).padStart(2,'0')}`)
    }
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth()+1, 1))
  }
  return months
}

// Sum monthly data for a code/role over a list of ym strings
function sumMonthlyGA4(cd, role, yms) {
  const map = parseMonthlyGA4(cd, role)
  let s=0, p=0, r=0
  yms.forEach(ym => { const v=map[ym]; if(v){s+=v[0];p+=v[1];r+=v[2]} })
  return {s, p, r}
}
function sumMonthlyOps(cd, role, yms) {
  const map = parseMonthlyOps(cd, role)
  let b=0, c=0, tn=0
  yms.forEach(ym => { const v=map[ym]; if(v){b+=v[0];c+=v[1];tn+=v[2]} })
  return {b, c, tn}
}

// ─── Route parsers ────────────────────────────────────────────────────────────
function parseRoutes(ap, dirn) {
  const str = AP_ROUTES[ap]?.[dirn] || ''
  if (!str) return []
  return str.split('|').filter(Boolean).map(seg => {
    const parts = seg.split('~')
    const code = parts[0] === '-' ? null : parts[0]
    const name = parts[1] || ''
    const wp = (parts[2]||'').split(':').map(Number)
    const op = (parts[3]||'').split(':').map(Number)
    const cov = parts[4] || 'web'
    return { code, name, s:wp[0]||0, p:wp[1]||0, r:wp[2]||0, q2s:wp[3]||0, q1s:wp[4]||0,
             b:op[0]||0, c:op[1]||0, tn:op[2]||0, q2b:op[3]||0, q1b:op[4]||0, cov }
  })
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtN(n, opts={}) {
  if (n==null||isNaN(n)) return '–'
  const a=Math.abs(n), sg=n<0?'-':''
  if (opts.gbp) {
    if (a>=1e6) return sg+'£'+(a/1e6).toFixed(2)+'M'
    if (a>=1e3) return sg+'£'+Math.round(a/1e3)+'K'
    return sg+'£'+Math.round(a).toLocaleString('en-GB')
  }
  if (a>=1e6) return sg+(a/1e6).toFixed(1)+'M'
  if (a>=1e4) return sg+Math.round(a/1e3)+'K'
  if (a>=1e3) return sg+(a/1e3).toFixed(1)+'K'
  return sg+Math.round(a).toLocaleString('en-GB')
}
function fmtPct(n, dp=1) { return n==null||isNaN(n)?'–':n.toFixed(dp)+'%' }
function fmtPP(a, b) { if(!b||!a) return '–'; return fmtPct(a/b*100) }
function momChip(q2, q1, isBookings=false) {
  if (q2===0 && q1===0) return { text:'quiet', color:T.inkSoft, bg:T.grey }
  if (q1===0 && q2>0) return { text:'new', color:T.leaf, bg:T.leafLight }
  const d = (q2-q1)/Math.abs(q1)*100
  const up = d>=0
  return { text:(up?'+':'')+d.toFixed(0)+'%', color:up?T.leaf:T.coral, bg:up?T.leafLight:T.coralLight }
}

const CC_FLAG = cc => {
  if (!cc) return ''
  const flags = { ES:'🇪🇸',UK:'🇬🇧',GB:'🇬🇧',DE:'🇩🇪',FR:'🇫🇷',IT:'🇮🇹',PT:'🇵🇹',GR:'🇬🇷',TR:'🇹🇷',NL:'🇳🇱',BE:'🇧🇪',CH:'🇨🇭',AT:'🇦🇹',PL:'🇵🇱',CZ:'🇨🇿',HU:'🇭🇺',RO:'🇷🇴',BG:'🇧🇬',HR:'🇭🇷',ME:'🇲🇪',TN:'🇹🇳',MA:'🇲🇦',EG:'🇪🇬',AE:'🇦🇪',QA:'🇶🇦',OM:'🇴🇲',SA:'🇸🇦',IN:'🇮🇳',TH:'🇹🇭',ID:'🇮🇩',SG:'🇸🇬',JP:'🇯🇵',KR:'🇰🇷',AU:'🇦🇺',NZ:'🇳🇿',US:'🇺🇸',CA:'🇨🇦',MX:'🇲🇽',BR:'🇧🇷',DO:'🇩🇴',BB:'🇧🇧',LC:'🇱🇨',MU:'🇲🇺',MV:'🇲🇻',JM:'🇯🇲',KE:'🇰🇪',ZA:'🇿🇦',TZ:'🇹🇿',LK:'🇱🇰',IS:'🇮🇸',NO:'🇳🇴',SE:'🇸🇪',FI:'🇫🇮',DK:'🇩🇰',IE:'🇮🇪',MT:'🇲🇹',CY:'🇨🇾',LV:'🇱🇻',LT:'🇱🇹',EE:'🇪🇪',SK:'🇸🇰',SI:'🇸🇮',RS:'🇷🇸',BA:'🇧🇦',AL:'🇦🇱',MK:'🇲🇰',GE:'🇬🇪',AM:'🇦🇲',AZ:'🇦🇿',KZ:'🇰🇿',UZ:'🇺🇿',VN:'🇻🇳',MY:'🇲🇾',PH:'🇵🇭',HK:'🇭🇰',TW:'🇹🇼',MO:'🇲🇴',BD:'🇧🇩',PK:'🇵🇰',LB:'🇱🇧',JO:'🇯🇴',IL:'🇮🇱',KW:'🇰🇼',BH:'🇧🇭',AN:'🇦🇬',CV:'🇨🇻',SC:'🇸🇨',VG:'🇻🇬',CW:'🇨🇼',KN:'🇰🇳',AG:'🇦🇬',GD:'🇬🇩',VC:'🇻🇨',TC:'🇹🇨',GI:'🇬🇮',JE:'🇯🇪',GG:'🇬🇬',IM:'🇮🇲',FO:'🇫🇴',GL:'🇬🇱',PM:'🇵🇲',RU:'🇷🇺',CN:'🇨🇳',YE:'🇾🇪',IQ:'🇮🇶',SY:'🇸🇾',IR:'🇮🇷',AF:'🇦🇫',PG:'🇵🇬',FJ:'🇫🇯',WS:'🇼🇸',TO:'🇹🇴',VU:'🇻🇺',NC:'🇳🇨',PF:'🇵🇫' }
  return flags[cc] || ''
}

// ─── Delta chip ───────────────────────────────────────────────────────────────
function DeltaChip({ cur, prv, valid, isPP=false, small=false }) {
  if (!valid || prv==null || prv===0) {
    return <span style={{display:'inline-flex',alignItems:'center',padding:small?'2px 6px':'3px 9px',borderRadius:20,fontSize:small?9:11,fontWeight:700,background:T.grey,color:T.inkSoft}}>n/a</span>
  }
  let text, up
  if (isPP) { const d=cur-prv; up=d>=0; text=(d>=0?'+':'')+d.toFixed(2)+'pp' }
  else { const d=(cur-prv)/Math.abs(prv)*100; up=d>=0; text=(d>=0?'+':'')+d.toFixed(1)+'%' }
  return <span style={{display:'inline-flex',alignItems:'center',gap:2,padding:small?'2px 6px':'3px 9px',borderRadius:20,fontSize:small?9:11,fontWeight:700,background:up?T.leafLight:T.coralLight,color:up?'#0A7A52':T.coral}}>{up?'▲':'▼'} {text}</span>
}

// ─── Monthly dual-axis chart (drill-down) ─────────────────────────────────────
function MonthlyDrillChart({ cd, width=700 }) {
  const W=width, H=220
  const PAD={l:52,r:58,t:18,b:38}
  const plotW=W-PAD.l-PAD.r, plotH=H-PAD.t-PAD.b

  // Build months Jun 2025 – Jul 2026
  const months = []
  for (let y=2025; y<=2026; y++) {
    const mEnd = y===2025 ? 12 : 7
    for (let m=(y===2025?6:1); m<=mEnd; m++) {
      const ym = `${String(y).slice(2)}${String(m).padStart(2,'0')}`
      const ms = `${y}-${String(m).padStart(2,'0')}-01`
      const lastD = new Date(Date.UTC(y,m,0)).getUTCDate()
      const me = `${y}-${String(m).padStart(2,'0')}-${String(lastD).padStart(2,'0')}`
      const so = dayOffset(ms), eo = dayOffset(me)
      const ga4 = sumGA4(cd, so, eo)
      const ops = sumOps(cd, so, eo)
      // Partial months: Jun-2025 (partial GA4 start 2025-06-16), Jul-2026 (partial end 2026-07-08)
      const partial = (y===2025&&m===6) || (y===2026&&m===7)
      const partialDays = partial ? (y===2025&&m===6 ? 15 : 8) : null
      // Migration: Feb-Mar 2025 = before our window, not applicable here
      months.push({ ym, y, m, s:ga4.s, b:ops.b, partial, partialDays })
    }
  }

  const n = months.length
  const maxS = Math.max(...months.map(m=>m.s)) * 1.15 || 1
  const maxB = Math.max(...months.map(m=>m.b)) * 1.25 || 1
  const groupW = plotW/n
  const barW = Math.min(groupW*0.72, 32)

  const elems = []
  for (let i=0;i<=4;i++) {
    const y=PAD.t+plotH-(i/4)*plotH
    elems.push(<line key={'g'+i} x1={PAD.l} y1={y} x2={W-PAD.r} y2={y} stroke={T.line} strokeWidth={0.7}/>)
    elems.push(<text key={'yl'+i} x={PAD.l-5} y={y+3} textAnchor="end" fontSize={8} fill={T.inkSoft}>{fmtN(Math.round(maxS/4*i))}</text>)
    elems.push(<text key={'yr'+i} x={W-PAD.r+5} y={y+3} textAnchor="start" fontSize={8} fill={T.prior}>{fmtN(Math.round(maxB/4*i))}</text>)
  }

  months.forEach(({s, b, partial, partialDays, y, m}, i) => {
    const cx = PAD.l + i*groupW + groupW/2
    const bh = Math.max(2, (s/maxS)*plotH)
    const ry = PAD.t+plotH-bh
    elems.push(
      <rect key={'bar'+i} x={cx-barW/2} y={ry} width={barW} height={bh} rx={2}
        fill={T.leaf} opacity={partial?0.45:1}>
        <title>{y}-{String(m).padStart(2,'0')}: searches={fmtN(s)}, ops gross={b}</title>
      </rect>
    )
    if (partial && partialDays) {
      elems.push(<text key={'pd'+i} x={cx} y={ry-4} textAnchor="middle" fontSize={7} fill={T.inkSoft}>{partialDays}d</text>)
    }
  })

  // Ops line
  const pts = months.map(({b},i) => ({
    x: PAD.l+i*groupW+groupW/2,
    y: PAD.t+plotH-(b/maxB)*plotH,
    b
  }))
  const d = 'M'+pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')
  elems.push(<path key="bline" d={d} fill="none" stroke={T.prior} strokeWidth={1.8} strokeLinejoin="round"/>)
  pts.forEach((p,i) => elems.push(<circle key={'pt'+i} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r={3} fill={T.prior}><title>Ops gross: {p.b}</title></circle>))

  // X labels (every 2nd)
  months.forEach(({y, m}, i) => {
    if (i%2!==0) return
    const cx = PAD.l+i*groupW+groupW/2
    const mo = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m]
    elems.push(<text key={'xl'+i} x={cx} y={H-PAD.b+14} textAnchor="middle" fontSize={8} fill={T.inkSoft}>{mo}{m===1?` '${String(y).slice(2)}`:''}</text>)
  })

  elems.push(<text key="ylla" x={PAD.l-36} y={PAD.t+plotH/2} textAnchor="middle" fontSize={8} fill={T.leaf} transform={`rotate(-90,${PAD.l-36},${PAD.t+plotH/2})`}>Searches</text>)
  elems.push(<text key="yrra" x={W-PAD.r+42} y={PAD.t+plotH/2} textAnchor="middle" fontSize={8} fill={T.prior} transform={`rotate(90,${W-PAD.r+42},${PAD.t+plotH/2})`}>Ops gross</text>)

  return <svg width={W} height={H} style={{display:'block',fontFamily:'Inter,system-ui,sans-serif'}}>{elems}</svg>
}

// ─── Sparkline (last 15 days) ─────────────────────────────────────────────────
function Sparkline({ cd, width=260 }) {
  const W=width, H=54
  const endO = GA4_END, startO = endO-14
  const bars = []
  let maxV = 1
  for (let o=startO; o<=endO; o++) {
    const map = parseGA4Daily(cd)
    const v = map[o]?.[0] || 0
    if (v > maxV) maxV = v
    bars.push({ o, v, date: offsetToDate(o) })
  }
  const bw = Math.floor((W-8) / 15)
  return (
    <svg width={W} height={H} style={{display:'block'}}>
      {bars.map(({o, v, date}, i) => {
        const bh = Math.max(2, (v/maxV)*(H-12))
        const x = 4 + i*bw
        const isLast = i===14
        return (
          <rect key={o} x={x} y={H-bh-2} width={bw-2} height={bh} rx={1}
            fill={isLast?T.pine:T.leaf} opacity={isLast?1:0.65}>
            <title>{date}: {fmtN(v)} searches</title>
          </rect>
        )
      })}
    </svg>
  )
}

// ─── Drill-down panel ─────────────────────────────────────────────────────────
function DrillDown({ cd, onClose, onOpenRoutes, chartWidth }) {
  const roster = AP_ROSTER[cd]
  if (!roster) return null
  const { nm, cc } = roster

  // KPI: trailing 12m (2025-07-01 .. 2026-06-30)
  const t12s = dayOffset('2025-07-01'), t12e = dayOffset('2026-06-30')
  const t12ga4 = sumGA4(cd, t12s, t12e)
  const t12ops = sumOps(cd, t12s, t12e)

  // June 2026 from/to
  const jun26ym = '2606'
  const jun26P_ga4 = parseMonthlyGA4(cd,'P')[jun26ym] || [0,0,0]
  const jun26D_ga4 = parseMonthlyGA4(cd,'D')[jun26ym] || [0,0,0]
  const jun26P_ops = parseMonthlyOps(cd,'P')[jun26ym] || [0,0,0]
  const jun26D_ops = parseMonthlyOps(cd,'D')[jun26ym] || [0,0,0]

  // Q2 net bookings (2026-04-01 .. 2026-06-30)
  const q2s = dayOffset('2026-04-01'), q2e = dayOffset('2026-06-30')
  const q2ops = sumOps(cd, q2s, q2e)
  const q2Net = q2ops.b - q2ops.c

  // Q2 LY (2025-04-01 .. 2025-06-30)
  const q2lyS = dayOffset('2025-04-01'), q2lyE = dayOffset('2025-06-30')
  const q2lyOps = sumOps(cd, q2lyS, q2lyE)
  const q2lyNet = q2lyOps.b - q2lyOps.c

  // Latest week W27 2026
  const w27s = dayOffset('2026-06-29'), w27e = dayOffset('2026-07-05')
  const w27ga4 = sumGA4(cd, w27s, w27e)
  const w27ops = sumOps(cd, w27s, w27e)
  // YoY W27 (−364d)
  const w27lyS = w27s-364, w27lyE = w27e-364
  const w27lyGa4 = sumGA4(cd, w27lyS, w27lyE)
  const w27lyOps = sumOps(cd, w27lyS, w27lyE)
  const webValid = w27lyGa4.s > 0

  const hasOps = t12ops.b > 0

  // Monthly From/To split label
  const pmiFromPct = t12ga4.s > 0 ? Math.round(parseMonthlyGA4(cd,'P')[jun26ym]?.[0] || 0) : 0

  const pillStyle = { display:'inline-flex', alignItems:'center', gap:5, padding:'5px 12px', borderRadius:20,
    fontSize:11, fontWeight:600, background:T.grey, color:T.ink, marginRight:6, marginBottom:6 }
  const greenPill = { ...pillStyle, background:T.leafLight, color:T.pine, cursor:'pointer', border:`1px solid ${T.leaf}` }
  const miniCard = { background:T.card, border:`1px solid ${T.line}`, borderRadius:10, padding:'12px 16px', flex:1, minWidth:0 }

  return (
    <div style={{background:T.paper, borderRadius:14, padding:'20px 24px', border:`1.5px solid ${T.leaf}`, marginTop:16, position:'relative'}}>
      <button onClick={onClose}
        style={{position:'absolute',top:14,right:16,background:'none',border:'none',fontSize:18,cursor:'pointer',color:T.inkSoft,lineHeight:1}}>
        ×
      </button>

      {/* Header */}
      <h3 style={{fontFamily:'Georgia,serif',fontSize:18,fontWeight:700,color:T.ink,margin:'0 0 12px'}}>
        {nm} <span style={{fontSize:13,fontWeight:400,color:T.inkSoft}}>· {cc}</span>
      </h3>

      {/* Pill row 1 */}
      <div style={{display:'flex',flexWrap:'wrap',marginBottom:8}}>
        <span role="button" onClick={onOpenRoutes} style={greenPill}>
          → Open in Routes explorer
        </span>
        <span style={pillStyle}>
          Jun From (pick-up): {fmtN(jun26P_ga4[0])} srch · {fmtN(jun26P_ga4[1])} web bkg · {fmtN(jun26P_ops[0]-jun26P_ops[1])} ops net
        </span>
        <span style={pillStyle}>
          Jun To (drop-off): {fmtN(jun26D_ga4[0])} srch · {fmtN(jun26D_ga4[1])} web bkg · {fmtN(jun26D_ops[0]-jun26D_ops[1])} ops net
        </span>
      </div>

      {/* Pill row 2 */}
      <div style={{display:'flex',flexWrap:'wrap',marginBottom:16}}>
        <span style={pillStyle}>
          Q2 net bookings: {fmtN(q2Net)} {q2lyNet > 0 ? `vs ${fmtN(q2lyNet)} LY` : '(no LY ops)'}
          {q2lyNet > 0 && <span style={{marginLeft:6}}><DeltaChip cur={q2Net} prv={q2lyNet} valid={q2lyNet>0} small/></span>}
        </span>
        <span style={pillStyle}>
          Jun web: {fmtN(jun26P_ga4[0]+jun26D_ga4[0])} srch / {fmtN(jun26P_ga4[1]+jun26D_ga4[1])} bkg
        </span>
        <span style={pillStyle}>
          W27 searches: {fmtN(w27ga4.s)} | W27 ops net: {fmtN(w27ops.b-w27ops.c)}
          {webValid && w27lyGa4.s>0 && <span style={{marginLeft:6}}><DeltaChip cur={w27ga4.s} prv={w27lyGa4.s} valid small/></span>}
        </span>
      </div>

      {/* KPI mini-cards */}
      <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap'}}>
        <div style={miniCard}>
          <div style={{fontSize:9,fontWeight:700,letterSpacing:'.07em',textTransform:'uppercase',color:T.inkSoft,marginBottom:4}}>Trailing 12m searches</div>
          <div style={{fontSize:22,fontWeight:700,color:T.ink,letterSpacing:'-.5px'}}>{fmtN(t12ga4.s)}</div>
          <div style={{fontSize:10,color:T.inkSoft,marginTop:2}}>touch-deduped · From+To each count once here</div>
        </div>
        <div style={miniCard}>
          <div style={{fontSize:9,fontWeight:700,letterSpacing:'.07em',textTransform:'uppercase',color:T.inkSoft,marginBottom:4}}>Trailing 12m web</div>
          <div style={{fontSize:22,fontWeight:700,color:T.ink}}>{fmtN(t12ga4.p)} bkg</div>
          <div style={{fontSize:14,fontWeight:600,color:T.pine}}>{fmtN(t12ga4.r, {gbp:true})}</div>
        </div>
        <div style={miniCard}>
          <div style={{fontSize:9,fontWeight:700,letterSpacing:'.07em',textTransform:'uppercase',color:T.inkSoft,marginBottom:4}}>Trailing 12m ops</div>
          {hasOps ? <>
            <div style={{fontSize:22,fontWeight:700,color:T.ink}}>{fmtN(t12ops.b-t12ops.c)} net bkg</div>
            <div style={{fontSize:14,fontWeight:600,color:T.amber}}>{fmtN(t12ops.tn,{gbp:true})} net TTV</div>
          </> : <div style={{fontSize:13,color:T.inkSoft}}>no dispatch coverage</div>}
        </div>
        <div style={miniCard}>
          <div style={{fontSize:9,fontWeight:700,letterSpacing:'.07em',textTransform:'uppercase',color:T.inkSoft,marginBottom:4}}>W27 2026 snapshot</div>
          <div style={{fontSize:14,fontWeight:700,color:T.ink}}>{fmtN(w27ga4.s)} srch · {fmtN(w27ops.b-w27ops.c)} ops net</div>
          {webValid && <div style={{marginTop:4}}><DeltaChip cur={w27ga4.s} prv={w27lyGa4.s} valid small/> <span style={{fontSize:10,color:T.inkSoft}}>vs W27 2025</span></div>}
        </div>
      </div>

      {/* Charts */}
      <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
        <div style={{background:T.card,border:`1px solid ${T.line}`,borderRadius:10,padding:'14px 16px',flex:'2 1 400px',minWidth:0}}>
          <div style={{fontSize:11,fontWeight:600,color:T.inkSoft,marginBottom:8}}>
            Monthly searches (bars) vs ops gross bookings (line) · Jun 2025 – Jul 2026
            <span style={{marginLeft:8,fontSize:10,color:T.inkSoft,fontWeight:400}}>hatched = partial month</span>
          </div>
          <MonthlyDrillChart cd={cd} width={Math.max(320, (chartWidth||700)*0.6)}/>
        </div>
        <div style={{background:T.card,border:`1px solid ${T.line}`,borderRadius:10,padding:'14px 16px',flex:'1 1 200px',minWidth:0}}>
          <div style={{fontSize:11,fontWeight:600,color:T.inkSoft,marginBottom:8}}>Last 15 days searches (darkest = latest)</div>
          <Sparkline cd={cd} width={Math.max(180, (chartWidth||700)*0.3-40)}/>
          <div style={{fontSize:10,color:T.inkSoft,marginTop:6}}>
            W26: {fmtN(sumGA4(cd,dayOffset('2026-06-22'),dayOffset('2026-06-28')).s)} · W27: {fmtN(w27ga4.s)} · W28 (partial): {fmtN(sumGA4(cd,w27e+1,GA4_END).s)}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Routes explorer ──────────────────────────────────────────────────────────
function RoutesExplorer({ initialAp }) {
  const roster = AP_ROSTER
  // Build picker: sorted by trailing-12m searches
  const t12s = dayOffset('2025-07-01'), t12e = dayOffset('2026-06-30')
  const pickerOptions = useMemo(() => {
    return Object.keys(roster).map(cd => ({
      cd, nm: roster[cd].nm, s: sumGA4(cd, t12s, t12e).s
    })).sort((a,b)=>b.s-a.s)
  }, [])

  const [selectedAp, setSelectedAp] = useState(initialAp || 'PMI')
  const [sortCol, setSortCol] = useState({ col:'s', asc:false })

  const apRoster = roster[selectedAp]
  const t12sum = useMemo(() => sumGA4(selectedAp, t12s, t12e), [selectedAp])
  const t12opsSum = useMemo(() => sumOps(selectedAp, t12s, t12e), [selectedAp])
  const outbound = useMemo(() => parseRoutes(selectedAp,'O'), [selectedAp])
  const inbound  = useMemo(() => parseRoutes(selectedAp,'I'), [selectedAp])

  function sortRoutes(rows, {col, asc}) {
    return [...rows].sort((a,b) => {
      const va = a[col]||0, vb = b[col]||0
      return asc ? va-vb : vb-va
    })
  }

  const sortedOut = useMemo(() => sortRoutes(outbound, sortCol), [outbound, sortCol])
  const sortedIn  = useMemo(() => sortRoutes(inbound, sortCol), [inbound, sortCol])

  function Th({col, children}) {
    const active = sortCol.col===col
    return (
      <th onClick={()=>setSortCol(s=>({col, asc:s.col===col?!s.asc:false}))}
        style={{padding:'8px 10px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',
          color:active?T.leaf:T.inkSoft,cursor:'pointer',userSelect:'none',whiteSpace:'nowrap',textAlign:'right',
          borderBottom:`2px solid ${T.line}`}}>
        {children}{active?(sortCol.asc?' ▲':' ▼'):''}
      </th>
    )
  }

  function CovChip({cov}) {
    const map = { both:{bg:T.leafLight,color:T.pine,text:'web+ops'}, web:{bg:T.amberLight,color:T.amber,text:'web'}, ops:{bg:T.grey,color:T.inkSoft,text:'ops'} }
    const s = map[cov] || map.web
    return <span style={{padding:'2px 7px',borderRadius:12,fontSize:9,fontWeight:700,background:s.bg,color:s.color}}>{s.text}</span>
  }

  function MomCell({q2,q1}) {
    const m = momChip(q2,q1)
    return <span style={{fontSize:10,fontWeight:700,color:m.color,padding:'2px 6px',borderRadius:10,background:m.bg}}>{m.text}</span>
  }

  function RouteTable({rows, title, icon}) {
    return (
      <div style={{background:T.card,border:`1px solid ${T.line}`,borderRadius:12,overflow:'hidden',marginBottom:16}}>
        <div style={{padding:'12px 16px',borderBottom:`1px solid ${T.line}`,fontSize:13,fontWeight:700,color:T.ink}}>
          {icon} {title}
          <span style={{fontSize:10,fontWeight:400,color:T.inkSoft,marginLeft:10}}>
            {rows.length} destinations · trailing 12m · mom. = Q2 vs Q1 (seasonal ramp)
          </span>
        </div>
        <div style={{overflowX:'auto',maxHeight:480}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
            <thead>
              <tr style={{background:T.paper,position:'sticky',top:0}}>
                <th style={{padding:'8px 10px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:T.inkSoft,textAlign:'left',borderBottom:`2px solid ${T.line}`}}>Destination/Origin</th>
                <th style={{padding:'8px 6px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:T.inkSoft,borderBottom:`2px solid ${T.line}`}}>Cov.</th>
                <Th col="s">Searches</Th>
                <Th col="p">Web bkgs</Th>
                <Th col="r">Web rev</Th>
                <th style={{padding:'8px 10px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:T.inkSoft,borderBottom:`2px solid ${T.line}`,textAlign:'right'}}>S→B</th>
                <th style={{padding:'8px 10px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:T.inkSoft,borderBottom:`2px solid ${T.line}`,textAlign:'right'}}>Web mom.</th>
                <Th col="b">Ops net</Th>
                <Th col="tn">Net TTV</Th>
                <th style={{padding:'8px 10px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:T.inkSoft,borderBottom:`2px solid ${T.line}`,textAlign:'right'}}>Canc%</th>
                <th style={{padding:'8px 10px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:T.inkSoft,borderBottom:`2px solid ${T.line}`,textAlign:'right'}}>Ops mom.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r,i) => (
                <tr key={i} style={{background:i%2===0?T.card:T.paper, borderBottom:`1px solid ${T.line}`}}>
                  <td style={{padding:'8px 10px'}}>
                    <div style={{fontWeight:600,color:T.ink,fontSize:12}}>{r.name}</div>
                    {r.code && <div style={{fontSize:9,color:T.inkSoft,marginTop:1}}>{r.code}</div>}
                  </td>
                  <td style={{padding:'6px',textAlign:'center'}}><CovChip cov={r.cov}/></td>
                  <td style={{padding:'6px 10px',textAlign:'right',fontWeight:600,color:T.ink}}>{r.s>0?fmtN(r.s):'–'}</td>
                  <td style={{padding:'6px 10px',textAlign:'right'}}>{r.p>0?fmtN(r.p):'–'}</td>
                  <td style={{padding:'6px 10px',textAlign:'right'}}>{r.r>0?fmtN(r.r,{gbp:true}):'–'}</td>
                  <td style={{padding:'6px 10px',textAlign:'right',color:T.inkSoft}}>{r.s>0&&r.p>0?fmtPP(r.p,r.s):'–'}</td>
                  <td style={{padding:'6px',textAlign:'center'}}>{r.s>0&&(r.q2s+r.q1s)>0?<MomCell q2={r.q2s} q1={r.q1s}/>:'–'}</td>
                  <td style={{padding:'6px 10px',textAlign:'right',fontWeight:600}}>{r.b>0?fmtN(r.b-r.c):'–'}</td>
                  <td style={{padding:'6px 10px',textAlign:'right'}}>{r.tn>0?fmtN(r.tn,{gbp:true}):'–'}</td>
                  <td style={{padding:'6px 10px',textAlign:'right',color:r.b>0&&r.c/r.b>0.15?T.coral:T.inkSoft}}>{r.b>0?fmtPct(r.c/r.b*100):'–'}</td>
                  <td style={{padding:'6px',textAlign:'center'}}>{r.b>0&&(r.q2b+r.q1b)>0?<MomCell q2={r.q2b} q1={r.q1b}/>:'–'}</td>
                </tr>
              ))}
              {rows.length===0 && <tr><td colSpan={11} style={{padding:20,textAlign:'center',color:T.inkSoft,fontSize:12}}>No route data</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{padding:'8px 14px',fontSize:10,color:T.inkSoft,borderTop:`1px solid ${T.line}`}}>
          One row per destination · trailing 12m · mom. = Q2 vs Q1 (includes seasonal ramp) ·{' '}
          <details style={{display:'inline'}}><summary style={{display:'inline',cursor:'pointer',color:T.leaf}}>how rows merge ▾</summary>
            <span style={{display:'block',marginTop:4,fontSize:10,lineHeight:1.5,color:T.inkSoft}}>
              GA4 names destinations by location code; dispatch uses free-text zone names (including Chinese for many zones).
              Zones are matched by name similarity (score 3=exact, 2=high-similarity, 1=containment).
              Score-1 matches with multiple candidates are deliberately skipped — a missed merge shows as two honest rows;
              a false merge would fabricate data. Jumeirah and Palm Jumeirah are separate rows by design.
            </span>
          </details>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Airport picker */}
      <div style={{background:T.card,border:`1px solid ${T.line}`,borderRadius:12,padding:'14px 18px',marginBottom:16}}>
        <div style={{display:'flex',alignItems:'center',gap:16,flexWrap:'wrap'}}>
          <div>
            <div style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'.07em',color:T.inkSoft,marginBottom:4}}>Airport</div>
            <select value={selectedAp} onChange={e=>setSelectedAp(e.target.value)}
              style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${T.line}`,fontSize:13,color:T.ink,background:T.card,fontFamily:'inherit',cursor:'pointer',outline:'none'}}>
              {pickerOptions.map(({cd,nm,s}) =>
                <option key={cd} value={cd}>{nm} — {fmtN(s)} srch</option>
              )}
            </select>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:700,color:T.ink}}>{apRoster?.nm} <span style={{color:T.inkSoft,fontWeight:400,fontSize:12}}>({selectedAp})</span></div>
            <div style={{fontSize:11,color:T.inkSoft,marginTop:2}}>
              Trailing 12m: {fmtN(t12sum.s)} searches · {fmtN(t12sum.p)} web bkgs · {hasOps?`${fmtN(t12opsSum.b-t12opsSum.c)} ops net`:'no ops data'}
            </div>
          </div>
        </div>
      </div>

      <RouteTable rows={sortedOut} title={`Departing ${selectedAp} →`} icon="✈️"/>
      <RouteTable rows={sortedIn}  title={`Arriving into ${selectedAp} ←`} icon="🛬"/>
    </div>
  )

  // helper
  function hasOps() { return t12opsSum.b > 0 }
}

// ─── Main league table ────────────────────────────────────────────────────────
function LeagueTable({ view, timeRange, cmpRange, fullMonths, onRowClick, selectedCd }) {
  const [sortCol, setSortCol] = useState({col:'s',asc:false})
  const [search, setSearch] = useState('')

  const { s: startStr, e: endStr } = timeRange || {}
  const lo = startStr ? dayOffset(startStr) : GA4_START
  const hi = endStr ? dayOffset(endStr) : GA4_END

  // Build table data
  const rows = useMemo(() => {
    return Object.keys(AP_ROSTER).map(cd => {
      const { nm, cc } = AP_ROSTER[cd]
      const flag = CC_FLAG(cc)

      if (view === 'both') {
        const ga4 = sumGA4(cd, lo, hi)
        const ops = sumOps(cd, lo, hi)
        // From/To from full-window monthly (as split annotation)
        const pmiPa = parseMonthlyGA4(cd,'P')
        const pmiDa = parseMonthlyGA4(cd,'D')
        let fromS=0, toS=0
        Object.values(pmiPa).forEach(v=>fromS+=v[0])
        Object.values(pmiDa).forEach(v=>toS+=v[0])
        return { cd, nm, cc, flag, s:ga4.s, p:ga4.p, r:ga4.r, b:ops.b, c:ops.c, tn:ops.tn, fromS, toS, net:ops.b-ops.c }
      } else {
        // From or To view — monthly grain
        const role = view==='from' ? 'P' : 'D'
        const ga4sum = sumMonthlyGA4(cd, role, fullMonths)
        const opssum = sumMonthlyOps(cd, role, fullMonths)
        return { cd, nm, cc, flag, s:ga4sum.s, p:ga4sum.p, r:ga4sum.r, b:opssum.b, c:opssum.c, tn:opssum.tn, net:opssum.b-opssum.c }
      }
    })
  }, [view, lo, hi, fullMonths])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return rows
    return rows.filter(r => r.nm.toLowerCase().includes(q) || r.cd.toLowerCase().includes(q) || r.cc.toLowerCase().includes(q))
  }, [rows, search])

  const sorted = useMemo(() => {
    return [...filtered].sort((a,b) => {
      const va=a[sortCol.col]??0, vb=b[sortCol.col]??0
      return sortCol.asc ? va-vb : vb-va
    })
  }, [filtered, sortCol])

  function Th({col, children, left=false}) {
    const active=sortCol.col===col
    return <th onClick={()=>setSortCol(s=>({col,asc:s.col===col?!s.asc:false}))}
      style={{padding:'9px 10px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',
        color:active?T.leaf:T.inkSoft,cursor:'pointer',userSelect:'none',whiteSpace:'nowrap',
        textAlign:left?'left':'right',borderBottom:`2px solid ${T.line}`,position:'sticky',top:0,background:T.paper}}>
      {children}{active?(sortCol.asc?' ▲':' ▼'):''}
    </th>
  }

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filter by name, code, or country…"
          style={{padding:'7px 12px',borderRadius:8,border:`1px solid ${T.line}`,fontSize:12,color:T.ink,width:260,fontFamily:'inherit',outline:'none'}}/>
        <span style={{fontSize:11,color:T.inkSoft}}>{filtered.length} of {rows.length} airports</span>
      </div>

      <div style={{background:T.card,border:`1px solid ${T.line}`,borderRadius:12,overflow:'hidden'}}>
        <div style={{overflowX:'auto',maxHeight:620}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
            <thead>
              <tr style={{background:T.paper}}>
                <Th col="nm" left>Airport</Th>
                <Th col="cc">Cc</Th>
                {view==='both' && <Th col="fromS">From srch</Th>}
                <Th col="s">{view==='both'?'Total srch':'Searches'}</Th>
                {view==='both' && <Th col="toS">To srch</Th>}
                <Th col="p">Web bkgs</Th>
                <Th col="r">Web rev</Th>
                <th style={{padding:'9px 10px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:T.inkSoft,borderBottom:`2px solid ${T.line}`,textAlign:'right',position:'sticky',top:0,background:T.paper}}>S→B</th>
                <Th col="net">Ops net</Th>
                <Th col="tn">Ops TTV</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r,i) => {
                const sel = r.cd===selectedCd
                return (
                  <tr key={r.cd} onClick={()=>onRowClick(r.cd)}
                    style={{background:sel?T.leafLight:i%2===0?T.card:T.paper,
                      borderBottom:`1px solid ${T.line}`,cursor:'pointer',
                      outline:sel?`2px solid ${T.leaf}`:'none'}}>
                    <td style={{padding:'8px 10px'}}>
                      <span style={{fontWeight:600,color:T.ink}}>{r.nm}</span>
                      <span style={{fontSize:9,color:T.inkSoft,marginLeft:5}}>{r.cd}</span>
                    </td>
                    <td style={{padding:'6px 10px',textAlign:'center',fontSize:13}}>{r.flag} <span style={{fontSize:9,color:T.inkSoft}}>{r.cc}</span></td>
                    {view==='both' && <td style={{padding:'6px 10px',textAlign:'right',color:T.inkSoft}}>{r.fromS>0?fmtN(r.fromS):'–'}</td>}
                    <td style={{padding:'6px 10px',textAlign:'right',fontWeight:700,color:T.ink}}>{r.s>0?fmtN(r.s):'–'}</td>
                    {view==='both' && <td style={{padding:'6px 10px',textAlign:'right',color:T.inkSoft}}>{r.toS>0?fmtN(r.toS):'–'}</td>}
                    <td style={{padding:'6px 10px',textAlign:'right'}}>{r.p>0?fmtN(r.p):'–'}</td>
                    <td style={{padding:'6px 10px',textAlign:'right'}}>{r.r>0?fmtN(r.r,{gbp:true}):'–'}</td>
                    <td style={{padding:'6px 10px',textAlign:'right',color:T.inkSoft}}>{r.s>0&&r.p>0?fmtPP(r.p,r.s):'–'}</td>
                    <td style={{padding:'6px 10px',textAlign:'right',color:r.net<0?T.coral:T.ink}}>{r.b>0?fmtN(r.net):'–'}</td>
                    <td style={{padding:'6px 10px',textAlign:'right'}}>{r.tn>0?fmtN(r.tn,{gbp:true}):'–'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Main exported component ──────────────────────────────────────────────────
export default function AllAirportsTab({ timeRange, cmpRange, webValid, opsValid, tfLabel, cmpLabel, chartWidth }) {
  const [view, setView] = useState('both') // 'both' | 'from' | 'to' | 'routes'
  const [selectedCd, setSelectedCd] = useState(null)
  const drillRef = useRef(null)
  const [routeInitAp, setRouteInitAp] = useState('PMI')

  const { s: startStr, e: endStr } = timeRange || {}

  // Full months within the time range (for From/To views)
  const fullMonths = useMemo(() => {
    if (!startStr || !endStr) return []
    const months = fullMonthsIn(startStr, endStr)
    return months.length > 0 ? months : fullMonthsIn('2025-07-01','2026-06-30') // trailing 12m fallback
  }, [startStr, endStr])

  const isFallback = useMemo(() => {
    if (!startStr || !endStr) return false
    return fullMonthsIn(startStr, endStr).length === 0
  }, [startStr, endStr])

  function handleRowClick(cd) {
    setSelectedCd(prev => prev===cd ? null : cd)
    if (cd) setTimeout(() => drillRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'}), 50)
  }

  function handleOpenRoutes(cd) {
    setRouteInitAp(cd)
    setView('routes')
  }

  const VIEWS = [
    { key:'both', label:'Both directions' },
    { key:'from', label:'From airport (pick-up)' },
    { key:'to',   label:'To airport (drop-off)' },
    { key:'routes', label:'Routes explorer' },
  ]

  const viewNote = {
    both: 'Each airport counts once per search or ride touching it in either role. Round trips appear in both From and To but once here — directional views sum to more than this one, by design.',
    from: `From (pick-up) view — monthly grain. Full calendar months within the selected period${isFallback?' (no full months in range — showing trailing 12m)':''}.`,
    to:   `To (drop-off) view — monthly grain. Full calendar months within the selected period${isFallback?' (no full months in range — showing trailing 12m)':''}.`,
    routes: 'Routes explorer — trailing 12m, one row per destination, merged web+ops.',
  }

  return (
    <div style={{padding:'0 0 32px'}}>
      {/* Header */}
      <div style={{marginBottom:14}}>
        <div style={{fontSize:11,color:T.inkSoft,marginBottom:6}}>{tfLabel}</div>

        {/* Segmented control */}
        <div style={{display:'flex',gap:0,background:T.grey,borderRadius:10,padding:3,width:'fit-content',marginBottom:10}}>
          {VIEWS.map(v => (
            <button key={v.key} onClick={()=>{ setView(v.key); setSelectedCd(null) }}
              style={{padding:'7px 16px',borderRadius:8,border:'none',fontSize:12,fontWeight:view===v.key?700:500,
                cursor:'pointer',transition:'all .15s',
                background:view===v.key?T.card:'transparent',
                color:view===v.key?T.pine:T.inkSoft,
                boxShadow:view===v.key?'0 1px 4px rgba(0,0,0,.12)':'none'}}>
              {v.label}
            </button>
          ))}
        </div>

        {/* View note */}
        <div style={{fontSize:11,color:T.inkSoft,maxWidth:720,lineHeight:1.5}}>
          {viewNote[view]}
          {view==='both' && (
            <details style={{display:'inline',marginLeft:6}}>
              <summary style={{display:'inline',cursor:'pointer',color:T.leaf,fontSize:11}}>How From/To work ▾</summary>
              <div style={{display:'block',marginTop:4,fontSize:10,color:T.inkSoft,lineHeight:1.5,maxWidth:600}}>
                Both view follows the time bar day-exactly. From/To views aggregate the full calendar months inside the
                selected timeframe, falling back to trailing 12 months if no full month exists in the range.
                This is because directional role data only exists at monthly grain (daily directional would double file size for marginal value).
                Consequence: From+To will always sum to more than Both — this is correct, not a bug.
              </div>
            </details>
          )}
        </div>
      </div>

      {/* Fallback chip */}
      {isFallback && view !== 'both' && view !== 'routes' && (
        <div style={{display:'inline-flex',alignItems:'center',gap:6,padding:'4px 12px',borderRadius:20,background:T.amberLight,color:T.amber,fontSize:10,fontWeight:700,marginBottom:10}}>
          ⚠ fallback: no full month in range — showing trailing 12m (Jul 2025 – Jun 2026)
        </div>
      )}

      {/* League table (Both/From/To) */}
      {view !== 'routes' && (
        <>
          <LeagueTable
            view={view}
            timeRange={timeRange}
            cmpRange={cmpRange}
            fullMonths={fullMonths}
            onRowClick={handleRowClick}
            selectedCd={selectedCd}
          />

          {/* Drill-down */}
          {selectedCd && (
            <div ref={drillRef}>
              <DrillDown
                cd={selectedCd}
                onClose={()=>setSelectedCd(null)}
                onOpenRoutes={()=>handleOpenRoutes(selectedCd)}
                chartWidth={chartWidth}
              />
            </div>
          )}
        </>
      )}

      {/* Routes explorer */}
      {view === 'routes' && (
        <RoutesExplorer initialAp={routeInitAp}/>
      )}
    </div>
  )
}
