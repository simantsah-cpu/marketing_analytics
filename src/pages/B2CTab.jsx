/**
 * B2CTab.jsx — Weekly EAM Performance, B2C tab
 * UI note: volatility banner removed per user request 2026-08-26.
 * Spec: ORBIT_B2C_SPEC.md + snapshot-week-window migration (Aug 2026)
 *
 * §0 Non-negotiables:
 *  - Sources: ads.ads_b2c_dashboard_v (Hoppa) + ads.ads_b2c_dashboard_elife (eLife)
 *    NOT b2cdata.ads_ads_b2c_dashboard_v — see spec §1/§11
 *  - Week window from snap.kpi_weekly, not recomputed.
 *  - FX scalar subquery in SQL; CROSS JOIN forbidden.
 *  - period is a row dimension ('cur'/'prev'), NOT pivoted — NULLs survive.
 *  - platform IN ('APP','WEB') filtered in SQL.
 *  - Profit = actual_profit + estimate_profit (SQL field: 'profit').
 *  - Channel canonicalisation in SQL: AI Assistants→AI/LLM, Organic Social→Social.
 *  - Untracked sessions are NULL → render —, never 0%.
 *  - ROI suppressed below $50 spend floor (spec §7).
 *  - WoW gap must be verified as exactly 7 days; if not, label says so.
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
function numNull(v){ const x=(v===null||v===undefined||v==='')?NaN:Number(v); return isFinite(x)?x:null }

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
function fmtDate(iso){
  if(!iso)return ''
  const d=new Date(iso+'T00:00:00Z')
  return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'})
}
function fmtDateRange(s,e){
  if(!s||!e)return ''
  return `${fmtDate(s)}–${fmtDate(e)}`
}
function fmtQueryTime(iso){
  if(!iso)return ''
  try{
    const d=new Date(iso)
    return d.toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',
      hour:'2-digit',minute:'2-digit',timeZone:'UTC',hour12:false})+' UTC'
  }catch{ return iso }
}

// ─────────────────────────────────────────────────────────────────────────────
// §5 — Channel classification (on channel-grain aggregate)
// Two distinct attribution-gap buckets from the source view:
//   Untracked  = booking with NO matching GA4 session at all (marketing_channel IS NULL in view)
//                sessions = NULL, bookings > 0
//   Unassigned = GA4 session DID join, but source/medium didn't match any classification rule
//                sessions > 0, bookings > 0, no spend — NOT organic, not investable
// Both belong in 'Attribution gap'. Previously 'Unassigned' fell through to 'Unpaid' — fixed.
// ─────────────────────────────────────────────────────────────────────────────
function splitOf(r){
  // Unassigned: GA4 joined but unclassifiable — attribution gap, not organic
  if(r.channel === 'Unassigned') return 'Attribution gap'
  // Untracked: no GA4 session at all — sessions is NULL, bookings > 0
  const hasSessions = r.sessions !== null && num(r.sessions) > 0
  if(!hasSessions && num(r.bookings) > 0) return 'Attribution gap'
  if(num(r.spend_usd) > 0) return 'Paid'
  return 'Unpaid'
}

const SPLIT_COLOR  = { Paid:T.blue, Unpaid:T.green, 'Attribution gap':T.amber }
const SPLIT_NOTE   = {
  Paid:              'bought traffic',
  Unpaid:            'organic, direct, email',
  'Attribution gap': 'Untracked = no GA4 session · Unassigned = GA4 joined, source unclassifiable',
}
const SPLIT_ORDER  = ['Paid','Unpaid','Attribution gap']

// ROI floor — spec §7: below $50 spend, ROI is arithmetic noise not insight
function roiOrNull(net, spend){
  if(spend === null || num(spend) < 50) return null
  return net / num(spend)
}

// ─────────────────────────────────────────────────────────────────────────────
// §3 — Monthly period resolution (for Q_B2C_M path — unchanged)
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
  return null // 'mtd' → use weekly Q_B2C path
}

// §4 — Raw row selection for monthly path (D.b2cM)
function b2cRawRows(D, brand, periodKey, platform, sets){
  if(sets){
    const want = periodKey==='MTD' ? sets.cur : sets.base
    return (D.b2cM||[]).filter(r=>
      r.brand===brand &&
      want.includes(r.ym) &&
      (platform==='ALL' || r.platform===platform)
    )
  }
  // MTD path — still present for backward compat but weekly is primary
  return (D.b2c||[]).filter(r=>
    r.brand===brand &&
    r.period===periodKey &&
    (platform==='ALL' || r.platform===platform)
  )
}

// §4 — Aggregate a set of raw rows (monthly path)
function b2cAgg(rows){
  const o={sessions:0,bookings:0,ttv:0,profit:0,spend_usd:0}
  rows.forEach(r=>{
    o.sessions  +=num(r.sessions)
    o.bookings  +=num(r.bookings)
    o.ttv       +=num(r.ttv)
    o.profit    +=num(r.profit ?? r.est_profit)  // handle both field names
    o.spend_usd +=num(r.spend_usd)
  })
  o.cvr  = o.sessions>0 ? o.bookings/o.sessions : null
  o.atv  = o.bookings>0 ? o.ttv/o.bookings : null
  o.amv  = o.bookings>0 ? o.profit/o.bookings : null
  o.net  = o.profit - o.spend_usd
  o.ncpb = o.bookings>0 ? o.net/o.bookings : null
  o.roi  = roiOrNull(o.net, o.spend_usd)
  return o
}

// ─────────────────────────────────────────────────────────────────────────────
// Weekly path — parse new row shape from D.b2c
// Columns: period, week_key, week_start, week_end, grain, dim, parent, platform,
//          sessions, bookings, ttv, profit, spend_usd
// ─────────────────────────────────────────────────────────────────────────────

function parseWeeklyRows(D){
  const rows = D.b2c || []
  const cur = rows.filter(r => r.period === 'cur')
  const prv = rows.filter(r => r.period === 'prev')
  return { cur, prv }
}

function weeklyBrandRow(rows, brand){
  return rows.find(r => r.grain === 'brand' && r.dim === brand) ?? null
}

function weeklyChannelRows(rows, brand){
  return rows.filter(r => r.grain === 'channel' && r.parent === brand)
}

function weeklyPlatformRows(rows, brand, channel){
  return rows.filter(r => r.grain === 'channel_platform' && r.parent === brand && r.dim === channel)
}

function weeklyChannelPrev(prvRows, brand, channel){
  return prvRows.find(r => r.grain === 'channel' && r.parent === brand && r.dim === channel) ?? null
}

// Build a channel object from a raw row, deriving metrics
function buildChanObj(r, prvRow, brand, prvRows){
  const sessionsRaw = numNull(r.sessions)  // may be null for Untracked
  const bookings    = num(r.bookings)
  const ttv         = num(r.ttv)
  const profit      = num(r.profit)
  const spend       = num(r.spend_usd)
  const net         = profit - spend

  const cvr   = sessionsRaw !== null && sessionsRaw > 0 ? bookings / sessionsRaw : null
  const atv   = bookings > 0 ? ttv / bookings : null
  const amv   = bookings > 0 ? profit / bookings : null
  const ncpb  = bookings > 0 ? net / bookings : null
  const roi   = roiOrNull(net, spend)
  const split = splitOf({ sessions: sessionsRaw, bookings, spend_usd: spend })

  // WoW delta (bookings)
  const prvBookings = prvRow ? num(prvRow.bookings) : null
  const wowBookings = prvBookings !== null ? bookings - prvBookings : null
  const wowBookingsPct = (prvBookings !== null && prvBookings !== 0) ? wowBookings / Math.abs(prvBookings) : null

  // Platform sub-rows
  const platforms = weeklyPlatformRows(
    [...(weeklyChannelRows([], brand)), ...prvRows],  // will re-fetch from outer scope
    brand, r.dim
  )

  return {
    channel: r.dim,
    sessions: sessionsRaw,
    bookings, ttv, profit, spend_usd: spend,
    net, cvr, atv, amv, ncpb, roi, split,
    wowBookings, wowBookingsPct, prvBookings,
    // platforms resolved separately via weeklyPlatformRows
    _platRows: null, // filled in BrandSectionWeekly
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §5.0 — Build channel rows from weekly cur/prv data
// ─────────────────────────────────────────────────────────────────────────────
function buildWeeklyChannelRows(curRows, prvRows, brand, allCurRows){
  const chanRaw = weeklyChannelRows(curRows, brand)
  return chanRaw.map(r => {
    const prvRow = weeklyChannelPrev(prvRows, brand, r.dim)
    const sessionsRaw = numNull(r.sessions)
    const bookings    = num(r.bookings)
    const ttv         = num(r.ttv)
    const profit      = num(r.profit)
    const spend       = num(r.spend_usd)
    const net         = profit - spend

    const cvr   = sessionsRaw !== null && sessionsRaw > 0 ? bookings / sessionsRaw : null
    const atv   = bookings > 0 ? ttv / bookings : null
    const amv   = bookings > 0 ? profit / bookings : null
    const ncpb  = bookings > 0 ? net / bookings : null
    const roi   = roiOrNull(net, spend)
    const split = splitOf({ sessions: sessionsRaw, bookings, spend_usd: spend })

    const prvBookings    = prvRow ? num(prvRow.bookings) : null
    const wowBookings    = prvBookings !== null ? bookings - prvBookings : null
    const wowBookingsPct = (prvBookings !== null && prvBookings !== 0)
      ? wowBookings / Math.abs(prvBookings) : null

    // Platform sub-rows from channel_platform grain
    const platRaws = allCurRows.filter(p =>
      p.grain === 'channel_platform' && p.parent === brand && p.dim === r.dim
    )
    const platforms = platRaws.map(pr => {
      const ps = numNull(pr.sessions)
      const pb = num(pr.bookings)
      const pt = num(pr.ttv)
      const pp = num(pr.profit)
      const psp= num(pr.spend_usd)
      const pn = pp - psp
      return {
        platform: pr.platform,
        sessions: ps, bookings: pb, ttv: pt, profit: pp, spend_usd: psp,
        net: pn,
        cvr: ps !== null && ps > 0 ? pb/ps : null,
        atv: pb > 0 ? pt/pb : null,
        amv: pb > 0 ? pp/pb : null,
        ncpb: pb > 0 ? pn/pb : null,
        roi: roiOrNull(pn, psp),
        split, // inherit parent split
      }
    })

    return {
      channel: r.dim, sessions: sessionsRaw, bookings, ttv, profit, spend_usd: spend,
      net, cvr, atv, amv, ncpb, roi, split,
      wowBookings, wowBookingsPct, prvBookings,
      platforms,
    }
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
                     col==='profit'?num(r.profit):col==='spend'?num(r.spend_usd):
                     col==='net'?r.net:col==='wow'?num(r.wowBookings):0
    return dir==='asc' ? get(a)-get(b) : get(b)-get(a)
  })
}

function SesCell({r, isGrp}){
  const fw = isGrp ? 700 : 500
  // sessions is null (not 0) for Untracked — render — for both CVR and sessions
  if(r.sessions === null) return (
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
  if(num(r.bookings)===0 && r.sessions !== null) return (
    <div style={{textAlign:'right',color:T.text3,fontSize:11}}>—</div>
  )
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
      <div style={{fontVariantNumeric:'tabular-nums',fontWeight:fw}}>{usdC(r.profit)}</div>
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
  const roiStr = r.roi===null ? 'no spend' : r.spend_usd<50 ? '<$50 spend' : `${r.roi.toFixed(2)}x`
  const roiCol = r.roi===null ? T.text3 : r.roi>=0 ? T.green : T.red
  return (
    <div style={{textAlign:'right'}}>
      <div style={{color:col,fontVariantNumeric:'tabular-nums',fontWeight:fw}}>{usdC(r.net)}</div>
      <div style={{fontSize:10.5,color:roiCol}}>{roiStr}</div>
    </div>
  )
}
function WowCell({r, hasWow}){
  if(!hasWow || r.wowBookings === null) return (
    <div style={{textAlign:'right',color:T.text3,fontSize:11}}>—</div>
  )
  const col = r.wowBookings > 0 ? T.green : r.wowBookings < 0 ? T.red : T.text3
  const pctStr = signedPct(r.wowBookingsPct)
  return (
    <div style={{textAlign:'right'}}>
      <div style={{color:col,fontVariantNumeric:'tabular-nums',fontWeight:500}}>
        {r.wowBookings>0?'+':''}{numFmt(r.wowBookings,2)}
      </div>
      {pctStr && <div style={{fontSize:10.5,color:col}}>{pctStr}</div>}
    </div>
  )
}

function ChannelTable({ brand, channelRows, prvBrandRow, wowLabel, b2cOpen, setB2cOpen }){
  const [sortCol, setSortCol] = useState('net')
  const [sortDir, setSortDir] = useState('desc')
  const [chanOpen, setChanOpen] = useState({})
  const hasWow = !!wowLabel && !!prvBrandRow

  function toggleChan(channel){
    setChanOpen(prev=>({...prev,[channel]:!prev[channel]}))
  }

  const groups = useMemo(()=>{
    return SPLIT_ORDER.map(split=>{
      const ch = sortChannels(channelRows.filter(r=>r.split===split), sortCol, sortDir)
      if(!ch.length)return null
      const g = {sessions:null,bookings:0,ttv:0,profit:0,spend_usd:0,wowBookings:null}
      ch.forEach(r=>{
        // sessions: null if any channel has null (Untracked carries null)
        if(r.sessions !== null) g.sessions = (g.sessions ?? 0) + num(r.sessions)
        g.bookings  += num(r.bookings)
        g.ttv       += num(r.ttv)
        g.profit    += num(r.profit)
        g.spend_usd += num(r.spend_usd)
        if(r.wowBookings !== null) g.wowBookings = (g.wowBookings ?? 0) + r.wowBookings
      })
      g.net  = g.profit - g.spend_usd
      g.roi  = roiOrNull(g.net, g.spend_usd)
      g.cvr  = g.sessions !== null && g.sessions > 0 ? g.bookings/g.sessions : null
      g.atv  = g.bookings>0 ? g.ttv/g.bookings : null
      g.amv  = g.bookings>0 ? g.profit/g.bookings : null
      g.split = split
      // WoW % for group
      const prvGroupBookings = ch.reduce((s,r)=>r.prvBookings!==null?s+r.prvBookings:s, 0)
      g.wowBookingsPct = (prvGroupBookings>0 && g.wowBookings!==null) ? g.wowBookings/prvGroupBookings : null
      g.prvBookings = prvGroupBookings
      return {split, rows:ch, agg:g}
    }).filter(Boolean)
  },[channelRows, sortCol, sortDir])

  const tot = useMemo(()=>{
    const t={sessions:null,bookings:0,ttv:0,profit:0,spend_usd:0}
    channelRows.forEach(r=>{
      if(r.sessions!==null) t.sessions=(t.sessions??0)+num(r.sessions)
      t.bookings+=num(r.bookings)
      t.ttv+=num(r.ttv)
      t.profit+=num(r.profit)
      t.spend_usd+=num(r.spend_usd)
    })
    t.net=t.profit-t.spend_usd
    t.roi=roiOrNull(t.net,t.spend_usd)
    t.cvr=t.sessions!==null&&t.sessions>0?t.bookings/t.sessions:null
    t.atv=t.bookings>0?t.ttv/t.bookings:null
    t.amv=t.bookings>0?t.profit/t.bookings:null
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
  // Col widths: extra WoW column when hasWow
  // 7 columns (with WoW) or 6 columns (without) — evenly distributed
  const colW = hasWow
    ? ['24%','12.7%','12.7%','12.7%','12.7%','12.7%','12.5%']
    : ['28%','14.4%','14.4%','14.4%','14.4%','14.4%']

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
        <span style={{fontSize:13,fontWeight:700,color:T.text}}>{brand} — channel contribution</span>
        <div style={{flex:1}}/>
        <button onClick={()=>toggleAll(true)} style={{fontSize:12,fontWeight:600,padding:'5px 12px',border:`1px solid ${T.border}`,borderRadius:6,background:T.bg,color:T.text2,cursor:'pointer',fontFamily:'inherit'}}>Expand all</button>
        <button onClick={()=>toggleAll(false)} style={{fontSize:12,fontWeight:600,padding:'5px 12px',border:`1px solid ${T.border}`,borderRadius:6,background:T.bg,color:T.text2,cursor:'pointer',fontFamily:'inherit'}}>Collapse all</button>
        <span style={{fontSize:11,color:T.text3}}>{totalChannels} channel{totalChannels!==1?'s':''} · {groups.length} group{groups.length!==1?'s':''}</span>
      </div>

      <div style={{background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,overflow:'hidden',marginBottom:14}}>
        <div style={{padding:'8px 14px 7px',borderBottom:`1px solid ${T.border}`,background:T.bg2}}>
          <span style={{fontSize:11,color:T.text3}}>
            Grouped by Paid / Unpaid / Attribution gap · aggregated across platforms · sorted by net contribution
          </span>
        </div>

        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}>
            <colgroup>
              {colW.map((w,i)=><col key={i} style={{width:w}}/>)}
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
                <th style={{...TH}} onClick={()=>handleSort('profit')}>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:1}}>
                    <span>Est. Profit {arrow('profit')}</span>
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
                {hasWow && (
                  <th style={{...TH}} onClick={()=>handleSort('wow')}>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:1}}>
                      <span>Bookings WoW {arrow('wow')}</span>
                      <span style={{fontWeight:400,opacity:.8,fontSize:9}}>{wowLabel}</span>
                    </div>
                  </th>
                )}
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
                        </div>
                      </td>
                      <td style={{...TD}}><SesCell r={g.agg} isGrp/></td>
                      <td style={{...TD}}><BookCell r={g.agg} isGrp/></td>
                      <td style={{...TD}}><ProfitCell r={g.agg} isGrp/></td>
                      <td style={{...TD}}><SpendCell r={g.agg} isGrp/></td>
                      <td style={{...TD}}><NetCell r={g.agg} isGrp/></td>
                      {hasWow && <td style={{...TD}}><WowCell r={g.agg} hasWow={hasWow}/></td>}
                    </tr>

                    {/* ── Channel rows (level 2) ── */}
                    {open && g.rows.map(chan=>{
                      const cOpen = chanOpen[chan.channel]
                      const hasPlats = chan.platforms && chan.platforms.length > 1
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
                            {hasWow && <td style={{...TD}}><WowCell r={chan} hasWow={hasWow}/></td>}
                          </tr>

                          {/* ── Platform sub-rows (level 3) ── */}
                          {hasPlats && cOpen && chan.platforms.map(pr=>(
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
                              <td style={{...TD}}><SesCell r={pr}/></td>
                              <td style={{...TD}}><BookCell r={pr}/></td>
                              <td style={{...TD}}><ProfitCell r={pr}/></td>
                              <td style={{...TD}}><SpendCell r={pr}/></td>
                              <td style={{...TD}}><NetCell r={pr}/></td>
                              {hasWow && <td style={{...TD}}><div style={{textAlign:'right',color:T.text3,fontSize:11}}>—</div></td>}
                            </tr>
                          ))}
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
                {hasWow && <td style={{...TD}}><div style={{textAlign:'right',color:T.text3,fontSize:11}}>—</div></td>}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Weekly Brand Section
// ─────────────────────────────────────────────────────────────────────────────
function BrandSectionWeekly({ brand, curRows, prvRows, allCurRows, wowLabel, hasWow, b2cOpen, setB2cOpen }){
  const brandRow = weeklyBrandRow(curRows, brand)
  const prvBrandRow = weeklyBrandRow(prvRows, brand)

  const channelRows = useMemo(
    ()=>buildWeeklyChannelRows(curRows, prvRows, brand, allCurRows),
    [curRows, prvRows, brand, allCurRows]
  )

  // Structural gates (console only — §10.10, §10.14, invariant)
  useMemo(()=>{
    const rawDims = curRows.map(r=>r.dim)
    if(rawDims.includes('AI Assistants') || rawDims.includes('Organic Social'))
      console.warn('B2C §10.10 GATE: un-canonicalised channel in data', rawDims.filter(d=>d==='AI Assistants'||d==='Organic Social'))
    const unassigned = channelRows.find(r=>r.channel==='Unassigned')
    if(unassigned && num(unassigned.bookings) > 10)
      console.warn('B2C §10.14 GATE: Unassigned bookings =', unassigned.bookings, '(expect ~4.66 for W34 — may be legitimately higher in future weeks)')
    const chanSum = channelRows.reduce((s,r)=>s+num(r.bookings),0)
    if(brandRow && Math.abs(chanSum - num(brandRow.bookings)) > 0.02)
      console.warn('B2C INVARIANT: channel bookings ≠ brand', chanSum.toFixed(2), 'vs', brandRow?.bookings)
  },[curRows,channelRows,brandRow])

  if(!brandRow) return (
    <div style={{background:T.bg2,border:`1px solid ${T.border}`,borderRadius:8,padding:'14px 18px',color:T.text3,fontSize:13,lineHeight:1.7}}>
      No {brand} data for this snapshot week. The week window may not exist in the source table.
    </div>
  )

  const s = num(brandRow.sessions)
  const b = num(brandRow.bookings)
  const t = num(brandRow.ttv)
  const p = num(brandRow.profit)
  const sp= num(brandRow.spend_usd)
  const net = p - sp
  const cvr = s>0 ? b/s : null
  const atv = b>0 ? t/b : null
  const amv = b>0 ? p/b : null
  const roi = roiOrNull(net, sp)
  const ncpb= b>0 ? net/b : null

  // WoW deltas from brand rows
  const ps  = prvBrandRow ? num(prvBrandRow.sessions)  : null
  const pb  = prvBrandRow ? num(prvBrandRow.bookings)  : null
  const pt  = prvBrandRow ? num(prvBrandRow.ttv)       : null
  const pp  = prvBrandRow ? num(prvBrandRow.profit)    : null
  const psp = prvBrandRow ? num(prvBrandRow.spend_usd) : null
  const pnet= pp!==null ? pp-(psp??0) : null
  const pCvr= ps&&ps>0&&pb!==null ? pb/ps : null

  const fD = (c,bv) => (bv!==null&&bv!==0&&isFinite(bv)) ? (c-bv)/Math.abs(bv) : null
  const bLabel = wowLabel ?? '—'
  const bShort = prvBrandRow ? prvBrandRow.week_key ?? 'prev' : '—'

  return (
    <div style={{marginBottom:36}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,marginTop:8}}>
        <span style={{fontSize:10,fontWeight:700,color:T.text3,textTransform:'uppercase',letterSpacing:'0.07em',whiteSpace:'nowrap'}}>
          {brand} B2C — {brandRow.week_key} ({fmtDateRange(brandRow.week_start, brandRow.week_end)})
        </span>
        <div style={{flex:1,height:'1px',background:T.border}}/>
      </div>

      {/* ── Demand funnel ── */}
      <div style={{fontSize:9,fontWeight:700,color:T.text3,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:8,display:'flex',alignItems:'center',gap:10}}>
        <span>Demand Funnel</span>
        <div style={{flex:1,height:'1px',background:T.border}}/>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:14}}>
        <KpiTile label="Sessions" value={numFmt(s)}
          deltaFrac={fD(s,ps)} baseLabel={bShort} baseVal={ps!==null?numFmt(ps):undefined}/>
        <KpiTile label="Bookings" value={numFmt(b,0)}
          deltaFrac={fD(b,pb)} baseLabel={bShort} baseVal={pb!==null?numFmt(pb,0):undefined}/>
        <KpiTile label="Conversion Rate" value={pct(cvr,2)}
          deltaAbs={cvr!==null&&pCvr!==null?cvr-pCvr:null} baseLabel={bShort}
          baseVal={pCvr!==null?pct(pCvr,2):undefined}/>
        <KpiTile label="TTV" value={usdC(t)}
          deltaFrac={fD(t,pt)} baseLabel={bShort} baseVal={pt!==null?usdC(pt):undefined}
          footer="Avg ticket (ATV)" footerVal={atv?usd(atv,1):'—'}/>
      </div>

      {/* ── Unit economics ── */}
      <div style={{fontSize:9,fontWeight:700,color:T.text3,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:8,display:'flex',alignItems:'center',gap:10}}>
        <span>Unit Economics</span>
        <div style={{flex:1,height:'1px',background:T.border}}/>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
        <KpiTile label="Est. Profit" value={usdC(p)}
          deltaFrac={fD(p,pp)} baseLabel={bShort} baseVal={pp!==null?usdC(pp):undefined}
          footer="Per booking (AMV)" footerVal={amv?usd(amv,1):'—'}/>
        <KpiTile label="Spend (USD)" value={usdC(sp)}
          deltaFrac={fD(sp,psp)} baseLabel={bShort} baseVal={psp!==null?usdC(psp):undefined}
          footer="Share of profit" footerVal={p>0?pct(sp/p,0):'—'}
          invertDelta={true}/>
        <KpiTile label="Net Contribution" value={usdC(net)}
          valueColor={net>0?T.green:net<0?T.red:T.text}
          deltaFrac={fD(net,pnet)} baseLabel={bShort} baseVal={pnet!==null?usdC(pnet):undefined}
          footer="Per booking (NCPB)" footerVal={ncpb?usd(ncpb,1):'—'}/>
        <KpiTile label="ROI" value={roi!==null?`${roi.toFixed(2)}x`:(sp<50?'<$50 spend':'—')}
          valueColor={roi!==null?(roi>=0?T.green:T.red):T.text3}
          deltaFrac={null} baseLabel={bShort}
          footer="Break-even" footerVal="1.00x"/>
      </div>

      {/* ── Channel table ── */}
      {channelRows.length > 0 && (
        <ChannelTable
          brand={brand}
          channelRows={channelRows}
          prvBrandRow={prvBrandRow}
          wowLabel={wowLabel}
          b2cOpen={b2cOpen}
          setB2cOpen={setB2cOpen}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Monthly Brand Section (unchanged path — reads D.b2cM)
// ─────────────────────────────────────────────────────────────────────────────
function BrandSection({ brand, D, period, CUR_MONTH, platform, PM, b2cOpen, setB2cOpen }){
  const sets = useMemo(()=>b2cMonthSets(period, CUR_MONTH),[period,CUR_MONTH])

  const srcEmpty  = !(D.b2cM||[]).length
  const anyBrand  = (D.b2cM||[]).some(r=>r.brand===brand)
  const anyPlat   = (D.b2cM||[]).some(r=>
    r.brand===brand && (platform==='ALL' || r.platform===platform))

  let emptyMsg = null
  if(srcEmpty)       emptyMsg = `Monthly B2C data has not loaded yet. Press Refresh.`
  else if(!anyBrand) emptyMsg = `${brand} has no rows in the monthly source.`
  else if(!anyPlat)  emptyMsg = `${brand} has no ${platform==='APP'?'App':'Web'} rows. Switch the platform filter to All.`

  const curRaw = useMemo(()=>b2cRawRows(D,brand,'MTD',platform,sets),[D,brand,platform,sets])
  const lmRaw  = useMemo(()=>b2cRawRows(D,brand,'LM', platform,sets),[D,brand,platform,sets])
  const cur    = useMemo(()=>b2cAgg(curRaw),[curRaw])
  const lm     = useMemo(()=>b2cAgg(lmRaw),[lmRaw])
  const channelRows = useMemo(()=>{
    // Build channel rows from monthly raw (legacy path — no WoW)
    const chMap = {}
    curRaw.forEach(r=>{
      const k = r.channel ?? r.marketing_channel ?? 'Untracked'
      if(!chMap[k]) chMap[k]={ channel:k,sessions:0,bookings:0,ttv:0,profit:0,spend_usd:0,platforms:[] }
      chMap[k].sessions   += num(r.sessions)
      chMap[k].bookings   += num(r.bookings)
      chMap[k].ttv        += num(r.ttv)
      chMap[k].profit     += num(r.profit ?? r.est_profit)
      chMap[k].spend_usd  += num(r.spend_usd)
      chMap[k].platforms.push(r)
    })
    return Object.values(chMap).map(c=>{
      c.cvr  = c.sessions>0 ? c.bookings/c.sessions : null
      c.atv  = c.bookings>0 ? c.ttv/c.bookings : null
      c.amv  = c.bookings>0 ? c.profit/c.bookings : null
      c.net  = c.profit - c.spend_usd
      c.ncpb = c.bookings>0 ? c.net/c.bookings : null
      c.roi  = roiOrNull(c.net, c.spend_usd)
      c.split= splitOf(c)
      c.wowBookings = null
      c.wowBookingsPct = null
      return c
    })
  },[curRaw])

  const bShort = PM?.baseShort || 'prev'
  const fD = (c,b) => (b!==0&&b!==null&&isFinite(b)) ? (c-b)/Math.abs(b) : null

  return (
    <div style={{marginBottom:36}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,marginTop:8}}>
        <span style={{fontSize:10,fontWeight:700,color:T.text3,textTransform:'uppercase',letterSpacing:'0.07em',whiteSpace:'nowrap'}}>
          {brand} B2C Metrics
        </span>
        {platform!=='ALL' && (
          <span style={{marginLeft:8,fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:10,
            background:T.blueBg,color:T.blue,letterSpacing:'0.04em'}}>
            {platform==='APP'?'App':'Web'}
          </span>
        )}
        <div style={{flex:1,height:'1px',background:T.border}}/>
      </div>

      {emptyMsg ? (
        <div style={{background:T.bg2,border:`1px solid ${T.border}`,borderRadius:8,padding:'14px 18px',color:T.text3,fontSize:13,lineHeight:1.7}}>{emptyMsg}</div>
      ) : curRaw.length === 0 ? (
        <div style={{background:T.bg2,border:`1px solid ${T.border}`,borderRadius:8,padding:'14px 18px',color:T.text3,fontSize:13,lineHeight:1.7}}>
          No {brand} activity recorded for {PM?.label || period}.
          {platform!=='ALL' && ` (Filtered to ${platform==='APP'?'App':'Web'} only.)`}
        </div>
      ) : (
        <>
          <div style={{fontSize:9,fontWeight:700,color:T.text3,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:8,display:'flex',alignItems:'center',gap:10}}>
            <span>Demand Funnel</span><div style={{flex:1,height:'1px',background:T.border}}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:14}}>
            <KpiTile label="Sessions" value={numFmt(cur.sessions)}
              deltaFrac={fD(cur.sessions,lm.sessions)} baseLabel={bShort} baseVal={numFmt(lm.sessions)}/>
            <KpiTile label="Bookings" value={numFmt(cur.bookings,0)}
              deltaFrac={fD(cur.bookings,lm.bookings)} baseLabel={bShort} baseVal={numFmt(lm.bookings,0)}/>
            <KpiTile label="Conversion Rate" value={pct(cur.cvr,2)}
              deltaAbs={cur.cvr!==null&&lm.cvr!==null?cur.cvr-lm.cvr:null} baseLabel={bShort} baseVal={pct(lm.cvr,2)}/>
            <KpiTile label="TTV" value={usdC(cur.ttv)}
              deltaFrac={fD(cur.ttv,lm.ttv)} baseLabel={bShort} baseVal={usdC(lm.ttv)}
              footer="Avg ticket (ATV)" footerVal={cur.atv?usd(cur.atv,1):'—'}/>
          </div>
          <div style={{fontSize:9,fontWeight:700,color:T.text3,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:8,display:'flex',alignItems:'center',gap:10}}>
            <span>Unit Economics</span><div style={{flex:1,height:'1px',background:T.border}}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
            <KpiTile label="Est. Profit" value={usdC(cur.profit)}
              deltaFrac={fD(cur.profit,lm.profit)} baseLabel={bShort} baseVal={usdC(lm.profit)}
              footer="Per booking (AMV)" footerVal={cur.amv?usd(cur.amv,1):'—'}/>
            <KpiTile label="Spend (USD)" value={usdC(cur.spend_usd)}
              deltaFrac={fD(cur.spend_usd,lm.spend_usd)} baseLabel={bShort} baseVal={usdC(lm.spend_usd)}
              footer="Share of profit" footerVal={cur.profit>0?pct(cur.spend_usd/cur.profit,0):'—'}
              invertDelta={true}/>
            <KpiTile label="Net Contribution" value={usdC(cur.net)}
              valueColor={cur.net>0?T.green:cur.net<0?T.red:T.text}
              deltaFrac={fD(cur.net,lm.net)} baseLabel={bShort} baseVal={usdC(lm.net)}
              footer="Per booking (NCPB)" footerVal={cur.ncpb?usd(cur.ncpb,1):'—'}/>
            <KpiTile label="ROI" value={cur.roi!==null?`${cur.roi.toFixed(2)}x`:'—'}
              valueColor={cur.roi!==null?(cur.roi>=1?T.green:T.red):T.text3}
              deltaFrac={cur.roi!==null&&lm.roi!==null?fD(cur.roi,lm.roi):null} baseLabel={bShort}
              baseVal={lm.roi!==null?`${lm.roi.toFixed(2)}x`:undefined}
              footer="Break-even" footerVal="1.00x"/>
          </div>
          {channelRows.length > 0 && (
            <ChannelTable brand={brand} channelRows={channelRows}
              prvBrandRow={null} wowLabel={null}
              b2cOpen={b2cOpen} setB2cOpen={setB2cOpen}/>
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
    try{ const s=localStorage.getItem('eam.b2cOpen'); return s ? JSON.parse(s) : {} }catch{ return {} }
  })

  function setAndPersistOpen(next){
    const val = typeof next==='function' ? next(b2cOpen) : next
    try{ localStorage.setItem('eam.b2cOpen',JSON.stringify(val)) }catch{}
    setB2cOpen(val)
  }

  // ── Route: weekly vs monthly path ──────────────────────────────────────────
  const sets = useMemo(()=>b2cMonthSets(period, CUR_MONTH),[period,CUR_MONTH])
  const isMonthly = !!sets  // month key / QTD / YTD → monthly path
  const isWeekly  = !isMonthly // 'mtd' → weekly path (new)

  // Weekly data
  const { cur: curRows, prv: prvRows } = useMemo(
    ()=> isWeekly ? parseWeeklyRows(D) : { cur:[], prv:[] },
    [D, isWeekly]
  )

  // WoW label derived from row metadata
  const wowLabel = useMemo(()=>{
    if(!isWeekly) return null
    const curBrand = curRows.find(r=>r.grain==='brand')
    const prvBrand = prvRows.find(r=>r.grain==='brand')
    if(!curBrand || !prvBrand) return null
    const gapDays = Math.round(
      (new Date(curBrand.week_start+'T00:00:00Z') - new Date(prvBrand.week_start+'T00:00:00Z'))
      / 86400000
    )
    if(gapDays === 7){
      return `vs ${prvBrand.week_key} (${fmtDateRange(prvBrand.week_start, prvBrand.week_end)})`
    }
    // Gap isn't 7 days — label it explicitly so it's never silently wrong (spec §2.1)
    console.warn(`B2C §2.1: week gap is ${gapDays} days, not 7. cur=${curBrand.week_start}, prev=${prvBrand.week_start}`)
    return `vs ${prvBrand.week_key} (${gapDays}-day gap ⚠)`
  },[isWeekly, curRows, prvRows])

  const hasWow = isWeekly && !!wowLabel && prvRows.length > 0

  // Tab title
  const curWeekRow = curRows.find(r=>r.grain==='brand')
  const weekLabel = curWeekRow
    ? `${curWeekRow.week_key} (${fmtDateRange(curWeekRow.week_start, curWeekRow.week_end)})`
    : null
  const subtitle = isWeekly && weekLabel
    ? `Week ${weekLabel} — Hoppa and Elife direct channels`
    : `Hoppa and Elife direct channels — ${PM?.label || period} versus ${(PM?.base || 'prev period').toLowerCase()}`

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

      {/* Volatility banner removed per user request 2026-08-26 */}

      {/* Platform toggle (weekly view — filter happens in SQL, APP+WEB already applied) */}
      {isWeekly && (
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
              {platform==='APP'?'App only':platform==='WEB'?'Web only':'App + Web'} · all bookings in this window
            </span>
          </div>
          {platform !== 'ALL' && (
            <div style={{fontSize:11,color:T.text3,marginTop:6}}>
              Platform filter applies to brand KPIs and channel table. Sub-row drill-downs show the selected platform.
            </div>
          )}
        </div>
      )}

      {/* ── Weekly view ── */}
      {isWeekly && (
        <>
          <BrandSectionWeekly
            brand="Hoppa"
            curRows={curRows.filter(r=>platform==='ALL'||!r.platform||r.platform===platform)}
            prvRows={prvRows}
            allCurRows={curRows}
            wowLabel={wowLabel}
            hasWow={hasWow}
            b2cOpen={b2cOpen}
            setB2cOpen={setAndPersistOpen}
          />
          <BrandSectionWeekly
            brand="Elife"
            curRows={curRows.filter(r=>platform==='ALL'||!r.platform||r.platform===platform)}
            prvRows={prvRows}
            allCurRows={curRows}
            wowLabel={wowLabel}
            hasWow={hasWow}
            b2cOpen={b2cOpen}
            setB2cOpen={setAndPersistOpen}
          />
        </>
      )}

      {/* ── Monthly view (unchanged path) ── */}
      {isMonthly && (
        <>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:10,fontWeight:600,color:T.text3,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:6}}>Platform</div>
            <div style={{display:'flex',border:`1px solid ${T.border}`,borderRadius:8,overflow:'hidden',width:'fit-content'}}>
              {['ALL','APP','WEB'].map(p=>(
                <button key={p} onClick={()=>setPlatform(p)} style={{
                  padding:'6px 16px',fontSize:12.5,fontWeight:600,fontFamily:'inherit',cursor:'pointer',
                  border:'none',borderRight:p!=='WEB'?`1px solid ${T.border}`:'none',
                  background:platform===p?T.blue:T.bg,
                  color:platform===p?'#fff':T.text2,transition:'all .15s',
                }}>
                  {p==='ALL'?'All':p==='APP'?'App':'Web'}
                </button>
              ))}
            </div>
          </div>
          <BrandSection brand="Hoppa" D={D} period={period} CUR_MONTH={CUR_MONTH}
            platform={platform} PM={PM} b2cOpen={b2cOpen} setB2cOpen={setAndPersistOpen}/>
          <BrandSection brand="Elife" D={D} period={period} CUR_MONTH={CUR_MONTH}
            platform={platform} PM={PM} b2cOpen={b2cOpen} setB2cOpen={setAndPersistOpen}/>
        </>
      )}
    </div>
  )
}
