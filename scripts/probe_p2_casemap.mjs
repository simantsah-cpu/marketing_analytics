/**
 * probe_p2_casemap.mjs
 * Verify the CASE mapping on W27-2026 (20260629..20260705) to:
 *   V1: sum(s)=57,589  sum(p)=2,582
 *   V2: Paid search s≈19,086 / p≈827
 * Also surface all source/medium combinations to confirm no leakage.
 */
import { createSign } from 'crypto'
import fs from 'fs'

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

async function pollJob(jobId, token) {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000))
    process.stdout.write('.')
    const res = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries/${jobId}?timeoutMs=5000&maxResults=1000`, { headers: { Authorization: `Bearer ${token}` } })
    const result = await res.json()
    if (result.jobComplete) return extractRows(result)
  }
  throw new Error('timeout')
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
  let rows
  if (result.jobComplete) rows = extractRows(result)
  else rows = await pollJob(result.jobReference.jobId, token)
  console.log(`${label}: ${rows.length} rows`)
  rows.forEach(r => console.log(JSON.stringify(r)))
  return rows
}

async function main() {
  const token = await getToken()

  // Full CASE mapping test on W27-2026
  // Note: CASE order is load-bearing per brief A4
  const Q_CASE_TEST = `
WITH e AS (
  SELECT event_name,
    session_traffic_source_last_click.google_ads_campaign.campaign_name IS NOT NULL AS has_gads,
    session_traffic_source_last_click.manual_campaign.source AS manual_src,
    LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,'')) AS manual_med,
    CASE
      WHEN session_traffic_source_last_click.google_ads_campaign.campaign_name IS NOT NULL THEN 'Paid search'
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,'')) IN ('cpc','ppc','paid') THEN 'Paid search'
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,''))='organic'
           AND session_traffic_source_last_click.manual_campaign.source='google-play' THEN 'App store'
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,''))='organic' THEN 'Organic search'
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,''))='email' THEN 'Email / CRM'
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,'')) LIKE 'affiliate%' THEN 'Affiliates'
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,''))='ai-assistant' THEN 'AI assistants'
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,''))='referral' THEN 'Referral'
      WHEN session_traffic_source_last_click.manual_campaign.source IS NULL
           OR session_traffic_source_last_click.manual_campaign.source IN ('(direct)','(not set)') THEN 'Direct / unattributed'
      ELSE 'Other'
    END ch
  FROM \`elife-data-warehouse-prod.analytics_259261360.events_*\`
  WHERE _TABLE_SUFFIX BETWEEN '20260629' AND '20260705'
    AND event_name IN ('view_search_results','purchase')
)
SELECT ch,
  COUNTIF(event_name='view_search_results') s,
  COUNTIF(event_name='purchase') p
FROM e
GROUP BY ch
ORDER BY s DESC`

  const chRows = await runQuery(Q_CASE_TEST, token, 'V1+V2 Channel CASE mapping W27-2026')

  // Validation
  let totalS = 0, totalP = 0, paidS = 0, paidP = 0
  chRows.forEach(r => {
    const s = parseInt(r.s), p = parseInt(r.p)
    totalS += s; totalP += p
    if (r.ch === 'Paid search') { paidS = s; paidP = p }
  })
  console.log(`\nV1: sum(s)=${totalS} (expect 57589) → ${totalS===57589?'✅':'❌ FAIL'}`)
  console.log(`V1: sum(p)=${totalP} (expect 2582)  → ${totalP===2582?'✅':'❌ FAIL'}`)
  console.log(`V2: Paid search s=${paidS} (expect ~19086) p=${paidP} (expect ~827) → ${Math.abs(paidS-19086)<500?'✅':'❌ CHECK'}`)

  // Also check what lands in "Other" (all source/medium combos that hit the ELSE)
  const Q_OTHER = `
WITH e AS (
  SELECT
    session_traffic_source_last_click.google_ads_campaign.campaign_name IS NOT NULL AS has_gads,
    session_traffic_source_last_click.manual_campaign.source AS manual_src,
    LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,'')) AS manual_med,
    CASE
      WHEN session_traffic_source_last_click.google_ads_campaign.campaign_name IS NOT NULL THEN 'Paid search'
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,'')) IN ('cpc','ppc','paid') THEN 'Paid search'
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,''))='organic'
           AND session_traffic_source_last_click.manual_campaign.source='google-play' THEN 'App store'
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,''))='organic' THEN 'Organic search'
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,''))='email' THEN 'Email / CRM'
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,'')) LIKE 'affiliate%' THEN 'Affiliates'
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,''))='ai-assistant' THEN 'AI assistants'
      WHEN LOWER(IFNULL(session_traffic_source_last_click.manual_campaign.medium,''))='referral' THEN 'Referral'
      WHEN session_traffic_source_last_click.manual_campaign.source IS NULL
           OR session_traffic_source_last_click.manual_campaign.source IN ('(direct)','(not set)') THEN 'Direct / unattributed'
      ELSE 'Other'
    END ch
  FROM \`elife-data-warehouse-prod.analytics_259261360.events_*\`
  WHERE _TABLE_SUFFIX BETWEEN '20260629' AND '20260705'
    AND event_name='view_search_results'
)
SELECT manual_src, manual_med, has_gads, COUNT(*) n FROM e WHERE ch='Other'
GROUP BY 1,2,3 ORDER BY n DESC LIMIT 20`

  await runQuery(Q_OTHER, token, 'What lands in Other (ELSE branch) — W27-2026')

  // Also check chatgpt.com - does it need AI assistant mapping?
  const Q_CHATGPT = `
SELECT
  session_traffic_source_last_click.manual_campaign.source AS src,
  session_traffic_source_last_click.manual_campaign.medium AS med,
  COUNT(*) n
FROM \`elife-data-warehouse-prod.analytics_259261360.events_*\`
WHERE _TABLE_SUFFIX BETWEEN '20260629' AND '20260705'
  AND event_name='view_search_results'
  AND (LOWER(session_traffic_source_last_click.manual_campaign.source) LIKE '%chatgpt%'
    OR LOWER(session_traffic_source_last_click.manual_campaign.source) LIKE '%perplexity%'
    OR LOWER(session_traffic_source_last_click.manual_campaign.source) LIKE '%claude%'
    OR LOWER(session_traffic_source_last_click.manual_campaign.source) LIKE '%gemini%'
    OR LOWER(session_traffic_source_last_click.manual_campaign.medium) = 'ai-assistant')
GROUP BY 1,2 ORDER BY n DESC`

  await runQuery(Q_CHATGPT, token, 'AI assistant sources check')
}

main().catch(e => { console.error(e); process.exit(1) })
