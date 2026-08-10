/**
 * RideHailingTab.jsx — Weekly EAM Performance, Ride Hailing & Quality tab
 * Spec: ORBIT_RIDE_HAILING_SPEC.md
 *
 * §0 Non-negotiables:
 *  - partner_name STRPOS only — no fleet-ID allow-list (§2)
 *  - Compare Total vs Power BI, not Global (§5)
 *  - Completed excludes ride_stat='Cancelled' even at destination (§3.2)
 *  - Completion Rate = (trips − cancelled) / trips (§3.3)
 *  - Per-row rounding before SUM (§3.4)
 *  - Incident numerator on file_datetime, denominator on pickup_date (§7)
 */

import { useState, useMemo, Fragment } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────────────────────────────────────
const T = {
  bg:'#ffffff', bg2:'#FAFBFC', bg3:'#F1F5F9', bg4:'#E2EAF0',
  text:'#1A2B3C', text2:'#374151', text3:'#64748B',
  border:'#E2EAF0', border2:'#B8C4D0',
  green:'#1D9E75', greenBg:'rgba(29,158,117,.08)',
  blue:'#185FA5', blueBg:'rgba(24,95,165,.08)',
  red:'#E24B4A', redBg:'rgba(226,75,74,.08)',
  amber:'#D85A30',
  lift:'0 1px 2px rgba(26,26,24,.05), 0 6px 16px -6px rgba(26,26,24,.10)',
}

// §5 Scope model
const SCOPES      = ['Total','Global','Japan']
const SCOPE_COLOR = { Total:'#2B2B2B', Global:T.blue, Japan:T.amber }
const scopeLabel  = k =>
  k==='Total'  ? 'Total' :
  k==='Global' ? 'Global (excl. Japan)' : k

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function num(v){ const x=Number(v); return isFinite(x)?x:0 }

function usd(v,d=0){
  const x=num(v),a=Math.abs(x),s=x<0?'-$':'$'
  return s+a.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})
}
function usdC(v){
  const x=num(v),a=Math.abs(x),s=x<0?'-$':'$'
  if(a>=1e6)return s+(a/1e6).toFixed(2)+'M'
  if(a>=1e5)return s+(a/1e3).toFixed(0)+'k'
  if(a>=1e3)return s+(a/1e3).toFixed(1)+'k'
  return '$'+x.toLocaleString('en-US',{maximumFractionDigits:0})
}
function numFmt(v,d=0){
  return num(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})
}
function pct(v,d=1){
  if(v===null||!isFinite(Number(v)))return '—'
  return (num(v)*100).toFixed(d)+'%'
}
function pts(v,d=1){
  if(v===null||!isFinite(Number(v)))return '—'
  const x=num(v)*100
  return (x>=0?'+':'')+x.toFixed(d)+' pts'
}

function prevYm(ym){
  let y=+ym.slice(0,4),m=+ym.slice(5,7)-1
  if(m<=0){m+=12;y-=1}
  return `${y}-${String(m).padStart(2,'0')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// §3 Period resolution — month-grained, MTD resolves to current month
// ─────────────────────────────────────────────────────────────────────────────
function rhMonthSets(period, CUR_MONTH){
  const y=+CUR_MONTH.slice(0,4), mo=+CUR_MONTH.slice(5,7)
  const ymk = (yy,mm)=>`${yy}-${String(mm).padStart(2,'0')}`
  const isMonth = k => /^\d{4}-\d{2}$/.test(k??'')

  if(isMonth(period)) return {cur:[period], base:[prevYm(period)]}
  if(period==='mtd')  return {cur:[CUR_MONTH], base:[prevYm(CUR_MONTH)]}

  if(period==='qtd'){
    const qs=Math.floor((mo-1)/3)*3+1, cur=[], base=[]
    for(let i=qs;i<=mo;i++) cur.push(ymk(y,i))
    for(let j=0;j<cur.length;j++){
      let pm=qs-3+j,py=y; if(pm<=0){pm+=12;py-=1}
      base.push(ymk(py,pm))
    }
    return {cur,base}
  }
  if(period==='ytd'){
    const c=[],b=[]
    for(let k=1;k<=mo;k++){c.push(ymk(y,k));b.push(ymk(y-1,k))}
    return {cur:c,base:b}
  }
  return {cur:[CUR_MONTH],base:[prevYm(CUR_MONTH)]}
}

// ─────────────────────────────────────────────────────────────────────────────
// §6 Derived metrics
// ─────────────────────────────────────────────────────────────────────────────
function der(o){
  const tr=num(o.trips),ca=num(o.cancelled),co=num(o.completed)
  return {
    inq:num(o.inq), quotes:num(o.quotes), salesTrips:num(o.salesTrips||o.sales_trips),
    trips:tr, cancelled:ca, completed:co,
    rev:num(o.rev), cost:num(o.cost), profit:num(o.profit),
    // §3.3 Completion = (trips − cancelled) / trips — matches Power BI
    completion: tr>0 ? (tr-ca)/tr : null,
    // atDest = completed / trips (Wilson's definition, kept separate)
    atDest: tr>0 ? co/tr : null,
    cancelRate: tr>0 ? ca/tr : null,
    // §3.5 Conversion Rate = Sales Trips / Inquiries
    convRate: num(o.inq)>0 ? num(o.salesTrips||o.sales_trips)/num(o.inq) : null,
    margin: num(o.rev)>0 ? num(o.profit)/num(o.rev) : null,
    revPerTrip: co>0 ? num(o.rev)/co : null,
  }
}

function rhAgg(rows, months, scope){
  const rs = rows.filter(r=>months.includes(r.ym)&&(scope==='Total'||r.scope===scope))
  const o={inq:0,quotes:0,sales_trips:0,trips:0,cancelled:0,completed:0,rev:0,cost:0,profit:0}
  rs.forEach(r=>{
    o.inq+=num(r.inq); o.quotes+=num(r.quotes); o.sales_trips+=num(r.sales_trips)
    o.trips+=num(r.trips); o.cancelled+=num(r.cancelled); o.completed+=num(r.completed)
    o.rev+=num(r.rev); o.cost+=num(r.cost); o.profit+=num(r.profit)
  })
  return der(o)
}

function incAgg(incRows, months){
  const rs = incRows.filter(r=>months.includes(r.ym))
  const o={valid_trips:0,lost_trips:0,all_trips:0}
  rs.forEach(r=>{o.valid_trips+=num(r.valid_trips);o.lost_trips+=num(r.lost_trips);o.all_trips+=num(r.all_trips)})
  o.lostRate = o.valid_trips>0 ? o.lost_trips/o.valid_trips : null
  o.allRate  = o.valid_trips>0 ? o.all_trips/o.valid_trips : null
  return o
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI tile
// ─────────────────────────────────────────────────────────────────────────────
const CARD = {background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,padding:'14px 18px 12px'}

function KpiTile({label, totVal, totColor, delta, priorVal, g, j}){
  const dNum = num(delta)
  const dCol = isFinite(dNum)?(dNum>0?T.green:dNum<0?T.red:T.text3):T.text3
  return (
    <div style={CARD}>
      <div style={{fontSize:10.5,fontWeight:600,color:T.text3,marginBottom:6,textTransform:'uppercase',letterSpacing:'0.06em'}}>{label}</div>
      <div style={{display:'flex',alignItems:'baseline',gap:6,flexWrap:'wrap'}}>
        <span style={{fontSize:24,fontWeight:700,color:totColor||T.text,lineHeight:1.1}}>{totVal}</span>
        <span style={{fontSize:10.5,color:T.text3}}>Total</span>
      </div>
      {delta!==undefined&&(
        <div style={{fontSize:11,marginTop:3}}>
          <span style={{color:dCol,fontWeight:600}}>
            {isFinite(dNum)?(dNum>=0?'+':'')+((dNum)*100).toFixed(1)+'%':'—'}
          </span>
          <span style={{color:T.text3}}> vs prior · prior {priorVal}</span>
        </div>
      )}
      <div style={{display:'flex',gap:16,marginTop:6,fontSize:11}}>
        <span><span style={{color:SCOPE_COLOR.Global,marginRight:3}}>●</span>Global {g}</span>
        <span><span style={{color:SCOPE_COLOR.Japan,marginRight:3}}>●</span>Japan {j}</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Funnel table — expandable by scope
// ─────────────────────────────────────────────────────────────────────────────
const TH = {padding:'6px 10px',fontSize:9.5,fontWeight:700,color:T.text3,
  textTransform:'uppercase',letterSpacing:'0.06em',background:T.bg2,
  borderBottom:`1px solid ${T.border}`,whiteSpace:'nowrap',textAlign:'right'}
const TD = {padding:'9px 10px',fontSize:12.5,verticalAlign:'top'}
const ROW = {borderBottom:`1px solid ${T.border}`}

function miniBar(ratio, color='#2B2B2B'){
  if(!isFinite(ratio)||ratio<0)return null
  const w = Math.min(100,ratio*100)
  return (
    <div style={{display:'inline-block',width:60,height:5,background:'#ece9e0',borderRadius:3,verticalAlign:'middle',marginLeft:4}}>
      <div style={{width:`${w}%`,height:'100%',background:color,borderRadius:3}}/>
    </div>
  )
}

function FunnelTable({scopes, rhOpen, setRhOpen}){
  function isOpen(scope){ const k=`funnel|${scope}`; return rhOpen[k]===undefined?true:!!rhOpen[k] }
  function toggle(scope){ const k=`funnel|${scope}`; setRhOpen(p=>({...p,[k]:!isOpen(scope)})) }
  function toggleAll(v){ const n={...rhOpen}; SCOPES.forEach(s=>{n[`funnel|${s}`]=v}); setRhOpen(n) }

  const STAGES = ['Inquiries','Service trips','Not cancelled','Completed trips']

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
        <button onClick={()=>toggleAll(true)} style={{fontSize:11.5,fontWeight:600,padding:'4px 10px',border:`1px solid ${T.border}`,borderRadius:6,background:T.bg,color:T.text2,cursor:'pointer',fontFamily:'inherit'}}>Expand all</button>
        <button onClick={()=>toggleAll(false)} style={{fontSize:11.5,fontWeight:600,padding:'4px 10px',border:`1px solid ${T.border}`,borderRadius:6,background:T.bg,color:T.text2,cursor:'pointer',fontFamily:'inherit'}}>Collapse all</button>
        <div style={{flex:1}}/>
        <span style={{fontSize:11,color:T.text3}}>Total · Global · Japan</span>
      </div>

      <div style={{background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,overflow:'hidden',marginBottom:16}}>
        <div style={{padding:'10px 14px 8px',borderBottom:`1px solid ${T.border}`}}>
          <div style={{fontWeight:700,fontSize:13.5,color:T.text}}>Demand funnel — Total, Global and Japan</div>
          <div style={{fontSize:11.5,color:T.text3,marginTop:2}}>Volume at each stage with the step conversion into it · prior month beneath each figure</div>
        </div>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}>
            <colgroup>
              <col style={{width:'25%'}}/>
              <col style={{width:'25%'}}/>
              <col style={{width:'25%'}}/>
              <col style={{width:'25%'}}/>
            </colgroup>
            <thead>
              <tr>
                <th style={{...TH,textAlign:'left',paddingLeft:14}}>Scope / Stage</th>
                <th style={{...TH}}>Volume<br/><span style={{fontWeight:400,opacity:.8}}>prior month</span></th>
                <th style={{...TH}}>Step Conversion</th>
                <th style={{...TH}}>vs Prior Month<br/><span style={{fontWeight:400,opacity:.8}}>step change</span></th>
              </tr>
            </thead>
            <tbody>
              {scopes.map(({scope, cur, base})=>{
                const open=isOpen(scope)
                const color=SCOPE_COLOR[scope]
                const stages=[
                  {label:'Inquiries',   cur:cur.inq,       base:base.inq,       step:null                              },
                  {label:'Service trips',cur:cur.trips,     base:base.trips,     step:cur.inq>0?cur.trips/cur.inq:null  },
                  {label:'Not cancelled',cur:cur.trips-cur.cancelled, base:base.trips-base.cancelled,
                    step:cur.trips>0?(cur.trips-cur.cancelled)/cur.trips:null },
                  {label:'Completed trips',cur:cur.completed, base:base.completed,
                    step:(cur.trips-cur.cancelled)>0?cur.completed/(cur.trips-cur.cancelled):null },
                ]
                const endToEnd=cur.inq>0?cur.completed/cur.inq:null
                const eToPrior=base.inq>0?base.completed/base.inq:null
                const eToChange=endToEnd!==null&&eToPrior!==null?endToEnd-eToPrior:null
                return (
                  <Fragment key={scope}>
                    {/* Group header */}
                    <tr style={{...ROW,background:T.bg,cursor:'pointer'}} onClick={()=>toggle(scope)}>
                      <td style={{...TD,paddingLeft:14}}>
                        <div style={{display:'flex',alignItems:'flex-start',gap:5}}>
                          <span style={{fontSize:10,color:T.text3,marginTop:3,flexShrink:0}}>{open?'▼':'▶'}</span>
                          <div>
                            <div style={{display:'flex',alignItems:'center',gap:5,flexWrap:'nowrap'}}>
                              <span style={{color,fontSize:11,flexShrink:0}}>●</span>
                              <span style={{fontWeight:700,fontSize:13}}>{scopeLabel(scope)}</span>
                              <span style={{fontSize:10,color:T.text3,flexShrink:0}}>{STAGES.length}</span>
                            </div>
                            <div style={{fontSize:10.5,color:T.text3,marginTop:2,whiteSpace:'nowrap'}}>
                              {numFmt(cur.inq)} in → {numFmt(cur.completed)} completed
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{...TD,textAlign:'right'}}>
                        <div style={{fontWeight:700}}>{numFmt(cur.completed)}</div>
                        <div style={{fontSize:10.5,color:T.text3}}>{numFmt(base.completed)}</div>
                      </td>
                      <td style={{...TD,textAlign:'right'}}>
                        {miniBar(endToEnd,color)}
                        {endToEnd!==null&&<span style={{fontSize:11,marginLeft:4}}>{pct(endToEnd,2)}</span>}
                      </td>
                      <td style={{...TD,textAlign:'right'}}>
                        {eToChange!==null&&(
                          <div style={{color:eToChange>=0?T.green:T.red,fontWeight:600}}>
                            {(eToChange*100>=0?'+':'')+((eToChange||0)*100).toFixed(1)+'%'}
                          </div>
                        )}
                        <div style={{fontSize:10.5,color:T.text3}}>end to end</div>
                      </td>
                    </tr>
                    {/* Stage rows */}
                    {open&&stages.map((st,si)=>{
                      const vsP=base[Object.keys({inq:1,trips:1})[si]]
                      const curN=st.cur, baseN=st.base
                      const chg=baseN!==0?(curN-baseN)/Math.abs(baseN):null
                      const stepCur=st.step
                      const stepBase = si===1?( base.inq>0?base.trips/base.inq:null ) :
                                       si===2?( base.trips>0?(base.trips-base.cancelled)/base.trips:null ) :
                                       si===3?( (base.trips-base.cancelled)>0?base.completed/(base.trips-base.cancelled):null ) : null
                      const stepChg=stepCur!==null&&stepBase!==null?stepCur-stepBase:null
                      return (
                        <tr key={st.label} style={{...ROW,background:T.bg}}>
                          <td style={{...TD,paddingLeft:36,color:T.text2,fontSize:12}}>{st.label}</td>
                          <td style={{...TD,textAlign:'right'}}>
                            <div style={{fontWeight:500,fontVariantNumeric:'tabular-nums'}}>{numFmt(curN)}</div>
                            <div style={{fontSize:10.5,color:T.text3}}>{numFmt(baseN)}</div>
                          </td>
                          <td style={{...TD,textAlign:'right'}}>
                            {si===0?<span style={{color:T.text3,fontSize:11}}>entry point</span>:(
                              <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:4}}>
                                {miniBar(stepCur,color)}
                                <span style={{fontSize:11}}>{pct(stepCur,1)}</span>
                              </div>
                            )}
                          </td>
                          <td style={{...TD,textAlign:'right'}}>
                            {chg!==null?(
                              <div style={{color:chg>=0?T.green:T.red,fontWeight:600,fontSize:12}}>
                                {(chg*100>=0?'+':'')+((chg||0)*100).toFixed(1)+'%'}
                              </div>
                            ):<span style={{color:T.text3}}>—</span>}
                            {stepChg!==null&&(
                              <div style={{fontSize:10.5,color:T.text3}}>
                                {pts(stepChg,2)} step
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Economics table
// ─────────────────────────────────────────────────────────────────────────────
function EconTable({scopes}){
  const COLS=[
    {key:'rev',    label:'Complete GMV',      sub:'prior',  invert:false, fmt:usdC},
    {key:'cost',   label:'Cost',              sub:'prior',  invert:true,  fmt:usdC},
    {key:'profit', label:'Profit',            sub:'prior',  invert:false, fmt:usdC},
    {key:'margin', label:'Profit Margin',     sub:'prior',  invert:false, fmt:v=>pct(v,1)},
    {key:'completion',label:'Completion Rate',sub:'prior',  invert:false, fmt:v=>pct(v,1)},
    {key:'cancelRate',label:'Cancel Rate',    sub:'prior',  invert:true,  fmt:v=>pct(v,1)},
    {key:'revPerTrip',label:'GMV / completed trip',sub:null,invert:false, fmt:v=>v?usd(v,2):'—'},
  ]

  function cell(cur, base, col){
    const cv=cur[col.key], bv=base[col.key]
    const fmtd=cv!==null&&cv!==undefined?col.fmt(cv):'—'
    const bfmt=bv!==null&&bv!==undefined?col.fmt(bv):null
    let chg=null
    if(cv!==null&&bv!==null&&bv!==0){
      chg = col.key==='margin'||col.key==='completion'||col.key==='cancelRate'
        ? cv-bv
        : (cv-bv)/Math.abs(bv)
    }
    const good = col.invert ? (chg!==null&&chg<0) : (chg!==null&&chg>0)
    const bad  = col.invert ? (chg!==null&&chg>0) : (chg!==null&&chg<0)
    const col2 = good?T.green:bad?T.red:T.text3
    const isPct = col.key==='margin'||col.key==='completion'||col.key==='cancelRate'
    const chgStr = chg===null?null: isPct
      ? pts(chg,1)
      : (chg>=0?'+':'')+((chg||0)*100).toFixed(1)+'%'
    return (
      <td style={{...TD,textAlign:'right'}}>
        <div style={{fontWeight:600,fontVariantNumeric:'tabular-nums'}}>{fmtd}</div>
        {bfmt&&<div style={{fontSize:10.5,color:T.text3}}>{bfmt}</div>}
      </td>
    )
  }

  return (
    <div style={{background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,overflow:'hidden',marginBottom:16}}>
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed',minWidth:820}}>
          <colgroup>
            <col style={{width:'18%'}}/>{/* Scope */}
            <col style={{width:'11.71%'}}/>{/* Complete GMV */}
            <col style={{width:'11.71%'}}/>{/* Cost */}
            <col style={{width:'11.71%'}}/>{/* Profit */}
            <col style={{width:'11.71%'}}/>{/* Profit Margin */}
            <col style={{width:'11.71%'}}/>{/* Completion Rate */}
            <col style={{width:'11.71%'}}/>{/* Cancel Rate */}
            <col style={{width:'11.71%'}}/>{/* GMV / trip */}
          </colgroup>
          <thead>
            <tr>
              <th style={{...TH,textAlign:'left',paddingLeft:14}}>Scope</th>
              {COLS.map(c=>(
                <th key={c.key} style={TH}>{c.label}{c.sub&&<><br/><span style={{fontWeight:400,opacity:.8}}>{c.sub}</span></>}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scopes.map(({scope,cur,base})=>(
              <tr key={scope} style={ROW}>
                <td style={{...TD,paddingLeft:14}}>
                  <div style={{display:'flex',alignItems:'center',gap:5,flexWrap:'nowrap'}}>
                    <span style={{color:SCOPE_COLOR[scope],fontSize:11,flexShrink:0}}>●</span>
                    <span style={{fontSize:12.5,color:T.text2,whiteSpace:'nowrap'}}>{scopeLabel(scope)}</span>
                  </div>
                </td>
                {COLS.map(c=>cell(cur,base,c))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Quality section — incident rate
// ─────────────────────────────────────────────────────────────────────────────
const INC_TARGET = 0.01 // §7: 1.00%

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
// AI engineering section — static §8.8
// ─────────────────────────────────────────────────────────────────────────────
function AISection(){
  const CARD_SM = {...CARD,flex:1,minWidth:140}
  return (
    <div>
      <div style={{fontSize:9,fontWeight:700,color:T.text3,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:10,display:'flex',alignItems:'center',gap:10}}>
        <span>Engineering — AI-Generated Share</span>
        <span style={{background:T.amber,color:'#fff',fontSize:9,fontWeight:700,padding:'2px 8px',borderRadius:10}}>STATIC · AUG 3–9</span>
        <div style={{flex:1,height:'1px',background:T.border}}/>
      </div>
      <div style={{display:'flex',gap:14,flexWrap:'wrap',alignItems:'flex-start'}}>
        <div style={CARD_SM}>
          <div style={{fontSize:10.5,fontWeight:600,color:T.text3,marginBottom:6}}>AI Code %</div>
          <div style={{fontSize:26,fontWeight:700,color:T.text}}>93.0%</div>
          <div style={{fontSize:11,color:T.red,marginTop:4}}>−2.70 pts WoW · prior 95.70%</div>
        </div>
        <div style={CARD_SM}>
          <div style={{fontSize:10.5,fontWeight:600,color:T.text3,marginBottom:6}}>AI Test %</div>
          <div style={{fontSize:26,fontWeight:700,color:T.red}}>26.5%</div>
          <div style={{fontSize:11,color:T.red,marginTop:4}}>−18.10 pts WoW · prior 44.60%</div>
        </div>

      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Section divider
// ─────────────────────────────────────────────────────────────────────────────
function SectionLabel({children}){
  return (
    <div style={{fontSize:9,fontWeight:700,color:T.text3,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:10,display:'flex',alignItems:'center',gap:10}}>
      <span>{children}</span>
      <div style={{flex:1,height:'1px',background:T.border}}/>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function RideHailingTab({D, period, CUR_MONTH, PM}){
  const [rhOpen, setRhOpen] = useState(()=>{
    try{ return JSON.parse(localStorage.getItem('eam.rhOpen')||'{}') }catch{ return {} }
  })

  function setAndPersist(fn){
    setRhOpen(prev=>{
      const next=typeof fn==='function'?fn(prev):fn
      try{localStorage.setItem('eam.rhOpen',JSON.stringify(next))}catch{}
      return next
    })
  }

  const sets = useMemo(()=>rhMonthSets(period,CUR_MONTH),[period,CUR_MONTH])

  const rhRows = D.rh  || []
  const incRows= D.inc || []

  // §8.2 Empty state — only if query returned nothing
  if(!rhRows.length){
    return (
      <div>
        <h1 style={{fontSize:20,fontWeight:700,color:T.text,margin:'0 0 6px'}}>Ride Hailing &amp; Quality</h1>
        <div style={{fontSize:13,color:T.text3,marginBottom:20}}>Live from ads_ride_dispatch_v. Follows the period selector.</div>
        <div style={{background:T.bg2,border:`1px solid ${T.border}`,borderRadius:10,padding:'20px 24px',color:T.text3,fontSize:13,lineHeight:1.8}}>
          <strong style={{color:T.text}}>Ride hailing data has not loaded yet.</strong>
          {' '}BigQuery Q_RH returned nothing. Press <strong>Refresh</strong> with the dashboard visible to reload.
        </div>
      </div>
    )
  }

  // Build aggregates for each scope × period
  const scopeData = useMemo(()=>{
    return SCOPES.map(scope=>({
      scope,
      cur:  rhAgg(rhRows, sets.cur,  scope),
      base: rhAgg(rhRows, sets.base, scope),
    }))
  },[rhRows, sets])

  // Convenience refs
  const totC = scopeData.find(s=>s.scope==='Total')?.cur  || {}
  const totB = scopeData.find(s=>s.scope==='Total')?.base || {}
  const glbC = scopeData.find(s=>s.scope==='Global')?.cur || {}
  const jpC  = scopeData.find(s=>s.scope==='Japan')?.cur  || {}

  // Incident rate
  const incC  = useMemo(()=>incAgg(incRows,sets.cur), [incRows,sets])
  const incB  = useMemo(()=>incAgg(incRows,sets.base),[incRows,sets])

  const delta = (c,b) => b&&b!==0?(c-b)/Math.abs(b):null

  const pmLabel = PM?.label || 'current period'

  return (
    <div>
      {/* §8.1 Header */}
      <div style={{marginBottom:18}}>
        <h1 style={{fontSize:20,fontWeight:700,color:T.text,margin:'0 0 4px'}}>Ride Hailing &amp; Quality</h1>
        <div style={{fontSize:13,color:T.text3,lineHeight:1.6}}>
          Live from <code style={{fontSize:11.5,background:'#f4f2ed',padding:'1px 4px',borderRadius:3}}>ads_ride_dispatch_v</code>.
          Follows the period selector.
        </div>
      </div>

      {/* Scope legend */}
      <div style={{display:'flex',alignItems:'center',gap:16,marginBottom:16}}>
        {SCOPES.filter(s=>s!=='Total').map(s=>(
          <span key={s} style={{fontSize:12,color:T.text3}}>
            <span style={{color:SCOPE_COLOR[s],marginRight:4}}>■</span>{s}
          </span>
        ))}
        <div style={{flex:1}}/>
        <span style={{fontSize:11.5,color:T.text3,background:T.bg2,border:`1px solid ${T.border}`,borderRadius:8,padding:'4px 12px'}}>
          {pmLabel} · vs {PM?.base?.toLowerCase()||'prior'}
        </span>
      </div>

      {/* §8.3 Demand funnel KPIs */}
      <SectionLabel>Demand Funnel</SectionLabel>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
        <KpiTile label="Inquiry Numbers"
          totVal={numFmt(totC.inq)} totColor={T.text}
          delta={delta(totC.inq,totB.inq)} priorVal={numFmt(totB.inq)}
          g={numFmt(glbC.inq)} j={numFmt(jpC.inq)}
        />
        <KpiTile label="Service Trips"
          totVal={numFmt(totC.trips)} totColor={T.text}
          delta={delta(totC.trips,totB.trips)} priorVal={numFmt(totB.trips)}
          g={numFmt(glbC.trips)} j={numFmt(jpC.trips)}
        />
        <KpiTile label="Completed Trips"
          totVal={numFmt(totC.completed)} totColor={T.text}
          delta={delta(totC.completed,totB.completed)} priorVal={numFmt(totB.completed)}
          g={numFmt(glbC.completed)} j={numFmt(jpC.completed)}
        />
        <KpiTile label="Complete GMV"
          totVal={usdC(totC.rev)} totColor={T.text}
          delta={delta(totC.rev,totB.rev)} priorVal={usdC(totB.rev)}
          g={usdC(glbC.rev)} j={usdC(jpC.rev)}
        />
      </div>

      {/* §8.4 Conversion — separate section, booking-date basis */}
      <SectionLabel>Conversion — Booking Basis</SectionLabel>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:24}}>
        <KpiTile label="Sales Trips"
          totVal={numFmt(totC.salesTrips)} totColor={T.text}
          delta={delta(totC.salesTrips,totB.salesTrips)} priorVal={numFmt(totB.salesTrips)}
          g={numFmt(glbC.salesTrips)} j={numFmt(jpC.salesTrips)}
        />
      </div>

      {/* §8.5 Demand funnel table */}
      <FunnelTable scopes={scopeData} rhOpen={rhOpen} setRhOpen={setAndPersist}/>

      {/* §8.6 Economics table */}
      <SectionLabel>Economics — Total, Global and Japan</SectionLabel>
      <EconTable scopes={scopeData}/>

      {/* §8.7 Quality */}
      <SectionLabel>Margin &amp; Quality — Partner Incident Rate (Lost)</SectionLabel>
      <QualityTable inc={incC} incBase={incB} PM={PM}/>

      {/* §8.8 AI engineering */}
      <AISection/>
    </div>
  )
}
