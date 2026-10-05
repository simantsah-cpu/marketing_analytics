/**
 * FleetAnalysis.jsx — Fleet Lifecycle Dashboard · Supply Tab
 * Orbit Analytics | BigQuery live data via Supabase Edge Function
 *
 * v2: KPIs above tabs, underline-style tabs, no point datalabels,
 *     fixed hook violation, correct y-axis formatting.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, PointElement,
  LineElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import { supabase } from '../services/supabase'
import FleetOVDTab from './FleetOVDTab'
import FleetDriversTab from './FleetDriversTab'
import FleetComplaintsTab from './FleetComplaintsTab'
import FleetAirportsTab from './FleetAirportsTab'
import FleetCohortsTab from './FleetCohortsTab'
import FleetPerformanceTab from './FleetPerformanceTab'
import FleetGeographyTab from './FleetGeographyTab'

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend, Filler)

// ─── Constants ────────────────────────────────────────────────────────────────
const AS_AT_MONTH = '2026-08-01'
const DATA_START  = '2023-01-01'

// Spec colours
const C = {
  started:     '#2f6f9f',
  returned:    '#4a8f7b',
  stopped:     '#b4472f',
  net:         '#14181b',
  activeFleet: '#2f6f9f',
  profitFleet: '#7a5ea8',
  elifeRev:    '#2f6f9f',
  fleetRev:    '#c98a2b',
  elifeProfit: '#1f7a5a',
  lifecycle:   ['#1f7a5a','#4a8f7b','#c98a2b','#c98a2b','#b4472f'],
  pos:         '#1f7a5a',
  neg:         '#b4472f',
}

const MUTED = '#6a7278'
const TEXT  = '#14181b'
const GRID  = '#eceef0'
const CARD  = '#f7f8f9'
const BDR   = '#e3e6e8'

// ─── Formatters ───────────────────────────────────────────────────────────────
const n = (v) => { const x = v == null ? NaN : Number(v); return isFinite(x) ? x : 0 }
const isNull = (v) => v == null || !isFinite(Number(v))

const fmtInt    = (v) => isNull(v) ? '—' : Math.round(n(v)).toLocaleString('en-US')
const fmtNet    = (v) => { if (isNull(v)) return '—'; const x = Math.round(n(v)); return (x >= 0 ? '+' : '') + x.toLocaleString('en-US') }
const fmtUSD    = (v) => { if (isNull(v)) return '—'; const x=n(v), a=Math.abs(x), s=x<0?'-$':'$'; if(a>=1e6) return `${s}${(a/1e6).toFixed(2)}m`; if(a>=1e3) return `${s}${Math.round(a/1e3)}k`; return `${s}${Math.round(a)}` }
const fmtUSDInt = (v) => { if (isNull(v)) return '—'; const x=n(v), s=x<0?'-$':'$'; return `${s}${Math.round(Math.abs(x)).toLocaleString('en-US')}` }
const fmtPct    = (v, d=2) => isNull(v) ? '—' : `${(n(v)*100).toFixed(d)}%`
const fmtDelta  = (v) => isNull(v) ? null : `${(Math.abs(n(v))*100).toFixed(1)}%`

// ─── Date helpers ─────────────────────────────────────────────────────────────
const parseMonth = (s) => { const [y,m]=s.split('-').map(Number); return new Date(y,m-1,1) }
const toYYYYMM   = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`

function allMonthsList() {
  const out=[]; let cur=parseMonth(DATA_START); const end=parseMonth(AS_AT_MONTH)
  while(cur<=end){ out.push(toYYYYMM(cur)); cur=new Date(cur.getFullYear(),cur.getMonth()+1,1) }
  return out
}
const ALL_MONTHS = allMonthsList()

function calcMonthDiff(from, to) {
  try {
    const s=parseMonth(from), e=parseMonth(to)
    return (e.getFullYear()-s.getFullYear())*12 + (e.getMonth()-s.getMonth()) + 1
  } catch { return '?' }
}

function calcPreset(preset) {
  const endD = parseMonth(AS_AT_MONTH)
  const end  = toYYYYMM(endD)
  if (preset==='3m')  { return { start: toYYYYMM(new Date(endD.getFullYear(), endD.getMonth()-2,  1)), end } }
  if (preset==='6m')  { return { start: toYYYYMM(new Date(endD.getFullYear(), endD.getMonth()-5,  1)), end } }
  if (preset==='12m') { return { start: toYYYYMM(new Date(endD.getFullYear(), endD.getMonth()-11, 1)), end } }
  if (preset==='24m') { return { start: toYYYYMM(new Date(endD.getFullYear(), endD.getMonth()-23, 1)), end } }
  if (preset==='ytd') { return { start: `${endD.getFullYear()}-01`, end } }
  if (preset==='all') { return { start: toYYYYMM(parseMonth(DATA_START)), end } }
  return { start: end, end }
}

function asAtLabel() {
  return parseMonth(AS_AT_MONTH).toLocaleDateString('en-US', { month:'short', year:'numeric' })
}

// ─── Supabase / BigQuery caller ───────────────────────────────────────────────
async function fetchFleet({ asAtMonth, rangeStart, rangeEnd, dataset='all' }) {
  const { data:{ session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fleet-analysis`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ asAtMonth, rangeStart, rangeEnd, dataset }),
  })
  if (!res.ok) {
    let msg = `fleet-analysis: HTTP ${res.status}`
    try { const j=await res.json(); if(j.error) msg=j.error } catch{}
    throw new Error(msg)
  }
  const j = await res.json()
  if (j.error) throw new Error(j.error)
  return j
}

// ─── Disable datalabels globally for this page's charts ───────────────────────
// (ChartDataLabels may be registered globally by other pages)
const NO_DATALABELS = { datalabels: { display: false } }

// ─── Chart shared grid config ─────────────────────────────────────────────────
const gridCfg = (count=5) => ({ color: GRID, drawBorder: false, count })

// ─── KPI Tile ─────────────────────────────────────────────────────────────────
function KpiTile({ label, value, deltaRaw, nMonths, positiveIsGood=true }) {
  const delta = fmtDelta(deltaRaw)
  const dir   = deltaRaw == null || !isFinite(n(deltaRaw)) ? null : n(deltaRaw) >= 0 ? 'up' : 'down'
  const good  = dir === null ? null : (positiveIsGood ? dir==='up' : dir==='down')
  const dc    = good===null ? MUTED : good ? C.pos : C.neg
  const arrow = dir==='up' ? '▲' : dir==='down' ? '▼' : ''

  return (
    <div style={{
      background: CARD, border:`1px solid ${BDR}`, borderRadius:8,
      padding:'14px 16px', minWidth:148, flex:'1 1 148px',
      display:'flex', flexDirection:'column', gap:4,
    }}>
      <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.08em', color:MUTED, textTransform:'uppercase' }}>{label}</div>
      <div style={{ fontSize:24, fontWeight:700, color:TEXT, fontVariantNumeric:'tabular-nums', lineHeight:1.15 }}>{value}</div>
      <div style={{ fontSize:11, color: delta ? dc : 'transparent', fontVariantNumeric:'tabular-nums', minHeight:16 }}>
        {delta ? `${arrow} ${delta} vs prior ${nMonths}m` : '·'}
      </div>
    </div>
  )
}

// ─── Section Heading ──────────────────────────────────────────────────────────
function SectionHeading({ children }) {
  return (
    <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.12em', color:MUTED, textTransform:'uppercase', margin:'20px 0 10px' }}>
      {children}
    </div>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────
function Card({ title, children, style={} }) {
  return (
    <div style={{ background:CARD, border:`1px solid ${BDR}`, borderRadius:8, padding:'16px 18px 18px', ...style }}>
      {title && <div style={{ fontSize:12, fontWeight:700, color:TEXT, marginBottom:14 }}>{title}</div>}
      {children}
    </div>
  )
}

// ─── Spinner / Error ──────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:100, color:MUTED, gap:8, fontSize:12 }}>
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{animation:'fla-spin 1s linear infinite'}}>
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
      </svg>
      Loading from BigQuery…
      <style>{`@keyframes fla-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
function ErrMsg({ msg }) {
  return (
    <div style={{ padding:'12px 16px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, color:'#b91c1c', fontSize:12, marginBottom:12 }}>
      ⚠ {msg}
    </div>
  )
}

// ─── Supply bar+line chart ────────────────────────────────────────────────────
function SupplyChart({ data }) {
  const labels = data.map(d => d.month_label ?? d.month_start?.slice(0,7) ?? '')

  const chartData = {
    labels,
    datasets: [
      {
        label: 'Started',
        data: data.map(d => n(d.started)),
        backgroundColor: C.started,
        stack: 'stack',
        order: 2,
        borderRadius: 2,
      },
      {
        label: 'Returned',
        data: data.map(d => n(d.returned)),
        backgroundColor: C.returned,
        stack: 'stack',
        order: 2,
        borderRadius: 2,
      },
      {
        label: 'Stopped',
        data: data.map(d => -Math.abs(n(d.stopped))),
        backgroundColor: C.stopped,
        stack: 'stack',
        order: 2,
        borderRadius: 2,
      },
      {
        label: 'Net',
        data: data.map(d => n(d.net_fleets)),
        type: 'line',
        borderColor: C.net,
        borderWidth: 1.6,
        pointRadius: 2,
        pointHoverRadius: 4,
        tension: 0.3,
        order: 1,
        yAxisID: 'y',
      },
    ],
  }

  const opts = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode:'index', intersect:false },
    plugins: {
      ...NO_DATALABELS,
      legend: {
        display: true,
        position: 'bottom',
        labels: { font:{size:11}, color:MUTED, boxWidth:12, padding:14 },
      },
      tooltip: {
        callbacks: {
          title: (items) => items[0]?.label,
          label: (item) => `  ${item.dataset.label}: ${Math.abs(item.raw).toLocaleString('en-US')}`,
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        ticks: { font:{size:10}, color:MUTED, maxRotation:-45, minRotation:-45, autoSkip: labels.length > 14, maxTicksLimit: 14 },
        grid: gridCfg(),
      },
      y: {
        stacked: true,
        ticks: { font:{size:11}, color:MUTED, callback:(v)=>Math.round(v).toLocaleString() },
        grid: gridCfg(5),
      },
    },
  }
  return <Bar data={chartData} options={opts} />
}

// ─── Active Fleets line chart ─────────────────────────────────────────────────
function ActiveFleetsChart({ rangeData }) {
  const labels = rangeData.map(d => d.month_label ?? d.month_start?.slice(0,7) ?? '')
  const chartData = {
    labels,
    datasets: [{
      label: 'Active fleets',
      data: rangeData.map(d => n(d.active_fleets)),
      borderColor: C.activeFleet,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.3,
      fill: false,
    }],
  }
  const opts = {
    responsive:true, maintainAspectRatio:false,
    interaction:{ mode:'index', intersect:false },
    plugins: {
      ...NO_DATALABELS,
      legend:{ display:false },
      tooltip:{
        callbacks:{
          title:(items)=>items[0]?.label,
          label:(item)=>`  Active fleets: ${Math.round(item.raw).toLocaleString()}`,
        },
      },
    },
    scales:{
      x:{ ticks:{font:{size:10},color:MUTED,maxRotation:-45,autoSkip:true,maxTicksLimit:8}, grid:gridCfg() },
      y:{ ticks:{font:{size:11},color:MUTED,callback:(v)=>Math.round(v).toLocaleString()}, grid:gridCfg(5) },
    },
  }
  return <Line data={chartData} options={opts} />
}

// ─── Profit per active fleet chart ───────────────────────────────────────────
function ProfitPerFleetChart({ rangeData }) {
  const labels = rangeData.map(d => d.month_label ?? d.month_start?.slice(0,7) ?? '')
  const vals   = rangeData.map(d => n(d.profit_per_active_fleet))
  const chartData = {
    labels,
    datasets: [{
      label: 'Profit / active fleet',
      data: vals,
      borderColor: C.profitFleet,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.3,
      fill: false,
    }],
  }
  const opts = {
    responsive:true, maintainAspectRatio:false,
    interaction:{ mode:'index', intersect:false },
    plugins:{
      ...NO_DATALABELS,
      legend:{ display:false },
      tooltip:{
        callbacks:{
          title:(items)=>items[0]?.label,
          label:(item)=>`  ${fmtUSDInt(item.raw)}`,
        },
      },
    },
    scales:{
      x:{ ticks:{font:{size:10},color:MUTED,maxRotation:-45,autoSkip:true,maxTicksLimit:8}, grid:gridCfg() },
      y:{ ticks:{font:{size:11},color:MUTED,callback:(v)=>`$${Math.round(v/1000)*1000===v?Math.round(v/1000)+'k':Math.round(v)}`}, grid:gridCfg(5) },
    },
  }
  return <Line data={chartData} options={opts} />
}

// ─── Revenue 3-line chart ─────────────────────────────────────────────────────
function RevenueChart({ rangeData }) {
  const labels = rangeData.map(d => d.month_label ?? d.month_start?.slice(0,7) ?? '')
  // y-axis formatter: $X.Xm / $Xk
  const yFmt = (v) => {
    const a=Math.abs(v), s=v<0?'-$':'$'
    if(a>=1e6) return `${s}${(a/1e6).toFixed(1)}m`
    if(a>=1e3) return `${s}${(a/1e3).toFixed(0)}k`
    return `${s}${Math.round(a)}`
  }

  const chartData = {
    labels,
    datasets:[
      { label:'Elife revenue', data:rangeData.map(d=>n(d.elife_revenue)), borderColor:C.elifeRev,    borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.3, fill:false },
      { label:'Fleet revenue', data:rangeData.map(d=>n(d.fleet_revenue)), borderColor:C.fleetRev,    borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.3, fill:false },
      { label:'Profit',        data:rangeData.map(d=>n(d.elife_profit)),  borderColor:C.elifeProfit, borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.3, fill:false },
    ],
  }
  const opts = {
    responsive:true, maintainAspectRatio:false,
    interaction:{ mode:'index', intersect:false },
    plugins:{
      ...NO_DATALABELS,
      legend:{
        display:true, position:'bottom',
        labels:{ font:{size:11}, color:MUTED, boxWidth:12, padding:14 },
      },
      tooltip:{
        callbacks:{
          title:(items)=>items[0]?.label,
          label:(item)=>`  ${item.dataset.label}: ${fmtUSD(item.raw)}`,
        },
      },
    },
    scales:{
      x:{ ticks:{font:{size:10},color:MUTED,maxRotation:-45,autoSkip:true,maxTicksLimit:8}, grid:gridCfg() },
      y:{ ticks:{font:{size:11},color:MUTED,callback:yFmt}, grid:gridCfg(5) },
    },
  }
  return <Line data={chartData} options={opts} />
}

// ─── Lifecycle State horizontal bars ─────────────────────────────────────────
function LifecycleChart({ data }) {
  if (!data?.length) return null
  const total  = data.reduce((s,r) => s + n(r.fleets), 0)
  const maxVal = Math.max(...data.map(r => n(r.fleets)), 1)

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, marginTop:4 }}>
      {data.map((row, i) => {
        const fleets = n(row.fleets)
        const pct    = total > 0 ? (fleets/total*100).toFixed(1) : '0.0'
        const barW   = (fleets/maxVal*100).toFixed(1)
        return (
          <div key={row.sort_order ?? i} style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:140, fontSize:11, color:MUTED, textAlign:'right', flexShrink:0, lineHeight:1.3 }}>
              {row.lifecycle_state}
            </div>
            <div style={{ flex:1, height:22, background:'#eceef0', borderRadius:4, overflow:'hidden' }}>
              <div style={{
                width:`${barW}%`, height:'100%',
                background: C.lifecycle[i] ?? '#888',
                borderRadius:4,
                transition:'width 0.5s ease',
              }} />
            </div>
            <div style={{ width:100, fontSize:11, color:TEXT, fontVariantNumeric:'tabular-nums', flexShrink:0 }}>
              {Math.round(fleets).toLocaleString()} · {pct}%
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Range Control ────────────────────────────────────────────────────────────
const PRESETS = ['3m','6m','12m','24m','ytd','all']

function RangeControl({ fromMonth, toMonth, preset, onChange, nMonths }) {
  const sel = { border:`1px solid ${BDR}`, borderRadius:6, padding:'5px 8px', fontSize:11, fontFamily:'inherit', background:'#fff', color:TEXT, cursor:'pointer', outline:'none' }

  const handlePreset = (p) => {
    const { start, end } = calcPreset(p)
    onChange({ fromMonth:start, toMonth:end, preset:p })
  }
  const handleFrom = (v) => {
    onChange({ fromMonth:v, toMonth: v > toMonth ? v : toMonth, preset:null })
  }
  const handleTo = (v) => {
    onChange({ fromMonth: v < fromMonth ? v : fromMonth, toMonth:v, preset:null })
  }

  return (
    <div style={{
      display:'flex', alignItems:'center', gap:10, padding:'10px 0 12px',
      borderBottom:`1px solid ${BDR}`, marginBottom:16, flexWrap:'wrap',
      position:'sticky', top:0, background:'#fff', zIndex:20,
    }}>
      <span style={{ fontSize:10, fontWeight:700, letterSpacing:'0.1em', color:MUTED, textTransform:'uppercase' }}>Range</span>
      <select value={fromMonth} onChange={e=>handleFrom(e.target.value)} style={sel}>
        {ALL_MONTHS.map(m=><option key={m} value={m}>{m}</option>)}
      </select>
      <span style={{ color:MUTED, fontSize:11 }}>to</span>
      <select value={toMonth} onChange={e=>handleTo(e.target.value)} style={sel}>
        {ALL_MONTHS.map(m=><option key={m} value={m}>{m}</option>)}
      </select>
      <div style={{ display:'flex', gap:3 }}>
        {PRESETS.map(p => {
          const active = preset === p
          return (
            <button key={p} onClick={()=>handlePreset(p)} style={{
              padding:'4px 10px', borderRadius:6, fontSize:11, fontWeight:active?700:600,
              fontFamily:'inherit', cursor:'pointer', transition:'all 0.12s',
              background: active ? '#14181b' : 'transparent',
              color:      active ? '#fff'     : TEXT,
              border:     active ? '1.5px solid #14181b' : `1.5px solid ${BDR}`,
            }}>
              {p === 'ytd' ? 'YTD' : p === 'all' ? 'All' : p.toUpperCase()}
            </button>
          )
        })}
      </div>
      <span style={{ fontSize:11, color:MUTED, fontVariantNumeric:'tabular-nums' }}>
        {fromMonth} → {toMonth}&nbsp; ({nMonths} months)
      </span>
    </div>
  )
}

// ─── Fleet Lifecycle tab bar ──────────────────────────────────────────────────
const FLEET_TABS = [
  { id:'supply',              label:'Supply' },
  { id:'offered-vs-delivered',label:'Offered vs delivered' },
  { id:'drivers',             label:'Drivers' },
  { id:'complaints',          label:'Complaints' },
  { id:'airports',            label:'Airports' },
  { id:'cohorts',             label:'Cohorts' },
  { id:'performance',         label:'Performance' },
  { id:'geography',           label:'Geography' },
]

// ─── Main component ───────────────────────────────────────────────────────────
export default function FleetAnalysis() {
  // Range state — default 12m
  const [range, setRange] = useState(() => {
    const { start, end } = calcPreset('12m')
    return { fromMonth: start, toMonth: end, preset: '12m' }
  })
  const [tab, setTab] = useState('supply')

  // Data state
  const [monthly,   setMonthly]   = useState(null)
  const [kpis,      setKpis]      = useState(null)
  const [lifecycle, setLifecycle] = useState(null)

  // Loading / error state
  const [mLoading,  setMLoading]  = useState(false)
  const [kLoading,  setKLoading]  = useState(false)
  const [lLoading,  setLLoading]  = useState(false)
  const [mErr,      setMErr]      = useState(null)
  const [kErr,      setKErr]      = useState(null)
  const [lErr,      setLErr]      = useState(null)

  // Dataset 1 (monthly) — load once, covers full date range 2023-01 → as_at
  const monthlyFetched = useRef(false)
  useEffect(() => {
    if (monthlyFetched.current) return
    monthlyFetched.current = true
    setMLoading(true); setMErr(null)
    fetchFleet({ asAtMonth:AS_AT_MONTH, rangeStart:'2023-01', rangeEnd:AS_AT_MONTH.slice(0,7), dataset:'monthly' })
      .then(d => setMonthly(d.monthly ?? []))
      .catch(e => setMErr(e.message))
      .finally(() => setMLoading(false))
  }, [])

  // Dataset 3 (lifecycle) — load once, not range-filtered
  const lifecycleFetched = useRef(false)
  useEffect(() => {
    if (lifecycleFetched.current) return
    lifecycleFetched.current = true
    setLLoading(true); setLErr(null)
    fetchFleet({ asAtMonth:AS_AT_MONTH, rangeStart:'2023-01', rangeEnd:AS_AT_MONTH.slice(0,7), dataset:'lifecycle' })
      .then(d => setLifecycle(d.lifecycle ?? []))
      .catch(e => setLErr(e.message))
      .finally(() => setLLoading(false))
  }, [])

  // Dataset 2 (kpis) — reload on range change
  const fetchKpis = useCallback(() => {
    setKLoading(true); setKErr(null)
    fetchFleet({ asAtMonth:AS_AT_MONTH, rangeStart:range.fromMonth, rangeEnd:range.toMonth, dataset:'kpis' })
      .then(d => setKpis(d.kpis ?? null))
      .catch(e => setKErr(e.message))
      .finally(() => setKLoading(false))
  }, [range.fromMonth, range.toMonth])

  useEffect(() => { fetchKpis() }, [fetchKpis])

  // Derived data for charts — filter monthly to range
  const rangeData = useMemo(() => {
    if (!monthly?.length) return []
    return monthly.filter(d => {
      const m = d.month_label ?? d.month_start?.slice(0,7)
      return m >= range.fromMonth && m <= range.toMonth
    })
  }, [monthly, range.fromMonth, range.toMonth])

  // Supply data only where stopped is not null
  const supplyData = useMemo(() => rangeData.filter(d => d.stopped != null), [rangeData])

  // n_months — prefer backend value, fallback to client calc (no hook violation)
  const nMonths = useMemo(() => {
    if (kpis?.n_months != null) return kpis.n_months
    return calcMonthDiff(range.fromMonth, range.toMonth)
  }, [kpis?.n_months, range.fromMonth, range.toMonth])

  // ── Tab underline style ───────────────────────────────────────────────────
  const tabStyle = (id, disabled) => ({
    padding: '8px 0',
    marginRight: 20,
    border: 'none',
    borderBottom: !disabled && tab===id ? '2.5px solid #14181b' : '2.5px solid transparent',
    background: 'transparent',
    color: disabled ? '#c4cad0' : tab===id ? TEXT : MUTED,
    fontSize: 13,
    fontWeight: tab===id ? 700 : 500,
    fontFamily: 'inherit',
    cursor: disabled ? 'default' : 'pointer',
    transition: 'all 0.12s',
    whiteSpace: 'nowrap',
  })

  return (
    <div style={{ padding:'24px 28px 40px', maxWidth:1520, fontFamily:'system-ui,-apple-system,sans-serif', color:TEXT }}>

      {/* ── Header ── */}
      <h1 style={{ fontSize:22, fontWeight:800, letterSpacing:'-0.02em', margin:'0 0 20px' }}>Fleet Lifecycle</h1>

      {/* ── Range control (sticky) ── */}
      <RangeControl
        fromMonth={range.fromMonth}
        toMonth={range.toMonth}
        preset={range.preset}
        nMonths={nMonths}
        onChange={setRange}
      />

      {/* ── KPI Tiles — first 6 then 4 ── */}
      {kErr && <ErrMsg msg={kErr} />}
      {kLoading ? (
        <Spinner />
      ) : kpis ? (
        <>
          {/* Row 1: 6 tiles */}
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:8 }}>
            <KpiTile label="Active fleets (end)"  value={fmtInt(kpis.active_end)}      deltaRaw={kpis.active_end_vs_prior}  nMonths={nMonths} />
            <KpiTile label="Started"              value={fmtInt(kpis.started)}          deltaRaw={kpis.started_vs_prior}     nMonths={nMonths} />
            <KpiTile label="Returned"             value={fmtInt(kpis.returned)}         deltaRaw={null}                      nMonths={nMonths} />
            <KpiTile label="Stopped"              value={fmtInt(kpis.stopped)}          deltaRaw={kpis.stopped_vs_prior}     nMonths={nMonths} positiveIsGood={false} />
            <KpiTile label="Net fleets"           value={fmtNet(kpis.net_fleets)}       deltaRaw={null}                      nMonths={nMonths} />
            <KpiTile label="Dispatched trips"     value={fmtInt(kpis.dispatched)}       deltaRaw={kpis.dispatched_vs_prior}  nMonths={nMonths} />
          </div>
          {/* Row 2: 4 tiles */}
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:20 }}>
            <KpiTile label="Elife profit"         value={fmtUSD(kpis.elife_profit)}         deltaRaw={kpis.profit_vs_prior}  nMonths={nMonths} />
            <KpiTile label="Margin"               value={fmtPct(kpis.margin)}                deltaRaw={kpis.margin_vs_prior}  nMonths={nMonths} />
            <KpiTile label="Profit / active fleet" value={fmtUSDInt(kpis.profit_per_active_fleet)} deltaRaw={null}             nMonths={nMonths} />
            <KpiTile label="Complaint rate"       value={fmtPct(kpis.complaint_rate)}        deltaRaw={null}                  nMonths={nMonths} positiveIsGood={false} />
          </div>
        </>
      ) : !kErr ? (
        <div style={{ height:120 }} />
      ) : null}

      {/* ── Tab bar — BELOW KPIs ── */}
      <div style={{ display:'flex', borderBottom:`1.5px solid ${BDR}`, marginBottom:20, overflowX:'auto' }}>
        {FLEET_TABS.map(t => (
          <button key={t.id} onClick={() => !t.disabled && setTab(t.id)} style={tabStyle(t.id, t.disabled)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Supply Tab content ── */}
      {tab === 'supply' && (
        <>
          <SectionHeading>Supply Base</SectionHeading>

          {/* Started · Returned · Stopped */}
          <Card title="Started · returned · stopped" style={{ marginBottom:16 }}>
            {mLoading ? <Spinner /> : mErr ? <ErrMsg msg={mErr} /> : (
              <div style={{ height:300 }}>
                <SupplyChart data={supplyData} />
              </div>
            )}
          </Card>

          {/* Active fleets + Profit per fleet */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 }}>
            <Card title="Active fleets">
              {mLoading ? <Spinner /> : mErr ? <ErrMsg msg={mErr} /> : (
                <div style={{ height:230 }}>
                  <ActiveFleetsChart rangeData={rangeData} />
                </div>
              )}
            </Card>
            <Card title="Profit per active fleet · USD">
              {mLoading ? <Spinner /> : mErr ? <ErrMsg msg={mErr} /> : (
                <div style={{ height:230 }}>
                  <ProfitPerFleetChart rangeData={rangeData} />
                </div>
              )}
            </Card>
          </div>

          {/* Revenue + Lifecycle */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:24 }}>
            <Card title="Elife revenue · fleet revenue · profit">
              {mLoading ? <Spinner /> : mErr ? <ErrMsg msg={mErr} /> : (
                <div style={{ height:270 }}>
                  <RevenueChart rangeData={rangeData} />
                </div>
              )}
            </Card>
            <Card title={`Lifecycle state · as at ${asAtLabel()}`}>
              {lLoading ? <Spinner /> : lErr ? <ErrMsg msg={lErr} /> : (
                <LifecycleChart data={lifecycle} />
              )}
            </Card>
          </div>
        </>
      )}

      {tab === 'offered-vs-delivered' && (
        <FleetOVDTab range={range} nMonths={nMonths} />
      )}

      {tab === 'drivers' && (
        <FleetDriversTab range={range} nMonths={nMonths} />
      )}

      {tab === 'complaints' && (
        <FleetComplaintsTab range={range} nMonths={nMonths} />
      )}

      {tab === 'airports' && (
        <FleetAirportsTab range={range} nMonths={nMonths} />
      )}

      {tab === 'cohorts' && (
        <FleetCohortsTab range={range} nMonths={nMonths} />
      )}

      {tab === 'performance' && (
        <FleetPerformanceTab range={range} nMonths={nMonths} />
      )}

      {tab === 'geography' && (
        <FleetGeographyTab range={range} nMonths={nMonths} />
      )}

      {tab !== 'supply' && tab !== 'offered-vs-delivered' && tab !== 'drivers' && tab !== 'complaints' && tab !== 'airports' && tab !== 'cohorts' && tab !== 'performance' && tab !== 'geography' && (
        <div style={{ padding:'60px 0', textAlign:'center', color:MUTED, fontSize:13 }}>
          This tab is coming soon.
        </div>
      )}
    </div>
  )
}
