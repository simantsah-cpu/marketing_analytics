/**
 * AudienceChannelsTab.jsx — Page 5: Audience & Channels
 *
 * Brief rules enforced:
 *   - session_traffic_source_last_click only (A3) — stated in header note
 *   - No monthly channel YoY (rule R2, June-2025 partial) — conversion table stays weekly always
 *   - No per-airport channel splits — "not in this dataset"
 *   - Nine channel buckets only, fixed order and colors (§4)
 *   - Weekly YoY = W27-2026 ('2627') vs W27-2025 ('2527')
 *   - Stacked mix = months 2507..2606 only (12 complete months)
 *   - Country bars = June 2026 ('2606') purchases only (no YoY — rule R2)
 *   - V6: purchase events labeled "bookings" not "transactions"
 */

import { useState, useMemo } from 'react'
import { AUD_DATA, TOP_COUNTRIES } from '../data/audData.js'

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  pine: '#0A2540', leaf: '#0D8A72', ink: '#1A2B3C', inkSoft: '#5A6A7A',
  paper: '#F8FAFC', card: '#FFFFFF', line: '#E2EAF0', prior: '#0F5FA6',
  amber: '#D97706', coral: '#C0392B', grey: '#E2EAF0', leafLight: '#E6F5F2',
  coralLight: '#FDEDEB',
}

// ─── Fixed channel order and colors (brief §4 — do not reorder) ──────────────
const CH_ORDER = [
  'Paid search',
  'Organic search',
  'Direct / unattributed',
  'Email / CRM',
  'Affiliates',
  'App store',
  'Referral',
  'AI assistants',
  'Other',
]
const CH_COLOR = {
  'Paid search':             '#0A2540',
  'Organic search':          '#0D8A72',
  'Direct / unattributed':   '#0F5FA6',
  'Email / CRM':             '#D97706',
  'Affiliates':              '#7C5CBF',
  'App store':               '#2B8FA3',
  'Referral':                '#9FB6C9',
  'AI assistants':           '#C0392B',
  'Other':                   '#B8C4BC',
}

// ─── Constants ────────────────────────────────────────────────────────────────
const W27_CUR  = '2627'   // W27-2026
const W27_PREV = '2527'   // W27-2025
const STACK_MONTHS = ['2507','2508','2509','2510','2511','2512','2601','2602','2603','2604','2605','2606'] // 12 complete months
const MONTH_LABELS = {
  '2507':'Jul\'25','2508':'Aug\'25','2509':'Sep\'25','2510':'Oct\'25','2511':'Nov\'25','2512':'Dec\'25',
  '2601':'Jan\'26','2602':'Feb\'26','2603':'Mar\'26','2604':'Apr\'26','2605':'May\'26','2606':'Jun\'26',
}
const COUNTRY_MONTH = '2606'

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtN(n) {
  if (n==null||isNaN(n)) return '–'
  const a=Math.abs(n), sg=n<0?'-':''
  if (a>=1e6) return sg+(a/1e6).toFixed(1)+'M'
  if (a>=1e4) return sg+Math.round(a/1e3)+'K'
  if (a>=1e3) return sg+(a/1e3).toFixed(1)+'K'
  return sg+n.toLocaleString('en-GB')
}
function fmtGBP(n) {
  if (!n) return '–'
  const a=Math.abs(n), sg=n<0?'-':''
  if (a>=1e6) return sg+'£'+(a/1e6).toFixed(2)+'M'
  if (a>=1e3) return sg+'£'+Math.round(a/1e3).toLocaleString()+'K'
  return sg+'£'+Math.round(a).toLocaleString()
}
function fmtPct(n, dp=1) { return n==null||isNaN(n)?'–':n.toFixed(dp)+'%' }
function pct(a,b) { return b&&b>0 ? a/b*100 : null }
function delta(cur, prv) { return prv&&prv>0 ? (cur-prv)/prv*100 : null }
function fmtDelta(d, dp=1) {
  if (d==null||isNaN(d)) return '–'
  return (d>=0?'+':'')+d.toFixed(dp)+'%'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getVal(dim, val, grain, period) {
  return AUD_DATA[dim]?.[val]?.[grain]?.[period] ?? [0, 0, 0]
}
function getS(dim, val, grain, period) { return getVal(dim,val,grain,period)[0] }
function getP(dim, val, grain, period) { return getVal(dim,val,grain,period)[1] }
function getR(dim, val, grain, period) { return getVal(dim,val,grain,period)[2] }

// ─── DeltaChip ────────────────────────────────────────────────────────────────
function DeltaChip({ cur, prv, isPP=false, small=false }) {
  if (prv==null||prv===0) return <span style={{fontSize:small?9:11,color:T.inkSoft,padding:'2px 6px',background:T.grey,borderRadius:10,fontWeight:700}}>n/a</span>
  let text, up
  if (isPP) { const d=cur-prv; up=d>=0; text=(d>=0?'+':'')+d.toFixed(2)+'pp' }
  else { const d=(cur-prv)/Math.abs(prv)*100; up=d>=0; text=(d>=0?'+':'')+d.toFixed(1)+'%' }
  return (
    <span style={{fontSize:small?9:11,fontWeight:700,padding:'2px 7px',borderRadius:10,
      background:up?T.leafLight:T.coralLight,color:up?'#0A7A52':T.coral}}>
      {up?'▲':'▼'} {text}
    </span>
  )
}

// ─── ValidChip ───────────────────────────────────────────────────────────────
function ValidChip() {
  return (
    <span style={{fontSize:9,fontWeight:700,padding:'2px 8px',borderRadius:10,background:T.leafLight,color:T.pine,marginLeft:6,verticalAlign:'middle'}}>
      ✓ valid YoY
    </span>
  )
}

// ─── HorizontalBars (shared by Channels weekly + Devices) ────────────────────
function HorizontalBars({ rows, metric, label, subtitle }) {
  // rows: [{ label, curV, prvV, color }]
  const maxV = Math.max(...rows.flatMap(r => [r.curV, r.prvV]), 1)

  return (
    <div style={{background:T.card,border:`1px solid ${T.line}`,borderRadius:12,padding:'18px 20px'}}>
      <div style={{fontSize:13,fontWeight:700,color:T.ink,marginBottom:4}}>{label}</div>
      {subtitle && <div style={{fontSize:10,color:T.inkSoft,marginBottom:14}}>{subtitle}</div>}
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {rows.map(({ label: lbl, curV, prvV, color }, i) => {
          const curW = Math.max(2, (curV / maxV) * 100)
          const prvW = Math.max(2, (prvV / maxV) * 100)
          const d = delta(curV, prvV)
          return (
            <div key={i}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
                <span style={{fontSize:11,fontWeight:600,color:T.ink,flex:1}}>{lbl}</span>
                <span style={{fontSize:11,color:T.inkSoft,marginLeft:12}}>
                  {fmtN(prvV)} → <strong style={{color:T.ink}}>{fmtN(curV)}</strong>
                  {d!=null && <span style={{marginLeft:6,fontWeight:700,color:d>=0?'#0A7A52':T.coral}}>{fmtDelta(d)}</span>}
                </span>
              </div>
              {/* Prior bar (W27-2025) */}
              <div style={{height:6,background:T.grey,borderRadius:3,marginBottom:2,overflow:'hidden'}}>
                <div style={{width:`${prvW}%`,height:'100%',background:T.prior,borderRadius:3}}/>
              </div>
              {/* Current bar (W27-2026) */}
              <div style={{height:9,background:T.grey,borderRadius:4,overflow:'hidden'}}>
                <div style={{width:`${curW}%`,height:'100%',background:color,borderRadius:4}}/>
              </div>
            </div>
          )
        })}
      </div>
      <div style={{marginTop:10,fontSize:9,color:T.inkSoft}}>Pale bar = same ISO week last year (W27-2025)</div>
    </div>
  )
}

// ─── StackedColumnChart ───────────────────────────────────────────────────────
function StackedColumnChart({ dim, metric, months, label }) {
  // metric: 's' | 'p'
  const idx = metric === 's' ? 0 : 1
  const W = 560, H = 230
  const PAD = { l: 46, r: 8, t: 14, b: 38 }
  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b
  const n = months.length
  const gW = plotW / n
  const bW = Math.min(gW * 0.82, 36)

  // Get totals per month for 100% stacking
  const totals = months.map(ym => {
    return CH_ORDER.reduce((acc, ch) => {
      const v = AUD_DATA[dim]?.[ch]?.M?.[ym]
      return acc + (v ? v[idx] : 0)
    }, 0)
  })
  const maxTot = Math.max(...totals, 1)

  const elems = []

  // Y-axis gridlines (0%, 25%, 50%, 75%, 100%)
  for (let i = 0; i <= 4; i++) {
    const y = PAD.t + plotH - (i / 4) * plotH
    elems.push(<line key={'g'+i} x1={PAD.l} y1={y} x2={W-PAD.r} y2={y} stroke={T.line} strokeWidth={0.8}/>)
    elems.push(<text key={'yl'+i} x={PAD.l-4} y={y+3} textAnchor="end" fontSize={8} fill={T.inkSoft}>{i*25}%</text>)
  }

  // Bars
  months.forEach((ym, mi) => {
    const cx = PAD.l + mi * gW + gW / 2
    const tot = totals[mi] || 1
    let yOff = 0

    CH_ORDER.forEach(ch => {
      const v = AUD_DATA[dim]?.[ch]?.M?.[ym]
      const val = v ? v[idx] : 0
      if (val === 0) return
      const frac = val / tot
      const bH = Math.max(1, frac * plotH)
      const y = PAD.t + plotH - yOff - bH
      const monLabel = MONTH_LABELS[ym] || ym
      elems.push(
        <rect key={`${ym}-${ch}`} x={cx-bW/2} y={y} width={bW} height={bH} fill={CH_COLOR[ch]} rx={mi===0&&yOff===0?1:0}>
          <title>{monLabel} · {ch}: {fmtN(val)} ({(frac*100).toFixed(1)}%)</title>
        </rect>
      )
      yOff += bH
    })

    // X label
    const lbl = MONTH_LABELS[ym] || ym
    elems.push(
      <text key={'xl'+mi} x={cx} y={H-PAD.b+14} textAnchor="middle" fontSize={8} fill={T.inkSoft}>
        {lbl}
      </text>
    )
  })

  return (
    <div>
      <div style={{fontSize:12,fontWeight:700,color:T.ink,marginBottom:8}}>{label}</div>
      <svg width={W} height={H} style={{display:'block',fontFamily:'Inter,system-ui,sans-serif',maxWidth:'100%'}}>{elems}</svg>
      {/* Legend */}
      <div style={{display:'flex',flexWrap:'wrap',gap:'4px 12px',marginTop:8}}>
        {CH_ORDER.map(ch => (
          <span key={ch} style={{display:'flex',alignItems:'center',gap:4,fontSize:9,color:T.ink}}>
            <span style={{width:8,height:8,borderRadius:2,background:CH_COLOR[ch],display:'inline-block'}}/>
            {ch}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── (a) Channel cards ────────────────────────────────────────────────────────
function ChannelCards({ mode }) {
  const chRows_s = CH_ORDER.map(ch => ({
    label: ch,
    curV: getS('CH', ch, 'W', W27_CUR),
    prvV: getS('CH', ch, 'W', W27_PREV),
    color: CH_COLOR[ch],
  })).filter(r => r.curV > 0 || r.prvV > 0)

  const chRows_p = CH_ORDER.map(ch => ({
    label: ch,
    curV: getP('CH', ch, 'W', W27_CUR),
    prvV: getP('CH', ch, 'W', W27_PREV),
    color: CH_COLOR[ch],
  })).filter(r => r.curV > 0 || r.prvV > 0)

  if (mode === 'weekly') {
    return (
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
        <HorizontalBars rows={chRows_s} metric="s"
          label="Channels — searches"
          subtitle="W27 2026 vs W27 2025 · session last-click"/>
        <HorizontalBars rows={chRows_p} metric="p"
          label="Channels — bookings"
          subtitle="W27 2026 vs W27 2025 · purchase events"/>
      </div>
    )
  }

  // monthly stacked mode
  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
      <div style={{background:T.card,border:`1px solid ${T.line}`,borderRadius:12,padding:'18px 20px'}}>
        <StackedColumnChart dim="CH" metric="s" months={STACK_MONTHS}
          label="Channels — searches (monthly mix)"/>
      </div>
      <div style={{background:T.card,border:`1px solid ${T.line}`,borderRadius:12,padding:'18px 20px'}}>
        <StackedColumnChart dim="CH" metric="p" months={STACK_MONTHS}
          label="Channels — bookings (monthly mix)"/>
      </div>
    </div>
  )
}

// ─── (b) Channel conversion table ─────────────────────────────────────────────
// Always weekly — brief rule: monthly channel YoY invalid (R2, partial Jun-2025)
function ChannelConversionTable() {
  return (
    <div style={{background:T.card,border:`1px solid ${T.line}`,borderRadius:12,overflow:'hidden',marginTop:16}}>
      <div style={{padding:'12px 18px',borderBottom:`1px solid ${T.line}`,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
        <div>
          <span style={{fontSize:13,fontWeight:700,color:T.ink}}>Channel conversion</span>
          <span style={{fontSize:10,color:T.inkSoft,marginLeft:10}}>
            W27 2026 vs W27 2025 · always weekly (monthly channel YoY invalid — R2)
            <ValidChip/>
          </span>
        </div>
        <span style={{fontSize:10,color:T.inkSoft}}>GA4 ecommerce · purchases = booking events</span>
      </div>
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
          <thead>
            <tr style={{background:T.paper}}>
              {['Channel','Searches','Δ YoY','Bookings','Δ YoY','Revenue (£)','Δ YoY','S→B','Δpp'].map((h,i) => (
                <th key={i} style={{padding:'8px 10px',fontSize:10,fontWeight:700,textTransform:'uppercase',
                  letterSpacing:'.06em',color:T.inkSoft,textAlign:i===0?'left':'right',
                  borderBottom:`2px solid ${T.line}`,whiteSpace:'nowrap'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CH_ORDER.map((ch, i) => {
              const curS = getS('CH',ch,'W',W27_CUR), prvS = getS('CH',ch,'W',W27_PREV)
              const curP = getP('CH',ch,'W',W27_CUR), prvP = getP('CH',ch,'W',W27_PREV)
              const curR = getR('CH',ch,'W',W27_CUR), prvR = getR('CH',ch,'W',W27_PREV)
              if (curS===0 && prvS===0) return null
              const curStob = curS>0 ? curP/curS*100 : 0
              const prvStob = prvS>0 ? prvP/prvS*100 : 0
              const dStob = curStob - prvStob
              const dS = delta(curS,prvS), dP = delta(curP,prvP), dR = delta(curR,prvR)
              return (
                <tr key={ch} style={{background:i%2===0?T.card:T.paper,borderBottom:`1px solid ${T.line}`}}>
                  <td style={{padding:'8px 10px'}}>
                    <span style={{width:8,height:8,borderRadius:2,background:CH_COLOR[ch],display:'inline-block',marginRight:6,verticalAlign:'middle'}}/>
                    <span style={{fontWeight:600,color:T.ink}}>{ch}</span>
                  </td>
                  <td style={{padding:'6px 10px',textAlign:'right',fontWeight:600}}>{fmtN(curS)}</td>
                  <td style={{padding:'6px 8px',textAlign:'right'}}>
                    {prvS>0?<DeltaChip cur={curS} prv={prvS} small/>:'–'}
                  </td>
                  <td style={{padding:'6px 10px',textAlign:'right',fontWeight:600}}>{fmtN(curP)}</td>
                  <td style={{padding:'6px 8px',textAlign:'right'}}>
                    {prvP>0?<DeltaChip cur={curP} prv={prvP} small/>:'–'}
                  </td>
                  <td style={{padding:'6px 10px',textAlign:'right'}}>{fmtGBP(curR)}</td>
                  <td style={{padding:'6px 8px',textAlign:'right'}}>
                    {prvR>0?<DeltaChip cur={curR} prv={prvR} small/>:'–'}
                  </td>
                  <td style={{padding:'6px 10px',textAlign:'right',fontWeight:700,color:T.pine}}>{fmtPct(curStob,2)}</td>
                  <td style={{padding:'6px 10px',textAlign:'right',fontWeight:700,color:dStob>=0?'#0A7A52':T.coral,whiteSpace:'nowrap'}}>
                    {prvS>0?(dStob>=0?'+':'')+dStob.toFixed(2)+'pp':'–'}
                  </td>
                </tr>
              )
            }).filter(Boolean)}
          </tbody>
        </table>
      </div>
      <div style={{padding:'8px 14px',fontSize:10,color:T.inkSoft,borderTop:`1px solid ${T.line}`}}>
        S→B = search-to-booking rate · Δpp = S→B(W27 2026) − S→B(W27 2025) · no totals row (mix-shift artifact) · purchase events = GA4 ecommerce
      </div>
    </div>
  )
}

// ─── (c) Devices ─────────────────────────────────────────────────────────────
function DevicesCard() {
  const devVals = Object.keys(AUD_DATA.DV || {})
  const rows = devVals.map(dv => ({
    label: dv === '(unknown)' ? 'Unknown' : dv.charAt(0).toUpperCase() + dv.slice(1),
    curV: getS('DV', dv, 'W', W27_CUR),
    prvV: getS('DV', dv, 'W', W27_PREV),
    color: T.pine,
  })).sort((a,b) => b.curV - a.curV)

  return (
    <HorizontalBars rows={rows}
      label="Devices — searches"
      subtitle="W27 2026 vs W27 2025 (pale bars) · session last-click · site-wide"/>
  )
}

// ─── (d) Booking countries ────────────────────────────────────────────────────
function CountriesCard() {
  const coData = AUD_DATA.CO || {}
  const rows = Object.entries(coData)
    .map(([ctry, v]) => ({
      label: ctry,
      val: (v.M?.[COUNTRY_MONTH]?.[1]) ?? 0,   // purchase events June 2026
    }))
    .filter(r => r.val > 0)
    .sort((a,b) => b.val - a.val)

  const maxV = Math.max(...rows.map(r => r.val), 1)

  return (
    <div style={{background:T.card,border:`1px solid ${T.line}`,borderRadius:12,padding:'18px 20px'}}>
      <div style={{fontSize:13,fontWeight:700,color:T.ink,marginBottom:4}}>Booking countries</div>
      <div style={{fontSize:10,color:T.inkSoft,marginBottom:14}}>
        Purchase events by user country · June 2026 · no YoY (June 2025 GA4 = partial, rule R2)
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {rows.map(({ label, val }, i) => {
          const isOther = label === 'Other countries'
          const barColor = isOther ? CH_COLOR['Other'] : T.leaf
          const wPct = Math.max(2, (val/maxV)*100)
          return (
            <div key={i}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
                <span style={{fontSize:11,fontWeight:600,color:isOther?T.inkSoft:T.ink}}>{label}</span>
                <span style={{fontSize:11,fontWeight:700,color:T.ink}}>{fmtN(val)}</span>
              </div>
              <div style={{height:9,background:T.grey,borderRadius:4,overflow:'hidden'}}>
                <div style={{width:`${wPct}%`,height:'100%',background:barColor,borderRadius:4}}/>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main exported component ──────────────────────────────────────────────────
export default function AudienceChannelsTab() {
  const [mode, setMode] = useState('weekly') // 'weekly' | 'monthly'
  const [expanded, setExpanded] = useState(false)

  const modeLabel = mode === 'weekly'
    ? <>W27 2026 vs W27 2025 <ValidChip/></>
    : 'Jul 2025 – Jun 2026 monthly channel mix (complete months)'

  return (
    <div style={{padding:'0 0 32px'}}>
      {/* Header */}
      <div style={{marginBottom:16}}>
        <h2 style={{fontFamily:'Georgia,serif',fontSize:20,fontWeight:700,color:T.ink,margin:'0 0 6px'}}>
          Where demand and bookings come from
        </h2>
        <div style={{fontSize:11,color:T.inkSoft,lineHeight:1.6}}>
          Session last-click, site-wide · weekly YoY is valid.{' '}
          <button onClick={()=>setExpanded(e=>!e)}
            style={{background:'none',border:'none',color:T.leaf,fontSize:11,cursor:'pointer',fontFamily:'inherit',padding:0}}>
            attribution detail {expanded?'▴':'▾'}
          </button>
        </div>
        {expanded && (
          <div style={{marginTop:8,padding:'10px 14px',background:T.paper,border:`1px solid ${T.line}`,borderRadius:8,fontSize:11,color:T.inkSoft,lineHeight:1.7,maxWidth:700}}>
            <strong style={{color:T.ink}}>Field used:</strong> <code>session_traffic_source_last_click</code> — session-scoped last-click attribution.<br/>
            <strong style={{color:T.ink}}>Google Ads quirk:</strong> For autotagged sessions, <code>manual_campaign.source/medium</code> reads '(not set)' while <code>google_ads_campaign.campaign_name</code> is populated. The CASE checks the google_ads struct first, so ~19K paid search events per week are correctly classified, not misfiled as Direct.<br/>
            <strong style={{color:T.ink}}>Nine channel groups:</strong> Paid search · Organic search · Direct/unattributed · Email/CRM · Affiliates · App store · Referral · AI assistants · Other.<br/>
            <strong style={{color:T.ink}}>Not available:</strong> per-airport channel splits — field is site-wide only, no location dimension in the attribution record.
          </div>
        )}
      </div>

      {/* Toggle + label */}
      <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:16,flexWrap:'wrap'}}>
        <div style={{display:'flex',background:T.grey,borderRadius:10,padding:3}}>
          {[{k:'weekly',l:'Latest week YoY'},{k:'monthly',l:'Monthly trend'}].map(v=>(
            <button key={v.k} onClick={()=>setMode(v.k)}
              style={{padding:'6px 14px',borderRadius:8,border:'none',fontSize:12,fontWeight:mode===v.k?700:500,
                cursor:'pointer',transition:'all .15s',
                background:mode===v.k?T.card:'transparent',
                color:mode===v.k?T.pine:T.inkSoft,
                boxShadow:mode===v.k?'0 1px 4px rgba(0,0,0,.12)':'none'}}>
              {v.l}
            </button>
          ))}
        </div>
        <div style={{fontSize:11,color:T.inkSoft}}>{modeLabel}</div>
      </div>

      {/* (a) Channel cards */}
      <ChannelCards mode={mode}/>

      {/* (b) Channel conversion table — always weekly */}
      <ChannelConversionTable/>

      {/* (c) Devices + (d) Countries — grid2 */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginTop:16}}>
        <DevicesCard/>
        <CountriesCard/>
      </div>
    </div>
  )
}
