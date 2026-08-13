/**
 * QualityTab.jsx — Ride Hailing Quality metrics page
 * Shows the partner incident rate (QualityTable) from D.inc data.
 * Extracted from RideHailingTab per user request.
 */

import { useState, useMemo } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────────────────────────────────────
const T = {
  bg:'#ffffff', bg2:'#FAFBFC', bg3:'#F1F5F9', bg4:'#E2EAF0',
  text:'#1A2B3C', text2:'#374151', text3:'#64748B',
  border:'#E2EAF0', border2:'#B8C4D0',
  green:'#1D9E75', greenBg:'rgba(29,158,117,.11)',
  blue:'#185FA5',
  red:'#E24B4A',
  amber:'#D85A30',
  lift:'0 1px 2px rgba(26,26,24,.05), 0 6px 16px -6px rgba(26,26,24,.10)',
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function num(v){ const x=Number(v); return isFinite(x)?x:0 }
function pct(v,d=1){ if(v===null||!isFinite(Number(v)))return '—'; return (num(v)*100).toFixed(d)+'%' }
function pts(v,d=1){ if(v===null||!isFinite(Number(v)))return '—'; const x=num(v)*100; return (x>=0?'+':'')+x.toFixed(d)+' pts' }
function numFmt(v,d=0){ return num(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}) }

// §73: Period resolution for months
function prevYm(ym){ let y=+ym.slice(0,4),m=+ym.slice(5,7)-1; if(m<=0){m+=12;y-=1}; return `${y}-${String(m).padStart(2,'0')}` }
function incMonthSets(period, CUR_MONTH){
  const isMonth = k => /^\d{4}-\d{2}$/.test(k??'')
  if(isMonth(period)) return { cur:[period], base:[prevYm(period)] }
  // MTD, QTD, YTD — same logic as RideHailingTab
  const y=+CUR_MONTH.slice(0,4), mo=+CUR_MONTH.slice(5,7)
  const ymk = (yy,mm)=>`${yy}-${String(mm).padStart(2,'0')}`
  if(period==='mtd') return { cur:[CUR_MONTH], base:[ymk(mo===1?y-1:y, mo===1?12:mo-1)] }
  if(period==='qtd'){
    const qStart = mo<=3?1:mo<=6?4:mo<=9?7:10
    const cur=[]; for(let m2=qStart;m2<=mo;m2++) cur.push(ymk(y,m2))
    const pqStart=qStart-3<1?qStart+9:qStart-3
    const pqY = qStart-3<1?y-1:y
    const base=[]; for(let m2=pqStart;m2<pqStart+cur.length;m2++) base.push(ymk(m2>12?pqY+1:pqY,m2>12?m2-12:m2))
    return { cur, base }
  }
  if(period==='ytd'){
    const cur=[]; for(let m2=1;m2<=mo;m2++) cur.push(ymk(y,m2))
    const base=[]; for(let m2=1;m2<=mo;m2++) base.push(ymk(y-1,m2))
    return { cur, base }
  }
  return { cur:[CUR_MONTH], base:[prevYm(CUR_MONTH)] }
}

function incAgg(incRows, months){
  const rs = incRows.filter(r=>months.includes(r.ym))
  const o={valid_trips:0,lost_trips:0,all_trips:0}
  rs.forEach(r=>{o.valid_trips+=num(r.valid_trips);o.lost_trips+=num(r.lost_trips);o.all_trips+=num(r.all_trips)})
  o.lostRate = o.valid_trips>0 ? o.lost_trips/o.valid_trips : null
  o.allRate  = o.valid_trips>0 ? o.all_trips/o.valid_trips  : null
  return o
}

// ─────────────────────────────────────────────────────────────────────────────
// Table styles
// ─────────────────────────────────────────────────────────────────────────────
const TH = {padding:'6px 10px',fontSize:9.5,fontWeight:700,color:T.text3,
  textTransform:'uppercase',letterSpacing:'0.06em',background:T.bg2,
  borderBottom:`1px solid ${T.border}`,whiteSpace:'nowrap',textAlign:'right'}
const TD = {padding:'9px 10px',fontSize:12.5,verticalAlign:'top'}
const ROW = {borderBottom:`1px solid ${T.border}`}
const CARD = {background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,padding:'14px 18px 12px'}

const INC_TARGET = 0.01 // 1.00% target

// ─────────────────────────────────────────────────────────────────────────────
// QualityTable
// ─────────────────────────────────────────────────────────────────────────────
function QualityTable({inc, incBase, PM}){
  const lostRate = inc.lostRate
  const lostBase = incBase.lostRate
  const vsTarget = lostRate!==null ? lostRate - INC_TARGET : null
  const change   = lostRate!==null&&lostBase!==null ? lostRate-lostBase : null
  const barFill  = Math.min(100, lostRate!==null ? (lostRate/INC_TARGET)*100 : 0)

  return (
    <div style={{background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,overflow:'hidden',marginBottom:16}}>
      <div style={{padding:'12px 14px 10px',borderBottom:`1px solid ${T.border}`}}>
        <div style={{fontWeight:700,fontSize:13.5,color:T.text}}>Complaints closed against Elife</div>
        <div style={{fontSize:11.5,color:T.text3,marginTop:2}}>
          Filed in {PM?.label||'current period'} · as a share of Valid Trips · lower is better
        </div>
      </div>
      <table style={{width:'100%',borderCollapse:'collapse'}}>
        <thead>
          <tr>
            <th style={{...TH,textAlign:'left',paddingLeft:14,width:'18%'}}>Product Line</th>
            <th style={{...TH,width:'18%'}}>Lost Rate<br/><span style={{fontWeight:400,opacity:.8}}>prior period</span></th>
            <th style={{...TH,width:'20%'}}>vs Target (1.00%)</th>
            <th style={{...TH,width:'16%'}}>Change</th>
            <th style={{...TH,width:'14%'}}>Lost Complaints<br/><span style={{fontWeight:400,opacity:.8}}>valid trips</span></th>
            <th style={{...TH,width:'14%'}}>All Complaints</th>
          </tr>
        </thead>
        <tbody>
          {/* Prebooked */}
          <tr style={ROW}>
            <td style={{...TD,paddingLeft:14,fontWeight:600,fontSize:13}}>Prebooked</td>
            <td style={{...TD,textAlign:'right'}}>
              <div style={{fontWeight:600,fontVariantNumeric:'tabular-nums',color:lostRate!==null&&lostRate<INC_TARGET?T.green:T.red}}>
                {lostRate!==null?pct(lostRate,3):'—'}
              </div>
              <div style={{fontSize:10.5,color:T.text3}}>{lostBase!==null?pct(lostBase,3):'—'}</div>
            </td>
            <td style={{...TD}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <div style={{flex:1,height:6,background:'#ece9e0',borderRadius:3}}>
                  <div style={{width:`${barFill}%`,height:'100%',background:barFill<100?T.green:T.red,borderRadius:3,transition:'width .3s'}}/>
                </div>
                <span style={{fontSize:11.5,fontWeight:600,color:vsTarget!==null&&vsTarget<0?T.green:T.red,minWidth:36,textAlign:'right'}}>
                  {vsTarget!==null?(vsTarget*100).toFixed(0)+'%':'—'}
                </span>
              </div>
            </td>
            <td style={{...TD,textAlign:'right'}}>
              <span style={{fontSize:12.5,fontWeight:600,color:change!==null&&change<=0?T.green:T.red}}>
                {change!==null?pts(change,3):'—'}
              </span>
            </td>
            <td style={{...TD,textAlign:'right'}}>
              <div style={{fontWeight:500}}>{numFmt(inc.lost_trips)}</div>
              <div style={{fontSize:10.5,color:T.text3}}>{numFmt(inc.valid_trips)}</div>
            </td>
            <td style={{...TD,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>
              {inc.allRate!==null?pct(inc.allRate,2):'—'}
            </td>
          </tr>
          {/* Ride Hailing — §7.1 no data */}
          <tr style={{...ROW,background:T.bg}}>
            <td style={{...TD,paddingLeft:14,fontWeight:600,fontSize:13,color:T.text2}}>Ride Hailing</td>
            <td colSpan={5} style={{...TD,color:T.text3,fontSize:12,fontStyle:'italic'}}>
              Not held in this source — see note below
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI summary tiles for incident data
// ─────────────────────────────────────────────────────────────────────────────
function KpiQuality({label, value, sub, color}){
  return (
    <div style={CARD}>
      <div style={{fontSize:10.5,fontWeight:600,color:T.text3,marginBottom:6,textTransform:'uppercase',letterSpacing:'0.06em'}}>{label}</div>
      <div style={{fontSize:26,fontWeight:700,color:color||T.text,lineHeight:1.1}}>{value}</div>
      {sub&&<div style={{fontSize:11,color:T.text3,marginTop:4}}>{sub}</div>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main QualityTab component
// ─────────────────────────────────────────────────────────────────────────────
export default function QualityTab({D, period, CUR_MONTH, PM}){
  const sets   = useMemo(()=>incMonthSets(period,CUR_MONTH),[period,CUR_MONTH])
  const incRows = D.inc || []

  const incC = useMemo(()=>incAgg(incRows,sets.cur),[incRows,sets])
  const incB = useMemo(()=>incAgg(incRows,sets.base),[incRows,sets])

  const pmLabel = PM?.label || 'current period'

  return (
    <div>
      {/* Header */}
      <div style={{marginBottom:18}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <h1 style={{fontSize:20,fontWeight:700,color:T.text,margin:0}}>Quality</h1>
          <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:10,background:T.greenBg,color:T.green,letterSpacing:'0.06em'}}>● LIVE</span>
        </div>
        <div style={{fontSize:13,color:T.text3,marginTop:4}}>
          Partner incident rate — Prebooked. Data from{' '}
          <code style={{fontSize:11.5,background:'#f4f2ed',padding:'1px 4px',borderRadius:3}}>ads_qa_complaint_kpi_view</code>.
          {' '}Follows the period selector.
        </div>
      </div>

      {/* Context chip */}
      <div style={{marginBottom:16}}>
        <span style={{fontSize:11.5,color:T.text3,background:T.bg2,border:`1px solid ${T.border}`,borderRadius:8,padding:'4px 12px'}}>
          {pmLabel} · vs {PM?.base?.toLowerCase()||'prior period'}
        </span>
      </div>

      {/* KPI summary */}
      {incC.valid_trips > 0 ? (
        <>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
            <KpiQuality
              label="Lost Rate (Current)"
              value={incC.lostRate!==null?pct(incC.lostRate,3):'—'}
              color={incC.lostRate!==null&&incC.lostRate<INC_TARGET?T.green:T.red}
              sub={`Target: ${pct(INC_TARGET,2)}`}
            />
            <KpiQuality
              label="Lost Rate (Prior)"
              value={incB.lostRate!==null?pct(incB.lostRate,3):'—'}
              color={T.text}
            />
            <KpiQuality
              label="Lost Complaints"
              value={numFmt(incC.lost_trips)}
              sub={`of ${numFmt(incC.valid_trips)} valid trips`}
              color={T.text}
            />
            <KpiQuality
              label="All Complaints"
              value={incC.allRate!==null?pct(incC.allRate,2):'—'}
              color={T.text}
              sub={`${numFmt(incC.all_trips)} total complaints`}
            />
          </div>

          {/* Section label */}
          <div style={{fontSize:9,fontWeight:700,color:T.text3,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:10,display:'flex',alignItems:'center',gap:10}}>
            <span>Margin &amp; Quality — Partner Incident Rate (Lost)</span>
            <div style={{flex:1,height:'1px',background:T.border}}/>
          </div>
          <QualityTable inc={incC} incBase={incB} PM={PM}/>
        </>
      ) : (
        <div style={{background:T.bg2,border:`1px solid ${T.border}`,borderRadius:10,padding:'20px 24px',color:T.text3,fontSize:13,lineHeight:1.8}}>
          <strong style={{color:T.text}}>No quality data loaded yet.</strong>
          {' '}Click <strong>Refresh</strong> on the dashboard to reload incident data.
        </div>
      )}

      {/* Note */}
      <div style={{marginTop:16,background:T.bg2,border:`1px solid ${T.border}`,borderRadius:8,padding:'10px 14px',fontSize:12,color:T.text3,lineHeight:1.6}}>
        <strong style={{color:T.text2}}>Note — two date bases (§7):</strong>{' '}
        Numerator (complaints filed) uses <code style={{fontSize:11}}>file_datetime</code>; denominator (valid trips)
        uses <code style={{fontSize:11}}>pickup_date</code>. Ride Hailing has zero rows in this source (§7.1).
        Incident target = 1.00%.
      </div>
    </div>
  )
}
