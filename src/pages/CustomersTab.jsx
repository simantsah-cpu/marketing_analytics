/**
 * CustomersTab.jsx — Weekly EAM Performance, Customers tab
 * Pre-normalized `cust` rows arrive from LeadershipDashboard.normCust().
 */
import { useState, useMemo, useCallback } from 'react'

const DEPT_ROLLUP = { 'Sales Mo': 'EAM Chris', 'Sales Jojo': 'EAM Gloria' }
const DEPT_COLORS = {
  'EAM Chris':'#185FA5','B2C Matt':'#D85A30','EAM Gloria':'#0E8E8E',
  'EAM Renaldo':'#7F77DD','Sales Mo':'#1D9E75','Sales Jojo':'#EAB308',
}
const rollupDept = d => DEPT_ROLLUP[d] || d || '(Unassigned)'

const T = {
  bg:'#ffffff',bg2:'#FAFBFC',bg3:'#F1F5F9',bg4:'#E2EAF0',
  text:'#1A2B3C',text2:'#374151',text3:'#64748B',
  border:'#E2EAF0',border2:'#B8C4D0',
  green:'#1D9E75',blue:'#185FA5',red:'#E24B4A',
  amber:'#EAB308',amberInk:'#9A6B0C',
  lift:'0 1px 2px rgba(26,26,24,.05), 0 6px 16px -6px rgba(26,26,24,.10)',
}

function _num(v){const x=(v===null||v===undefined||v==='')?NaN:Number(v);return isFinite(x)?x:0}
const usd=(v,d=0)=>'$'+_num(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})
function usdC(v){const x=_num(v),a=Math.abs(x),s=x<0?'-$':'$';if(a>=1e6)return s+(a/1e6).toFixed(2)+'M';if(a>=1e5)return s+(a/1e3).toFixed(0)+'k';if(a>=1e3)return s+(a/1e3).toFixed(1)+'k';return s+a.toFixed(a<10?2:0)}
const pctFmt=(v,d=1)=>(v===null||v===undefined||!isFinite(Number(v)))?'—':(_num(v)*100).toFixed(d)+'%'
const numFmt=v=>_num(v).toLocaleString('en-US')
const signed=v=>(_num(v)>0?'+':'')+usd(_num(v),0)
function salesPct(s,b){const sv=_num(s),bv=_num(b);if(sv===0&&bv===0)return null;if(bv===0)return 1.0;return(sv-bv)/bv}
function profitPct(p,b){const pv=_num(p),bv=_num(b);if(bv<0)return 1.0;if(pv===0&&bv===0)return null;if(bv===0)return 1.0;return(pv-bv)/bv}
const deltaColor=v=>_num(v)>0?T.green:_num(v)<0?T.red:T.text3

function buildCustRows(cust,filters,sort){
  const{dept,search,active,basis}=filters
  const q=(search||'').toLowerCase().trim()
  const rows=(cust||[]).filter(r=>{
    if(dept&&rollupDept(r.dept)!==dept)return false
    if(q&&(r.cust||'').toLowerCase().indexOf(q)<0)return false
    if(active==='active'&&_num(r.sales)===0&&_num(r.profit)===0)return false
    return true
  }).map(r=>{
    const bs=basis==='ly'?_num(r.ly_sales):_num(r.lm_sales)
    const bp=basis==='ly'?_num(r.ly_profit):_num(r.lm_profit)
    const s=_num(r.sales),p=_num(r.profit),rv=_num(r.revenue)
    return{dept:r.dept,cust:r.cust,sales:s,base_sales:bs,s_delta:s-bs,s_pct:salesPct(s,bs),profit:p,base_profit:bp,p_delta:p-bp,p_pct:profitPct(p,bp),revenue:rv,margin:rv>0?p/rv:null}
  })
  const{key,dir}=sort
  rows.sort((a,b)=>{
    let x=a[key],y=b[key]
    if(typeof x==='string')return dir*x.localeCompare(y)
    x=(x===null||!isFinite(x))?-Infinity:x
    y=(y===null||!isFinite(y))?-Infinity:y
    return dir*(x-y)
  })
  return rows
}

function exportCsv(rows,basis){
  const bl=basis==='ly'?'LY':'LM'
  const head=['Hoppa Non-Hoppa','customer_name',`Original Sales Amount ▲▼ v.s ${bl}`,`Original Sales Amount ▲▼% v.s ${bl}`,'Sales Amount',`${bl} MTD Sales Amount`,`Total Profit ▲▼ v.s ${bl}`,`Total Profit ▲▼% v.s ${bl}`,'Total Profit',`${bl} Profit`,'Revenue','Margin']
  const q=s=>`"${String(s).replace(/"/g,'""')}"`
  const lines=[head.join(',')]
  rows.forEach(r=>lines.push([q(r.dept),q(r.cust),r.s_delta.toFixed(2),r.s_pct===null?'':r.s_pct.toFixed(4),r.sales.toFixed(2),r.base_sales.toFixed(2),r.p_delta.toFixed(2),r.p_pct===null?'':r.p_pct.toFixed(4),r.profit.toFixed(2),r.base_profit.toFixed(2),r.revenue.toFixed(2),r.margin===null?'':r.margin.toFixed(4)].join(',')))
  const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8;'})
  const a=document.createElement('a')
  a.href=URL.createObjectURL(blob)
  a.download=`EAM Performance summary ${new Date().toISOString().slice(0,10)}.csv`
  a.click()
  setTimeout(()=>URL.revokeObjectURL(a.href),2000)
}

function PairCell({main,sub,subColor}){
  return(
    <td style={{padding:'8px 14px',textAlign:'right',verticalAlign:'middle'}}>
      <div style={{display:'flex',flexDirection:'column',gap:1,alignItems:'flex-end'}}>
        <span style={{fontVariantNumeric:'tabular-nums',fontWeight:500,fontSize:13}}>{main}</span>
        <span style={{fontSize:11,color:subColor||T.text3,fontVariantNumeric:'tabular-nums'}}>{sub}</span>
      </div>
    </td>
  )
}
function DeltaCell({abs,pctVal}){
  const c=deltaColor(abs)
  return(
    <td style={{padding:'8px 14px',textAlign:'right',verticalAlign:'middle'}}>
      <div style={{display:'flex',flexDirection:'column',gap:1,alignItems:'flex-end'}}>
        <span style={{fontVariantNumeric:'tabular-nums',fontWeight:600,fontSize:13,color:c}}>{signed(abs)}</span>
        <span style={{fontSize:11,color:c,fontVariantNumeric:'tabular-nums'}}>{pctFmt(pctVal,1)}</span>
      </div>
    </td>
  )
}
function CustCells({r}){
  return(<>
    <PairCell main={usd(r.sales)} sub={usd(r.base_sales)}/>
    <DeltaCell abs={r.s_delta} pctVal={r.s_pct}/>
    <PairCell main={usd(r.profit)} sub={usd(r.base_profit)}/>
    <DeltaCell abs={r.p_delta} pctVal={r.p_pct}/>
    <td style={{padding:'8px 14px',textAlign:'right',fontVariantNumeric:'tabular-nums',fontSize:13,verticalAlign:'middle'}}>{pctFmt(r.margin,1)}</td>
  </>)
}
function DeptTag({dept}){
  const rolled=rollupDept(dept)
  if(rolled===dept)return null
  return(<span style={{display:'inline-flex',alignItems:'center',fontSize:10,fontWeight:500,color:T.text3,background:T.bg2,border:`1px solid ${T.border}`,borderRadius:9,padding:'1px 7px',marginLeft:7,whiteSpace:'nowrap'}}>{dept}</span>)
}
function DeptDot({dept}){
  return(<span style={{display:'inline-block',width:9,height:9,borderRadius:'50%',background:DEPT_COLORS[dept]||T.text3,marginRight:7,flexShrink:0}}/>)
}
function KpiTile({label,value,sub,subColor}){
  return(
    <div style={{background:T.bg,borderRadius:10,padding:'14px 16px',boxShadow:T.lift,border:`1px solid ${T.border}`,display:'flex',flexDirection:'column',gap:3,flex:1}}>
      <div style={{fontSize:11,color:T.text3,fontWeight:500}}>{label}</div>
      <div style={{fontSize:24,fontWeight:700,color:T.text,lineHeight:1.2,marginTop:2}}>{value}</div>
      <div style={{fontSize:11,color:subColor||T.text3}}>{sub}</div>
    </div>
  )
}

export default function CustomersTab({cust,period,CUR_MONTH,PC}){
  const[custGroup,setCustGroup]=useState(()=>localStorage.getItem('eam.custGroup')||'eam')
  const[custOpen,setCustOpen]=useState(()=>{try{return JSON.parse(localStorage.getItem('eam.custOpen')||'{}')}catch{return{}}})
  const[custSort,setCustSort]=useState({key:'sales',dir:-1})
  const[filters,setFilters]=useState({dept:'',search:'',active:'active',basis:'lm'})

  const sortCust=useCallback(k=>{
    setCustSort(s=>s.key===k?{key:k,dir:-s.dir}:{key:k,dir:(k==='cust'||k==='dept')?1:-1})
  },[])

  const toggleGrp=useCallback(dept=>{
    setCustOpen(prev=>{
      const next={...prev,[dept]:!prev[dept]}
      localStorage.setItem('eam.custOpen',JSON.stringify(next))
      return next
    })
  },[])

  const setAll=useCallback(open=>{
    setCustOpen(prev=>{
      const next={}
      ;(cust||[]).forEach(r=>{next[rollupDept(r.dept)]=open})
      localStorage.setItem('eam.custOpen',JSON.stringify(next))
      return next
    })
  },[cust])

  const setGroup=v=>{setCustGroup(v);localStorage.setItem('eam.custGroup',v)}
  const resetFilters=()=>{setFilters({dept:'',search:'',active:'active',basis:'lm'});setCustSort({key:'sales',dir:-1})}

  const rows=useMemo(()=>buildCustRows(cust,filters,custSort),[cust,filters,custSort])

  const deptOptions=useMemo(()=>{
    const counts={}
    ;(cust||[]).forEach(r=>{const d=rollupDept(r.dept);if(_num(r.sales)!==0||_num(r.profit)!==0)counts[d]=(counts[d]||0)+1})
    return Object.entries(counts).sort((a,b)=>a[0].localeCompare(b[0]))
  },[cust])

  const st=useMemo(()=>rows.reduce((a,r)=>{a.sales+=r.sales;a.base_sales+=r.base_sales;a.profit+=r.profit;a.base_profit+=r.base_profit;a.revenue+=r.revenue;return a},{sales:0,base_sales:0,profit:0,base_profit:0,revenue:0}),[rows])

  const bl=filters.basis==='ly'?'LY':'LM'
  const blLabel=filters.basis==='ly'?'Last year MTD':'Last month MTD'
  const short=PC?.short||'MTD'
  const stx={...st,s_delta:st.sales-st.base_sales,s_pct:salesPct(st.sales,st.base_sales),p_delta:st.profit-st.base_profit,p_pct:profitPct(st.profit,st.base_profit),margin:st.revenue>0?st.profit/st.revenue:null}

  const groups=useMemo(()=>{
    const g={}
    rows.forEach(r=>{
      const k=rollupDept(r.dept)
      if(!g[k])g[k]={dept:k,items:[],sales:0,base_sales:0,profit:0,base_profit:0,revenue:0}
      const gd=g[k]
      gd.items.push(r);gd.sales+=r.sales;gd.base_sales+=r.base_sales
      gd.profit+=r.profit;gd.base_profit+=r.base_profit;gd.revenue+=r.revenue
    })
    const gl=Object.values(g).map(gd=>({...gd,s_delta:gd.sales-gd.base_sales,s_pct:salesPct(gd.sales,gd.base_sales),p_delta:gd.profit-gd.base_profit,p_pct:profitPct(gd.profit,gd.base_profit),margin:gd.revenue>0?gd.profit/gd.revenue:null}))
    const gk=(custSort.key==='cust'||custSort.key==='dept')?'sales':custSort.key
    gl.sort((a,b)=>{let x=a[gk],y=b[gk];x=(x===null||!isFinite(x))?-Infinity:x;y=(y===null||!isFinite(y))?-Infinity:y;return custSort.dir*(x-y)})
    return gl
  },[rows,custSort])

  const SEL={fontSize:12.5,padding:'5px 8px',border:`1px solid ${T.border}`,borderRadius:6,background:T.bg,color:T.text,fontFamily:'inherit'}
  const TH=({k,label,right,sub})=>(
    <th onClick={()=>sortCust(k)} style={{padding:'8px 14px',fontSize:10,fontWeight:600,color:T.text3,textTransform:'uppercase',letterSpacing:'0.05em',background:T.bg2,borderBottom:`1px solid ${T.border}`,whiteSpace:'nowrap',cursor:'pointer',userSelect:'none',textAlign:right?'right':'left'}}>
      <div style={{display:'flex',flexDirection:'column',gap:1,alignItems:right?'flex-end':'flex-start'}}>
        <span>{label}{custSort.key===k&&<span style={{fontSize:9,opacity:.75,marginLeft:3}}>{custSort.dir<0?'▼':'▲'}</span>}</span>
        {sub&&<span style={{fontWeight:400,fontSize:9,opacity:.8}}>{sub}</span>}
      </div>
    </th>
  )
  const TD1={padding:'9px 14px',fontSize:13,verticalAlign:'middle',fontWeight:500,color:T.text}
  const ROW={borderBottom:`1px solid ${T.border}`,transition:'background 0.1s'}

  const renderSubteamRow=(k,row,count,parentDept)=>(
    <tr key={`sub_${k}`} style={{...ROW,background:T.bg}}>
      <td style={{...TD1,paddingLeft:36,fontWeight:600}}>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <span style={{color:T.text3,fontSize:11,minWidth:10}}>└</span>
          <DeptDot dept={k}/>
          <span>{k}</span>
          <span style={{fontSize:10,color:T.text3,background:T.bg4,border:`1px solid ${T.border}`,borderRadius:9,padding:'1px 7px',marginLeft:6,whiteSpace:'nowrap'}}>{count} account{count!==1?'s':''} · in {parentDept}</span>
        </div>
      </td>
      <CustCells r={row}/>
    </tr>
  )

  const renderGrouped=()=>groups.map(g=>{
    const open=!!custOpen[g.dept]
    const grpRows=[]
    grpRows.push(
      <tr key={`grp_${g.dept}`} onClick={()=>toggleGrp(g.dept)} style={{...ROW,background:T.bg,cursor:'pointer'}} onMouseEnter={e=>{e.currentTarget.style.background='#EFF6FF'}} onMouseLeave={e=>{e.currentTarget.style.background=T.bg}}>
        <td style={{...TD1,fontWeight:700}}>
          <div style={{display:'flex',alignItems:'center',gap:7}}>
            <span style={{fontSize:9,color:T.text3,display:'inline-block',transform:open?'rotate(90deg)':'rotate(0deg)',transition:'transform 0.15s',lineHeight:1,flexShrink:0}}>▶</span>
            <DeptDot dept={g.dept}/>
            <span>{g.dept}</span>
            <span style={{fontSize:10,color:T.text3,background:T.bg4,borderRadius:8,padding:'1px 6px',marginLeft:2,flexShrink:0}}>{g.items.length}</span>
          </div>
        </td>
        <CustCells r={g}/>
      </tr>
    )
    if(open){
      if(g.items.length===0){
        grpRows.push(<tr key={`ge_${g.dept}`} style={{background:T.bg}}><td colSpan={6} style={{padding:'8px 14px 8px 46px',fontSize:12,color:T.text3,fontStyle:'italic'}}>No accounts match the current filters.</td></tr>)
      }else{
        const subs={}
        g.items.forEach(r=>{
          if(rollupDept(r.dept)===r.dept)return
          const k=r.dept
          if(!subs[k])subs[k]={sales:0,base_sales:0,profit:0,base_profit:0,revenue:0,items:0}
          subs[k].sales+=r.sales;subs[k].base_sales+=r.base_sales
          subs[k].profit+=r.profit;subs[k].base_profit+=r.base_profit
          subs[k].revenue+=r.revenue;subs[k].items++
        })
        Object.keys(subs).sort().forEach(k=>{
          const v=subs[k]
          const row={sales:v.sales,base_sales:v.base_sales,profit:v.profit,base_profit:v.base_profit,s_delta:v.sales-v.base_sales,s_pct:salesPct(v.sales,v.base_sales),p_delta:v.profit-v.base_profit,p_pct:profitPct(v.profit,v.base_profit),margin:v.revenue>0?v.profit/v.revenue:null,revenue:v.revenue}
          grpRows.push(renderSubteamRow(k,row,v.items,g.dept))
        })
        g.items.forEach(r=>{
          grpRows.push(
            <tr key={`ch_${g.dept}|${r.dept}|${r.cust}`} style={{...ROW,background:T.bg}} onMouseEnter={e=>{e.currentTarget.style.background='#EFF6FF'}} onMouseLeave={e=>{e.currentTarget.style.background=T.bg}}>
              <td style={{...TD1,paddingLeft:46}}><span>{r.cust}</span><DeptTag dept={r.dept}/></td>
              <CustCells r={r}/>
            </tr>
          )
        })
      }
    }
    return grpRows
  })

  return(
    <div>
      {/* Header */}
      <div style={{marginBottom:16}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <h1 style={{fontSize:20,fontWeight:700,color:T.text,margin:0}}>Customer Performance</h1>
          <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:10,background:'rgba(29,158,117,.11)',color:'#1D9E75',letterSpacing:'0.06em'}}>● LIVE</span>
        </div>
        <div style={{fontSize:13,color:T.text3,marginTop:4}}>
          Exact replication of the <em>EAM Performance Summary</em> notebook — aggregated to (department, customer) and sorted by Sales Amount
        </div>
      </div>

      {/* Filter bar */}
      <div style={{display:'flex',alignItems:'flex-end',gap:14,flexWrap:'wrap',padding:'12px 14px',background:T.bg2,border:`1px solid ${T.border}`,borderRadius:10,marginBottom:14}}>
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          <span style={{fontSize:10.5,textTransform:'uppercase',letterSpacing:'.04em',color:T.text3,fontWeight:600}}>Department</span>
          <select style={SEL} value={filters.dept} onChange={e=>setFilters(f=>({...f,dept:e.target.value}))}>
            <option value="">All departments</option>
            {deptOptions.map(([d,cnt])=><option key={d} value={d}>{d} ({cnt})</option>)}
          </select>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          <span style={{fontSize:10.5,textTransform:'uppercase',letterSpacing:'.04em',color:T.text3,fontWeight:600}}>Customer Search</span>
          <input type="text" placeholder="e.g. Booking" value={filters.search} onChange={e=>setFilters(f=>({...f,search:e.target.value}))} style={{...SEL,minWidth:210}}/>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          <span style={{fontSize:10.5,textTransform:'uppercase',letterSpacing:'.04em',color:T.text3,fontWeight:600}}>Activity</span>
          <select style={SEL} value={filters.active} onChange={e=>setFilters(f=>({...f,active:e.target.value}))}>
            <option value="active">Active only (sales or profit ≠ 0)</option>
            <option value="all">Include dormant accounts</option>
          </select>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          <span style={{fontSize:10.5,textTransform:'uppercase',letterSpacing:'.04em',color:T.text3,fontWeight:600}}>Compare Against</span>
          <select style={SEL} value={filters.basis} onChange={e=>setFilters(f=>({...f,basis:e.target.value}))}>
            <option value="lm">Last month MTD</option>
            <option value="ly">Last year MTD</option>
          </select>
        </div>
        <button onClick={resetFilters} style={{fontSize:12,color:T.blue,background:'none',border:'none',cursor:'pointer',textDecoration:'underline',fontFamily:'inherit',padding:'5px 0',alignSelf:'flex-end'}}>Reset filters</button>
        <div style={{marginLeft:'auto'}}>
          <button onClick={()=>exportCsv(rows,filters.basis)} style={{fontSize:12,fontWeight:600,padding:'6px 14px',border:`1px solid ${T.border2}`,borderRadius:6,background:T.bg,color:T.text2,cursor:'pointer',fontFamily:'inherit'}}>Export CSV</button>
        </div>
      </div>

      {/* KPI row */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:16}}>
        <KpiTile label="Accounts shown" value={numFmt(rows.length)} sub={`of ${numFmt((cust||[]).length)} on file`}/>
        <KpiTile label={`Sales Amount (${short})`} value={usdC(st.sales)} sub={`${signed(stx.s_delta)} vs ${blLabel}`} subColor={deltaColor(stx.s_delta)}/>
        <KpiTile label={`Total Profit (${short})`} value={usdC(st.profit)} sub={`${signed(stx.p_delta)} vs ${blLabel}`} subColor={deltaColor(stx.p_delta)}/>
        <KpiTile label="Blended margin" value={pctFmt(stx.margin,1)} sub={`Revenue ${usdC(st.revenue)}`}/>
      </div>

      {/* View mode controls */}
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12,flexWrap:'wrap'}}>
        <span style={{fontSize:10.5,textTransform:'uppercase',letterSpacing:'.04em',color:T.text3,fontWeight:600}}>Group</span>
        <div style={{display:'inline-flex',border:`1px solid ${T.border}`,borderRadius:6,overflow:'hidden'}}>
          {[['eam','By EAM'],['flat','Flat list']].map(([v,lbl])=>(
            <button key={v} onClick={()=>setGroup(v)} style={{fontSize:12,padding:'5px 11px',fontFamily:'inherit',border:'none',cursor:'pointer',background:custGroup===v?T.blue:T.bg,color:custGroup===v?'#fff':T.text2,transition:'background 0.15s,color 0.15s'}}>{lbl}</button>
          ))}
        </div>
        {custGroup==='eam'&&(<>
          <button onClick={()=>setAll(true)} style={{fontSize:12,fontWeight:600,padding:'5px 12px',border:`1px solid ${T.border}`,borderRadius:6,background:T.bg,color:T.text2,cursor:'pointer',fontFamily:'inherit'}}>Expand all</button>
          <button onClick={()=>setAll(false)} style={{fontSize:12,fontWeight:600,padding:'5px 12px',border:`1px solid ${T.border}`,borderRadius:6,background:T.bg,color:T.text2,cursor:'pointer',fontFamily:'inherit'}}>Collapse all</button>
        </>)}
        <div style={{marginLeft:'auto',fontSize:12,color:T.text3,background:T.bg4,padding:'4px 10px',borderRadius:6}}>
          {rows.length} account{rows.length!==1?'s':''}{custGroup==='eam'&&` · ${groups.length} team${groups.length!==1?'s':''}`}
        </div>
      </div>

      {/* Table */}
      <div style={{background:T.bg,borderRadius:12,boxShadow:T.lift,border:`1px solid ${T.border}`,overflow:'hidden',marginBottom:16}}>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'auto'}}>
            <thead>
              <tr>
                <TH k="cust" label={custGroup==='eam'?'Team / Customer':'Customer'}/>
                <TH k="sales"   label="Sales Amount" right sub={`${bl} MTD ▼`}/>
                <TH k="s_delta" label={`Sales ▲▼ v.s ${bl}`} right/>
                <TH k="profit"  label="Total Profit"  right sub={`${bl} Profit`}/>
                <TH k="p_delta" label={`Profit ▲▼ v.s ${bl}`} right/>
                <TH k="margin"  label="Margin" right/>
              </tr>
            </thead>
            <tbody>
              {rows.length===0?(
                <tr><td colSpan={6} style={{padding:'32px 20px',textAlign:'center',fontSize:13,color:T.text3}}>No accounts match the current filters.</td></tr>
              ):custGroup==='flat'?(
                rows.map(r=>(
                  <tr key={`${r.dept}|${r.cust}`} style={{...ROW,background:T.bg}} onMouseEnter={e=>{e.currentTarget.style.background='#EFF6FF'}} onMouseLeave={e=>{e.currentTarget.style.background=T.bg}}>
                    <td style={{...TD1}}><span>{r.cust}</span><DeptTag dept={r.dept}/></td>
                    <CustCells r={r}/>
                  </tr>
                ))
              ):(
                renderGrouped()
              )}
              {rows.length>0&&(
                <tr style={{background:T.bg,borderTop:`2px solid ${T.border}`}}>
                  <td style={{...TD1,fontWeight:700}}>Total — {rows.length} account{rows.length!==1?'s':''}</td>
                  <CustCells r={stx}/>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      </div>

      {/* §10.3 — LY=LM warning on single-month reconstructed periods */}
      {filters.basis==='ly'&&/^\d{4}-\d{2}$/.test(period)&&(
        <div style={{background:'rgba(234,179,8,.16)',border:'1px solid #EAB308',borderRadius:8,padding:'10px 14px',marginTop:8,fontSize:12,color:'#9A6B0C',lineHeight:1.65}}>
          ⚠️ <strong>Last year MTD equals Last month MTD on single-month selections.</strong> The reconstructed monthly source ({period}) carries no prior-year data, so LY and LM comparisons are identical here. Switch to MTD for a true year-on-year comparison.
        </div>
      )}
    </div>
  )
}
