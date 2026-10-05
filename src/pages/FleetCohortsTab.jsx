/**
 * FleetCohortsTab.jsx — Cohorts tab for Fleet Lifecycle dashboard
 * - Two full-width heatmap grids (retention %, profit per surviving fleet)
 * - Retention index line chart (first 6 cohorts in range)
 * - Signup → activation table
 */
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import { supabase } from '../services/supabase'

const AS_AT = '2026-08-01'
const MUTED = '#6a7278', TEXT = '#14181b', GRID = '#eceef0', CARD = '#f7f8f9', BDR = '#e3e6e8'
const INDEX_COLORS = ['#2f6f9f','#c98a2b','#7a5ea8','#4a8f7b','#b4472f','#1f7a5a']
const NO_DL = { datalabels:{ display:false } }
const GCFG  = { color:GRID, drawBorder:false }

// ─── Helpers ───────────────────────────────────────────────────────────────────
const nv    = (v) => { const x=v==null?NaN:Number(v); return isFinite(x)?x:0 }
const isNil = (v) => v==null||!isFinite(Number(v))
const fmtInt  = (v) => isNil(v)?'\u2014':Math.round(nv(v)).toLocaleString('en-US')
const fmtPct  = (v,d=1) => isNil(v)?'\u2014':`${(nv(v)*100).toFixed(d)}%`
const fmtPct0 = (v) => isNil(v)?'\u2014':`${Math.round(nv(v)*100)}%`
const fmtF1   = (v) => isNil(v)?'\u2014':nv(v).toFixed(1)
const isObs   = (cell) => cell && (cell.observable===true || cell.observable==='true')

function fmtCohortProfit(v) {
  if (isNil(v)) return '\u2014'
  const x=nv(v), abs=Math.abs(x)
  if (abs>=1e6) return `$${(x/1e6).toFixed(2)}m`
  if (abs>=1e3) return `$${Math.round(x/1e3)}k`
  return `$${Math.round(x)}`
}

function truncToQuarter(yyyymm) {
  if (!yyyymm) return '2023-01-01'
  const [y,m] = yyyymm.split('-').map(Number)
  const qm = Math.floor((m-1)/3)*3+1
  return `${y}-${String(qm).padStart(2,'0')}-01`
}

async function fetchCoh(dataset) {
  const { data:{ session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fleet-analysis-cohorts`, {
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${session?.access_token??''}`,apikey:import.meta.env.VITE_SUPABASE_ANON_KEY},
    body:JSON.stringify({ asAtMonth:AS_AT, dataset }),
  })
  if (!res.ok){let m=`HTTP ${res.status}`;try{const j=await res.json();if(j.error)m=j.error}catch{};throw new Error(m)}
  const j=await res.json(); if(j.error) throw new Error(j.error); return j
}

// ─── Colour functions ─────────────────────────────────────────────────────────
function retentionBg(retention) {
  const t = Math.max(0, Math.min(1, (nv(retention) - 0.15) / 0.85))
  return { bg:`rgba(47,111,159,${(0.06+0.78*t).toFixed(3)})`, white: t > 0.62 }
}
function profitBg(v) {
  const t = Math.max(0, Math.min(1, (nv(v) - 100) / 800))
  return { bg:`rgba(74,143,123,${(0.06+0.78*t).toFixed(3)})`, white: t > 0.62 }
}

// ─── UI atoms ─────────────────────────────────────────────────────────────────
function Spinner() {
  return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:80,color:MUTED,gap:8,fontSize:12}}>
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{animation:'coh-spin 1s linear infinite'}}>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
    Loading from BigQuery\u2026<style>{`@keyframes coh-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
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

// ─── Shared heatmap grid ───────────────────────────────────────────────────────
const KS = [...Array(13)].map((_,k)=>k) // 0..12

function HeatmapGrid({ cellMap, cohorts, getColor, getText, getTooltip }) {
  const TH_CELL = {fontSize:10,fontWeight:700,color:MUTED,padding:'4px 6px',textAlign:'center',borderBottom:`1.5px solid ${BDR}`,whiteSpace:'nowrap'}
  if (!cohorts.length) return <div style={{color:MUTED,fontSize:12,padding:'20px 0'}}>No cohorts in range.</div>
  return (
    <div style={{overflowX:'auto'}}>
      <table style={{borderCollapse:'separate',borderSpacing:'2px 2px',fontSize:11}}>
        <thead>
          <tr>
            <th style={{...TH_CELL,textAlign:'left',minWidth:72}}>Cohort</th>
            {KS.map(k=><th key={k} style={TH_CELL}>k{k}</th>)}
            <th style={{...TH_CELL,minWidth:44}}>n</th>
          </tr>
        </thead>
        <tbody>
          {cohorts.map(coh => {
            const k0 = cellMap[`${coh}:0`]
            return (
              <tr key={coh}>
                <td style={{fontSize:11,fontWeight:600,color:MUTED,padding:'0 8px 0 0',whiteSpace:'nowrap',verticalAlign:'middle'}}>{coh}</td>
                {KS.map(k => {
                  const cell = cellMap[`${coh}:${k}`]
                  if (!isObs(cell)) return <td key={k} style={{width:44,height:26,borderRadius:'3px'}} />
                  const { bg, white } = getColor(cell)
                  return (
                    <td key={k} title={getTooltip(cell, k)}
                      style={{background:bg,color:white?'#fff':TEXT,textAlign:'center',borderRadius:'3px',
                        width:44,minWidth:44,height:26,padding:'3px 2px',
                        fontVariantNumeric:'tabular-nums',cursor:'default',fontSize:11,verticalAlign:'middle'}}>
                      {getText(cell)}
                    </td>
                  )
                })}
                <td style={{textAlign:'right',padding:'0 4px 0 8px',fontSize:11,color:MUTED,fontVariantNumeric:'tabular-nums',verticalAlign:'middle'}}>
                  {fmtInt(k0?.cohort_size)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Retention index chart ────────────────────────────────────────────────────
const X_LABELS = [...Array(13)].map((_,k)=>`k${k}`) // k0..k12

function RetentionIndexChart({ cellMap, cohorts }) {
  const first6 = cohorts.slice(0,6)
  const datasets = first6.map((coh,i) => ({
    label: coh,
    data: [...Array(13)].map((_,k) => {
      if (k===0) return null
      const cell = cellMap[`${coh}:${k}`]
      return isObs(cell) ? nv(cell.retention_index) : null
    }),
    borderColor: INDEX_COLORS[i],
    borderWidth: 2,
    pointRadius: 3,
    pointHoverRadius: 5,
    tension: 0,
    fill: false,
    spanGaps: false,
  }))
  const chartData = { labels: X_LABELS, datasets }
  const opts = {
    responsive:true, maintainAspectRatio:false,
    interaction:{mode:'index',intersect:false},
    plugins:{
      ...NO_DL,
      legend:{display:true,position:'bottom',labels:{font:{size:11},color:MUTED,boxWidth:12,padding:14}},
      tooltip:{callbacks:{
        title: items => items[0]?.label,
        label: item => {
          const coh = item.dataset.label
          const k   = item.dataIndex
          const cell = cellMap[`${coh}:${k}`]
          if (!cell) return `  ${coh}: —`
          return [
            `  ${coh} · k${k}`,
            `  Index: ${nv(item.raw).toFixed(0)}`,
            `  Fleets active: ${Math.round(nv(cell.fleets_active)).toLocaleString()}`,
          ]
        },
      }},
    },
    scales:{
      x:{ ticks:{ font:{size:10},color:MUTED, callback:(v,i)=>i%2===0?X_LABELS[i]:'' }, grid:GCFG },
      y:{ min:0, max:105,
        ticks:{ font:{size:11},color:MUTED, stepSize:25, callback:v=>`${v}` },
        grid:{ ...GCFG, color:(ctx)=>([0,25,50,75,100].includes(ctx.tick?.value))?GRID:'transparent' }
      },
    },
  }
  return <Line data={chartData} options={opts} />
}

// ─── Signup table ─────────────────────────────────────────────────────────────
const TH  = {fontSize:10,fontWeight:700,color:MUTED,textTransform:'uppercase',letterSpacing:'0.07em',padding:'6px 10px',textAlign:'right',borderBottom:`1.5px solid ${BDR}`,whiteSpace:'nowrap'}
const THL = {...TH,textAlign:'left'}
const TD  = {fontSize:12,color:TEXT,padding:'7px 10px',textAlign:'right',fontVariantNumeric:'tabular-nums',borderBottom:`1px solid ${GRID}`,whiteSpace:'nowrap'}
const TDL = {...TD,textAlign:'left'}
const TR  = ({i,children}) => <tr style={{background:i%2===0?'#fff':CARD}}>{children}</tr>

function SignupTable({ data }) {
  if (!data?.length) return null
  return <div style={{overflowX:'auto'}}>
    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
      <thead><tr>
        <th style={THL}>Signup quarter</th>
        <th style={TH}>Signed up</th>
        <th style={TH}>Activated</th>
        <th style={TH}>Activation</th>
        <th style={TH}>Median days</th>
        <th style={TH}>Avg 1st-mo trips</th>
      </tr></thead>
      <tbody>{data.map((r,i)=><TR key={i} i={i}>
        <td style={TDL}>{r.signup_quarter}</td>
        <td style={TD}>{fmtInt(r.signed_up)}</td>
        <td style={TD}>{fmtInt(r.activated)}</td>
        <td style={TD}>{fmtPct(r.activation_rate,1)}</td>
        <td style={TD}>{fmtF1(r.median_days)}</td>
        <td style={TD}>{fmtF1(r.avg_first_month_trips)}</td>
      </TR>)}</tbody>
    </table>
  </div>
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function FleetCohortsTab({ range }) {
  const [cells,    setCells]    = useState(null)
  const [cLoading, setCLoading] = useState(false)
  const [cErr,     setCErr]     = useState(null)
  const [signup,   setSignup]   = useState(null)
  const [sLoading, setSLoading] = useState(false)
  const [sErr,     setSErr]     = useState(null)
  const cellsFetched  = useRef(false)
  const signupFetched = useRef(false)

  useEffect(()=>{
    if (cellsFetched.current) return; cellsFetched.current=true
    setCLoading(true); setCErr(null)
    fetchCoh('cells').then(d=>setCells(d.cells??[])).catch(e=>setCErr(e.message)).finally(()=>setCLoading(false))
  },[])

  useEffect(()=>{
    if (signupFetched.current) return; signupFetched.current=true
    setSLoading(true); setSErr(null)
    fetchCoh('signup').then(d=>setSignup(d.signup??[])).catch(e=>setSErr(e.message)).finally(()=>setSLoading(false))
  },[])

  // Range filter: cohort_quarter_start between TRUNC(fromMonth,QUARTER) and toMonth
  const { filteredCells, cellMap, cohorts } = useMemo(()=>{
    if (!cells?.length) return { filteredCells:[], cellMap:{}, cohorts:[] }
    const rangeQStart = truncToQuarter(range.fromMonth)
    const rangeEnd    = range.toMonth < AS_AT.slice(0,7) ? `${range.toMonth}-01` : AS_AT
    const filtered = cells.filter(d =>
      (d.cohort_quarter_start??'') >= rangeQStart &&
      (d.cohort_quarter_start??'') <= rangeEnd
    )
    const map = {}
    filtered.forEach(d=>{ map[`${d.cohort}:${d.k}`] = d })
    const cqs = [...new Set(filtered.map(d=>d.cohort_quarter_start))].sort()
    const cohs = cqs.map(cq=>{ const d=filtered.find(r=>r.cohort_quarter_start===cq); return d?.cohort??cq })
    return { filteredCells:filtered, cellMap:map, cohorts:cohs }
  }, [cells, range.fromMonth, range.toMonth])

  // Tooltip builders
  const retentionTooltip = (cell, k) =>
    `${cell.cohort} \u00b7 k${k}\nFleets active: ${Math.round(nv(cell.fleets_active)).toLocaleString()}\nCohort profit: ${fmtCohortProfit(cell.cohort_profit)}`
  const profitTooltip = (cell, k) =>
    `${cell.cohort} \u00b7 k${k}\nFleets active: ${Math.round(nv(cell.fleets_active)).toLocaleString()}\nCohort profit: ${fmtCohortProfit(cell.cohort_profit)}`

  return (
    <div>
      <SH>Cohorts</SH>

      {/* ── Retention heatmap ── */}
      <Card title="Fleet retention \u2014 % of cohort active in month k" style={{marginBottom:16}}>
        {cLoading ? <Spinner /> : cErr ? <Err msg={cErr} /> : (
          <HeatmapGrid
            cellMap={cellMap} cohorts={cohorts}
            getColor={cell => retentionBg(cell.retention)}
            getText={cell => fmtPct0(cell.retention)}
            getTooltip={retentionTooltip}
          />
        )}
      </Card>

      {/* ── Profit heatmap ── */}
      <Card title="Profit per surviving fleet \u2014 USD in month k" style={{marginBottom:16}}>
        {cLoading ? <Spinner /> : cErr ? <Err msg={cErr} /> : (
          <HeatmapGrid
            cellMap={cellMap} cohorts={cohorts}
            getColor={cell => profitBg(cell.profit_per_surviving_fleet)}
            getText={cell => isNil(cell.profit_per_surviving_fleet)?'\u2014':`$${Math.round(nv(cell.profit_per_surviving_fleet)).toLocaleString()}`}
            getTooltip={profitTooltip}
          />
        )}
      </Card>

      {/* ── Retention index + Signup table ── */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:24}}>
        <Card title="Retention index">
          {cLoading ? <Spinner /> : cErr ? <Err msg={cErr} /> :
            cohorts.length ? <div style={{height:300}}><RetentionIndexChart cellMap={cellMap} cohorts={cohorts} /></div>
            : <div style={{color:MUTED,fontSize:12,padding:'20px 0'}}>No cohorts in range.</div>
          }
        </Card>
        <Card title="Signup \u2192 activation">
          {sLoading ? <Spinner /> : sErr ? <Err msg={sErr} /> : <SignupTable data={signup} />}
        </Card>
      </div>
    </div>
  )
}
