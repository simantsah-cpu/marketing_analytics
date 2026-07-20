/**
 * probe_d1_ops.mjs
 * PRE-FLIGHT PROBE — verify cancellation_origin / cancellation_type are recorded for hoppa rides.
 * Rule D1: if unrecorded, DROP that card entirely.
 * Also probe the vehicle_class raw values so we know what needs grouping.
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
  if (result.jobComplete) {
    rows = extractRows(result)
  } else {
    const jobId = result.jobReference.jobId
    console.log(`Polling job ${jobId}...`)
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 3000))
      process.stdout.write('.')
      const pr = await fetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT_ID}/queries/${jobId}?timeoutMs=5000&maxResults=1000`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const pd = await pr.json()
      if (pd.jobComplete) { rows = extractRows(pd); break }
    }
    if (!rows) throw new Error('Job timed out')
    console.log('')
  }
  console.log(`${label}: ${rows.length} rows`)
  rows.forEach(r => console.log(JSON.stringify(r)))
  return rows
}

async function main() {
  const token = await getToken()
  console.log('Token OK')

  // P2: Are cancelled_origin / cancellation_type recorded for hoppa? (Rule D1)
  const P2 = `
SELECT IFNULL(cancelled_origin,'(null)') co, IFNULL(cancellation_type,'(null)') ct, COUNT(*) n
FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\`
WHERE partner_type='hoppa' AND ride_stat LIKE '%ancel%'
  AND booking_date BETWEEN '2026-06-01' AND '2026-06-30'
GROUP BY 1,2 ORDER BY n DESC`

  const p2rows = await runQuery(P2, token, 'P2 cancellation origin/type check (Rule D1)')
  const allNull = p2rows.every(r => r.co === '(null)' && r.ct === '(null)')
  console.log(`D1: all cancelled_origin/type null? ${allNull ? '✅ YES — DROP that card' : '❌ NO — data exists, keep card'}`)

  // Probe: raw vehicle_class values (to see what grouping is needed)
  const P3 = `
SELECT IFNULL(vehicle_class,'(null)') vc, COUNT(*) n
FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\`
WHERE partner_type='hoppa'
  AND booking_date BETWEEN '2026-06-01' AND '2026-06-30'
GROUP BY 1 ORDER BY n DESC LIMIT 30`

  await runQuery(P3, token, 'P3 raw vehicle_class values June 2026')

  // Probe: check if pickup_date can be NULL (O2 trap)
  const P4 = `
SELECT
  COUNTIF(pickup_date IS NULL) null_pickup,
  COUNTIF(booking_date IS NULL) null_booking,
  COUNT(*) total
FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\`
WHERE partner_type='hoppa'
  AND booking_date BETWEEN '2025-04-01' AND '2026-07-09'`

  await runQuery(P4, token, 'P4 NULL pickup_date check (O2 trap)')

  // Probe: verify June 2026 anchor from daily dataset
  const P5 = `
SELECT
  COUNTIF(ride_stat NOT LIKE '%ancel%') gross_minus_canc,
  COUNT(*) gross_all,
  COUNTIF(ride_stat LIKE '%ancel%') cancelled
FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\`
WHERE partner_type='hoppa'
  AND booking_date BETWEEN '2026-06-01' AND '2026-06-30'`

  await runQuery(P5, token, 'P5 June 2026 hoppa booking totals (O6 cross-check anchor)')

  // Probe: check passenger_count nulls
  const P6 = `
SELECT
  COUNTIF(passenger_count IS NULL) null_pax,
  COUNTIF(passenger_count IS NOT NULL) has_pax,
  CAST(ROUND(AVG(IFNULL(passenger_count,0))) AS INT64) avg_pax,
  COUNT(*) total
FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\`
WHERE partner_type='hoppa'
  AND booking_date BETWEEN '2026-06-01' AND '2026-06-30'`

  await runQuery(P6, token, 'P6 passenger_count null check (O5 trap)')

  // Probe: check currency distribution (FX trap)
  const P7 = `
SELECT
  IFNULL(partner_amount_currency,'(null)') cur,
  COUNT(*) n,
  COUNTIF(hoppa_SellRate IS NULL) null_sr
FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\`
WHERE partner_type='hoppa'
  AND booking_date BETWEEN '2026-06-01' AND '2026-06-30'
GROUP BY 1 ORDER BY n DESC LIMIT 20`

  await runQuery(P7, token, 'P7 currency distribution + sell rate nulls')
}

main().catch(e => { console.error(e); process.exit(1) })
