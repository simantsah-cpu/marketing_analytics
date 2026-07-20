/**
 * run_network_pulse_queries.mjs
 * Runs Q1 and Q2 from the Network Pulse brief against BigQuery via service account.
 * Outputs two JS objects: SD[o] and SOD[o] suitable for embedding.
 *
 * Usage: node scripts/run_network_pulse_queries.mjs
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createSign } from 'crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Read service account JSON from secrets.json or env
let serviceAccountJson = process.env.BIGQUERY_SERVICE_ACCOUNT_JSON
if (!serviceAccountJson) {
  // Try to read from supabase secrets file
  const secretsPath = path.join(__dirname, '..', '.sa-key.json')
  if (fs.existsSync(secretsPath)) {
    serviceAccountJson = fs.readFileSync(secretsPath, 'utf8')
  }
}

if (!serviceAccountJson) {
  // Try to read from supabase CLI secrets
  const supabaseSecrets = path.join(__dirname, '..', 'supabase', '.secrets')
  if (fs.existsSync(supabaseSecrets)) {
    const content = fs.readFileSync(supabaseSecrets, 'utf8')
    const match = content.match(/BIGQUERY_SERVICE_ACCOUNT_JSON=(.+)/s)
    if (match) serviceAccountJson = match[1].trim().replace(/^["']|["']$/g, '')
  }
}

const PROJECT_ID = 'elife-data-warehouse-prod'

async function getAccessToken(saJson) {
  const sa = JSON.parse(saJson)
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/bigquery.readonly https://www.googleapis.com/auth/cloud-platform.read-only',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url')

  const unsigned = `${header}.${payload}`
  const sign = createSign('SHA256')
  sign.update(unsigned)
  sign.end()
  const sig = sign.sign(sa.private_key, 'base64url')
  const jwt = `${unsigned}.${sig}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`)
  return data.access_token
}

function extractRows(result) {
  const schema = result.schema?.fields ?? []
  const rows = result.rows ?? []
  return rows.map(row => {
    const obj = {}
    schema.forEach((field, i) => {
      const raw = row.f[i]?.v
      if (raw == null || raw === '') obj[field.name] = null
      else if (!isNaN(Number(raw)) && raw.trim() !== '') obj[field.name] = Number(raw)
      else obj[field.name] = raw
    })
    return obj
  })
}

async function pollJob(projectId, jobId, token, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}?timeoutMs=5000&maxResults=100000`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`Poll error ${res.status}`)
    const result = await res.json()
    if (result.jobComplete) {
      let rows = extractRows(result)
      // Handle pagination
      let pageToken = result.pageToken
      while (pageToken) {
        console.log(`Fetching next page for job ${jobId}...`)
        const pageUrl = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}?pageToken=${pageToken}&maxResults=100000`
        const pageRes = await fetch(pageUrl, { headers: { Authorization: `Bearer ${token}` } })
        if (!pageRes.ok) throw new Error(`Page error ${pageRes.status}`)
        const pageResult = await pageRes.json()
        rows = [...rows, ...extractRows(pageResult)]
        pageToken = pageResult.pageToken
      }
      return rows
    }
    process.stdout.write('.')
  }
  throw new Error('BigQuery job timed out')
}

async function runQuery(sql, token) {
  console.log('Running query...')
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: sql,
      useLegacySql: false,
      timeoutMs: 60000,
      parameterMode: 'NAMED',
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`BQ error ${res.status}: ${t}`)
  }
  const result = await res.json()
  if (result.errors?.length) throw new Error(`BQ errors: ${JSON.stringify(result.errors)}`)
  if (result.jobComplete) {
    let rows = extractRows(result)
    let pageToken = result.pageToken
    while (pageToken) {
      console.log(`Fetching next page...`)
      const jobId = result.jobReference.jobId
      const pageUrl = `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries/${jobId}?pageToken=${pageToken}&maxResults=100000`
      const pageRes = await fetch(pageUrl, { headers: { Authorization: `Bearer token` } })
      if (!pageRes.ok) throw new Error(`Page error ${pageRes.status}`)
      const pageResult = await pageRes.json()
      rows = [...rows, ...extractRows(pageResult)]
      pageToken = pageResult.pageToken
    }
    return rows
  }
  if (!result.jobReference) throw new Error('No job reference and job not complete')
  console.log(`\nPolling job ${result.jobReference.jobId}...`)
  return await pollJob(PROJECT_ID, result.jobReference.jobId, token)
}

const Q1 = `
WITH e AS (
  SELECT PARSE_DATE('%Y%m%d', event_date) AS d, event_name,
    IFNULL(ecommerce.purchase_revenue,0) AS rev, ecommerce.transaction_id tid
  FROM \`elife-data-warehouse-prod.analytics_259261360.events_*\`
  WHERE _TABLE_SUFFIX BETWEEN '20250616' AND '20260708'
    AND event_name IN ('view_search_results','begin_checkout','checkout','purchase')
)
SELECT DATE_DIFF(d, DATE '2024-06-01', DAY) o,
  COUNTIF(event_name='view_search_results') s,
  COUNTIF(event_name='begin_checkout') vs,
  COUNTIF(event_name='checkout') pf,
  COUNTIF(event_name='purchase') p,
  COUNT(DISTINCT IF(event_name='purchase',tid,NULL)) tx,
  CAST(ROUND(SUM(IF(event_name='purchase',rev,0))) AS INT64) r
FROM e GROUP BY o ORDER BY o
`

const Q2 = `
WITH fx AS (SELECT to_cur, rate FROM \`elife-data-warehouse-prod.mapping.mapping_cur_exch_rate\` WHERE from_cur='USD'),
gbp AS (SELECT rate usd_to_gbp FROM fx WHERE to_cur='GBP'),
rides AS (
  SELECT ride_id, MIN(booking_date) bd,
    ANY_VALUE(hoppa_SellRate) sr, ANY_VALUE(partner_amount_currency) cur,
    LOGICAL_OR(ride_stat LIKE '%ancel%') canc
  FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\`
  WHERE partner_type='hoppa' AND booking_date BETWEEN '2024-01-01' AND '2026-07-09'
  GROUP BY ride_id
)
SELECT DATE_DIFF(bd, DATE '2024-06-01', DAY) o,
  COUNT(*) b, COUNTIF(canc) c,
  CAST(ROUND(SUM(IF(canc,0,CASE WHEN cur='GBP' THEN sr
    ELSE sr/NULLIF((SELECT rate FROM fx WHERE to_cur=cur),0)*(SELECT usd_to_gbp FROM gbp) END))) AS INT64) tn
FROM rides WHERE bd>='2024-06-01' GROUP BY o ORDER BY o
`

async function main() {
  if (!serviceAccountJson) {
    console.error('No service account JSON found. Set BIGQUERY_SERVICE_ACCOUNT_JSON env var or place .sa-key.json in project root.')
    process.exit(1)
  }

  console.log('Getting access token...')
  const token = await getAccessToken(serviceAccountJson)
  console.log('Got access token!')

  console.log('\n=== Running Q1: GA4 site-wide daily ===')
  const q1Rows = await runQuery(Q1, token)
  console.log(`\nQ1 returned ${q1Rows.length} rows`)

  // Build SD object
  const SD = {}
  for (const r of q1Rows) {
    SD[r.o] = [r.s, r.vs, r.pf, r.p, r.tx, r.r]
  }

  console.log('\n=== Running Q2: Dispatch daily ===')
  const q2Rows = await runQuery(Q2, token)
  console.log(`\nQ2 returned ${q2Rows.length} rows`)

  // Build SOD object
  const SOD = {}
  for (const r of q2Rows) {
    SOD[r.o] = [r.b, r.c, r.tn]
  }

  // === VALIDATION GATES ===
  console.log('\n=== VALIDATION GATES ===')

  // Base date: 2024-06-01
  // W27-2026: 2026-06-29..2026-07-05 => offsets 758..764
  // offset = days since 2024-06-01
  const base = new Date('2024-06-01')
  const dateToOffset = (d) => Math.round((new Date(d) - base) / 86400000)

  const w27_2026_start = dateToOffset('2026-06-29')
  const w27_2026_end   = dateToOffset('2026-07-05')
  console.log(`W27-2026 offsets: ${w27_2026_start}..${w27_2026_end}`)

  let sum_s=0, sum_p=0, sum_tx=0, sum_r=0
  for (let o = w27_2026_start; o <= w27_2026_end; o++) {
    if (SD[o]) {
      sum_s  += SD[o][0] || 0
      sum_p  += SD[o][3] || 0
      sum_tx += SD[o][4] || 0
      sum_r  += SD[o][5] || 0
    }
  }
  console.log(`W27-2026: s=${sum_s} (expect 57,589) | p=${sum_p} (expect 2,582) | tx(daily-sum)=${sum_tx} (expect 1,917) | r=£${sum_r} (expect £178,950)`)

  // YoY window: W27-2025 => -364 days = 2025-07-01..2025-07-07? Actually weekday-aligned: 2026-06-29 - 364 = 2025-07-01
  // ISO W27-2025: 2025-06-30..2025-07-06
  const yoy_start = dateToOffset('2025-06-30')
  const yoy_end   = dateToOffset('2025-07-06')
  console.log(`\nW27-2025 (YoY) offsets: ${yoy_start}..${yoy_end}`)
  let yoy_s=0
  for (let o = yoy_start; o <= yoy_end; o++) {
    if (SD[o]) yoy_s += SD[o][0] || 0
  }
  console.log(`W27-2025 YoY: s=${yoy_s} (expect 76,607) — but note GA4 coverage starts 2025-06-16 only, so this should have data`)

  // June 2026 GA4: 2026-06-01..2026-06-30 offsets
  const jun26_start = dateToOffset('2026-06-01')
  const jun26_end   = dateToOffset('2026-06-30')
  let jun_s=0, jun_r=0
  for (let o = jun26_start; o <= jun26_end; o++) {
    if (SD[o]) { jun_s += SD[o][0]||0; jun_r += SD[o][5]||0 }
  }
  console.log(`\nJune 2026 GA4: s=${jun_s} (expect 246,728) | r=£${jun_r} (expect £672,803)`)

  // June 2026 dispatch
  let jun_b=0, jun_c=0, jun_tn=0
  for (let o = jun26_start; o <= jun26_end; o++) {
    if (SOD[o]) { jun_b += SOD[o][0]||0; jun_c += SOD[o][1]||0; jun_tn += SOD[o][2]||0 }
  }
  console.log(`June 2026 dispatch: gross=${jun_b} (expect 16,782) | cancelled=${jun_c} (expect ~952) | net TTV=£${jun_tn} (expect ~£1,193,695)`)

  // Q2-2026: Apr-Jun 2026
  const q2_start = dateToOffset('2026-04-01')
  const q2_end   = dateToOffset('2026-06-30')
  let q2_net=0
  for (let o = q2_start; o <= q2_end; o++) {
    if (SOD[o]) q2_net += (SOD[o][0]||0) - (SOD[o][1]||0)
  }
  console.log(`\nQ2-2026 dispatch net bookings: ${q2_net} (expect 45,551)`)

  // Mar-2025 net
  const mar25_start = dateToOffset('2025-03-01')
  const mar25_end   = dateToOffset('2025-03-31')
  let mar_net=0
  for (let o = mar25_start; o <= mar25_end; o++) {
    if (SOD[o]) mar_net += (SOD[o][0]||0) - (SOD[o][1]||0)
  }
  console.log(`Mar-2025 net dispatch: ${mar_net} (expect 50,914)`)

  // Output JSON for embedding
  const outPath = path.join(__dirname, '..', 'scripts', 'network_pulse_data.json')
  fs.writeFileSync(outPath, JSON.stringify({ SD, SOD, pulledAt: new Date().toISOString() }, null, 0))
  console.log(`\nData written to ${outPath}`)
  console.log(`SD entries: ${Object.keys(SD).length}, SOD entries: ${Object.keys(SOD).length}`)
}

main().catch(e => { console.error(e); process.exit(1) })
