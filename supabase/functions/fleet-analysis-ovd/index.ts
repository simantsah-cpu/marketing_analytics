import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { requireAuth } from '../_shared/requireAuth.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ─── BigQuery helpers (identical to fleet-analysis) ───────────────────────────
async function getBQToken(saJson: string): Promise<string> {
  const sa  = JSON.parse(saJson)
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: sa.client_email,
    scope: [
      'https://www.googleapis.com/auth/bigquery.readonly',
      'https://www.googleapis.com/auth/cloud-platform.read-only',
    ].join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  }
  const enc = (o: object) =>
    btoa(JSON.stringify(o)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  const unsigned = `${enc({alg:'RS256',typ:'JWT'})}.${enc(payload)}`
  const pem = sa.private_key
    .replace('-----BEGIN PRIVATE KEY-----','')
    .replace('-----END PRIVATE KEY-----','')
    .replace(/\s/g,'')
  const privKey = await crypto.subtle.importKey(
    'pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)),
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['sign'])
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privKey, new TextEncoder().encode(unsigned))
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  const jwt = `${unsigned}.${sig}`
  const tokenRes = await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  const d = await tokenRes.json()
  if (!d.access_token) throw new Error(`BQ token: ${JSON.stringify(d)}`)
  return d.access_token
}

function parseRows(schema: any[], rows: any[]): Record<string,unknown>[] {
  return rows.map(row => {
    const obj: Record<string,unknown> = {}
    schema.forEach((f:any, i:number) => {
      const raw = row.f[i]?.v
      if (raw == null) { obj[f.name] = null; return }
      if (f.type === 'STRING' || f.type === 'DATE') { obj[f.name] = raw; return }
      const num = Number(raw); obj[f.name] = isNaN(num) ? raw : num
    })
    return obj
  })
}

async function runQuery(projectId: string, sql: string, token: string): Promise<Record<string,unknown>[]> {
  const url  = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`
  const body = JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 55000 })
  const res  = await fetch(url, {
    method:'POST',
    headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
    body,
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`BQ query ${res.status}: ${txt.slice(0,600)}`)
  }
  const result = await res.json()
  if (result.errors?.length) throw new Error(`BQ errors: ${JSON.stringify(result.errors)}`)
  if (result.jobComplete) {
    return parseRows(result.schema?.fields ?? [], result.rows ?? [])
  }
  // Poll if not complete
  const jobId = result.jobReference?.jobId
  if (!jobId) throw new Error('BQ: jobComplete=false and no jobId')
  const rows: Record<string,unknown>[] = []
  let schema: any[] = []
  let pageToken: string | undefined
  let attempts = 0
  do {
    await new Promise(r => setTimeout(r, 3000))
    if (attempts++ > 20) throw new Error('BQ: timed out polling job')
    const pollUrl = new URL(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}`)
    pollUrl.searchParams.set('timeoutMs','5000')
    pollUrl.searchParams.set('maxResults','50000')
    if (pageToken) pollUrl.searchParams.set('pageToken', pageToken)
    const pollRes = await fetch(pollUrl.toString(), {headers:{Authorization:`Bearer ${token}`}})
    if (!pollRes.ok) continue
    const pr = await pollRes.json()
    if (!pr.jobComplete) continue
    schema    = pr.schema?.fields ?? schema
    pageToken = pr.pageToken
    rows.push(...parseRows(schema, pr.rows ?? []))
  } while (pageToken)
  return rows
}

function toDate(s: string | undefined, fallback: string): string {
  if (!s) return fallback
  return s.length === 7 ? `${s}-01` : s
}

// ─── SQL — Dataset 1: od_monthly ─────────────────────────────────────────────
function sqlMonthly(asAt: string): string { return `
WITH params AS (
  SELECT DATE '2023-01-01' AS start_month,
         DATE '${asAt}' AS as_at_month
),
t AS (
  SELECT f.ride_id, f.trip_no, DATE_TRUNC(f.pickup_date, MONTH) AS m, f.pickup_datetime
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\` f, params p
  WHERE f.pickup_date BETWEEN p.start_month AND LAST_DAY(p.as_at_month)
),
h AS (
  SELECT t.m, t.ride_id, t.trip_no, t.pickup_datetime,
         hh.rejected_at, hh.dispatch_stat
  FROM t
  JOIN \`elife-data-warehouse-prod.dwb.dwb_dispatch_detail_history\` hh USING (ride_id, trip_no)
  WHERE hh.dispatch_version >= 1
),
trips AS (
  SELECT m, COUNT(*) AS delivered_trips FROM t GROUP BY m
),
att AS (
  SELECT m,
    COUNT(*) AS attempts,
    COUNTIF(rejected_at IS NOT NULL) AS rejections,
    COUNT(DISTINCT IF(rejected_at IS NOT NULL,
      CONCAT(CAST(ride_id AS STRING), '-', CAST(trip_no AS STRING)), NULL)) AS trips_needing_2nd_fleet,
    COUNTIF(rejected_at IS NOT NULL
            AND TIMESTAMP_DIFF(pickup_datetime, rejected_at, HOUR) < 24) AS late_rejections,
    COUNTIF(rejected_at IS NOT NULL AND dispatch_stat = 'Driver no show') AS rej_driver_no_show,
    COUNTIF(rejected_at IS NOT NULL AND dispatch_stat = 'Cancelled') AS rej_cancelled,
    COUNTIF(rejected_at IS NOT NULL AND dispatch_stat = 'Rejected') AS rej_rejected
  FROM h GROUP BY m
)
SELECT
  tr.m AS month_start,
  FORMAT_DATE('%Y-%m', tr.m) AS month_label,
  a.attempts,
  tr.delivered_trips,
  a.rejections,
  a.trips_needing_2nd_fleet,
  a.late_rejections,
  a.rej_driver_no_show,
  a.rej_cancelled,
  a.rej_rejected,
  SAFE_DIVIDE(a.rejections, a.attempts) AS rejection_rate,
  SAFE_DIVIDE(a.late_rejections, a.rejections) AS late_rejection_share,
  SAFE_DIVIDE(a.trips_needing_2nd_fleet, tr.delivered_trips) AS trips_needing_2nd_fleet_rate,
  SAFE_DIVIDE(a.rej_driver_no_show, a.rejections) AS share_driver_no_show,
  SAFE_DIVIDE(a.rej_cancelled, a.rejections) AS share_cancelled,
  SAFE_DIVIDE(a.rej_rejected, a.rejections) AS share_rejected
FROM trips tr
LEFT JOIN att a USING (m)
ORDER BY tr.m` }

// ─── SQL — Dataset 2: od_kpis ─────────────────────────────────────────────────
function sqlKpis(rStart: string, rEnd: string): string { return `
WITH params AS (
  SELECT DATE '2023-01-01' AS data_start,
         DATE '${rStart}' AS range_start,
         DATE '${rEnd}'   AS range_end
),
win AS (
  SELECT p.*,
    DATE_DIFF(range_end, range_start, MONTH) + 1 AS n_months,
    GREATEST(data_start,
      DATE_SUB(range_start, INTERVAL DATE_DIFF(range_end, range_start, MONTH) + 1 MONTH)) AS prior_start,
    DATE_SUB(range_start, INTERVAL 1 MONTH) AS prior_end
  FROM params p
),
t AS (
  SELECT f.ride_id, f.trip_no, DATE_TRUNC(f.pickup_date, MONTH) AS m, f.pickup_datetime
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\` f, win w
  WHERE f.pickup_date BETWEEN w.prior_start AND LAST_DAY(w.range_end)
),
h AS (
  SELECT t.m, t.ride_id, t.trip_no, t.pickup_datetime, hh.rejected_at
  FROM t
  JOIN \`elife-data-warehouse-prod.dwb.dwb_dispatch_detail_history\` hh USING (ride_id, trip_no)
  WHERE hh.dispatch_version >= 1
),
cur_t AS (
  SELECT COUNT(*) AS trips FROM t, win w WHERE t.m BETWEEN w.range_start AND w.range_end
),
cur_h AS (
  SELECT
    COUNT(*) AS attempts,
    COUNTIF(rejected_at IS NOT NULL) AS rejections,
    COUNT(DISTINCT IF(rejected_at IS NOT NULL,
      CONCAT(CAST(ride_id AS STRING), '-', CAST(trip_no AS STRING)), NULL)) AS multi,
    COUNTIF(rejected_at IS NOT NULL
            AND TIMESTAMP_DIFF(pickup_datetime, rejected_at, HOUR) < 24) AS late
  FROM h, win w WHERE h.m BETWEEN w.range_start AND w.range_end
),
pri_h AS (
  SELECT COUNT(*) AS attempts, COUNTIF(rejected_at IS NOT NULL) AS rejections
  FROM h, win w WHERE h.m BETWEEN w.prior_start AND w.prior_end
)
SELECT
  c.attempts AS dispatch_attempts,
  ct.trips AS delivered_trips,
  SAFE_DIVIDE(c.attempts, ct.trips) AS attempts_per_delivered_trip,
  SAFE_DIVIDE(c.rejections, c.attempts) AS rejection_rate,
  SAFE_DIVIDE(
    SAFE_DIVIDE(c.rejections, c.attempts) - SAFE_DIVIDE(p.rejections, p.attempts),
    SAFE_DIVIDE(p.rejections, p.attempts)
  ) AS rejection_rate_vs_prior,
  SAFE_DIVIDE(c.multi, ct.trips) AS trips_needing_2nd_fleet,
  SAFE_DIVIDE(c.late, c.rejections) AS rejections_inside_24h,
  w.n_months
FROM cur_h c CROSS JOIN cur_t ct CROSS JOIN pri_h p CROSS JOIN win w` }

// ─── SQL — Dataset 3: od_fleet ────────────────────────────────────────────────
function sqlFleet(asAt: string): string { return `
WITH params AS (SELECT DATE '${asAt}' AS as_at_month),
win AS (
  SELECT DATE_SUB(as_at_month, INTERVAL 11 MONTH) AS ws, LAST_DAY(as_at_month) AS we FROM params
),
t AS (
  SELECT f.ride_id, f.trip_no, f.pickup_datetime
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\` f, win w
  WHERE f.pickup_date BETWEEN w.ws AND w.we
),
names AS (
  SELECT to_fleet_id AS fid,
    ARRAY_AGG(TRIM(to_fleet) ORDER BY pickup_date DESC, ride_id DESC LIMIT 1)[SAFE_OFFSET(0)] AS fleet_name
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\`, params p
  WHERE pickup_date BETWEEN DATE '2023-01-01' AND LAST_DAY(p.as_at_month)
    AND to_fleet IS NOT NULL
  GROUP BY 1
),
h AS (
  SELECT t.pickup_datetime, hh.to_fleet_id, hh.dispatch_version, hh.is_final_dispatch,
         hh.rejected_at, hh.dispatch_inserted_at
  FROM t
  JOIN \`elife-data-warehouse-prod.dwb.dwb_dispatch_detail_history\` hh USING (ride_id, trip_no)
  WHERE hh.dispatch_version >= 1
),
fleet AS (
  SELECT to_fleet_id AS fid,
    COUNT(*) AS attempts_received,
    COUNTIF(is_final_dispatch = 1) AS delivered,
    COUNTIF(rejected_at IS NOT NULL) AS rejected,
    COUNTIF(rejected_at IS NOT NULL
            AND TIMESTAMP_DIFF(pickup_datetime, rejected_at, HOUR) < 24) AS late_rejections,
    APPROX_QUANTILES(IF(rejected_at IS NOT NULL,
      TIMESTAMP_DIFF(rejected_at, dispatch_inserted_at, HOUR), NULL), 100)[OFFSET(50)] AS median_hold_hours,
    COUNTIF(is_final_dispatch = 1 AND dispatch_version > 1) AS caught_from_others
  FROM h GROUP BY 1
)
SELECT
  f.fid AS fleet_id,
  CASE WHEN f.fid = 15 THEN '(no dim_fleet record)'
       ELSE IFNULL(n.fleet_name, CONCAT('Fleet ', CAST(f.fid AS STRING))) END AS fleet_name,
  f.attempts_received,
  f.delivered,
  f.rejected,
  SAFE_DIVIDE(f.rejected, f.attempts_received) AS rejection_rate,
  f.late_rejections,
  IF(f.rejected > 0, f.median_hold_hours, NULL) AS median_hold_hours,
  f.caught_from_others
FROM fleet f
LEFT JOIN names n USING (fid)
ORDER BY f.attempts_received DESC
LIMIT 30` }

// ─── SQL — Dataset 4: od_airport ─────────────────────────────────────────────
function sqlAirport(asAt: string): string { return `
WITH params AS (SELECT DATE '${asAt}' AS as_at_month),
win AS (
  SELECT DATE_SUB(as_at_month, INTERVAL 11 MONTH) AS ws, LAST_DAY(as_at_month) AS we FROM params
),
t AS (
  SELECT f.ride_id, f.trip_no
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\` f, win w
  WHERE f.pickup_date BETWEEN w.ws AND w.we
),
r AS (
  SELECT v.ride_id, v.trip_no, COALESCE(v.pickup_airport_code3, v.dropoff_airport_code3) AS airport
  FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\` v, win w
  WHERE v.pickup_date BETWEEN w.ws AND w.we
),
h AS (
  SELECT hh.ride_id, hh.trip_no, hh.is_final_dispatch, hh.rejected_at
  FROM t
  JOIN \`elife-data-warehouse-prod.dwb.dwb_dispatch_detail_history\` hh USING (ride_id, trip_no)
  WHERE hh.dispatch_version >= 1
)
SELECT
  r.airport,
  COUNT(*) AS attempts,
  COUNTIF(h.is_final_dispatch = 1) AS delivered,
  COUNTIF(h.rejected_at IS NOT NULL) AS rejected,
  SAFE_DIVIDE(COUNTIF(h.rejected_at IS NOT NULL), COUNT(*)) AS rejection_rate,
  SAFE_DIVIDE(COUNT(*), COUNTIF(h.is_final_dispatch = 1)) AS attempts_per_trip
FROM h
JOIN r USING (ride_id, trip_no)
WHERE r.airport IS NOT NULL
GROUP BY r.airport
ORDER BY attempts DESC
LIMIT 20` }

// ─── SQL — Dataset 5: od_rejection_status ─────────────────────────────────────
function sqlRejectionStatus(asAt: string): string { return `
WITH params AS (SELECT DATE '${asAt}' AS as_at_month),
win AS (
  SELECT DATE_SUB(as_at_month, INTERVAL 11 MONTH) AS ws, LAST_DAY(as_at_month) AS we FROM params
),
t AS (
  SELECT f.ride_id, f.trip_no
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\` f, win w
  WHERE f.pickup_date BETWEEN w.ws AND w.we
),
rej AS (
  SELECT hh.dispatch_stat, IFNULL(hh.assign_stat, '(none)') AS assign_stat
  FROM t
  JOIN \`elife-data-warehouse-prod.dwb.dwb_dispatch_detail_history\` hh USING (ride_id, trip_no)
  WHERE hh.dispatch_version >= 1 AND hh.rejected_at IS NOT NULL
),
g AS (
  SELECT dispatch_stat, assign_stat, COUNT(*) AS rejections FROM rej GROUP BY 1, 2
)
SELECT
  dispatch_stat,
  assign_stat,
  rejections,
  SAFE_DIVIDE(rejections, SUM(rejections) OVER ()) AS share
FROM g
ORDER BY rejections DESC
LIMIT 12` }

// ─── SQL — Dataset 6: od_rebound_pairs ────────────────────────────────────────
function sqlReboundPairs(asAt: string): string { return `
WITH params AS (SELECT DATE '${asAt}' AS as_at_month),
win AS (
  SELECT DATE_SUB(as_at_month, INTERVAL 11 MONTH) AS ws, LAST_DAY(as_at_month) AS we FROM params
),
t AS (
  SELECT f.ride_id, f.trip_no, f.to_fleet_id AS delivered_by
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\` f, win w
  WHERE f.pickup_date BETWEEN w.ws AND w.we
),
names AS (
  SELECT to_fleet_id AS fid,
    ARRAY_AGG(TRIM(to_fleet) ORDER BY pickup_date DESC, ride_id DESC LIMIT 1)[SAFE_OFFSET(0)] AS fleet_name
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\`, params p
  WHERE pickup_date BETWEEN DATE '2023-01-01' AND LAST_DAY(p.as_at_month)
    AND to_fleet IS NOT NULL
  GROUP BY 1
),
pairs AS (
  SELECT hh.to_fleet_id AS rejected_by, t.delivered_by, COUNT(*) AS trips
  FROM t
  JOIN \`elife-data-warehouse-prod.dwb.dwb_dispatch_detail_history\` hh USING (ride_id, trip_no)
  WHERE hh.dispatch_version >= 1 AND hh.rejected_at IS NOT NULL
  GROUP BY 1, 2
)
SELECT
  CASE WHEN p.rejected_by = 15 THEN '(no dim_fleet record)'
       ELSE IFNULL(a.fleet_name, CONCAT('Fleet ', CAST(p.rejected_by AS STRING))) END AS rejected_by_name,
  p.rejected_by,
  CASE WHEN p.delivered_by = 15 THEN '(no dim_fleet record)'
       ELSE IFNULL(b.fleet_name, CONCAT('Fleet ', CAST(p.delivered_by AS STRING))) END AS delivered_by_name,
  p.delivered_by,
  p.trips
FROM pairs p
LEFT JOIN names a ON a.fid = p.rejected_by
LEFT JOIN names b ON b.fid = p.delivered_by
ORDER BY p.trips DESC
LIMIT 15` }

// ─── Serve ────────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  try {
    const body = await req.json().catch(() => ({}))
    const {
      asAtMonth  = '2026-08-01',
      rangeStart = '2025-09-01',
      rangeEnd   = '2026-08-01',
      dataset    = 'all',
    } = body

    const asAt   = toDate(asAtMonth,  '2026-08-01')
    const rStart = toDate(rangeStart, '2025-09-01')
    const rEnd   = toDate(rangeEnd,   '2026-08-01')

    const svcJson = Deno.env.get('BIGQUERY_SERVICE_ACCOUNT_JSON')
               ?? Deno.env.get('GA4_SERVICE_ACCOUNT_JSON')
    if (!svcJson)   throw new Error('BIGQUERY_SERVICE_ACCOUNT_JSON not configured')
    const projectId = Deno.env.get('BIGQUERY_PROJECT_ID')
    if (!projectId) throw new Error('BIGQUERY_PROJECT_ID not configured')

    const token = await getBQToken(svcJson)

    const jobs: { key: string; promise: Promise<Record<string,unknown>[]> }[] = []

    if (dataset === 'all' || dataset === 'monthly')
      jobs.push({ key:'monthly',          promise: runQuery(projectId, sqlMonthly(asAt), token) })
    if (dataset === 'all' || dataset === 'kpis')
      jobs.push({ key:'kpis',             promise: runQuery(projectId, sqlKpis(rStart, rEnd), token) })
    if (dataset === 'all' || dataset === 'fixed' || dataset === 'fleet')
      jobs.push({ key:'fleet',            promise: runQuery(projectId, sqlFleet(asAt), token) })
    if (dataset === 'all' || dataset === 'fixed' || dataset === 'airport')
      jobs.push({ key:'airport',          promise: runQuery(projectId, sqlAirport(asAt), token) })
    if (dataset === 'all' || dataset === 'fixed' || dataset === 'rejection_status')
      jobs.push({ key:'rejection_status', promise: runQuery(projectId, sqlRejectionStatus(asAt), token) })
    if (dataset === 'all' || dataset === 'fixed' || dataset === 'rebound_pairs')
      jobs.push({ key:'rebound_pairs',    promise: runQuery(projectId, sqlReboundPairs(asAt), token) })

    const results = await Promise.all(jobs.map(j => j.promise))
    const payload: Record<string,unknown> = {
      meta: { as_at_month:asAt, range_start:rStart, range_end:rEnd, queried_at: new Date().toISOString() }
    }
    jobs.forEach(({ key }, i) => {
      payload[key] = key === 'kpis' ? (results[i][0] ?? null) : results[i]
    })

    return new Response(JSON.stringify(payload), {
      headers: { ...CORS, 'Content-Type':'application/json' }
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[fleet-analysis-ovd]', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...CORS, 'Content-Type':'application/json' }
    })
  }
})
