/**
 * FleetDriversTab.jsx — Drivers tab for Fleet Lifecycle dashboard
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import { supabase } from '../services/supabase'

const AS_AT_MONTH = '2026-08-01'
const MUTED  = '#6a7278'
const TEXT   = '#14181b'
const GRID   = '#eceef0'
const CARD   = '#f7f8f9'
const BDR    = '#e3e6e8'
const POS    = '#1f7a5a'
const NEG    = '#b4472f'
const NO_DL  = { datalabels: { display: false } }
const GCFG   = { color: GRID, drawBorder: false }

// Lifecycle colours by sort_order
const LC_COLOR = { 1:'#4a8f7b', 2:'#4a8f7b', 3:'#c98a2b', 4:'#c98a2b', 5:'#6a7278', 6:'#6a7278' }

// Formatters
const nv = (v) => { const x = v == null ? NaN : Number(v); return isFinite(x) ? x : 0 }
const isNil = (v) => v == null || !isFinite(Number(v))
const fmtInt  = (v) => isNil(v) ? '\u2014' : Math.round(nv(v)).toLocaleString('en-US')
const fmtPct  = (v, d=2) => isNil(v) ? '\u2014' : `${(nv(v)*100).toFixed(d)}%`
const fmtPct1 = (v) => fmtPct(v, 1)
const fmtPct0 = (v) => fmtPct(v, 0)
const fmtDp   = (v, d=2) => isNil(v) ? '\u2014' : nv(v).toFixed(d)
const fmtNet  = (v) => { if (isNil(v)) return '\u2014'; const x=Math.round(nv(v)); return (x>=0?'+':'')+x.toLocaleString() }
const fmtDelta = (v) => isNil(v) ? null : `${(Math.abs(nv(v))*100).toFixed(1)}%`

const parseMonth = (s) => { const [y,m]=s.split('-').map(Number); return new Date(y,m-1,1) }
const toDate = (s) => s?.length===7 ? `${s}-01` : s ?? '2023-01-01'

function windowLabel() {
  const e = parseMonth(AS_AT_MONTH)
  const s = new Date(e.getFullYear(), e.getMonth()-11, 1)
  const f = (d) => d.toLocaleDateString('en-US',{month:'short',year:'numeric'})
  return `${f(s)} \u2013 ${f(e)}`
}
const WINDOW_LABEL = windowLabel()
const ASAT_LABEL   = parseMonth(AS_AT_MONTH).toLocaleDateString('en-US',{month:'short',year:'numeric'})

async function fetchDrv({ dataset, rangeStart, rangeEnd }) {
  const { data:{ session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fleet-analysis-drivers`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${session?.access_token ?? ''}`, apikey:import.meta.env.VITE_SUPABASE_ANON_KEY },
    body: JSON.stringify({ asAtMonth:AS_AT_MONTH, rangeStart:toDate(rangeStart), rangeEnd:toDate(rangeEnd), dataset }),
  })
  if (!res.ok) { let m=`HTTP ${res.status}`; try{const j=await res.json();if(j.error)m=j.error}catch{}; throw new Error(m) }
  const j = await res.json(); if (j.error) throw new Error(j.error); return j
}

// ─── UI atoms ─────────────────────────────────────────────────────────────────
function Spinner() {
  return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:80,color:MUTED,gap:8,fontSize:12}}>
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{animation:'drv-spin 1s linear infinite'}}>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
    Loading from BigQuery\u2026
    <style>{`@keyframes drv-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
  </div>
}
function Err({ msg }) {
  return <div style={{padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,color:'#b91c1c',fontSize:11,marginBottom:8}}>\u26a0 {msg}</div>
}
function SH({ children }) {
  return <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.12em',color:MUTED,textTransform:'uppercase',margin:'4px 0 14px'}}>{children}</div>
}
function Card({ title, children, style={} }) {
  return <div style={{background:CARD,border:`1px solid ${BDR}`,borderRadius:8,padding:'16px 18px 18px',...style}}>
    {title && <div style={{fontSize:12,fontWeight:700,color:TEXT,marginBottom:14}}>{title}</div>}
    {children}
  </div>
}

// ─── KPI Tile ─────────────────────────────────────────────────────────────────
function Tile({ label, value, deltaRaw, nMonths, positiveIsGood=true }) {
  const delta = fmtDelta(deltaRaw)
  const dir   = isNil(deltaRaw) ? null : nv(deltaRaw) >= 0 ? 'up' : 'down'
  const good  = dir===null ? null : (positiveIsGood ? dir==='up' : dir==='down')
  const dc    = good===null ? MUTED : good ? POS : NEG
  const arrow = dir==='up' ? '\u25b2' : dir==='down' ? '\u25bc' : ''
  return <div style={{background:CARD,border:`1px solid ${BDR}`,borderRadius:8,padding:'14px 16px',minWidth:148,flex:'1 1 148px',display:'flex',flexDirection:'column',gap:4}}>
    <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.08em',color:MUTED,textTransform:'uppercase'}}>{label}</div>
    <div style={{fontSize:22,fontWeight:700,color:TEXT,fontVariantNumeric:'tabular-nums',lineHeight:1.2}}>{value}</div>
    <div style={{fontSize:11,color:delta?dc:'transparent',fontVariantNumeric:'tabular-nums',minHeight:16}}>
      {delta ? `${arrow} ${delta} vs prior ${nMonths}m` : '\u00b7'}
    </div>
  </div>
}

// ─── Chart: Driver attribution coverage ──────────────────────────────────────
function CoverageChart({ data }) {
  const labels = data.map(d => d.month_label??'')
  const chartData = { labels, datasets:[{
    label:'Trips with a fleet_driver_id', data:data.map(d=>nv(d.driver_id_coverage)),
    borderColor:'#2f6f9f', borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.3, fill:false,
  }]}
  const opts = { responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
    plugins:{...NO_DL, legend:{display:true,position:'bottom',labels:{font:{size:11},color:MUTED,boxWidth:12,padding:14}},
      tooltip:{callbacks:{title:(items)=>items[0]?.label, label:(item)=>`  Driver ID coverage: ${(item.raw*100).toFixed(1)}%`}}},
    scales:{
      x:{ticks:{font:{size:10},color:MUTED,maxRotation:-45,autoSkip:true,maxTicksLimit:8},grid:GCFG},
      y:{min:0.4,max:1,ticks:{font:{size:11},color:MUTED,callback:(v)=>`${Math.round(v*100)}%`},grid:{...GCFG,count:5}},
    }}
  return <Line data={chartData} options={opts} />
}

// ─── Chart: Active / Started / Stopped ───────────────────────────────────────
function ActiveStartedStoppedChart({ data }) {
  const labels = data.map(d => d.month_label??'')
  const chartData = { labels, datasets:[
    {label:'Active',  data:data.map(d=>nv(d.active_drivers)),     borderColor:'#2f6f9f', borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.3, fill:false},
    {label:'Started', data:data.map(d=>nv(d.drivers_started)),    borderColor:'#4a8f7b', borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.3, fill:false},
    {label:'Stopped', data:data.map(d=>d.drivers_stopped),        borderColor:'#b4472f', borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.3, fill:false, spanGaps:false},
  ]}
  const opts = { responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
    plugins:{...NO_DL, legend:{display:true,position:'bottom',labels:{font:{size:11},color:MUTED,boxWidth:12,padding:14}},
      tooltip:{callbacks:{title:(items)=>items[0]?.label, label:(item)=>`  ${item.dataset.label}: ${Math.round(item.raw??0).toLocaleString()}`}}},
    scales:{
      x:{ticks:{font:{size:10},color:MUTED,maxRotation:-45,autoSkip:true,maxTicksLimit:8},grid:GCFG},
      y:{ticks:{font:{size:11},color:MUTED,callback:(v)=>Math.round(v).toLocaleString()},grid:{...GCFG,count:5}},
    }}
  return <Line data={chartData} options={opts} />
}

// ─── Chart: DNS rate + Trips per driver (dual Y axis) ────────────────────────
function DnsTripsChart({ data }) {
  const labels = data.map(d => d.month_label??'')
  const chartData = { labels, datasets:[
    {label:'DNS rate',        data:data.map(d=>nv(d.dns_rate)),          borderColor:'#b4472f', borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.3, fill:false, yAxisID:'y'},
    {label:'Trips per driver',data:data.map(d=>nv(d.trips_per_driver)),  borderColor:'#7a5ea8', borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.3, fill:false, yAxisID:'y2'},
  ]}
  const opts = { responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
    plugins:{...NO_DL, legend:{display:true,position:'bottom',labels:{font:{size:11},color:MUTED,boxWidth:12,padding:14}},
      tooltip:{callbacks:{
        title:(items)=>items[0]?.label,
        label:(item)=> item.datasetIndex===0
          ? `  DNS rate: ${(item.raw*100).toFixed(2)}%`
          : `  Trips per driver: ${nv(item.raw).toFixed(1)}`,
      }}},
    scales:{
      x:{ticks:{font:{size:10},color:MUTED,maxRotation:-45,autoSkip:true,maxTicksLimit:8},grid:GCFG},
      y:{type:'linear',position:'left',min:0,max:0.04,ticks:{font:{size:11},color:'#b4472f',callback:(v)=>`${(v*100).toFixed(0)}%`},grid:{...GCFG,count:5}},
      y2:{type:'linear',position:'right',min:0,ticks:{font:{size:11},color:'#7a5ea8',callback:(v)=>v.toFixed(1)},grid:{display:false}},
    }}
  return <Line data={chartData} options={opts} />
}

// ─── Chart: Driver event split ─────────────────────────────────────────────────
function EventSplitChart({ data }) {
  const labels = data.map(d => d.month_label??'')
  const chartData = { labels, datasets:[
    {label:'ad_check (arrival distance)', data:data.map(d=>nv(d.ad_check)),  borderColor:'#2f6f9f', borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.3, fill:false},
    {label:'cns_check (no-show)',         data:data.map(d=>nv(d.cns_check)), borderColor:'#c98a2b', borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.3, fill:false},
  ]}
  const opts = { responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
    plugins:{...NO_DL, legend:{display:true,position:'bottom',labels:{font:{size:11},color:MUTED,boxWidth:12,padding:14}},
      tooltip:{callbacks:{title:(items)=>items[0]?.label, label:(item)=>`  ${item.dataset.label}: ${Math.round(item.raw).toLocaleString()}`}}},
    scales:{
      x:{ticks:{font:{size:10},color:MUTED,maxRotation:-45,autoSkip:true,maxTicksLimit:8},grid:GCFG},
      y:{ticks:{font:{size:11},color:MUTED,callback:(v)=>Math.round(v).toLocaleString()},grid:{...GCFG,count:5}},
    }}
  return <Line data={chartData} options={opts} />
}

// ─── Lifecycle state bars ─────────────────────────────────────────────────────
function LifecycleCard({ data }) {
  if (!data?.length) return null
  const total  = data.reduce((s,r)=>s+nv(r.drivers),0)
  const maxVal = Math.max(...data.map(r=>nv(r.drivers)),1)
  return <div style={{display:'flex',flexDirection:'column',gap:10,marginTop:4}}>
    {data.map((row,i) => {
      const cnt   = nv(row.drivers)
      const pct   = total>0 ? (cnt/total*100).toFixed(1) : '0.0'
      const barW  = (cnt/maxVal*100).toFixed(1)
      const color = LC_COLOR[row.sort_order] ?? MUTED
      return <div key={i} style={{display:'flex',alignItems:'center',gap:10}}>
        <div style={{width:130,fontSize:11,color:MUTED,textAlign:'right',flexShrink:0}}>{row.lifecycle_state}</div>
        <div style={{flex:1,height:22,background:'#eceef0',borderRadius:4,overflow:'hidden'}}>
          <div style={{width:`${barW}%`,height:'100%',background:color,borderRadius:4,transition:'width 0.5s'}} />
        </div>
        <div style={{width:110,fontSize:11,color:TEXT,fontVariantNumeric:'tabular-nums',flexShrink:0}}>
          {Math.round(cnt).toLocaleString()} · {pct}%
        </div>
      </div>
    })}
  </div>
}

// ─── Tables ────────────────────────────────────────────────────────────────────
const TH  = {fontSize:10,fontWeight:700,color:MUTED,textTransform:'uppercase',letterSpacing:'0.07em',padding:'6px 10px',textAlign:'right',borderBottom:`1.5px solid ${BDR}`,whiteSpace:'nowrap'}
const THL = {...TH,textAlign:'left'}
const TD  = {fontSize:12,color:TEXT,padding:'7px 10px',textAlign:'right',fontVariantNumeric:'tabular-nums',borderBottom:`1px solid ${GRID}`,whiteSpace:'nowrap'}
const TDL = {...TD,textAlign:'left'}
const TDN = (c) => ({...TD,color:c})

function TR({ i, children }) {
  return <tr style={{background:i%2===0?'#fff':CARD}}>{children}</tr>
}

function BandsTable({ data }) {
  if (!data?.length) return null
  return <div style={{overflowX:'auto'}}>
    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
      <thead><tr>
        <th style={THL}>Trips in window</th>
        <th style={TH}>Drivers</th>
        <th style={TH}>Share of drivers</th>
        <th style={TH}>Trips</th>
        <th style={TH}>Share of trips</th>
      </tr></thead>
      <tbody>{data.map((r,i)=><TR key={i} i={i}>
        <td style={TDL}>{r.band}</td>
        <td style={TD}>{fmtInt(r.drivers)}</td>
        <td style={TD}>{fmtPct1(r.share_of_drivers)}</td>
        <td style={TD}>{fmtInt(r.trips)}</td>
        <td style={TD}>{fmtPct1(r.share_of_trips)}</td>
      </TR>)}</tbody>
    </table>
  </div>
}

function FleetConcTable({ data }) {
  if (!data?.length) return null
  return <div style={{overflowX:'auto'}}>
    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
      <thead><tr>
        <th style={THL}>Fleet</th>
        <th style={TH}>ID</th>
        <th style={TH}>Attributed trips</th>
        <th style={TH}>Drivers</th>
        <th style={TH}>Top driver trips</th>
        <th style={TH}>Top driver share</th>
        <th style={TH}>DNS rate</th>
      </tr></thead>
      <tbody>{data.map((r,i)=><TR key={i} i={i}>
        <td style={{...TDL,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis'}} title={String(r.fleet_name??'')}>{r.fleet_name}</td>
        <td style={TD}>{r.fleet_id}</td>
        <td style={TD}>{fmtInt(r.attributed_trips)}</td>
        <td style={TD}>{fmtInt(r.drivers)}</td>
        <td style={TD}>{fmtInt(r.top_driver_trips)}</td>
        <td style={TDN(nv(r.top_driver_share)>0.9?NEG:TEXT)}>{fmtPct1(r.top_driver_share)}</td>
        <td style={TD}>{fmtPct(r.dns_rate)}</td>
      </TR>)}</tbody>
    </table>
  </div>
}

function WorstDnsTable({ data }) {
  if (!data?.length) return null
  return <div style={{overflowX:'auto'}}>
    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
      <thead><tr>
        <th style={THL}>Driver</th>
        <th style={TH}>ID</th>
        <th style={THL}>Fleet</th>
        <th style={TH}>Trips</th>
        <th style={TH}>DNS</th>
        <th style={TH}>DNS rate</th>
        <th style={TH}>CNS</th>
        <th style={TH}>Complaints</th>
        <th style={TH}>Complaint rate</th>
      </tr></thead>
      <tbody>{data.map((r,i)=><TR key={i} i={i}>
        <td style={{...TDL,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis'}} title={String(r.driver_name??'')}>{r.driver_name}</td>
        <td style={TD}>{r.driver_id}</td>
        <td style={{...TDL,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis'}} title={String(r.fleet_name??'')}>{r.fleet_name}</td>
        <td style={TD}>{fmtInt(r.trips)}</td>
        <td style={TD}>{fmtInt(r.dns)}</td>
        <td style={TDN(NEG)}>{fmtPct1(r.dns_rate)}</td>
        <td style={TD}>{fmtInt(r.cns)}</td>
        <td style={TD}>{fmtInt(r.complaints)}</td>
        <td style={TD}>{fmtPct1(r.complaint_rate)}</td>
      </TR>)}</tbody>
    </table>
  </div>
}

function TopDriversTable({ data }) {
  if (!data?.length) return null
  return <div style={{overflowX:'auto'}}>
    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
      <thead><tr>
        <th style={THL}>Driver</th>
        <th style={TH}>ID</th>
        <th style={THL}>Fleet</th>
        <th style={TH}>Trips</th>
        <th style={TH}>DNS rate</th>
        <th style={TH}>CNS rate</th>
        <th style={TH}>Complaint rate</th>
        <th style={TH}>Event rate</th>
        <th style={TH}>Reviews</th>
        <th style={TH}>Score</th>
      </tr></thead>
      <tbody>{data.map((r,i)=><TR key={i} i={i}>
        <td style={{...TDL,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis'}} title={String(r.driver_name??'')}>{r.driver_name}</td>
        <td style={TD}>{r.driver_id}</td>
        <td style={{...TDL,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis'}} title={String(r.fleet_name??'')}>{r.fleet_name}</td>
        <td style={TD}>{fmtInt(r.trips)}</td>
        <td style={TD}>{fmtPct(r.dns_rate)}</td>
        <td style={TD}>{fmtPct(r.cns_rate)}</td>
        <td style={TD}>{fmtPct(r.complaint_rate)}</td>
        <td style={TD}>{fmtPct0(r.event_rate)}</td>
        <td style={TD}>{fmtInt(r.reviews)}</td>
        <td style={TD}>{isNil(r.avg_score) ? '\u2014' : nv(r.avg_score).toFixed(2)}</td>
      </TR>)}</tbody>
    </table>
  </div>
}

function QualificationTable({ data }) {
  if (!data?.length) return null
  return <div style={{overflowX:'auto'}}>
    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
      <thead><tr>
        <th style={THL}>qualified_check</th>
        <th style={TH}>Drivers</th>
        <th style={TH}>Trips</th>
        <th style={TH}>DNS rate</th>
        <th style={TH}>Complaint rate</th>
      </tr></thead>
      <tbody>{data.map((r,i)=><TR key={i} i={i}>
        <td style={TDL}>{r.qualified_check}</td>
        <td style={TD}>{fmtInt(r.drivers)}</td>
        <td style={TD}>{fmtInt(r.trips)}</td>
        <td style={TD}>{fmtPct(r.dns_rate)}</td>
        <td style={TD}>{fmtPct(r.complaint_rate)}</td>
      </TR>)}</tbody>
    </table>
  </div>
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function FleetDriversTab({ range, nMonths }) {
  // Monthly + events — loaded once, filtered client-side
  const [monthly,  setMonthly]  = useState(null)
  const [events,   setEvents]   = useState(null)
  const [mLoading, setMLoading] = useState(false)
  const [mErr,     setMErr]     = useState(null)
  const [eLoading, setELoading] = useState(false)
  const [eErr,     setEErr]     = useState(null)

  // Range KPIs
  const [kpis,     setKpis]     = useState(null)
  const [kLoading, setKLoading] = useState(false)
  const [kErr,     setKErr]     = useState(null)

  // Lifecycle — fixed
  const [lifecycle,  setLifecycle]  = useState(null)
  const [lcLoading,  setLcLoading]  = useState(false)
  const [lcErr,      setLcErr]      = useState(null)

  // Fixed tables (bands, fleet_conc, worst_dns, top_drivers, qualification)
  const [bands,      setBands]      = useState(null)
  const [fleetConc,  setFleetConc]  = useState(null)
  const [worstDns,   setWorstDns]   = useState(null)
  const [topDrivers, setTopDrivers] = useState(null)
  const [qual,       setQual]       = useState(null)
  const [fLoading,   setFLoading]   = useState(false)
  const [fErr,       setFErr]       = useState(null)

  const monthlyFetched  = useRef(false)
  const eventsFetched   = useRef(false)
  const lifecycleFetched = useRef(false)
  const fixedFetched    = useRef(false)

  // Load monthly once
  useEffect(() => {
    if (monthlyFetched.current) return; monthlyFetched.current = true
    setMLoading(true); setMErr(null)
    fetchDrv({ dataset:'monthly', rangeStart:'2023-01', rangeEnd:AS_AT_MONTH.slice(0,7) })
      .then(d => setMonthly(d.monthly ?? []))
      .catch(e => setMErr(e.message))
      .finally(() => setMLoading(false))
  }, [])

  // Load events once
  useEffect(() => {
    if (eventsFetched.current) return; eventsFetched.current = true
    setELoading(true); setEErr(null)
    fetchDrv({ dataset:'events', rangeStart:'2024-03', rangeEnd:AS_AT_MONTH.slice(0,7) })
      .then(d => setEvents(d.events ?? []))
      .catch(e => setEErr(e.message))
      .finally(() => setELoading(false))
  }, [])

  // Load lifecycle once
  useEffect(() => {
    if (lifecycleFetched.current) return; lifecycleFetched.current = true
    setLcLoading(true); setLcErr(null)
    fetchDrv({ dataset:'lifecycle', rangeStart:'2023-01', rangeEnd:AS_AT_MONTH.slice(0,7) })
      .then(d => setLifecycle(d.lifecycle ?? []))
      .catch(e => setLcErr(e.message))
      .finally(() => setLcLoading(false))
  }, [])

  // Load fixed tables once
  useEffect(() => {
    if (fixedFetched.current) return; fixedFetched.current = true
    setFLoading(true); setFErr(null)
    // Fetch all 5 fixed datasets in parallel via separate calls
    Promise.all([
      fetchDrv({ dataset:'bands',        rangeStart:'2023-01', rangeEnd:AS_AT_MONTH.slice(0,7) }),
      fetchDrv({ dataset:'fleet_conc',   rangeStart:'2023-01', rangeEnd:AS_AT_MONTH.slice(0,7) }),
      fetchDrv({ dataset:'worst_dns',    rangeStart:'2023-01', rangeEnd:AS_AT_MONTH.slice(0,7) }),
      fetchDrv({ dataset:'top_drivers',  rangeStart:'2023-01', rangeEnd:AS_AT_MONTH.slice(0,7) }),
      fetchDrv({ dataset:'qualification',rangeStart:'2023-01', rangeEnd:AS_AT_MONTH.slice(0,7) }),
    ]).then(([b, fc, wd, td, q]) => {
      setBands(b.bands ?? []); setFleetConc(fc.fleet_conc ?? [])
      setWorstDns(wd.worst_dns ?? []); setTopDrivers(td.top_drivers ?? [])
      setQual(q.qualification ?? [])
    }).catch(e => setFErr(e.message))
      .finally(() => setFLoading(false))
  }, [])

  // KPIs on range change
  const fetchKpis = useCallback(() => {
    setKLoading(true); setKErr(null)
    fetchDrv({ dataset:'kpis', rangeStart:range.fromMonth, rangeEnd:range.toMonth })
      .then(d => setKpis(d.kpis ?? null))
      .catch(e => setKErr(e.message))
      .finally(() => setKLoading(false))
  }, [range.fromMonth, range.toMonth])
  useEffect(() => { fetchKpis() }, [fetchKpis])

  // Filter monthly & events to range
  const rangeData = useMemo(() => {
    if (!monthly?.length) return []
    return monthly.filter(d => { const m=d.month_label??d.month_start?.slice(0,7); return m>=range.fromMonth&&m<=range.toMonth })
  }, [monthly, range.fromMonth, range.toMonth])

  const rangeEvents = useMemo(() => {
    if (!events?.length) return []
    return events.filter(d => { const m=d.month_label??''; return m>=range.fromMonth&&m<=range.toMonth })
  }, [events, range.fromMonth, range.toMonth])

  const kpiN = useMemo(() => {
    if (kpis?.n_months != null) return kpis.n_months
    try { const s=parseMonth(range.fromMonth),e=parseMonth(range.toMonth); return (e.getFullYear()-s.getFullYear())*12+(e.getMonth()-s.getMonth())+1 }
    catch { return nMonths ?? '?' }
  }, [kpis?.n_months, range.fromMonth, range.toMonth, nMonths])

  return (
    <div>
      <SH>Drivers</SH>

      {/* ── 6 KPI tiles ── */}
      {kErr && <Err msg={kErr} />}
      {kLoading ? <Spinner /> : kpis ? (
        <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:20}}>
          <Tile label="Active drivers (end)"    value={fmtInt(kpis.active_end)}            deltaRaw={kpis.active_end_vs_prior} nMonths={kpiN} />
          <Tile label="Drivers started"         value={fmtInt(kpis.started)}               deltaRaw={null}                     nMonths={kpiN} />
          <Tile label="Drivers returned"        value={fmtInt(kpis.returned)}              deltaRaw={null}                     nMonths={kpiN} />
          <Tile label="Drivers stopped"         value={fmtInt(kpis.stopped)}               deltaRaw={null}                     nMonths={kpiN} />
          <Tile label="Driver no show rate"     value={fmtPct(kpis.driver_no_show_rate)}   deltaRaw={null}                     nMonths={kpiN} positiveIsGood={false} />
          <Tile label="Trips with a driver ID"  value={fmtPct1(kpis.trips_with_driver_id)} deltaRaw={null}                     nMonths={kpiN} />
        </div>
      ) : !kErr ? <div style={{height:90}} /> : null}

      {/* ── Coverage chart ── */}
      <Card title="Driver attribution coverage" style={{marginBottom:16}}>
        {mLoading ? <Spinner /> : mErr ? <Err msg={mErr} /> : <div style={{height:240}}><CoverageChart data={rangeData} /></div>}
      </Card>

      {/* ── Active/started/stopped + DNS/trips-per-driver ── */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
        <Card title="Active drivers \u00b7 started \u00b7 stopped">
          {mLoading ? <Spinner /> : mErr ? <Err msg={mErr} /> : <div style={{height:240}}><ActiveStartedStoppedChart data={rangeData} /></div>}
        </Card>
        <Card title="Driver no show rate and trips per driver">
          {mLoading ? <Spinner /> : mErr ? <Err msg={mErr} /> : <div style={{height:240}}><DnsTripsChart data={rangeData} /></div>}
        </Card>
      </div>

      {/* ── Event split chart ── */}
      <Card title="Driver event split \u2014 arrival-distance vs customer-no-show checks" style={{marginBottom:16}}>
        {eLoading ? <Spinner /> : eErr ? <Err msg={eErr} /> : <div style={{height:240}}><EventSplitChart data={rangeEvents} /></div>}
      </Card>

      {/* ── Lifecycle bars + Bands table ── */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
        <Card title={`Driver lifecycle state \u00b7 as at ${ASAT_LABEL}`}>
          {lcLoading ? <Spinner /> : lcErr ? <Err msg={lcErr} /> : <LifecycleCard data={lifecycle} />}
        </Card>
        <Card title={`Trips by driver size band \u00b7 ${WINDOW_LABEL}`}>
          {fLoading ? <Spinner /> : fErr ? <Err msg={fErr} /> : <BandsTable data={bands} />}
        </Card>
      </div>

      {/* ── Fleet concentration ── */}
      <Card title={`Driver concentration inside a fleet \u00b7 ${WINDOW_LABEL}`} style={{marginBottom:16}}>
        {fLoading ? <Spinner /> : fErr ? <Err msg={fErr} /> : <FleetConcTable data={fleetConc} />}
      </Card>

      {/* ── Worst DNS ── */}
      <Card title={`Highest no-show rate \u2014 drivers with \u2265100 trips \u00b7 ${WINDOW_LABEL}`} style={{marginBottom:16}}>
        {fLoading ? <Spinner /> : fErr ? <Err msg={fErr} /> : <WorstDnsTable data={worstDns} />}
      </Card>

      {/* ── Top drivers ── */}
      <Card title={`Largest drivers by volume \u00b7 ${WINDOW_LABEL}`} style={{marginBottom:16}}>
        {fLoading ? <Spinner /> : fErr ? <Err msg={fErr} /> : <TopDriversTable data={topDrivers} />}
      </Card>

      {/* ── Qualification ── */}
      <Card title={`Qualification status against performance \u00b7 ${WINDOW_LABEL}`} style={{marginBottom:24}}>
        {fLoading ? <Spinner /> : fErr ? <Err msg={fErr} /> : <QualificationTable data={qual} />}
      </Card>
    </div>
  )
}
