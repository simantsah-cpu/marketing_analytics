/**
 * FleetOVDTab.jsx — Offered vs Delivered tab for Fleet Lifecycle dashboard
 * Orbit Analytics | BigQuery live data via fleet-analysis-ovd edge function
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import { supabase } from '../services/supabase'

// ─── Shared design tokens (match FleetAnalysis) ───────────────────────────────
const AS_AT_MONTH = '2026-08-01'

const MUTED  = '#6a7278'
const TEXT   = '#14181b'
const GRID   = '#eceef0'
const CARD   = '#f7f8f9'
const BDR    = '#e3e6e8'
const POS    = '#1f7a5a'
const NEG    = '#b4472f'

const C = {
  attempts:     '#2f6f9f',
  delivered:    '#1f7a5a',
  rejections:   '#b4472f',
  lateShare:    '#c98a2b',
  needing2nd:   '#7a5ea8',
  driverNoShow: '#2f6f9f',
  cancelled:    '#c98a2b',
  rejected:     '#b4472f',
}

const NO_DL = { datalabels: { display: false } }
const GRID_CFG = { color: GRID, drawBorder: false }

// ─── Formatters ───────────────────────────────────────────────────────────────
const nv = (v) => { const x = v == null ? NaN : Number(v); return isFinite(x) ? x : 0 }
const isNil = (v) => v == null || !isFinite(Number(v))
const fmtInt = (v) => isNil(v) ? '—' : Math.round(nv(v)).toLocaleString('en-US')
const fmtDp  = (v, d=2) => isNil(v) ? '—' : nv(v).toFixed(d)
const fmtPct = (v, d=2) => isNil(v) ? '—' : `${(nv(v)*100).toFixed(d)}%`
const fmtPct1 = (v) => fmtPct(v, 1)
const fmtDeltaPct = (v) => isNil(v) ? null : `${(Math.abs(nv(v))*100).toFixed(1)}%`

// ─── Date helpers ─────────────────────────────────────────────────────────────
const parseMonth = (s) => { const [y,m]=s.split('-').map(Number); return new Date(y,m-1,1) }
const toDate = (s) => s?.length === 7 ? `${s}-01` : s ?? '2023-01-01'

function windowLabel() {
  const endD   = parseMonth(AS_AT_MONTH)
  const startD = new Date(endD.getFullYear(), endD.getMonth()-11, 1)
  const fmt    = (d) => d.toLocaleDateString('en-US', { month:'short', year:'numeric' })
  return `${fmt(startD)} \u2013 ${fmt(endD)}`
}
const WINDOW_LABEL = windowLabel()

// ─── Supabase caller ──────────────────────────────────────────────────────────
async function fetchOVD({ dataset, rangeStart, rangeEnd }) {
  const { data:{ session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fleet-analysis-ovd`, {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      Authorization:`Bearer ${session?.access_token ?? ''}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      asAtMonth: AS_AT_MONTH,
      rangeStart: toDate(rangeStart),
      rangeEnd:   toDate(rangeEnd),
      dataset,
    }),
  })
  if (!res.ok) {
    let msg = `fleet-analysis-ovd: HTTP ${res.status}`
    try { const j=await res.json(); if(j.error) msg=j.error } catch{}
    throw new Error(msg)
  }
  const j = await res.json()
  if (j.error) throw new Error(j.error)
  return j
}

// ─── UI primitives ────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:90,color:MUTED,gap:8,fontSize:12}}>
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
           style={{animation:'ovd-spin 1s linear infinite'}}>
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
      </svg>
      Loading from BigQuery\u2026
      <style>{`@keyframes ovd-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

function ErrMsg({ msg }) {
  return (
    <div style={{padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,color:'#b91c1c',fontSize:11,marginBottom:10}}>
      \u26a0 {msg}
    </div>
  )
}

function SectionHeading({ children }) {
  return (
    <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.12em',color:MUTED,textTransform:'uppercase',margin:'4px 0 14px'}}>
      {children}
    </div>
  )
}

function Card({ title, children, style={} }) {
  return (
    <div style={{background:CARD,border:`1px solid ${BDR}`,borderRadius:8,padding:'16px 18px 18px',...style}}>
      {title && <div style={{fontSize:12,fontWeight:700,color:TEXT,marginBottom:14}}>{title}</div>}
      {children}
    </div>
  )
}

// ─── OVD KPI tile ─────────────────────────────────────────────────────────────
function OVDTile({ label, value, deltaRaw, nMonths, positiveIsGood=false }) {
  const delta = fmtDeltaPct(deltaRaw)
  const dir   = deltaRaw == null || !isFinite(nv(deltaRaw)) ? null : nv(deltaRaw) >= 0 ? 'up' : 'down'
  const good  = dir === null ? null : (positiveIsGood ? dir==='up' : dir==='down')
  const dc    = good === null ? MUTED : good ? POS : NEG
  const arrow = dir==='up' ? '\u25b2' : dir==='down' ? '\u25bc' : ''

  return (
    <div style={{
      background:CARD, border:`1px solid ${BDR}`, borderRadius:8,
      padding:'14px 16px', minWidth:148, flex:'1 1 148px',
      display:'flex', flexDirection:'column', gap:4,
    }}>
      <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.08em',color:MUTED,textTransform:'uppercase'}}>{label}</div>
      <div style={{fontSize:22,fontWeight:700,color:TEXT,fontVariantNumeric:'tabular-nums',lineHeight:1.2}}>{value}</div>
      <div style={{fontSize:11,color:delta?dc:'transparent',fontVariantNumeric:'tabular-nums',minHeight:16}}>
        {delta ? `${arrow} ${delta} vs prior ${nMonths}m` : '\u00b7'}
      </div>
    </div>
  )
}

// ─── Chart 1: Dispatch attempts, rejections, delivered trips ──────────────────
function AttemptsChart({ data }) {
  const labels = data.map(d => d.month_label ?? '')
  const chartData = {
    labels,
    datasets:[
      {label:'Attempts',       data:data.map(d=>nv(d.attempts)),       borderColor:C.attempts,   borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.3, fill:false},
      {label:'Delivered trips',data:data.map(d=>nv(d.delivered_trips)),borderColor:C.delivered,  borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.3, fill:false},
      {label:'Rejections',     data:data.map(d=>nv(d.rejections)),     borderColor:C.rejections, borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.3, fill:false},
    ],
  }
  const opts = {
    responsive:true, maintainAspectRatio:false,
    interaction:{mode:'index',intersect:false},
    plugins:{
      ...NO_DL,
      legend:{display:true,position:'bottom',labels:{font:{size:11},color:MUTED,boxWidth:12,padding:14}},
      tooltip:{callbacks:{
        title:(items)=>items[0]?.label,
        label:(item)=>`  ${item.dataset.label}: ${Math.round(item.raw).toLocaleString()}`,
      }},
    },
    scales:{
      x:{ticks:{font:{size:10},color:MUTED,maxRotation:-45,autoSkip:true,maxTicksLimit:8},grid:GRID_CFG},
      y:{ticks:{font:{size:11},color:MUTED,callback:(v)=>Math.round(v).toLocaleString()},grid:{...GRID_CFG,count:5}},
    },
  }
  return <Line data={chartData} options={opts} />
}

// ─── Chart 2: Rejection rate, late rejection share, % needing 2nd fleet ───────
function RateChart({ data }) {
  const labels = data.map(d => d.month_label ?? '')
  const chartData = {
    labels,
    datasets:[
      {label:'Rejection rate',                data:data.map(d=>nv(d.rejection_rate)),              borderColor:C.rejections,   borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.3, fill:false},
      {label:'Rejections inside 24h of pickup',data:data.map(d=>nv(d.late_rejection_share)),       borderColor:C.lateShare,    borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.3, fill:false},
      {label:'Trips needing a 2nd fleet',     data:data.map(d=>nv(d.trips_needing_2nd_fleet_rate)),borderColor:C.needing2nd,   borderWidth:2, pointRadius:0, pointHoverRadius:4, tension:0.3, fill:false},
    ],
  }
  const pctFmt = (v) => `${(v*100).toFixed(1)}%`
  const opts = {
    responsive:true, maintainAspectRatio:false,
    interaction:{mode:'index',intersect:false},
    plugins:{
      ...NO_DL,
      legend:{display:true,position:'bottom',labels:{font:{size:11},color:MUTED,boxWidth:12,padding:14}},
      tooltip:{callbacks:{
        title:(items)=>items[0]?.label,
        label:(item)=>`  ${item.dataset.label}: ${(item.raw*100).toFixed(2)}%`,
      }},
    },
    scales:{
      x:{ticks:{font:{size:10},color:MUTED,maxRotation:-45,autoSkip:true,maxTicksLimit:8},grid:GRID_CFG},
      y:{
        min:0, max:0.45,
        ticks:{font:{size:11},color:MUTED,callback:(v)=>`${Math.round(v*100)}%`},
        grid:{...GRID_CFG,count:5},
      },
    },
  }
  return <Line data={chartData} options={opts} />
}

// ─── Chart 3: Rejection status mix ───────────────────────────────────────────
function StatusMixChart({ data }) {
  const labels = data.map(d => d.month_label ?? '')
  const chartData = {
    labels,
    datasets:[
      {label:'Driver no show',data:data.map(d=>nv(d.share_driver_no_show)),borderColor:C.driverNoShow,borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:0.3,fill:false},
      {label:'Cancelled',     data:data.map(d=>nv(d.share_cancelled)),     borderColor:C.cancelled,    borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:0.3,fill:false},
      {label:'Rejected',      data:data.map(d=>nv(d.share_rejected)),      borderColor:C.rejected,     borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:0.3,fill:false},
    ],
  }
  const opts = {
    responsive:true, maintainAspectRatio:false,
    interaction:{mode:'index',intersect:false},
    plugins:{
      ...NO_DL,
      legend:{display:true,position:'bottom',labels:{font:{size:11},color:MUTED,boxWidth:12,padding:14}},
      tooltip:{callbacks:{
        title:(items)=>items[0]?.label,
        label:(item)=>`  ${item.dataset.label}: ${(item.raw*100).toFixed(1)}%`,
      }},
    },
    scales:{
      x:{ticks:{font:{size:10},color:MUTED,maxRotation:-45,autoSkip:true,maxTicksLimit:8},grid:GRID_CFG},
      y:{
        min:0, max:1,
        ticks:{font:{size:11},color:MUTED,callback:(v)=>`${Math.round(v*100)}%`},
        grid:{...GRID_CFG,count:5},
      },
    },
  }
  return <Line data={chartData} options={opts} />
}

// ─── Table: Fleet ─────────────────────────────────────────────────────────────
const TH = { fontSize:10, fontWeight:700, color:MUTED, textTransform:'uppercase', letterSpacing:'0.07em',
             padding:'6px 10px', textAlign:'right', borderBottom:`1.5px solid ${BDR}`, whiteSpace:'nowrap' }
const THL = { ...TH, textAlign:'left' }
const TD  = { fontSize:12, color:TEXT, padding:'7px 10px', textAlign:'right', fontVariantNumeric:'tabular-nums',
              borderBottom:`1px solid ${GRID}`, whiteSpace:'nowrap' }
const TDL = { ...TD, textAlign:'left' }

function FleetTable({ data }) {
  if (!data?.length) return null
  return (
    <div style={{overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
        <thead>
          <tr>
            <th style={THL}>Fleet</th>
            <th style={TH}>ID</th>
            <th style={TH}>Attempts received</th>
            <th style={TH}>Delivered</th>
            <th style={TH}>Rejected</th>
            <th style={TH}>Rejection rate</th>
            <th style={TH}>Late (&lt;24h)</th>
            <th style={TH}>Median hold</th>
            <th style={TH}>Caught from others</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => {
            const rejRate = nv(row.rejection_rate)
            const rateStyle = { ...TD, color: isNil(row.rejection_rate) ? TEXT : rejRate > 0.15 ? NEG : TEXT }
            return (
              <tr key={i} style={{background: i%2===0 ? '#fff' : CARD}}>
                <td style={{...TDL,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis'}} title={String(row.fleet_name??'')}>{row.fleet_name}</td>
                <td style={TD}>{row.fleet_id}</td>
                <td style={TD}>{fmtInt(row.attempts_received)}</td>
                <td style={TD}>{fmtInt(row.delivered)}</td>
                <td style={TD}>{fmtInt(row.rejected)}</td>
                <td style={rateStyle}>{fmtPct(row.rejection_rate)}</td>
                <td style={TD}>{fmtInt(row.late_rejections)}</td>
                <td style={TD}>{isNil(row.median_hold_hours) ? '\u2014' : `${Math.round(nv(row.median_hold_hours))}h`}</td>
                <td style={TD}>{fmtInt(row.caught_from_others)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Table: Airport ───────────────────────────────────────────────────────────
function AirportTable({ data }) {
  if (!data?.length) return null
  return (
    <div style={{overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
        <thead>
          <tr>
            <th style={THL}>Airport</th>
            <th style={TH}>Attempts</th>
            <th style={TH}>Delivered</th>
            <th style={TH}>Rejected</th>
            <th style={TH}>Rejection rate</th>
            <th style={TH}>Attempts per trip</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => {
            const rejRate = nv(row.rejection_rate)
            const rateStyle = { ...TD, color: isNil(row.rejection_rate) ? TEXT : rejRate > 0.20 ? NEG : TEXT }
            return (
              <tr key={i} style={{background: i%2===0 ? '#fff' : CARD}}>
                <td style={TDL}>{row.airport}</td>
                <td style={TD}>{fmtInt(row.attempts)}</td>
                <td style={TD}>{fmtInt(row.delivered)}</td>
                <td style={TD}>{fmtInt(row.rejected)}</td>
                <td style={rateStyle}>{fmtPct1(row.rejection_rate)}</td>
                <td style={TD}>{fmtDp(row.attempts_per_trip, 2)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Table: Rejection status ───────────────────────────────────────────────────
function RejectionStatusTable({ data }) {
  if (!data?.length) return null
  return (
    <div style={{overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
        <thead>
          <tr>
            <th style={THL}>dispatch_stat</th>
            <th style={THL}>assign_stat</th>
            <th style={TH}>Rejections</th>
            <th style={TH}>Share</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} style={{background: i%2===0 ? '#fff' : CARD}}>
              <td style={TDL}>{row.dispatch_stat}</td>
              <td style={{...TDL,color:MUTED}}>{row.assign_stat}</td>
              <td style={TD}>{fmtInt(row.rejections)}</td>
              <td style={TD}>{fmtPct1(row.share)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Table: Rebound pairs ─────────────────────────────────────────────────────
function ReboundTable({ data }) {
  if (!data?.length) return null
  return (
    <div style={{overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
        <thead>
          <tr>
            <th style={THL}>Rejected by</th>
            <th style={TH}>ID</th>
            <th style={THL}>Delivered by</th>
            <th style={TH}>ID</th>
            <th style={TH}>Trips</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} style={{background: i%2===0 ? '#fff' : CARD}}>
              <td style={{...TDL,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis'}} title={String(row.rejected_by_name??'')}>{row.rejected_by_name}</td>
              <td style={TD}>{row.rejected_by}</td>
              <td style={{...TDL,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis'}} title={String(row.delivered_by_name??'')}>{row.delivered_by_name}</td>
              <td style={TD}>{row.delivered_by}</td>
              <td style={TD}>{fmtInt(row.trips)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main OVD tab component ───────────────────────────────────────────────────
export default function FleetOVDTab({ range, nMonths }) {
  // Monthly trend data — load once, filter client-side for charts
  const [monthly,    setMonthly]   = useState(null)
  const [mLoading,   setMLoading]  = useState(false)
  const [mErr,       setMErr]      = useState(null)

  // Range-filtered KPIs
  const [kpis,       setKpis]      = useState(null)
  const [kLoading,   setKLoading]  = useState(false)
  const [kErr,       setKErr]      = useState(null)

  // Fixed 12m datasets
  const [fleet,      setFleet]     = useState(null)
  const [airport,    setAirport]   = useState(null)
  const [rejStatus,  setRejStatus] = useState(null)
  const [rebound,    setRebound]   = useState(null)
  const [fLoading,   setFLoading]  = useState(false)
  const [fErr,       setFErr]      = useState(null)

  const monthlyFetched = useRef(false)
  const fixedFetched   = useRef(false)

  // Load monthly once
  useEffect(() => {
    if (monthlyFetched.current) return
    monthlyFetched.current = true
    setMLoading(true); setMErr(null)
    fetchOVD({ dataset:'monthly', rangeStart:'2023-01', rangeEnd:AS_AT_MONTH.slice(0,7) })
      .then(d => setMonthly(d.monthly ?? []))
      .catch(e => setMErr(e.message))
      .finally(() => setMLoading(false))
  }, [])

  // Load fixed tables once
  useEffect(() => {
    if (fixedFetched.current) return
    fixedFetched.current = true
    setFLoading(true); setFErr(null)
    fetchOVD({ dataset:'fixed', rangeStart:'2023-01', rangeEnd:AS_AT_MONTH.slice(0,7) })
      .then(d => {
        setFleet(d.fleet ?? [])
        setAirport(d.airport ?? [])
        setRejStatus(d.rejection_status ?? [])
        setRebound(d.rebound_pairs ?? [])
      })
      .catch(e => setFErr(e.message))
      .finally(() => setFLoading(false))
  }, [])

  // Reload KPIs on range change
  const fetchKpis = useCallback(() => {
    setKLoading(true); setKErr(null)
    fetchOVD({ dataset:'kpis', rangeStart:range.fromMonth, rangeEnd:range.toMonth })
      .then(d => setKpis(d.kpis ?? null))
      .catch(e => setKErr(e.message))
      .finally(() => setKLoading(false))
  }, [range.fromMonth, range.toMonth])

  useEffect(() => { fetchKpis() }, [fetchKpis])

  // Filter monthly to range for charts
  const rangeData = useMemo(() => {
    if (!monthly?.length) return []
    return monthly.filter(d => {
      const m = d.month_label ?? d.month_start?.slice(0,7)
      return m >= range.fromMonth && m <= range.toMonth
    })
  }, [monthly, range.fromMonth, range.toMonth])

  const kpiNMonths = useMemo(() => {
    if (kpis?.n_months != null) return kpis.n_months
    try {
      const s = parseMonth(range.fromMonth), e = parseMonth(range.toMonth)
      return (e.getFullYear()-s.getFullYear())*12+(e.getMonth()-s.getMonth())+1
    } catch { return nMonths ?? '?' }
  }, [kpis?.n_months, range.fromMonth, range.toMonth, nMonths])

  return (
    <div>
      <SectionHeading>Offered vs Delivered</SectionHeading>

      {/* ── OVD KPI tiles (6) ── */}
      {kErr && <ErrMsg msg={kErr} />}
      {kLoading ? <Spinner /> : kpis ? (
        <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:20}}>
          <OVDTile label="Dispatch attempts"            value={fmtInt(kpis.dispatch_attempts)}             deltaRaw={null}                          nMonths={kpiNMonths} />
          <OVDTile label="Delivered trips"              value={fmtInt(kpis.delivered_trips)}               deltaRaw={null}                          nMonths={kpiNMonths} />
          <OVDTile label="Attempts per delivered trip"  value={fmtDp(kpis.attempts_per_delivered_trip, 3)} deltaRaw={null}                          nMonths={kpiNMonths} />
          <OVDTile label="Rejection rate"               value={fmtPct(kpis.rejection_rate)}                deltaRaw={kpis.rejection_rate_vs_prior}  nMonths={kpiNMonths} positiveIsGood={false} />
          <OVDTile label="Trips needing a 2nd fleet"    value={fmtPct(kpis.trips_needing_2nd_fleet)}       deltaRaw={null}                          nMonths={kpiNMonths} positiveIsGood={false} />
          <OVDTile label="Rejections inside 24h of pickup" value={fmtPct(kpis.rejections_inside_24h, 1)}  deltaRaw={null}                          nMonths={kpiNMonths} positiveIsGood={false} />
        </div>
      ) : !kErr ? <div style={{height:90}}/> : null}

      {/* ── Chart 1: Attempts / delivered / rejections (full width) ── */}
      <Card title="Dispatch attempts, rejections and delivered trips" style={{marginBottom:16}}>
        {mLoading ? <Spinner /> : mErr ? <ErrMsg msg={mErr} /> : (
          <div style={{height:280}}>
            <AttemptsChart data={rangeData} />
          </div>
        )}
      </Card>

      {/* ── Charts 2+3 side by side ── */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
        <Card title="Rejection rate and late rejections">
          {mLoading ? <Spinner /> : mErr ? <ErrMsg msg={mErr} /> : (
            <div style={{height:250}}>
              <RateChart data={rangeData} />
            </div>
          )}
        </Card>
        <Card title="Rejection status mix">
          {mLoading ? <Spinner /> : mErr ? <ErrMsg msg={mErr} /> : (
            <div style={{height:250}}>
              <StatusMixChart data={rangeData} />
            </div>
          )}
        </Card>
      </div>

      {/* ── Fleet table (full width) ── */}
      <Card title={`Fleet \u2014 offered, delivered, rejected \u00b7 ${WINDOW_LABEL}`} style={{marginBottom:16}}>
        {fLoading ? <Spinner /> : fErr ? <ErrMsg msg={fErr} /> : <FleetTable data={fleet} />}
      </Card>

      {/* ── Airport + Rejection status side by side ── */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
        <Card title={`Airport \u2014 rejection rate \u00b7 ${WINDOW_LABEL}`}>
          {fLoading ? <Spinner /> : fErr ? <ErrMsg msg={fErr} /> : <AirportTable data={airport} />}
        </Card>
        <Card title={`Status and assignment state on rejected attempts \u00b7 ${WINDOW_LABEL}`}>
          {fLoading ? <Spinner /> : fErr ? <ErrMsg msg={fErr} /> : <RejectionStatusTable data={rejStatus} />}
        </Card>
      </div>

      {/* ── Rebound pairs table (full width) ── */}
      <Card title={`Rebound \u2014 who delivers a trip another fleet dropped \u00b7 ${WINDOW_LABEL}`} style={{marginBottom:24}}>
        {fLoading ? <Spinner /> : fErr ? <ErrMsg msg={fErr} /> : <ReboundTable data={rebound} />}
      </Card>
    </div>
  )
}
