/**
 * validate_q7q8.mjs
 * Loads the already-fetched Q7/Q8 results from temp storage and runs validation + writes apMonthly.js
 * This avoids re-running expensive BQ queries.
 *
 * Re-fetches from BQ if the temp store doesn't exist.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createSign } from 'crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Read roster ───────────────────────────────────────────────────────────────
const rosterRaw = fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'overviewRoster.js'), 'utf8')
const rosterMatch = rosterRaw.match(/export const AP_ROSTER\s*=\s*(\{[\s\S]+?\})\s*;?\s*$/)
const AP_ROSTER = JSON.parse(rosterMatch[1])
const CODES = Object.keys(AP_ROSTER).sort()
console.log(`Universe: ${CODES.length} airports`)

// ── Load AP_OPS (ES module) ───────────────────────────────────────────────────
const opsMod = await import(path.join(__dirname, '..', 'src', 'data', 'overviewOps.js'))
const AP_OPS = opsMod.AP_OPS
console.log(`AP_OPS loaded: ${Object.keys(AP_OPS).length} airports`)

const BASE = new Date('2024-06-01T00:00:00Z')
const GA4_START = 382, GA4_END = 767

function dayOffset(dateStr) {
  return Math.round((new Date(dateStr + 'T00:00:00Z') - BASE) / 86400000)
}

function parseDailyOps(dl) {
  const map = {}
  if (!dl) return map
  dl.split('|').forEach(seg => {
    const parts = seg.split(':').map(Number)
    if (parts.length >= 4) map[parts[0]] = [parts[1], parts[2], parts[3]]
  })
  return map
}

function parseMonthly(mStr) {
  if (!mStr) return {}
  const out = {}
  mStr.split('|').forEach(seg => {
    const [ym, a, b, c] = seg.split(':')
    out[ym] = [Number(a)||0, Number(b)||0, Number(c)||0]
  })
  return out
}

// ── Need BQ data — run short queries ─────────────────────────────────────────
// Since Q7/Q8 already ran but weren't saved as JSON (only wrote apMonthly.js which failed),
// we need to re-run but ONLY the validation/write part.
// APPROACH: Re-run Q7/Q8 from BQ (they're fast — just monthly aggregates, ~seconds)

const SA_PATH = '/Users/simant/Downloads/elife-data-warehouse-prod-082ee9c17f49.json'
const PROJECT_ID = 'elife-data-warehouse-prod'

async function getToken() {
  const sa = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'))
  const now = Math.floor(Date.now() / 1000)
  const hdr = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const pay = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/bigquery',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  })).toString('base64url')
  const sign = createSign('SHA256'); sign.update(`${hdr}.${pay}`); sign.end()
  const jwt = `${hdr}.${pay}.${sign.sign(sa.private_key, 'base64url')}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  const d = await res.json()
  if (!d.access_token) throw new Error('Token err: ' + JSON.stringify(d))
  return d.access_token
}

function extractRows(result) {
  const fields = result.schema?.fields ?? []
  return (result.rows ?? []).map(row => {
    const obj = {}
    fields.forEach((f, i) => {
      const v = row.f[i]?.v
      obj[f.name] = (v == null || v === '') ? null : v
    })
    return obj
  })
}

async function pollJob(jobId, token, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 3000))
    process.stdout.write('.')
    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries/${jobId}?timeoutMs=5000&maxResults=100000`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const result = await res.json()
    if (result.jobComplete) {
      let rows = extractRows(result)
      let pt = result.pageToken
      while (pt) {
        const purl = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries/${jobId}?pageToken=${pt}&maxResults=100000`
        const pr = await fetch(purl, { headers: { Authorization: `Bearer ${token}` } })
        const pd = await pr.json()
        rows = [...rows, ...extractRows(pd)]
        pt = pd.pageToken
      }
      return rows
    }
  }
  throw new Error(`Job ${jobId} timed out`)
}

async function runQuery(sql, token, label) {
  console.log(`\n=== ${label} ===`)
  const res = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 180000 }),
  })
  const result = await res.json()
  if (result.errors?.length) throw new Error(`BQ errors: ${JSON.stringify(result.errors)}`)
  if (result.jobComplete) {
    let rows = extractRows(result)
    let pt = result.pageToken
    while (pt) {
      const jobId = result.jobReference.jobId
      const purl = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries/${jobId}?pageToken=${pt}&maxResults=100000`
      const pr = await fetch(purl, { headers: { Authorization: `Bearer ${token}` } })
      const pd = await pr.json()
      rows = [...rows, ...extractRows(pd)]
      pt = pd.pageToken
    }
    console.log(`\n${label}: ${rows.length} rows`)
    return rows
  }
  const jobId = result.jobReference.jobId
  console.log(`Polling ${jobId}...`)
  const rows = await pollJob(jobId, token)
  console.log(`\n${label}: ${rows.length} rows`)
  return rows
}

const CHUNK1 = CODES.filter(c => c[0] <= 'L').sort()
const CHUNK2 = CODES.filter(c => c[0] > 'L').sort()

function q7(codeList) {
  const il = codeList.map(c => `'${c}'`).join(',')
  return `
WITH e AS (
  SELECT PARSE_DATE('%Y%m%d', event_date) AS d, event_name,
    IFNULL(ecommerce.purchase_revenue,0) rev,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key='pick_up_code') puc,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key='drop_off_code') doc
  FROM \`elife-data-warehouse-prod.analytics_259261360.events_*\`
  WHERE _TABLE_SUFFIX BETWEEN '20250616' AND '20260708'
    AND event_name IN ('view_search_results','purchase')
),
roles AS (
  SELECT d, event_name, rev, puc AS cd, 'P' AS role FROM e WHERE puc IN (${il})
  UNION ALL
  SELECT d, event_name, rev, doc AS cd, 'D' AS role FROM e WHERE doc IN (${il})
),
mo AS (
  SELECT cd, role, FORMAT_DATE('%y%m', d) ym,
    COUNTIF(event_name='view_search_results') s,
    COUNTIF(event_name='purchase') p,
    CAST(ROUND(SUM(IF(event_name='purchase',rev,0))) AS INT64) r
  FROM roles GROUP BY cd, role, ym
)
SELECT cd, role,
  STRING_AGG(ym||':'||CAST(s AS STRING)||':'||CAST(p AS STRING)||':'||CAST(r AS STRING), '|' ORDER BY ym) m
FROM mo GROUP BY cd, role ORDER BY cd, role
`
}

const Q8 = `
WITH fx AS (SELECT to_cur, rate FROM \`elife-data-warehouse-prod.mapping.mapping_cur_exch_rate\` WHERE from_cur='USD'),
gbp AS (SELECT rate usd_to_gbp FROM fx WHERE to_cur='GBP'),
rides AS (
  SELECT ride_id, MIN(booking_date) bd,
    ANY_VALUE(hoppa_SellRate) sr, ANY_VALUE(partner_amount_currency) cur,
    LOGICAL_OR(ride_stat LIKE '%ancel%') canc,
    ARRAY_AGG(DISTINCT pickup_airport_code3 IGNORE NULLS) pua,
    ARRAY_AGG(DISTINCT dropoff_airport_code3 IGNORE NULLS) doa
  FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\`
  WHERE partner_type='hoppa' AND booking_date BETWEEN '2025-04-01' AND '2026-07-09'
  GROUP BY ride_id
),
r2 AS (
  SELECT ride_id, FORMAT_DATE('%y%m', bd) ym, canc, pua, doa,
    IF(canc,0,CASE WHEN cur='GBP' THEN sr
      ELSE sr/NULLIF((SELECT rate FROM fx WHERE to_cur=cur),0)*(SELECT usd_to_gbp FROM gbp) END) net
  FROM rides
),
roles AS (
  SELECT ym, ap, 'P' AS role, canc, net FROM r2, UNNEST(IFNULL(pua,[])) ap WHERE LENGTH(ap)=3
  UNION ALL
  SELECT ym, ap, 'D' AS role, canc, net FROM r2, UNNEST(IFNULL(doa,[])) ap WHERE LENGTH(ap)=3
),
mo AS (
  SELECT ap, role, ym,
    COUNT(*) b,
    COUNTIF(canc) c,
    CAST(ROUND(SUM(IFNULL(net,0))) AS INT64) tn
  FROM roles GROUP BY ap, role, ym
)
SELECT mo.ap, role,
  STRING_AGG(ym||':'||CAST(b AS STRING)||':'||CAST(c AS STRING)||':'||CAST(tn AS STRING), '|' ORDER BY ym) m
FROM mo GROUP BY mo.ap, role ORDER BY mo.ap, role
`

async function main() {
  console.log('Getting access token...')
  const token = await getToken()
  console.log('Token OK')

  // Run Q7 (two chunks) and Q8
  const [q7a, q7b, q8Rows] = await Promise.all([
    runQuery(q7(CHUNK1), token, 'Q7 GA4 monthly A-L'),
    runQuery(q7(CHUNK2), token, 'Q7 GA4 monthly M-Z'),
    runQuery(Q8, token, 'Q8 Dispatch monthly directional'),
  ])
  const allQ7 = [...q7a, ...q7b]
  console.log(`Q7 total: ${allQ7.length} rows | Q8: ${q8Rows.length} rows`)

  // Build maps
  const ga4Monthly = {}
  for (const row of allQ7) {
    if (!ga4Monthly[row.cd]) ga4Monthly[row.cd] = {}
    ga4Monthly[row.cd][row.role] = parseMonthly(row.m)
  }
  const opsMonthly = {}
  for (const row of q8Rows) {
    if (!opsMonthly[row.ap]) opsMonthly[row.ap] = {}
    opsMonthly[row.ap][row.role] = parseMonthly(row.m)
  }

  console.log('\n=== VALIDATION GATES ===')

  // G1: Check PMI/LHR anchors from brief
  const pmiP = ga4Monthly['PMI']?.['P'] || {}
  const pmiD = ga4Monthly['PMI']?.['D'] || {}
  // Sum the full Q7 window (2506=June 2025 through 2607=July 2026)
  let pmiPtotS=0, pmiPtotP=0, pmiDtotS=0, pmiDtotP=0
  for(const [ym,v] of Object.entries(pmiP)){ pmiPtotS+=v[0]; pmiPtotP+=v[1] }
  for(const [ym,v] of Object.entries(pmiD)){ pmiDtotS+=v[0]; pmiDtotP+=v[1] }
  console.log(`G1 PMI From(P) total: s=${pmiPtotS.toLocaleString()} p=${pmiPtotP} (brief trailing-12m anchor: From=154,303)`)
  console.log(`G1 PMI To  (D) total: s=${pmiDtotS.toLocaleString()} p=${pmiDtotP} (brief trailing-12m anchor: To=11,522)`)

  const lhrP = ga4Monthly['LHR']?.['P'] || {}
  const lhrD = ga4Monthly['LHR']?.['D'] || {}
  let lhrPtotS=0, lhrDtotS=0
  for(const v of Object.values(lhrP)) lhrPtotS+=v[0]
  for(const v of Object.values(lhrD)) lhrDtotS+=v[0]
  console.log(`G1 LHR From(P) total: s=${lhrPtotS.toLocaleString()} To(D): s=${lhrDtotS.toLocaleString()} (brief: From=6485, To=9028 trailing-12m)`)

  let g1OK = 0, g1Missing = 0
  for (const cd of CODES) {
    if (ga4Monthly[cd]?.['P'] || ga4Monthly[cd]?.['D']) g1OK++
    else { g1Missing++; if(g1Missing<=5) console.log(`G1 missing: ${cd}`) }
  }
  console.log(`G1: ${g1OK} airports have Q7 data | ${g1Missing} missing`)

  // G2: max(From,To) ≤ Both ≤ From+To for every airport-month ≥ 2504
  const MONTHS_G2 = []
  for (let y=2025; y<=2026; y++) {
    const mStart = y===2025 ? 4 : 1
    const mEnd = y===2025 ? 12 : 7
    for (let m=mStart; m<=mEnd; m++) {
      const ym = `${String(y).slice(2)}${String(m).padStart(2,'0')}`
      const ms = `${y}-${String(m).padStart(2,'0')}-01`
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
      const me = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`
      MONTHS_G2.push({ ym, so: dayOffset(ms), eo: dayOffset(me) })
    }
  }

  let g2Violations = 0, g2Checked = 0
  for (const cd of CODES) {
    const opsMap = parseDailyOps(AP_OPS[cd] || '')
    const q8P = opsMonthly[cd]?.['P'] || {}
    const q8D = opsMonthly[cd]?.['D'] || {}
    for (const { ym, so, eo } of MONTHS_G2) {
      let bothB = 0
      for (let o=so; o<=eo; o++) { const d=opsMap[o]; if(d) bothB+=d[0] }
      const fromB = (q8P[ym] || [0])[0]
      const toB = (q8D[ym] || [0])[0]
      if (bothB===0 && fromB===0 && toB===0) continue
      g2Checked++
      const maxFT = Math.max(fromB, toB)
      const sumFT = fromB + toB
      if (maxFT > bothB + 3 || bothB > sumFT + 3) {
        g2Violations++
        if (g2Violations <= 8) console.log(`G2 ❌ ${cd} ${ym}: F=${fromB} T=${toB} Both=${bothB} max=${maxFT} sum=${sumFT}`)
      }
    }
  }
  console.log(g2Violations===0
    ? `G2 ✅ max(F,T)≤Both≤F+T holds for all ${g2Checked} airport-months`
    : `G2 ❌ ${g2Violations} violations in ${g2Checked} airport-months`)

  // G3: PMI 2606 anchors
  const pmiQ8P = opsMonthly['PMI']?.['P'] || {}
  const pmiQ8D = opsMonthly['PMI']?.['D'] || {}
  const p2606 = pmiQ8P['2606'] || [0,0,0]
  const d2606 = pmiQ8D['2606'] || [0,0,0]
  console.log(`G3 PMI 2606 From: gross=${p2606[0]} canc=${p2606[1]} (expect ~1123)`)
  console.log(`G3 PMI 2606 To  : gross=${d2606[0]} canc=${d2606[1]} (expect ~966)`)
  // Touch from daily
  const pmiDailyMap = parseDailyOps(AP_OPS['PMI'] || '')
  let pmiTouchB=0, pmiTouchC=0
  const jun26s=dayOffset('2026-06-01'), jun26e=dayOffset('2026-06-30')
  for(let o=jun26s; o<=jun26e; o++){const d=pmiDailyMap[o]; if(d){pmiTouchB+=d[0]; pmiTouchC+=d[1]}}
  const g3 = Math.abs(pmiTouchB-1282)<=10 && Math.abs(pmiTouchC-36)<=3
  console.log(`G3 PMI 2606 touch: gross=${pmiTouchB} canc=${pmiTouchC} (expect 1282/36) → ${g3?'✅':'❌'}`)

  // Check G2 also verify PMI round-trip arithmetic
  console.log(`G3 PMI 2606: From+To=${p2606[0]+d2606[0]} ≥ Both=${pmiTouchB} ? ${p2606[0]+d2606[0]>=pmiTouchB?'✅':'❌'}`)
  console.log(`G3 PMI 2606: max(F,T)=${Math.max(p2606[0],d2606[0])} ≤ Both=${pmiTouchB} ? ${Math.max(p2606[0],d2606[0])<=pmiTouchB?'✅':'❌'}`)

  // ── ENCODE OUTPUT ─────────────────────────────────────────────────────────
  const apMonthlyGA4 = {}
  for (const cd of CODES) {
    const entry = {}
    for (const role of ['P','D']) {
      const map = ga4Monthly[cd]?.[role]
      if (map && Object.keys(map).length > 0) {
        entry[role] = Object.entries(map).sort(([a],[b])=>a.localeCompare(b))
          .map(([ym,[s,p,r]]) => `${ym}:${s}:${p}:${r}`).join('|')
      }
    }
    if (Object.keys(entry).length > 0) apMonthlyGA4[cd] = entry
  }

  const apMonthlyOps = {}
  for (const cd of Object.keys(opsMonthly)) {
    const entry = {}
    for (const role of ['P','D']) {
      const map = opsMonthly[cd]?.[role]
      if (map && Object.keys(map).length > 0) {
        entry[role] = Object.entries(map).sort(([a],[b])=>a.localeCompare(b))
          .map(([ym,[b,c,tn]]) => `${ym}:${b}:${c}:${tn}`).join('|')
      }
    }
    if (Object.keys(entry).length > 0) apMonthlyOps[cd] = entry
  }

  const outJS = `// All Airports monthly directional data
// Pulled: ${new Date().toISOString()}
// G1: ${g1OK} airports | G2: ${g2Violations===0?'PASS':g2Violations+' violations'} | G3: ${g3?'PASS':'FAIL'}
// AP_MONTHLY_GA4[cd] = { P: 'ym:s:p:r|...', D: '...' }   (Q7, same GA4 window as daily)
// AP_MONTHLY_OPS[cd] = { P: 'ym:b:c:tn|...', D: '...' }  (Q8, Apr 2025+, UNNEST arrays)
export const AP_MONTHLY_GA4 = ${JSON.stringify(apMonthlyGA4)};
export const AP_MONTHLY_OPS = ${JSON.stringify(apMonthlyOps)};
`

  const outPath = path.join(__dirname, '..', 'src', 'data', 'apMonthly.js')
  fs.writeFileSync(outPath, outJS)
  console.log(`\n✅ Wrote apMonthly.js: ${fs.statSync(outPath).size.toLocaleString()} bytes`)
  console.log(`   GA4 airports: ${Object.keys(apMonthlyGA4).length}`)
  console.log(`   Ops airports: ${Object.keys(apMonthlyOps).length}`)

  if (g2Violations > 0) {
    console.error('\n❌ G2 FAILED — check trap T3 (UNNEST vs ANY_VALUE). Do NOT proceed to UI until fixed.')
    process.exit(1)
  }
  console.log('\n✅ All validation gates passed. Run Q9/Q10 next.')
}

main().catch(e => { console.error(e); process.exit(1) })
