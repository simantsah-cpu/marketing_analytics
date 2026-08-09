/**
 * B2CTab.jsx — Weekly EAM Performance, B2C tab
 * Spec: ORBIT_B2C_SPEC.md
 *
 * §0 Non-negotiables:
 *  - Spend is stored GBP, converted USD by dividing by rate. SQL handles this.
 *  - platform IN ('APP','WEB') filtered in SQL — no other values reach client.
 *  - Profit = actual_profit + estimate_profit (IFNULL on each).
 *  - Attribution gap (bookings > 0 but sessions == 0) separated before table.
 *  - Two brands (Hoppa, Elife) never combined.
 *  - No reconstruction caveat.
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
  amber:'#EAB308', amberBg:'rgba(234,179,8,.10)', amberInk:'#9A6B0C',
  lift:'0 1px 2px rgba(26,26,24,.05), 0 6px 16px -6px rgba(26,26,24,.10)',
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function num(v){ const x=(v===null||v===undefined||v==='')?NaN:Number(v); return isFinite(x)?x:0 }

function usd(v,d=0){
  const x=num(v)
  return '$'+x.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})
}
function usdC(v){
  const x=num(v),a=Math.abs(x),s=x<0?'-$':'$'
  if(a>=1e6)return s+(a/1e6).toFixed(2)+'M'
  if(a>=1e5)return s+(a/1e3).toFixed(0)+'k'
  if(a>=1e3)return s+(a/1e3).toFixed(1)+'k'
  return s+a.toFixed(a<10?2:0)
}
function numFmt(v,d=0){
  const x=num(v)
  return x.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})
}
function pct(v,d=1){
  if(v===null||!isFinite(Number(v)))return '—'
  return (num(v)*100).toFixed(d)+'%'
}
function deltaSign(v){ return v>0?'+':''; }
function deltaColor(v, invert=false){
  if(!isFinite(v))return T.text3
  const good = invert ? v < 0 : v > 0
  return good ? T.green : v===0 ? T.text3 : T.red
}

// Channel split classification (§5)
function splitOf(r){
  if(num(r.sessions)===0 && num(r.bookings)>0) return 'Attribution gap'
  if(num(r.spend_usd)>0) return 'Paid'
  return 'Unpaid'
}

const SPLIT_COLOR  = { Paid:T.blue, Unpaid:T.green, 'Attribution gap':T.amber }
const SPLIT_NOTE   = { Paid:'bought traffic', Unpaid:'organic, direct, email', 'Attribution gap':'no session data — not investable' }
const SPLIT_ORDER  = ['Paid','Unpaid','Attribution gap']

// ─────────────────────────────────────────────────────────────────────────────
// §3 — Period resolution
// ─────────────────────────────────────────────────────────────────────────────
const ym = (y,m) => `${y}-${String(m).padStart(2,'0')}`

function prevYm(period){
  let y=+period.slice(0,4),m=+period.slice(5,7)-1
  if(m<=0){m+=12;y-=1}
  return ym(y,m)
}

function b2cMonthSets(period, CUR_MONTH){
  const y=+CUR_MONTH.slice(0,4), mo=+CUR_MONTH.slice(5,7)
  const isMonth = k => /^\d{4}-\d{2}$/.test(k??'')

  if(isMonth(period)){
    return { cur:[period], base:[prevYm(period)] }
  }
  if(period==='qtd'){
    const qs = Math.floor((mo-1)/3)*3+1
    const cur=[],base=[]
    for(let i=qs;i<=mo;i++) cur.push(ym(y,i))
    for(let j=0;j<cur.length;j++){
      let pm=qs-3+j,py=y
      if(pm<=0){pm+=12;py-=1}
      base.push(ym(py,pm))
    }
    return {cur,base}
  }
  if(period==='ytd'){
    const c=[],b=[]
    for(let k=1;k<=mo;k++){c.push(ym(y,k));b.push(ym(y-1,k))}
    return {cur:c,base:b}
  }
  return null // 'mtd' → use Q_B2C with its own day-range logic
}

// ─────────────────────────────────────────────────────────────────────────────
// §4 — Aggregation helpers
// ─────────────────────────────────────────────────────────────────────────────
function b2cRowsFor(D, brand, periodKey, platform, sets){
  // periodKey: 'MTD' (current) or 'LM' (base)
  if(sets){
    const want = periodKey==='MTD' ? sets.cur : sets.base
    return (D.b2cM||[]).filter(r=>
      r.brand===brand &&
      want.includes(r.ym) &&
      (platform==='ALL' || r.platform===platform)
    )
  }
  return (D.b2c||[]).filter(r=>
    r.brand===brand &&
    r.period===periodKey &&
    (platform==='ALL' || r.platform===platform)
  )
}

function b2cAgg(rows){
  const o={sessions:0,bookings:0,ttv:0,est_profit:0,spend_usd:0}
  rows.forEach(r=>{
    o.sessions  +=num(r.sessions)
    o.bookings  +=num(r.bookings)
    o.ttv       +=num(r.ttv)
    o.est_profit+=num(r.est_profit)
    o.spend_usd +=num(r.spend_usd)
  })
  o.cvr  = o.sessions>0 ? o.bookings/o.sessions : null
  o.atv  = o.bookings>0 ? o.ttv/o.bookings : null
  o.amv  = o.bookings>0 ? o.est_profit/o.bookings : null
  o.net  = o.est_profit - o.spend_usd
  o.ncpb = o.bookings>0 ? o.net/o.bookings : null
  o.roi  = o.spend_usd>0 ? o.net/o.spend_usd : null // null when no spend; break-even=1.00x
  return o
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI tile components
// ─────────────────────────────────────────────────────────────────────────────
const CARD = {
  background:T.bg, borderRadius:12, boxShadow:T.lift,
  border:`1px solid ${T.border}`, padding:'16px 18px 14px',
}

function KpiTile({label, value, delta, deltaLabel, sub, footer, footerVal, invertDelta, valueColor}){
  const dNum = num(delta)
  const dCol = deltaColor(dNum, invertDelta)
  return (
    <div style={CARD}>
      <div style={{fontSize:11,fontWeight:600,color:T.text3,marginBottom:6,textTransform:'uppercase',letterSpacing:'0.06em'}}>{label}</div>
      <div style={{fontSize:26,fontWeight:700,color:valueColor||T.text,lineHeight:1.1,marginBottom:4}}>{value}</div>
      {delta!==undefined&&(
        <div style={{fontSize:11.5,color:dCol,marginBottom:2}}>
          <span style={{fontWeight:600}}>{deltaSign(dNum)}{typeof delta==='number'?(num(delta)*100).toFixed(1)+'%':delta}</span>
          <span style={{color:T.text3}}>&nbsp;{deltaLabel}</span>
        </div>
      )}
      {sub&&<div style={{fontSize:11,color:T.text3,marginBottom:4}}>{sub}</div>}
      {footer&&(
        <div style={{marginTop:10,paddingTop:8,borderTop:`1px solid ${T.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{fontSize:10.5,color:T.text3}}>{footer}</span>
          <span style={{fontSize:13,fontWeight:700,color:T.text,fontVariantNumeric:'tabular-nums'}}>{footerVal}</span>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel table for one brand
// ─────────────────────────────────────────────────────────────────────────────
const TH = {
  padding:'7px 10px',fontSize:10,fontWeight:600,color:T.text3,
  textTransform:'uppercase',letterSpacing:'0.05em',
  background:T.bg2,borderBottom:`1px solid ${T.border}`,
  whiteSpace:'nowrap',textAlign:'right',cursor:'pointer',userSelect:'none',
}
const TD = { padding:'8px 10px',fontSize:12.5,verticalAlign:'middle' }
const ROW = { borderBottom:`1px solid ${T.border}` }

function sortChannels(rows, col, dir){
  return [...rows].sort((a,b)=>{
    let va=0,vb=0
    if(col==='sessions'){ va=num(a.sessions); vb=num(b.sessions) }
    else if(col==='bookings'){ va=num(a.bookings); vb=num(b.bookings) }
    else if(col==='est_profit'){ va=num(a.est_profit); vb=num(b.est_profit) }
    else if(col==='spend'){ va=num(a.spend_usd); vb=num(b.spend_usd) }
    else if(col==='net'){ va=num(a._net); vb=num(b._net) }
    return dir==='asc' ? va-vb : vb-va
  })
}

function ChannelTable({brand, curRows, baseMap, b2cOpen, setB2cOpen}){
  const [sortCol, setSortCol] = useState('net')
  const [sortDir, setSortDir] = useState('desc')

  // Annotate each row with derived metrics + split
  const annotated = useMemo(()=>{
    return curRows.map(r=>{
      const base = baseMap[`${r.channel}|${r.platform}`] || {}
      const net  = num(r.est_profit)-num(r.spend_usd)
      const roi  = num(r.spend_usd)>0 ? net/num(r.spend_usd) : null
      const cvr  = num(r.sessions)>0 ? num(r.bookings)/num(r.sessions) : null
      const atv  = num(r.bookings)>0 ? num(r.ttv)/num(r.bookings) : null
      const amv  = num(r.bookings)>0 ? num(r.est_profit)/num(r.bookings) : null
      return {...r, _net:net, _roi:roi, _cvr:cvr, _atv:atv, _amv:amv,
              split:splitOf(r)}
    })
  },[curRows,baseMap])

  // Group — fixed order, sort within each group
  const groups = useMemo(()=>{
    return SPLIT_ORDER.map(split=>{
      const ch = sortChannels(annotated.filter(r=>r.split===split), sortCol, sortDir)
      if(!ch.length)return null
      const g = {sessions:0,bookings:0,ttv:0,est_profit:0,spend_usd:0}
      ch.forEach(r=>{ g.sessions+=num(r.sessions); g.bookings+=num(r.bookings);
        g.ttv+=num(r.ttv); g.est_profit+=num(r.est_profit); g.spend_usd+=num(r.spend_usd) })
      g.net = g.est_profit-g.spend_usd
      g.roi = g.spend_usd>0 ? g.net/g.spend_usd : null
      g.cvr = g.sessions>0 ? g.bookings/g.sessions : null
      g.atv = g.bookings>0 ? g.ttv/g.bookings : null
      g.amv = g.bookings>0 ? g.est_profit/g.bookings : null
      return {split, rows:ch, agg:g}
    }).filter(Boolean)
  },[annotated,sortCol,sortDir])

  // Totals
  const tot = useMemo(()=>{
    const t={sessions:0,bookings:0,ttv:0,est_profit:0,spend_usd:0}
    annotated.forEach(r=>{t.sessions+=num(r.sessions);t.bookings+=num(r.bookings);
      t.ttv+=num(r.ttv);t.est_profit+=num(r.est_profit);t.spend_usd+=num(r.spend_usd)})
    t.net=t.est_profit-t.spend_usd;t.roi=t.spend_usd>0?t.net/t.spend_usd:null
    t.cvr=t.sessions>0?t.bookings/t.sessions:null
    t.atv=t.bookings>0?t.ttv/t.bookings:null
    t.amv=t.bookings>0?t.est_profit/t.bookings:null
    return t
  },[annotated])

  // Attribution gap note
  const attrGap = groups.find(g=>g.split==='Attribution gap')
  const totalChannels = annotated.length
  const totalSplits   = groups.length

  function toggleAll(open){
    const next={...b2cOpen}
    SPLIT_ORDER.forEach(s=>{ next[`${brand}|${s}`]=open })
    setB2cOpen(next)
  }
  function isOpen(split){
    const k=`${brand}|${split}`
    return b2cOpen[k]===undefined ? true : !!b2cOpen[k]
  }
  function toggle(split){
    const k=`${brand}|${split}`
    setB2cOpen(prev=>({...prev,[k]:!isOpen(split)}))
  }

  function handleSort(col){
    if(sortCol===col) setSortDir(d=>d==='desc'?'asc':'desc')
    else { setSortCol(col); setSortDir('desc') }
  }
  const arrow = col => sortCol===col ? (sortDir==='desc'?'▼':'▲') : ''

  // Session/Conv cell for row
  function sesCell(r){
    if(r.split==='Attribution gap') return <div style={{fontSize:11,color:T.text3}}>n/a<br/><span style={{fontSize:10}}>—</span></div>
    return (
      <div style={{textAlign:'right'}}>
        <div style={{fontVariantNumeric:'tabular-nums',fontWeight:500}}>{numFmt(r.sessions)}</div>
        <div style={{fontSize:10.5,color:T.text3}}>{pct(r._cvr,2)}</div>
      </div>
    )
  }
  function bookCell(r){
    return (
      <div style={{textAlign:'right'}}>
        <div style={{fontVariantNumeric:'tabular-nums',fontWeight:500}}>{numFmt(r.bookings,0)}</div>
        <div style={{fontSize:10.5,color:T.text3}}>{r._atv?usd(r._atv,1):'—'}</div>
      </div>
    )
  }
  function profitCell(r){
    return (
      <div style={{textAlign:'right'}}>
        <div style={{fontVariantNumeric:'tabular-nums',fontWeight:500}}>{usdC(r.est_profit)}</div>
        <div style={{fontSize:10.5,color:T.text3}}>{r._amv?usd(r._amv,1):'—'}</div>
      </div>
    )
  }
  function spendCell(r){
    if(!num(r.spend_usd)) return <div style={{textAlign:'right',color:T.text3,fontSize:11}}>—</div>
    return <div style={{textAlign:'right',fontVariantNumeric:'tabular-nums',fontWeight:500}}>{usdC(r.spend_usd)}</div>
  }
  function netCell(r){
    const net=r._net,roi=r._roi
    const col = net>0?T.green:net<0?T.red:T.text3
    return (
      <div style={{textAlign:'right'}}>
        <div style={{color:col,fontVariantNumeric:'tabular-nums',fontWeight:700}}>{usdC(net)}</div>
        <div style={{fontSize:10.5,color:roi===null?T.text3:roi>=1?T.green:T.red}}>
          {roi===null?'no spend':`${roi.toFixed(2)}x`}
        </div>
      </div>
    )
  }

  // Group-level cells (same pattern as row cells but for agg object)
  function sesGrp(g){
    if(g.split==='Attribution gap') return <div style={{textAlign:'right',color:T.text3}}>n/a<br/><span style={{fontSize:10}}>—</span></div>
    return (
      <div style={{textAlign:'right'}}>
        <div style={{fontVariantNumeric:'tabular-nums',fontWeight:700}}>{numFmt(g.agg.sessions)}</div>
        <div style={{fontSize:10.5,color:T.text3}}>{pct(g.agg.cvr,2)}</div>
      </div>
    )
  }
  function bookGrp(g){
    return (
      <div style={{textAlign:'right'}}>
        <div style={{fontVariantNumeric:'tabular-nums',fontWeight:700}}>{numFmt(g.agg.bookings,0)}</div>
        <div style={{fontSize:10.5,color:T.text3}}>{g.agg.atv?usd(g.agg.atv,1):'—'}</div>
      </div>
    )
  }
  function profitGrp(g){
    return (
      <div style={{textAlign:'right'}}>
        <div style={{fontVariantNumeric:'tabular-nums',fontWeight:700}}>{usdC(g.agg.est_profit)}</div>
        <div style={{fontSize:10.5,color:T.text3}}>{g.agg.amv?usd(g.agg.amv,1):'—'}</div>
      </div>
    )
  }
  function netGrp(g){
    const net=g.agg.net,roi=g.agg.roi
    const col=net>0?T.green:net<0?T.red:T.text3
    return (
      <div style={{textAlign:'right'}}>
        <div style={{color:col,fontVariantNumeric:'tabular-nums',fontWeight:700}}>{usdC(net)}</div>
        <div style={{fontSize:10.5,color:roi===null?T.text3:roi>=1?T.green:T.red}}>
          {roi===null?'no spend':`${roi.toFixed(2)}x`}
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Controls */}
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
        <button onClick={()=>toggleAll(true)} style={{fontSize:12,fontWeight:600,padding:'5px 12px',border:`1px solid ${T.border}`,borderRadius:6,background:T.bg,color:T.text2,cursor:'pointer',fontFamily:'inherit'}}>Expand all</button>
        <button onClick={()=>toggleAll(false)} style={{fontSize:12,fontWeight:600,padding:'5px 12px',border:`1px solid ${T.border}`,borderRadius:6,background:T.bg,color:T.text2,cursor:'pointer',fontFamily:'inherit'}}>Collapse all</button>
        <div style={{flex:1}}/>
        <span style={{fontSize:11,color:T.text3}}>{totalChannels} channels · {totalSplits} splits</span>
      </div>

      {/* Table card */}
      <div style={{background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,overflow:'hidden',marginBottom:14}}>
        {/* Section heading */}
        <div style={{padding:'12px 14px 10px',borderBottom:`1px solid ${T.border}`}}>
          <div style={{fontWeight:700,fontSize:14,color:T.text}}>{brand} — channel contribution</div>
          <div style={{fontSize:11.5,color:T.text3,marginTop:2}}>Grouped by whether the traffic was bought · sorted by net contribution within each split</div>
        </div>

        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}>
            <colgroup>
              <col style={{width:'26%'}}/>  {/* Split / Channel */}
              <col style={{width:'14.8%'}}/>{/* Sessions */}
              <col style={{width:'14.8%'}}/>{/* Bookings */}
              <col style={{width:'14.8%'}}/>{/* Est. Profit */}
              <col style={{width:'14.8%'}}/>{/* Spend */}
              <col style={{width:'14.8%'}}/>{/* Net Contribution */}
            </colgroup>
            <thead>
              <tr>
                <th style={{...TH,textAlign:'left',paddingLeft:14}}>Split / Channel</th>
                <th style={{...TH}} onClick={()=>handleSort('sessions')}>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:1}}>
                    <span>Sessions {arrow('sessions')}</span>
                    <span style={{fontWeight:400,opacity:.8,fontSize:9}}>conv %</span>
                  </div>
                </th>
                <th style={{...TH}} onClick={()=>handleSort('bookings')}>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:1}}>
                    <span>Bookings {arrow('bookings')}</span>
                    <span style={{fontWeight:400,opacity:.8,fontSize:9}}>ATV</span>
                  </div>
                </th>
                <th style={{...TH}} onClick={()=>handleSort('est_profit')}>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:1}}>
                    <span>Est. Profit {arrow('est_profit')}</span>
                    <span style={{fontWeight:400,opacity:.8,fontSize:9}}>AMV</span>
                  </div>
                </th>
                <th style={{...TH}} onClick={()=>handleSort('spend')}>Spend USD {arrow('spend')}</th>
                <th style={{...TH}} onClick={()=>handleSort('net')}>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:1}}>
                    <span>Net Contribution {arrow('net')} ▾</span>
                    <span style={{fontWeight:400,opacity:.8,fontSize:9}}>ROI</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g=>{
                const open=isOpen(g.split)
                const swCol=SPLIT_COLOR[g.split]
                return (
                  <Fragment key={g.split}>
                    {/* Group row */}
                    <tr style={{...ROW,background:T.bg}} onClick={()=>toggle(g.split)}>
                      <td style={{...TD,paddingLeft:14,cursor:'pointer'}}>
                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                          <span style={{fontSize:10,color:T.text3}}>{open?'▼':'▶'}</span>
                          <span style={{display:'inline-block',width:9,height:9,borderRadius:2,background:swCol,flexShrink:0}}/>
                          <span style={{fontWeight:600,fontSize:13}}>{g.split}</span>
                          <span style={{fontSize:10,color:T.text3,marginLeft:4}}>{g.rows.length}</span>
                          <span style={{fontSize:10.5,fontStyle:'italic',color:T.text3,marginLeft:4}}>{SPLIT_NOTE[g.split]}</span>
                        </div>
                      </td>
                      <td style={{...TD}}>{sesGrp(g)}</td>
                      <td style={{...TD}}>{bookGrp(g)}</td>
                      <td style={{...TD}}>{profitGrp(g)}</td>
                      <td style={{...TD,textAlign:'right'}}>
                        {num(g.agg.spend_usd)>0 ? <span style={{fontVariantNumeric:'tabular-nums',fontWeight:700}}>{usdC(g.agg.spend_usd)}</span> : <span style={{color:T.text3,fontSize:11}}>—</span>}
                      </td>
                      <td style={{...TD}}>{netGrp(g)}</td>
                    </tr>

                    {/* Child rows */}
                    {open && g.rows.map(r=>(
                      <tr key={`${r.channel}|${r.platform}`} style={{...ROW,background:T.bg}}
                        onMouseEnter={e=>e.currentTarget.style.background='#EFF6FF'}
                        onMouseLeave={e=>e.currentTarget.style.background=T.bg}>
                        <td style={{...TD,paddingLeft:32}}>
                          <div style={{fontSize:12.5,color:T.text2}}>{r.channel}</div>
                          <div style={{fontSize:10,color:T.text3}}>{r.platform}</div>
                        </td>
                        <td style={{...TD}}>{sesCell(r)}</td>
                        <td style={{...TD}}>{bookCell(r)}</td>
                        <td style={{...TD}}>{profitCell(r)}</td>
                        <td style={{...TD}}>{spendCell(r)}</td>
                        <td style={{...TD}}>{netCell(r)}</td>
                      </tr>
                    ))}
                  </Fragment>
                )
              })}

              {/* Total row */}
              <tr style={{background:T.bg,borderTop:`2px solid ${T.border}`}}>
                <td style={{...TD,paddingLeft:14,fontWeight:700}}>{brand} total</td>
                <td style={{...TD}}>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontVariantNumeric:'tabular-nums',fontWeight:700}}>{numFmt(tot.sessions)}</div>
                    <div style={{fontSize:10.5,color:T.text3}}>{pct(tot.cvr,2)}</div>
                  </div>
                </td>
                <td style={{...TD}}>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontVariantNumeric:'tabular-nums',fontWeight:700}}>{numFmt(tot.bookings,0)}</div>
                    <div style={{fontSize:10.5,color:T.text3}}>{tot.atv?usd(tot.atv,1):'—'}</div>
                  </div>
                </td>
                <td style={{...TD}}>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontVariantNumeric:'tabular-nums',fontWeight:700}}>{usdC(tot.est_profit)}</div>
                    <div style={{fontSize:10.5,color:T.text3}}>{tot.amv?usd(tot.amv,1):'—'}</div>
                  </div>
                </td>
                <td style={{...TD,textAlign:'right',fontVariantNumeric:'tabular-nums',fontWeight:700}}>
                  {num(tot.spend_usd)>0?usdC(tot.spend_usd):<span style={{color:T.text3}}>—</span>}
                </td>
                <td style={{...TD}}>
                  <div style={{textAlign:'right'}}>
                    <div style={{color:tot.net>0?T.green:tot.net<0?T.red:T.text3,fontWeight:700,fontVariantNumeric:'tabular-nums'}}>{usdC(tot.net)}</div>
                    <div style={{fontSize:10.5,color:tot.roi===null?T.text3:tot.roi>=1?T.green:T.red}}>
                      {tot.roi===null?'no spend':`${tot.roi.toFixed(2)}x`}
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>


    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-brand section
// ─────────────────────────────────────────────────────────────────────────────
function BrandSection({brand, D, period, CUR_MONTH, platform, PM, b2cOpen, setB2cOpen}){
  const sets = useMemo(()=>b2cMonthSets(period, CUR_MONTH),[period,CUR_MONTH])
  const usingMonthly = !!sets

  // §7 — empty state logic
  const srcEmpty  = usingMonthly ? !(D.b2cM||[]).length : !(D.b2c||[]).length
  const anyBrand  = (usingMonthly?(D.b2cM||[]):(D.b2c||[])).some(r=>r.brand===brand)
  const anyPlat   = (usingMonthly?(D.b2cM||[]):(D.b2c||[])).some(r=>r.brand===brand&&(platform==='ALL'||r.platform===platform))

  let emptyMsg = null
  if(srcEmpty){
    emptyMsg = `Data has not loaded yet. The ${usingMonthly?'monthly':'month-to-date'} B2C query returned nothing. Press Refresh with the dashboard visible.`
  } else if(!anyBrand){
    emptyMsg = `${brand} has no rows at all in the source table for any period.`
  } else if(!anyPlat){
    emptyMsg = `${brand} has no ${platform==='APP'?'App':'Web'} rows. Switch the platform filter to All to see its other traffic.`
  }

  // Aggregate current and base
  const curRows = useMemo(()=>b2cRowsFor(D,brand,'MTD',platform,sets),[D,brand,platform,sets])
  const lmRows  = useMemo(()=>b2cRowsFor(D,brand,'LM',platform,sets),[D,brand,platform,sets])
  const cur = useMemo(()=>b2cAgg(curRows),[curRows])
  const lm  = useMemo(()=>b2cAgg(lmRows),[lmRows])

  // Per-channel base lookup map for table
  const baseMap = useMemo(()=>{
    const m={}
    lmRows.forEach(r=>{ m[`${r.channel}|${r.platform}`]=r })
    return m
  },[lmRows])

  const perLabel = PM?.label || 'current period'
  const baseLabel = (PM?.base||'prev').toLowerCase()

  // Delta helpers
  const pDelta = (cur,lm) => lm&&lm!==0 ? (cur-lm)/Math.abs(lm) : null

  const platChip = platform!=='ALL' ? (
    <span style={{marginLeft:8,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:10,background:T.blueBg,color:T.blue,letterSpacing:'0.04em'}}>{platform==='APP'?'App':'Web'}</span>
  ) : null

  return (
    <div style={{marginBottom:32}}>
      {/* Section label */}
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,marginTop:8}}>
        <span style={{fontSize:10,fontWeight:700,color:T.text3,textTransform:'uppercase',letterSpacing:'0.07em'}}>{brand} B2C Metrics</span>
        {platChip}
        <div style={{flex:1,height:'1px',background:T.border}}/>
      </div>

      {emptyMsg ? (
        <div style={{background:T.bg2,border:`1px solid ${T.border}`,borderRadius:8,padding:'14px 18px',color:T.text3,fontSize:13,lineHeight:1.7}}>{emptyMsg}</div>
      ) : (
        <>
          {/* Demand funnel */}
          <div style={{fontSize:9,fontWeight:700,color:T.text3,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:8,display:'flex',alignItems:'center',gap:10}}>
            <span>Demand Funnel</span>
            <div style={{flex:1,height:'1px',background:T.border}}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:14}}>
            <KpiTile
              label="Sessions" value={numFmt(cur.sessions)}
              delta={pDelta(cur.sessions,lm.sessions)} deltaLabel="vs prev"
              sub={`LM ${numFmt(lm.sessions)}`}
            />
            <KpiTile
              label="Bookings" value={numFmt(cur.bookings,0)}
              delta={pDelta(cur.bookings,lm.bookings)} deltaLabel="vs prev"
              sub={`LM ${numFmt(lm.bookings,0)}`}
            />
            <KpiTile
              label="Conversion Rate" value={pct(cur.cvr,2)}
              delta={cur.cvr!==null&&lm.cvr!==null?cur.cvr-lm.cvr:null} deltaLabel="vs prev"
              sub={`LM ${pct(lm.cvr,2)}`}
            />
            <KpiTile
              label="TTV" value={usdC(cur.ttv)}
              delta={pDelta(cur.ttv,lm.ttv)} deltaLabel="vs prev"
              sub={`LM ${usdC(lm.ttv)}`}
              footer="Avg ticket (ATV)" footerVal={cur.atv?usd(cur.atv,1):'—'}
            />
          </div>

          {/* Unit economics */}
          <div style={{fontSize:9,fontWeight:700,color:T.text3,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:8,display:'flex',alignItems:'center',gap:10}}>
            <span>Unit Economics</span>
            <div style={{flex:1,height:'1px',background:T.border}}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
            <KpiTile
              label="Est. Profit" value={usdC(cur.est_profit)}
              delta={pDelta(cur.est_profit,lm.est_profit)} deltaLabel="vs prev"
              sub={`LM ${usdC(lm.est_profit)}`}
              footer="Per booking (AMV)" footerVal={cur.amv?usd(cur.amv,1):'—'}
            />
            <KpiTile
              label="Spend (USD)" value={usdC(cur.spend_usd)}
              delta={pDelta(cur.spend_usd,lm.spend_usd)} deltaLabel="vs prev"
              sub={`LM ${usdC(lm.spend_usd)}`}
              footer="Share of profit" footerVal={cur.est_profit>0?pct(cur.spend_usd/cur.est_profit,0):'—'}
              invertDelta={true}
            />
            <KpiTile
              label="Net Contribution" value={usdC(cur.net)}
              valueColor={cur.net>0?T.green:cur.net<0?T.red:T.text}
              delta={pDelta(cur.net,lm.net)} deltaLabel="vs prev · Profit less spend"
              sub={`LM ${usdC(lm.net)}`}
              footer="Per booking (NCPB)" footerVal={cur.ncpb?usd(cur.ncpb,1):'—'}
            />
            <KpiTile
              label="ROI" value={cur.roi!==null?`${cur.roi.toFixed(2)}x`:'—'}
              valueColor={cur.roi!==null?(cur.roi>=1?T.green:T.red):T.text3}
              delta={cur.roi!==null&&lm.roi!==null?pDelta(cur.roi,lm.roi):null} deltaLabel="vs prev"
              sub={lm.roi!==null?`LM ${lm.roi.toFixed(2)}x`:undefined}
              footer="Break-even" footerVal="1.00x"
            />
          </div>

          {/* Channel table */}
          {curRows.length>0&&(
            <ChannelTable
              brand={brand}
              curRows={curRows}
              baseMap={baseMap}
              b2cOpen={b2cOpen}
              setB2cOpen={setB2cOpen}
            />
          )}
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function B2CTab({D, period, CUR_MONTH, PC, PM}){
  const [platform, setPlatform] = useState('ALL')
  const [b2cOpen, setB2cOpen] = useState(()=>{
    try { return JSON.parse(localStorage.getItem('eam.b2cOpen')||'{}') }
    catch{ return {} }
  })

  // Persist b2cOpen
  function setAndPersistOpen(fn){
    setB2cOpen(prev=>{
      const next = typeof fn==='function' ? fn(prev) : fn
      try{ localStorage.setItem('eam.b2cOpen',JSON.stringify(next)) }catch{}
      return next
    })
  }

  const sets = useMemo(()=>b2cMonthSets(period,CUR_MONTH),[period,CUR_MONTH])
  const usingMonthly = !!sets

  const periodLabel  = PM?.label  || 'current period'
  const baseLabel    = (PM?.base  || 'prev').toLowerCase()
  const subtitle     = `Hoppa and Elife direct channels — ${periodLabel} versus ${baseLabel}`

  const platLabel = platform==='APP'?'App only':platform==='WEB'?'Web only':'App + Web'

  return (
    <div>
      {/* Header */}
      <div style={{marginBottom:18,display:'flex',alignItems:'flex-start',gap:12}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <h1 style={{fontSize:20,fontWeight:700,color:T.text,margin:0}}>B2C Performance</h1>
            <span style={{fontSize:10,fontWeight:700,padding:'3px 8px',borderRadius:10,background:T.greenBg,color:T.green,letterSpacing:'0.05em'}}>LIVE</span>
          </div>
          <div style={{fontSize:13,color:T.text3,marginTop:4}}>{subtitle}</div>
        </div>
      </div>

      {/* Platform toggle */}
      <div style={{marginBottom:20}}>
        <div style={{fontSize:10,fontWeight:600,color:T.text3,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:6}}>Platform</div>
        <div style={{display:'flex',alignItems:'center',gap:0}}>
          <div style={{display:'flex',border:`1px solid ${T.border}`,borderRadius:8,overflow:'hidden'}}>
            {['ALL','APP','WEB'].map(p=>(
              <button key={p} onClick={()=>setPlatform(p)} style={{
                padding:'6px 16px',fontSize:12.5,fontWeight:600,fontFamily:'inherit',cursor:'pointer',
                border:'none',borderRight:p!=='WEB'?`1px solid ${T.border}`:'none',
                background:platform===p?T.blue:T.bg,
                color:platform===p?'#fff':T.text2,
                transition:'all .15s',
              }}>
                {p==='ALL'?'All':p==='APP'?'App':'Web'}
              </button>
            ))}
          </div>
          <div style={{flex:1}}/>
          <span style={{fontSize:11.5,color:T.text3,background:T.bg2,border:`1px solid ${T.border}`,borderRadius:8,padding:'5px 12px'}}>
            Showing {platLabel}
          </span>
        </div>
      </div>

      {/* Hoppa */}
      <BrandSection
        brand="Hoppa" D={D} period={period} CUR_MONTH={CUR_MONTH}
        platform={platform} PM={PM}
        b2cOpen={b2cOpen} setB2cOpen={setAndPersistOpen}
      />

      {/* Elife */}
      <BrandSection
        brand="Elife" D={D} period={period} CUR_MONTH={CUR_MONTH}
        platform={platform} PM={PM}
        b2cOpen={b2cOpen} setB2cOpen={setAndPersistOpen}
      />
    </div>
  )
}
