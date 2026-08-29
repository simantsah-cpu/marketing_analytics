import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// ─────────────────────────────────────────────────────────────────────────────
// CORS headers — identical pattern to all other Orbit edge functions
// ─────────────────────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ─────────────────────────────────────────────────────────────────────────────
// BigQuery auth — verbatim from leadership-dashboard / destination-analysis
// ─────────────────────────────────────────────────────────────────────────────
async function getBQAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson)
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: sa.client_email,
    scope: [
      'https://www.googleapis.com/auth/bigquery',
      'https://www.googleapis.com/auth/cloud-platform',
    ].join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }

  const enc = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(payload)}`

  const pemBody = sa.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')

  const keyData = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(unsigned),
  )

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const jwt = `${unsigned}.${sig}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) {
    throw new Error(`BQ token error: ${JSON.stringify(tokenData)}`)
  }
  return tokenData.access_token
}

// ─────────────────────────────────────────────────────────────────────────────
// BigQuery query runner — uses polling for long-running jobs (>120s timeout)
// ─────────────────────────────────────────────────────────────────────────────
async function extractJsonRow(result: any): Promise<Record<string, unknown>> {
  const fields: string[] = (result.schema?.fields ?? []).map((f: { name: string }) => f.name)
  const cells = result.rows?.[0]?.f ?? []
  const out: Record<string, unknown> = {}
  fields.forEach((name, i) => {
    const raw = cells[i]?.v
    try {
      out[name] = raw ? JSON.parse(raw) : null
    } catch {
      out[name] = raw ?? null
    }
  })
  return out
}

async function pollJob(
  projectId: string,
  jobId: string,
  location: string,
  accessToken: string,
  maxAttempts = 24,
): Promise<Record<string, unknown>> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5_000))
    const res = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}` +
      `?location=${location}&timeoutMs=30000`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (!res.ok) throw new Error(`BQ poll error ${res.status}: ${await res.text()}`)
    const payload = await res.json()
    if (payload.jobComplete) return extractJsonRow(payload)
  }
  throw new Error('BigQuery job did not complete in time (max 2 min polling)')
}

async function runQuery(
  projectId: string,
  sql: string,
  startDate: string,
  endDate: string,
  location: string,
  accessToken: string,
  accountNames?: string[],
): Promise<{ data: Record<string, unknown>; bytesProcessed: number }> {
  const queryParameters: object[] = [
    { name: 'start_date', parameterType: { type: 'DATE' }, parameterValue: { value: startDate } },
    { name: 'end_date',   parameterType: { type: 'DATE' }, parameterValue: { value: endDate   } },
  ]
  if (accountNames && accountNames.length > 0) {
    queryParameters.push({
      name: 'account_names',
      parameterType: { type: 'ARRAY', arrayType: { type: 'STRING' } },
      parameterValue: { arrayValues: accountNames.map((v) => ({ value: v })) },
    })
  }
  const body = {
    query: sql,
    useLegacySql: false,
    parameterMode: 'NAMED',
    queryParameters,
    timeoutMs: 120_000,
    location,
  }

  const res = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )

  let payload = await res.json()
  if (!res.ok) throw new Error(`BigQuery error: ${JSON.stringify(payload.error ?? payload)}`)

  if (!payload.jobComplete) {
    const jobId = payload.jobReference?.jobId
    if (!jobId) throw new Error('BigQuery did not return a job ID')
    const data = await pollJob(projectId, jobId, location, accessToken)
    return { data, bytesProcessed: Number(payload.totalBytesProcessed ?? 0) }
  }

  return {
    data: await extractJsonRow(payload),
    bytesProcessed: Number(payload.totalBytesProcessed ?? 0),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory result cache — keyed on "${start_date}|${end_date}", TTL 15 min
// ─────────────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 15 * 60 * 1000
const cache = new Map<string, { at: number; value: unknown }>()

// ─────────────────────────────────────────────────────────────────────────────
// SQL v2 — rebuilt per Wilson review + Complaint Summary Report Data Dictionary
// All auth / caching / param wiring above is unchanged from v1.
//
// Key changes from v1:
//   1. Grain = trip (ride_id + trip_no), already unique — no GROUP BY ride_id
//   2. ride_stat 'Unpaid' excluded
//   3. Revenue -> Complete GMV = elife_amount_usd + additional_charge_amount_usd
//   4. "Complete" = pickup_datetime < NOW() (not dispatch_stat = 'At destination')
//   5. customer_name / partner from dim.dim_fleet_as_customer
//   6. Complaint rate uses Valid Trips denominator
//   7. customer_cohort replaces partner_cohort
// ─────────────────────────────────────────────────────────────────────────────
function buildSQL(accountFilter: string): string { return `
WITH
params AS (
  SELECT
    @start_date                                                        AS win_start,
    LEAST(@end_date, CURRENT_DATE())                                   AS win_end,
    DATE_TRUNC(@start_date, MONTH)                                     AS win_start_month,
    DATE_SUB(DATE_TRUNC(@start_date, MONTH), INTERVAL 1 MONTH)         AS lag_floor,
    DATE '2019-01-01'                                                  AS history_floor
),

-- ONE scan. Grain = trip (ride_id + trip_no), which is already unique.
-- Scanned from history_floor so cohort anchors see full history.
scope AS (
  SELECT
    v.ride_id, v.trip_no, v.pickup_date,
    v.from_fleet_id_as_customer                        AS fleet_id,
    d.customer_name,
    COALESCE(d.partner, '(unmapped)')                  AS partner,
    d.customer_type, d.existing_partner,
    v.passenger_id, v.ride_stat, v.dispatch_stat,
    v.has_complaint, v.has_ops_complaint,
    CAST(IFNULL(v.elife_amount_usd, 0)                 AS FLOAT64)
      + CAST(IFNULL(v.additional_charge_amount_usd, 0) AS FLOAT64)     AS gmv,
    CAST(IFNULL(v.dispatch_amount_net_usd, 0)          AS FLOAT64)     AS cost
  FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\` v
  LEFT JOIN \`elife-data-warehouse-prod.dim.dim_fleet_as_customer\` d
    ON v.from_fleet_id_as_customer = d.fleet_id
  , params p
  WHERE v.pickup_date BETWEEN p.history_floor AND p.win_end
    AND v.ride_stat IN ('Cancelled', 'Accepted', 'Pending')
    AND v.pickup_datetime < CURRENT_TIMESTAMP()
),

-- Window-filtered trips. __ACCOUNT_FILTER__ is replaced at runtime.
trips AS (
  SELECT s.* FROM scope s, params p
  WHERE s.pickup_date BETWEEN p.win_start AND p.win_end
  ${accountFilter}
),

-- Cohort anchors from facts, NOT dim.first_trade_date
-- (NULL for 64.5% of active fleets; disagrees with facts for the rest).
fleet_first AS (
  SELECT fleet_id, DATE_TRUNC(MIN(pickup_date), MONTH) AS first_month
  FROM scope GROUP BY fleet_id
),
cust_first AS (
  SELECT customer_name, DATE_TRUNC(MIN(pickup_date), MONTH) AS first_month
  FROM scope WHERE customer_name IS NOT NULL GROUP BY customer_name
),

-- Activity seeded one month before window (feeds LAG in flow).
act_ext AS (
  SELECT s.fleet_id, DATE_TRUNC(s.pickup_date, MONTH) AS am,
         COUNT(*) AS n_trips, SUM(s.gmv) AS gmv
  FROM scope s, params p WHERE s.pickup_date >= p.lag_floor
  GROUP BY 1, 2
),
acct_activity AS (
  SELECT a.* FROM act_ext a, params p WHERE a.am >= p.win_start_month
),

-- 1. KPI header
kpis AS (
  SELECT TO_JSON_STRING(STRUCT(
    COUNT(*)                                                   AS service_trips,
    COUNT(DISTINCT ride_id)                                    AS service_rides,
    COUNTIF(ride_stat = 'Cancelled')                           AS cancelled_trips,
    COUNTIF(dispatch_stat = 'At destination'
            AND IFNULL(ride_stat,'') <> 'Cancelled')         AS delivered_trips,
    ROUND(SUM(gmv), 2)                                         AS complete_gmv,
    ROUND(SUM(cost), 2)                                        AS cost,
    ROUND(SUM(gmv) - SUM(cost), 2)                             AS profit,
    ROUND(SAFE_DIVIDE(SUM(gmv)-SUM(cost), SUM(gmv))*100, 2)    AS profit_margin_pct,
    ROUND(SAFE_DIVIDE(COUNTIF(ride_stat='Cancelled'), COUNT(*))*100, 2) AS cancel_pct,
    ROUND(SAFE_DIVIDE(SUM(gmv), COUNT(*)), 2)                  AS avg_gmv_per_trip,
    COUNTIF(ride_stat IN ('Accepted','Pending')
            OR (ride_stat='Cancelled' AND has_complaint=1))    AS valid_trips,
    ROUND(SAFE_DIVIDE(SUM(has_ops_complaint),
      COUNTIF(ride_stat IN ('Accepted','Pending')
              OR (ride_stat='Cancelled' AND has_complaint=1)))*100, 2) AS complaint_rate,
    ROUND(SAFE_DIVIDE(SUM(has_complaint),
      COUNTIF(ride_stat IN ('Accepted','Pending')
              OR (ride_stat='Cancelled' AND has_complaint=1)))*100, 2) AS all_incidence_rate,
    COUNT(DISTINCT fleet_id)                                   AS accounts,
    COUNT(DISTINCT customer_name)                              AS customer_names,
    COUNT(DISTINCT partner)                                    AS partners
  )) AS j FROM trips
),

-- 2. Monthly trend
monthly AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(m, service_trips, service_rides,
           cancel_pct, complaint_rate, complete_gmv, cost, profit, profit_margin_pct,
           avg_gmv_per_trip) ORDER BY m)) AS j
  FROM (
    SELECT FORMAT_DATE('%Y-%m', DATE_TRUNC(pickup_date, MONTH)) AS m,
      COUNT(*)                AS service_trips,
      COUNT(DISTINCT ride_id) AS service_rides,
      ROUND(SAFE_DIVIDE(COUNTIF(ride_stat='Cancelled'), COUNT(*))*100, 2) AS cancel_pct,
      ROUND(SAFE_DIVIDE(SUM(has_ops_complaint),
        COUNTIF(ride_stat IN ('Accepted','Pending')
                OR (ride_stat='Cancelled' AND has_complaint=1)))*100, 2) AS complaint_rate,
      ROUND(SUM(gmv), 2)                AS complete_gmv,
      ROUND(SUM(cost), 2)               AS cost,
      ROUND(SUM(gmv)-SUM(cost), 2)      AS profit,
      ROUND(SAFE_DIVIDE(SUM(gmv)-SUM(cost), SUM(gmv))*100, 2) AS profit_margin_pct,
      ROUND(SAFE_DIVIDE(SUM(gmv), COUNT(*)), 2) AS avg_gmv_per_trip
    FROM trips GROUP BY m
  )
),

-- 3. Account cohort grid (fleet_id)
account_cohort AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(cohort, mi, accounts, trips, gmv)
           ORDER BY cohort, mi)) AS j
  FROM (
    SELECT
      IF(f.first_month < p.win_start_month, '__PRE__',
         FORMAT_DATE('%Y-%m', f.first_month))               AS cohort,
      IF(f.first_month < p.win_start_month,
         DATE_DIFF(a.am, p.win_start_month, MONTH),
         DATE_DIFF(a.am, f.first_month, MONTH))             AS mi,
      COUNT(DISTINCT a.fleet_id) AS accounts,
      SUM(a.n_trips)             AS trips,
      ROUND(SUM(a.gmv), 2)       AS gmv
    FROM acct_activity a JOIN fleet_first f USING (fleet_id), params p
    GROUP BY cohort, mi HAVING mi >= 0
  )
),

-- 4. Customer cohort grid (customer_name from dim) — replaces v1 partner_id cohort
cust_activity AS (
  SELECT customer_name, DATE_TRUNC(pickup_date, MONTH) AS am,
         COUNT(*) AS n_trips, SUM(gmv) AS gmv
  FROM trips WHERE customer_name IS NOT NULL GROUP BY 1, 2
),
customer_cohort AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(cohort, mi, customers, trips, gmv)
           ORDER BY cohort, mi)) AS j
  FROM (
    SELECT
      IF(f.first_month < p.win_start_month, '__PRE__',
         FORMAT_DATE('%Y-%m', f.first_month))               AS cohort,
      IF(f.first_month < p.win_start_month,
         DATE_DIFF(a.am, p.win_start_month, MONTH),
         DATE_DIFF(a.am, f.first_month, MONTH))             AS mi,
      COUNT(DISTINCT a.customer_name) AS customers,
      SUM(a.n_trips)                  AS trips,
      ROUND(SUM(a.gmv), 2)            AS gmv
    FROM cust_activity a JOIN cust_first f USING (customer_name), params p
    GROUP BY cohort, mi HAVING mi >= 0
  )
),

-- 5. Account flow
flow_base AS (
  SELECT a.fleet_id, a.am, a.gmv, f.first_month,
    LAG(a.gmv) OVER (PARTITION BY a.fleet_id ORDER BY a.am) AS prev_gmv,
    DATE_DIFF(a.am, LAG(a.am) OVER (PARTITION BY a.fleet_id ORDER BY a.am),
              MONTH)                                        AS gap
  FROM act_ext a JOIN fleet_first f USING (fleet_id)
),
flow AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(m, active, new_accounts, retained,
           reactivated, gmv, new_gmv, expansion, contraction) ORDER BY m)) AS j
  FROM (
    SELECT FORMAT_DATE('%Y-%m', fb.am) AS m,
      COUNT(DISTINCT fb.fleet_id) AS active,
      COUNT(DISTINCT IF(fb.first_month = fb.am, fb.fleet_id, NULL)) AS new_accounts,
      COUNT(DISTINCT IF(fb.first_month < fb.am AND fb.gap = 1,
                        fb.fleet_id, NULL)) AS retained,
      COUNT(DISTINCT IF(fb.first_month < fb.am AND (fb.gap > 1 OR fb.gap IS NULL),
                        fb.fleet_id, NULL)) AS reactivated,
      ROUND(SUM(fb.gmv), 2) AS gmv,
      ROUND(SUM(IF(fb.first_month = fb.am, fb.gmv, 0)), 2) AS new_gmv,
      ROUND(SUM(IF(fb.first_month < fb.am AND fb.gap = 1 AND fb.gmv > fb.prev_gmv,
                   fb.gmv - fb.prev_gmv, 0)), 2) AS expansion,
      ROUND(SUM(IF(fb.first_month < fb.am AND fb.gap = 1 AND fb.gmv < fb.prev_gmv,
                   fb.prev_gmv - fb.gmv, 0)), 2) AS contraction
    FROM flow_base fb, params p
    WHERE fb.am >= p.win_start_month
    GROUP BY m
  )
),

-- 6. Account value tiers (banded on Complete GMV)
acct_totals AS (
  SELECT t.fleet_id,
    COUNT(*) AS n_trips, SUM(t.gmv) AS gmv, SUM(t.cost) AS cost,
    COUNT(DISTINCT DATE_TRUNC(t.pickup_date, MONTH)) AS months_active,
    DATE_DIFF((SELECT win_end FROM params), MAX(t.pickup_date), DAY) AS recency_days
  FROM trips t GROUP BY t.fleet_id
),
tiers AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(tier, accounts, gmv, pct_gmv, profit,
           trips, avg_months_active, dormant_90d) ORDER BY tier)) AS j
  FROM (
    SELECT
      CASE WHEN gmv >= 1000000 THEN 'A. $1M+'
           WHEN gmv >=  100000 THEN 'B. $100k-1M'
           WHEN gmv >=   10000 THEN 'C. $10k-100k'
           WHEN gmv >=    1000 THEN 'D. $1k-10k'
           ELSE                     'E. <$1k' END AS tier,
      COUNT(*)               AS accounts,
      ROUND(SUM(gmv), 2)     AS gmv,
      ROUND(SUM(gmv) / SUM(SUM(gmv)) OVER () * 100, 2) AS pct_gmv,
      ROUND(SUM(gmv) - SUM(cost), 2) AS profit,
      SUM(n_trips)           AS trips,
      ROUND(AVG(months_active), 1) AS avg_months_active,
      COUNTIF(recency_days > 90)   AS dormant_90d
    FROM acct_totals GROUP BY tier
  )
),

-- 7. Partner profitability (Wilson sign-off)
-- Grouped by customer_name + partner — do NOT collapse by partner alone
-- (130 partners map to >1 customer_name).
-- Note: 12 of 360 customer+partner groups carry negative margin (dispatch cost > fare).
-- This is real data — small-volume routes where eLife pays out more than it receives.
partners AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(customer_name, partner, customer_type,
           existing_partner, accounts, service_trips, service_rides, cancelled_trips,
           cancel_pct, complaint_rate, complete_gmv, cost, profit, profit_margin_pct,
           avg_gmv_per_trip) ORDER BY complete_gmv DESC)) AS j
  FROM (
    SELECT customer_name, partner,
      ANY_VALUE(customer_type) AS customer_type,
      MAX(existing_partner)    AS existing_partner,
      COUNT(DISTINCT fleet_id) AS accounts,
      COUNT(*)                 AS service_trips,
      COUNT(DISTINCT ride_id)  AS service_rides,
      COUNTIF(ride_stat='Cancelled') AS cancelled_trips,
      ROUND(SAFE_DIVIDE(COUNTIF(ride_stat='Cancelled'), COUNT(*))*100, 1) AS cancel_pct,
      ROUND(SAFE_DIVIDE(SUM(has_ops_complaint),
        COUNTIF(ride_stat IN ('Accepted','Pending')
                OR (ride_stat='Cancelled' AND has_complaint=1)))*100, 2) AS complaint_rate,
      ROUND(SUM(gmv), 2)  AS complete_gmv,
      ROUND(SUM(cost), 2) AS cost,
      ROUND(SUM(gmv)-SUM(cost), 2) AS profit,
      ROUND(SAFE_DIVIDE(SUM(gmv)-SUM(cost), SUM(gmv))*100, 1) AS profit_margin_pct,
      ROUND(SAFE_DIVIDE(SUM(gmv), COUNT(*)), 2) AS avg_gmv_per_trip
    FROM trips GROUP BY customer_name, partner
  )
),

-- 8. Passenger repeat purchase
-- Bucketed by DISTINCT BOOKINGS (ride_id), not trips.
-- Trip-based bucketing inflates repeat rate: 10.36% vs true 1.75%.
person AS (
  SELECT cu.person_id,
         COUNT(DISTINCT t.ride_id) AS n_bookings,
         COUNT(*)                  AS n_trips,
         SUM(t.gmv)                AS gmv
  FROM trips t
  JOIN \`elife-data-warehouse-prod.ods.ride_customer\` cu ON t.passenger_id = cu.id
  WHERE cu.person_id IS NOT NULL
  GROUP BY cu.person_id
),
passengers AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(bucket, customers, pct_customers,
           bookings, trips, gmv, pct_gmv, avg_ltv) ORDER BY sort_key)) AS j
  FROM (
    SELECT
      CASE WHEN n_bookings = 1 THEN '1 booking'
           WHEN n_bookings = 2 THEN '2 bookings'
           WHEN n_bookings <= 4 THEN '3-4 bookings'
           WHEN n_bookings <= 9 THEN '5-9 bookings'
           ELSE '10+ bookings' END AS bucket,
      MIN(n_bookings) AS sort_key,
      COUNT(*)        AS customers,
      ROUND(COUNT(*) / SUM(COUNT(*)) OVER () * 100, 3) AS pct_customers,
      SUM(n_bookings) AS bookings,
      SUM(n_trips)    AS trips,
      ROUND(SUM(gmv), 2) AS gmv,
      ROUND(SUM(gmv) / SUM(SUM(gmv)) OVER () * 100, 2) AS pct_gmv,
      ROUND(AVG(gmv), 2) AS avg_ltv
    FROM person GROUP BY bucket
  )
),

-- Customer dropdown — populates the All Customers multi-select filter in the UI
top_accounts AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(account_name, gmv, service_trips)
           ORDER BY gmv DESC)) AS j
  FROM (
    SELECT
      customer_name            AS account_name,
      ROUND(SUM(gmv), 2)       AS gmv,
      COUNT(*)                 AS service_trips
    FROM trips
    WHERE customer_name IS NOT NULL AND customer_name != ''
    GROUP BY customer_name
  )
)

SELECT
  (SELECT j FROM kpis)            AS kpis,
  (SELECT j FROM monthly)         AS monthly,
  (SELECT j FROM account_cohort)  AS account_cohort,
  (SELECT j FROM customer_cohort) AS customer_cohort,
  (SELECT j FROM flow)            AS flow,
  (SELECT j FROM tiers)           AS tiers,
  (SELECT j FROM partners)        AS partners,
  (SELECT j FROM passengers)      AS passengers,
  (SELECT j FROM top_accounts)    AS top_accounts
` }

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────────
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MIN_DATE = '2019-01-01'

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // Secrets
    const serviceAccountJson = Deno.env.get('BIGQUERY_SERVICE_ACCOUNT_JSON')
    if (!serviceAccountJson) {
      return jsonResp({ error: 'BIGQUERY_SERVICE_ACCOUNT_JSON secret not configured' }, 500)
    }
    const projectId = Deno.env.get('BIGQUERY_PROJECT_ID')
    if (!projectId) {
      return jsonResp({ error: 'BIGQUERY_PROJECT_ID secret not configured' }, 500)
    }
    const location = Deno.env.get('BQ_LOCATION') ?? 'US'

    // Parse + validate request
    let body: { start_date?: string; end_date?: string; refresh?: boolean; account_names?: string[] } = {}
    try { body = await req.json() } catch { /* use defaults */ }

    const { start_date, end_date, refresh, account_names } = body
    const filteredNames = Array.isArray(account_names) && account_names.length > 0
      ? account_names.filter((n) => typeof n === 'string' && n.length > 0)
      : []

    if (!ISO_DATE.test(start_date ?? '') || !ISO_DATE.test(end_date ?? '')) {
      return jsonResp({ error: 'start_date and end_date are required as YYYY-MM-DD' }, 400)
    }
    if (start_date! > end_date!) {
      return jsonResp({ error: 'start_date must be on or before end_date' }, 400)
    }
    if (start_date! < MIN_DATE) {
      return jsonResp({ error: `start_date cannot be earlier than ${MIN_DATE}` }, 400)
    }

    // Cap end_date at today — never include forward bookings
    const today = new Date().toISOString().slice(0, 10)
    const cappedEnd = end_date! > today ? today : end_date!

    // Inject account name filter (v2: filter on s.customer_name from dim join)
    const accountClause = filteredNames.length > 0
      ? 'AND s.customer_name IN UNNEST(@account_names)'
      : ''
    const sql = buildSQL(accountClause)

    // Cache check (skip for filtered queries)
    const cacheKey = `${start_date}|${cappedEnd}`
    const hit = cache.get(cacheKey)
    if (hit && !refresh && !filteredNames.length && Date.now() - hit.at < CACHE_TTL_MS) {
      const cached = hit.value as any
      return jsonResp({ ...cached, meta: { ...cached.meta, cached: true } })
    }

    // Run BigQuery
    const t0 = Date.now()
    const accessToken = await getBQAccessToken(serviceAccountJson)
    const { data, bytesProcessed } = await runQuery(
      projectId, sql, start_date!, cappedEnd, location, accessToken,
      filteredNames.length ? filteredNames : undefined,
    )

    const value = {
      ...data,
      meta: {
        start_date,
        end_date: cappedEnd,
        end_date_capped: cappedEnd !== end_date,
        generated_at: new Date().toISOString(),
        elapsed_ms: Date.now() - t0,
        bytes_processed: bytesProcessed,
        cached: false,
      },
    }

    // Only cache unfiltered results
    if (!filteredNames.length) {
      cache.set(cacheKey, { at: Date.now(), value })
    }
    return jsonResp(value)

  } catch (err) {
    console.error('customer_analysis failed:', err)
    return jsonResp({ error: String(err instanceof Error ? err.message : err) }, 500)
  }
})
