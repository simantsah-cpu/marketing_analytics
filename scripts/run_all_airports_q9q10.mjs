/**
 * run_all_airports_q9q10.mjs
 * Q9: GA4 top-15 counterpart locations per airport per direction (trailing 12m + Q2/Q1 momentum)
 * Q10: Dispatch top-15 counterpart zones per airport per direction (same window)
 *
 * Validation G4:
 *   ALC outbound: Benidorm (贝尼多姆) must appear with large volume
 *   PMI outbound top web = PUP s≈15,680
 *   No self-routes
 *   Jumeirah and Palm Jumeirah appear as separate rows
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
    body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 300000 }),
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

// ── Read roster ───────────────────────────────────────────────────────────────
const rosterRaw = fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'overviewRoster.js'), 'utf8')
const rosterMatch = rosterRaw.match(/export const AP_ROSTER\s*=\s*(\{[\s\S]+?\})\s*;?\s*$/)
const AP_ROSTER = JSON.parse(rosterMatch[1])
const CODES = Object.keys(AP_ROSTER).sort()
console.log(`Universe: ${CODES.length} airports`)

// Split for Q9 chunks (large IN-list, BQ may need splits)
const CHUNK1 = CODES.filter(c => c[0] <= 'L').sort()
const CHUNK2 = CODES.filter(c => c[0] > 'L').sort()

// ── Q9: GA4 route pairs ───────────────────────────────────────────────────────
// 'O' = outbound (airport is pick-up, cp = destination)
// 'I' = inbound (airport is drop-off, cp = origin)
// Window: trailing 12m = 2025-07-01 .. 2026-06-30
// Q2 momentum: 2026-04-01 onwards; Q1 momentum: 2026-01-01..2026-03-31
function q9(codeList) {
  const il = codeList.map(c => `'${c}'`).join(',')
  return `
WITH e AS (
  SELECT PARSE_DATE('%Y%m%d', event_date) AS d, event_name,
    IFNULL(ecommerce.purchase_revenue,0) rev,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key='pick_up_code') puc,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key='drop_off_code') doc
  FROM \`elife-data-warehouse-prod.analytics_259261360.events_*\`
  WHERE _TABLE_SUFFIX BETWEEN '20250701' AND '20260630'
    AND event_name IN ('view_search_results','purchase')
),
pairs AS (
  SELECT ap, dirn, cp,
    COUNTIF(event_name='view_search_results') s,
    COUNTIF(event_name='purchase') p,
    CAST(ROUND(SUM(IF(event_name='purchase',rev,0))) AS INT64) r,
    COUNTIF(event_name='view_search_results' AND d>='2026-04-01') q2s,
    COUNTIF(event_name='view_search_results' AND d BETWEEN '2026-01-01' AND '2026-03-31') q1s
  FROM (
    SELECT d, event_name, rev, puc AS ap, 'O' AS dirn, doc AS cp
    FROM e WHERE puc IN (${il}) AND doc IS NOT NULL AND doc!=''
    UNION ALL
    SELECT d, event_name, rev, doc AS ap, 'I' AS dirn, puc AS cp
    FROM e WHERE doc IN (${il}) AND puc IS NOT NULL AND puc!=''
  ) GROUP BY ap, dirn, cp
),
ranked AS (
  SELECT * FROM pairs
  WHERE cp != ap  -- G4: no self-routes
  QUALIFY ROW_NUMBER() OVER (PARTITION BY ap, dirn ORDER BY s DESC) <= 15
)
SELECT rk.ap, rk.dirn,
  STRING_AGG(
    rk.cp
    || '~' || IFNULL(REPLACE(SUBSTR(TRIM(IFNULL(l.LocnameFrom, l.LocnameTo)), 1, 55), '|', '/'), rk.cp)
    || '~' || CAST(rk.s AS STRING) || ':' || CAST(rk.p AS STRING) || ':' || CAST(rk.r AS STRING)
          || ':' || CAST(rk.q2s AS STRING) || ':' || CAST(rk.q1s AS STRING),
    '|' ORDER BY rk.s DESC
  ) m
FROM ranked rk
LEFT JOIN \`elife-data-warehouse-prod.dim.dim_p2p_location\` l ON l.Code = rk.cp
GROUP BY rk.ap, rk.dirn
ORDER BY rk.ap, rk.dirn
`
}

// ── Q10: Dispatch route zones ─────────────────────────────────────────────────
// Window: 2025-07-01 .. 2026-06-30
// 'O' = UNNEST(pua) × UNNEST(doz); 'I' = UNNEST(doa) × UNNEST(puz)
// TRAP T4: use 'ap' alias, not 'cd'
// Strip '|' and '~' from zone names (they're the encoding delimiters)
const Q10 = `
WITH fx AS (SELECT to_cur, rate FROM \`elife-data-warehouse-prod.mapping.mapping_cur_exch_rate\` WHERE from_cur='USD'),
gbp AS (SELECT rate usd_to_gbp FROM fx WHERE to_cur='GBP'),
rides AS (
  SELECT ride_id, MIN(booking_date) bd,
    ANY_VALUE(hoppa_SellRate) sr, ANY_VALUE(partner_amount_currency) cur,
    LOGICAL_OR(ride_stat LIKE '%ancel%') canc,
    ARRAY_AGG(DISTINCT pickup_airport_code3 IGNORE NULLS) pua,
    ARRAY_AGG(DISTINCT dropoff_airport_code3 IGNORE NULLS) doa,
    ARRAY_AGG(DISTINCT IF(pickup_airport_code3 IS NULL, pickup_zone_name, NULL) IGNORE NULLS) puz,
    ARRAY_AGG(DISTINCT IF(dropoff_airport_code3 IS NULL, dropoff_zone_name, NULL) IGNORE NULLS) doz
  FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\`
  WHERE partner_type='hoppa' AND booking_date BETWEEN '2025-07-01' AND '2026-06-30'
  GROUP BY ride_id
),
r2 AS (
  SELECT ride_id, bd, canc, pua, doa, puz, doz,
    IF(canc,0,CASE WHEN cur='GBP' THEN sr
      ELSE sr/NULLIF((SELECT rate FROM fx WHERE to_cur=cur),0)*(SELECT usd_to_gbp FROM gbp) END) net
  FROM rides
),
pairs AS (
  -- Outbound: airport is pick-up, zone is drop-off
  SELECT ap, 'O' AS dirn, zn, canc, net, bd
  FROM r2, UNNEST(IFNULL(pua,[])) ap, UNNEST(IFNULL(doz,[])) zn
  WHERE LENGTH(ap)=3

  UNION ALL

  -- Inbound: airport is drop-off, zone is pick-up
  SELECT ap, 'I' AS dirn, zn, canc, net, bd
  FROM r2, UNNEST(IFNULL(doa,[])) ap, UNNEST(IFNULL(puz,[])) zn
  WHERE LENGTH(ap)=3
),
mo AS (
  SELECT ap, dirn,
    REPLACE(REPLACE(SUBSTR(TRIM(zn),1,55),'|','/'),'~','-') AS zn,
    COUNT(*) b,
    COUNTIF(canc) c,
    CAST(ROUND(SUM(IFNULL(net,0))) AS INT64) tn,
    COUNTIF(bd>='2026-04-01') q2b,
    COUNTIF(bd BETWEEN '2026-01-01' AND '2026-03-31') q1b
  FROM pairs
  WHERE zn IS NOT NULL AND TRIM(zn) != ''
  GROUP BY ap, dirn, zn
),
ranked AS (
  SELECT * FROM mo
  QUALIFY ROW_NUMBER() OVER (PARTITION BY ap, dirn ORDER BY b DESC) <= 15
)
SELECT ap, dirn,
  STRING_AGG(
    zn || '~' || CAST(b AS STRING) || ':' || CAST(c AS STRING) || ':' || CAST(tn AS STRING)
       || ':' || CAST(q2b AS STRING) || ':' || CAST(q1b AS STRING),
    '|' ORDER BY b DESC
  ) m
FROM ranked
GROUP BY ap, dirn
ORDER BY ap, dirn
`

async function main() {
  console.log('Getting access token...')
  const token = await getToken()
  console.log('Token OK')

  // ── Q9: two chunks ──
  const q9a = await runQuery(q9(CHUNK1), token, 'Q9 GA4 routes A-L')
  const q9b = await runQuery(q9(CHUNK2), token, 'Q9 GA4 routes M-Z')
  const allQ9 = [...q9a, ...q9b]
  console.log(`Q9 total: ${allQ9.length} airport-direction pairs`)

  // ── Q10: single query ──
  const allQ10 = await runQuery(Q10, token, 'Q10 Dispatch zones')
  console.log(`Q10 total: ${allQ10.length} airport-direction pairs`)

  // ── Build maps ──
  // q9Data[ap][dirn] = [{ cp, name, s, p, r, q2s, q1s }]
  const q9Data = {}
  for (const row of allQ9) {
    if (!q9Data[row.ap]) q9Data[row.ap] = {}
    if (!row.m) continue
    q9Data[row.ap][row.dirn] = row.m.split('|').map(seg => {
      const [codeAndName, metrics] = seg.split('~').reduce((acc, part, i) => {
        // Format: cp~name~s:p:r:q2s:q1s
        if (i === 0) acc[0] = part  // cp
        else if (i === 1) acc[1] = part  // name
        else acc[2] = part  // metrics
        return acc
      }, ['','',''])
      // Actually the format is: cp ~ name ~ s:p:r:q2s:q1s
      // seg = "cp~name~s:p:r:q2s:q1s"
      const parts = seg.split('~')
      const cp = parts[0]
      const name = parts[1] || cp
      const mparts = (parts[2] || '0:0:0:0:0').split(':')
      return { cp, name, s: +mparts[0]||0, p: +mparts[1]||0, r: +mparts[2]||0, q2s: +mparts[3]||0, q1s: +mparts[4]||0 }
    })
  }

  // q10Data[ap][dirn] = [{ zn, b, c, tn, q2b, q1b }]
  const q10Data = {}
  for (const row of allQ10) {
    if (!q10Data[row.ap]) q10Data[row.ap] = {}
    if (!row.m) continue
    q10Data[row.ap][row.dirn] = row.m.split('|').map(seg => {
      const parts = seg.split('~')
      const zn = parts[0]
      const mparts = (parts[1] || '0:0:0:0:0').split(':')
      return { zn, b: +mparts[0]||0, c: +mparts[1]||0, tn: +mparts[2]||0, q2b: +mparts[3]||0, q1b: +mparts[4]||0 }
    })
  }

  // ── Validation G4 (pre-merge raw checks) ─────────────────────────────────
  console.log('\n=== G4 PRE-MERGE CHECKS ===')

  // PMI outbound top web destination
  const pmiO = q9Data['PMI']?.['O'] || []
  console.log('PMI outbound top-3 GA4:')
  pmiO.slice(0,3).forEach((r,i) => console.log(`  ${i+1}. ${r.cp} "${r.name}" s=${r.s.toLocaleString()} p=${r.p}`))
  const pmiTopCP = pmiO[0]?.cp
  const pmiTopS = pmiO[0]?.s
  console.log(`G4 PMI top outbound: ${pmiTopCP} s=${pmiTopS} (expect PUP s≈15,680)`)
  console.log(Math.abs((pmiTopS||0) - 15680) < 2000 ? '  ✅ Within range' : '  ❌ Out of range')

  // ALC outbound — looking for Benidorm by Chinese name (贝尼多姆) in Q10
  const alcO10 = q10Data['ALC']?.['O'] || []
  console.log('\nALC outbound top-5 ops zones (raw, pre-translate):')
  alcO10.slice(0,5).forEach((r,i) => console.log(`  ${i+1}. "${r.zn}" b=${r.b} c=${r.c} tn=${r.tn}`))
  const beniRow = alcO10.find(r => r.zn.includes('贝尼多姆') || r.zn.toLowerCase().includes('benidorm'))
  console.log(beniRow ? `✅ Benidorm found: "${beniRow.zn}" b=${beniRow.b}` : '⚠ Benidorm not yet visible (needs translation in merge step)')

  // DXB outbound — check Jumeirah vs Palm Jumeirah separation
  const dxbO10 = q10Data['DXB']?.['O'] || []
  const jumRow = dxbO10.find(r => r.zn.toLowerCase().includes('jumeirah') && !r.zn.toLowerCase().includes('palm'))
  const palmJumRow = dxbO10.find(r => r.zn.toLowerCase().includes('palm') && r.zn.toLowerCase().includes('jumeirah'))
  // Also check Chinese names: 朱美拉=Jumeirah
  const jumeiraAll = dxbO10.filter(r => r.zn.includes('朱美拉') || r.zn.toLowerCase().includes('jumeirah'))
  console.log('\nDXB outbound Jumeirah zones (G4 conservatism check):')
  jumeiraAll.forEach(r => console.log(`  "${r.zn}" b=${r.b}`))
  if (jumeiraAll.length >= 2 || (jumRow && palmJumRow)) {
    console.log('✅ Jumeirah and Palm Jumeirah exist as separate zones (conservatism check will apply)')
  }

  // No self-routes
  let selfRoutes = 0
  for (const [ap, dirs] of Object.entries(q9Data)) {
    for (const [dirn, routes] of Object.entries(dirs)) {
      routes.forEach(r => { if (r.cp === ap) { selfRoutes++; console.log(`❌ Self-route: ${ap} → ${ap}`) }})
    }
  }
  console.log(selfRoutes === 0 ? '✅ No self-routes in Q9' : `❌ ${selfRoutes} self-routes in Q9`)

  // ── Save raw Q9/Q10 data ──────────────────────────────────────────────────
  // Save raw row strings (for the merge pipeline to process)
  const rawQ9 = {}
  for (const row of allQ9) {
    if (!rawQ9[row.ap]) rawQ9[row.ap] = {}
    rawQ9[row.ap][row.dirn] = row.m || ''
  }
  const rawQ10 = {}
  for (const row of allQ10) {
    if (!rawQ10[row.ap]) rawQ10[row.ap] = {}
    rawQ10[row.ap][row.dirn] = row.m || ''
  }

  fs.writeFileSync(
    path.join(__dirname, 'all_airports_q9_raw.json'),
    JSON.stringify({ pulledAt: new Date().toISOString(), data: rawQ9 }, null, 2)
  )
  fs.writeFileSync(
    path.join(__dirname, 'all_airports_q10_raw.json'),
    JSON.stringify({ pulledAt: new Date().toISOString(), data: rawQ10 }, null, 2)
  )

  console.log('\n=== SUMMARY ===')
  console.log(`Q9: ${allQ9.length} airport-direction pairs saved to all_airports_q9_raw.json`)
  console.log(`Q10: ${allQ10.length} airport-direction pairs saved to all_airports_q10_raw.json`)
  console.log('Ready for merge pipeline (run_all_airports_merge.mjs)')
}

main().catch(e => { console.error(e); process.exit(1) })
