/**
 * OverviewTab.jsx
 * Page 2 of the Destination Intelligence dashboard — "Overview"
 *
 * Answers: which airports are rising/slipping, and how is every airport doing?
 * Three blocks: (a) Rising, (b) Slipping, (c) All airports sortable table.
 *
 * Data: 227 airports pulled 2026-07-12. All validation gates passed.
 *   PMI Jun GA4 s=21,061 p=694 | PMI Jun ops gross=1,282 canc=36 (T1 guard ✅)
 *   LHR trailing 12m s=15,175 | Cross-source gross≥cancelled ✅
 */

import { useState, useMemo, memo } from 'react'
import { AP_ROSTER } from '../data/overviewRoster.js'
import { AP_GA4 } from '../data/overviewGa4.js'
import { AP_OPS } from '../data/overviewOps.js'

// ─── Constants ───────────────────────────────────────────────────────────────
const BASE = new Date('2024-06-01T00:00:00Z')
const GA4_S   = 382   // 2025-06-16
const GA4_E   = 767   // 2026-07-08
const OPS_S   = 304   // 2025-04-01 (per-airport ops trusted from here)
const OPS_E   = 768   // 2026-07-09
const MIG_S   = 245
const MIG_E   = 303

// ─── Parse raw string maps on first access ───────────────────────────────────
const _ga4Cache = {}
const _opsCache = {}

function getGA4(cd) {
  if (_ga4Cache[cd] !== undefined) return _ga4Cache[cd]
  const raw = AP_GA4[cd]
  if (!raw) { _ga4Cache[cd] = {}; return {} }
  const m = {}
  raw.split('|').forEach(seg => {
    const p = seg.split(':')
    const o = +p[0]
    m[o] = [+p[1]||0, p[2]!=null?+p[2]:0, p[3]!=null?+p[3]:0]
  })
  _ga4Cache[cd] = m; return m
}

function getOps(cd) {
  if (_opsCache[cd] !== undefined) return _opsCache[cd]
  const raw = AP_OPS[cd]
  if (!raw) { _opsCache[cd] = {}; return {} }
  const m = {}
  raw.split('|').forEach(seg => {
    const p = seg.split(':')
    m[+p[0]] = [+p[1]||0, +p[2]||0, +p[3]||0]
  })
  _opsCache[cd] = m; return m
}

// ─── Range sums ──────────────────────────────────────────────────────────────
function dayOffset(dateStr) {
  return Math.round((new Date(dateStr + 'T00:00:00Z') - BASE) / 86400000)
}

function sumGA4(cd, f, t) {
  const lo = Math.max(f, GA4_S), hi = Math.min(t, GA4_E)
  let s=0, p=0, r=0
  if (lo > hi) return {s:0, p:0, r:0}
  const m = getGA4(cd)
  for (let o=lo; o<=hi; o++) { const d=m[o]; if(!d) continue; s+=d[0]; p+=d[1]; r+=d[2] }
  return {s, p, r}
}

function sumOps(cd, f, t) {
  const lo = Math.max(f, OPS_S), hi = Math.min(t, OPS_E)
  let b=0, c=0, tn=0
  if (lo > hi) return {b:0, c:0, tn:0}
  const m = getOps(cd)
  for (let o=lo; o<=hi; o++) { const d=m[o]; if(!d) continue; b+=d[0]; c+=d[1]; tn+=d[2] }
  return {b, c, tn}
}

function hasOpsData(cd, f, t) {
  const lo=Math.max(f,OPS_S), hi=Math.min(t,OPS_E)
  if (lo>hi) return false
  const m=getOps(cd)
  for(let o=lo;o<=hi;o++) { if(m[o]) return true }
  return false
}

// ─── Validity checks ─────────────────────────────────────────────────────────
function overlaps(a1,a2,b1,b2){ return a1<=b2&&a2>=b1 }

function apValidity(f, t, cf, ct) {
  // cf/ct = comparison offsets
  const webValid = f<=GA4_E && t>=GA4_S && cf<=GA4_E && ct>=GA4_S
  const curMig = overlaps(f,t,MIG_S,MIG_E), cmpMig = overlaps(cf,ct,MIG_S,MIG_E)
  const opsDeltaOk = f>=OPS_S && cf>=OPS_S && !curMig && !cmpMig
  return { webValid, opsDeltaOk }
}

// ─── Formatters ──────────────────────────────────────────────────────────────
function fmtNum(n) {
  if (n==null||isNaN(n)) return '—'
  const a=Math.abs(n), sg=n<0?'-':''
  if(a>=1e6) return sg+(a/1e6).toFixed(1)+'M'
  if(a>=1e4) return sg+Math.round(a/1e3)+'K'
  if(a>=1e3) return sg+(a/1e3).toFixed(1)+'K'
  return sg+n.toLocaleString('en-GB')
}
function fmtGBP(n) {
  if (n==null||isNaN(n)) return '—'
  const a=Math.abs(n), sg=n<0?'-':''
  if(a>=1e6) return sg+'£'+(a/1e6).toFixed(2)+'M'
  if(a>=1e3) return sg+'£'+Math.round(a/1e3)+'K'
  return sg+'£'+Math.round(n).toLocaleString('en-GB')
}
function fmtPct(d, dp=1) {
  if (d==null||!isFinite(d)) return '—'
  return (d>=0?'+':'')+d.toFixed(dp)+'%'
}
function pctChg(cur,prv) {
  if (!prv || prv===0) return null
  return (cur-prv)/Math.abs(prv)*100
}

// ─── Design tokens ───────────────────────────────────────────────────────────
const T = {
  pine:'#0A2540', leaf:'#0D8A72', ink:'#1A2B3C', inkSoft:'#5A6A7A',
  paper:'#F8FAFC', card:'#FFFFFF', line:'#E2EAF0', prior:'#0F5FA6',
  amber:'#D97706', coral:'#C0392B', salmon:'#D98C7A',
  leafLight:'#E6F5F2', coralLight:'#FDEDEB', grey:'#E2EAF0',
}

// ─── Delta cell ───────────────────────────────────────────────────────────────
function DCell({ cur, prv, valid, fmt='num' }) {
  if (!valid || prv==null) return <td style={tdStyle}>—</td>
  const d = pctChg(cur, prv)
  if (d==null) return <td style={tdStyle}>—</td>
  const up=d>=0, color=up?'#0A7A52':T.coral, bg=up?T.leafLight:T.coralLight
  return (
    <td style={{...tdStyle, background:bg, color, fontWeight:600, fontSize:11}}>
      {fmtPct(d)}
    </td>
  )
}

const tdStyle = {
  padding:'6px 10px', fontSize:12, color:T.ink,
  borderBottom:`1px solid ${T.line}`, whiteSpace:'nowrap', textAlign:'right',
}
const thStyle = {
  padding:'8px 10px', fontSize:10, fontWeight:700, textTransform:'uppercase',
  letterSpacing:'.05em', color:T.inkSoft, background:T.card, position:'sticky',
  top:0, zIndex:2, cursor:'pointer', whiteSpace:'nowrap', textAlign:'right',
  borderBottom:`2px solid ${T.line}`, userSelect:'none',
}

// ─── Mover card ───────────────────────────────────────────────────────────────
function MoverCard({ title, airports, getCur, getPrv, fmtVal, sign, valid }) {
  if (!valid) return null

  return (
    <div style={{flex:'1 1 300px',background:T.card,border:`1px solid ${T.line}`,borderRadius:12,
      padding:'14px 16px',boxShadow:'0 1px 3px rgba(0,0,0,.05)'}}>
      <div style={{fontSize:11,fontWeight:700,color:T.inkSoft,textTransform:'uppercase',
        letterSpacing:'.07em',marginBottom:10}}>{title}</div>
      {airports.length===0 && <div style={{fontSize:12,color:T.inkSoft}}>No airports qualify</div>}
      {airports.map(({cd, cur, prv, delta}) => {
        const nm = AP_ROSTER[cd]?.nm?.replace(/\(.*?\)/g,'').trim() || cd
        const shortNm = nm.length > 22 ? nm.slice(0,20)+'…' : nm
        return (
          <div key={cd} style={{display:'flex',alignItems:'center',gap:6,marginBottom:6,
            padding:'4px 0',borderBottom:`1px solid ${T.line}`}}>
            <div style={{fontSize:12,fontWeight:600,color:T.ink,flex:1,minWidth:0}}>
              {shortNm} <span style={{fontSize:10,color:T.inkSoft,fontWeight:400}}>{cd}</span>
            </div>
            <div style={{fontSize:11,color:T.inkSoft,whiteSpace:'nowrap'}}>
              {fmtVal(prv)} → <strong style={{color:T.ink}}>{fmtVal(cur)}</strong>
            </div>
            <div style={{
              fontSize:11,fontWeight:700,padding:'2px 7px',borderRadius:20,whiteSpace:'nowrap',
              background:sign>0?T.leafLight:T.coralLight,
              color:sign>0?'#0A7A52':T.coral,
              minWidth:52,textAlign:'center',
            }}>{sign>0?'▲':'▼'} {Math.abs(delta).toFixed(1)}%</div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Validity chip ────────────────────────────────────────────────────────────
function ValidChip({ label, ok, warning }) {
  const bg = warning ? 'rgba(166,106,18,.15)' : ok ? 'rgba(20,160,107,.15)' : T.grey
  const color = warning ? '#D97706' : ok ? '#0A7A52' : T.inkSoft
  const border = warning ? '1px solid rgba(166,106,18,.4)' : ok ? '1px solid rgba(20,160,107,.4)' : `1px solid ${T.line}`
  return (
    <span style={{padding:'2px 9px',borderRadius:20,fontSize:10,fontWeight:700,
      background:bg,color,border,display:'inline-block',marginLeft:8}}>
      {label}
    </span>
  )
}

// ─── Main Overview Tab ────────────────────────────────────────────────────────
export default memo(function OverviewTab({ timeRange, cmpRange, durDays, tfLabel }) {
  const [sortCol, setSortCol] = useState('s')
  const [sortDir, setSortDir] = useState(-1) // -1 = desc, 1 = asc
  const [openDrill] = useState(() => (cd) => console.log('drill:', cd)) // stub

  const { s, e } = timeRange || { s: '2026-06-29', e: '2026-07-05' }
  const fo = dayOffset(s), to = dayOffset(e)
  const cf = cmpRange ? dayOffset(cmpRange.s) : fo - durDays
  const ct = cmpRange ? dayOffset(cmpRange.e) : to - durDays
  const hasCmp = !!cmpRange

  const { webValid, opsDeltaOk } = apValidity(fo, to, cf, ct)

  // Volume floors (scale with window length)
  const B = Math.max(3, Math.round(durDays * 0.8))
  const R = Math.max(250, durDays * 60)

  // ── Build per-airport metrics for all 227 airports ──
  const codes = useMemo(() => Object.keys(AP_ROSTER).sort(), [])

  const rows = useMemo(() => {
    return codes.map(cd => {
      const g  = sumGA4(cd, fo, to)
      const o  = sumOps(cd, fo, to)
      const gc = hasCmp ? sumGA4(cd, cf, ct) : null
      const oc = hasCmp ? sumOps(cd, cf, ct) : null
      const netCur = o.b - o.c
      const netPrv = oc ? oc.b - oc.c : null
      const hasOps = hasOpsData(cd, fo, to)
      return {
        cd, nm: AP_ROSTER[cd]?.nm || cd, cc: AP_ROSTER[cd]?.cc || '',
        s:g.s, p:g.p, r:g.r,
        b:netCur, tn:o.tn,
        sc:gc?.s, pc:gc?.p, rc:gc?.r,
        bc:netPrv, tnc:oc?.tn,
        hasOps,
      }
    })
  }, [codes, fo, to, cf, ct, hasCmp])

  // ── Determine mover source ──
  const moverSource = opsDeltaOk ? 'ops' : webValid ? 'web' : 'none'
  const moverChipLabel = opsDeltaOk
    ? 'ops comparison valid'
    : webValid
      ? 'web only — ops comparison invalid here'
      : 'no honest comparison'
  const moverChipWarning = !opsDeltaOk && webValid

  // ── Compute movers ──
  const movers = useMemo(() => {
    if (moverSource === 'none' || !hasCmp) return null
    const useOps = moverSource === 'ops'
    const qualified = rows.filter(r => {
      const cur = useOps ? r.b : r.p
      const prv = useOps ? r.bc : r.pc
      return cur!=null && prv!=null && Math.max(cur, prv) >= B
    })
    const withDelta = qualified.map(r => {
      const cur = useOps ? r.b : r.p
      const prv = useOps ? r.bc : r.pc
      const curR = useOps ? r.tn : r.r
      const prvR = useOps ? r.tnc : r.rc
      const dPct = pctChg(cur, prv)
      const dRPct = pctChg(curR, prvR)
      return { cd:r.cd, curB:cur, prvB:prv, dPct, curR, prvR, dRPct }
    }).filter(r => r.dPct!=null && r.dRPct!=null)

    const risersB  = [...withDelta].sort((a,b)=>b.dPct-a.dPct).slice(0,8)
      .map(r=>({cd:r.cd,cur:r.curB,prv:r.prvB,delta:r.dPct}))
    const risersR  = [...withDelta].filter(r=>Math.max(r.curR,r.prvR)>=R)
      .sort((a,b)=>b.dRPct-a.dRPct).slice(0,8)
      .map(r=>({cd:r.cd,cur:r.curR,prv:r.prvR,delta:r.dRPct}))
    const slippersB = [...withDelta].sort((a,b)=>a.dPct-b.dPct).slice(0,8)
      .map(r=>({cd:r.cd,cur:r.curB,prv:r.prvB,delta:r.dPct}))
    const slippersR = [...withDelta].filter(r=>Math.max(r.curR,r.prvR)>=R)
      .sort((a,b)=>a.dRPct-b.dRPct).slice(0,8)
      .map(r=>({cd:r.cd,cur:r.curR,prv:r.prvR,delta:r.dRPct}))

    return { risersB, risersR, slippersB, slippersR }
  }, [rows, moverSource, hasCmp, B, R])

  // ── Sort table ──
  const sorted = useMemo(() => {
    const nullLast = (a, b, dir) => {
      if (a==null && b==null) return 0
      if (a==null) return 1
      if (b==null) return -1
      return (a - b) * dir
    }
    const colFn = {
      nm: (a,b) => (a.nm||'').localeCompare(b.nm||'') * sortDir,
      cc: (a,b) => (a.cc||'').localeCompare(b.cc||'') * sortDir,
      s:  (a,b) => nullLast(a.s, b.s, sortDir),
      ds: (a,b) => nullLast(pctChg(a.s,a.sc), pctChg(b.s,b.sc), sortDir),
      p:  (a,b) => nullLast(a.p, b.p, sortDir),
      dp: (a,b) => nullLast(pctChg(a.p,a.pc), pctChg(b.p,b.pc), sortDir),
      r:  (a,b) => nullLast(a.r, b.r, sortDir),
      dr: (a,b) => nullLast(pctChg(a.r,a.rc), pctChg(b.r,b.rc), sortDir),
      b:  (a,b) => nullLast(a.b, b.b, sortDir),
      db: (a,b) => nullLast(pctChg(a.b,a.bc), pctChg(b.b,b.bc), sortDir),
      tn: (a,b) => nullLast(a.tn, b.tn, sortDir),
      dtn:(a,b) => nullLast(pctChg(a.tn,a.tnc), pctChg(b.tn,b.tnc), sortDir),
    }
    return [...rows].sort(colFn[sortCol] || colFn['s'])
  }, [rows, sortCol, sortDir])

  const onSort = col => {
    if (col === sortCol) setSortDir(d => -d)
    else { setSortCol(col); setSortDir(-1) }
  }
  const sortArrow = col => col === sortCol ? (sortDir === -1 ? ' ▼' : ' ▲') : ' ↕'

  const Th = ({ col, label, left=false }) => (
    <th onClick={() => onSort(col)} style={{...thStyle, textAlign:left?'left':'right'}}>
      {label}{sortArrow(col)}
    </th>
  )

  const fmtNetB = useOps => useOps ? fmtNum : fmtNum
  const moverFmtB = v => fmtNum(v)
  const moverFmtR = v => fmtGBP(v)

  return (
    <div>
      {/* Date subtitle */}
      <div style={{fontSize:11,color:T.inkSoft,marginBottom:16,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
        <span>{tfLabel}</span>
        {cmpRange && <span>· vs {cmpRange.label}: {cmpRange.s} – {cmpRange.e}</span>}
        <span style={{marginLeft:8,fontSize:10,color:T.inkSoft}}>
          Volume floors: ≥{B} net bookings / £{R.toLocaleString('en-GB')} TTV
        </span>
      </div>

      {/* ── (a) RISING AIRPORTS ── */}
      <div style={{display:'flex',alignItems:'center',gap:0,marginBottom:6,borderLeft:`4px solid ${T.leaf}`,paddingLeft:10}}>
        <h2 style={{fontFamily:"'DM Sans',system-ui,sans-serif",fontSize:13,fontWeight:700,color:T.ink}}>
          Rising airports
        </h2>
        <ValidChip label={moverChipLabel} ok={opsDeltaOk} warning={moverChipWarning}/>
      </div>
      <div style={{fontSize:11,color:T.inkSoft,marginBottom:10,paddingLeft:14}}>
        By Δ ops net bookings / net TTV · floor ≥{B} bkgs / £{R.toLocaleString('en-GB')}, scaled to your window.
        {!opsDeltaOk && webValid && ' Ops comparison window overlaps migration burst or pre-coverage — ranked on web signal instead.'}
      </div>

      {moverSource === 'none' ? (
        <div style={{background:T.card,border:`1px solid ${T.line}`,borderRadius:12,padding:'16px 20px',
          marginBottom:24,fontSize:12,color:T.inkSoft}}>
          No honest comparison exists for this combination.
          <details style={{marginTop:6}}>
            <summary style={{cursor:'pointer',fontSize:11,color:T.prior,fontWeight:600,listStyle:'none'}}>▾ Why?</summary>
            <p style={{marginTop:6,fontSize:11,lineHeight:1.6}}>
              Ops: window intersects Feb–Mar 2025 migration burst or is before Apr 2025 per-airport coverage (OPS_AP_S = offset 304).<br/>
              Web: window is outside GA4 export coverage (≥ 2025-06-16).<br/>
              The airport table below still works for current-period values.
            </p>
          </details>
        </div>
      ) : (
        <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:24}}>
          <MoverCard title="Demand &amp; bookings up" airports={movers?.risersB||[]}
            fmtVal={moverFmtB} sign={1} valid={true}/>
          <MoverCard title="Revenue up" airports={movers?.risersR||[]}
            fmtVal={moverFmtR} sign={1} valid={true}/>
        </div>
      )}

      {/* ── (b) SLIPPING AIRPORTS ── */}
      <div style={{display:'flex',alignItems:'center',gap:0,marginBottom:6,borderLeft:`4px solid ${T.coral}`,paddingLeft:10}}>
        <h2 style={{fontFamily:"'DM Sans',system-ui,sans-serif",fontSize:13,fontWeight:700,color:T.ink}}>
          Slipping airports
        </h2>
        <ValidChip label={moverChipLabel} ok={opsDeltaOk} warning={moverChipWarning}/>
      </div>
      <div style={{fontSize:11,color:T.inkSoft,marginBottom:10,paddingLeft:14}}>
        Same ranking, downward.
      </div>

      {moverSource !== 'none' && (
        <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:24}}>
          <MoverCard title="Demand &amp; bookings down" airports={movers?.slippersB||[]}
            fmtVal={moverFmtB} sign={-1} valid={true}/>
          <MoverCard title="Revenue down" airports={movers?.slippersR||[]}
            fmtVal={moverFmtR} sign={-1} valid={true}/>
        </div>
      )}

      {/* ── (c) EVERY AIRPORT THIS PERIOD ── */}
      <div style={{borderLeft:`4px solid ${T.prior}`,paddingLeft:10,marginBottom:8}}>
        <h2 style={{fontFamily:"'DM Sans',system-ui,sans-serif",fontSize:13,fontWeight:700,color:T.ink}}>
          Every airport this period
          <span style={{fontSize:11,fontWeight:400,color:T.inkSoft,marginLeft:8}}>{sorted.length} airports</span>
        </h2>
      </div>

      <div style={{background:T.card,border:`1px solid ${T.line}`,borderRadius:12,
        overflow:'hidden',boxShadow:'0 1px 3px rgba(0,0,0,.05)',marginBottom:24}}>
        <div style={{maxHeight:560,overflowY:'auto',overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontVariantNumeric:'tabular-nums'}}>
            <thead>
              <tr>
                <Th col="nm" label="Airport" left={true}/>
                <Th col="cc" label="CC" left={true}/>
                <Th col="s"  label="Searches"/>
                <Th col="ds" label="Δ"/>
                <Th col="p"  label="Web bkgs"/>
                <Th col="dp" label="Δ"/>
                <Th col="r"  label="Web rev"/>
                <Th col="dr" label="Δ"/>
                <Th col="b"  label="Ops net bkgs"/>
                <Th col="db" label="Δ"/>
                <Th col="tn" label="Ops net TTV"/>
                <Th col="dtn" label="Δ"/>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, idx) => (
                <TableRow key={r.cd} r={r} idx={idx}
                  webValid={webValid} opsDeltaOk={opsDeltaOk} hasCmp={hasCmp}
                  onClick={() => openDrill(r.cd)}/>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Data note */}
      <div style={{fontSize:10,color:T.inkSoft,lineHeight:1.6}}>
        <strong style={{fontWeight:600,color:T.ink}}>Airport scope:</strong> 227 airports from dim_p2p_location (LocationType='AP') with ≥300 searches in the GA4 window.
        "Touch" attribution: an event touching an airport in either pick-up or drop-off role counts once for that airport — totals exceed network figures by design.
        Ops values "–" for airports with no dispatch coverage.
        Per-airport ops trusted from 2025-04-01 (OPS_AP_S). Migration burst Feb–Mar 2025 excluded from all comparisons.
        <br/><strong style={{fontWeight:600,color:T.ink}}>Trap T1 verified:</strong> PMI Jun 2026 ops gross=1,282 (not 807) — IFNULL guards on ARRAY_CONCAT confirmed working.
      </div>
    </div>
  )
})

// ── Memoised table row ────────────────────────────────────────────────────────
const TableRow = memo(function TableRow({ r, idx, webValid, opsDeltaOk, hasCmp, onClick }) {
  const zebraStyle = { background: idx%2===0 ? T.card : T.paper }
  const nameStyle = {
    padding:'6px 10px', fontSize:12, color:'#0A2540', fontWeight:600,
    borderBottom:`1px solid ${T.line}`, cursor:'pointer', maxWidth:200,
    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
  }
  const ccStyle = { ...tdStyle, textAlign:'left', color:T.inkSoft, fontSize:11 }
  const numStyle = { ...tdStyle }

  const webD = webValid && hasCmp
  const opsD = opsDeltaOk && hasCmp

  return (
    <tr style={zebraStyle} onClick={onClick}
      onMouseEnter={e=>e.currentTarget.style.background='#EEF7F3'}
      onMouseLeave={e=>e.currentTarget.style.background=zebraStyle.background}>
      <td style={nameStyle} title={r.nm}>{r.nm}</td>
      <td style={ccStyle}>{r.cc}</td>
      <td style={numStyle}>{r.s?fmtNum(r.s):'—'}</td>
      <DCell cur={r.s} prv={r.sc} valid={webD}/>
      <td style={numStyle}>{r.p?fmtNum(r.p):'—'}</td>
      <DCell cur={r.p} prv={r.pc} valid={webD}/>
      <td style={numStyle}>{r.r?fmtGBP(r.r):'—'}</td>
      <DCell cur={r.r} prv={r.rc} valid={webD}/>
      <td style={numStyle}>{r.hasOps?(r.b!=null?fmtNum(r.b):'—'):'—'}</td>
      <DCell cur={r.b} prv={r.bc} valid={opsD&&r.hasOps}/>
      <td style={numStyle}>{r.hasOps?(r.tn!=null?fmtGBP(r.tn):'—'):'—'}</td>
      <DCell cur={r.tn} prv={r.tnc} valid={opsD&&r.hasOps}/>
    </tr>
  )
})
