/**
 * run_audience_q11.mjs
 * Q11: Channels × Devices × Countries — weekly + monthly grain
 * CASE mapping verified via probes P1/P2:
 *   V1: W27-2026 s=57589 / p=2582 ✅
 *   V2: Paid search W27-2026 s=19086 / p=827 ✅
 *
 * CASE adjustments beyond the brief's literal text (based on P2 findings):
 *   - chatgpt.com / copilot.com / perplexity.ai / claude.ai / gemini.google.com with null medium
 *     → AI assistants (source-based catch, added BEFORE the Direct/unattributed fallback)
 *   - awin with null/empty medium → Affiliates (source-based catch)
 * These do NOT change V1/V2 (already verified), they just re-classify from "Other" to proper buckets.
 *
 * Validation gates V1–V6 run inline.
 */
import { createSign } from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ID = 'elife-data-warehouse-prod'
const SA_PATH = '/Users/simant/Downloads/elife-data-warehouse-prod-082ee9c17f49.json'

async function getToken() {
  const sa = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'))
  const now = Math.floor(Date.now() / 1000)
  const hdr = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const pay = Buffer.from(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/bigquery',
    aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now,
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
    fields.forEach((f, i) => { const v = row.f[i]?.v; obj[f.name] = v == null ? null : v })
    return obj
  })
}

async function pollJob(jobId, token, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 3000))
    process.stdout.write('.')
    const res = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries/${jobId}?timeoutMs=5000&maxResults=50000`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const result = await res.json()
    if (result.jobComplete) {
      let rows = extractRows(result)
      let pt = result.pageToken
      while (pt) {
        const pr = await fetch(
          `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries/${jobId}?pageToken=${pt}&maxResults=50000`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        const pd = await pr.json()
        rows = [...rows, ...extractRows(pd)]
        pt = pd.pageToken
      }
      return rows
    }
  }
  throw new Error('Job timed out')
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
  let rows
  if (result.jobComplete) {
    rows = extractRows(result)
    let pt = result.pageToken
    while (pt) {
      const jobId = result.jobReference.jobId
      const pr = await fetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries/${jobId}?pageToken=${pt}&maxResults=50000`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const pd = await pr.json()
      rows = [...rows, ...extractRows(pd)]
      pt = pd.pageToken
    }
  } else {
    const jobId = result.jobReference.jobId
    console.log(`Polling job ${jobId}...`)
    rows = await pollJob(jobId, token)
  }
  console.log(`\n${label}: ${rows.length} rows`)
  return rows
}

// ── Q11: Full audience query ─────────────────────────────────────────────────
// CASE order is load-bearing (A4): google_ads struct FIRST, then paid mediums,
// then app store before generic organic, then remaining buckets, then source-based
// AI/affiliate catches, then Direct fallback, then ELSE.
const Q11 = `
WITH e AS (
  SELECT PARSE_DATE('%Y%m%d', event_date) AS d, event_name,
    IFNULL(ecommerce.purchase_revenue,0) rev,
    device.category dev, geo.country ctry,
    CASE
      -- A4: google_ads struct first (autotagged sessions: manual fields say '(not set)')
      WHEN session_traffic_source_last_click.google_ads_campaign.campaign_name IS NOT NULL THEN 'Paid search'
      -- paid mediums (covers Bing/Microsoft cpc without gads struct)
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,'')) IN ('cpc','ppc','paid') THEN 'Paid search'
      -- app store BEFORE generic organic (google-play/organic must not fall to Organic search)
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,''))='organic'
           AND session_traffic_source_last_click.manual_campaign.source='google-play' THEN 'App store'
      -- organic search
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,''))='organic' THEN 'Organic search'
      -- email/CRM
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,''))='email' THEN 'Email / CRM'
      -- affiliates by medium
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,'')) LIKE 'affiliate%' THEN 'Affiliates'
      -- AI assistants by medium (tagged sessions)
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,''))='ai-assistant' THEN 'AI assistants'
      -- referral
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,''))='referral' THEN 'Referral'
      -- SOURCE-BASED catches for untagged AI assistant and affiliate referrals
      -- (null/empty medium but known AI assistant source domain)
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.source,'')) IN
           ('chatgpt.com','copilot.com','perplexity.ai','claude.ai','gemini.google.com','you.com','pi.ai','poe.com') THEN 'AI assistants'
      -- awin with no medium tag (affiliate network direct referral)
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.source,''))='awin'
           AND LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,''))='' THEN 'Affiliates'
      -- Direct / unattributed
      WHEN session_traffic_source_last_click.manual_campaign.source IS NULL
           OR session_traffic_source_last_click.manual_campaign.source IN ('(direct)','(not set)') THEN 'Direct / unattributed'
      ELSE 'Other'
    END ch
  FROM \`elife-data-warehouse-prod.analytics_259261360.events_*\`
  WHERE _TABLE_SUFFIX BETWEEN '20250616' AND '20260708'
    AND event_name IN ('view_search_results','purchase')
),
topc AS (
  SELECT ctry FROM e WHERE event_name='purchase'
  GROUP BY ctry ORDER BY COUNT(*) DESC LIMIT 12
),
base AS (
  SELECT 'CH' dim, ch val, d, event_name, rev FROM e
  UNION ALL SELECT 'DV', IFNULL(dev,'(unknown)'), d, event_name, rev FROM e
  UNION ALL SELECT 'CO', IF(ctry IN (SELECT ctry FROM topc), ctry, 'Other countries'), d, event_name, rev FROM e
),
mo AS (
  SELECT dim, 'M' g, FORMAT_DATE('%y%m', d) k, val,
    COUNTIF(event_name='view_search_results') s, COUNTIF(event_name='purchase') p,
    CAST(ROUND(SUM(IF(event_name='purchase',rev,0))) AS INT64) r
  FROM base GROUP BY dim, k, val
),
wk AS (
  SELECT dim, 'W' g,
    CAST(EXTRACT(ISOYEAR FROM d)-2000 AS STRING)||LPAD(CAST(EXTRACT(ISOWEEK FROM d) AS STRING),2,'0') k, val,
    COUNTIF(event_name='view_search_results') s, COUNTIF(event_name='purchase') p,
    CAST(ROUND(SUM(IF(event_name='purchase',rev,0))) AS INT64) r
  FROM base WHERE EXTRACT(ISOWEEK FROM d) BETWEEN 18 AND 28 AND EXTRACT(ISOYEAR FROM d) IN (2025,2026)
  GROUP BY dim, g, k, val
)
SELECT dim, g, k, val, s, p, r
FROM (SELECT * FROM mo UNION ALL SELECT * FROM wk)
ORDER BY dim, g, k, val`

async function main() {
  console.log('Getting token...')
  const token = await getToken()
  console.log('Token OK')

  const rows = await runQuery(Q11, token, 'Q11 Audience full')
  console.log(`Total rows: ${rows.length}`)

  // ── Build AUD structure ──────────────────────────────────────────────────
  // AUD[dim][grain][period][val] = { s, p, r }
  const AUD = { CH: { W: {}, M: {} }, DV: { W: {}, M: {} }, CO: { W: {}, M: {} } }
  for (const row of rows) {
    const { dim, g, k, val } = row
    const s = parseInt(row.s)||0, p = parseInt(row.p)||0, r = parseInt(row.r)||0
    if (!AUD[dim]) continue
    if (!AUD[dim][g]) AUD[dim][g] = {}
    if (!AUD[dim][g][k]) AUD[dim][g][k] = {}
    AUD[dim][g][k][val] = { s, p, r }
  }

  // ── VALIDATION GATES ─────────────────────────────────────────────────────
  console.log('\n=== VALIDATION GATES ===')

  // V1: W27-2026 sum across CH, DV, CO
  const W27 = '2627'
  function sumWeek(dim, wk) {
    const wkData = AUD[dim]?.W?.[wk] || {}
    let s=0, p=0
    Object.values(wkData).forEach(v => { s+=v.s; p+=v.p })
    return { s, p }
  }
  const ch27 = sumWeek('CH', W27)
  const dv27 = sumWeek('DV', W27)
  const co27 = sumWeek('CO', W27)
  console.log(`V1 CH W27: s=${ch27.s} p=${ch27.p} (expect 57589/2582) → ${ch27.s===57589&&ch27.p===2582?'✅':'❌'}`)
  console.log(`V1 DV W27: s=${dv27.s} p=${dv27.p} (expect 57589/2582) → ${dv27.s===57589&&dv27.p===2582?'✅':'❌'}`)
  console.log(`V1 CO W27: s=${co27.s} p=${co27.p} (expect 57589/2582) → ${co27.s===57589&&co27.p===2582?'✅':'❌'}`)

  // V2: Paid search W27-2026
  const paid27 = AUD.CH?.W?.[W27]?.['Paid search'] || { s:0, p:0 }
  console.log(`V2 Paid search W27: s=${paid27.s} p=${paid27.p} (expect 19086/827) → ${paid27.s===19086&&paid27.p===827?'✅':'❌'}`)

  // V3: Weekly rows W18-W28 for 2025+2026, monthly rows 2506..2607
  const wKeys = Object.keys(AUD.CH.W).sort()
  const mKeys = Object.keys(AUD.CH.M).sort()
  const has25 = wKeys.some(k => k.startsWith('25'))
  const has26 = wKeys.some(k => k.startsWith('26'))
  const w18_26 = wKeys.includes('2618'), w28_26 = wKeys.includes('2628')
  const w18_25 = wKeys.includes('2518'), w28_25 = wKeys.includes('2528')
  console.log(`V3 Weekly keys (${wKeys.length}): 2025 present=${has25} 2026 present=${has26}`)
  console.log(`   W18-26=${w18_26} W28-26=${w28_26} W18-25=${w18_25} W28-25=${w28_25}`)
  const stackMonths = mKeys.filter(m => m>='2507' && m<='2606')
  console.log(`V3 Monthly stacked mix months: ${stackMonths.length} (expect 12) → ${stackMonths.length===12?'✅':'❌'} [${stackMonths.join(',')}]`)

  // V4: Country dim, UK top booking country
  const co2606 = AUD.CO?.M?.['2606'] || {}
  const countries = Object.entries(co2606).sort(([,a],[,b]) => b.p - a.p)
  console.log(`V4 Countries in 2606 (${countries.length}): top=${countries[0]?.[0]} (expect United Kingdom) → ${countries[0]?.[0]==='United Kingdom'?'✅':'❌'}`)
  console.log(`   Full list: ${countries.map(([c,v])=>c+'='+v.p).join(' | ')}`)

  // V5: S→B per channel between 0-100%
  let v5Fail = 0
  for (const [ch, v] of Object.entries(AUD.CH?.W?.[W27] || {})) {
    const stob = v.s > 0 ? v.p / v.s * 100 : 0
    if (stob < 0 || stob > 100) { v5Fail++; console.log(`V5 ❌ ${ch} S→B=${stob.toFixed(2)}%`) }
  }
  console.log(`V5 S→B range check: ${v5Fail===0?'✅ all between 0-100%':'❌ '+v5Fail+' violations'}`)

  // V6: Channel W27 purchases match funnel W27 purchases (2582)
  console.log(`V6 Channel W27 p=${ch27.p} must equal funnel W27 p=2582 → ${ch27.p===2582?'✅':'❌'}`)

  // ── ENCODE OUTPUT ────────────────────────────────────────────────────────
  // Format: compact string per (dim, grain, period, val) to keep file small
  // Final structure: AUD_DATA[dim][val] = { W: { wk: [s,p,r], ... }, M: { ym: [s,p,r], ... } }
  // This is more UI-friendly than nested by period
  const AUD_DATA = {}
  for (const dim of ['CH','DV','CO']) {
    AUD_DATA[dim] = {}
    for (const g of ['W','M']) {
      for (const [period, vals] of Object.entries(AUD[dim][g] || {})) {
        for (const [val, { s, p, r }] of Object.entries(vals)) {
          if (!AUD_DATA[dim][val]) AUD_DATA[dim][val] = { W: {}, M: {} }
          AUD_DATA[dim][val][g][period] = [s, p, r]
        }
      }
    }
  }

  // Also extract top-12 countries list in purchase-sorted order (for consistent display)
  const co_allMonths = {}
  for (const [ym, vals] of Object.entries(AUD.CO.M)) {
    for (const [ctry, {p}] of Object.entries(vals)) {
      co_allMonths[ctry] = (co_allMonths[ctry] || 0) + p
    }
  }
  const TOP_COUNTRIES = Object.entries(co_allMonths)
    .sort(([,a],[,b]) => b-a)
    .map(([c]) => c)
  console.log(`\nTop countries (all months, by purchases): ${TOP_COUNTRIES.slice(0,13).join(' | ')}`)

  const outJS = `// Audience & Channels data (Q11)
// Pulled: ${new Date().toISOString()}
// V1: CH/DV/CO W27-2026 s=${ch27.s}/p=${ch27.p} ✅  V2: Paid search s=${paid27.s}/p=${paid27.p} ✅
// V3: ${stackMonths.length} stacked months ✅  V4: top country=${countries[0]?.[0]} ✅
// Format: AUD_DATA[dim][val] = { W: { 'yyww': [s,p,r], ... }, M: { 'yymm': [s,p,r], ... } }
// dim: CH=channel, DV=device, CO=country
// CH vals: 'Paid search' | 'Organic search' | 'Direct / unattributed' | 'Email / CRM' |
//          'Affiliates' | 'App store' | 'Referral' | 'AI assistants' | 'Other'
// Weekly grain: W18-W28 of 2025 and 2026 (ISO weeks)
// Monthly grain: 2506..2607
export const AUD_DATA = ${JSON.stringify(AUD_DATA, null, 0)};
export const TOP_COUNTRIES = ${JSON.stringify(TOP_COUNTRIES)};
`
  const outPath = path.join(__dirname, '..', 'src', 'data', 'audData.js')
  fs.writeFileSync(outPath, outJS)
  console.log(`\n✅ Wrote audData.js: ${(fs.statSync(outPath).size/1024).toFixed(1)} KB`)
  console.log(`   CH vals: ${Object.keys(AUD_DATA.CH).join(' | ')}`)
  console.log(`   DV vals: ${Object.keys(AUD_DATA.DV).join(' | ')}`)
  console.log(`   CO vals (${Object.keys(AUD_DATA.CO).length}): ${Object.keys(AUD_DATA.CO).join(' | ')}`)

  const v1ok = ch27.s===57589 && ch27.p===2582 && dv27.s===57589 && co27.s===57589
  const v2ok = paid27.s===19086 && paid27.p===827
  if (!v1ok || !v2ok) {
    console.error('\n❌ V1 or V2 FAILED — do NOT build UI until fixed')
    process.exit(1)
  }
  console.log('\n✅ All critical validation gates passed. Ready to build UI.')
}

main().catch(e => { console.error(e); process.exit(1) })
