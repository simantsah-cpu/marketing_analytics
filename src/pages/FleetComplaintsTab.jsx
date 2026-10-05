/**
 * FleetComplaintsTab.jsx — Complaints tab for Fleet Lifecycle dashboard
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import { supabase } from '../services/supabase'

const AS_AT_MONTH = '2026-08-01'
const MUTED = '#6a7278', TEXT = '#14181b', GRID = '#eceef0', CARD = '#f7f8f9', BDR = '#e3e6e8'
const POS = '#1f7a5a', NEG = '#b4472f'
const NO_DL = { datalabels: { display: false } }
const GCFG  = { color: GRID, drawBorder: false }

const nv   = (v) => { const x = v==null?NaN:Number(v); return isFinite(x)?x:0 }
const isNil = (v) => v==null||!isFinite(Number(v))
const fmtInt  = (v) => isNil(v)?'\u2014':Math.round(nv(v)).toLocaleString('en-US')
const fmtPct  = (v,d=1) => isNil(v)?'\u2014':`${(nv(v)*100).toFixed(d)}%`
const fmtDelta = (v) => isNil(v)?null:`${(Math.abs(nv(v))*100).toFixed(1)}%`

const parseMonth = (s) => { const [y,m]=s.split('-').map(Number); return new Date(y,m-1,1) }
const toDate = (s) => s?.length===7?`${s}-01`:(s??'2023-01-01')

function windowLabel() {
  const e=parseMonth(AS_AT_MONTH), s=new Date(e.getFullYear(),e.getMonth()-11,1)
  const f=(d)=>d.toLocaleDateString('en-US',{month:'short',year:'numeric'})
  return `${f(s)} \u2013 ${f(e)}`
}
const WL = windowLabel()

async function fetchCm({ dataset, rangeStart, rangeEnd }) {
  const { data:{ session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fleet-analysis-complaints`, {
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${session?.access_token??''}`,apikey:import.meta.env.VITE_SUPABASE_ANON_KEY},
    body:JSON.stringify({asAtMonth:AS_AT_MONTH, rangeStart:toDate(rangeStart), rangeEnd:toDate(rangeEnd), dataset}),
  })
  if (!res.ok) { let m=`HTTP ${res.status}`; try{const j=await res.json();if(j.error)m=j.error}catch{}; throw new Error(m) }
  const j=await res.json(); if(j.error) throw new Error(j.error); return j
}

// ─── UI atoms ─────────────────────────────────────────────────────────────────
function Spinner() {
  return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:80,color:MUTED,gap:8,fontSize:12}}>
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{animation:'cm-spin 1s linear infinite'}}>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
    Loading\u2026<style>{`@keyframes cm-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
  </div>
}
function Err({msg}) {
  return <div style={{padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,color:'#b91c1c',fontSize:11}}>\u26a0 {msg}</div>
}
function SH({children}) {
  return <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.12em',color:MUTED,textTransform:'uppercase',margin:'4px 0 14px'}}>{children}</div>
}
function Card({title,children,style={}}) {
  return <div style={{background:CARD,border:`1px solid ${BDR}`,borderRadius:8,padding:'16px 18px 18px',...style}}>
    {title&&<div style={{fontSize:12,fontWeight:700,color:TEXT,marginBottom:14}}>{title}</div>}
    {children}
  </div>
}

// ─── KPI Tile (complaints tab: bad = increase for tiles 1-3) ──────────────────
function Tile({ label, value, deltaRaw, nMonths, badIfUp=false }) {
  const delta = fmtDelta(deltaRaw)
  const dir   = isNil(deltaRaw)?null:nv(deltaRaw)>=0?'up':'down'
  const good  = dir===null?null:(badIfUp?dir==='down':dir==='up')
  const dc    = good===null?MUTED:good?POS:NEG
  const arrow = dir==='up'?'\u25b2':dir==='down'?'\u25bc':''
  return <div style={{background:CARD,border:`1px solid ${BDR}`,borderRadius:8,padding:'14px 16px',minWidth:148,flex:'1 1 148px',display:'flex',flexDirection:'column',gap:4}}>
    <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.08em',color:MUTED,textTransform:'uppercase'}}>{label}</div>
    <div style={{fontSize:22,fontWeight:700,color:TEXT,fontVariantNumeric:'tabular-nums',lineHeight:1.2}}>{value}</div>
    <div style={{fontSize:11,color:delta?dc:'transparent',fontVariantNumeric:'tabular-nums',minHeight:16}}>
      {delta?`${arrow} ${delta} vs prior ${nMonths}m`:'\u00b7'}
    </div>
  </div>
}

// ─── Chart 1: Complaints, lost, deleted/open ──────────────────────────────────
function ComplaintsChart({ data }) {
  const labels = data.map(d=>d.month_label??'')
  const chartData = { labels, datasets:[
    {label:'Complaints filed',              data:data.map(d=>nv(d.complaints)),      borderColor:'#2f6f9f',borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:0.3,fill:false},
    {label:'Closed against Elife (lost)',   data:data.map(d=>nv(d.lost)),            borderColor:'#b4472f',borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:0.3,fill:false},
    {label:'Deleted or still open',         data:data.map(d=>nv(d.deleted_or_open)), borderColor:'#7a5ea8',borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:0.3,fill:false},
  ]}
  const opts = { responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
    plugins:{...NO_DL, legend:{display:true,position:'bottom',labels:{font:{size:11},color:MUTED,boxWidth:12,padding:14}},
      tooltip:{callbacks:{title:items=>items[0]?.label, label:item=>`  ${item.dataset.label}: ${Math.round(item.raw).toLocaleString()}`}}},
    scales:{
      x:{ticks:{font:{size:10},color:MUTED,maxRotation:-45,autoSkip:true,maxTicksLimit:8},grid:GCFG},
      y:{ticks:{font:{size:11},color:MUTED,callback:v=>Math.round(v).toLocaleString()},grid:{...GCFG,count:5}},
    }}
  return <Line data={chartData} options={opts} />
}

// ─── Chart 2: Loss rate ───────────────────────────────────────────────────────
function LossRateChart({ data }) {
  const labels = data.map(d=>d.month_label??'')
  const chartData = { labels, datasets:[
    {label:'Loss rate',data:data.map(d=>nv(d.loss_rate)),borderColor:'#b4472f',borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:0.3,fill:false},
  ]}
  const opts = { responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
    plugins:{...NO_DL, legend:{display:true,position:'bottom',labels:{font:{size:11},color:MUTED,boxWidth:12,padding:14}},
      tooltip:{callbacks:{title:items=>items[0]?.label, label:item=>`  Loss rate: ${(item.raw*100).toFixed(1)}%`}}},
    scales:{
      x:{ticks:{font:{size:10},color:MUTED,maxRotation:-45,autoSkip:true,maxTicksLimit:8},grid:GCFG},
      y:{min:0,max:0.7,ticks:{font:{size:11},color:MUTED,callback:v=>`${Math.round(v*100)}%`},grid:{...GCFG,count:5}},
    }}
  return <Line data={chartData} options={opts} />
}

// ─── Chart 3: Reason mix ──────────────────────────────────────────────────────
function ReasonMixChart({ data }) {
  const labels = data.map(d=>d.month_label??'')
  const chartData = { labels, datasets:[
    {label:'Customer no show',        data:data.map(d=>nv(d.share_customer_no_show)),borderColor:'#2f6f9f',borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:0.3,fill:false},
    {label:'Driver no show',          data:data.map(d=>nv(d.share_driver_no_show)),  borderColor:'#b4472f',borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:0.3,fill:false},
    {label:'Waiving cancellation fee',data:data.map(d=>nv(d.share_waiving_fee)),     borderColor:'#c98a2b',borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:0.3,fill:false},
    {label:'Driver late',             data:data.map(d=>nv(d.share_driver_late)),     borderColor:'#4a8f7b',borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:0.3,fill:false},
  ]}
  const opts = { responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
    plugins:{...NO_DL, legend:{display:true,position:'bottom',labels:{font:{size:11},color:MUTED,boxWidth:12,padding:14}},
      tooltip:{callbacks:{title:items=>items[0]?.label, label:item=>`  ${item.dataset.label}: ${(item.raw*100).toFixed(1)}%`}}},
    scales:{
      x:{ticks:{font:{size:10},color:MUTED,maxRotation:-45,autoSkip:true,maxTicksLimit:8},grid:GCFG},
      y:{min:0,max:0.8,ticks:{font:{size:11},color:MUTED,callback:v=>`${Math.round(v*100)}%`},grid:{...GCFG,count:5}},
    }}
  return <Line data={chartData} options={opts} />
}

// ─── Tables ────────────────────────────────────────────────────────────────────
const TH  = {fontSize:10,fontWeight:700,color:MUTED,textTransform:'uppercase',letterSpacing:'0.07em',padding:'6px 10px',textAlign:'right',borderBottom:`1.5px solid ${BDR}`,whiteSpace:'nowrap'}
const THL = {...TH,textAlign:'left'}
const TD  = {fontSize:12,color:TEXT,padding:'7px 10px',textAlign:'right',fontVariantNumeric:'tabular-nums',borderBottom:`1px solid ${GRID}`,whiteSpace:'nowrap'}
const TDL = {...TD,textAlign:'left'}
const TR  = ({i,children}) => <tr style={{background:i%2===0?'#fff':CARD}}>{children}</tr>

function ReasonTable({ data }) {
  if (!data?.length) return null
  return <div style={{overflowX:'auto'}}>
    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
      <thead><tr>
        <th style={THL}>Complaint reason</th>
        <th style={TH}>Complaints</th>
        <th style={TH}>Share</th>
        <th style={TH}>Lost</th>
        <th style={TH}>Loss rate</th>
      </tr></thead>
      <tbody>{data.map((r,i)=><TR key={i} i={i}>
        <td style={{...TDL,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis'}} title={String(r.complaint_reason??'')}>{r.complaint_reason}</td>
        <td style={TD}>{fmtInt(r.complaints)}</td>
        <td style={TD}>{fmtPct(r.share)}</td>
        <td style={TD}>{fmtInt(r.lost)}</td>
        <td style={{...TD,color:nv(r.loss_rate)>0.5?NEG:TEXT}}>{fmtPct(r.loss_rate)}</td>
      </TR>)}</tbody>
    </table>
  </div>
}

function FaultTable({ data }) {
  if (!data?.length) return null
  return <div style={{overflowX:'auto'}}>
    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
      <thead><tr>
        <th style={THL}>department_duty</th>
        <th style={TH}>Lost complaints</th>
        <th style={TH}>Share of lost</th>
      </tr></thead>
      <tbody>{data.map((r,i)=><TR key={i} i={i}>
        <td style={{...TDL,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis'}} title={String(r.department_duty??'')}>{r.department_duty}</td>
        <td style={TD}>{fmtInt(r.lost_complaints)}</td>
        <td style={TD}>{fmtPct(r.share)}</td>
      </TR>)}</tbody>
    </table>
  </div>
}

function LostReasonTable({ data }) {
  if (!data?.length) return null
  return <div style={{overflowX:'auto'}}>
    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
      <thead><tr>
        <th style={THL}>lost_reason</th>
        <th style={TH}>Lost complaints</th>
        <th style={TH}>Share</th>
      </tr></thead>
      <tbody>{data.map((r,i)=><TR key={i} i={i}>
        <td style={{...TDL,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis'}} title={String(r.lost_reason??'')}>{r.lost_reason}</td>
        <td style={TD}>{fmtInt(r.lost_complaints)}</td>
        <td style={TD}>{fmtPct(r.share)}</td>
      </TR>)}</tbody>
    </table>
  </div>
}

function EvidenceTable({ data }) {
  if (!data?.length) return null
  return <div style={{overflowX:'auto'}}>
    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
      <thead><tr>
        <th style={THL}>cns_evidence_provided</th>
        <th style={TH}>Customer-no-show complaints</th>
        <th style={TH}>Lost</th>
        <th style={TH}>Loss rate</th>
      </tr></thead>
      <tbody>{data.map((r,i)=><TR key={i} i={i}>
        <td style={TDL}>{r.evidence}</td>
        <td style={TD}>{fmtInt(r.cns_complaints)}</td>
        <td style={TD}>{fmtInt(r.lost)}</td>
        <td style={TD}>{fmtPct(r.loss_rate,2)}</td>
      </TR>)}</tbody>
    </table>
  </div>
}

function FleetTable({ data }) {
  if (!data?.length) return null
  return <div style={{overflowX:'auto'}}>
    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
      <thead><tr>
        <th style={THL}>Fleet</th>
        <th style={TH}>ID</th>
        <th style={TH}>Complaints</th>
        <th style={TH}>Lost</th>
        <th style={TH}>Loss rate</th>
        <th style={TH}>CNS</th>
        <th style={TH}>DNS</th>
      </tr></thead>
      <tbody>{data.map((r,i)=><TR key={i} i={i}>
        <td style={{...TDL,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis'}} title={String(r.fleet_name??'')}>{r.fleet_name}</td>
        <td style={TD}>{r.fleet_id}</td>
        <td style={TD}>{fmtInt(r.complaints)}</td>
        <td style={TD}>{fmtInt(r.lost)}</td>
        <td style={{...TD,color:nv(r.loss_rate)>0.5?NEG:TEXT}}>{fmtPct(r.loss_rate)}</td>
        <td style={TD}>{fmtInt(r.cns)}</td>
        <td style={TD}>{fmtInt(r.dns)}</td>
      </TR>)}</tbody>
    </table>
  </div>
}

function AirportTable({ data }) {
  if (!data?.length) return null
  return <div style={{overflowX:'auto'}}>
    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
      <thead><tr>
        <th style={THL}>Airport</th>
        <th style={TH}>Complaints</th>
        <th style={TH}>Lost</th>
        <th style={TH}>Loss rate</th>
        <th style={TH}>CNS</th>
        <th style={TH}>DNS</th>
      </tr></thead>
      <tbody>{data.map((r,i)=><TR key={i} i={i}>
        <td style={TDL}>{r.airport}</td>
        <td style={TD}>{fmtInt(r.complaints)}</td>
        <td style={TD}>{fmtInt(r.lost)}</td>
        <td style={{...TD,color:nv(r.loss_rate)>0.5?NEG:TEXT}}>{fmtPct(r.loss_rate)}</td>
        <td style={TD}>{fmtInt(r.cns)}</td>
        <td style={TD}>{fmtInt(r.dns)}</td>
      </TR>)}</tbody>
    </table>
  </div>
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function FleetComplaintsTab({ range, nMonths }) {
  const [monthly,    setMonthly]   = useState(null)
  const [mLoading,   setMLoading]  = useState(false)
  const [mErr,       setMErr]      = useState(null)
  const [kpis,       setKpis]      = useState(null)
  const [kLoading,   setKLoading]  = useState(false)
  const [kErr,       setKErr]      = useState(null)
  const [reason,     setReason]    = useState(null)
  const [fault,      setFault]     = useState(null)
  const [lostReason, setLostReason]= useState(null)
  const [evidence,   setEvidence]  = useState(null)
  const [fleet,      setFleet]     = useState(null)
  const [airport,    setAirport]   = useState(null)
  const [fLoading,   setFLoading]  = useState(false)
  const [fErr,       setFErr]      = useState(null)
  const monthlyFetched = useRef(false)
  const fixedFetched   = useRef(false)

  // Load monthly once
  useEffect(() => {
    if (monthlyFetched.current) return; monthlyFetched.current = true
    setMLoading(true); setMErr(null)
    fetchCm({ dataset:'monthly', rangeStart:'2023-01', rangeEnd:AS_AT_MONTH.slice(0,7) })
      .then(d=>setMonthly(d.monthly??[])).catch(e=>setMErr(e.message)).finally(()=>setMLoading(false))
  }, [])

  // Load fixed tables once
  useEffect(() => {
    if (fixedFetched.current) return; fixedFetched.current = true
    setFLoading(true); setFErr(null)
    Promise.all([
      fetchCm({dataset:'reason',      rangeStart:'2023-01',rangeEnd:AS_AT_MONTH.slice(0,7)}),
      fetchCm({dataset:'fault',       rangeStart:'2023-01',rangeEnd:AS_AT_MONTH.slice(0,7)}),
      fetchCm({dataset:'lost_reason', rangeStart:'2023-01',rangeEnd:AS_AT_MONTH.slice(0,7)}),
      fetchCm({dataset:'evidence',    rangeStart:'2023-01',rangeEnd:AS_AT_MONTH.slice(0,7)}),
      fetchCm({dataset:'fleet',       rangeStart:'2023-01',rangeEnd:AS_AT_MONTH.slice(0,7)}),
      fetchCm({dataset:'airport',     rangeStart:'2023-01',rangeEnd:AS_AT_MONTH.slice(0,7)}),
    ]).then(([r,f,lr,ev,fl,ap])=>{
      setReason(r.reason??[]); setFault(f.fault??[])
      setLostReason(lr.lost_reason??[]); setEvidence(ev.evidence??[])
      setFleet(fl.fleet??[]); setAirport(ap.airport??[])
    }).catch(e=>setFErr(e.message)).finally(()=>setFLoading(false))
  }, [])

  // KPIs on range change
  const fetchKpis = useCallback(() => {
    setKLoading(true); setKErr(null)
    fetchCm({ dataset:'kpis', rangeStart:range.fromMonth, rangeEnd:range.toMonth })
      .then(d=>setKpis(d.kpis??null)).catch(e=>setKErr(e.message)).finally(()=>setKLoading(false))
  }, [range.fromMonth, range.toMonth])
  useEffect(()=>{ fetchKpis() }, [fetchKpis])

  const rangeData = useMemo(()=>{
    if (!monthly?.length) return []
    return monthly.filter(d=>{ const m=d.month_label??''; return m>=range.fromMonth&&m<=range.toMonth })
  }, [monthly, range.fromMonth, range.toMonth])

  const kpiN = useMemo(()=>{
    if (kpis?.n_months!=null) return kpis.n_months
    try { const s=parseMonth(range.fromMonth),e=parseMonth(range.toMonth); return (e.getFullYear()-s.getFullYear())*12+(e.getMonth()-s.getMonth())+1 }
    catch { return nMonths??'?' }
  }, [kpis?.n_months, range.fromMonth, range.toMonth, nMonths])

  return (
    <div>
      <SH>Complaints</SH>

      {/* ── 6 KPI tiles ── */}
      {kErr && <Err msg={kErr} />}
      {kLoading ? <Spinner /> : kpis ? (
        <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:20}}>
          <Tile label="Complaints filed"         value={fmtInt(kpis.complaints)}            deltaRaw={kpis.complaints_vs_prior}  nMonths={kpiN} badIfUp={true} />
          <Tile label="Lost"                     value={fmtInt(kpis.lost)}                  deltaRaw={kpis.lost_vs_prior}        nMonths={kpiN} badIfUp={true} />
          <Tile label="Loss rate"                value={fmtPct(kpis.loss_rate)}             deltaRaw={kpis.loss_rate_vs_prior}   nMonths={kpiN} badIfUp={true} />
          <Tile label="Driver no show share"     value={fmtPct(kpis.driver_no_show_share)}  deltaRaw={null}                      nMonths={kpiN} />
          <Tile label="Customer no show share"   value={fmtPct(kpis.customer_no_show_share)}deltaRaw={null}                      nMonths={kpiN} />
          <Tile label="Evidence provided"        value={isNil(kpis.evidence_provided)?'\u2014':fmtPct(kpis.evidence_provided)} deltaRaw={null} nMonths={kpiN} />
        </div>
      ) : !kErr ? <div style={{height:90}} /> : null}

      {/* ── Chart 1: Complaints + lost + deleted/open ── */}
      <Card title="Complaints and lost complaints" style={{marginBottom:16}}>
        {mLoading?<Spinner/>:mErr?<Err msg={mErr}/>:<div style={{height:260}}><ComplaintsChart data={rangeData}/></div>}
      </Card>

      {/* ── Charts 2+3 ── */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
        <Card title="Loss rate">
          {mLoading?<Spinner/>:mErr?<Err msg={mErr}/>:<div style={{height:240}}><LossRateChart data={rangeData}/></div>}
        </Card>
        <Card title="Reason mix over time">
          {mLoading?<Spinner/>:mErr?<Err msg={mErr}/>:<div style={{height:240}}><ReasonMixChart data={rangeData}/></div>}
        </Card>
      </div>

      {/* ── Reason table ── */}
      <Card title={`Reason \u2014 volume and how often it is lost \u00b7 ${WL}`} style={{marginBottom:16}}>
        {fLoading?<Spinner/>:fErr?<Err msg={fErr}/>:<ReasonTable data={reason}/>}
      </Card>

      {/* ── Fault + Lost reason side by side ── */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
        <Card title={`Fault on lost complaints \u00b7 ${WL}`}>
          {fLoading?<Spinner/>:fErr?<Err msg={fErr}/>:<FaultTable data={fault}/>}
        </Card>
        <Card title={`Reason a complaint was lost \u00b7 ${WL}`}>
          {fLoading?<Spinner/>:fErr?<Err msg={fErr}/>:<LostReasonTable data={lostReason}/>}
        </Card>
      </div>

      {/* ── Evidence table ── */}
      <Card title={`Does evidence change the outcome? \u00b7 ${WL}`} style={{marginBottom:16}}>
        {fLoading?<Spinner/>:fErr?<Err msg={fErr}/>:<EvidenceTable data={evidence}/>}
      </Card>

      {/* ── Fleet + Airport side by side ── */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:24}}>
        <Card title={`Fleet \u00b7 ${WL}`}>
          {fLoading?<Spinner/>:fErr?<Err msg={fErr}/>:<FleetTable data={fleet}/>}
        </Card>
        <Card title={`Airport \u00b7 ${WL}`}>
          {fLoading?<Spinner/>:fErr?<Err msg={fErr}/>:<AirportTable data={airport}/>}
        </Card>
      </div>
    </div>
  )
}
