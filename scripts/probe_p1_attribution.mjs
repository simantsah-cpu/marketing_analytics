/**
 * probe_p1_attribution.mjs
 * MANDATORY PROBE — verify which traffic-source fields are populated on this GA4 property.
 * Brief says: collected_traffic_source EMPTY, traffic_source USER-SCOPED, session_traffic_source_last_click CORRECT.
 * Must verify before writing Q11.
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

async function runQuery(sql, token, label) {
  console.log(`\n=== ${label} ===`)
  const res = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 60000 }),
  })
  const result = await res.json()
  if (result.errors?.length) throw new Error(`BQ errors: ${JSON.stringify(result.errors)}`)
  const fields = result.schema?.fields ?? []
  const rows = (result.rows ?? []).map(row => {
    const obj = {}
    fields.forEach((f, i) => { const v = row.f[i]?.v; obj[f.name] = v == null ? null : v })
    return obj
  })
  console.log(`${label}: ${rows.length} rows`)
  rows.forEach(r => console.log(JSON.stringify(r)))
  return rows
}

async function main() {
  const token = await getToken()
  console.log('Token OK')

  // P1: Which traffic-source fields are populated?
  const P1 = `
SELECT
  COUNTIF(collected_traffic_source.manual_source IS NOT NULL) src_collected,
  COUNTIF(traffic_source.source IS NOT NULL) src_user_scoped,
  COUNTIF(session_traffic_source_last_click.manual_campaign.source IS NOT NULL) lc_manual,
  COUNTIF(session_traffic_source_last_click.google_ads_campaign.campaign_name IS NOT NULL) lc_gads,
  COUNT(*) n
FROM \`elife-data-warehouse-prod.analytics_259261360.events_20260701\`
WHERE event_name='view_search_results'`

  await runQuery(P1, token, 'P1 attribution field probe')

  // P2: Sample the google_ads vs manual medium for a recent day to understand the split
  const P2 = `
SELECT
  session_traffic_source_last_click.google_ads_campaign.campaign_name IS NOT NULL AS has_gads,
  session_traffic_source_last_click.manual_campaign.source AS manual_src,
  session_traffic_source_last_click.manual_campaign.medium AS manual_med,
  COUNT(*) n
FROM \`elife-data-warehouse-prod.analytics_259261360.events_20260701\`
WHERE event_name='view_search_results'
GROUP BY 1,2,3
ORDER BY n DESC
LIMIT 30`

  await runQuery(P2, token, 'P2 source/medium distribution sample')

  // P3: Validate W27-2026 total searches (the V1 anchor)
  const P3 = `
SELECT
  COUNT(*) n_rows,
  COUNTIF(event_name='view_search_results') s,
  COUNTIF(event_name='purchase') p
FROM \`elife-data-warehouse-prod.analytics_259261360.events_*\`
WHERE _TABLE_SUFFIX BETWEEN '20260629' AND '20260705'
  AND event_name IN ('view_search_results','purchase')`

  await runQuery(P3, token, 'P3 W27-2026 site totals (V1 anchor)')

  // P4: Also check W27-2025 for YoY comparison
  const P4 = `
SELECT
  COUNTIF(event_name='view_search_results') s,
  COUNTIF(event_name='purchase') p
FROM \`elife-data-warehouse-prod.analytics_259261360.events_*\`
WHERE _TABLE_SUFFIX BETWEEN '20250630' AND '20250706'
  AND event_name IN ('view_search_results','purchase')`

  await runQuery(P4, token, 'P4 W27-2025 site totals (YoY base)')

  console.log('\n=== PROBE COMPLETE ===')
  console.log('If P1 shows: src_collected=0, src_user_scoped>0, lc_manual>0, lc_gads>0 → matches brief')
  console.log('Check P3 s against V1 anchor: expect 57,589')
}

main().catch(e => { console.error(e); process.exit(1) })
