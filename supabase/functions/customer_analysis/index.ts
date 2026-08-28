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
// Uses BIGQUERY_SERVICE_ACCOUNT_JSON (full JSON blob, already set in project)
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
// Returns ONE row with 8 JSON string columns; parses each with JSON.parse()
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

  // Long-running jobs return jobComplete: false — poll until done
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
// The SQL query (embedded to avoid Deno.readTextFile path issues in deploy)
// ─────────────────────────────────────────────────────────────────────────────
const SQL = `
WITH
params AS (
  SELECT
    @start_date                                                        AS win_start,
    LEAST(@end_date, CURRENT_DATE())                                   AS win_end,
    DATE_TRUNC(@start_date, MONTH)                                     AS win_start_month,
    DATE_SUB(DATE_TRUNC(@start_date, MONTH), INTERVAL 1 MONTH)         AS lag_floor,
    DATE '2019-01-01'                                                  AS history_floor
),
acct_names AS (
  SELECT fleet_id, IFNULL(NULLIF(customer_name,''), fleet_name) AS account_name
  FROM \`elife-data-warehouse-prod.dim.dim_fleet_as_customer\`
),
base AS (
  SELECT
    v.ride_id,
    MIN(v.pickup_date)                                     AS pickup_date,
    ANY_VALUE(v.partner_id)                                AS partner_id,
    ANY_VALUE(v.partner_name)                              AS partner_name,
    ANY_VALUE(v.from_fleet_id_as_customer)                 AS account_id,
    ANY_VALUE(an.account_name)                             AS account_name,
    ANY_VALUE(v.passenger_id)                              AS passenger_id,
    MAX(IF(v.dispatch_stat = 'At destination', 1, 0))      AS is_completed,
    MAX(IF(v.ride_stat = 'Cancelled', 1, 0))               AS is_cancelled,
    MAX(v.has_complaint)                                   AS has_complaint,
    CAST(ANY_VALUE(v.elife_amount_usd_by_trip) AS FLOAT64) AS revenue,
    CAST(SUM(v.dispatch_amount_net_usd)        AS FLOAT64) AS cost
  FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\` v
  LEFT JOIN acct_names an ON an.fleet_id = v.from_fleet_id_as_customer
  , params p
  WHERE v.pickup_date BETWEEN p.history_floor AND p.win_end
  GROUP BY v.ride_id
),
acct_first AS (
  SELECT account_id, DATE_TRUNC(MIN(pickup_date), MONTH) AS first_month
  FROM base WHERE is_completed = 1 GROUP BY account_id
),
partner_first AS (
  SELECT partner_id, DATE_TRUNC(MIN(pickup_date), MONTH) AS first_month
  FROM base WHERE is_completed = 1 GROUP BY partner_id
),
rides AS (
  SELECT b.* FROM base b, params p
  WHERE b.pickup_date BETWEEN p.win_start AND p.win_end
  __ACCOUNT_FILTER__
),
comp AS (SELECT * FROM rides WHERE is_completed = 1),
act_ext AS (
  SELECT b.account_id, DATE_TRUNC(b.pickup_date, MONTH) AS am,
         COUNT(*) AS rides, SUM(b.revenue) AS revenue
  FROM base b, params p
  WHERE b.is_completed = 1 AND b.pickup_date >= p.lag_floor AND b.pickup_date <= p.win_end
  GROUP BY 1, 2
),
acct_activity AS (
  SELECT a.* FROM act_ext a, params p WHERE a.am >= p.win_start_month
),
kpis AS (
  SELECT TO_JSON_STRING(STRUCT(
    COUNT(*)                                                     AS booked_rides,
    COUNTIF(is_completed = 1)                                    AS completed_rides,
    COUNTIF(is_cancelled = 1)                                    AS cancelled_rides,
    ROUND(SUM(IF(is_completed=1, revenue, 0)), 2)                AS revenue,
    ROUND(SUM(IF(is_completed=1, revenue - cost, 0)), 2)         AS margin,
    ROUND(SAFE_DIVIDE(SUM(IF(is_completed=1, revenue-cost, 0)),
                      SUM(IF(is_completed=1, revenue, 0)))*100,2) AS margin_pct,
    ROUND(SAFE_DIVIDE(COUNTIF(is_cancelled=1), COUNT(*))*100, 2) AS cancel_pct,
    ROUND(SAFE_DIVIDE(SUM(IF(is_completed=1, revenue, 0)),
                      COUNTIF(is_completed=1)), 2)               AS aov,
    COUNT(DISTINCT IF(is_completed=1, account_id, NULL))         AS accounts_completed,
    COUNT(DISTINCT account_id)                                   AS accounts_booked,
    COUNT(DISTINCT IF(is_completed=1, partner_id, NULL))         AS partners_completed,
    COUNT(DISTINCT partner_id)                                   AS partners_booked
  )) AS j FROM rides
),
monthly AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(m, booked, completed, cancel_pct,
           complaint_pct, revenue, margin, margin_pct, aov) ORDER BY m)) AS j
  FROM (
    SELECT FORMAT_DATE('%Y-%m', DATE_TRUNC(pickup_date, MONTH)) AS m,
      COUNT(*) AS booked,
      COUNTIF(is_completed=1) AS completed,
      ROUND(SAFE_DIVIDE(COUNTIF(is_cancelled=1), COUNT(*))*100, 2) AS cancel_pct,
      ROUND(SAFE_DIVIDE(COUNTIF(is_completed=1 AND has_complaint=1),
                        COUNTIF(is_completed=1))*100, 2) AS complaint_pct,
      ROUND(SUM(IF(is_completed=1, revenue, 0)), 2) AS revenue,
      ROUND(SUM(IF(is_completed=1, revenue-cost, 0)), 2) AS margin,
      ROUND(SAFE_DIVIDE(SUM(IF(is_completed=1, revenue-cost, 0)),
                        SUM(IF(is_completed=1, revenue, 0)))*100, 2) AS margin_pct,
      ROUND(SAFE_DIVIDE(SUM(IF(is_completed=1, revenue, 0)),
                        COUNTIF(is_completed=1)), 2) AS aov
    FROM rides GROUP BY m
  )
),
account_cohort AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(cohort, mi, accounts, rides, revenue)
           ORDER BY cohort, mi)) AS j
  FROM (
    SELECT
      IF(f.first_month < p.win_start_month, '__PRE__',
         FORMAT_DATE('%Y-%m', f.first_month))                    AS cohort,
      IF(f.first_month < p.win_start_month,
         DATE_DIFF(a.am, p.win_start_month, MONTH),
         DATE_DIFF(a.am, f.first_month, MONTH))                  AS mi,
      COUNT(DISTINCT a.account_id) AS accounts,
      SUM(a.rides)                 AS rides,
      ROUND(SUM(a.revenue), 2)     AS revenue
    FROM acct_activity a JOIN acct_first f USING (account_id), params p
    GROUP BY cohort, mi
    HAVING mi >= 0
  )
),
partner_activity AS (
  SELECT partner_id, DATE_TRUNC(pickup_date, MONTH) AS am,
         COUNT(*) AS rides, SUM(revenue) AS revenue
  FROM comp GROUP BY 1, 2
),
partner_cohort AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(cohort, mi, partners, rides, revenue)
           ORDER BY cohort, mi)) AS j
  FROM (
    SELECT
      IF(f.first_month < p.win_start_month, '__PRE__',
         FORMAT_DATE('%Y-%m', f.first_month))                    AS cohort,
      IF(f.first_month < p.win_start_month,
         DATE_DIFF(a.am, p.win_start_month, MONTH),
         DATE_DIFF(a.am, f.first_month, MONTH))                  AS mi,
      COUNT(DISTINCT a.partner_id) AS partners,
      SUM(a.rides)             AS rides,
      ROUND(SUM(a.revenue), 2) AS revenue
    FROM partner_activity a JOIN partner_first f USING (partner_id), params p
    GROUP BY cohort, mi
    HAVING mi >= 0
  )
),
flow_base AS (
  SELECT a.account_id, a.am, a.revenue, f.first_month,
    LAG(a.revenue) OVER (PARTITION BY a.account_id ORDER BY a.am) AS prev_rev,
    DATE_DIFF(a.am, LAG(a.am) OVER (PARTITION BY a.account_id ORDER BY a.am),
              MONTH)                                              AS gap
  FROM act_ext a JOIN acct_first f USING (account_id)
),
flow AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(m, active, new_accounts, retained,
           reactivated, revenue, new_revenue, expansion, contraction)
           ORDER BY m)) AS j
  FROM (
    SELECT FORMAT_DATE('%Y-%m', fb.am) AS m,
      COUNT(DISTINCT fb.account_id) AS active,
      COUNT(DISTINCT IF(fb.first_month = fb.am, fb.account_id, NULL)) AS new_accounts,
      COUNT(DISTINCT IF(fb.first_month < fb.am AND fb.gap = 1,
                        fb.account_id, NULL)) AS retained,
      COUNT(DISTINCT IF(fb.first_month < fb.am AND (fb.gap > 1 OR fb.gap IS NULL),
                        fb.account_id, NULL)) AS reactivated,
      ROUND(SUM(fb.revenue), 2) AS revenue,
      ROUND(SUM(IF(fb.first_month = fb.am, fb.revenue, 0)), 2) AS new_revenue,
      ROUND(SUM(IF(fb.first_month < fb.am AND fb.gap = 1 AND fb.revenue > fb.prev_rev,
                   fb.revenue - fb.prev_rev, 0)), 2) AS expansion,
      ROUND(SUM(IF(fb.first_month < fb.am AND fb.gap = 1 AND fb.revenue < fb.prev_rev,
                   fb.prev_rev - fb.revenue, 0)), 2) AS contraction
    FROM flow_base fb, params p
    WHERE fb.am >= p.win_start_month
    GROUP BY m
  )
),
acct_totals AS (
  SELECT c.account_id,
    COUNT(*) AS rides,
    SUM(c.revenue) AS revenue,
    COUNT(DISTINCT DATE_TRUNC(c.pickup_date, MONTH)) AS months_active,
    DATE_DIFF((SELECT win_end FROM params), MAX(c.pickup_date), DAY) AS recency_days
  FROM comp c GROUP BY c.account_id
),
tiers AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(tier, accounts, revenue, pct_revenue,
           rides, avg_months_active, dormant_90d) ORDER BY tier)) AS j
  FROM (
    SELECT
      CASE WHEN revenue >= 1000000 THEN 'A. $1M+'
           WHEN revenue >=  100000 THEN 'B. $100k-1M'
           WHEN revenue >=   10000 THEN 'C. $10k-100k'
           WHEN revenue >=    1000 THEN 'D. $1k-10k'
           ELSE                         'E. <$1k' END AS tier,
      COUNT(*)                 AS accounts,
      ROUND(SUM(revenue), 2)   AS revenue,
      ROUND(SUM(revenue) / SUM(SUM(revenue)) OVER () * 100, 2) AS pct_revenue,
      SUM(rides)               AS rides,
      ROUND(AVG(months_active), 1) AS avg_months_active,
      COUNTIF(recency_days > 90)   AS dormant_90d
    FROM acct_totals GROUP BY tier
  )
),
partners AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(partner_name, accounts, booked, completed,
           cancelled, cancel_pct, complaint_pct, aov, revenue, margin, margin_pct)
           ORDER BY revenue DESC)) AS j
  FROM (
    SELECT partner_name,
      COUNT(DISTINCT account_id) AS accounts,
      COUNT(*)                   AS booked,
      COUNTIF(is_completed = 1)  AS completed,
      COUNTIF(is_cancelled = 1)  AS cancelled,
      ROUND(SAFE_DIVIDE(COUNTIF(is_cancelled=1), COUNT(*))*100, 2) AS cancel_pct,
      ROUND(SAFE_DIVIDE(COUNTIF(is_completed=1 AND has_complaint=1),
                        COUNTIF(is_completed=1))*100, 2) AS complaint_pct,
      ROUND(SAFE_DIVIDE(SUM(IF(is_completed=1, revenue, 0)),
                        COUNTIF(is_completed=1)), 2) AS aov,
      ROUND(SUM(IF(is_completed=1, revenue, 0)), 2) AS revenue,
      ROUND(SUM(IF(is_completed=1, revenue - cost, 0)), 2) AS margin,
      ROUND(SAFE_DIVIDE(SUM(IF(is_completed=1, revenue-cost, 0)),
                        SUM(IF(is_completed=1, revenue, 0)))*100, 2) AS margin_pct
    FROM rides GROUP BY partner_name
    ORDER BY revenue DESC
  )
),
person AS (
  SELECT cu.person_id, COUNT(*) AS n, SUM(c.revenue) AS revenue
  FROM comp c
  JOIN \`elife-data-warehouse-prod.ods.ride_customer\` cu ON c.passenger_id = cu.id
  WHERE cu.person_id IS NOT NULL
  GROUP BY cu.person_id
),
passengers AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(bucket, customers, pct_customers,
           rides, revenue, pct_revenue, avg_ltv) ORDER BY sort_key)) AS j
  FROM (
    SELECT
      CASE WHEN n = 1 THEN '1 ride'    WHEN n = 2 THEN '2 rides'
           WHEN n <= 4 THEN '3-4 rides' WHEN n <= 9 THEN '5-9 rides'
           ELSE '10+ rides' END AS bucket,
      MIN(n)   AS sort_key,
      COUNT(*) AS customers,
      ROUND(COUNT(*) / SUM(COUNT(*)) OVER () * 100, 3) AS pct_customers,
      SUM(n)   AS rides,
      ROUND(SUM(revenue), 2) AS revenue,
      ROUND(SUM(revenue) / SUM(SUM(revenue)) OVER () * 100, 2) AS pct_revenue,
      ROUND(AVG(revenue), 2) AS avg_ltv
    FROM person GROUP BY bucket
  )
),
top_accounts AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(account_name, revenue, completed)
           ORDER BY revenue DESC)) AS j
  FROM (
    SELECT
      account_name,
      ROUND(SUM(IF(is_completed=1, revenue, 0)), 2) AS revenue,
      COUNTIF(is_completed=1)                        AS completed
    FROM rides
    WHERE account_name IS NOT NULL AND account_name != ''
    GROUP BY account_name
  )
)
SELECT
  (SELECT j FROM kpis)           AS kpis,
  (SELECT j FROM monthly)        AS monthly,
  (SELECT j FROM account_cohort) AS account_cohort,
  (SELECT j FROM partner_cohort) AS partner_cohort,
  (SELECT j FROM flow)           AS flow,
  (SELECT j FROM tiers)          AS tiers,
  (SELECT j FROM partners)       AS partners,
  (SELECT j FROM passengers)     AS passengers,
  (SELECT j FROM top_accounts)   AS top_accounts
`

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
    // ── Secrets ─────────────────────────────────────────────────────────────
    const serviceAccountJson = Deno.env.get('BIGQUERY_SERVICE_ACCOUNT_JSON')
    if (!serviceAccountJson) {
      return jsonResp({ error: 'BIGQUERY_SERVICE_ACCOUNT_JSON secret not configured' }, 500)
    }
    const projectId = Deno.env.get('BIGQUERY_PROJECT_ID')
    if (!projectId) {
      return jsonResp({ error: 'BIGQUERY_PROJECT_ID secret not configured' }, 500)
    }
    const location = Deno.env.get('BQ_LOCATION') ?? 'US'

    // ── Parse + validate request ─────────────────────────────────────────────
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

    // Cap end_date at today — never include forward bookings (build brief §7.5)
    const today = new Date().toISOString().slice(0, 10)
    const cappedEnd = end_date! > today ? today : end_date!

    // Inject account name filter into SQL
    const accountClause = filteredNames.length > 0
      ? 'AND b.account_name IN UNNEST(@account_names)'
      : ''
    const sql = SQL.replace('__ACCOUNT_FILTER__', accountClause)

    // ── Cache check (skip for filtered queries) ──────────────────────────────
    const cacheKey = `${start_date}|${cappedEnd}`
    const hit = cache.get(cacheKey)
    if (hit && !refresh && !filteredNames.length && Date.now() - hit.at < CACHE_TTL_MS) {
      const cached = hit.value as any
      return jsonResp({ ...cached, meta: { ...cached.meta, cached: true } })
    }

    // ── Run BigQuery ─────────────────────────────────────────────────────────
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
