import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ─── Auth (identical to customer_analysis) ───────────────────────────────────
async function getBQAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson)
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: sa.client_email,
    scope: ['https://www.googleapis.com/auth/bigquery','https://www.googleapis.com/auth/cloud-platform'].join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  }
  const enc = (o: object) => btoa(JSON.stringify(o)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  const unsigned = `${enc({ alg:'RS256', typ:'JWT' })}.${enc(payload)}`
  const pemBody = sa.private_key.replace('-----BEGIN PRIVATE KEY-----','').replace('-----END PRIVATE KEY-----','').replace(/\s/g,'')
  const keyData = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
  const privateKey = await crypto.subtle.importKey('pkcs8', keyData, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(unsigned))
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  const jwt = `${unsigned}.${sig}`
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) throw new Error(`BQ token error: ${JSON.stringify(tokenData)}`)
  return tokenData.access_token
}

async function extractJsonRow(result: any): Promise<Record<string, unknown>> {
  const fields: string[] = (result.schema?.fields ?? []).map((f: { name: string }) => f.name)
  const cells = result.rows?.[0]?.f ?? []
  const out: Record<string, unknown> = {}
  fields.forEach((name, i) => {
    const raw = cells[i]?.v
    try { out[name] = raw ? JSON.parse(raw) : null } catch { out[name] = raw ?? null }
  })
  return out
}

async function pollJob(projectId: string, jobId: string, location: string, accessToken: string, maxAttempts = 24): Promise<Record<string, unknown>> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 5_000))
    const res = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}?location=${location}&timeoutMs=30000`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!res.ok) throw new Error(`BQ poll error ${res.status}: ${await res.text()}`)
    const payload = await res.json()
    if (payload.jobComplete) return extractJsonRow(payload)
  }
  throw new Error('BigQuery job did not complete in time')
}

async function runCohortQuery(
  projectId: string, sql: string,
  startDate: string, endDate: string,
  cohort: string, mi: number,
  location: string, accessToken: string,
): Promise<Record<string, unknown>> {
  const queryParameters = [
    { name: 'start_date', parameterType: { type: 'DATE' },   parameterValue: { value: startDate } },
    { name: 'end_date',   parameterType: { type: 'DATE' },   parameterValue: { value: endDate   } },
    { name: 'cohort',     parameterType: { type: 'STRING' }, parameterValue: { value: cohort    } },
    { name: 'mi',         parameterType: { type: 'INT64' },  parameterValue: { value: String(mi)} },
  ]
  const body = { query: sql, useLegacySql: false, parameterMode: 'NAMED', queryParameters, timeoutMs: 120_000, location }
  const res = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  )
  let payload = await res.json()
  if (!res.ok) throw new Error(`BigQuery error: ${JSON.stringify(payload.error ?? payload)}`)
  if (!payload.jobComplete) {
    const jobId = payload.jobReference?.jobId
    if (!jobId) throw new Error('BigQuery did not return a job ID')
    return await pollJob(projectId, jobId, location, accessToken)
  }
  return await extractJsonRow(payload)
}

// ─── SQL ─────────────────────────────────────────────────────────────────────
function buildCohortSQL(): string { return `
WITH
params AS (
  SELECT
    @start_date                                AS win_start,
    LEAST(@end_date, CURRENT_DATE())           AS win_end,
    DATE_TRUNC(@start_date, MONTH)             AS win_start_month,
    DATE '2019-01-01'                          AS history_floor
),

-- Same scan pattern as customer_analysis main function.
-- secondary_species_name is 1:1 with fleet_id (verified: 1,378 distinct / 1,384 fleet_ids).
-- department holds the account owner (e.g. "EAM Renaldo").
scope AS (
  SELECT
    v.ride_id, v.trip_no, v.pickup_date,
    v.from_fleet_id_as_customer                             AS fleet_id,
    v.ride_stat,
    v.has_complaint, v.has_ops_complaint,
    d.customer_name,
    COALESCE(d.secondary_species_name, d.fleet_name,
             d.customer_name, v.from_fleet_id_as_customer)  AS account_label,
    COALESCE(d.department, '(Unknown)')                     AS owner,
    COALESCE(d.partner, '(unmapped)')                       AS partner,
    CAST(IFNULL(v.elife_amount_usd, 0) AS FLOAT64)
      + CAST(IFNULL(v.additional_charge_amount_usd, 0) AS FLOAT64) AS gmv,
    CAST(IFNULL(v.dispatch_amount_net_usd, 0) AS FLOAT64)          AS cost
  FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\` v
  LEFT JOIN \`elife-data-warehouse-prod.dim.dim_fleet_as_customer\` d
    ON v.from_fleet_id_as_customer = d.fleet_id
  , params p
  WHERE v.pickup_date BETWEEN p.history_floor AND p.win_end
    AND v.ride_stat IN ('Cancelled', 'Accepted', 'Pending')
    AND v.pickup_datetime < CURRENT_TIMESTAMP()
),

trips AS (
  SELECT * FROM scope, params p WHERE pickup_date BETWEEN p.win_start AND p.win_end
),

fleet_first AS (
  SELECT fleet_id, DATE_TRUNC(MIN(pickup_date), MONTH) AS first_month
  FROM scope GROUP BY fleet_id
),

acct_monthly AS (
  SELECT fleet_id, DATE_TRUNC(pickup_date, MONTH) AS am,
    COUNT(*) AS n_trips, SUM(gmv) AS gmv, SUM(cost) AS cost
  FROM scope, params p WHERE pickup_date >= p.win_start
  GROUP BY 1, 2
),

-- Pre-window base roster: accounts with first trip before window start
-- that were active in the anchor month (same definition as main function fix).
pre_base_roster AS (
  SELECT DISTINCT a.fleet_id
  FROM acct_monthly a JOIN fleet_first f USING (fleet_id), params p
  WHERE a.am = p.win_start_month AND f.first_month < p.win_start_month
),

-- Cohort roster: accounts that belong to this cohort at +0
cohort_roster AS (
  SELECT DISTINCT fleet_id FROM (
    SELECT f.fleet_id
    FROM fleet_first f, params p
    WHERE @cohort != '__PRE__'
      AND FORMAT_DATE('%Y-%m', f.first_month) = @cohort
    UNION ALL
    SELECT fleet_id FROM pre_base_roster
    WHERE @cohort = '__PRE__'
  )
),

-- Anchor month for this cohort
cohort_anchor AS (
  SELECT IF(@cohort = '__PRE__', p.win_start_month,
    DATE_TRUNC(DATE(CONCAT(@cohort, '-01')), MONTH)) AS anchor
  FROM params p LIMIT 1
),

-- Target month = anchor + mi
target_month AS (
  SELECT DATE_ADD(anchor, INTERVAL @mi MONTH) AS target_m FROM cohort_anchor
),

-- Active at +N: roster members who had a trip in the target month
active_at_n AS (
  SELECT DISTINCT a.fleet_id
  FROM acct_monthly a, target_month
  WHERE a.am = target_month.target_m
    AND a.fleet_id IN (SELECT fleet_id FROM cohort_roster)
),

-- Per-account labels (ANY_VALUE safe because secondary_species_name is 1:1 with fleet_id)
account_labels AS (
  SELECT
    fleet_id,
    ANY_VALUE(customer_name)  AS customer_name,
    ANY_VALUE(account_label)  AS account_label,
    ANY_VALUE(owner)          AS owner,
    ANY_VALUE(partner)        AS partner
  FROM scope
  WHERE fleet_id IN (SELECT fleet_id FROM cohort_roster)
  GROUP BY fleet_id
),

-- Per-account in-window metrics
account_metrics AS (
  SELECT
    fleet_id,
    COUNT(*)                       AS trips,
    ROUND(SUM(gmv), 2)             AS gmv,
    ROUND(SUM(cost), 2)            AS cost,
    ROUND(SUM(gmv) - SUM(cost), 2) AS profit,
    MAX(pickup_date)               AS last_booked
  FROM trips
  WHERE fleet_id IN (SELECT fleet_id FROM cohort_roster)
  GROUP BY fleet_id
),

-- Full roster with status
roster AS (
  SELECT
    r.fleet_id,
    COALESCE(l.account_label, r.fleet_id) AS account_label,
    l.customer_name,
    l.owner,
    l.partner,
    IF(a.fleet_id IS NOT NULL, 'ACTIVE', 'LOST') AS status,
    m.last_booked,
    IF(m.last_booked IS NOT NULL,
       DATE_DIFF(p.win_end, m.last_booked, DAY), NULL) AS days_quiet,
    COALESCE(m.trips,  0) AS trips,
    COALESCE(m.gmv,    0.0) AS gmv,
    COALESCE(m.profit, 0.0) AS profit
  FROM cohort_roster r
  LEFT JOIN account_labels  l USING (fleet_id)
  LEFT JOIN account_metrics m USING (fleet_id)
  LEFT JOIN active_at_n     a USING (fleet_id)
  , params p
),

-- Summary stats
summary AS (
  SELECT TO_JSON_STRING(STRUCT(
    COUNT(*) AS total_accounts,
    COUNTIF(status = 'ACTIVE') AS active_accounts,
    COUNTIF(status = 'LOST')   AS lost_accounts,
    ROUND(SUM(gmv), 2)         AS total_gmv,
    ROUND(SUM(IF(status = 'LOST', gmv, 0)), 2) AS lost_gmv
  )) AS j
  FROM roster
),

-- Re-aggregated Partner Profitability for cohort fleet_ids only.
-- This is what populates the cross-filter in the UI.
cohort_partners AS (
  SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(
    customer_name, partner, accounts, service_trips, service_rides,
    cancelled_trips, cancel_pct, complaint_rate, complete_gmv, cost, profit,
    profit_margin_pct, avg_gmv_per_trip
  ) ORDER BY complete_gmv DESC)) AS j
  FROM (
    SELECT
      t.customer_name,
      t.partner,
      COUNT(DISTINCT t.fleet_id)    AS accounts,
      COUNT(*)                      AS service_trips,
      COUNT(DISTINCT t.ride_id)     AS service_rides,
      COUNTIF(t.ride_stat = 'Cancelled') AS cancelled_trips,
      ROUND(SAFE_DIVIDE(COUNTIF(t.ride_stat='Cancelled'), COUNT(*))*100, 1) AS cancel_pct,
      ROUND(SAFE_DIVIDE(SUM(t.has_ops_complaint),
        COUNTIF(t.ride_stat IN ('Accepted','Pending')
                OR (t.ride_stat='Cancelled' AND t.has_complaint=1)))*100, 2) AS complaint_rate,
      ROUND(SUM(t.gmv), 2)          AS complete_gmv,
      ROUND(SUM(t.cost), 2)         AS cost,
      ROUND(SUM(t.gmv)-SUM(t.cost), 2) AS profit,
      ROUND(SAFE_DIVIDE(SUM(t.gmv)-SUM(t.cost), SUM(t.gmv))*100, 1) AS profit_margin_pct,
      ROUND(SAFE_DIVIDE(SUM(t.gmv), COUNT(*)), 2) AS avg_gmv_per_trip
    FROM trips t
    WHERE t.fleet_id IN (SELECT fleet_id FROM cohort_roster)
    GROUP BY customer_name, partner
  )
)

SELECT
  (SELECT j FROM summary) AS summary,
  TO_JSON_STRING(ARRAY_AGG(STRUCT(
    fleet_id, account_label, customer_name, owner, partner,
    status, last_booked, days_quiet, trips, gmv, profit
  ) ORDER BY gmv DESC)) AS roster,
  (SELECT j FROM cohort_partners) AS cohort_partners
FROM roster
` }

// ─── Handler ─────────────────────────────────────────────────────────────────
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_YM   = /^\d{4}-\d{2}$/

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const serviceAccountJson = Deno.env.get('BIGQUERY_SERVICE_ACCOUNT_JSON')
    if (!serviceAccountJson) return jsonResp({ error: 'BIGQUERY_SERVICE_ACCOUNT_JSON not configured' }, 500)
    const projectId = Deno.env.get('BIGQUERY_PROJECT_ID')
    if (!projectId) return jsonResp({ error: 'BIGQUERY_PROJECT_ID not configured' }, 500)
    const location = Deno.env.get('BQ_LOCATION') ?? 'US'

    let body: { start_date?: string; end_date?: string; cohort?: string; mi?: number } = {}
    try { body = await req.json() } catch { /* use defaults */ }

    const { start_date, end_date, cohort, mi } = body

    if (!ISO_DATE.test(start_date ?? ''))  return jsonResp({ error: 'start_date required as YYYY-MM-DD' }, 400)
    if (!ISO_DATE.test(end_date ?? ''))    return jsonResp({ error: 'end_date required as YYYY-MM-DD' }, 400)
    if (cohort !== '__PRE__' && !ISO_YM.test(cohort ?? ''))
      return jsonResp({ error: 'cohort must be "__PRE__" or "YYYY-MM"' }, 400)
    if (mi == null || !Number.isInteger(mi) || mi < 0 || mi > 23)
      return jsonResp({ error: 'mi must be an integer 0–23' }, 400)

    const today     = new Date().toISOString().slice(0, 10)
    const cappedEnd = end_date! > today ? today : end_date!

    const t0 = Date.now()
    const accessToken = await getBQAccessToken(serviceAccountJson)
    const data = await runCohortQuery(
      projectId, buildCohortSQL(), start_date!, cappedEnd,
      cohort!, mi, location, accessToken,
    )

    return jsonResp({
      summary:         data.summary,
      roster:          data.roster,
      cohort_partners: data.cohort_partners,
      meta: {
        start_date, end_date: cappedEnd,
        cohort, mi,
        generated_at: new Date().toISOString(),
        elapsed_ms: Date.now() - t0,
      },
    })
  } catch (err) {
    console.error('customer_analysis_cohort failed:', err)
    return jsonResp({ error: String(err instanceof Error ? err.message : err) }, 500)
  }
})
