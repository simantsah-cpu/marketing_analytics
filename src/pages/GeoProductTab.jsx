/**
 * GeoProductTab.jsx — Weekly EAM Performance, GEO & Product Line tab
 *
 * Spec: ORBIT_GEO_PRODUCT_SPEC.md
 *
 * §0 Non-negotiables:
 *  - Product line → v2 (Q_PROD).  Geography → v3 (Q_GEO). Different tables, different levels.
 *  - GEO attainment is withheld — v3 carries ~70% of v2 profit; pct would be wrong.
 *  - Rollups are conditional on which target keys are present for the selected month.
 *  - ALL shared helpers live at module scope (§6.3 structural trap avoidance).
 */

import { useMemo, useRef, useEffect } from 'react'
import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale, LinearScale, BarElement,
  Title, Tooltip, Legend,
} from 'chart.js'

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────────────────────────────────────
const T = {
  bg:'#ffffff', bg2:'#FAFBFC', bg3:'#F1F5F9', bg4:'#E2EAF0',
  text:'#1A2B3C', text2:'#374151', text3:'#64748B',
  border:'#E2EAF0', border2:'#B8C4D0',
  green:'#1D9E75', blue:'#185FA5', red:'#E24B4A',
  amber:'#EAB308', amberInk:'#9A6B0C',
  lift:'0 1px 2px rgba(26,26,24,.05), 0 6px 16px -6px rgba(26,26,24,.10)',
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function num(v){ const x=(v===null||v===undefined||v==='')?NaN:Number(v); return isFinite(x)?x:0 }
const usd  = (v,d=0) => '$'+num(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})
function usdC(v){const x=num(v),a=Math.abs(x),s=x<0?'-$':'$';if(a>=1e6)return s+(a/1e6).toFixed(2)+'M';if(a>=1e5)return s+(a/1e3).toFixed(0)+'k';if(a>=1e3)return s+(a/1e3).toFixed(1)+'k';return s+a.toFixed(a<10?2:0)}
const pctFmt=(v,d=1)=>(v===null||v===undefined||!isFinite(Number(v)))?'—':(num(v)*100).toFixed(d)+'%'
const achColor=p=>(p===null||!isFinite(Number(p)))?T.text3:p>=0.95?T.green:p>=0.80?T.amberInk:T.red

// ─────────────────────────────────────────────────────────────────────────────
// §7 — Colours
// ─────────────────────────────────────────────────────────────────────────────
const PL_COLOR = {
  'Prebooked':        '#185FA5',
  'Private Transfer': '#185FA5',
  'Ride Hailing':     '#D85A30',
  'Shared Shuttle':   '#1D9E75',
  'Rail':             '#7F77DD',
  '(Unassigned)':     '#8b8a83',
}
const plHex = x => PL_COLOR[x] || '#0E8E8E'

const GEO_COLOR = {
  'America&Africa, Asia, Oceania': '#185FA5',
  'Americas':            '#185FA5',
  'Europe':              '#1D9E75',
  'Asia/Africa/Oceania': '#D85A30',
  '(Unassigned)':        '#8b8a83',
}
const geoHex = g => GEO_COLOR[g] || '#7F77DD'

const TARGET_GEO_OWNER = {
  'Europe':            'Morad / CC',
  'Americas':          'Joe',
  'Asia/Africa/Oceania':'CC / Chloe',
  'America&Africa, Asia, Oceania': 'Joe / CC',
}

// ─────────────────────────────────────────────────────────────────────────────
// §3 — Rollup constants
// ─────────────────────────────────────────────────────────────────────────────
const PREBOOKED_LINES = ['Private Transfer','Shared Shuttle','Rail']
const MERGED_GEO      = 'America&Africa, Asia, Oceania'
const MERGED_GEO_SRC  = ['Americas','Asia/Africa/Oceania']

// §3.2 — May 2026 label normalisation
const normGeo = g => g === 'Africa, Asia, Oceania' ? 'Asia/Africa/Oceania' : g

// ─────────────────────────────────────────────────────────────────────────────
// §6.3 — ALL shared cell helpers at module scope (structural trap avoidance)
// These must never be declared inside a conditional branch.
// ─────────────────────────────────────────────────────────────────────────────

const TD  = { padding:'8px 14px', fontSize:13, verticalAlign:'middle' }
const TH  = {
  padding:'7px 14px', fontSize:10, fontWeight:600, color:T.text3,
  textTransform:'uppercase', letterSpacing:'0.05em',
  background:T.bg2, borderBottom:`1px solid ${T.border}`,
  whiteSpace:'nowrap', textAlign:'right',
}
const ROW = { borderBottom:`1px solid ${T.border}` }

// dotSpan — colour dot + name
function dotSpan(name, hex) {
  return (
    <div style={{display:'flex',alignItems:'center',gap:8}}>
      <span style={{display:'inline-block',width:10,height:10,borderRadius:'50%',background:hex,flexShrink:0}}/>
      <span style={{fontWeight:500,fontSize:13}}>{name}</span>
    </div>
  )
}

// gPair — main value + sub value stacked
function gPair(main, sub) {
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:1}}>
      <span style={{fontVariantNumeric:'tabular-nums',fontWeight:500,fontSize:13}}>{main}</span>
      <span style={{fontSize:10.5,color:T.text3,fontVariantNumeric:'tabular-nums'}}>{sub}</span>
    </div>
  )
}

// gAtt — attainment pill
function gAtt(ach) {
  if (ach === null || !isFinite(ach)) return <span style={{color:T.text3}}>—</span>
  const col = achColor(ach)
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:3}}>
      <span style={{fontWeight:700,fontSize:13,color:col}}>{(ach*100).toFixed(1)}%</span>
      <div style={{width:56,height:4,background:T.bg4,borderRadius:99,overflow:'hidden'}}>
        <div style={{height:'100%',width:`${Math.min(100,ach*100).toFixed(1)}%`,background:col,borderRadius:99}}/>
      </div>
    </div>
  )
}

// gShare — share of mix with coloured track bar
function gShare(share, hex) {
  if (share === null || !isFinite(share)) return <span style={{color:T.text3}}>—</span>
  const pct = Math.min(100, share * 100)
  return (
    <div style={{display:'flex',alignItems:'center',gap:8,justifyContent:'flex-end'}}>
      <div style={{width:54,height:5,background:T.bg4,borderRadius:99,overflow:'hidden',flexShrink:0}}>
        <div style={{height:'100%',width:`${pct.toFixed(1)}%`,background:hex,borderRadius:99}}/>
      </div>
      <span style={{fontVariantNumeric:'tabular-nums',fontWeight:600,fontSize:13,minWidth:38,textAlign:'right'}}>{pct.toFixed(1)}%</span>
    </div>
  )
}

// gDelta — delta amount + percentage
function gDelta(delta, pct) {
  const col = delta > 0 ? T.green : delta < 0 ? T.red : T.text3
  const pfx = delta > 0 ? '+' : ''
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:1}}>
      <span style={{fontVariantNumeric:'tabular-nums',fontWeight:600,fontSize:13,color:col}}>{pfx}{usd(delta)}</span>
      {pct!==null&&<span style={{fontSize:10.5,color:col,fontVariantNumeric:'tabular-nums'}}>{pfx}{(num(pct)*100).toFixed(1)}%</span>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Chart: doughnut + legend
// ─────────────────────────────────────────────────────────────────────────────
function DonutChart({rows, labelKey, colorFn, totalLabel, totalValue, subtitle}) {
  const ref = useRef(null)
  const chartRef = useRef(null)
  const labels  = rows.map(r => r[labelKey])
  const data    = rows.map(r => num(r.profit))
  const colors  = rows.map(r => colorFn(r[labelKey]))
  const tot     = data.reduce((a,v)=>a+v,0)

  useEffect(()=>{
    if(!ref.current)return
    if(chartRef.current){chartRef.current.destroy();chartRef.current=null}

    // Local plugin: writes label + value into the doughnut hole
    const holeLabel = {
      id:'gp_hole',
      afterDatasetsDraw(chart){
        const a=chart.chartArea;if(!a)return
        const cx=(a.left+a.right)/2, cy=(a.top+a.bottom)/2
        const ctx=chart.ctx;ctx.save();ctx.textAlign='center'
        ctx.fillStyle=T.text3;ctx.font=`500 10px sans-serif`;ctx.textBaseline='alphabetic'
        ctx.fillText((totalLabel||'TOTAL').toUpperCase(),cx,cy-9)
        ctx.fillStyle=T.text;ctx.font=`700 17px sans-serif`;ctx.textBaseline='alphabetic'
        ctx.fillText(totalValue||usdC(tot),cx,cy+11)
        if(rows.length){
          ctx.fillStyle=T.text3;ctx.font=`500 10px sans-serif`
          ctx.fillText(`${rows.length} regions`,cx,cy+25)
        }
        ctx.restore()
      },
    }

    chartRef.current = new ChartJS(ref.current, {
      type:'doughnut',
      plugins:[holeLabel],
      data:{labels, datasets:[{data, backgroundColor:colors, borderWidth:2, borderColor:'#fff', hoverOffset:6}]},
      options:{
        responsive:true, maintainAspectRatio:true, cutout:'68%',
        plugins:{
          legend:{display:false},
          tooltip:{callbacks:{label:x=>` ${x.label}  ${usdC(x.raw)}  (${tot>0?(x.raw/tot*100).toFixed(1):'—'}%)`}},
          datalabels:{display:false},
        },
      },
    })
    return ()=>{if(chartRef.current){chartRef.current.destroy();chartRef.current=null}}
  },[rows])

  return (
    <div style={{height:'100%',display:'flex',flexDirection:'column',justifyContent:'center'}}>
      {subtitle&&<div style={{fontSize:11.5,color:T.text3,marginBottom:12,lineHeight:1.55}}>{subtitle}</div>}
      <div style={{display:'flex',alignItems:'center',gap:24}}>
        <div style={{width:200,flexShrink:0}}><canvas ref={ref}/></div>
        <div style={{flex:1,display:'flex',flexDirection:'column',gap:6}}>
          {rows.map(r=>{
            const v=num(r.profit),sh=tot>0?v/tot:0
            return(
              <div key={r[labelKey]} style={{display:'flex',alignItems:'center',gap:8,fontSize:12}}>
                <span style={{width:10,height:10,borderRadius:2,background:colorFn(r[labelKey]),flexShrink:0,display:'inline-block'}}/>
                <span style={{flex:1,color:T.text2}}>{r[labelKey]}</span>
                <span style={{fontVariantNumeric:'tabular-nums',color:T.text,fontWeight:500}}>{usdC(v)}</span>
                <span style={{color:T.text3,minWidth:36,textAlign:'right'}}>{(sh*100).toFixed(1)}%</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Chart: horizontal bar (margin by geo)
// ─────────────────────────────────────────────────────────────────────────────
function MarginBar({rows, blend, labelKey, colorFn}) {
  const ref = useRef(null)
  const chartRef = useRef(null)

  useEffect(()=>{
    if(!ref.current||!rows.length)return
    if(chartRef.current){chartRef.current.destroy();chartRef.current=null}
    const margins = rows.map(r=>num(r.revenue)>0?(num(r.profit)/num(r.revenue))*100:0)
    const maxM = Math.max(...margins,num(blend)*100,30)

    // Local plugin: draws pct labels outside bars
    const mLabels={
      id:'gp_mLabels',
      afterDatasetsDraw(chart){
        const ctx=chart.ctx;ctx.save()
        ctx.font=`600 11px sans-serif`;ctx.fillStyle=T.text2;ctx.textAlign='left';ctx.textBaseline='middle'
        chart.getDatasetMeta(0).data.forEach((el,i)=>{
          ctx.fillText(margins[i].toFixed(1)+'%',el.x+6,el.y)
        })
        ctx.restore()
      },
    }

    // Local plugin: draws blend reference pill
    const blendLine={
      id:'gp_blendLine',
      afterDatasetsDraw(chart){
        if(!blend)return
        const sc=chart.scales.x;if(!sc)return
        const pv=sc.getPixelForValue(num(blend)*100),a=chart.chartArea
        const ctx=chart.ctx;ctx.save()
        ctx.setLineDash([4,3]);ctx.lineWidth=1.5;ctx.strokeStyle='rgba(26,26,24,.4)'
        ctx.beginPath();ctx.moveTo(pv,a.top);ctx.lineTo(pv,a.bottom);ctx.stroke();ctx.setLineDash([])
        const lbl=`Blend ${(num(blend)*100).toFixed(1)}%`
        ctx.font=`600 10px sans-serif`;const w=ctx.measureText(lbl).width+10
        const bx=Math.min(pv+4,a.right-w-4),by=a.top+1
        ctx.fillStyle='rgba(26,26,24,.7)';ctx.beginPath()
        if(ctx.roundRect)ctx.roundRect(bx,by,w,15,4);else ctx.fillRect(bx,by,w,15)
        ctx.fill();ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle'
        ctx.fillText(lbl,bx+w/2,by+8);ctx.restore()
      },
    }

    chartRef.current=new ChartJS(ref.current,{
      type:'bar',
      plugins:[mLabels,blendLine],
      data:{
        labels:rows.map(r=>r[labelKey]),
        datasets:[{
          data:margins,
          backgroundColor:rows.map(r=>colorFn(r[labelKey])),
          borderRadius:4,barThickness:22,
        }],
      },
      options:{
        indexAxis:'y',responsive:true,maintainAspectRatio:false,
        layout:{padding:{right:60,top:24,bottom:4,left:2}},
        plugins:{
          legend:{display:false},
          barLabels:{enabled:false},
          stackTotal:{enabled:false},
          tooltip:{callbacks:{label:x=>` Margin ${x.raw.toFixed(2)}%`}},
          datalabels:{display:false},
        },
        scales:{
          x:{min:0,max:Math.ceil(maxM*1.15),border:{display:false},
             ticks:{callback:v=>v+'%',font:{size:10},color:T.text3},
             grid:{display:false}},
          y:{border:{display:false},grid:{display:false},
             ticks:{font:{size:12,weight:'600'},color:T.text,padding:8}},
        },
      },
    })
    return()=>{if(chartRef.current){chartRef.current.destroy();chartRef.current=null}}
  },[rows,blend])

  return <canvas ref={ref} style={{width:'100%',height:'100%'}}/>
}

// ─────────────────────────────────────────────────────────────────────────────
// Chart: attainment bar (product line)
// ─────────────────────────────────────────────────────────────────────────────
function AttBar({rows, companyAch, labelKey}) {
  const ref = useRef(null)
  const chartRef = useRef(null)

  useEffect(()=>{
    if(!ref.current||!rows.length)return
    if(chartRef.current){chartRef.current.destroy();chartRef.current=null}
    const achs = rows.map(r=>num(r.ach)*100)

    const attLabels={
      id:'gp_attLabels',
      afterDatasetsDraw(chart){
        const ctx=chart.ctx;ctx.save()
        ctx.font=`600 11px sans-serif`;ctx.textBaseline='middle'
        const zeroX=chart.scales.x?.getPixelForValue(0)??0
        chart.getDatasetMeta(0).data.forEach((el,i)=>{
          const txt=achs[i].toFixed(1)+'%'
          const barW=el.x-zeroX
          const txtW=ctx.measureText(txt).width
          if(barW>txtW+20){
            // wide bar — draw inside, white text, right-aligned
            ctx.textAlign='right';ctx.fillStyle='#fff'
            ctx.fillText(txt,el.x-8,el.y)
          } else {
            // short bar — draw outside, attainment colour
            ctx.textAlign='left';ctx.fillStyle=achColor(achs[i]/100)
            ctx.fillText(txt,el.x+6,el.y)
          }
        })
        ctx.restore()
      },
    }

    const refLine={
      id:'gp_attRef',
      afterDatasetsDraw(chart){
        if(!companyAch)return
        const sc=chart.scales.x;if(!sc)return
        const pv=sc.getPixelForValue(num(companyAch)*100),a=chart.chartArea
        const ctx=chart.ctx;ctx.save()
        ctx.setLineDash([4,3]);ctx.lineWidth=1.5;ctx.strokeStyle='rgba(26,26,24,.4)'
        ctx.beginPath();ctx.moveTo(pv,a.top);ctx.lineTo(pv,a.bottom);ctx.stroke();ctx.setLineDash([])
        const lbl=`Co. ${(num(companyAch)*100).toFixed(1)}%`
        ctx.font=`600 10px sans-serif`;const w=ctx.measureText(lbl).width+10
        const bx=Math.min(pv+4,a.right-w-4),by=a.top+1
        ctx.fillStyle='rgba(26,26,24,.7)';ctx.beginPath()
        if(ctx.roundRect)ctx.roundRect(bx,by,w,15,4);else ctx.fillRect(bx,by,w,15)
        ctx.fill();ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle'
        ctx.fillText(lbl,bx+w/2,by+8);ctx.restore()
      },
    }

    chartRef.current=new ChartJS(ref.current,{
      type:'bar',
      plugins:[attLabels,refLine],
      data:{
        labels:rows.map(r=>r[labelKey]),
        datasets:[{
          data:achs,
          backgroundColor:achs.map(v=>achColor(v/100)),
          borderRadius:4,barThickness:22,
        }],
      },
      options:{
        indexAxis:'y',responsive:true,maintainAspectRatio:false,
        layout:{padding:{right:60,top:24,bottom:4,left:2}},
        plugins:{
          legend:{display:false},
          barLabels:{enabled:false},
          stackTotal:{enabled:false},
          tooltip:{callbacks:{label:x=>` Attainment ${x.raw.toFixed(1)}%`}},
          datalabels:{display:false},
        },
        scales:{
          x:{min:0,max:150,border:{display:false},
             ticks:{callback:v=>v+'%',font:{size:10},color:T.text3,stepSize:50},
             grid:{display:false}},
          y:{border:{display:false},grid:{display:false},
             ticks:{font:{size:12,weight:'600'},color:T.text,padding:8}},
        },
      },
    })
    return()=>{if(chartRef.current){chartRef.current.destroy();chartRef.current=null}}
  },[rows,companyAch])

  return <canvas ref={ref} style={{width:'100%',height:'100%'}}/>
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function GeoProductTab({D, period, CUR_MONTH, PC}) {
  const isMonthKey = k => /^\d{4}-\d{2}$/.test(k ?? '')
  const recon = isMonthKey(period)

  // ── §3 — Build target maps for the current month ───────────────────────────
  // Apply normGeo when reading GEO targets (§3.2)
  const { targetMonth, TARGETS } = useMemo(()=>{
    const rows = D.targets || []
    const months = [...new Set(rows.map(r=>r.ym))].sort()
    const tMonth = months.includes(CUR_MONTH) ? CUR_MONTH : (months[months.length-1]||CUR_MONTH)

    const product={}, geo={}, dept={}
    rows.filter(r=>r.ym===tMonth).forEach(r=>{
      if(r.kind==='pl')  product[r.dim]=num(r.tgt)
      if(r.kind==='geo') geo[normGeo(r.dim)]=num(r.tgt)
      if(r.kind==='dept')dept[r.dim]=num(r.tgt)
    })
    const company=['EAM Chris','EAM Renaldo','EAM Gloria','B2C Matt'].reduce((a,k)=>a+(dept[k]||0),0)
    return { targetMonth:tMonth, TARGETS:{ product, geo, dept, company } }
  },[D.targets, CUR_MONTH])

  // ── §3.1 — rollupPL — conditional on Prebooked target existence ────────────
  const rollupPL = pl => {
    if (TARGETS.product['Prebooked'] !== undefined) {
      if (pl === 'Ride Hailing') return 'Ride Hailing'
      if (PREBOOKED_LINES.includes(pl)) return 'Prebooked'
      return pl
    }
    if (pl === 'Shared Shuttle') return 'Private Transfer'
    return pl
  }

  // ── §3.2 — rollupGeo — conditional on merged GEO target existence ──────────
  const rollupGeo = g => {
    if (TARGETS.geo[MERGED_GEO] !== undefined && MERGED_GEO_SRC.includes(g)) return MERGED_GEO
    return g
  }

  // ── §6 — geoSrc: monthly branch vs v3 branch ──────────────────────────────
  const geoSrc = useMemo(()=>{
    if (!recon) return D.geo || []
    // Rebuild from Q_MONTHS for a single selected month
    const prev = (()=>{let y=+period.slice(0,4),m=+period.slice(5,7)-1;if(m===0){m=12;y-=1};return `${y}-${String(m).padStart(2,'0')}`})()
    const agg = {}
    ;(D.months||[]).forEach(r=>{
      if(r.ym!==period && r.ym!==prev) return
      const g=r.geo||'(Unassigned)'
      if(!agg[g]) agg[g]={geo:g,profit:0,revenue:0,sales:0,lm_profit:0}
      if(r.ym===period){
        agg[g].profit  +=num(r.profit)
        agg[g].revenue +=num(r.revenue)
        agg[g].sales   +=num(r.sales)
      } else {
        agg[g].lm_profit+=num(r.profit)
      }
    })
    return Object.values(agg)
  },[recon, period, D.geo, D.months])

  // ── §4.1 — Product line aggregation ───────────────────────────────────────
  const { prod, pT } = useMemo(()=>{
    const plMap = {}
    ;(D.prod||[]).forEach(r=>{
      const k=rollupPL(r.pl)
      if(!plMap[k]) plMap[k]={pl:k,profit:0,revenue:0,sales:0,lm_profit:0,parts:[]}
      plMap[k].profit    +=num(r.profit)
      plMap[k].revenue   +=num(r.revenue)
      plMap[k].sales     +=num(r.sales)
      plMap[k].lm_profit +=num(r.lm_profit)
      if(k!==r.pl) plMap[k].parts.push(r.pl)
    })
    const prod=Object.values(plMap).sort((a,b)=>num(b.profit)-num(a.profit))
    const pT=prod.reduce((a,r)=>({profit:a.profit+num(r.profit),revenue:a.revenue+num(r.revenue),sales:a.sales+num(r.sales),lm:a.lm+num(r.lm_profit)}),{profit:0,revenue:0,sales:0,lm:0})
    return {prod,pT}
  },[D.prod, rollupPL])

  // ── §5.1 — GEO aggregation ─────────────────────────────────────────────────
  const { geoRows, geoTot, geoRev } = useMemo(()=>{
    const geoMap={}
    geoSrc.forEach(r=>{
      const k=rollupGeo(r.geo)
      if(!geoMap[k]) geoMap[k]={geo:k,profit:0,revenue:0,sales:0,lm_profit:0,parts:[]}
      geoMap[k].profit    +=num(r.profit)
      geoMap[k].revenue   +=num(r.revenue)
      geoMap[k].sales     +=num(r.sales)
      geoMap[k].lm_profit +=num(r.lm_profit)
      if(k!==r.geo) geoMap[k].parts.push(r.geo)
    })
    const geoRows=Object.values(geoMap).sort((a,b)=>num(b.profit)-num(a.profit))
    const geoTot=geoRows.reduce((a,r)=>a+num(r.profit),0)
    const geoRev=geoRows.reduce((a,r)=>a+num(r.revenue),0)
    return {geoRows,geoTot,geoRev}
  },[geoSrc, rollupGeo])

  // Company attainment for refLine in attainment chart
  const companyAch = TARGETS.company > 0 ? null : null  // pass actual from parent if available

  const SHORT = PC?.short || 'MTD'
  const BASE  = PC?.baseShort || 'LM'

  // ─── Section header style ──────────────────────────────────────────────────
  const SecLabel = ({label, badge}) => (
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,marginTop:24}}>
      <span style={{fontSize:10,fontWeight:700,color:T.text3,textTransform:'uppercase',letterSpacing:'0.07em'}}>{label}</span>
      {badge&&<span style={{fontSize:9,fontWeight:700,padding:'2px 8px',borderRadius:10,background:'rgba(234,179,8,.15)',color:'#9A6B0C',letterSpacing:'0.05em'}}>{badge}</span>}
      <div style={{flex:1,height:'1px',background:T.border}}/>
    </div>
  )

  return (
    <div>
      {/* Header */}
      <div style={{marginBottom:16}}>
        <h1 style={{fontSize:20,fontWeight:700,color:T.text,margin:0}}>GEO &amp; Product Line</h1>
        <div style={{fontSize:13,color:T.text3,marginTop:4}}>{SHORT} total profit and revenue split by geography and by product line</div>
      </div>

      {/* ── §4 Product Line section ─────────────────────────────────────────── */}
      <SecLabel label="Product Line"/>

      {recon ? (
        // §6.2 — product line unavailable for single month
        <div style={{background:T.bg2,border:`1px solid ${T.border}`,borderRadius:8,padding:'16px 20px',marginBottom:24,color:T.text3,fontSize:13}}>
          Not available for a single month — the monthly source carries no product line column. Switch to Month, Quarter or Year to date.
        </div>
      ) : (
        <>
          {/* Product line table */}
          {D.prod.length === 0 ? (
            <div style={{textAlign:'center',padding:'32px 0',color:T.text3,fontSize:13}}>No product line data — click Refresh.</div>
          ) : (
            <div style={{background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,overflow:'hidden',marginBottom:16}}>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'auto'}}>
                  <thead>
                    <tr>
                      <th style={{...TH,textAlign:'left',paddingLeft:14,width:'22%'}}>Product Line</th>
                      <th style={TH}><div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:1}}><span>{SHORT} Total Profit</span><span style={{fontWeight:400,opacity:.8,fontSize:9}}>vs target</span></div></th>
                      <th style={TH}>Attainment</th>
                      <th style={TH}>vs {BASE}</th>
                      <th style={TH}><div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:1}}><span>Complete GMV</span><span style={{fontWeight:400,opacity:.8,fontSize:9}}>margin</span></div></th>
                      <th style={TH}>Original Sales Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prod.map(r=>{
                      const tg = TARGETS.product[r.pl]
                      const ach = (tg&&tg>0) ? num(r.profit)/tg : null
                      const delta = num(r.profit)-num(r.lm_profit)
                      const dPct = num(r.lm_profit)!==0 ? delta/Math.abs(num(r.lm_profit)) : null
                      const margin = num(r.revenue)>0 ? num(r.profit)/num(r.revenue) : null
                      return (
                        <tr key={r.pl} style={{...ROW,background:T.bg}} onMouseEnter={e=>{e.currentTarget.style.background='#EFF6FF'}} onMouseLeave={e=>{e.currentTarget.style.background=T.bg}}>
                          <td style={{...TD,paddingLeft:14}}>
                            {dotSpan(r.pl,plHex(r.pl))}
                            {r.parts.length>0&&<div style={{marginTop:3}}><span style={{fontSize:10,color:T.text3,background:T.bg4,border:`1px solid ${T.border}`,borderRadius:9,padding:'1px 7px'}}>incl. {r.parts.join(', ')}</span></div>}
                          </td>
                          <td style={{...TD,textAlign:'right'}}>{gPair(usd(num(r.profit)),tg?usd(tg):'no target')}</td>
                          <td style={{...TD,textAlign:'right'}}>{gAtt(ach)}</td>
                          <td style={{...TD,textAlign:'right'}}>{gDelta(delta,dPct)}</td>
                          <td style={{...TD,textAlign:'right'}}>{gPair(usd(num(r.revenue)),pctFmt(margin,1))}</td>
                          <td style={{...TD,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{usd(num(r.sales))}</td>
                        </tr>
                      )
                    })}
                    {/* Total row */}
                    <tr style={{background:T.bg,borderTop:`2px solid ${T.border}`}}>
                      <td style={{...TD,paddingLeft:14,fontWeight:700}}>Total</td>
                      <td style={{...TD,textAlign:'right'}}>{gPair(usd(pT.profit),TARGETS.company?usd(TARGETS.company):'—')}</td>
                      <td style={{...TD,textAlign:'right'}}>{gAtt(TARGETS.company>0?pT.profit/TARGETS.company:null)}</td>
                      <td style={{...TD,textAlign:'right'}}>{gDelta(pT.profit-pT.lm,pT.lm!==0?(pT.profit-pT.lm)/Math.abs(pT.lm):null)}</td>
                      <td style={{...TD,textAlign:'right'}}>{gPair(usd(pT.revenue),pctFmt(pT.revenue>0?pT.profit/pT.revenue:null,1))}</td>
                      <td style={{...TD,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{usd(pT.sales)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Product line charts */}
          {prod.length>0&&(
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:8}}>
              {/* Doughnut */}
              <div style={{background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,padding:'16px 20px 20px',display:'flex',flexDirection:'column'}}>
                <div style={{fontWeight:700,fontSize:14,color:T.text,marginBottom:2}}>Total profit mix by product line</div>
                <DonutChart
                  rows={prod} labelKey="pl" colorFn={plHex}
                  totalLabel={`${SHORT} TOTAL PROFIT`} totalValue={usdC(pT.profit)}
                />
              </div>
              {/* Attainment bar */}
              {prod.filter(r=>TARGETS.product[r.pl]).length>0&&(
                <div style={{background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,padding:'16px 20px 14px'}}>
                  <div style={{fontWeight:700,fontSize:14,color:T.text,marginBottom:2}}>Attainment by product line</div>
                  <div style={{fontSize:11.5,color:T.text3,marginBottom:12}}>Rows without a target are excluded · reference line = company attainment</div>
                  <div style={{height:Math.max(120,prod.filter(r=>TARGETS.product[r.pl]).length*52)}}>
                    <AttBar
                      rows={prod.filter(r=>TARGETS.product[r.pl]).map(r=>({...r,ach:TARGETS.product[r.pl]>0?num(r.profit)/TARGETS.product[r.pl]:null}))}
                      labelKey="pl"
                      companyAch={TARGETS.company>0?pT.profit/TARGETS.company:null}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── §5 Geography section ────────────────────────────────────────────── */}
      <SecLabel label="Geography" badge="MIX ONLY · ATTAINMENT WITHHELD"/>

      {geoRows.length===0 ? (
        <div style={{textAlign:'center',padding:'32px 0',color:T.text3,fontSize:13}}>No geography data — click Refresh.</div>
      ) : (
        <>
          <div style={{background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,overflow:'hidden',marginBottom:16}}>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'auto'}}>
                <thead>
                  <tr>
                    <th style={{...TH,textAlign:'left',paddingLeft:14,width:'22%'}}>GEO</th>
                    <th style={{...TH}}><div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:1}}><span>{SHORT} Total Profit (v3)</span><span style={{fontWeight:400,opacity:.8,fontSize:9}}>target, reference only</span></div></th>
                    <th style={{...TH}}>Share of Mix</th>
                    <th style={TH}>vs {BASE}</th>
                    <th style={TH}><div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:1}}><span>Complete GMV</span><span style={{fontWeight:400,opacity:.8,fontSize:9}}>margin</span></div></th>
                    <th style={TH}>Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {geoRows.map(r=>{
                    const tg = TARGETS.geo[r.geo]
                    const delta=num(r.profit)-num(r.lm_profit)
                    const dPct=num(r.lm_profit)!==0?delta/Math.abs(num(r.lm_profit)):null
                    const margin=num(r.revenue)>0?num(r.profit)/num(r.revenue):null
                    const owner=TARGET_GEO_OWNER[r.geo]
                    return (
                      <tr key={r.geo} style={{...ROW,background:T.bg}} onMouseEnter={e=>{e.currentTarget.style.background='#EFF6FF'}} onMouseLeave={e=>{e.currentTarget.style.background=T.bg}}>
                        <td style={{...TD,paddingLeft:14}}>
                          {dotSpan(r.geo,geoHex(r.geo))}
                          {r.parts.length>0&&<div style={{marginTop:3}}><span style={{fontSize:10,color:T.text3,background:T.bg4,border:`1px solid ${T.border}`,borderRadius:9,padding:'1px 7px'}}>{r.parts.join(' + ')}</span></div>}
                        </td>
                        <td style={{...TD,textAlign:'right'}}>{gPair(usd(num(r.profit)),tg?usd(tg):'no target')}</td>
                        <td style={{...TD,textAlign:'right'}}>{gShare(geoTot>0?num(r.profit)/geoTot:null,geoHex(r.geo))}</td>
                        <td style={{...TD,textAlign:'right'}}>{gDelta(delta,dPct)}</td>
                        <td style={{...TD,textAlign:'right'}}>{gPair(usd(num(r.revenue)),pctFmt(margin,1))}</td>
                        <td style={{...TD,textAlign:'right'}}>
                          {owner
                            ? <span style={{fontSize:11,background:T.bg4,border:`1px solid ${T.border}`,borderRadius:9,padding:'2px 8px',whiteSpace:'nowrap'}}>{owner}</span>
                            : <span style={{color:T.text3}}>—</span>}
                        </td>
                      </tr>
                    )
                  })}
                  {/* Total row */}
                  <tr style={{background:T.bg,borderTop:`2px solid ${T.border}`}}>
                    <td style={{...TD,paddingLeft:14,fontWeight:700}}>Total</td>
                    <td style={{...TD,textAlign:'right'}}>{gPair(usd(geoTot),Object.values(TARGETS.geo).length?usd(Object.values(TARGETS.geo).reduce((a,v)=>a+v,0)):'—')}</td>
                    <td style={{...TD,textAlign:'right',fontWeight:600}}>100.0%</td>
                    <td style={{...TD,textAlign:'right'}}>—</td>
                    <td style={{...TD,textAlign:'right'}}>{gPair(usd(geoRev),pctFmt(geoRev>0?geoTot/geoRev:null,1))}</td>
                    <td style={{...TD,textAlign:'right'}}>—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* GEO charts */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:24}}>
            {/* Doughnut */}
            <div style={{background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,padding:'16px 20px 20px',display:'flex',flexDirection:'column'}}>
              <div style={{fontWeight:700,fontSize:14,color:T.text,marginBottom:2}}>Total profit mix by geography</div>
              <DonutChart
                rows={geoRows} labelKey="geo" colorFn={geoHex}
                totalLabel="V3 TOTAL PROFIT" totalValue={usdC(geoTot)}
                subtitle="Level is under-reported by v3; the mix itself is representative"
              />
            </div>
            {/* Margin bar */}
            <div style={{background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,padding:'16px 20px 14px'}}>
              <div style={{fontWeight:700,fontSize:14,color:T.text,marginBottom:2}}>Margin by geography</div>
              <div style={{fontSize:11.5,color:T.text3,marginBottom:12}}>Profit ÷ revenue within v3 · ratios are more reliable than levels here</div>
              <div style={{height:Math.max(140,geoRows.length*64+24)}}>
                <MarginBar
                  rows={geoRows} labelKey="geo" colorFn={geoHex}
                  blend={geoRev>0?geoTot/geoRev:null}
                />
              </div>

            </div>
          </div>
        </>
      )}
    </div>
  )
}
