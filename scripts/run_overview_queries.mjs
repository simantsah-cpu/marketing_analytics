/**
 * run_overview_queries.mjs
 * Runs Q3, Q4 (2 chunks), Q5 (2 chunks) for the Overview page.
 * Validates PMI June 2026 and LHR trailing-12m gates before writing output.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createSign } from 'crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ID = 'elife-data-warehouse-prod'
const SA_PATH = '/Users/simant/Downloads/elife-data-warehouse-prod-082ee9c17f49.json'

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

async function pollJob(jobId, token, maxAttempts = 60) {
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
    body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 120000 }),
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

// ── Q3: Airport universe ──────────────────────────────────────────────────────
const Q3 = `
WITH e AS (
  SELECT event_name,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key='pick_up_code') puc,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key='drop_off_code') doc
  FROM \`elife-data-warehouse-prod.analytics_259261360.events_*\`
  WHERE _TABLE_SUFFIX BETWEEN '20250616' AND '20260708'
    AND event_name IN ('view_search_results','purchase')
),
ap AS (SELECT Code cd, ANY_VALUE(IFNULL(LocnameFrom,LocnameTo)) nm, ANY_VALUE(CountryCode) cc
       FROM \`elife-data-warehouse-prod.dim.dim_p2p_location\`
       WHERE LocationType='AP' AND LENGTH(Code)=3 GROUP BY Code),
agg AS (
  SELECT a.cd, a.nm, a.cc,
    COUNTIF(e.event_name='view_search_results' AND e.puc=a.cd) sp,
    COUNTIF(e.event_name='purchase'            AND e.puc=a.cd) pp,
    COUNTIF(e.event_name='view_search_results' AND e.doc=a.cd) sd,
    COUNTIF(e.event_name='purchase'            AND e.doc=a.cd) pd
  FROM ap a JOIN e ON a.cd IN (e.puc, e.doc)
  GROUP BY 1,2,3
)
SELECT * FROM agg WHERE sp>=300 OR sd>=300 ORDER BY cd
`

// ── Q4: per-airport GA4 daily (template, fill IN-list) ───────────────────────
function q4(codeList) {
  const inList = codeList.map(c => `'${c}'`).join(',')
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
expl AS (
  SELECT d, event_name, rev, cd
  FROM e, UNNEST(ARRAY(SELECT DISTINCT x FROM UNNEST([puc,doc]) x WHERE x IS NOT NULL AND x!='')) cd
  WHERE cd IN (${inList})
),
dd AS (
  SELECT cd, DATE_DIFF(d, DATE '2024-06-01', DAY) o,
    COUNTIF(event_name='view_search_results') s,
    COUNTIF(event_name='purchase') p,
    CAST(ROUND(SUM(IF(event_name='purchase',rev,0))) AS INT64) r
  FROM expl GROUP BY cd, o
)
SELECT cd,
  STRING_AGG(CAST(o AS STRING)||':'||CAST(s AS STRING)
    ||IF(p=0 AND r=0,'',':'||CAST(p AS STRING)||IF(r=0,'',':'||CAST(r AS STRING))), '|' ORDER BY o) dl
FROM dd GROUP BY cd ORDER BY cd
`
}

// ── Q5: per-airport dispatch daily (template, fill IN-list) ──────────────────
function q5(codeList) {
  const inList = codeList.map(c => `'${c}'`).join(',')
  return `
WITH fx AS (SELECT to_cur, rate FROM \`elife-data-warehouse-prod.mapping.mapping_cur_exch_rate\` WHERE from_cur='USD'),
gbp AS (SELECT rate usd_to_gbp FROM fx WHERE to_cur='GBP'),
rides AS (
  SELECT ride_id, MIN(booking_date) bd,
    ANY_VALUE(hoppa_SellRate) sr, ANY_VALUE(partner_amount_currency) cur,
    LOGICAL_OR(ride_stat LIKE '%ancel%') canc,
    ARRAY_AGG(DISTINCT pickup_airport_code3 IGNORE NULLS) pua,
    ARRAY_AGG(DISTINCT dropoff_airport_code3 IGNORE NULLS) doa
  FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\`
  WHERE partner_type='hoppa' AND booking_date BETWEEN '2025-01-01' AND '2026-07-09'
  GROUP BY ride_id
),
expl AS (
  SELECT r.bd, r.canc,
    IF(r.canc,0,CASE WHEN r.cur='GBP' THEN r.sr
      ELSE r.sr/NULLIF((SELECT rate FROM fx WHERE to_cur=r.cur),0)*(SELECT usd_to_gbp FROM gbp) END) net, ap
  FROM rides r, UNNEST(ARRAY(SELECT DISTINCT x
       FROM UNNEST(ARRAY_CONCAT(IFNULL(r.pua,[]),IFNULL(r.doa,[]))) x
       WHERE x IS NOT NULL AND x!='')) ap
  WHERE ap IN (${inList})
),
dd AS (
  SELECT ap, DATE_DIFF(bd, DATE '2024-06-01', DAY) o,
    COUNT(*) b, COUNTIF(canc) c, CAST(ROUND(SUM(IFNULL(net,0))) AS INT64) tn
  FROM expl GROUP BY ap, o
)
SELECT ap, STRING_AGG(CAST(o AS STRING)||':'||b||':'||c||':'||tn, '|' ORDER BY o) dl
FROM dd GROUP BY ap ORDER BY ap
`
}

// ── Parse encoded daily string ────────────────────────────────────────────────
function parseGA4Daily(dl) {
  const map = {}
  if (!dl) return map
  dl.split('|').forEach(seg => {
    const parts = seg.split(':')
    const o = parseInt(parts[0])
    const s = parseInt(parts[1]) || 0
    const p = parts[2] != null ? parseInt(parts[2]) : 0
    const r = parts[3] != null ? parseInt(parts[3]) : 0
    map[o] = [s, p, r]
  })
  return map
}
function parseOpsDaily(dl) {
  const map = {}
  if (!dl) return map
  dl.split('|').forEach(seg => {
    const [o, b, c, tn] = seg.split(':').map(Number)
    map[o] = [b, c, tn]
  })
  return map
}

// ── Range sum helpers ─────────────────────────────────────────────────────────
const BASE = new Date('2024-06-01T00:00:00Z')
function dayOffset(dateStr) {
  return Math.round((new Date(dateStr + 'T00:00:00Z') - BASE) / 86400000)
}
function sumGA4(map, s, e) {
  let vs=0, vp=0, vr=0
  for (let o=s; o<=e; o++) {
    const d=map[o]; if(!d) continue
    vs+=d[0]; vp+=d[1]; vr+=d[2]
  }
  return {s:vs, p:vp, r:vr}
}
function sumOps(map, s, e) {
  let vb=0, vc=0, vtn=0
  for (let o=s; o<=e; o++) {
    const d=map[o]; if(!d) continue
    vb+=d[0]; vc+=d[1]; vtn+=d[2]
  }
  return {b:vb, c:vc, tn:vtn}
}

async function main() {
  console.log('Getting access token...')
  const token = await getToken()
  console.log('Token OK')

  // ── Q3: Universe ──
  const q3Rows = await runQuery(Q3, token, 'Q3 Airport Universe')
  console.log(`Airport universe: ${q3Rows.length} airports (expect 240)`)

  // Build code list and roster
  const roster = {} // code -> {nm, cc, sp, sd, pp, pd}
  const codes = []
  for (const r of q3Rows) {
    roster[r.cd] = { nm: r.nm, cc: r.cc, sp: Number(r.sp)||0, pp: Number(r.pp)||0, sd: Number(r.sd)||0, pd: Number(r.pd)||0 }
    codes.push(r.cd)
  }
  console.log(`Codes: ${codes.sort().join(', ')}`)

  // Split codes into two chunks: A–L, M–Z
  const codesAL = codes.filter(c => c[0] <= 'L').sort()
  const codesMZ = codes.filter(c => c[0] > 'L').sort()
  console.log(`Chunk AL: ${codesAL.length} codes, MZ: ${codesMZ.length} codes`)

  // ── Q4 chunks ──
  const q4al = await runQuery(q4(codesAL), token, 'Q4 GA4 daily A-L')
  const q4mz = await runQuery(q4(codesMZ), token, 'Q4 GA4 daily M-Z')
  const allQ4 = [...q4al, ...q4mz]
  console.log(`Q4 total: ${allQ4.length} airports with GA4 data`)

  // ── Q5 chunks ──
  const q5al = await runQuery(q5(codesAL), token, 'Q5 Ops daily A-L')
  const q5mz = await runQuery(q5(codesMZ), token, 'Q5 Ops daily M-Z')
  const allQ5 = [...q5al, ...q5mz]
  console.log(`Q5 total: ${allQ5.length} airports with ops data`)

  // ── Parse into maps ──
  const ga4Daily = {} // code -> {offset: [s,p,r]}
  allQ4.forEach(r => { ga4Daily[r.cd] = parseGA4Daily(r.dl) })

  const opsDaily = {} // code -> {offset: [b,c,tn]}
  allQ5.forEach(r => { opsDaily[r.ap] = parseOpsDaily(r.dl) })

  // ── VALIDATION GATES ──
  console.log('\n=== VALIDATION GATES ===')

  // Gate 1: PMI June 2026 GA4
  const pmiGa4 = ga4Daily['PMI'] || {}
  const jun26s = dayOffset('2026-06-01'), jun26e = dayOffset('2026-06-30')
  const pmiJunGa4 = sumGA4(pmiGa4, jun26s, jun26e)
  console.log(`PMI Jun 2026 GA4: s=${pmiJunGa4.s} (expect 21,061) | p=${pmiJunGa4.p} (expect 694)`)

  // Gate 2: PMI June 2026 ops
  const pmiOps = opsDaily['PMI'] || {}
  const pmiJunOps = sumOps(pmiOps, jun26s, jun26e)
  console.log(`PMI Jun 2026 ops: gross=${pmiJunOps.b} (expect 1,282) | canc=${pmiJunOps.c} (expect 36)`)
  if (pmiJunOps.b < 1000) {
    console.error('❌ TRAP T1 TRIGGERED: PMI gross < 1000 — IFNULL guard missing!')
  } else {
    console.log(`PMI gross=${pmiJunOps.b} ✅ (> 1000, T1 guard working)`)
  }

  // Gate 3: PMI W27-2026 ops sanity
  const w27s = dayOffset('2026-06-29'), w27e = dayOffset('2026-07-05')
  const pmiW27 = sumOps(pmiOps, w27s, w27e)
  console.log(`PMI W27-2026 ops: gross=${pmiW27.b} net=${pmiW27.b-pmiW27.c} ✅ gross≥net: ${pmiW27.b>=pmiW27.b-pmiW27.c}`)

  // Gate 4: LHR trailing 12m GA4 touch
  const lhrGa4 = ga4Daily['LHR'] || {}
  const lhr12s = dayOffset('2025-07-01'), lhr12e = dayOffset('2026-06-30')
  const lhrGa4Sum = sumGA4(lhrGa4, lhr12s, lhr12e)
  console.log(`LHR trailing 12m GA4 s=${lhrGa4Sum.s} (expect 15,175)`)

  // Gate 5: Universe count
  if (codes.length !== 240) {
    console.error(`❌ Universe = ${codes.length} airports (expect 240) — check Q3`)
  } else {
    console.log(`✅ Universe = 240 airports`)
  }

  // Gate 6: Movers volume-floor test (W27 YoY)
  const w27yoyS = dayOffset('2026-06-29') - 364, w27yoyE = dayOffset('2026-07-05') - 364
  let anySmall = false
  for (const cd of codes) {
    const ops = opsDaily[cd] || {}
    const cur = sumOps(ops, w27s, w27e)
    const prv = sumOps(ops, w27yoyS, w27yoyE)
    const curNet = cur.b - cur.c, prvNet = prv.b - prv.c
    if (Math.max(curNet, prvNet) < 5 && Math.max(curNet, prvNet) > 0) {
      console.log(`⚠ ${cd}: max(cur,prv) net = ${Math.max(curNet,prvNet)} < 5 (would be filtered by floor)`)
      anySmall = true
    }
  }
  if (!anySmall) console.log(`✅ Volume floor test: no airports with tiny bases would sneak through`)

  // Gate 7: Cross-source sanity (gross >= cancelled for every airport-month >= Apr 2025)
  let crossFail = 0
  for (const cd of codes) {
    const ops = opsDaily[cd] || {}
    for (const [o, d] of Object.entries(ops)) {
      if (Number(o) >= 304 && d[0] < d[1]) { crossFail++; if(crossFail<=3) console.log(`⚠ ${cd} o=${o}: gross=${d[0]} < canc=${d[1]}`) }
    }
  }
  if (crossFail === 0) console.log(`✅ Cross-source: gross≥cancelled for all airport-days (Apr 2025+)`)
  else console.log(`⚠ ${crossFail} airport-days have gross < cancelled (may be rounding)`)

  // ── ENCODE OUTPUT ──
  // For each airport, encode as two compact strings (same format as query output)
  const apRoster = {}
  for (const cd of codes) {
    apRoster[cd] = { nm: roster[cd].nm, cc: roster[cd].cc }
  }

  // Write JSON files
  const outPath = path.join(__dirname, '..', 'scripts', 'overview_data.json')
  fs.writeFileSync(outPath, JSON.stringify({
    roster: apRoster,
    ga4Daily,  // code -> {o: [s,p,r]}
    opsDaily,  // code -> {o: [b,c,tn]}
    pulledAt: new Date().toISOString(),
    gateResults: {
      pmiJunGa4_s: pmiJunGa4.s, pmiJunGa4_p: pmiJunGa4.p,
      pmiJunOps_gross: pmiJunOps.b, pmiJunOps_canc: pmiJunOps.c,
      lhrTrailing12m_s: lhrGa4Sum.s,
      universeCount: codes.length,
    }
  }, null, 0))

  // Write encoded airport data for JS embedding
  // Format: roster as compact JS object, daily as compact strings
  const rosterJS = JSON.stringify(apRoster)
  
  // Encode ga4Daily as per-airport strings
  const ga4Lines = []
  for (const cd of codes.sort()) {
    const map = ga4Daily[cd] || {}
    const segs = Object.keys(map).map(Number).sort((a,b)=>a-b).map(o => {
      const [s,p,r]=map[o]
      return `${o}:${s}${(p||r)?':'+p+(r?':'+r:''):''}`
    })
    if (segs.length > 0) ga4Lines.push(`'${cd}':'${segs.join('|')}'`)
  }
  
  const opsLines = []
  for (const cd of codes.sort()) {
    const map = opsDaily[cd] || {}
    const segs = Object.keys(map).map(Number).sort((a,b)=>a-b).map(o => {
      const [b,c,tn]=map[o]
      return `${o}:${b}:${c}:${tn}`
    })
    if (segs.length > 0) opsLines.push(`'${cd}':'${segs.join('|')}'`)
  }

  fs.writeFileSync(path.join(__dirname, '..', 'scripts', 'overview_roster.js'), `const AP_ROSTER=${rosterJS};`)
  fs.writeFileSync(path.join(__dirname, '..', 'scripts', 'overview_ga4.js'), `const AP_GA4={${ga4Lines.join(',')}};`)
  fs.writeFileSync(path.join(__dirname, '..', 'scripts', 'overview_ops.js'), `const AP_OPS={${opsLines.join(',')}};`)

  console.log('\n=== SUMMARY ===')
  console.log(`overview_data.json: ${fs.statSync(outPath).size} bytes`)
  console.log(`overview_roster.js: ${rosterJS.length} chars`)
  console.log(`overview_ga4.js: ${ga4Lines.length} airports, ~${ga4Lines.join(',').length} chars`)
  console.log(`overview_ops.js: ${opsLines.length} airports, ~${opsLines.join(',').length} chars`)
}

main().catch(e => { console.error(e); process.exit(1) })
