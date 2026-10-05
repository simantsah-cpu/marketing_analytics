/**
 * FleetAirportsTab.jsx — Airports tab for Fleet Lifecycle dashboard
 * Uses Chart.js Bubble for scatter; two stacked Lines for trend (no scaled values per brief rule #7).
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Line, Bubble } from 'react-chartjs-2'
import { supabase } from '../services/supabase'

const AS_AT    = '2026-08-01'
const AP_START = '2024-01'
const MUTED    = '#6a7278', TEXT = '#14181b', GRID = '#eceef0', CARD = '#f7f8f9', BDR = '#e3e6e8'
const POS      = '#1f7a5a', NEG = '#b4472f'
const NO_DL    = { datalabels: { display: false } }
const GCFG     = { color: GRID, drawBorder: false }

// ─── Helpers ───────────────────────────────────────────────────────────────────
const nv   = (v) => { const x=v==null?NaN:Number(v); return isFinite(x)?x:0 }
const isNil = (v) => v==null||!isFinite(Number(v))
const fmtInt  = (v) => isNil(v)?'\u2014':Math.round(nv(v)).toLocaleString('en-US')
const fmtPct  = (v,d=1) => isNil(v)?'\u2014':`${(nv(v)*100).toFixed(d)}%`
const fmtF1   = (v) => isNil(v)?'\u2014':nv(v).toFixed(1)

const parseMonth = (s) => { const [y,m]=s.split('-').map(Number); return new Date(y,m-1,1) }
const toDate     = (s) => s?.length===7?`${s}-01`:(s??'2024-01-01')

function fmtProfit(v) {
  if (isNil(v)) return '\u2014'
  const x=nv(v), abs=Math.abs(x)
  if (abs>=1e6) return `$${(x/1e6).toFixed(2)}m`
  if (abs>=1e3) return `$${Math.round(x/1e3).toLocaleString()}k`
  return `$${x.toFixed(2)}`
}
function fmtPPT(v) {
  if (isNil(v)) return '\u2014'
  return `$${nv(v).toFixed(2)}`
}
function DeltaCell({ v }) {
  if (isNil(v)) return <td style={TD}>\u2014</td>
  const pct=(nv(v)*100).toFixed(0), up=nv(v)>=0
  return <td style={{...TD,color:up?POS:NEG}}>{up?'+':''}{pct}%</td>
}

async function fetchAP({ dataset, rangeStart, rangeEnd }) {
  const { data:{ session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fleet-analysis-airports`, {
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${session?.access_token??''}`,apikey:import.meta.env.VITE_SUPABASE_ANON_KEY},
    body:JSON.stringify({ asAtMonth:AS_AT, rangeStart:toDate(rangeStart), rangeEnd:toDate(rangeEnd), dataset }),
  })
  if (!res.ok){let m=`HTTP ${res.status}`;try{const j=await res.json();if(j.error)m=j.error}catch{};throw new Error(m)}
  const j=await res.json(); if(j.error) throw new Error(j.error); return j
}

// ─── UI atoms ──────────────────────────────────────────────────────────────────
function Spinner() {
  return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:80,color:MUTED,gap:8,fontSize:12}}>
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{animation:'ap-spin 1s linear infinite'}}>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
    Loading from BigQuery\u2026<style>{`@keyframes ap-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
  </div>
}
function Err({msg}) {
  return <div style={{padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,color:'#b91c1c',fontSize:11,marginBottom:8}}>\u26a0 {msg}</div>
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

// ─── Table ─────────────────────────────────────────────────────────────────────
const TH  = {fontSize:10,fontWeight:700,color:MUTED,textTransform:'uppercase',letterSpacing:'0.07em',padding:'6px 10px',textAlign:'right',borderBottom:`1.5px solid ${BDR}`,whiteSpace:'nowrap'}
const THL = {...TH,textAlign:'left'}
const TD  = {fontSize:12,color:TEXT,padding:'7px 10px',textAlign:'right',fontVariantNumeric:'tabular-nums',borderBottom:`1px solid ${GRID}`,whiteSpace:'nowrap'}
const TDL = {...TD,textAlign:'left'}
const TR  = ({i,children}) => <tr style={{background:i%2===0?'#fff':CARD}}>{children}</tr>

function SummaryTable({ data }) {
  if (!data?.length) return null
  return <div style={{overflowX:'auto'}}>
    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
      <thead><tr>
        <th style={THL}>Airport</th>
        <th style={TH}>Trips</th>
        <th style={TH}>\u0394% trips</th>
        <th style={TH}>Peak active fleets</th>
        <th style={TH}>Avg fleets/mo</th>
        <th style={TH}>Trips per fleet</th>
        <th style={TH}>Profit</th>
        <th style={TH}>\u0394% profit</th>
        <th style={TH}>Profit / trip</th>
        <th style={TH}>Complaint rate</th>
      </tr></thead>
      <tbody>{data.map((r,i)=><TR key={i} i={i}>
        <td style={TDL}>{r.airport}</td>
        <td style={TD}>{fmtInt(r.trips)}</td>
        <DeltaCell v={r.trips_vs_prior} />
        <td style={TD}>{fmtInt(r.peak_active_fleets)}</td>
        <td style={TD}>{fmtF1(r.avg_active_fleets)}</td>
        <td style={TD}>{fmtInt(r.trips_per_fleet)}</td>
        <td style={TD}>{fmtProfit(r.profit)}</td>
        <DeltaCell v={r.profit_vs_prior} />
        <td style={TD}>{fmtPPT(r.profit_per_trip)}</td>
        <td style={TD}>{fmtPct(r.complaint_rate,2)}</td>
      </TR>)}</tbody>
    </table>
  </div>
}

// ─── Airport trend: upper chart (Trips + Profit dual-Y) ───────────────────────
function TrendUpperChart({ data }) {
  if (!data?.length) return <div style={{height:'100%',display:'flex',alignItems:'center',justifyContent:'center',color:MUTED,fontSize:12}}>No data</div>
  const labels = data.map(d=>d.month_label??'')
  const profitFmt = (v) => {
    const abs=Math.abs(v)
    if (abs>=1e6) return `$${(v/1e6).toFixed(1)}m`
    if (abs>=1e3) return `$${Math.round(v/1e3)}k`
    return `$${v.toFixed(0)}`
  }
  const chartData = { labels, datasets:[
    {label:'Trips',  data:data.map(d=>nv(d.dispatched_trips)), borderColor:'#2f6f9f', borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.3, fill:false, yAxisID:'y'},
    {label:'Profit', data:data.map(d=>nv(d.elife_profit)),     borderColor:'#1f7a5a', borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.3, fill:false, yAxisID:'y2'},
  ]}
  const allData = data
  const opts = { responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
    plugins:{...NO_DL, legend:{display:false},
      tooltip:{callbacks:{
        title:items=>items[0]?.label,
        label:item=>{
          const d=allData[item.dataIndex]
          if (!d) return ''
          return item.datasetIndex===0
            ? `  Trips: ${Math.round(nv(d.dispatched_trips)).toLocaleString()}`
            : `  Profit: ${fmtProfit(d.elife_profit)}`
        },
        afterBody:items=>{
          const d=allData[items[0]?.dataIndex]
          if (!d) return []
          return [`  Active fleets: ${Math.round(nv(d.active_fleets))}`]
        }
      }}},
    scales:{
      x:{display:false},
      y:{type:'linear',position:'left', ticks:{font:{size:10},color:'#2f6f9f',callback:v=>Math.round(v).toLocaleString()},grid:{...GCFG}},
      y2:{type:'linear',position:'right',ticks:{font:{size:10},color:'#1f7a5a',callback:v=>profitFmt(v)},grid:{display:false}},
    }}
  return <Line data={chartData} options={opts} />
}

// ─── Airport trend: lower chart (Active fleets) ───────────────────────────────
function TrendLowerChart({ data }) {
  if (!data?.length) return null
  const labels = data.map(d=>d.month_label??'')
  const chartData = { labels, datasets:[
    {label:'Active fleets', data:data.map(d=>nv(d.active_fleets)), borderColor:'#4a8f7b', borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.3, fill:false},
  ]}
  const allData = data
  const opts = { responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
    plugins:{...NO_DL, legend:{display:false},
      tooltip:{callbacks:{
        title:items=>items[0]?.label,
        label:item=>{
          const d=allData[item.dataIndex]
          if (!d) return ''
          return [
            `  Active fleets: ${Math.round(nv(d.active_fleets))}`,
            `  Trips: ${Math.round(nv(d.dispatched_trips)).toLocaleString()}`,
            `  Profit: ${fmtProfit(d.elife_profit)}`,
          ]
        }
      }}},
    scales:{
      x:{ticks:{font:{size:10},color:MUTED,maxRotation:-45,autoSkip:true,maxTicksLimit:8},grid:GCFG},
      y:{ticks:{font:{size:10},color:'#4a8f7b',callback:v=>Math.round(v)},grid:{...GCFG}},
    }}
  return <Line data={chartData} options={opts} />
}

// ─── Shared trend legend ───────────────────────────────────────────────────────
function TrendLegend() {
  const items = [
    { color:'#2f6f9f', label:'Trips' },
    { color:'#1f7a5a', label:'Profit' },
    { color:'#4a8f7b', label:'Active fleets' },
  ]
  return <div style={{display:'flex',gap:14,justifyContent:'center',marginTop:8}}>
    {items.map(it=><div key={it.label} style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:MUTED}}>
      <div style={{width:12,height:2,background:it.color,flexShrink:0}} />
      {it.label}
    </div>)}
  </div>
}

// ─── Bubble chart: Avg fleets vs profit per trip ───────────────────────────────
// Custom inline plugin to print airport codes above each bubble
const airportLabelPlugin = {
  id: 'airportCodes',
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx
    const meta = chart.getDatasetMeta(0)
    const ds   = chart.data.datasets[0]
    if (!ds || !meta) return
    ctx.save()
    ctx.font = 'bold 9px system-ui,sans-serif'
    ctx.fillStyle = '#4a3f6e'
    ctx.textAlign = 'center'
    meta.data.forEach((pt, i) => {
      const raw   = ds.data[i]
      const label = raw?.label ?? ''
      const r     = pt.options?.radius ?? raw?.r ?? 5
      ctx.fillText(label, pt.x, pt.y - r - 3)
    })
    ctx.restore()
  }
}

function ScatterChart({ data }) {
  if (!data?.length) return null
  const maxTrips = Math.max(...data.map(d=>nv(d.trips)), 1)
  const MAX_R = 28, MIN_R = 5
  const chartData = {
    datasets:[{
      label:'Airports',
      data:data.map(d=>({
        x: nv(d.avg_active_fleets),
        y: nv(d.profit_per_trip),
        r: Math.max(MIN_R, MAX_R * Math.sqrt(nv(d.trips)/maxTrips)),
        label: d.airport,
        trips: d.trips,
        profit: d.profit,
      })),
      backgroundColor:'rgba(122,94,168,0.35)',
      borderColor:'#7a5ea8',
      borderWidth:1.5,
      hoverBackgroundColor:'rgba(122,94,168,0.55)',
    }]
  }
  const minY = Math.min(0, ...data.map(d=>nv(d.profit_per_trip)))
  const opts = { responsive:true, maintainAspectRatio:false, interaction:{mode:'nearest',intersect:true},
    plugins:{
      datalabels:{ display:false },
      legend:{ display:false },
      airportCodes: {},
      tooltip:{callbacks:{
        label:ctx=>{
          const d=ctx.raw
          return [
            `  ${d.label}`,
            `  Trips: ${Math.round(nv(d.trips)).toLocaleString()}`,
            `  Avg fleets/mo: ${nv(ctx.parsed.x).toFixed(1)}`,
            `  Profit: ${fmtProfit(d.profit)}`,
            `  Profit/trip: ${fmtPPT(ctx.parsed.y)}`,
          ]
        },
        title:()=>''
      }}},
    scales:{
      x:{title:{display:true,text:'avg active fleets per month',font:{size:10},color:MUTED},min:0,ticks:{font:{size:10},color:MUTED},grid:GCFG},
      y:{min:minY,ticks:{font:{size:10},color:MUTED,callback:v=>`$${nv(v).toFixed(1)}`},grid:{...GCFG}},
    }}
  return <Bubble data={chartData} options={opts} plugins={[airportLabelPlugin]} />
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function FleetAirportsTab({ range }) {
  const [monthly,      setMonthly]      = useState(null)
  const [mLoading,     setMLoading]     = useState(false)
  const [mErr,         setMErr]         = useState(null)
  const [summary,      setSummary]      = useState(null)
  const [sLoading,     setSLoading]     = useState(false)
  const [sErr,         setSErr]         = useState(null)
  const [dropdown,     setDropdown]     = useState(null)
  const [dLoading,     setDLoading]     = useState(false)
  const [dErr,         setDErr]         = useState(null)
  const [selectedAP,   setSelectedAP]   = useState(null)

  const monthlyFetched  = useRef(false)
  const dropdownFetched = useRef(false)

  // Effective start (clipped at 2024-01)
  const effStart = useMemo(()=> range.fromMonth < AP_START ? AP_START : range.fromMonth,
    [range.fromMonth])

  // Table title window
  const tableTitle = useMemo(()=>
    `Airport \u00d7 fleet \u00b7 ${effStart} \u2192 ${range.toMonth}`,
    [effStart, range.toMonth])

  // Load dropdown once
  useEffect(()=>{
    if (dropdownFetched.current) return; dropdownFetched.current=true
    setDLoading(true); setDErr(null)
    fetchAP({ dataset:'dropdown', rangeStart:'2024-01', rangeEnd:AS_AT.slice(0,7) })
      .then(d=>{
        const dd=d.dropdown??[]
        setDropdown(dd)
        if (dd.length>0 && !selectedAP) setSelectedAP(dd[0].airport)
      })
      .catch(e=>setDErr(e.message))
      .finally(()=>setDLoading(false))
  }, [])

  // Load monthly (all airports, all months) once
  useEffect(()=>{
    if (monthlyFetched.current) return; monthlyFetched.current=true
    setMLoading(true); setMErr(null)
    fetchAP({ dataset:'monthly', rangeStart:'2024-01', rangeEnd:AS_AT.slice(0,7) })
      .then(d=>setMonthly(d.monthly??[]))
      .catch(e=>setMErr(e.message))
      .finally(()=>setMLoading(false))
  }, [])

  // Load summary on range change
  const fetchSummary = useCallback(()=>{
    setSLoading(true); setSErr(null)
    fetchAP({ dataset:'summary', rangeStart:range.fromMonth, rangeEnd:range.toMonth })
      .then(d=>setSummary(d.summary??[]))
      .catch(e=>setSErr(e.message))
      .finally(()=>setSLoading(false))
  }, [range.fromMonth, range.toMonth])
  useEffect(()=>{ fetchSummary() }, [fetchSummary])

  // Filter monthly to selected airport + effective range
  const trendData = useMemo(()=>{
    if (!monthly?.length || !selectedAP) return []
    return monthly.filter(d=>
      d.airport===selectedAP &&
      (d.month_label??'')>=effStart &&
      (d.month_label??'')<=range.toMonth
    )
  }, [monthly, selectedAP, effStart, range.toMonth])

  return (
    <div>
      <SH>Airports</SH>

      {/* ── Summary table ── */}
      <Card title={tableTitle} style={{marginBottom:16}}>
        {sLoading?<Spinner/>:sErr?<Err msg={sErr}/>:<SummaryTable data={summary}/>}
      </Card>

      {/* ── Trend + Scatter side by side ── */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:24}}>

        {/* Airport trend card */}
        <Card title="Airport trend">
          {/* Dropdown */}
          {dLoading ? <Spinner /> : dErr ? <Err msg={dErr} /> : dropdown?.length ? (
            <select
              value={selectedAP??''}
              onChange={e=>setSelectedAP(e.target.value)}
              style={{width:'100%',padding:'5px 8px',fontSize:12,border:`1px solid ${BDR}`,borderRadius:5,background:'#fff',color:TEXT,marginBottom:12,cursor:'pointer'}}
            >
              {dropdown.map(d=><option key={d.airport} value={d.airport}>{d.rank}. {d.airport} ({Math.round(nv(d.trips)).toLocaleString()} trips)</option>)}
            </select>
          ) : null}
          {/* Stacked charts */}
          {mLoading ? <Spinner /> : mErr ? <Err msg={mErr} /> : (
            <>
              <div style={{height:200}}><TrendUpperChart data={trendData} /></div>
              <div style={{height:100,marginTop:2}}><TrendLowerChart data={trendData} /></div>
              <TrendLegend />
            </>
          )}
        </Card>

        {/* Scatter card */}
        <Card title="Supply depth vs profit per trip">
          {sLoading ? <Spinner /> : sErr ? <Err msg={sErr} /> :
            summary?.length ? <div style={{height:340}}><ScatterChart data={summary} /></div>
            : <div style={{height:340,display:'flex',alignItems:'center',justifyContent:'center',color:MUTED,fontSize:12}}>No data</div>
          }
        </Card>
      </div>
    </div>
  )
}
