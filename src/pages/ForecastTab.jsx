/**
 * ForecastTab.jsx — Weekly EAM Performance, Forecast tab
 * Reproduces the "Forecast By AI" sheet exactly.
 *
 * Spec: ORBIT_FORECAST_SPEC.md
 * Non-negotiables (§0):
 *  - model_version = fwd_v2 for geo, fwd_cust_v1 for customer (handled in edge fn)
 *  - Always MAX(forecast_date) — handled in edge fn
 *  - This tab does NOT follow the period selector (forward-looking always)
 *  - Shared scale across all month KPI tiles
 *  - Coverage capped at 100%
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  Title, Tooltip, Legend,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────────────────────────────────────
const T = {
  bg:'#ffffff',bg2:'#FAFBFC',bg3:'#F1F5F9',bg4:'#E2EAF0',
  text:'#1A2B3C',text2:'#374151',text3:'#64748B',
  border:'#E2EAF0',border2:'#B8C4D0',
  green:'#1D9E75',blue:'#185FA5',red:'#E24B4A',
  amber:'#EAB308',amberInk:'#9A6B0C',
  lift:'0 1px 2px rgba(26,26,24,.05), 0 6px 16px -6px rgba(26,26,24,.10)',
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function num(v){const x=(v===null||v===undefined||v==='')?NaN:Number(v);return isFinite(x)?x:0}
const usd=(v,d=0)=>'$'+num(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})
function usdC(v){const x=num(v),a=Math.abs(x),s=x<0?'-$':'$';if(a>=1e6)return s+(a/1e6).toFixed(2)+'M';if(a>=1e5)return s+(a/1e3).toFixed(0)+'k';if(a>=1e3)return s+(a/1e3).toFixed(1)+'k';return s+a.toFixed(a<10?2:0)}
function axUsd(v){if(v===0)return '$0';return usdC(v)}
const pctFmt=(v,d=1)=>(v===null||v===undefined||!isFinite(Number(v)))?'—':(num(v)*100).toFixed(d)+'%'

// ─────────────────────────────────────────────────────────────────────────────
// §9 — Geography colours
// ─────────────────────────────────────────────────────────────────────────────
const GEO_COLOR={
  'Americas':'#185FA5',
  'America&Africa, Asia, Oceania':'#185FA5',
  'Americas/Asia/Africa/Oceania':'#185FA5',   // taxonomy post-2026-08-17
  'Europe':'#1D9E75',
  'Asia/Africa/Oceania':'#D85A30',
  '(Unassigned)':'#8b8a83',
}
const geoHex=g=>GEO_COLOR[g]||'#7F77DD'

// ─────────────────────────────────────────────────────────────────────────────
// Custom Chart.js plugins — same guard as DepartmentsTab.jsx
// ─────────────────────────────────────────────────────────────────────────────
const _reg=new Set()
function safeReg(p){if(_reg.has(p.id))return;_reg.add(p.id);try{ChartJS.register(p)}catch{}}

// barLabels — inside segment labels + outside horizontal labels
safeReg({
  id:'barLabels',
  defaults:{enabled:false},
  afterDatasetsDraw(chart,_args,opts){
    if(!opts||opts.enabled===false)return
    const fmt=opts.fmt||'usd',inside=!!opts.inside,minPx=opts.minPx||0
    const horiz=chart.options.indexAxis==='y'
    const ctx=chart.ctx;ctx.save()
    ctx.font=`${opts.weight||'600'} ${opts.size||10}px ${ChartJS.defaults.font.family}`
    chart.data.datasets.forEach((ds,di)=>{
      const meta=chart.getDatasetMeta(di)
      if(meta.hidden||!meta.data?.length)return
      if((meta.type||chart.config.type)!=='bar')return
      if(ds.noLabel)return
      meta.data.forEach((el,i)=>{
        const v=ds.data[i]
        if(v===null||v===undefined||!isFinite(v)||Number(v)===0)return
        const txt=fmt==='pct'?Number(v).toFixed(1)+'%':usdC(v)
        const span=horiz?Math.abs(el.x-el.base):Math.abs(el.base-el.y)
        if(minPx&&span<minPx)return
        if(inside){
          ctx.fillStyle='#ffffff';ctx.textAlign='center';ctx.textBaseline='middle'
          horiz?ctx.fillText(txt,(el.x+el.base)/2,el.y):ctx.fillText(txt,el.x,(el.y+el.base)/2)
        }else{
          ctx.fillStyle=opts.color||'#5f5e5a'
          if(horiz){ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(txt,el.x+6,el.y)}
          else{ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText(txt,el.x,el.y-6)}
        }
      })
    })
    ctx.restore()
  },
})

// stackTotal — writes the column total above each stacked bar
safeReg({
  id:'stackTotal',
  defaults:{enabled:false},
  afterDatasetsDraw(chart,_args,opts){
    if(!opts||!opts.enabled)return
    const ctx=chart.ctx;ctx.save()
    ctx.font=`700 11px ${ChartJS.defaults.font.family}`
    ctx.fillStyle='#1a1a18';ctx.textAlign='center';ctx.textBaseline='bottom'
    const labels=chart.data.labels||[]
    labels.forEach((_,i)=>{
      let top=Infinity,total=0,any=false
      chart.data.datasets.forEach((ds,di)=>{
        const meta=chart.getDatasetMeta(di)
        if(meta.hidden)return
        const el=meta.data[i]
        if(!el)return
        const v=num(ds.data[i])
        if(v!==0)any=true
        total+=v
        if(el.y<top)top=el.y
      })
      if(any)ctx.fillText(usdC(total),chart.getDatasetMeta(0).data[i].x,top-4)
    })
    ctx.restore()
  },
})

// ─────────────────────────────────────────────────────────────────────────────
// §6.2 — Coverage cell (reusable across table and accounts)
// ─────────────────────────────────────────────────────────────────────────────
function CovCell({cm,rev,compact=false}){
  const c=num(rev)>0?num(cm)/num(rev):null
  if(c===null)return<td style={{padding:'8px 14px',textAlign:'right',color:T.text3}}>—</td>
  const pct=Math.min(100,c*100)
  const col=pct>=60?T.green:pct>=30?T.amber:T.red
  return(
    <td style={{padding:'8px 14px',textAlign:'right',verticalAlign:'middle'}}>
      <div style={{display:'flex',alignItems:'center',gap:7,justifyContent:'flex-end'}}>
        <span style={{display:'block',width:54,height:6,background:T.bg4,borderRadius:99,overflow:'hidden',flexShrink:0}}>
          <span style={{display:'block',height:'100%',width:`${pct.toFixed(1)}%`,background:col,borderRadius:99}}/>
        </span>
        <span style={{fontVariantNumeric:'tabular-nums',fontWeight:600,color:col,minWidth:34,textAlign:'right',fontSize:13}}>{pct.toFixed(0)}%</span>
      </div>
    </td>
  )
}

// rangeCell — stacked main / low–high
function RangeCell({mid,lo,hi}){
  return(
    <td style={{padding:'8px 14px',textAlign:'right',verticalAlign:'middle'}}>
      <div style={{display:'flex',flexDirection:'column',gap:1,alignItems:'flex-end'}}>
        <span style={{fontVariantNumeric:'tabular-nums',fontWeight:500,fontSize:13}}>{usd(mid)}</span>
        <span style={{fontSize:11,color:T.text3,fontVariantNumeric:'tabular-nums'}}>{usdC(lo)} – {usdC(hi)}</span>
      </div>
    </td>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// §5.1 — Stacked geo chart (local plugins only — avoids cross-module conflicts)
// ─────────────────────────────────────────────────────────────────────────────
function GeoChart({months,geos,D}){
  const ref=useRef(null)
  const chartRef=useRef(null)
  useEffect(()=>{
    if(!ref.current)return
    if(chartRef.current){chartRef.current.destroy();chartRef.current=null}

    // Local plugin: segment labels inside bars
    const segLabels={
      id:'fc_segLabels',
      afterDatasetsDraw(chart){
        const ctx=chart.ctx;ctx.save()
        ctx.font=`600 10px ${ChartJS.defaults.font.family}`
        ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle'
        chart.data.datasets.forEach((ds,di)=>{
          const meta=chart.getDatasetMeta(di)
          if(meta.hidden||!meta.data?.length)return
          meta.data.forEach((el,i)=>{
            const v=ds.data[i];if(!v||!isFinite(v)||v===0)return
            const span=Math.abs(el.base-el.y)
            if(span<26)return  // skip segments too thin
            ctx.fillText(usdC(v),el.x,(el.y+el.base)/2)
          })
        })
        ctx.restore()
      },
    }

    // Local plugin: stack totals above each column
    const colTotals={
      id:'fc_colTotals',
      afterDatasetsDraw(chart){
        const ctx=chart.ctx;ctx.save()
        ctx.font=`700 11px ${ChartJS.defaults.font.family}`
        ctx.fillStyle='#1a1a18';ctx.textAlign='center';ctx.textBaseline='bottom'
        chart.data.labels.forEach((_,i)=>{
          let top=Infinity,total=0,any=false
          chart.data.datasets.forEach((ds,di)=>{
            const meta=chart.getDatasetMeta(di)
            if(meta.hidden)return
            const el=meta.data[i];if(!el)return
            const v=num(ds.data[i]);if(v!==0)any=true
            total+=v
            if(el.y<top)top=el.y
          })
          if(any)ctx.fillText(usdC(total),chart.getDatasetMeta(0).data[i].x,top-4)
        })
        ctx.restore()
      },
    }

    chartRef.current=new ChartJS(ref.current,{
      type:'bar',
      plugins:[segLabels,colTotals],
      data:{
        labels:months,
        datasets:geos.map(g=>({
          label:g,
          backgroundColor:geoHex(g),
          borderColor:'#ffffff',
          borderWidth:{top:2,bottom:0,left:0,right:0},
          borderRadius:4,
          borderSkipped:false,
          barPercentage:0.46,
          categoryPercentage:0.7,
          data:months.map(m=>{const r=D.fc.find(x=>x.ym===m&&x.geo===g);return r?num(r.pro):0}),
        })),
      },
      options:{
        responsive:true,maintainAspectRatio:false,
        layout:{padding:{top:30}},
        plugins:{
          legend:{display:false},
          // Disable ALL globally registered plugins for this chart
          barLabels:{enabled:false},
          stackTotal:{enabled:false},
          datalabels:{display:false},
          tooltip:{
            mode:'index',intersect:false,
            callbacks:{
              label:x=>` ${x.dataset.label}  ${usd(x.raw)}`,
              footer:items=>`Total  ${usd(items.reduce((a,i)=>a+num(i.raw),0))}`,
            },
          },
        },
        scales:{
          x:{stacked:true,border:{display:false},grid:{display:false},ticks:{font:{size:11.5},padding:4}},
          y:{stacked:true,beginAtZero:true,border:{display:false},
             ticks:{callback:v=>axUsd(v),font:{size:10},padding:8,maxTicksLimit:4},
             grid:{color:'rgba(0,0,0,.05)',drawTicks:false}},
        },
      },
    })
    return()=>{if(chartRef.current){chartRef.current.destroy();chartRef.current=null}}
  },[D.fc])
  return <canvas ref={ref} style={{width:'100%',height:'100%'}}/>
}

// ─────────────────────────────────────────────────────────────────────────────
// §5.2 — Revenue coverage chart (pure HTML/CSS — no canvas, no plugin conflicts)
// ─────────────────────────────────────────────────────────────────────────────
function CovChart({months, mAgg}) {
  if (!mAgg.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '8px 0 4px' }}>
      {mAgg.map(a => {
        const pct = a.rev > 0 ? Math.min(100, (a.cm / a.rev) * 100) : 0
        const color = pct >= 60 ? T.green : pct >= 30 ? T.amber : T.red
        return (
          <div key={a.ym} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 0' }}>
            {/* Month label */}
            <div style={{ width: 64, fontSize: 12, fontWeight: 700, color: T.text, flexShrink: 0 }}>{a.ym}</div>
            {/* Track + fill */}
            <div style={{ flex: 1, position: 'relative', height: 18, background: T.bg4, borderRadius: 99, overflow: 'hidden' }}>
              <div style={{
                position: 'absolute', top: 0, left: 0, height: '100%',
                width: `${pct.toFixed(2)}%`,
                background: color, borderRadius: 99,
              }}/>
            </div>
            {/* Pct label */}
            <div style={{ width: 48, fontSize: 13, fontWeight: 700, color, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
              {pct.toFixed(1)}%
            </div>
          </div>
        )
      })}
      {/* Scale ticks */}
      <div style={{ display: 'flex', paddingLeft: 78, paddingRight: 62, marginTop: 6 }}>
        {[0, 50, 100].map(v => (
          <div key={v} style={{
            flex: v === 0 ? 0 : 1, textAlign: v === 0 ? 'left' : v === 100 ? 'right' : 'center',
            fontSize: 10, color: T.text3,
          }}>{v}%</div>
        ))}
      </div>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
// GEO_MERGE_DATE — Americas/Asia/Africa/Oceania merged into one geo on this date.
// Vintages >= this date have 2 geos; earlier vintages have 3.
// Do not compare geo splits across this boundary without annotating it.
const GEO_MERGE_DATE = '2026-08-17'

export default function ForecastTab({D,period,CUR_MONTH,targets,PC,fcVintage,fccVintage,asAt}){
  // §6.1 — expand state persisted
  const[fcOpen,setFcOpen]=useState({})
  const toggleFc=m=>{setFcOpen(prev=>{const n={...prev,[m]:!prev[m]};localStorage.setItem('eam.fcOpen',JSON.stringify(n));return n})}
  const setAllFc=open=>{setFcOpen(prev=>{const n={};months.forEach(m=>{n[m]=open});localStorage.setItem('eam.fcOpen',JSON.stringify(n));return n})}

  // §2 — aggregation
  const months=useMemo(()=>[...new Set((D.fc||[]).map(r=>r.ym))].sort(),[D.fc])
  const geos=useMemo(()=>[...new Set((D.fc||[]).map(r=>r.geo))].sort(),[D.fc])
  const mAgg=useMemo(()=>months.map(m=>{
    const rows=(D.fc||[]).filter(r=>r.ym===m)
    const s=k=>rows.reduce((a,r)=>a+num(r[k]),0)
    return{ym:m,rows,pro:s('pro'),lo:s('pro_lo'),hi:s('pro_hi'),cm:s('committed'),rev:s('rev'),rev_lo:s('rev_lo'),rev_hi:s('rev_hi')}
  }),[months,D.fc])

  // §2.1 — shared scale
  const{scLo,scHi,span}=useMemo(()=>{
    if(!mAgg.length)return{scLo:0,scHi:1,span:1}
    const lo=Math.min(...mAgg.map(a=>a.lo))
    const hi=Math.max(...mAgg.map(a=>a.hi))
    return{scLo:lo,scHi:hi,span:(hi-lo)||1}
  },[mAgg])
  const poscale=v=>Math.max(0,Math.min(100,((v-scLo)/span)*100))

  // §7 — top forecast accounts: next month after current, fallback last
  const nextM=useMemo(()=>months.filter(m=>m>CUR_MONTH)[0]||months[months.length-1],[months,CUR_MONTH])
  const topAccounts=useMemo(()=>(D.fcc||[]).filter(r=>r.ym===nextM).sort((a,b)=>num(b.pro)-num(a.pro)).slice(0,20),[D.fcc,nextM])

  // §4 — company target for current month
  // MUST sum only DEPT_TARGET_KEYS (4 depts). Sales Mo / Sales Jojo are sub-teams
  // already inside their parent — including them gives 2,064,299 instead of 2,045,426
  // and makes the attainment read 85% instead of the correct 86%. §1.1 of Departments spec.
  const DEPT_TARGET_KEYS_FC = ['EAM Chris','EAM Renaldo','EAM Gloria','B2C Matt']
  const company=useMemo(()=>{
    const deptTgts={}
    ;(D.targets||[]).forEach(r=>{if(r.kind==='dept'&&r.ym===CUR_MONTH)deptTgts[r.dim]=num(r.tgt)})
    return DEPT_TARGET_KEYS_FC.reduce((a,k)=>a+(deptTgts[k]||0),0)
  },[D.targets,CUR_MONTH])

  // fdate from first fc row (backwards-compat: fdate is now also fcVintage prop)
  const fdate = fcVintage ?? (D.fc&&D.fc[0]?.fdate) ?? null
  const fdateFCC = fccVintage ?? null

  // §2.2 — stale vintage: resolved forecast is older than the snap asAt
  const fcIsStale = fdate && asAt && fdate < asAt
  const fccIsStale = fdateFCC && asAt && fdateFCC < asAt

  // §3 — geo taxonomy note: vintage >= 2026-08-17 has 2 geos; older has 3
  const geoIsMerged = fdate && fdate >= GEO_MERGE_DATE

  // Geo totals for legend
  const geoTotals=useMemo(()=>{
    const t={}
    ;(D.fc||[]).forEach(r=>{t[r.geo]=(t[r.geo]||0)+num(r.pro)})
    return t
  },[D.fc])
  const geoAll=Object.values(geoTotals).reduce((a,v)=>a+v,0)

  // Grand totals for table footer
  const gt=k=>mAgg.reduce((x,a)=>x+num(a[k]),0)

  if(!D.fc||D.fc.length===0){
    return(
      <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:300,color:T.text3,fontSize:13}}>
        Forecast data not loaded — click Refresh.
      </div>
    )
  }

  const TD={padding:'8px 14px',fontSize:13,verticalAlign:'middle'}
  const TH={padding:'7px 14px',fontSize:10,fontWeight:600,color:T.text3,textTransform:'uppercase',letterSpacing:'0.05em',background:T.bg2,borderBottom:`1px solid ${T.border}`,whiteSpace:'nowrap',textAlign:'right'}
  const ROW={borderBottom:`1px solid ${T.border}`}

  return(
    <div>
      {/* Header */}
      <div style={{marginBottom:12}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <h1 style={{fontSize:20,fontWeight:700,color:T.text,margin:0}}>Forward-Booking Forecast</h1>
          {/* Vintage badge — replaces LIVE. Forecast tables already accumulate immutable
              vintages; this is not a snap source but the date is still meaningful. */}
          <span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:10,background:'rgba(0,0,0,.06)',color:T.text3,letterSpacing:'0.04em'}}>
            Vintage {fdate ? String(fdate).slice(0,10) : '…'}
          </span>
        </div>
        <div style={{fontSize:13,color:T.text3,marginTop:4}}>
          Model <code style={{fontSize:12,background:T.bg4,padding:'1px 5px',borderRadius:4}}>fwd_v2</code>
          {' · geo'}
          {fdateFCC&&<> · customer vintage {String(fdateFCC).slice(0,10)}</>}
        </div>
      </div>

      {/* §2.2 — stale vintage warning: forecast older than the snap asAt */}
      {fcIsStale&&(
        <div style={{background:'rgba(234,179,8,.12)',border:'1px solid #EAB308',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12.5,color:'#78590A',lineHeight:1.7}}>
          <strong>Forecast vintage {String(fdate).slice(0,10)}</strong> · this week's model had not published when the snapshot was taken.
        </div>
      )}
      {fccIsStale&&!fcIsStale&&(
        <div style={{background:'rgba(234,179,8,.12)',border:'1px solid #EAB308',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12.5,color:'#78590A',lineHeight:1.7}}>
          <strong>Customer forecast vintage {String(fdateFCC).slice(0,10)}</strong> · the customer model had not published when the snapshot was taken.
        </div>
      )}

      {/* §8 — Period notice for non-MTD */}
      {period!=='mtd'&&(
        <div style={{background:'rgba(234,179,8,.12)',border:'1px solid #EAB308',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12.5,color:'#78590A',lineHeight:1.7}}>
          <strong>Forecast does not follow the period selector.</strong> It is forward-looking by pickup month and always shows the latest model run, so a historical period does not apply. The selector currently reads <strong>{PC?.label||period}</strong>; the figures on this tab are unchanged.
        </div>
      )}

      {/* ── §4 KPI row — one tile per pickup month ─────────────────────────── */}
      <div style={{marginBottom:8}}>
        <div style={{fontSize:10,fontWeight:600,color:T.text3,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:10}}>Forecast Total Profit by Pickup Month</div>
        <div style={{display:'grid',gridTemplateColumns:`repeat(${mAgg.length},1fr)`,gap:12,marginBottom:20}}>
          {mAgg.map(a=>{
            const isCur=a.ym===CUR_MONTH
            const band=a.hi-a.lo
            const unc=a.pro>0?(band/2)/a.pro:null
            const cov=a.rev>0?a.cm/a.rev:null
            const ach=isCur&&company>0?a.pro/company:null
            const lo_p=poscale(a.lo),hi_p=poscale(a.hi),mid_p=poscale(a.pro)
            return(
              <div key={a.ym} style={{background:T.bg,borderRadius:10,padding:'14px 16px',boxShadow:T.lift,border:`1px solid ${isCur?T.blue:T.border}`}}>
                <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:4}}>
                  <span style={{fontSize:12,fontWeight:600,color:T.text3}}>{a.ym}</span>
                  {isCur&&<span style={{fontSize:9,fontWeight:700,padding:'1px 6px',borderRadius:8,background:'rgba(24,95,165,.10)',color:T.blue,letterSpacing:'0.04em'}}>current</span>}
                </div>
                <div style={{fontSize:22,fontWeight:700,color:T.text,lineHeight:1.15,marginBottom:2}}>{usdC(a.pro)}</div>
                <div style={{fontSize:11,color:T.text3,marginBottom:6}}>
                  {unc!==null&&`± ${(unc*100).toFixed(1)}%`}
                  {cov!==null&&` · coverage ${(cov*100).toFixed(0)}%`}
                </div>
                {/* §4.1 Range band — shared scale */}
                <div title={`Range ${usdC(a.lo)} to ${usdC(a.hi)} on a scale shared across all months`}
                  style={{position:'relative',height:6,background:T.bg4,borderRadius:99,margin:'9px 0 3px'}}>
                  <span style={{position:'absolute',top:0,bottom:0,left:`${lo_p.toFixed(1)}%`,right:`${(100-hi_p).toFixed(1)}%`,background:'rgba(24,95,165,.22)',borderRadius:99}}/>
                  <span style={{position:'absolute',top:-2,width:3,height:10,background:T.blue,borderRadius:2,left:`calc(${mid_p.toFixed(1)}% - 1.5px)`}}/>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:T.text3,fontVariantNumeric:'tabular-nums',marginBottom:ach!==null?8:0}}>
                  <span>{usdC(a.lo)}</span><span>{usdC(a.hi)}</span>
                </div>
                {/* Goal row — current month only */}
                {ach!==null&&(
                  <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${T.border}`}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5}}>
                      <span style={{fontSize:11,color:T.text3}}>vs target</span>
                      <span style={{fontSize:13,fontWeight:700,color:ach>=1?T.green:ach>=0.8?T.amberInk:T.red}}>{(ach*100).toFixed(0)}%</span>
                    </div>
                    <div style={{height:4,background:T.bg4,borderRadius:99,overflow:'hidden'}}>
                      <div style={{height:'100%',width:`${Math.min(100,ach*100).toFixed(1)}%`,background:ach>=1?T.green:ach>=0.8?T.amber:T.red,borderRadius:99}}/>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── §5 Charts row ─────────────────────────────────────────────────── */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:24}}>
        {/* §5.1 Geo stacked bar */}
        <div style={{background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,padding:'16px 20px 14px'}}>
          <div style={{fontWeight:700,fontSize:14,color:T.text,marginBottom:2}}>Forecast total profit by geography</div>
          <div style={{fontSize:11.5,color:T.text3,marginBottom:14}}>
            Four months ahead · totals above each column, {usdC(geoAll)} in aggregate
            {/* §3 — geo taxonomy note */}
            {geoIsMerged&&<span style={{marginLeft:8,fontSize:10,background:'rgba(234,179,8,.15)',color:'#78590A',padding:'1px 6px',borderRadius:9,border:'1px solid rgba(234,179,8,.4)'}}>Americas &amp; Asia/Africa/Oceania merged from Aug 17</span>}
          </div>
          <div style={{height:300}}>
            <GeoChart months={months} geos={geos} D={D}/>
          </div>
          {/* Value legend */}
          <div style={{marginTop:14,display:'flex',flexDirection:'column',gap:4}}>
            {geos.slice().sort((a,b)=>(geoTotals[b]||0)-(geoTotals[a]||0)).map(g=>(
              <div key={g} style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:T.text2}}>
                <span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:geoHex(g),flexShrink:0}}/>
                <span style={{flex:1}}>{g}</span>
                <span style={{fontVariantNumeric:'tabular-nums',fontWeight:500}}>{usdC(geoTotals[g]||0)}</span>
                <span style={{color:T.text3,minWidth:36,textAlign:'right'}}>{geoAll>0?((geoTotals[g]||0)/geoAll*100).toFixed(1)+'%':'—'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* §5.2 Coverage chart */}
        <div style={{background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,padding:'16px 20px 14px'}}>
          <div style={{fontWeight:700,fontSize:14,color:T.text,marginBottom:2}}>Revenue coverage</div>
          <div style={{fontSize:11.5,color:T.text3,marginBottom:14}}>Share of forecast revenue already committed · the booking curve decays with horizon</div>
          <CovChart months={months} mAgg={mAgg}/>
          <div style={{marginTop:14,paddingTop:12,borderTop:`1px solid ${T.border}`,fontSize:11.5,color:T.text3,lineHeight:1.65}}>
            Decay with distance is expected, not a warning — the current month is nearly all booked while later months are still mostly modelled. What matters is the <em>rate</em>: a month sitting well below the curve is under-booked for its horizon.
          </div>
        </div>
      </div>

      {/* ── §6 Detail table ─────────────────────────────────────────────────── */}
      <div style={{marginBottom:24}}>
        <div style={{fontSize:10,fontWeight:700,color:T.text3,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:10,display:'flex',alignItems:'center',gap:12}}>
          <span>Forecast detail</span>
        </div>

        {/* Controls */}
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
          <button onClick={()=>setAllFc(true)} style={{fontSize:12,fontWeight:600,padding:'5px 12px',border:`1px solid ${T.border}`,borderRadius:6,background:T.bg,color:T.text2,cursor:'pointer',fontFamily:'inherit'}}>Expand all</button>
          <button onClick={()=>setAllFc(false)} style={{fontSize:12,fontWeight:600,padding:'5px 12px',border:`1px solid ${T.border}`,borderRadius:6,background:T.bg,color:T.text2,cursor:'pointer',fontFamily:'inherit'}}>Collapse all</button>
          <div style={{marginLeft:'auto',fontSize:12,color:T.text3,background:T.bg4,padding:'4px 10px',borderRadius:6}}>
            {mAgg.length} months · {mAgg.reduce((a,x)=>a+x.rows.length,0)} rows · model fwd_v2
          </div>
        </div>

        <div style={{background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,overflow:'hidden'}}>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'auto'}}>
              <thead>
                <tr>
                  <th style={{...TH,textAlign:'left',paddingLeft:14,width:'22%'}}>Month / Geo</th>
                  <th style={TH}>Committed</th>
                  <th style={{...TH,minWidth:160}}><div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:1}}><span>Forecast Revenue</span><span style={{fontWeight:400,fontSize:9,opacity:.8}}>low – high</span></div></th>
                  <th style={{...TH,minWidth:160}}><div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:1}}><span>Forecast Total Profit</span><span style={{fontWeight:400,fontSize:9,opacity:.8}}>low – high</span></div></th>
                  <th style={TH}>Margin</th>
                  <th style={TH}>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {mAgg.map(a=>{
                  const open=!!fcOpen[a.ym]
                  const isCur=a.ym===CUR_MONTH
                  const marg=a.rev>0?a.pro/a.rev:null
                  return[
                    // Month group row
                    <tr key={`m_${a.ym}`} onClick={()=>toggleFc(a.ym)} style={{...ROW,background:T.bg,cursor:'pointer'}} onMouseEnter={e=>{e.currentTarget.style.background='#EFF6FF'}} onMouseLeave={e=>{e.currentTarget.style.background=T.bg}}>
                      <td style={{...TD,paddingLeft:14,fontWeight:700}}>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <span style={{fontSize:9,color:T.text3,display:'inline-block',transform:open?'rotate(90deg)':'rotate(0deg)',transition:'transform 0.15s',lineHeight:1,flexShrink:0}}>▶</span>
                          <span>{a.ym}</span>
                          {isCur&&<span style={{fontSize:9,fontWeight:700,padding:'1px 6px',borderRadius:8,background:'rgba(24,95,165,.10)',color:T.blue,letterSpacing:'0.04em'}}>current</span>}
                          <span style={{fontSize:10,color:T.text3,background:T.bg4,borderRadius:8,padding:'1px 6px',flexShrink:0}}>{a.rows.length}</span>
                        </div>
                      </td>
                      <td style={{...TD,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{usd(a.cm)}</td>
                      <RangeCell mid={a.rev} lo={a.rev_lo} hi={a.rev_hi}/>
                      <RangeCell mid={a.pro} lo={a.lo}     hi={a.hi}/>
                      <td style={{...TD,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{pctFmt(marg,1)}</td>
                      <CovCell cm={a.cm} rev={a.rev}/>
                    </tr>,
                    // Geo child rows
                    open&&a.rows.slice().sort((x,y)=>num(y.pro)-num(x.pro)).map(r=>(
                      <tr key={`geo_${a.ym}_${r.geo}`} style={{...ROW,background:T.bg}} onMouseEnter={e=>{e.currentTarget.style.background='#EFF6FF'}} onMouseLeave={e=>{e.currentTarget.style.background=T.bg}}>
                        <td style={{...TD,paddingLeft:36}}>
                          <div style={{fontWeight:500,fontSize:13,color:T.text}}>{r.geo}</div>
                          {r.note&&<span style={{fontSize:10,color:T.text3,background:T.bg4,border:`1px solid ${T.border}`,borderRadius:9,padding:'1px 7px',marginTop:2,display:'inline-block'}}>{r.note}</span>}
                        </td>
                        <td style={{...TD,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{usd(num(r.committed))}</td>
                        <RangeCell mid={num(r.rev)} lo={num(r.rev_lo)} hi={num(r.rev_hi)}/>
                        <RangeCell mid={num(r.pro)} lo={num(r.pro_lo)} hi={num(r.pro_hi)}/>
                        <td style={{...TD,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{pctFmt(num(r.rev)>0?num(r.pro)/num(r.rev):null,1)}</td>
                        <CovCell cm={num(r.committed)} rev={num(r.rev)}/>
                      </tr>
                    )),
                  ]
                })}
                {/* Total row */}
                <tr style={{background:T.bg,borderTop:`2px solid ${T.border}`}}>
                  <td style={{...TD,paddingLeft:14,fontWeight:700}}>All months</td>
                  <td style={{...TD,textAlign:'right',fontVariantNumeric:'tabular-nums',fontWeight:600}}>{usd(gt('cm'))}</td>
                  <RangeCell mid={gt('rev')} lo={gt('rev_lo')} hi={gt('rev_hi')}/>
                  <RangeCell mid={gt('pro')} lo={gt('lo')} hi={gt('hi')}/>
                  <td style={{...TD,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{pctFmt(gt('rev')>0?gt('pro')/gt('rev'):null,1)}</td>
                  <CovCell cm={gt('cm')} rev={gt('rev')}/>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── §7 Top forecast accounts ──────────────────────────────────────── */}
      {topAccounts.length>0&&(
        <div style={{marginBottom:24}}>
          <div style={{fontSize:10,fontWeight:700,color:T.text3,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:10,display:'flex',alignItems:'center',gap:8}}>
            <span>Top forecast accounts — {nextM}</span>
            {fdateFCC&&<span style={{fontSize:10,fontWeight:500,textTransform:'none',letterSpacing:0,color:T.text3,background:T.bg4,padding:'2px 8px',borderRadius:8}}>vintage {String(fdateFCC).slice(0,10)}{fccIsStale?' · stale':''}</span>}
          </div>
          <div style={{background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,overflow:'hidden'}}>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead>
                  <tr>
                    <th style={{...TH,textAlign:'left',paddingLeft:14}}>Customer</th>
                    <th style={{...TH,textAlign:'left'}}>Type</th>
                    <th style={TH}>Committed Rev</th>
                    <th style={TH}>Forecast Rev</th>
                    <th style={TH}>Forecast Total Profit</th>
                    <th style={TH}>Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {topAccounts.map(r=>(
                    <tr key={`acc_${r.cust}`} style={{...ROW,background:T.bg}} onMouseEnter={e=>{e.currentTarget.style.background='#EFF6FF'}} onMouseLeave={e=>{e.currentTarget.style.background=T.bg}}>
                      <td style={{...TD,paddingLeft:14,fontWeight:500}}>{r.cust}</td>
                      <td style={{...TD}}>
                        <span style={{fontSize:10,color:T.text3,background:T.bg4,border:`1px solid ${T.border}`,borderRadius:9,padding:'1px 7px'}}>{r.ctype}</span>
                      </td>
                      <td style={{...TD,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{usd(num(r.committed))}</td>
                      <td style={{...TD,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{usd(num(r.rev))}</td>
                      <td style={{...TD,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{usd(num(r.pro))}</td>
                      <CovCell cm={num(r.committed)} rev={num(r.rev)}/>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
