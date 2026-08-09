/**
 * B2CTab.jsx — Weekly EAM Performance, B2C tab
 * Spec: ORBIT_B2C_SPEC.md (full rebuild Aug 2026)
 *
 * §0 Non-negotiables:
 *  - Spend is stored GBP, converted to USD by SQL (divide by gbp_usd rate). SQL handles this.
 *  - platform IN ('APP','WEB') filtered in SQL — no other values reach client.
 *  - Profit = actual_profit + estimate_profit (IFNULL on each). SQL handles this.
 *  - Channel classification happens AFTER aggregating platform away (§5.0).
 *  - Attribution gap (bookings > 0, sessions == 0) separated; never mixed with Paid/Unpaid.
 *  - Two brands (Hoppa, Elife) never combined.
 *  - No reconstruction caveat — booking_date is exact.
 */

import { useState, useMemo, Fragment } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────────────────────────────────────
const T = {
  bg:'#ffffff', bg2:'#FAFBFC', bg3:'#F1F5F9', bg4:'#E2EAF0',
  text:'#1A2B3C', text2:'#374151', text3:'#64748B',
  border:'#E2EAF0', border2:'#B8C4D0',
  green:'#1D9E75', greenBg:'rgba(29,158,117,.09)',
  blue:'#185FA5',  blueBg:'rgba(24,95,165,.09)',
  red:'#E24B4A',   redBg:'rgba(226,75,74,.09)',
  amber:'#EAB308', amberBg:'rgba(234,179,8,.10)', amberInk:'#9A6B0C',
  lift:'0 1px 2px rgba(26,26,24,.05), 0 6px 16px -6px rgba(26,26,24,.10)',
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatters
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
  return num(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})
}
function pct(v,d=1){
  if(v===null||!isFinite(Number(v)))return '—'
  return (num(v)*100).toFixed(d)+'%'
}
function deltaColor(v, invert=false){
  if(!isFinite(v))return T.text3
  const good = invert ? v < 0 : v > 0
  return good ? T.green : v===0 ? T.text3 : T.red
}
function signedPct(v){
  if(v===null||!isFinite(Number(v)))return null
  return (v>0?'+':'')+(num(v)*100).toFixed(1)+'%'
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 — Channel classification. Happens on the CHANNEL-LEVEL aggregate (post §5.0 collapse).
// ─────────────────────────────────────────────────────────────────────────────
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
const ymStr = (y,m) => `${y}-${String(m).padStart(2,'0')}`

function prevYmOf(period){
  let y=+period.slice(0,4),m=+period.slice(5,7)-1
  if(m<=0){m+=12;y-=1}
  return ymStr(y,m)
}

function b2cMonthSets(period, CUR_MONTH){
  const y=+CUR_MONTH.slice(0,4), mo=+CUR_MONTH.slice(5,7)
  const isMonth = k => /^\d{4}-\d{2}$/.test(k??'')

  if(isMonth(period)){
    return { cur:[period], base:[prevYmOf(period)] }
  }
  if(period==='qtd'){
    const qs = Math.floor((mo-1)/3)*3+1
    const cur=[],base=[]
    for(let i=qs;i<=mo;i++) cur.push(ymStr(y,i))
    for(let j=0;j<cur.length;j++){
      let pm=qs-3+j,py=y
      if(pm<=0){pm+=12;py-=1}
      base.push(ymStr(py,pm))
    }
    return {cur,base}
  }
  if(period==='ytd'){
    const c=[],b=[]
    for(let k=1;k<=mo;k++){c.push(ymStr(y,k));b.push(ymStr(y-1,k))}
    return {cur:c,base:b}
  }
  return null // 'mtd' → use Q_B2C which has its own day-range logic
}

// ─────────────────────────────────────────────────────────────────────────────
// §4 — Raw row selection
// periodKey: 'MTD' = current window, 'LM' = base window
// ─────────────────────────────────────────────────────────────────────────────
function b2cRawRows(D, brand, periodKey, platform, sets){
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

// §4 — Aggregate a set of raw rows to a single summary object
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
// §5.0 — Aggregate raw (channel, platform) rows to channel grain BEFORE classifying.
// Returns array of channel objects, each with a `platforms` array (sub-rows).
// This is the load-bearing step that makes "Paid Search" appear once, not twice.
// ─────────────────────────────────────────────────────────────────────────────
function buildChannelRows(rawRows){
  const chMap = {}
  rawRows.forEach(r=>{
    const k = r.channel ?? r.marketing_channel ?? 'Untracked'
    if(!chMap[k]) chMap[k] = {
      channel:k, sessions:0, bookings:0, ttv:0,
      est_profit:0, spend_usd:0, platforms:[]
    }
    chMap[k].sessions   += num(r.sessions)
    chMap[k].bookings   += num(r.bookings)
    chMap[k].ttv        += num(r.ttv)
    chMap[k].est_profit += num(r.est_profit)
    chMap[k].spend_usd  += num(r.spend_usd)
    chMap[k].platforms.push(r) // keep platform sub-rows for drilling down
  })
  // Derive metrics and classify on the channel aggregate
  return Object.values(chMap).map(c=>{
    c.cvr   = c.sessions>0 ? c.bookings/c.sessions : null
    c.atv   = c.bookings>0 ? c.ttv/c.bookings : null
    c.amv   = c.bookings>0 ? c.est_profit/c.bookings : null
    c.net   = c.est_profit - c.spend_usd
    c.ncpb  = c.bookings>0 ? c.net/c.bookings : null
    c.roi   = c.spend_usd>0 ? c.net/c.spend_usd : null
    c.split = splitOf(c)  // classify on channel-level agg, not per platform row
    return c
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI tile
// ─────────────────────────────────────────────────────────────────────────────
const CARD = {
  background:T.bg, borderRadius:12, boxShadow:T.lift,
  border:`1px solid ${T.border}`, padding:'16px 18px 14px',
}

function KpiTile({ label, value, valueColor, deltaFrac, deltaAbs, baseLabel, baseVal, footer, footerVal, invertDelta }){
  // deltaFrac: fractional change (e.g. 0.12 = +12%); deltaAbs: raw absolute delta for CVR
  const hasDelta = deltaFrac !== null && deltaFrac !== undefined && isFinite(deltaFrac)
  const hasAbsDelta = deltaAbs !== null && deltaAbs !== undefined && isFinite(deltaAbs)
  const dVal = hasDelta ? deltaFrac : (hasAbsDelta ? deltaAbs : null)
  const dCol = dVal !== null ? deltaColor(dVal, invertDelta) : T.text3
  const dStr = hasDelta ? signedPct(deltaFrac)
             : hasAbsDelta ? ((deltaAbs>0?'+':'')+pct(deltaAbs,2))
             : null
  return (
    <div style={CARD}>
      <div style={{fontSize:11,fontWeight:600,color:T.text3,marginBottom:6,textTransform:'uppercase',letterSpacing:'0.06em'}}>{label}</div>
      <div style={{fontSize:26,fontWeight:700,color:valueColor||T.text,lineHeight:1.1,marginBottom:4}}>{value}</div>
      {dStr && (
        <div style={{fontSize:11.5,color:dCol,marginBottom:2}}>
          <span style={{fontWeight:600}}>{dStr}</span>
          <span style={{color:T.text3}}>&nbsp;vs {baseLabel}</span>
        </div>
      )}
      {baseVal && <div style={{fontSize:11,color:T.text3,marginBottom:4}}>{baseLabel} {baseVal}</div>}
      {footer && (
        <div style={{marginTop:10,paddingTop:8,borderTop:`1px solid ${T.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{fontSize:10.5,color:T.text3}}>{footer}</span>
          <span style={{fontSize:13,fontWeight:700,color:T.text,fontVariantNumeric:'tabular-nums'}}>{footerVal}</span>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel table — 3-level: Split → Channel → Platform sub-row
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
    const get = r => col==='sessions'?num(r.sessions):col==='bookings'?num(r.bookings):
                     col==='est_profit'?num(r.est_profit):col==='spend'?num(r.spend_usd):
                     col==='net'?r.net:0
    return dir==='asc' ? get(a)-get(b) : get(b)-get(a)
  })
}

function SesCell({r, isGrp}){
  const fw = isGrp ? 700 : 500
  if(r.split==='Attribution gap') return (
    <div style={{textAlign:'right',color:T.text3}}>
      <div style={{fontWeight:fw}}>—</div>
      <div style={{fontSize:10.5}}>n/a</div>
    </div>
  )
  return (
    <div style={{textAlign:'right'}}>
      <div style={{fontVariantNumeric:'tabular-nums',fontWeight:fw}}>{numFmt(r.sessions)}</div>
      <div style={{fontSize:10.5,color:T.text3}}>{pct(r.cvr,2)}</div>
    </div>
  )
}
function BookCell({r, isGrp}){
  const fw = isGrp ? 700 : 500
  return (
    <div style={{textAlign:'right'}}>
      <div style={{fontVariantNumeric:'tabular-nums',fontWeight:fw}}>{numFmt(r.bookings,0)}</div>
      <div style={{fontSize:10.5,color:T.text3}}>{r.atv?usd(r.atv,1):'—'}</div>
    </div>
  )
}
function ProfitCell({r, isGrp}){
  const fw = isGrp ? 700 : 500
  return (
    <div style={{textAlign:'right'}}>
      <div style={{fontVariantNumeric:'tabular-nums',fontWeight:fw}}>{usdC(r.est_profit)}</div>
      <div style={{fontSize:10.5,color:T.text3}}>{r.amv?usd(r.amv,1):'—'}</div>
    </div>
  )
}
function SpendCell({r, isGrp}){
  const fw = isGrp ? 700 : 500
  if(!num(r.spend_usd)) return <div style={{textAlign:'right',color:T.text3,fontSize:11}}>—</div>
  return <div style={{textAlign:'right',fontVariantNumeric:'tabular-nums',fontWeight:fw}}>{usdC(r.spend_usd)}</div>
}
function NetCell({r, isGrp}){
  const fw = isGrp ? 700 : 500
  const col = r.net>0?T.green:r.net<0?T.red:T.text3
  return (
    <div style={{textAlign:'right'}}>
      <div style={{color:col,fontVariantNumeric:'tabular-nums',fontWeight:fw}}>{usdC(r.net)}</div>
      <div style={{fontSize:10.5,color:r.roi===null?T.text3:r.roi>=1?T.green:T.red}}>
        {r.roi===null?'no spend':`${r.roi.toFixed(2)}x`}
      </div>
    </div>
  )
}

function ChannelTable({ brand, channelRows, b2cOpen, setB2cOpen }){
  const [sortCol, setSortCol] = useState('net')
  const [sortDir, setSortDir] = useState('desc')
  // Per-channel open state (3rd level: platform sub-rows)
  const [chanOpen, setChanOpen] = useState({})

  function toggleChan(channel){
    setChanOpen(prev=>({...prev,[channel]:!prev[channel]}))
  }

  // Groups — fixed SPLIT_ORDER; sort within each group only
  const groups = useMemo(()=>{
    return SPLIT_ORDER.map(split=>{
      const ch = sortChannels(channelRows.filter(r=>r.split===split), sortCol, sortDir)
      if(!ch.length)return null
      // Group-level aggregate
      const g = {sessions:0,bookings:0,ttv:0,est_profit:0,spend_usd:0}
      ch.forEach(r=>{ g.sessions+=num(r.sessions); g.bookings+=num(r.bookings);
        g.ttv+=num(r.ttv); g.est_profit+=num(r.est_profit); g.spend_usd+=num(r.spend_usd) })
      g.net  = g.est_profit - g.spend_usd
      g.roi  = g.spend_usd>0 ? g.net/g.spend_usd : null
      g.cvr  = g.sessions>0 ? g.bookings/g.sessions : null
      g.atv  = g.bookings>0 ? g.ttv/g.bookings : null
      g.amv  = g.bookings>0 ? g.est_profit/g.bookings : null
      g.split = split
      return {split, rows:ch, agg:g}
    }).filter(Boolean)
  },[channelRows, sortCol, sortDir])

  // Brand totals
  const tot = useMemo(()=>{
    const t={sessions:0,bookings:0,ttv:0,est_profit:0,spend_usd:0}
    channelRows.forEach(r=>{t.sessions+=num(r.sessions);t.bookings+=num(r.bookings);
      t.ttv+=num(r.ttv);t.est_profit+=num(r.est_profit);t.spend_usd+=num(r.spend_usd)})
    t.net=t.est_profit-t.spend_usd
    t.roi=t.spend_usd>0?t.net/t.spend_usd:null
    t.cvr=t.sessions>0?t.bookings/t.sessions:null
    t.atv=t.bookings>0?t.ttv/t.bookings:null
    t.amv=t.bookings>0?t.est_profit/t.bookings:null
    return t
  },[channelRows])

  function isSplitOpen(split){
    const k=`${brand}|${split}`
    return b2cOpen[k]===undefined ? true : !!b2cOpen[k]
  }
  function toggleSplit(split){
    const k=`${brand}|${split}`
    setB2cOpen(prev=>({...prev,[k]:!isSplitOpen(split)}))
  }
  function toggleAll(open){
    const next={...b2cOpen}
    SPLIT_ORDER.forEach(s=>{ next[`${brand}|${s}`]=open })
    setB2cOpen(next)
  }

  function handleSort(col){
    if(sortCol===col) setSortDir(d=>d==='desc'?'asc':'desc')
    else { setSortCol(col); setSortDir('desc') }
  }
  const arrow = col => sortCol===col ? (sortDir==='desc'?'▼':'▲') : ''

  const totalChannels = channelRows.length

  return (
    <div>
      {/* Controls */}
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
        <button onClick={()=>toggleAll(true)} style={{fontSize:12,fontWeight:600,padding:'5px 12px',border:`1px solid ${T.border}`,borderRadius:6,background:T.bg,color:T.text2,cursor:'pointer',fontFamily:'inherit'}}>Expand all</button>
        <button onClick={()=>toggleAll(false)} style={{fontSize:12,fontWeight:600,padding:'5px 12px',border:`1px solid ${T.border}`,borderRadius:6,background:T.bg,color:T.text2,cursor:'pointer',fontFamily:'inherit'}}>Collapse all</button>
        <div style={{flex:1}}/>
        <span style={{fontSize:11,color:T.text3}}>{totalChannels} channel{totalChannels!==1?'s':''} · {groups.length} group{groups.length!==1?'s':''}</span>
      </div>

      {/* Table card */}
      <div style={{background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,overflow:'hidden',marginBottom:14}}>
        <div style={{padding:'12px 14px 10px',borderBottom:`1px solid ${T.border}`}}>
          <div style={{fontWeight:700,fontSize:14,color:T.text}}>{brand} — channel contribution</div>
          <div style={{fontSize:11.5,color:T.text3,marginTop:2}}>
            Grouped by traffic type (Paid / Unpaid / Attribution gap) · channels aggregated across platforms before classification · sorted by net contribution within group
          </div>
        </div>

        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}>
            <colgroup>
              <col style={{width:'26%'}}/>
              <col style={{width:'14.8%'}}/>
              <col style={{width:'14.8%'}}/>
              <col style={{width:'14.8%'}}/>
              <col style={{width:'14.8%'}}/>
              <col style={{width:'14.8%'}}/>
            </colgroup>
            <thead>
              <tr>
                <th style={{...TH,textAlign:'left',paddingLeft:14}}>Group / Channel / Platform</th>
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
                    <span>Net Contribution {arrow('net')}</span>
                    <span style={{fontWeight:400,opacity:.8,fontSize:9}}>ROI (net-basis)</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g=>{
                const open = isSplitOpen(g.split)
                const swCol = SPLIT_COLOR[g.split]
                return (
                  <Fragment key={g.split}>
                    {/* ── Split / group row ── */}
                    <tr style={{...ROW,background:T.bg2,cursor:'pointer'}} onClick={()=>toggleSplit(g.split)}>
                      <td style={{...TD,paddingLeft:14,fontWeight:600}}>
                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                          <span style={{fontSize:10,color:T.text3,lineHeight:1}}>{open?'▼':'▶'}</span>
                          <span style={{display:'inline-block',width:9,height:9,borderRadius:2,background:swCol,flexShrink:0}}/>
                          <span style={{fontWeight:700,fontSize:13}}>{g.split}</span>
                          <span style={{fontSize:10,color:T.text3,background:T.bg4,borderRadius:8,padding:'1px 6px'}}>{g.rows.length}</span>
                          <span style={{fontSize:10.5,fontStyle:'italic',color:T.text3}}>{SPLIT_NOTE[g.split]}</span>
                        </div>
                      </td>
                      <td style={{...TD}}><SesCell r={g.agg} isGrp/></td>
                      <td style={{...TD}}><BookCell r={g.agg} isGrp/></td>
                      <td style={{...TD}}><ProfitCell r={g.agg} isGrp/></td>
                      <td style={{...TD}}><SpendCell r={g.agg} isGrp/></td>
                      <td style={{...TD}}><NetCell r={g.agg} isGrp/></td>
                    </tr>

                    {/* ── Channel rows (level 2) ── */}
                    {open && g.rows.map(chan=>{
                      const cOpen = chanOpen[chan.channel]
                      const hasPlats = chan.platforms.length > 1
                      return (
                        <Fragment key={chan.channel}>
                          <tr style={{...ROW,background:T.bg}}
                            onClick={hasPlats ? ()=>toggleChan(chan.channel) : undefined}
                            onMouseEnter={e=>{e.currentTarget.style.background='#EFF6FF'}}
                            onMouseLeave={e=>{e.currentTarget.style.background=T.bg}}
                          >
                            <td style={{...TD,paddingLeft:30,cursor:hasPlats?'pointer':'default'}}>
                              <div style={{display:'flex',alignItems:'center',gap:6}}>
                                {hasPlats && (
                                  <span style={{fontSize:9,color:T.text3,lineHeight:1}}>{cOpen?'▼':'▶'}</span>
                                )}
                                <div>
                                  <div style={{fontSize:12.5,color:T.text,fontWeight:500}}>{chan.channel}</div>
                                  {hasPlats && (
                                    <div style={{fontSize:10,color:T.text3}}>{chan.platforms.length} platforms</div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td style={{...TD}}><SesCell r={chan}/></td>
                            <td style={{...TD}}><BookCell r={chan}/></td>
                            <td style={{...TD}}><ProfitCell r={chan}/></td>
                            <td style={{...TD}}><SpendCell r={chan}/></td>
                            <td style={{...TD}}><NetCell r={chan}/></td>
                          </tr>

                          {/* ── Platform sub-rows (level 3) ── */}
                          {hasPlats && cOpen && chan.platforms.map(pr=>{
                            const platSessions = num(pr.sessions)
                            const platBookings = num(pr.bookings)
                            const platNet = num(pr.est_profit) - num(pr.spend_usd)
                            const platRoi = num(pr.spend_usd)>0 ? platNet/num(pr.spend_usd) : null
                            const platCvr = platSessions>0 ? platBookings/platSessions : null
                            const platAtv = platBookings>0 ? num(pr.ttv)/platBookings : null
                            const platAmv = platBookings>0 ? num(pr.est_profit)/platBookings : null
                            const platR = {
                              sessions:platSessions, bookings:platBookings, ttv:num(pr.ttv),
                              est_profit:num(pr.est_profit), spend_usd:num(pr.spend_usd),
                              net:platNet, roi:platRoi, cvr:platCvr, atv:platAtv, amv:platAmv,
                              split:chan.split // inherit parent split for SesCell attribution-gap check
                            }
                            return (
                              <tr key={pr.platform} style={{...ROW,background:T.bg3}}
                                onMouseEnter={e=>{e.currentTarget.style.background='#E8F0FB'}}
                                onMouseLeave={e=>{e.currentTarget.style.background=T.bg3}}
                              >
                                <td style={{...TD,paddingLeft:52}}>
                                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                                    <span style={{
                                      fontSize:9.5,fontWeight:700,padding:'2px 7px',borderRadius:5,letterSpacing:'0.05em',
                                      background:pr.platform==='APP'?T.blueBg:T.greenBg,
                                      color:pr.platform==='APP'?T.blue:T.green,
                                    }}>{pr.platform}</span>
                                    <span style={{fontSize:11,color:T.text3,fontStyle:'italic'}}>platform breakdown</span>
                                  </div>
                                </td>
                                <td style={{...TD}}><SesCell r={platR}/></td>
                                <td style={{...TD}}><BookCell r={platR}/></td>
                                <td style={{...TD}}><ProfitCell r={platR}/></td>
                                <td style={{...TD}}><SpendCell r={platR}/></td>
                                <td style={{...TD}}><NetCell r={platR}/></td>
                              </tr>
                            )
                          })}
                        </Fragment>
                      )
                    })}
                  </Fragment>
                )
              })}

              {/* Total row */}
              <tr style={{background:T.bg,borderTop:`2px solid ${T.border2}`}}>
                <td style={{...TD,paddingLeft:14,fontWeight:700,color:T.text}}>{brand} total</td>
                <td style={{...TD}}><SesCell r={tot} isGrp/></td>
                <td style={{...TD}}><BookCell r={tot} isGrp/></td>
                <td style={{...TD}}><ProfitCell r={tot} isGrp/></td>
                <td style={{...TD}}><SpendCell r={tot} isGrp/></td>
                <td style={{...TD}}><NetCell r={tot} isGrp/></td>
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
function BrandSection({ brand, D, period, CUR_MONTH, platform, PM, b2cOpen, setB2cOpen }){
  const sets = useMemo(()=>b2cMonthSets(period, CUR_MONTH),[period,CUR_MONTH])
  const usingMonthly = !!sets

  // §7 — four distinct empty-state causes
  const srcEmpty  = usingMonthly ? !(D.b2cM||[]).length : !(D.b2c||[]).length
  const anyBrand  = (usingMonthly?(D.b2cM||[]):(D.b2c||[])).some(r=>r.brand===brand)
  const anyPlat   = (usingMonthly?(D.b2cM||[]):(D.b2c||[])).some(r=>
    r.brand===brand && (platform==='ALL' || r.platform===platform))

  let emptyMsg = null
  if(srcEmpty){
    emptyMsg = `Data has not loaded yet. The ${usingMonthly?'monthly':'month-to-date'} B2C query returned nothing. Press Refresh with the dashboard visible.`
  } else if(!anyBrand){
    emptyMsg = `${brand} has no rows at all in the source table for any period.`
  } else if(!anyPlat){
    emptyMsg = `${brand} has no ${platform==='APP'?'App':'Web'} rows. Switch the platform filter to All to see its other traffic.`
  }
  // 4th case: has data for platform, just nothing for this period — handled by curRows.length === 0 below

  // Raw rows for current and base windows
  const curRaw = useMemo(()=>b2cRawRows(D,brand,'MTD',platform,sets),[D,brand,platform,sets])
  const lmRaw  = useMemo(()=>b2cRawRows(D,brand,'LM',platform,sets),[D,brand,platform,sets])

  // Top-level aggregates (all channels combined)
  const cur = useMemo(()=>b2cAgg(curRaw),[curRaw])
  const lm  = useMemo(()=>b2cAgg(lmRaw),[lmRaw])

  // §5.0 — aggregate to channel grain BEFORE classifying (for table)
  const channelRows = useMemo(()=>buildChannelRows(curRaw),[curRaw])

  const bShort = PM?.baseShort || 'prev'
  const bLabel = (PM?.base || 'prev period').toLowerCase()

  // Fractional delta helper
  const fDelta = (c,b) => (b!==0 && b!==null && isFinite(b)) ? (c-b)/Math.abs(b) : null

  const platChip = platform!=='ALL' ? (
    <span style={{marginLeft:8,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:10,
      background:T.blueBg,color:T.blue,letterSpacing:'0.04em'}}>
      {platform==='APP'?'App':'Web'}
    </span>
  ) : null

  return (
    <div style={{marginBottom:36}}>
      {/* Section label */}
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,marginTop:8}}>
        <span style={{fontSize:10,fontWeight:700,color:T.text3,textTransform:'uppercase',letterSpacing:'0.07em',whiteSpace:'nowrap'}}>
          {brand} B2C Metrics
        </span>
        {platChip}
        <div style={{flex:1,height:'1px',background:T.border}}/>
      </div>

      {emptyMsg ? (
        <div style={{background:T.bg2,border:`1px solid ${T.border}`,borderRadius:8,padding:'14px 18px',color:T.text3,fontSize:13,lineHeight:1.7}}>
          {emptyMsg}
        </div>
      ) : curRaw.length === 0 ? (
        <div style={{background:T.bg2,border:`1px solid ${T.border}`,borderRadius:8,padding:'14px 18px',color:T.text3,fontSize:13,lineHeight:1.7}}>
          No {brand} activity recorded for {PM?.label || period}.
          {platform!=='ALL' && ` (Filtered to ${platform==='APP'?'App':'Web'} only.)`}
        </div>
      ) : (
        <>
          {/* ── Demand funnel ── */}
          <div style={{fontSize:9,fontWeight:700,color:T.text3,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:8,display:'flex',alignItems:'center',gap:10}}>
            <span>Demand Funnel</span>
            <div style={{flex:1,height:'1px',background:T.border}}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:14}}>
            <KpiTile
              label="Sessions" value={numFmt(cur.sessions)}
              deltaFrac={fDelta(cur.sessions,lm.sessions)} baseLabel={bShort}
              baseVal={numFmt(lm.sessions)}
            />
            <KpiTile
              label="Bookings" value={numFmt(cur.bookings,0)}
              deltaFrac={fDelta(cur.bookings,lm.bookings)} baseLabel={bShort}
              baseVal={numFmt(lm.bookings,0)}
            />
            <KpiTile
              label="Conversion Rate" value={pct(cur.cvr,2)}
              deltaAbs={cur.cvr!==null&&lm.cvr!==null?cur.cvr-lm.cvr:null} baseLabel={bShort}
              baseVal={pct(lm.cvr,2)}
            />
            <KpiTile
              label="TTV" value={usdC(cur.ttv)}
              deltaFrac={fDelta(cur.ttv,lm.ttv)} baseLabel={bShort}
              baseVal={usdC(lm.ttv)}
              footer="Avg ticket (ATV)" footerVal={cur.atv?usd(cur.atv,1):'—'}
            />
          </div>

          {/* ── Unit economics ── */}
          <div style={{fontSize:9,fontWeight:700,color:T.text3,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:8,display:'flex',alignItems:'center',gap:10}}>
            <span>Unit Economics</span>
            <div style={{flex:1,height:'1px',background:T.border}}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
            <KpiTile
              label="Est. Profit" value={usdC(cur.est_profit)}
              deltaFrac={fDelta(cur.est_profit,lm.est_profit)} baseLabel={bShort}
              baseVal={usdC(lm.est_profit)}
              footer="Per booking (AMV)" footerVal={cur.amv?usd(cur.amv,1):'—'}
            />
            <KpiTile
              label="Spend (USD)" value={usdC(cur.spend_usd)}
              deltaFrac={fDelta(cur.spend_usd,lm.spend_usd)} baseLabel={bShort}
              baseVal={usdC(lm.spend_usd)}
              footer="Share of profit" footerVal={cur.est_profit>0?pct(cur.spend_usd/cur.est_profit,0):'—'}
              invertDelta={true}
            />
            <KpiTile
              label="Net Contribution" value={usdC(cur.net)}
              valueColor={cur.net>0?T.green:cur.net<0?T.red:T.text}
              deltaFrac={fDelta(cur.net,lm.net)} baseLabel={bShort}
              baseVal={usdC(lm.net)}
              footer="Per booking (NCPB)" footerVal={cur.ncpb?usd(cur.ncpb,1):'—'}
            />
            <KpiTile
              label="ROI" value={cur.roi!==null?`${cur.roi.toFixed(2)}x`:'—'}
              valueColor={cur.roi!==null?(cur.roi>=1?T.green:T.red):T.text3}
              deltaFrac={cur.roi!==null&&lm.roi!==null?fDelta(cur.roi,lm.roi):null} baseLabel={bShort}
              baseVal={lm.roi!==null?`${lm.roi.toFixed(2)}x`:undefined}
              footer="Break-even" footerVal="1.00x"
            />
          </div>

          {/* ── Channel table ── */}
          {channelRows.length > 0 && (
            <ChannelTable
              brand={brand}
              channelRows={channelRows}
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
// Main B2CTab component
// ─────────────────────────────────────────────────────────────────────────────
export default function B2CTab({ D, period, CUR_MONTH, PC, PM }){
  const [platform, setPlatform] = useState('ALL')
  const [b2cOpen, setB2cOpen] = useState(()=>{
    try { return JSON.parse(localStorage.getItem('eam.b2cOpen')||'{}') }
    catch{ return {} }
  })

  // Persist b2cOpen changes
  function setAndPersistOpen(next){
    const val = typeof next==='function' ? next(b2cOpen) : next
    try{ localStorage.setItem('eam.b2cOpen',JSON.stringify(val)) }catch{}
    setB2cOpen(val)
  }

  const periodLabel = PM?.label  || 'current period'
  const baseLabel   = (PM?.base  || 'prev period').toLowerCase()
  const subtitle    = `Hoppa and Elife direct channels — ${periodLabel} versus ${baseLabel}`
  const platLabel   = platform==='APP'?'App only':platform==='WEB'?'Web only':'App + Web'

  return (
    <div>
      {/* Header */}
      <div style={{marginBottom:18,display:'flex',alignItems:'flex-start',gap:12}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <h1 style={{fontSize:20,fontWeight:700,color:T.text,margin:0}}>B2C Performance</h1>
            <span style={{fontSize:10,fontWeight:700,padding:'3px 8px',borderRadius:10,background:T.greenBg,color:T.green,letterSpacing:'0.05em'}}>● LIVE</span>
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
