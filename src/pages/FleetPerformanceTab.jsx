/**
 * FleetPerformanceTab.jsx — Performance tab for Fleet Lifecycle dashboard
 * - 6-toggle Quality & mix line chart (dynamic dual-axis for avg_score)
 * - Log-scale bubble scatter (per-point colors, y toggle)
 * - Two movers tables (increases + decreases)
 */
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Line, Bubble } from 'react-chartjs-2'
import { Chart as ChartJS, LogarithmicScale } from 'chart.js'
import { supabase } from '../services/supabase'

// Register log scale once (global Chart.js registry)
ChartJS.register(LogarithmicScale)

const AS_AT   = '2026-08-01'
const MUTED   = '#6a7278', TEXT = '#14181b', GRID = '#eceef0', CARD = '#f7f8f9', BDR = '#e3e6e8'
const POS     = '#1f7a5a', NEG = '#b4472f'
const NO_DL   = { datalabels:{ display:false } }
const GCFG    = { color:GRID, drawBorder:false }

// Window labels (computed from pinned as_at_month)
const AS_AT_D   = new Date(2026, 7, 1) // Aug 2026
const addM      = (d,n) => new Date(d.getFullYear(), d.getMonth()+n, 1)
const fmtMY     = (d) => d.toLocaleDateString('en-US',{month:'short',year:'numeric'})
const CUR_START = addM(AS_AT_D,-2) // Jun 2026
const CUR_END   = AS_AT_D          // Aug 2026
const PRI_START = addM(AS_AT_D,-5) // Mar 2026
const PRI_END   = addM(AS_AT_D,-3) // May 2026
const SCATTER_WL = `${fmtMY(CUR_START)} \u2013 ${fmtMY(CUR_END)}`
const MOVERS_WL  = `${SCATTER_WL} vs ${fmtMY(PRI_START)} \u2013 ${fmtMY(PRI_END)}`

// ─── Series config ─────────────────────────────────────────────────────────────
const SERIES = [
  { id:'complaint_rate',      label:'Complaint rate',      field:'complaint_rate',      color:'#b4472f' },
  { id:'lost_complaint_rate', label:'Lost-complaint rate', field:'lost_complaint_rate', color:'#7a5ea8' },
  { id:'driver_event_rate',   label:'Driver event rate',   field:'driver_event_rate',   color:'#2f6f9f' },
  { id:'auction_share',       label:'Auction share',       field:'auction_share',       color:'#c98a2b' },
  { id:'top10_profit_share',  label:'Top-10 profit share', field:'top10_profit_share',  color:'#4a8f7b' },
  { id:'avg_score',           label:'Average score',       field:'avg_score',           color:'#1f7a5a' },
]
const DEFAULT_ACTIVE = new Set(['complaint_rate','auction_share','top10_profit_share'])

// ─── Helpers ───────────────────────────────────────────────────────────────────
const nv    = (v) => { const x=v==null?NaN:Number(v); return isFinite(x)?x:0 }
const isNil = (v) => v==null||!isFinite(Number(v))
const fmtInt  = (v) => isNil(v)?'\u2014':Math.round(nv(v)).toLocaleString('en-US')
const fmtPct  = (v,d=1) => isNil(v)?'\u2014':`${(nv(v)*100).toFixed(d)}%`
const toDate  = (s) => s?.length===7?`${s}-01`:(s??AS_AT)

function fmtProfitSigned(v) {
  if (isNil(v)) return '\u2014'
  const x=Math.round(nv(v))
  return x<0?`-$${(-x).toLocaleString()}`:`$${x.toLocaleString()}`
}
function fmtProfitDelta(v) {
  if (isNil(v)) return '\u2014'
  const x=Math.round(nv(v))
  if (x>0) return `+$${x.toLocaleString()}`
  if (x<0) return `-$${(-x).toLocaleString()}`
  return '$0'
}
function bubbleColor(fleet, alpha) {
  const cr=nv(fleet.complaint_rate)
  const rgb=cr<0.03?'74,143,123':cr<0.07?'201,138,43':'180,71,47'
  return `rgba(${rgb},${alpha})`
}

async function fetchPerf(dataset) {
  const { data:{ session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fleet-analysis-performance`, {
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${session?.access_token??''}`,apikey:import.meta.env.VITE_SUPABASE_ANON_KEY},
    body:JSON.stringify({ dataset }),
  })
  if (!res.ok){let m=`HTTP ${res.status}`;try{const j=await res.json();if(j.error)m=j.error}catch{};throw new Error(m)}
  const j=await res.json(); if(j.error) throw new Error(j.error); return j
}

// ─── UI atoms ─────────────────────────────────────────────────────────────────
function Spinner() {
  return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:80,color:MUTED,gap:8,fontSize:12}}>
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{animation:'pf-spin 1s linear infinite'}}>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
    Loading from BigQuery\u2026<style>{`@keyframes pf-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
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

// ─── Quality & mix chart ──────────────────────────────────────────────────────
function QualityChart({ data, activeSeries }) {
  const hasSeries = activeSeries.length>0
  const effectiveSeries = hasSeries ? activeSeries : [SERIES[0]]
  const hasScore = effectiveSeries.some(s=>s.id==='avg_score')
  const hasRate  = effectiveSeries.some(s=>s.id!=='avg_score')

  const labels = data.map(d=>d.month_label??'')

  const datasets = effectiveSeries.map(s => ({
    label: s.label,
    data:  data.map(d => d[s.field]),
    borderColor: s.color,
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    tension: 0.3,
    fill: false,
    spanGaps: false,
    yAxisID: (hasRate && hasScore && s.id==='avg_score') ? 'y2' : 'y',
  }))

  // Axis config
  let yMin=0, yMax=1
  let yTick = v=>`${Math.round(v*100)}%`
  let y2Cfg = null

  if (!hasRate && hasScore) {
    yMin=4.40; yMax=4.90; yTick=v=>v.toFixed(2)
  } else {
    const rateFields = effectiveSeries.filter(s=>s.id!=='avg_score').map(s=>s.field)
    const maxRate = Math.max(
      0.001,
      ...data.flatMap(d=>rateFields.map(f=>isNil(d[f])?0:nv(d[f])))
    )
    yMax = maxRate*1.08; yMin=0
    if (hasScore) {
      y2Cfg = {
        type:'linear', position:'right',
        min:4.40, max:4.90,
        ticks:{font:{size:10},color:'#1f7a5a',callback:v=>v.toFixed(2)},
        grid:{display:false}
      }
    }
  }

  const tooltipLabel = (item) => {
    const s = effectiveSeries[item.datasetIndex]
    if (!s) return ''
    const raw = item.raw
    if (isNil(raw)) return `  ${s.label}: —`
    return s.id==='avg_score'
      ? `  ${s.label}: ${nv(raw).toFixed(2)}`
      : `  ${s.label}: ${(nv(raw)*100).toFixed(2)}%`
  }

  const opts = {
    responsive:true, maintainAspectRatio:false,
    interaction:{mode:'index',intersect:false},
    plugins:{
      ...NO_DL,
      legend:{display:true,position:'bottom',labels:{font:{size:11},color:MUTED,boxWidth:12,padding:14}},
      tooltip:{callbacks:{
        title:items=>items[0]?.label,
        label:tooltipLabel,
      }},
    },
    scales:{
      x:{ ticks:{font:{size:10},color:MUTED,maxRotation:-45,autoSkip:true,maxTicksLimit:8}, grid:GCFG },
      y:{ type:'linear', min:yMin, max:yMax, ticks:{font:{size:11},color:MUTED,callback:yTick}, grid:GCFG },
      ...(y2Cfg?{y2:y2Cfg}:{}),
    },
  }
  return <Line data={{labels,datasets}} options={opts} />
}

// ─── Scatter chart ─────────────────────────────────────────────────────────────
const SCATTER_LEGEND = [
  { label:'< 3%',  color:'#4a8f7b' },
  { label:'3\u20137%', color:'#c98a2b' },
  { label:'> 7%',  color:'#b4472f' },
]
const LOG_TICKS = [30,100,300,1000,3000,10000,50000]

function ScatterChart({ data, yMode }) {
  const prepared = useMemo(() => {
    if (!data?.length) return []
    const maxAbsP = Math.max(...data.map(d=>Math.abs(nv(d.elife_profit))),1)
    return data.map(d=>({
      ...d,
      r: 4 + 10*Math.sqrt(Math.abs(nv(d.elife_profit))/maxAbsP),
      _y: yMode==='margin'?nv(d.margin):nv(d.auction_share),
    })).sort((a,b)=>b.r-a.r) // largest first = drawn behind
  }, [data, yMode])

  if (!prepared.length) return null

  const chartData = {
    datasets:[{
      label:'Fleets',
      data: prepared.map(d=>({ x:nv(d.dispatched_trips), y:d._y, r:d.r, fleet:d })),
      backgroundColor: prepared.map(d=>bubbleColor(d,0.45)),
      borderColor:     prepared.map(d=>bubbleColor(d,1)),
      borderWidth: 1.5,
    }]
  }

  const yMin = yMode==='margin' ? -0.20 : 0
  const yMax = yMode==='margin' ?  0.55 : 1.0

  const opts = {
    responsive:true, maintainAspectRatio:false,
    interaction:{mode:'nearest',intersect:true},
    animation:false,
    plugins:{
      datalabels:{display:false},
      legend:{display:false},
      tooltip:{callbacks:{
        label:ctx=>{
          const d=ctx.raw?.fleet
          if (!d) return ''
          return [
            `  ${d.fleet_name} (${d.fleet_id})`,
            `  Trips: ${Math.round(nv(d.dispatched_trips)).toLocaleString()}`,
            `  Profit: ${fmtProfitSigned(d.elife_profit)}`,
            `  Margin: ${(nv(d.margin)*100).toFixed(1)}%`,
            `  Complaint rate: ${(nv(d.complaint_rate)*100).toFixed(2)}%`,
            `  Auction share: ${(nv(d.auction_share)*100).toFixed(0)}%`,
          ]
        },
        title:()=>'',
      }},
    },
    scales:{
      x:{
        type:'logarithmic',
        min:30,
        title:{display:true,text:'dispatched trips (log)',font:{size:10},color:MUTED},
        ticks:{font:{size:10},color:MUTED,
          callback:(v)=>LOG_TICKS.includes(Number(v))?Number(v).toLocaleString():''
        },
        grid:GCFG,
      },
      y:{
        min:yMin, max:yMax,
        ticks:{font:{size:11},color:MUTED,stepSize:(yMax-yMin)/6,
          callback:v=>`${Math.round(v*100)}%`
        },
        grid:{...GCFG},
      },
    },
  }

  return (
    <>
      <Bubble data={chartData} options={opts} />
      <div style={{display:'flex',gap:14,justifyContent:'center',marginTop:8}}>
        {SCATTER_LEGEND.map(l=><div key={l.label} style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:MUTED}}>
          <div style={{width:10,height:10,borderRadius:'50%',background:l.color,flexShrink:0}} />
          {l.label}
        </div>)}
      </div>
    </>
  )
}

// ─── Movers table ─────────────────────────────────────────────────────────────
const TH  = {fontSize:10,fontWeight:700,color:MUTED,textTransform:'uppercase',letterSpacing:'0.07em',padding:'5px 8px',textAlign:'right',borderBottom:`1.5px solid ${BDR}`,whiteSpace:'nowrap'}
const THL = {...TH,textAlign:'left'}
const TD  = {fontSize:11,color:TEXT,padding:'6px 8px',textAlign:'right',fontVariantNumeric:'tabular-nums',borderBottom:`1px solid ${GRID}`,whiteSpace:'nowrap'}
const TDL = {...TD,textAlign:'left'}
const TR  = ({i,children}) => <tr style={{background:i%2===0?'#fff':CARD}}>{children}</tr>

function MoversTable({ rows }) {
  if (!rows?.length) return null
  return <div style={{overflowX:'auto'}}>
    <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
      <thead><tr>
        <th style={THL}>Fleet</th>
        <th style={TH}>ID</th>
        <th style={TH}>Profit now</th>
        <th style={TH}>Prior</th>
        <th style={TH}>\u0394</th>
        <th style={TH}>Trips now</th>
        <th style={TH}>Prior</th>
        <th style={TH}>Compl. now</th>
        <th style={TH}>Prior</th>
      </tr></thead>
      <tbody>{rows.map((r,i)=><TR key={i} i={i}>
        <td style={{...TDL,maxWidth:140,overflow:'hidden',textOverflow:'ellipsis'}} title={String(r.fleet_name??'')}>{r.fleet_name}</td>
        <td style={TD}>{r.fleet_id}</td>
        <td style={TD}>{fmtProfitSigned(r.profit_now)}</td>
        <td style={TD}>{fmtProfitSigned(r.profit_prior)}</td>
        <td style={{...TD,color:nv(r.profit_change)>=0?POS:NEG,fontWeight:600}}>{fmtProfitDelta(r.profit_change)}</td>
        <td style={TD}>{fmtInt(r.trips_now)}</td>
        <td style={TD}>{fmtInt(r.trips_prior)}</td>
        <td style={TD}>{isNil(r.complaint_rate_now)?'\u2014':fmtPct(r.complaint_rate_now,2)}</td>
        <td style={TD}>{isNil(r.complaint_rate_prior)?'\u2014':fmtPct(r.complaint_rate_prior,2)}</td>
      </TR>)}</tbody>
    </table>
  </div>
}

// ─── Toggle button ─────────────────────────────────────────────────────────────
function Toggle({ label, active, color, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding:'4px 10px', fontSize:11, borderRadius:5, cursor:'pointer',
      border:`1.5px solid ${color??BDR}`,
      background:active?(color??TEXT):'transparent',
      color:active?'#fff':(color??MUTED),
      fontWeight:active?600:400,
      transition:'all 0.15s',
    }}>
      {label}
    </button>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function FleetPerformanceTab({ range }) {
  const [monthly,   setMonthly]   = useState(null)
  const [mLoading,  setMLoading]  = useState(false)
  const [mErr,      setMErr]      = useState(null)
  const [scatter,   setScatter]   = useState(null)
  const [scLoading, setScLoading] = useState(false)
  const [scErr,     setScErr]     = useState(null)
  const [movers,    setMovers]    = useState(null)
  const [mvLoading, setMvLoading] = useState(false)
  const [mvErr,     setMvErr]     = useState(null)
  const [activeIds, setActiveIds] = useState(DEFAULT_ACTIVE)
  const [yMode,     setYMode]     = useState('margin') // 'margin' | 'auction'

  const monthlyFetched = useRef(false)
  const scatterFetched = useRef(false)
  const moversFetched  = useRef(false)

  useEffect(()=>{
    if (monthlyFetched.current) return; monthlyFetched.current=true
    setMLoading(true); setMErr(null)
    fetchPerf('monthly').then(d=>setMonthly(d.monthly??[])).catch(e=>setMErr(e.message)).finally(()=>setMLoading(false))
  },[])
  useEffect(()=>{
    if (scatterFetched.current) return; scatterFetched.current=true
    setScLoading(true); setScErr(null)
    fetchPerf('scatter').then(d=>setScatter(d.scatter??[])).catch(e=>setScErr(e.message)).finally(()=>setScLoading(false))
  },[])
  useEffect(()=>{
    if (moversFetched.current) return; moversFetched.current=true
    setMvLoading(true); setMvErr(null)
    fetchPerf('movers').then(d=>setMovers(d.movers??[])).catch(e=>setMvErr(e.message)).finally(()=>setMvLoading(false))
  },[])

  const rangeData = useMemo(()=>{
    if (!monthly?.length) return []
    return monthly.filter(d=>(d.month_label??'')>=range.fromMonth&&(d.month_label??'')<=range.toMonth)
  },[monthly,range.fromMonth,range.toMonth])

  const activeSeries = useMemo(()=>SERIES.filter(s=>activeIds.has(s.id)),[activeIds])

  const toggleSeries = (id) => setActiveIds(prev=>{
    const next=new Set(prev)
    next.has(id)?next.delete(id):next.add(id)
    return next
  })

  const increases = useMemo(()=>(movers??[]).filter(d=>d.side==='increase'),[movers])
  const decreases = useMemo(()=>(movers??[]).filter(d=>d.side==='decrease'),[movers])

  return (
    <div>
      <SH>Performance</SH>

      {/* ── Quality & mix ── */}
      <Card title="Quality and mix" style={{marginBottom:16}}>
        <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:12}}>
          {SERIES.map(s=><Toggle key={s.id} label={s.label} active={activeIds.has(s.id)} color={s.color} onClick={()=>toggleSeries(s.id)} />)}
        </div>
        {mLoading?<Spinner/>:mErr?<Err msg={mErr}/>:
          <div style={{height:260}}><QualityChart data={rangeData} activeSeries={activeSeries} /></div>
        }
      </Card>

      {/* ── Scatter ── */}
      <Card title={`Trips vs ${yMode==='margin'?'margin':'auction share'} \u00b7 ${SCATTER_WL}`} style={{marginBottom:16}}>
        <div style={{display:'flex',gap:6,marginBottom:12}}>
          <Toggle label="y = margin"        active={yMode==='margin'}  color={BDR} onClick={()=>setYMode('margin')} />
          <Toggle label="y = auction share" active={yMode==='auction'} color={BDR} onClick={()=>setYMode('auction')} />
        </div>
        {scLoading?<Spinner/>:scErr?<Err msg={scErr}/>:
          <div style={{height:380}}><ScatterChart data={scatter} yMode={yMode} /></div>
        }
      </Card>

      {/* ── Movers ── */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:24}}>
        <Card title={`Largest profit increases \u00b7 ${MOVERS_WL}`}>
          {mvLoading?<Spinner/>:mvErr?<Err msg={mvErr}/>:<MoversTable rows={increases}/>}
        </Card>
        <Card title={`Largest profit decreases \u00b7 ${MOVERS_WL}`}>
          {mvLoading?<Spinner/>:mvErr?<Err msg={mvErr}/>:<MoversTable rows={decreases}/>}
        </Card>
      </div>
    </div>
  )
}
