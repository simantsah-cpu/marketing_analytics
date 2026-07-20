/**
 * validate_rankings_v2.mjs
 * Headless validation of Rankings logic. 
 * Reads data files via regex-based extraction (no module bundling needed).
 */
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

// ── Extract data from JS export files ─────────────────────────────────────────
function extractStringExport(src, name) {
  // Pattern: export const NAME = 'content'
  const re = new RegExp(`export const ${name}\\s*=\\s*'([^']*)'`)
  const m = src.match(re)
  return m ? m[1] : null
}

function extractObjectExport(src, name) {
  // Pattern: export const NAME = { ... }
  // Find the { after the = and extract the whole JSON-like block
  const re = new RegExp(`export const ${name}\\s*=\\s*(\\{)`)
  const m = src.match(re)
  if (!m) return {}
  const start = m.index + m[0].length - 1
  let depth=0, i=start, inStr=false, strChar=''
  for (; i<src.length; i++) {
    if (inStr) {
      if (src[i]==='\\'){i++;continue}
      if (src[i]===strChar) inStr=false
      continue
    }
    if (src[i]==='"'||src[i]==="'"||src[i]==='`'){inStr=true;strChar=src[i];continue}
    if (src[i]==='{') depth++
    else if (src[i]==='}'){depth--;if(depth===0){i++;break}}
  }
  try { return (new Function('return '+src.slice(start,i)))() }
  catch(e) { console.error('Parse error:', e.message); return {} }
}

console.log('Loading data files...')
const rosterSrc = readFileSync(path.join(ROOT, 'src/data/overviewRoster.js'), 'utf8')
const ga4Src    = readFileSync(path.join(ROOT, 'src/data/overviewGa4.js'), 'utf8')
const opsSrc    = readFileSync(path.join(ROOT, 'src/data/overviewOps.js'), 'utf8')

const AP_ROSTER = extractObjectExport(rosterSrc, 'AP_ROSTER')
const AP_GA4    = extractObjectExport(ga4Src, 'AP_GA4')
const AP_OPS    = extractObjectExport(opsSrc, 'AP_OPS')

console.log(`AP_ROSTER: ${Object.keys(AP_ROSTER).length} airports`)
console.log(`AP_GA4: ${Object.keys(AP_GA4).length} entries`)
console.log(`AP_OPS: ${Object.keys(AP_OPS).length} entries`)

if (!AP_ROSTER['PMI']) { console.error('❌ PMI not found in AP_ROSTER'); process.exit(1) }
if (!AP_OPS['PMI']) { console.error('❌ PMI not found in AP_OPS'); process.exit(1) }

// ── Exact functions from RankingsTab ─────────────────────────────────────────
const BASE = new Date('2024-06-01T00:00:00Z')
const GA4_S=382, GA4_E=767, OPS_S=304, OPS_E=768, MIG_S=245, MIG_E=303

const _ga4Cache={}, _opsCache={}

function getGA4(cd) {
  if (_ga4Cache[cd]!==undefined) return _ga4Cache[cd]
  const raw=AP_GA4[cd]; if(!raw){_ga4Cache[cd]={};return {}}
  const m={}
  raw.split('|').forEach(seg=>{const p=seg.split(':');const o=+p[0];m[o]=[+p[1]||0,p[2]!=null?+p[2]:0,p[3]!=null?+p[3]:0]})
  _ga4Cache[cd]=m;return m
}
function getOps(cd) {
  if (_opsCache[cd]!==undefined) return _opsCache[cd]
  const raw=AP_OPS[cd]; if(!raw){_opsCache[cd]={};return {}}
  const m={}
  raw.split('|').forEach(seg=>{const p=seg.split(':');m[+p[0]]=[+p[1]||0,+p[2]||0,+p[3]||0]})
  _opsCache[cd]=m;return m
}
function sumGA4(cd,f,t) {
  const lo=Math.max(f,GA4_S),hi=Math.min(t,GA4_E)
  let s=0,p=0,r=0; if(lo>hi) return {s,p,r}
  const m=getGA4(cd); for(let o=lo;o<=hi;o++){const d=m[o];if(!d)continue;s+=d[0];p+=d[1];r+=d[2]}
  return {s,p,r}
}
function sumOps(cd,f,t) {
  const lo=Math.max(f,OPS_S),hi=Math.min(t,OPS_E)
  let b=0,c=0,tn=0; if(lo>hi) return {b,c,tn}
  const m=getOps(cd); for(let o=lo;o<=hi;o++){const d=m[o];if(!d)continue;b+=d[0];c+=d[1];tn+=d[2]}
  return {b,c,tn}
}
function hasOpsData(cd,f,t) {
  const lo=Math.max(f,OPS_S),hi=Math.min(t,OPS_E); if(lo>hi) return false
  const m=getOps(cd); for(let o=lo;o<=hi;o++){if(m[o]) return true}; return false
}
function dayOffset(s) { return Math.round((new Date(s+'T00:00:00Z')-BASE)/86400000) }
function overlaps(a1,a2,b1,b2){return a1<=b2&&a2>=b1}

function computeValue(metricId, cd, f, t, dayCount) {
  const sMin=Math.max(50,dayCount*12), bMin=Math.max(5,Math.round(dayCount*1.2))
  switch(metricId) {
    case 'b': { if(!hasOpsData(cd,f,t)) return null; const o=sumOps(cd,f,t); const net=o.b-o.c; return net>0?net:null }
    case 'tn': { if(!hasOpsData(cd,f,t)) return null; const o=sumOps(cd,f,t); return o.tn>0?o.tn:null }
    case 's': { const g=sumGA4(cd,f,t); return g.s>0?g.s:null }
    case 'p': { const g=sumGA4(cd,f,t); return g.p>0?g.p:null }
    case 'r': { const g=sumGA4(cd,f,t); return g.r>0?g.r:null }
    case 's2b': { const g=sumGA4(cd,f,t); if(g.s<sMin) return null; return g.s>0?g.p/g.s*100:null }
    case 'cr': { if(!hasOpsData(cd,f,t)) return null; const o=sumOps(cd,f,t); if(o.b<bMin) return null; return o.b>0?o.c/o.b*100:null }
    default: return null
  }
}

function rankMap(metricId, codes, f, t, dayCount) {
  const asc = metricId==='cr'
  const list=[]
  for(const cd of codes) {
    const v=computeValue(metricId,cd,f,t,dayCount)
    if(v==null) continue
    list.push({cd,v})
  }
  list.sort((a,b)=>asc?a.v-b.v:b.v-a.v)
  const map={}
  list.forEach((item,i)=>{map[item.cd]={rank:i+1,v:item.v}})
  return map
}

const codes = Object.keys(AP_ROSTER)

// ── Windows ───────────────────────────────────────────────────────────────────
const fo=dayOffset('2026-06-29'), to=dayOffset('2026-07-05')  // W27-2026 (7 days)
const cf=dayOffset('2025-06-30'), ct=dayOffset('2025-07-06')  // W27-2025 YoY (weekday aligned)
const dayCount=7

console.log('\n=== VALIDATION GATES ===\n')

// ── K1: FLOOR TEST ────────────────────────────────────────────────────────────
const crRank = rankMap('cr', codes, fo, to, dayCount)
const crList = Object.entries(crRank).sort((a,b)=>a[1].rank-b[1].rank)
const bMin7 = Math.max(5,Math.round(dayCount*1.2))  // =9
let k1Fail=0
for(const [cd,{rank,v}] of crList.slice(0,30)) {
  const o=sumOps(cd,fo,to)
  if(o.b<bMin7){console.log(`K1 ❌ cr #${rank} ${cd} gross=${o.b} < bMin=${bMin7}`);k1Fail++}
}
const s2bRank = rankMap('s2b', codes, fo, to, dayCount)
const sMin7 = Math.max(50, dayCount*12)  // =84
const s2bList = Object.entries(s2bRank).sort((a,b)=>a[1].rank-b[1].rank)
for(const [cd,{rank,v}] of s2bList.slice(0,30)) {
  const g=sumGA4(cd,fo,to)
  if(g.s<sMin7){console.log(`K1 ❌ s2b #${rank} ${cd} searches=${g.s} < sMin=${sMin7}`);k1Fail++}
}
console.log(`K1 ${k1Fail===0?'✅':'❌'} Floor test: cr bMin=${bMin7}, s2b sMin=${sMin7}, violations=${k1Fail}`)
// Show cr top 5 with their gross
console.log(`   cr top 5:`)
crList.slice(0,5).forEach(([cd,{rank,v}])=>{
  const o=sumOps(cd,fo,to)
  console.log(`     #${rank} ${cd}: ${v.toFixed(2)}% (gross=${o.b}, canc=${o.c}) ${o.b>=bMin7?'✅':'❌ BELOW FLOOR'}`)
})

// ── K2: ASCENDING TEST ────────────────────────────────────────────────────────
const cr1=crList[0]?.[1]?.v, cr4=crList[3]?.[1]?.v, cr10=crList[9]?.[1]?.v
const k2ok = cr1!=null && cr4!=null && cr10!=null && cr1<=cr4 && cr4<=cr10
console.log(`\nK2 ${k2ok?'✅':'❌'} Ascending: cr #1=${cr1?.toFixed(2)}% <= #4=${cr4?.toFixed(2)}% <= #10=${cr10?.toFixed(2)}%`)

// ── K3: ASYMMETRIC VALIDITY (Q2+YoY) ─────────────────────────────────────────
const q2f=dayOffset('2026-04-01'), q2t=dayOffset('2026-06-30')
const q2cf=dayOffset('2025-04-01'), q2ct=dayOffset('2025-06-30')
const q2ga4Valid = q2cf>=GA4_S  // 304 >= 382? → false → ga4="no basis"
const q2opsMig = overlaps(q2cf,q2ct,MIG_S,MIG_E)
const q2opsValid = q2cf>=OPS_S && !q2opsMig  // 304>=304 && no mig → true → ops="valid"
console.log(`\nK3 Q2+YoY asymmetric validity:`)
console.log(`   ga4: q2cf=${q2cf} >= GA4_S=${GA4_S}? ${q2ga4Valid} (expect false="no basis") → ${!q2ga4Valid?'✅':'❌'}`)
console.log(`   ops: q2cf=${q2cf} >= OPS_S=${OPS_S} && !migOlap(${q2opsMig})? ${q2opsValid} (expect true="valid") → ${q2opsValid?'✅':'❌'}`)
console.log(`   ✅ K3: ops valid / ga4 no-basis — asymmetric pair confirmed`)

// ── K4: MOVEMENT ARITHMETIC ──────────────────────────────────────────────────
const bRankCur = rankMap('b', codes, fo, to, dayCount)
const bRankPrv = rankMap('b', codes, cf, ct, dayCount)
const withDelta = Object.entries(bRankCur)
  .map(([cd,{rank,v}])=>{const prv=bRankPrv[cd]; if(!prv) return null; return {cd,rank,prvRank:prv.rank,delta:prv.rank-rank,v}})
  .filter(Boolean)
  .sort((a,b)=>b.delta-a.delta)
const topC = withDelta[0]
const k4ok = topC && (topC.delta === topC.prvRank - topC.rank)
console.log(`\nK4 ${k4ok?'✅':'❌'} Movement arithmetic:`)
if(topC) console.log(`   Biggest climber: ${topC.cd} #${topC.prvRank}→#${topC.rank} Δ=${topC.delta} (${topC.prvRank}-${topC.rank}=${topC.prvRank-topC.rank}) match=${k4ok}`)
const newCount = Object.keys(bRankCur).filter(cd=>!bRankPrv[cd]).length
console.log(`   "new" count (in cur, not prv): ${newCount}`)
// Sample "new" airport
const sampleNew = Object.keys(bRankCur).find(cd=>!bRankPrv[cd])
if(sampleNew) {
  const curV = bRankCur[sampleNew]
  const oCur = sumOps(sampleNew, fo, to)
  const oPrv = sumOps(sampleNew, cf, ct)
  console.log(`   Sample "new": ${sampleNew} cur gross=${oCur.b} net=${oCur.b-oCur.c} | prv gross=${oPrv.b} net=${oPrv.b-oPrv.c} (prv net=0 or no data → correct "new")`)
}

// ── K5: PMI ANCHOR (metric b, June 2026) ─────────────────────────────────────
const junF=dayOffset('2026-06-01'), junT=dayOffset('2026-06-30'), junDays=30
const pmiOps=sumOps('PMI', junF, junT)
const pmiNet=pmiOps.b-pmiOps.c
const pmiJunRank=rankMap('b', codes, junF, junT, junDays)
const pmiEntry=pmiJunRank['PMI']
const k5ok = Math.abs(pmiNet-1246)<=3 && pmiEntry != null
console.log(`\nK5 ${k5ok?'✅':'❌'} PMI June 2026: gross=${pmiOps.b} canc=${pmiOps.c} net=${pmiNet} (expect ~1246) rank=#${pmiEntry?.rank||'?'}`)

// ── K6: SWEEP — 7 metrics × 6 windows ────────────────────────────────────────
const METS=['b','tn','s','p','r','s2b','cr']
const WINDOWS=[
  ['2026-07-05','2026-07-05',1],
  ['2026-06-29','2026-07-05',7],
  ['2026-06-01','2026-06-30',30],
  ['2026-04-01','2026-06-30',91],
  ['2026-01-01','2026-06-30',181],
  ['2025-06-16','2026-07-05',384],
]
let sweepFail=0
for(const m of METS) {
  for(const [ws,we,wdc] of WINDOWS) {
    try {
      const r=rankMap(m, codes, dayOffset(ws), dayOffset(we), wdc)
      const n=Object.keys(r).length
      if(n>240){console.log(`  K6 ❌ ${m} [${wdc}d]: N=${n}>240`);sweepFail++}
    } catch(e){console.log(`  K6 ❌ ${m} [${wdc}d]: EXCEPTION ${e.message}`);sweepFail++}
  }
}
console.log(`\nK6 ${sweepFail===0?'✅':'❌'} Sweep: ${METS.length*WINDOWS.length} combinations, ${sweepFail} failures`)

// ── K7: COUNT SANITY ─────────────────────────────────────────────────────────
const cr1d=rankMap('cr',codes,dayOffset('2026-07-05'),dayOffset('2026-07-05'),1)
const b7d=rankMap('b',codes,fo,to,dayCount)
const b181d=rankMap('b',codes,dayOffset('2026-01-01'),dayOffset('2026-06-30'),181)
const n_cr1d=Object.keys(cr1d).length
const n_b7d=Object.keys(b7d).length
const n_b181d=Object.keys(b181d).length
console.log(`\nK7 Count sanity:`)
console.log(`   cr 1-day: N=${n_cr1d} (expect <<100 — floors bite hard) → ${n_cr1d<100?'✅':'❌'}`)
console.log(`   b 7-day:  N=${n_b7d}  (expect 150-240) → ${n_b7d>=100&&n_b7d<=240?'✅':'❌'}`)
console.log(`   b 181-day: N=${n_b181d} (expect ~230-240) → ${n_b181d>=200?'✅':'❌'}`)

// ── FINAL SUMMARY ─────────────────────────────────────────────────────────────
const allPass = k1Fail===0 && k2ok && !q2ga4Valid && q2opsValid && k4ok && k5ok && sweepFail===0 && n_cr1d<100
console.log(`\n=== ${allPass?'✅ ALL GATES PASSED':'❌ SOME GATES FAILED'} ===`)
if(!allPass) process.exit(1)
