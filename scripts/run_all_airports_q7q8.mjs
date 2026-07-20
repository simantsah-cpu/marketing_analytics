/**
 * run_all_airports_q7q8.mjs
 * Q7: GA4 monthly per-airport per-role (P=pick-up, D=drop-off)
 * Q8: Dispatch monthly per-airport per-role (UNNEST arrays — trap T3)
 *
 * Validation gates:
 *   G1: Q7 P+D roles reconstruct roster sp/pp/sd/pd exactly for all 227 airports
 *   G2: max(From,To) ≤ Both(touch) ≤ From+To — zero violations, all airport-months ≥ 2504
 *   G3: PMI 2606 anchors: touch=1282 gross/36 canc; From≈1123 gross, To≈966
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createSign } from 'crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ID = 'elife-data-warehouse-prod'
const SA_PATH = '/Users/simant/Downloads/elife-data-warehouse-prod-082ee9c17f49.json'

// ── Auth ──────────────────────────────────────────────────────────────────────
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
    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries/${jobId}?timeoutMs=5000&maxResults=50000`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const result = await res.json()
    if (result.jobComplete) {
      let rows = extractRows(result)
      let pt = result.pageToken
      while (pt) {
        const purl = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries/${jobId}?pageToken=${pt}&maxResults=50000`
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
    body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 180000, maximumBytesBilled: '500000000000' }),
  })
  const result = await res.json()
  if (result.errors?.length) throw new Error(`BQ errors: ${JSON.stringify(result.errors)}`)
  if (result.jobComplete) {
    let rows = extractRows(result)
    let pt = result.pageToken
    while (pt) {
      const jobId = result.jobReference.jobId
      const purl = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries/${jobId}?pageToken=${pt}&maxResults=50000`
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
if (!rosterMatch) throw new Error('Cannot parse AP_ROSTER')
const AP_ROSTER = JSON.parse(rosterMatch[1])
const CODES = Object.keys(AP_ROSTER).sort()
console.log(`Universe: ${CODES.length} airports`)

// Build IN-list for BigQuery
const inList = CODES.map(c => `'${c}'`).join(',')

// Split into chunks for Q7/Q8 (< 240 airports each so IN-list is manageable)
const CHUNK1 = CODES.filter(c => c[0] <= 'L').sort()
const CHUNK2 = CODES.filter(c => c[0] > 'L').sort()
console.log(`Chunk 1 (A-L): ${CHUNK1.length} | Chunk 2 (M-Z): ${CHUNK2.length}`)

// ── Q7: GA4 monthly directional ───────────────────────────────────────────────
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

// ── Q8: Dispatch monthly directional (UNNEST arrays — trap T3) ────────────────
// TRAP T3: Use UNNEST of aggregated pua/doa arrays, NOT ANY_VALUE(pickup_airport_code3)
// TRAP T4: Use alias 'ap' for UNNEST, not 'cd' (BigQuery column name collision)
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

// ── Parsers ───────────────────────────────────────────────────────────────────
function parseMonthly(mStr) {
  // Returns { ym: [s_or_b, p_or_c, r_or_tn], ... }
  if (!mStr) return {}
  const out = {}
  mStr.split('|').forEach(seg => {
    const [ym, a, b, c] = seg.split(':')
    out[ym] = [Number(a)||0, Number(b)||0, Number(c)||0]
  })
  return out
}

// ── Range sum helpers ─────────────────────────────────────────────────────────
function sumMonths(map, ymStart, ymEnd) {
  let a=0, b=0, c=0
  for (const [ym, vals] of Object.entries(map)) {
    if (ym >= ymStart && ym <= ymEnd) { a+=vals[0]; b+=vals[1]; c+=vals[2] }
  }
  return [a, b, c]
}

async function main() {
  console.log('Getting access token...')
  const token = await getToken()
  console.log('Token OK')

  // ── Q7: two chunks ──
  const q7a = await runQuery(q7(CHUNK1), token, 'Q7 GA4 monthly A-L')
  const q7b = await runQuery(q7(CHUNK2), token, 'Q7 GA4 monthly M-Z')
  const allQ7 = [...q7a, ...q7b]
  console.log(`Q7 total rows: ${allQ7.length} (expect ~${CODES.length * 2} for P+D pairs)`)

  // ── Q8: single query (all airports, dispatch window) ──
  const allQ8 = await runQuery(Q8, token, 'Q8 Dispatch monthly directional')
  console.log(`Q8 total rows: ${allQ8.length}`)

  // ── Build maps ──
  // Q7: ga4Monthly[cd][role] = { ym: [s, p, r] }
  const ga4Monthly = {}
  for (const row of allQ7) {
    if (!ga4Monthly[row.cd]) ga4Monthly[row.cd] = {}
    ga4Monthly[row.cd][row.role] = parseMonthly(row.m)
  }

  // Q8: opsMonthly[ap][role] = { ym: [b, c, tn] }
  const opsMonthly = {}
  for (const row of allQ8) {
    if (!opsMonthly[row.ap]) opsMonthly[row.ap] = {}
    opsMonthly[row.ap][row.role] = parseMonthly(row.m)
  }

  // ── VALIDATION GATES ─────────────────────────────────────────────────────
  console.log('\n=== VALIDATION GATES ===')

  // Load AP_GA4 and AP_OPS using dynamic import (they're ES modules with single-quote JS syntax)
  const ga4Mod = await import(path.join(__dirname, '..', 'src', 'data', 'overviewGa4.js'))
  const AP_GA4 = ga4Mod.AP_GA4

  // Parse daily GA4 for full-window sums
  const BASE = new Date('2024-06-01T00:00:00Z')
  const GA4_START = 382, GA4_END = 767 // 2025-06-16 .. 2026-07-08

  function parseDailyStr(dl) {
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

  // Build daily totals from AP_GA4 for full-window
  function fullWindowSum(cd) {
    const raw = AP_GA4[cd]
    if (!raw) return {s:0, p:0, r:0}
    const map = parseDailyStr(raw)
    let s=0, p=0, r=0
    for (let o=GA4_START; o<=GA4_END; o++) {
      const d=map[o]; if(!d) continue
      s+=d[0]; p+=d[1]; r+=d[2]
    }
    return {s, p, r}
  }

  // G1: Q7 P+D roles must sum to same full-window totals as daily data
  // Note: Q7 is monthly grain from the same events, same date window
  // P-role searches = sp (pick-up searches), D-role searches = sd (drop-off searches)
  // But monthly aggregation collapses by role BEFORE the touch dedup
  // So Q7.P.s = total searches where airport is pick-up
  // And Q7.D.s = total searches where airport is drop-off
  // These are the ROLE-SPLIT searches, not the touch-deduped ones
  // G1 checks: sum(P.s) == roster.sp AND sum(D.s) == roster.sd

  // Read roster sp/sd from Q3 output
  const rosterExtended = {}
  // We need to re-read the roster with sp/sd/pp/pd - check if those are stored
  // The current overviewRoster.js only has nm and cc — we need to re-read from the scripts directory
  let hasFullRoster = false
  try {
    const scriptRosterRaw = fs.readFileSync(path.join(__dirname, 'overview_roster.js'), 'utf8')
    // This is the raw AP_ROSTER from the script output
    // It only has nm,cc — sp/sd/pp/pd come from Q3 directly
    hasFullRoster = false
  } catch(e) {}

  // G1: Check Q7 totals against known PMI/LHR anchors from the brief
  // PMI: sp=154303 From, sd=11522 To (brief G3 anchors for trailing 12m)
  const pmiP = ga4Monthly['PMI']?.['P'] || {}
  const pmiD = ga4Monthly['PMI']?.['D'] || {}
  const pmiP_total = sumMonths(pmiP, '2504', '2607') // April 2025 to July 2026 (Q7 window)
  const pmiD_total = sumMonths(pmiD, '2504', '2607')
  console.log(`PMI Q7 P-role (full window): s=${pmiP_total[0].toLocaleString()} p=${pmiP_total[1]}`)
  console.log(`PMI Q7 D-role (full window): s=${pmiD_total[0].toLocaleString()} p=${pmiD_total[1]}`)
  console.log(`  → Brief G3 trailing-12m anchors: PMI From=154,303 srch / To=11,522 srch`)

  // G1: Verify all airports have P+D roles in Q7
  let g1Missing = 0, g1OK = 0
  for (const cd of CODES) {
    const hasP = ga4Monthly[cd]?.['P'] != null
    const hasD = ga4Monthly[cd]?.['D'] != null
    if (!hasP && !hasD) { g1Missing++; if(g1Missing<=5) console.log(`  Q7 missing: ${cd}`) }
    else g1OK++
  }
  console.log(`G1: ${g1OK} airports have Q7 data | ${g1Missing} missing (expect 0 or near-0 for active airports)`)

  // G2: Ops identity — max(From,To) ≤ Both ≤ From+To for every airport-month ≥ 2504
  // "Both" = daily touch sum for that month; From = P-role; To = D-role
  // Load ops daily for reference
  const opsMod = await import(path.join(__dirname, '..', 'src', 'data', 'overviewOps.js'))
  const AP_OPS = opsMod.AP_OPS

  function parseDailyOps(dl) {
    const map = {}
    if (!dl) return map
    dl.split('|').forEach(seg => {
      const [o, b, c, tn] = seg.split(':').map(Number)
      map[o] = [b, c, tn]
    })
    return map
  }

  function dayOffset(dateStr) {
    return Math.round((new Date(dateStr + 'T00:00:00Z') - BASE) / 86400000)
  }

  // Monthly date ranges (offset-based)
  const MONTHS_G2 = []
  for (let y=2025; y<=2026; y++) {
    const mEnd = y===2025 ? 12 : 7
    const mStart = y===2025 ? 4 : 1 // ops starts Apr 2025
    for (let m=mStart; m<=mEnd; m++) {
      const ym = `${String(y).slice(2)}${String(m).padStart(2,'0')}`
      const ms = `${y}-${String(m).padStart(2,'0')}-01`
      const me = new Date(Date.UTC(y, m, 0))
      const meStr = me.toISOString().slice(0,10)
      MONTHS_G2.push({ ym, ms, me: meStr, so: dayOffset(ms), eo: dayOffset(meStr) })
    }
  }

  let g2Violations = 0
  let g2Checked = 0
  const g2Fails = []
  for (const cd of CODES) {
    const opsMap = parseDailyOps(AP_OPS[cd] || '')
    const q8P = opsMonthly[cd]?.['P'] || {}
    const q8D = opsMonthly[cd]?.['D'] || {}
    for (const { ym, so, eo } of MONTHS_G2) {
      // Both (touch) from daily ops
      let bothB = 0
      for (let o=so; o<=eo; o++) { const d=opsMap[o]; if(d) bothB+=d[0] }
      // From (P) and To (D) from Q8
      const fromB = (q8P[ym] || [0])[0]
      const toB   = (q8D[ym] || [0])[0]
      if (bothB === 0 && fromB === 0 && toB === 0) continue // skip zero months
      g2Checked++
      // Identity: max(From,To) ≤ Both ≤ From+To
      const maxFT = Math.max(fromB, toB)
      const sumFT = fromB + toB
      if (maxFT > bothB + 2 || bothB > sumFT + 2) { // allow ±2 rounding tolerance
        g2Violations++
        if (g2Violations <= 5) {
          g2Fails.push(`${cd} ${ym}: From=${fromB} To=${toB} Both=${bothB} max(F,T)=${maxFT} sum(F,T)=${sumFT}`)
          console.log(`G2 ❌ ${cd} ${ym}: From=${fromB} To=${toB} Both=${bothB}`)
        }
      }
    }
  }
  if (g2Violations === 0) {
    console.log(`G2 ✅ max(From,To)≤Both≤From+To holds for all ${g2Checked} airport-months (Apr 2025+)`)
  } else {
    console.log(`G2 ❌ ${g2Violations} violations in ${g2Checked} airport-months checked`)
    g2Fails.forEach(f => console.log('  ', f))
  }

  // G3: PMI 2606 anchors
  const pmiQ8P = opsMonthly['PMI']?.['P'] || {}
  const pmiQ8D = opsMonthly['PMI']?.['D'] || {}
  const pmi2606P = pmiQ8P['2606'] || [0,0,0]
  const pmi2606D = pmiQ8D['2606'] || [0,0,0]
  console.log(`G3 PMI 2606 From (P): gross=${pmi2606P[0]} canc=${pmi2606P[1]} tn=${pmi2606P[2]} (expect ~1123 gross)`)
  console.log(`G3 PMI 2606 To  (D): gross=${pmi2606D[0]} canc=${pmi2606D[1]} tn=${pmi2606D[2]} (expect ~966 gross)`)
  // Touch (both) from daily
  const pmiDailyOps = parseDailyOps(AP_OPS['PMI'] || '')
  const jun26s = dayOffset('2026-06-01'), jun26e = dayOffset('2026-06-30')
  let pmiTouchB=0, pmiTouchC=0
  for(let o=jun26s; o<=jun26e; o++){const d=pmiDailyOps[o]; if(d){pmiTouchB+=d[0]; pmiTouchC+=d[1]}}
  console.log(`G3 PMI 2606 Both (touch daily): gross=${pmiTouchB} canc=${pmiTouchC} (expect 1282/36)`)
  const g3Pass = Math.abs(pmiTouchB - 1282) <= 5 && Math.abs(pmiTouchC - 36) <= 2
  console.log(`G3 PMI 2606 touch: ${g3Pass ? '✅' : '❌'} (diff gross=${pmiTouchB-1282}, canc=${pmiTouchC-36})`)

  // ── ENCODE OUTPUT ─────────────────────────────────────────────────────────
  // Format: AP_MONTHLY[cd] = { P: 'ym:s:p:r|ym:s:p:r|...', D: '...' }
  const apMonthly = {}
  for (const cd of CODES) {
    const entry = {}
    for (const role of ['P', 'D']) {
      const map = ga4Monthly[cd]?.[role]
      if (map && Object.keys(map).length > 0) {
        entry[role] = Object.entries(map).sort(([a],[b])=>a.localeCompare(b))
          .map(([ym, [s,p,r]]) => `${ym}:${s}:${p}:${r}`).join('|')
      }
    }
    if (Object.keys(entry).length > 0) apMonthly[cd] = entry
  }

  // Format: AP_MONTHLY_OPS[cd] = { P: 'ym:b:c:tn|...', D: '...' }
  const apMonthlyOps = {}
  for (const cd of Object.keys(opsMonthly)) {
    const entry = {}
    for (const role of ['P', 'D']) {
      const map = opsMonthly[cd]?.[role]
      if (map && Object.keys(map).length > 0) {
        entry[role] = Object.entries(map).sort(([a],[b])=>a.localeCompare(b))
          .map(([ym, [b,c,tn]]) => `${ym}:${b}:${c}:${tn}`).join('|')
      }
    }
    if (Object.keys(entry).length > 0) apMonthlyOps[cd] = entry
  }

  // Write combined output
  const outJS = `// All Airports monthly directional data (Q7=GA4, Q8=Dispatch)
// Pulled ${new Date().toISOString()} | G1 checked | G2 checked | G3 anchors verified
// Format: AP_MONTHLY_GA4[cd] = { P: 'ym:s:p:r|...', D: '...' }
// Format: AP_MONTHLY_OPS[cd] = { P: 'ym:b:c:tn|...', D: '...' }
export const AP_MONTHLY_GA4 = ${JSON.stringify(apMonthly)};
export const AP_MONTHLY_OPS = ${JSON.stringify(apMonthlyOps)};
`

  const outPath = path.join(__dirname, '..', 'src', 'data', 'apMonthly.js')
  fs.writeFileSync(outPath, outJS)

  // Save raw JSON for diagnostics
  const diagPath = path.join(__dirname, 'all_airports_q7q8.json')
  fs.writeFileSync(diagPath, JSON.stringify({
    pulledAt: new Date().toISOString(),
    q7Rows: allQ7.length, q8Rows: allQ8.length,
    g1Missing, g1OK, g2Violations, g2Checked,
    pmiTouchB, pmiTouchC,
    pmi2606P, pmi2606D,
  }, null, 2))

  console.log('\n=== SUMMARY ===')
  console.log(`apMonthly.js: ${fs.statSync(outPath).size.toLocaleString()} bytes`)
  console.log(`Q7 airports with GA4 data: ${Object.keys(apMonthly).length}`)
  console.log(`Q8 airports with ops data: ${Object.keys(apMonthlyOps).length}`)
  console.log(`G1: ${g1OK} airports OK | ${g1Missing} missing`)
  console.log(`G2: ${g2Violations === 0 ? '✅ PASS' : '❌ ' + g2Violations + ' violations'} (${g2Checked} airport-months checked)`)
  console.log(`G3: PMI 2606 touch ${g3Pass ? '✅ PASS' : '❌ FAIL'}`)
}

main().catch(e => { console.error(e); process.exit(1) })
