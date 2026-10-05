/**
 * FleetGeographyTab.jsx — Geography tab (final tab) for Fleet Lifecycle dashboard
 * Single range-parameterised table: top 25 countries by trips.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../services/supabase'

const MUTED = '#6a7278', TEXT = '#14181b', GRID = '#eceef0', CARD = '#f7f8f9', BDR = '#e3e6e8'
const POS   = '#1f7a5a', NEG = '#b4472f'

// ─── Helpers ───────────────────────────────────────────────────────────────────
const nv    = (v) => { const x=v==null?NaN:Number(v); return isFinite(x)?x:0 }
const isNil = (v) => v==null||!isFinite(Number(v))
const fmtInt = (v) => isNil(v)?'\u2014':Math.round(nv(v)).toLocaleString('en-US')
const toDate = (s) => s?.length===7?`${s}-01`:(s??'2023-01-01')

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

async function fetchGeo({ rangeStart, rangeEnd }) {
  const { data:{ session } } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fleet-analysis-geography`, {
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${session?.access_token??''}`,apikey:import.meta.env.VITE_SUPABASE_ANON_KEY},
    body:JSON.stringify({ rangeStart:toDate(rangeStart), rangeEnd:toDate(rangeEnd) }),
  })
  if (!res.ok){let m=`HTTP ${res.status}`;try{const j=await res.json();if(j.error)m=j.error}catch{};throw new Error(m)}
  const j=await res.json(); if(j.error) throw new Error(j.error); return j
}

// ─── UI atoms ─────────────────────────────────────────────────────────────────
function Spinner() {
  return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:80,color:MUTED,gap:8,fontSize:12}}>
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{animation:'geo-spin 1s linear infinite'}}>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
    Loading from BigQuery\u2026<style>{`@keyframes geo-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
  </div>
}
function Err({msg}) {
  return <div style={{padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,color:'#b91c1c',fontSize:11}}>\u26a0 {msg}</div>
}
function SH({children}) {
  return <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.12em',color:MUTED,textTransform:'uppercase',margin:'4px 0 14px'}}>{children}</div>
}

// ─── Table ─────────────────────────────────────────────────────────────────────
const TH  = {fontSize:10,fontWeight:700,color:MUTED,textTransform:'uppercase',letterSpacing:'0.07em',padding:'6px 10px',textAlign:'right',borderBottom:`1.5px solid ${BDR}`,whiteSpace:'nowrap'}
const THL = {...TH,textAlign:'left'}
const TD  = {fontSize:12,color:TEXT,padding:'7px 10px',textAlign:'right',fontVariantNumeric:'tabular-nums',borderBottom:`1px solid ${GRID}`,whiteSpace:'nowrap'}
const TDL = {...TD,textAlign:'left'}
const TR  = ({i,children}) => <tr style={{background:i%2===0?'#fff':CARD}}>{children}</tr>

function DeltaCell({v}) {
  if (isNil(v)) return <td style={TD}>\u2014</td>
  const pct=(nv(v)*100).toFixed(0), up=nv(v)>=0
  return <td style={{...TD,color:up?POS:NEG}}>{up?'+':''}{pct}%</td>
}

function GeoTable({ data }) {
  if (!data?.length) return <div style={{color:MUTED,fontSize:12,padding:'12px 0'}}>No data for this range.</div>
  return (
    <div style={{overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
        <thead><tr>
          <th style={THL}>Country</th>
          <th style={THL}>Geo</th>
          <th style={TH}>Trips</th>
          <th style={TH}>\u0394%</th>
          <th style={TH}>Peak active fleets</th>
          <th style={TH}>Profit</th>
          <th style={TH}>\u0394%</th>
          <th style={TH}>Profit / trip</th>
        </tr></thead>
        <tbody>{data.map((r,i)=><TR key={i} i={i}>
          <td style={TDL}>{r.country}</td>
          <td style={{...TDL,color:MUTED,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis'}} title={String(r.geo??'')}>{r.geo}</td>
          <td style={TD}>{fmtInt(r.trips)}</td>
          <DeltaCell v={r.trips_vs_prior} />
          <td style={TD}>{fmtInt(r.peak_active_fleets)}</td>
          <td style={TD}>{fmtProfit(r.profit)}</td>
          <DeltaCell v={r.profit_vs_prior} />
          <td style={TD}>{fmtPPT(r.profit_per_trip)}</td>
        </TR>)}</tbody>
      </table>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function FleetGeographyTab({ range }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState(null)

  const load = useCallback(() => {
    setLoading(true); setErr(null)
    fetchGeo({ rangeStart:range.fromMonth, rangeEnd:range.toMonth })
      .then(j=>setData(j.countries??[]))
      .catch(e=>setErr(e.message))
      .finally(()=>setLoading(false))
  }, [range.fromMonth, range.toMonth])

  useEffect(()=>{ load() }, [load])

  const cardTitle = `Country \u00b7 ${range.fromMonth} \u2192 ${range.toMonth}`

  return (
    <div>
      <SH>Geography</SH>
      <div style={{background:CARD,border:`1px solid ${BDR}`,borderRadius:8,padding:'16px 18px 18px',marginBottom:24}}>
        <div style={{fontSize:12,fontWeight:700,color:TEXT,marginBottom:14}}>{cardTitle}</div>
        {loading ? <Spinner /> : err ? <Err msg={err} /> : <GeoTable data={data} />}
      </div>
    </div>
  )
}
