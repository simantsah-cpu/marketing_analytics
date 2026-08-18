/**
 * QualityTab.jsx — Margin & Quality — Partner Incident Rate
 * Build spec: MARGIN_QUALITY_PARTNER_INCIDENT_RATE.md
 * Data source: Q_MQ → dwb.dwb_complaint + ads.ads_ride_dispatch_v
 * Replaces Q_INC / ads_qa_complaint_kpi_view entirely.
 *
 * §0 Non-negotiables enforced here:
 *  - §0.6 Provisional periods MUST show ceiling; bare rate without chip is non-shippable
 *  - §0.7 Prebooked and Ride Hailing NEVER share a combined headline tile
 *  - §7.2 Delta is '—' when either side is provisional
 *  - §8   Footnote is mandatory
 *  - §10.7 Geo rows with valid < 100 → 'n/a (N trips)' not a rate
 */

import { useState, useMemo, useEffect } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens — identical to RideHailingTab, GeoProductTab, CustomersTab
// ─────────────────────────────────────────────────────────────────────────────
const T = {
  bg:'#ffffff', bg2:'#FAFBFC', bg3:'#F1F5F9', bg4:'#E2EAF0',
  text:'#1A2B3C', text2:'#374151', text3:'#64748B',
  border:'#E2EAF0', border2:'#B8C4D0',
  green:'#1D9E75', greenBg:'rgba(29,158,117,.11)',
  blue:'#185FA5',
  red:'#E24B4A',
  amber:'#D85A30', amberBg:'rgba(216,90,48,.10)',
  lift:'0 1px 2px rgba(26,26,24,.05), 0 6px 16px -6px rgba(26,26,24,.10)',
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function num(v){ const x=Number(v); return isFinite(x)?x:0 }

function pct(v, d=3){
  if(v===null||v===undefined||!isFinite(Number(v))) return '—'
  return (num(v)*100).toFixed(d)+'%'
}
function pts(v, d=2){
  if(v===null||!isFinite(Number(v))) return '—'
  const x=num(v)*100
  return (x>=0?'+':'')+x.toFixed(d)+' pts'
}
function numFmt(v){ return num(v).toLocaleString('en-US',{maximumFractionDigits:0}) }

function prevYm(ym){
  let y=+ym.slice(0,4), m=+ym.slice(5,7)-1
  if(m<=0){m+=12;y-=1}
  return `${y}-${String(m).padStart(2,'0')}`
}

// Period → {cur, base} month arrays
function mqSets(period, CUR_MONTH){
  const isMonth=k=>/^\d{4}-\d{2}$/.test(k??'')
  const y=+CUR_MONTH.slice(0,4), mo=+CUR_MONTH.slice(5,7)
  const ymk=(yy,mm)=>`${yy}-${String(mm).padStart(2,'0')}`
  if(isMonth(period)) return {cur:[period],base:[prevYm(period)]}
  if(period==='mtd')  return {cur:[CUR_MONTH],base:[prevYm(CUR_MONTH)]}
  if(period==='qtd'){
    const qs=Math.floor((mo-1)/3)*3+1,cur=[],base=[]
    for(let i=qs;i<=mo;i++) cur.push(ymk(y,i))
    for(let j=0;j<cur.length;j++){
      let pm=qs-3+j,py=y; if(pm<=0){pm+=12;py-=1}
      base.push(ymk(py,pm))
    }
    return {cur,base}
  }
  if(period==='ytd'){
    const cur=[],base=[]
    for(let k=1;k<=mo;k++){cur.push(ymk(y,k));base.push(ymk(y-1,k))}
    return {cur,base}
  }
  return {cur:[CUR_MONTH],base:[prevYm(CUR_MONTH)]}
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 — Client-side MQ data structures
// ─────────────────────────────────────────────────────────────────────────────
function buildMQ(rows){
  const MQ={biz:{},product:{},geo:{},customer:{}}
  ;(rows||[]).forEach(r=>{
    const g=MQ[r.grain]; if(!g) return
    ;(g[r.dim]??={})[r.ym]={
      valid:num(r.valid_trips),
      pin:  num(r.pi_in),
      pex:  num(r.pi_ex),
      plost:num(r.pi_lost),
    }
  })
  return MQ
}

// Sum a dim across months — components first, then divide (§5)
function mqFor(MQ, grain, dim, months){
  const src=MQ[grain]?.[dim]; if(!src) return null
  const t={valid:0,pin:0,pex:0,plost:0}
  let hit=false
  ;(months||[]).forEach(ym=>{
    const r=src[ym]; if(!r) return
    hit=true
    t.valid+=r.valid; t.pin+=r.pin; t.pex+=r.pex; t.plost+=r.plost
  })
  if(!hit||t.valid<=0) return null
  t.rateIn   = t.pin   / t.valid
  t.rateEx   = t.pex   / t.valid
  t.rateLost = t.plost / t.valid
  t.open     = t.pex - t.plost
  t.openShare= t.pex>0 ? t.open/t.pex : 0
  // §7: provisional when >5% of Ex cases are still open
  t.provisional = t.openShare > 0.05
  return t
}

// ─────────────────────────────────────────────────────────────────────────────
// Chip styles
// ─────────────────────────────────────────────────────────────────────────────
const CHIP_PROV={
  display:'inline-block',fontSize:9,fontWeight:700,
  padding:'1px 5px',borderRadius:4,marginLeft:5,
  background:T.amberBg,color:T.amber,
  verticalAlign:'middle',letterSpacing:'0.04em',
}
const CHIP_OK={
  display:'inline-block',fontSize:9,fontWeight:700,
  padding:'1px 5px',borderRadius:4,marginLeft:5,
  background:'rgba(29,158,117,.11)',color:'#1D9E75',
  verticalAlign:'middle',letterSpacing:'0.04em',
}

// ─────────────────────────────────────────────────────────────────────────────
// §7.1 — Rate cell with provisional chip
// ─────────────────────────────────────────────────────────────────────────────
function RateCell({t, dp=3}){
  if(!t) return <span style={{color:T.text3}}>—</span>
  const col=t.rateLost<0.01?T.green:T.red
  if(!t.provisional) return (
    <div>
      <span style={{fontWeight:600,color:col}}>{pct(t.rateLost,dp)}</span>
      <span style={CHIP_OK}>settled</span>
    </div>
  )
  return (
    <div>
      <div>
        <span style={{fontWeight:600,color:col}}>{pct(t.rateLost,dp)}</span>
        <span style={CHIP_PROV}>provisional</span>
      </div>
      <div style={{fontSize:10.5,color:T.amber,marginTop:2}}>
        {numFmt(t.open)} open · up to {pct(t.rateEx,dp)}
      </div>
    </div>
  )
}

// §7.2 — Delta: blank when either side is provisional
function DeltaCell({cur, base}){
  if(!cur||!base) return <span style={{color:T.text3}}>—</span>
  if(cur.provisional||base.provisional) return (
    <div>
      <span style={{color:T.text3}}>—</span>
      <div style={{fontSize:10,color:T.text3,marginTop:1}}>awaiting case closure</div>
    </div>
  )
  const d=cur.rateLost-base.rateLost
  const col=d<=0?T.green:T.red
  return <span style={{fontWeight:600,color:col}}>{pts(d,2)}</span>
}

// ─────────────────────────────────────────────────────────────────────────────
// Table styles — exact match to RideHailingTab / GeoProductTab
// ─────────────────────────────────────────────────────────────────────────────
const TH={padding:'6px 10px',fontSize:9.5,fontWeight:700,color:T.text3,
  textTransform:'uppercase',letterSpacing:'0.06em',background:T.bg2,
  borderBottom:`1px solid ${T.border}`,whiteSpace:'nowrap',textAlign:'right'}
const TD={padding:'9px 10px',fontSize:12.5,verticalAlign:'top'}
const ROW={borderBottom:`1px solid ${T.border}`}
const CARD={background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,padding:'14px 18px 12px'}

// ─────────────────────────────────────────────────────────────────────────────
// SectionLabel — identical to RideHailingTab
// ─────────────────────────────────────────────────────────────────────────────
function SectionLabel({children}){
  return (
    <div style={{fontSize:9,fontWeight:700,color:T.text3,textTransform:'uppercase',
      letterSpacing:'0.07em',marginBottom:10,display:'flex',alignItems:'center',gap:10}}>
      <span>{children}</span>
      <div style={{flex:1,height:'1px',background:T.border}}/>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// §8 — Headline KPI tile (Prebooked OR Ride Hailing — never combined §0.7)
// Pattern: matches KpiTile in RideHailingTab exactly
// ─────────────────────────────────────────────────────────────────────────────
function BizTile({label, t, base, accentColor}){
  if(!t) return (
    <div style={{...CARD,flex:1,minWidth:240}}>
      <div style={{fontSize:10.5,fontWeight:600,color:T.text3,marginBottom:6,
        textTransform:'uppercase',letterSpacing:'0.06em'}}>{label}</div>
      <div style={{color:T.text3,fontSize:13}}>No data for this period</div>
    </div>
  )
  const col=t.rateLost<0.01?T.green:T.red
  const hasDelta = t && base && !t.provisional && !base.provisional
  const delta = hasDelta ? t.rateLost - base.rateLost : null
  const deltaCol = delta===null ? T.text3 : delta<=0 ? T.green : T.red
  return (
    <div style={{...CARD,flex:1,minWidth:240}}>
      {/* Label */}
      <div style={{fontSize:10.5,fontWeight:600,color:T.text3,marginBottom:8,
        textTransform:'uppercase',letterSpacing:'0.06em'}}>{label}</div>
      {/* Big metric */}
      <div style={{display:'flex',alignItems:'baseline',gap:6,flexWrap:'wrap',marginBottom:2}}>
        <span style={{fontSize:28,fontWeight:700,color:accentColor||T.text,lineHeight:1.1}}>
          {pct(t.rateLost,3)}
        </span>
        {!t.provisional
          ? <span style={CHIP_OK}>settled</span>
          : <span style={CHIP_PROV}>provisional</span>
        }
      </div>
      {/* Sub-label */}
      <div style={{fontSize:11,color:T.text3,marginBottom:t.provisional?4:8}}>lost rate</div>
      {/* Provisional ceiling */}
      {t.provisional&&(
        <div style={{fontSize:11,color:T.amber,marginBottom:6}}>
          {numFmt(t.open)} open · up to {pct(t.rateEx,3)}
        </div>
      )}
      {/* Delta vs prior */}
      {delta!==null&&(
        <div style={{fontSize:11,marginBottom:10}}>
          <span style={{color:deltaCol,fontWeight:600}}>
            {(delta*100>=0?'+':'')+(delta*100).toFixed(2)+' pts'}
          </span>
          <span style={{color:T.text3,marginLeft:4}}>vs prior period</span>
        </div>
      )}
      {(t.provisional||base?.provisional)&&(
        <div style={{fontSize:11,color:T.text3,marginBottom:10}}>— awaiting case closure</div>
      )}
      {/* Stats grid */}
      <div style={{fontSize:11.5,color:T.text2,display:'grid',gridTemplateColumns:'auto 1fr',gap:'2px 8px',
        borderTop:`1px solid ${T.border}`,paddingTop:8}}>
        <span style={{color:T.text3}}>Valid trips</span>
        <span style={{textAlign:'right',fontWeight:600}}>{numFmt(t.valid)}</span>
        <span style={{color:T.text3}}>Lost</span>
        <span style={{textAlign:'right',fontWeight:600,color:col}}>{numFmt(t.plost)}</span>
        <span style={{color:T.text3}}>All complaints</span>
        <span style={{textAlign:'right'}}>{numFmt(t.pin)}</span>
        <span style={{color:T.text3}}>Ex (in-scope)</span>
        <span style={{textAlign:'right'}}>{numFmt(t.pex)}</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Product line table
// ─────────────────────────────────────────────────────────────────────────────
const PL_ORDER=['Private Transfer','Shared Shuttle','Rail','Ride Hailing']

function ProductTable({MQ, months, forceOpen}){
  const [open,setOpen]=useState(false)
  useEffect(()=>{
    if(typeof forceOpen==='boolean') setOpen(forceOpen)
  },[forceOpen])

  const rows=PL_ORDER.map(pl=>{
    const t=mqFor(MQ,'product',pl,months)
    return {pl,t}
  }).filter(r=>r.t&&r.t.valid>0)

  // Aggregate total — sum components, then divide (never average rates)
  const agg=rows.reduce((a,r)=>{
    if(!r.t) return a
    a.valid+=r.t.valid; a.pin+=r.t.pin; a.pex+=r.t.pex; a.plost+=r.t.plost
    return a
  },{valid:0,pin:0,pex:0,plost:0})
  const tot=agg.valid>0?{
    ...agg,
    rateLost:agg.plost/agg.valid,
  }:null

  if(!rows.length) return (
    <div style={{color:T.text3,fontSize:13,padding:'12px 0'}}>No product-line data for this period.</div>
  )
  return (
    <div style={{background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,overflow:'hidden',marginBottom:16}}>
      {/* Card header — matches RideHailingTab FunnelTable style */}
      <div onClick={()=>setOpen(o=>!o)}
        style={{padding:'10px 16px 8px',borderBottom:open?`1px solid ${T.border}`:'none',
          cursor:'pointer',display:'flex',alignItems:'center',gap:8,userSelect:'none'}}>
        <span style={{fontSize:10,color:T.text3,marginTop:1,flexShrink:0,
          transform:open?'rotate(90deg)':'rotate(0deg)',transition:'transform .15s',display:'inline-block'}}>▶</span>
        <div style={{flex:1}}>
          <div style={{fontWeight:700,fontSize:13.5,color:T.text}}>By product line</div>
          <div style={{fontSize:11.5,color:T.text3,marginTop:2}}>{rows.length} product lines · lost rate breakdown</div>
        </div>
        <span style={{fontSize:11,fontWeight:600,color:T.blue,background:T.bg2,
          padding:'3px 10px',borderRadius:6,border:`1px solid ${T.border}`,flexShrink:0}}>
          {open ? 'Collapse ▲' : 'Expand ▼'}
        </span>
      </div>
      {open&&(
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',minWidth:520}}>
            <colgroup>
              <col style={{width:'28%'}}/>
              <col style={{width:'16%'}}/>
              <col style={{width:'14%'}}/>
              <col style={{width:'14%'}}/>
              <col style={{width:'14%'}}/>
              <col style={{width:'14%'}}/>
            </colgroup>
            <thead>
              <tr>
                <th style={{...TH,textAlign:'left',paddingLeft:16}}>Product line</th>
                <th style={TH}>Valid trips</th>
                <th style={TH}>All</th>
                <th style={TH}>Ex</th>
                <th style={TH}>Lost</th>
                <th style={TH}>Lost rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({pl,t})=>(
                <tr key={pl} style={ROW}>
                  <td style={{...TD,paddingLeft:16,fontWeight:600}}>{pl}</td>
                  <td style={{...TD,textAlign:'right'}}>{numFmt(t.valid)}</td>
                  <td style={{...TD,textAlign:'right'}}>{numFmt(t.pin)}</td>
                  <td style={{...TD,textAlign:'right'}}>{numFmt(t.pex)}</td>
                  <td style={{...TD,textAlign:'right',fontWeight:600,color:t.rateLost<0.01?T.green:T.red}}>{numFmt(t.plost)}</td>
                  <td style={{...TD,textAlign:'right',fontWeight:600,color:t.rateLost<0.01?T.green:T.red}}>{pct(t.rateLost,3)}</td>
                </tr>
              ))}
              {tot&&(
                <tr style={{...ROW,background:T.bg3}}>
                  <td style={{...TD,paddingLeft:16,fontWeight:700}}>Total</td>
                  <td style={{...TD,textAlign:'right',fontWeight:700}}>{numFmt(tot.valid)}</td>
                  <td style={{...TD,textAlign:'right',fontWeight:700}}>{numFmt(agg.pin)}</td>
                  <td style={{...TD,textAlign:'right',fontWeight:700}}>{numFmt(agg.pex)}</td>
                  <td style={{...TD,textAlign:'right',fontWeight:700,color:tot.rateLost<0.01?T.green:T.red}}>{numFmt(agg.plost)}</td>
                  <td style={{...TD,textAlign:'right',fontWeight:700,color:tot.rateLost<0.01?T.green:T.red}}>{pct(tot.rateLost,3)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// §8 Trend chart — dual-axis SVG (Prebooked left, Ride Hailing right)
// ─────────────────────────────────────────────────────────────────────────────
function TrendChart({MQ, allMonths, CUR_MONTH}){
  // Exclude the current (partial) month — it has incomplete data and misleads the trend
  const months=[...allMonths].filter(ym=>ym!==CUR_MONTH).sort().slice(-12)
  if(months.length<2) return null

  const pbVals=months.map(ym=>{const t=mqFor(MQ,'biz','Prebooked',[ym]);return t?t.rateLost*100:null})
  const rhVals=months.map(ym=>{const t=mqFor(MQ,'biz','Ride Hailing',[ym]);return t?t.rateLost*100:null})

  const pbMax=Math.max(2,...pbVals.filter(v=>v!==null))*1.25
  const rhMax=Math.max(2,...rhVals.filter(v=>v!==null))*1.25

  const W=1000, H=175, PL={t:14, r:44, b:26, l:44}
  const iW=W-PL.l-PL.r, iH=H-PL.t-PL.b
  const xP=i=>(months.length>1?(i/(months.length-1)):0.5)*iW
  const pbY=v=>v===null?null:iH-(v/pbMax)*iH
  const rhY=v=>v===null?null:iH-(v/rhMax)*iH

  const makePath=(vals,yFn)=>{
    let d='',first=true
    vals.forEach((v,i)=>{
      const y=yFn(v)
      if(y===null){first=true;return}
      d+=(first?'M':'L')+` ${xP(i).toFixed(1)} ${y.toFixed(1)} `
      first=false
    })
    return d
  }

  const monthLbl=ym=>new Date(ym+'-02').toLocaleString('en-US',{month:'short'})
  const tick3=(max)=>[0,max/2,max]

  return (
    <div style={{background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,overflow:'hidden',marginBottom:16}}>
      {/* Card header — uniform with table cards */}
      <div style={{padding:'10px 16px 8px',borderBottom:`1px solid ${T.border}`}}>
        <div style={{fontWeight:700,fontSize:13.5,color:T.text}}>Lost rate by month</div>
        <div style={{fontSize:11.5,color:T.text3,marginTop:2,display:'flex',alignItems:'center',gap:16,flexWrap:'wrap'}}>
          <span>Prebooked vs Ride Hailing · dual-axis · current month excluded</span>
          <span style={{display:'inline-flex',alignItems:'center',gap:5}}>
            <span style={{width:7,height:7,borderRadius:'50%',background:T.blue,display:'inline-block'}}/>
            <span>Prebooked (left)</span>
          </span>
          <span style={{display:'inline-flex',alignItems:'center',gap:5}}>
            <span style={{width:7,height:7,borderRadius:'50%',background:T.amber,display:'inline-block'}}/>
            <span>Ride Hailing (right)</span>
          </span>
        </div>
      </div>
      <div style={{padding:'12px 16px 14px',overflowX:'auto'}}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto',display:'block',
          fontFamily:"'Inter', system-ui, -apple-system, sans-serif"}}>
          <g transform={`translate(${PL.l},${PL.t})`}>
            {tick3(iH).map((y,i)=>(
              <line key={i} x1={0} y1={y} x2={iW} y2={y} stroke={T.border} strokeWidth={0.8} strokeDasharray="3 3"/>
            ))}
            {tick3(pbMax).map((v,i)=>(
              <text key={i} x={-8} y={pbY(v)+3} textAnchor='end' fontSize={8.5} fontWeight="400" fill={T.text3}>{v.toFixed(1)}%</text>
            ))}
            {tick3(rhMax).map((v,i)=>(
              <text key={i} x={iW+8} y={rhY(v)+3} textAnchor='start' fontSize={8.5} fontWeight="400" fill={T.text3}>{v.toFixed(1)}%</text>
            ))}
            <path d={makePath(pbVals,pbY)} fill='none' stroke={T.blue} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/>
            <path d={makePath(rhVals,rhY)} fill='none' stroke={T.amber} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/>
            {pbVals.map((v,i)=>v!==null&&<circle key={i} cx={xP(i)} cy={pbY(v)} r={3} fill={T.blue} stroke="#ffffff" strokeWidth={1}/>)}
            {rhVals.map((v,i)=>v!==null&&<circle key={i} cx={xP(i)} cy={rhY(v)} r={3} fill={T.amber} stroke="#ffffff" strokeWidth={1}/>)}
            {months.map((ym,i)=>(
              <text key={i} x={xP(i)} y={iH+18} textAnchor='middle' fontSize={8.5} fontWeight="400" fill={T.text3}>{monthLbl(ym)}</text>
            ))}
          </g>
        </svg>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Geo expandable — §10.7: valid < 100 → suppress rate
// ─────────────────────────────────────────────────────────────────────────────
const MIN_GEO=100

function GeoSection({MQ, months, forceOpen}){
  const [open,setOpen]=useState(false)
  useEffect(()=>{
    if(typeof forceOpen==='boolean') setOpen(forceOpen)
  },[forceOpen])

  const rows=Object.keys(MQ.geo||{}).map(dim=>{
    const t=mqFor(MQ,'geo',dim,months)
    return {dim,t}
  }).filter(r=>r.t&&r.t.valid>0).sort((a,b)=>b.t.valid-a.t.valid)

  return (
    <div style={{background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,overflow:'hidden',marginBottom:16}}>
      <div onClick={()=>setOpen(o=>!o)}
        style={{padding:'10px 16px 8px',borderBottom:open?`1px solid ${T.border}`:'none',
          cursor:'pointer',display:'flex',alignItems:'center',gap:8,userSelect:'none'}}>
        <span style={{fontSize:10,color:T.text3,marginTop:1,flexShrink:0,
          transform:open?'rotate(90deg)':'rotate(0deg)',transition:'transform .15s',display:'inline-block'}}>▶</span>
        <div style={{flex:1}}>
          <div style={{fontWeight:700,fontSize:13.5,color:T.text}}>By geography</div>
          <div style={{fontSize:11.5,color:T.text3,marginTop:2}}>Prebooked and Ride Hailing split · {rows.length} rows · sorted by valid trips</div>
        </div>
        <span style={{fontSize:11,fontWeight:600,color:T.blue,background:T.bg2,
          padding:'3px 10px',borderRadius:6,border:`1px solid ${T.border}`,flexShrink:0}}>
          {open ? 'Collapse ▲' : 'Expand ▼'}
        </span>
      </div>
      {open&&(
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',minWidth:480}}>
            <colgroup>
              <col style={{width:'32%'}}/>
              <col style={{width:'18%'}}/>
              <col style={{width:'14%'}}/>
              <col style={{width:'14%'}}/>
              <col style={{width:'22%'}}/>
            </colgroup>
            <thead><tr>
              <th style={{...TH,textAlign:'left',paddingLeft:16}}>Line · Geo</th>
              <th style={TH}>Valid trips</th>
              <th style={TH}>Ex</th>
              <th style={TH}>Lost</th>
              <th style={TH}>Lost rate</th>
            </tr></thead>
            <tbody>
              {rows.map(({dim,t})=>{
                const parts=dim.split(' | ')
                const bizP=parts[0], geoP=parts.slice(1).join(' | ')||dim
                const suppressed=t.valid<MIN_GEO
                return (
                  <tr key={dim} style={ROW}>
                    <td style={{...TD,paddingLeft:16}}>
                      <div style={{fontWeight:600,fontSize:12}}>{geoP}</div>
                      <div style={{fontSize:10.5,color:T.text3}}>{bizP}</div>
                    </td>
                    <td style={{...TD,textAlign:'right'}}>{numFmt(t.valid)}</td>
                    <td style={{...TD,textAlign:'right'}}>{numFmt(t.pex)}</td>
                    <td style={{...TD,textAlign:'right',fontWeight:600,color:!suppressed&&t.rateLost<0.01?T.green:T.red}}>{numFmt(t.plost)}</td>
                    <td style={{...TD,textAlign:'right'}}>
                      {suppressed
                        ?<span style={{color:T.text3,fontSize:11}}>n/a ({numFmt(t.valid)} trips)</span>
                        :<span style={{fontWeight:600,color:t.rateLost<0.01?T.green:T.red}}>{pct(t.rateLost,3)}</span>
                      }
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
// Customer expandable — top 15 by valid trips, sortable
// ─────────────────────────────────────────────────────────────────────────────
function CustomerSection({MQ, months, baseMonths, forceOpen}){
  const [open,setOpen]=useState(false)
  useEffect(()=>{
    if(typeof forceOpen==='boolean') setOpen(forceOpen)
  },[forceOpen])

  const [sortKey,setSortKey]=useState('valid')
  const [sortDir,setSortDir]=useState(-1)

  const all=Object.keys(MQ.customer||{}).map(dim=>{
    const t=mqFor(MQ,'customer',dim,months)
    const base=mqFor(MQ,'customer',dim,baseMonths)
    return {dim,t,base}
  }).filter(r=>r.t&&r.t.valid>0).sort((a,b)=>b.t.valid-a.t.valid)

  const top15=[...all.slice(0,15)].sort((a,b)=>{
    const av=sortKey==='valid'?a.t.valid:sortKey==='lost'?a.t.plost:a.t.rateLost
    const bv=sortKey==='valid'?b.t.valid:sortKey==='lost'?b.t.plost:b.t.rateLost
    return sortDir*(bv-av)
  })

  const arrow=k=>sortKey===k?(sortDir===-1?'↓':'↑'):'⇅'
  const toggleSort=k=>{ if(sortKey===k) setSortDir(d=>-d); else{setSortKey(k);setSortDir(-1)} }

  return (
    <div style={{background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,overflow:'hidden',marginBottom:16}}>
      <div onClick={()=>setOpen(o=>!o)}
        style={{padding:'10px 16px 8px',borderBottom:open?`1px solid ${T.border}`:'none',
          cursor:'pointer',display:'flex',alignItems:'center',gap:8,userSelect:'none'}}>
        <span style={{fontSize:10,color:T.text3,marginTop:1,flexShrink:0,
          transform:open?'rotate(90deg)':'rotate(0deg)',transition:'transform .15s',display:'inline-block'}}>▶</span>
        <div style={{flex:1}}>
          <div style={{fontWeight:700,fontSize:13.5,color:T.text}}>By customer</div>
          <div style={{fontSize:11.5,color:T.text3,marginTop:2}}>Top 15 by valid trips · click column headers to sort · {Math.min(15,all.length)} shown</div>
        </div>
        <span style={{fontSize:11,fontWeight:600,color:T.blue,background:T.bg2,
          padding:'3px 10px',borderRadius:6,border:`1px solid ${T.border}`,flexShrink:0}}>
          {open ? 'Collapse ▲' : 'Expand ▼'}
        </span>
      </div>
      {open&&(
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',minWidth:520}}>
            <colgroup>
              <col style={{width:'32%'}}/>
              <col style={{width:'18%'}}/>
              <col style={{width:'12%'}}/>
              <col style={{width:'12%'}}/>
              <col style={{width:'12%'}}/>
              <col style={{width:'14%'}}/>
            </colgroup>
            <thead><tr>
              <th style={{...TH,textAlign:'left',paddingLeft:16}}>Line · Customer</th>
              <th style={{...TH,cursor:'pointer'}} onClick={()=>toggleSort('valid')}>Valid trips {arrow('valid')}</th>
              <th style={TH}>All</th>
              <th style={TH}>Ex</th>
              <th style={{...TH,cursor:'pointer'}} onClick={()=>toggleSort('lost')}>Lost {arrow('lost')}</th>
              <th style={{...TH,cursor:'pointer'}} onClick={()=>toggleSort('rate')}>Lost rate {arrow('rate')}</th>
            </tr></thead>
            <tbody>
              {top15.map(({dim,t})=>{
                const parts=dim.split(' | ')
                const bizP=parts[0], custP=parts.slice(1).join(' | ')||dim
                return (
                  <tr key={dim} style={ROW}>
                    <td style={{...TD,paddingLeft:16}}>
                      <div style={{fontWeight:600,fontSize:12}}>{custP}</div>
                      <div style={{fontSize:10.5,color:T.text3}}>{bizP}</div>
                    </td>
                    <td style={{...TD,textAlign:'right'}}>{numFmt(t.valid)}</td>
                    <td style={{...TD,textAlign:'right'}}>{numFmt(t.pin)}</td>
                    <td style={{...TD,textAlign:'right'}}>{numFmt(t.pex)}</td>
                    <td style={{...TD,textAlign:'right',fontWeight:600,color:t.rateLost<0.01?T.green:T.red}}>{numFmt(t.plost)}</td>
                    <td style={{...TD,textAlign:'right',fontWeight:600,color:t.rateLost<0.01?T.green:T.red}}>{pct(t.rateLost,3)}</td>
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
// Main QualityTab component
// ─────────────────────────────────────────────────────────────────────────────
export default function QualityTab({D, period, CUR_MONTH, PM}){
  const mqRaw = D.mq || []
  const sets  = useMemo(()=>mqSets(period, CUR_MONTH), [period, CUR_MONTH])
  const MQ    = useMemo(()=>buildMQ(mqRaw), [mqRaw])
  const [allExpanded, setAllExpanded] = useState(false)

  // All months present in biz grain — for the trend chart
  const allMonths = useMemo(()=>{
    const s=new Set()
    ;(mqRaw||[]).forEach(r=>{ if(r.grain==='biz'&&r.ym) s.add(r.ym) })
    return [...s].sort()
  },[mqRaw])

  const pmLabel=PM?.label||'current period'

  // Biz-grain aggregates
  const pbCur  = useMemo(()=>mqFor(MQ,'biz','Prebooked',   sets.cur),  [MQ,sets])
  const pbBase = useMemo(()=>mqFor(MQ,'biz','Prebooked',   sets.base), [MQ,sets])
  const rhCur  = useMemo(()=>mqFor(MQ,'biz','Ride Hailing',sets.cur),  [MQ,sets])
  const rhBase = useMemo(()=>mqFor(MQ,'biz','Ride Hailing',sets.base), [MQ,sets])

  const hasData = mqRaw.length > 0

  return (
    <div>
      {/* ── Header ── */}
      <div style={{marginBottom:16}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <h1 style={{fontSize:20,fontWeight:700,color:T.text,margin:0}}>Quality</h1>
          <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:10,
            background:'rgba(29,158,117,.11)',color:'#1D9E75',letterSpacing:'0.06em'}}>● LIVE</span>
        </div>
      </div>

      {/* ── Period context pill ── */}
      <div style={{marginBottom:20}}>
        <span style={{fontSize:11.5,color:T.text3,background:T.bg2,
          border:`1px solid ${T.border}`,borderRadius:8,padding:'4px 12px'}}>
          {pmLabel} · vs {PM?.base?.toLowerCase()||'prior period'}
        </span>
      </div>

      {/* ── Empty state ── */}
      {!hasData ? (
        <div style={{background:T.bg2,border:`1px solid ${T.border}`,borderRadius:10,
          padding:'20px 24px',color:T.text3,fontSize:13,lineHeight:1.8}}>
          <strong style={{color:T.text}}>No quality data loaded yet.</strong>
          {' '}Click <strong>Refresh</strong> on the dashboard to reload.
          {' '}The edge function queries <code>dwb.dwb_complaint</code> — confirm the service
          account has read access to the <code>dwb</code> dataset if no data appears after refresh.
        </div>
      ) : (
        <>
          {/* ── §8 KPI Tiles — two tiles, NEVER combined (§0.7) ── */}
          <SectionLabel>Headline Metrics</SectionLabel>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:24,flexWrap:'wrap'}}>
            <BizTile label="Prebooked"    t={pbCur} base={pbBase} accentColor={T.blue}/>
            <BizTile label="Ride Hailing" t={rhCur} base={rhBase} accentColor={T.amber}/>
          </div>

          {/* ── Trend chart ── */}
          <SectionLabel>Trend</SectionLabel>
          <TrendChart MQ={MQ} allMonths={allMonths} CUR_MONTH={CUR_MONTH}/>

          {/* ── Detailed breakdowns ── */}
          <div style={{marginTop:8}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
              <SectionLabel>Detailed Breakdowns</SectionLabel>
              <button
                onClick={()=>setAllExpanded(v=>!v)}
                style={{
                  background:T.bg,
                  border:`1px solid ${T.border2||T.border}`,
                  borderRadius:6,
                  padding:'4px 12px',
                  fontSize:11.5,
                  fontWeight:600,
                  color:T.text2,
                  cursor:'pointer',
                  fontFamily:'inherit',
                  flexShrink:0,
                  marginLeft:12,
                  marginBottom:10,
                }}
              >
                {allExpanded ? 'Collapse all' : 'Expand all'}
              </button>
            </div>

            <ProductTable MQ={MQ} months={sets.cur} forceOpen={allExpanded}/>
            <GeoSection MQ={MQ} months={sets.cur} forceOpen={allExpanded}/>
            <CustomerSection MQ={MQ} months={sets.cur} baseMonths={sets.base} forceOpen={allExpanded}/>
          </div>
        </>
      )}
    </div>
  )
}
