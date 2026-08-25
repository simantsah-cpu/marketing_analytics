import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ─────────────────────────────────────────────────────────────────────────────
// BigQuery auth — identical to bigquery-report-109
// ─────────────────────────────────────────────────────────────────────────────

async function getBQAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson)
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: sa.client_email,
    scope: [
      'https://www.googleapis.com/auth/bigquery.readonly',
      'https://www.googleapis.com/auth/cloud-platform.read-only',
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
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) {
    throw new Error(`BQ token error: ${JSON.stringify(tokenData)}`)
  }
  return tokenData.access_token
}

// ─────────────────────────────────────────────────────────────────────────────
// Row extraction — keeps all values as strings (React side runs num() on them)
// ─────────────────────────────────────────────────────────────────────────────

function extractRows(
  result:       any,
  schemaFields: any[],
): Record<string, string | null>[] {
  const rows: any[] = result.rows ?? []
  return rows.map((row) => {
    const obj: Record<string, string | null> = {}
    schemaFields.forEach((field, i) => {
      obj[field.name] = row.f[i]?.v ?? null
    })
    return obj
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// runQuery — with jobComplete polling and pageToken pagination
// ─────────────────────────────────────────────────────────────────────────────

async function runQuery(
  projectId:   string,
  sql:         string,
  accessToken: string,
  timeoutMs =  25000,
): Promise<Record<string, string | null>[]> {
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`BigQuery HTTP ${res.status}: ${errText}`)
  }

  let result = await res.json()

  if (result.errors?.length) {
    throw new Error(`BigQuery errors: ${JSON.stringify(result.errors)}`)
  }

  // Poll until jobComplete (§9.1)
  if (!result.jobComplete) {
    const jobId   = result.jobReference?.jobId
    const location = result.jobReference?.location ?? 'US'
    if (!jobId) throw new Error('BQ job incomplete and no jobId returned')

    for (let attempt = 0; attempt < 12 && !result.jobComplete; attempt++) {
      await new Promise((r) => setTimeout(r, 2500))
      const pollRes = await fetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}?timeoutMs=5000&maxResults=10000&location=${location}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )
      result = await pollRes.json()
    }
    if (!result.jobComplete) throw new Error('BigQuery job timed out after polling')
  }

  const schemaFields: any[] = result.schema?.fields ?? []
  let rows = extractRows(result, schemaFields)

  // Follow pageToken pagination (§9.1 — silently under-reports otherwise)
  let pageToken: string | null = result.pageToken ?? null
  while (pageToken) {
    const jobId = result.jobReference?.jobId
    if (!jobId) break
    const pageRes = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}?pageToken=${encodeURIComponent(pageToken)}&maxResults=10000`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    const pageData = await pageRes.json()
    rows = rows.concat(extractRows(pageData, schemaFields))
    pageToken = pageData.pageToken ?? null
  }

  return rows
}

// ─────────────────────────────────────────────────────────────────────────────
// Snap migration flag — opt-out to fall back to live without redeploy
// Set USE_SNAP=false in Supabase edge function env vars to revert instantly.
// ─────────────────────────────────────────────────────────────────────────────

const USE_SNAP = Deno.env.get('USE_SNAP') !== 'false'

// buildSnapFilter — returns a BigQuery DATE expression for the snapshot filter.
// For the default (latest), uses a scalar subquery so no DECLARE is needed.
// For a user-chosen date, substitutes a validated DATE literal.
// NOTE: no DECLARE — DECLARE turns a SELECT into a multi-statement script and
//       breaks the REST parser's {schema,rows} response shape.
function buildSnapFilter(asAt: string | null): string {
  if (!asAt) {
    return `(SELECT MAX(snapshot_date)
               FROM \`elife-data-warehouse-prod.snap.class_c_raw_weekly\`
              WHERE source_object = 'ads.ads_weekly_meeting_revenue_and_profit_v2')`
  }
  // Validate: must be YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asAt)) {
    throw new Error(`Invalid as_at date: ${asAt}`)
  }
  return `DATE '${asAt}'`
}

// v2 snap subquery — reconstitutes the identical 38-column shape from JSON.
// JSON_VALUE (not JSON_EXTRACT) — unwraps quotes. Every numeric field has an
// explicit CAST. NULLs round-trip correctly; do not wrap in IFNULL here.
function v2SnapSubquery(snapFilter: string): string {
  return `(
  SELECT
    JSON_VALUE(row_json, '$.department')                              AS department,
    JSON_VALUE(row_json, '$.customer_name')                           AS customer_name,
    JSON_VALUE(row_json, '$.product_line')                            AS product_line,
    CAST(JSON_VALUE(row_json, '$.complete')                AS INT64)   AS complete,
    CAST(JSON_VALUE(row_json, '$.dispatched')              AS INT64)   AS dispatched,
    CAST(JSON_VALUE(row_json, '$.mtd_sales')               AS FLOAT64) AS mtd_sales,
    CAST(JSON_VALUE(row_json, '$.lmmtd_sales')             AS FLOAT64) AS lmmtd_sales,
    CAST(JSON_VALUE(row_json, '$.lymtd_sales')             AS FLOAT64) AS lymtd_sales,
    CAST(JSON_VALUE(row_json, '$.current_mtd_revenue')     AS FLOAT64) AS current_mtd_revenue,
    CAST(JSON_VALUE(row_json, '$.current_mtd_cost')        AS FLOAT64) AS current_mtd_cost,
    CAST(JSON_VALUE(row_json, '$.lmmtd_revenue')           AS FLOAT64) AS lmmtd_revenue,
    CAST(JSON_VALUE(row_json, '$.lmmtd_cost')              AS FLOAT64) AS lmmtd_cost,
    CAST(JSON_VALUE(row_json, '$.lymtd_revenue')           AS FLOAT64) AS lymtd_revenue,
    CAST(JSON_VALUE(row_json, '$.lymtd_cost')              AS FLOAT64) AS lymtd_cost,
    CAST(JSON_VALUE(row_json, '$.last_week_revenue')       AS FLOAT64) AS last_week_revenue,
    CAST(JSON_VALUE(row_json, '$.last_week_sales')         AS FLOAT64) AS last_week_sales,
    CAST(JSON_VALUE(row_json, '$.last_week_cost')          AS FLOAT64) AS last_week_cost,
    CAST(JSON_VALUE(row_json, '$.prev_week_revenue')       AS FLOAT64) AS prev_week_revenue,
    CAST(JSON_VALUE(row_json, '$.prev_week_sales')         AS FLOAT64) AS prev_week_sales,
    CAST(JSON_VALUE(row_json, '$.prev_week_cost')          AS FLOAT64) AS prev_week_cost,
    CAST(JSON_VALUE(row_json, '$.current_qtd_revenue')     AS FLOAT64) AS current_qtd_revenue,
    CAST(JSON_VALUE(row_json, '$.current_qtd_cost')        AS FLOAT64) AS current_qtd_cost,
    CAST(JSON_VALUE(row_json, '$.prev_qtd_revenue')        AS FLOAT64) AS prev_qtd_revenue,
    CAST(JSON_VALUE(row_json, '$.prev_qtd_cost')           AS FLOAT64) AS prev_qtd_cost,
    CAST(JSON_VALUE(row_json, '$.current_qtd_sales')       AS FLOAT64) AS current_qtd_sales,
    CAST(JSON_VALUE(row_json, '$.prev_qtd_sales')          AS FLOAT64) AS prev_qtd_sales,
    CAST(JSON_VALUE(row_json, '$.current_ytd_revenue')     AS FLOAT64) AS current_ytd_revenue,
    CAST(JSON_VALUE(row_json, '$.current_ytd_cost')        AS FLOAT64) AS current_ytd_cost,
    CAST(JSON_VALUE(row_json, '$.last_year_ytd_revenue')   AS FLOAT64) AS last_year_ytd_revenue,
    CAST(JSON_VALUE(row_json, '$.last_year_ytd_cost')      AS FLOAT64) AS last_year_ytd_cost,
    CAST(JSON_VALUE(row_json, '$.current_ytd_sales')       AS FLOAT64) AS current_ytd_sales,
    CAST(JSON_VALUE(row_json, '$.last_year_ytd_sales')     AS FLOAT64) AS last_year_ytd_sales,
    CAST(JSON_VALUE(row_json, '$.nm_mtd_revenue')          AS FLOAT64) AS nm_mtd_revenue,
    CAST(JSON_VALUE(row_json, '$.nm_mtd_cost')             AS FLOAT64) AS nm_mtd_cost,
    CAST(JSON_VALUE(row_json, '$.nm_lmmtd_revenue')        AS FLOAT64) AS nm_lmmtd_revenue,
    CAST(JSON_VALUE(row_json, '$.nm_lmmtd_cost')           AS FLOAT64) AS nm_lmmtd_cost,
    CAST(JSON_VALUE(row_json, '$.nm_lymtd_revenue')        AS FLOAT64) AS nm_lymtd_revenue,
    CAST(JSON_VALUE(row_json, '$.nm_lymtd_cost')           AS FLOAT64) AS nm_lymtd_cost,
    snapshot_date
  FROM \`elife-data-warehouse-prod.snap.class_c_raw_weekly\`
  WHERE source_object = 'ads.ads_weekly_meeting_revenue_and_profit_v2'
    AND snapshot_date = ${snapFilter}
)`
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL — verbatim from build spec §1
// ─────────────────────────────────────────────────────────────────────────────

// §1.1 Q_CUST — month/quarter/year to date, per (department, customer_name)
// Profit measure evaluated at customer grain (§2.3). SAFE_DIVIDE is deliberate (§1.1).
// FROM clause is swapped to snap.class_c_raw_weekly when USE_SNAP=true.
// All DAX formulas and SELECT columns are verbatim — §0 non-negotiable.
function makeQCust(snapFilter: string | null): string {
  const fromClause = (USE_SNAP && snapFilter !== null)
    ? v2SnapSubquery(snapFilter)
    : '`elife-data-warehouse-prod.ads.ads_weekly_meeting_revenue_and_profit_v2`'
  return `
WITH agg AS (
  SELECT
    department,
    customer_name,
    SUM(mtd_sales)                AS m_sales,
    SUM(lmmtd_sales)              AS lm_sales,
    SUM(lymtd_sales)              AS ly_sales,
    SUM(current_qtd_sales)        AS q_sales,
    SUM(prev_qtd_sales)           AS pq_sales,
    SUM(current_ytd_sales)        AS y_sales,
    SUM(last_year_ytd_sales)      AS lyy_sales,
    SUM(current_mtd_revenue)      AS m_rev,
    SUM(lmmtd_revenue)            AS lm_rev,
    SUM(current_qtd_revenue)      AS q_rev,
    SUM(prev_qtd_revenue)         AS pq_rev,
    SUM(current_ytd_revenue)      AS y_rev,
    SUM(last_year_ytd_revenue)    AS lyy_rev,
    -- components of the DAX profit measure, MTD
    SUM(IF(complete=1, current_mtd_revenue-current_mtd_cost, 0))                 AS m_cp,
    SUM(IF(complete=1, current_mtd_revenue, 0))                                  AS m_cr,
    SUM(IF(complete=0 AND dispatched=1, current_mtd_revenue-current_mtd_cost,0)) AS m_dp,
    SUM(IF(complete=0 AND dispatched=0, current_mtd_revenue-current_mtd_cost,0)) AS m_ep,
    -- QTD
    SUM(IF(complete=1, current_qtd_revenue-current_qtd_cost, 0))                 AS q_cp,
    SUM(IF(complete=1, current_qtd_revenue, 0))                                  AS q_cr,
    SUM(IF(complete=0 AND dispatched=1, current_qtd_revenue-current_qtd_cost,0)) AS q_dp,
    SUM(IF(complete=0 AND dispatched=0, current_qtd_revenue-current_qtd_cost,0)) AS q_ep,
    -- YTD
    SUM(IF(complete=1, current_ytd_revenue-current_ytd_cost, 0))                 AS y_cp,
    SUM(IF(complete=1, current_ytd_revenue, 0))                                  AS y_cr,
    SUM(IF(complete=0 AND dispatched=1, current_ytd_revenue-current_ytd_cost,0)) AS y_dp,
    SUM(IF(complete=0 AND dispatched=0, current_ytd_revenue-current_ytd_cost,0)) AS y_ep,
    -- comparison periods: plain revenue - cost, no split, no 0.9 factor (§2.1)
    SUM(lmmtd_revenue        - lmmtd_cost)         AS lm_profit,
    SUM(lymtd_revenue        - lymtd_cost)         AS ly_profit,
    SUM(prev_qtd_revenue     - prev_qtd_cost)      AS pq_profit,
    SUM(last_year_ytd_revenue- last_year_ytd_cost) AS lyy_profit
  FROM ${fromClause}
  GROUP BY 1,2
)
SELECT
  IFNULL(department,"(Unassigned)") AS dept,
  IFNULL(customer_name,"(Unknown)") AS cust,
  CAST(ROUND(m_sales,2)   AS FLOAT64) AS m_sales,
  CAST(ROUND(lm_sales,2)  AS FLOAT64) AS lm_sales,
  CAST(ROUND(ly_sales,2)  AS FLOAT64) AS ly_sales,
  CAST(ROUND(q_sales,2)   AS FLOAT64) AS q_sales,
  CAST(ROUND(pq_sales,2)  AS FLOAT64) AS pq_sales,
  CAST(ROUND(y_sales,2)   AS FLOAT64) AS y_sales,
  CAST(ROUND(lyy_sales,2) AS FLOAT64) AS lyy_sales,
  CAST(ROUND(m_rev,2)     AS FLOAT64) AS m_rev,
  CAST(ROUND(lm_rev,2)    AS FLOAT64) AS lm_rev,
  CAST(ROUND(q_rev,2)     AS FLOAT64) AS q_rev,
  CAST(ROUND(pq_rev,2)    AS FLOAT64) AS pq_rev,
  CAST(ROUND(y_rev,2)     AS FLOAT64) AS y_rev,
  CAST(ROUND(lyy_rev,2)   AS FLOAT64) AS lyy_rev,
  CAST(ROUND(IFNULL(m_cp + m_dp*0.9 + m_ep*SAFE_DIVIDE(m_cp,m_cr)*0.9, 0),2) AS FLOAT64) AS m_profit,
  CAST(ROUND(IFNULL(q_cp + q_dp*0.9 + q_ep*SAFE_DIVIDE(q_cp,q_cr)*0.9, 0),2) AS FLOAT64) AS q_profit,
  CAST(ROUND(IFNULL(y_cp + y_dp*0.9 + y_ep*SAFE_DIVIDE(y_cp,y_cr)*0.9, 0),2) AS FLOAT64) AS y_profit,
  CAST(ROUND(lm_profit,2)  AS FLOAT64) AS lm_profit,
  CAST(ROUND(ly_profit,2)  AS FLOAT64) AS ly_profit,
  CAST(ROUND(pq_profit,2)  AS FLOAT64) AS pq_profit,
  CAST(ROUND(lyy_profit,2) AS FLOAT64) AS lyy_profit
FROM agg
`
}

// §1.2 Q_TARGETS — profit targets from three mapping tables
// Executive Summary uses kind='dept' only; others fetched for future tabs.
// When USE_SNAP=true, the dept sub-query reads snap.mapping_weekly instead of
// mapping.mapping_profit_target_by_department. All rows for the snapshot are
// returned — no month filter here; the client owns period logic via targetAcross.
// Geo and product-line targets remain on live mapping tables (not in snap yet).
function makeQTargets(snapFilter: string | null): string {
  const deptFrom = (USE_SNAP && snapFilter !== null)
    ? `(
  SELECT
    'dept'                                     AS kind,
    FORMAT_DATE('%Y-%m', key_date)             AS ym,
    key_1                                      AS dim,
    CAST(ROUND(value_num, 2) AS FLOAT64)       AS tgt,
    ''                                         AS notes
  FROM \`elife-data-warehouse-prod.snap.mapping_weekly\`
  WHERE snapshot_date = ${snapFilter}
    AND mapping_name  = 'profit_target_by_department'
)`
    : `(
  SELECT 'dept' AS kind,
         FORMAT_DATE('%Y-%m', target_month) AS ym,
         department AS dim,
         CAST(ROUND(profit_target,2) AS FLOAT64) AS tgt,
         notes
  FROM \`elife-data-warehouse-prod.mapping.mapping_profit_target_by_department\`
)`
  return `
WITH u AS (
  SELECT kind, ym, dim, tgt, notes FROM ${deptFrom}
  UNION ALL
  SELECT "geo",
         FORMAT_DATE("%Y-%m", target_month),
         geo,
         CAST(ROUND(profit_target,2) AS FLOAT64),
         notes
  FROM \`elife-data-warehouse-prod.mapping.mapping_profit_target_by_geo\`
  UNION ALL
  SELECT "pl",
         FORMAT_DATE("%Y-%m", target_month),
         product_line,
         CAST(ROUND(profit_target,2) AS FLOAT64),
         notes
  FROM \`elife-data-warehouse-prod.mapping.mapping_profit_target_by_product_line\`
)
SELECT kind, ym, IFNULL(dim,"(Unassigned)") AS dim, tgt, IFNULL(notes,"") AS notes
FROM u
`
}

// §1.3 Q_FC — geo-level forward-booking forecast
// model_version MUST be "fwd_v2" (§1.3).
//
// §2 LATENT BUG FIX — resolve the vintage on the version you are using.
// The old code: SELECT MAX(forecast_date) WHERE forecast_date <= as_at
// resolves across ALL versions. On Monday between 02:00–07:18, fwd_v1 exists
// for that Monday but fwd_v2 does not — so MAX returns today, and the
// WHERE fwd_v2 filter matches zero rows. Panel goes blank.
//
// The fix: resolve MAX within model_version='fwd_v2' only.
// If this Monday's fwd_v2 has not landed, falls back to last Monday's —
// one week stale but complete and coherent, strictly better than blank.
// Same pattern applied to Q_FCC (fwd_cust_v1).
function makeQFC(snapFilter: string | null): string {
  // Vintage guard: resolve on fwd_v2 specifically. Never on all versions.
  const vintageGuard = (USE_SNAP && snapFilter !== null)
    ? `AND forecast_date <= ${snapFilter}`
    : ''
  return `
WITH mx AS (
  SELECT MAX(forecast_date) AS fd
  FROM \`elife-data-warehouse-prod.ads.ads_forward_booking_forecast\`
  WHERE model_version = "fwd_v2"
  ${vintageGuard}
)
SELECT
  CAST(f.forecast_date AS STRING) AS fdate,
  f.pickup_month  AS ym,
  f.geo           AS geo,
  CAST(ROUND(f.committed_rev,0)  AS FLOAT64) AS committed,
  CAST(ROUND(f.rev_blended,0)    AS FLOAT64) AS rev,
  CAST(ROUND(f.rev_blended_lo,0) AS FLOAT64) AS rev_lo,
  CAST(ROUND(f.rev_blended_hi,0) AS FLOAT64) AS rev_hi,
  CAST(ROUND(f.pro_blended,0)    AS FLOAT64) AS pro,
  CAST(ROUND(f.pro_blended_lo,0) AS FLOAT64) AS pro_lo,
  CAST(ROUND(f.pro_blended_hi,0) AS FLOAT64) AS pro_hi,
  f.blend_note AS note
FROM \`elife-data-warehouse-prod.ads.ads_forward_booking_forecast\` f, mx
WHERE f.model_version = "fwd_v2" AND f.forecast_date = mx.fd
`
}

// §1.4 Q_FC end

// §1.5 Q_FCC — customer-level forward-booking forecast
// model_version MUST be "fwd_cust_v1" (NOT fwd_v2). Two different models, two different tables.
// Same §2 vintage-pinning fix as Q_FC: resolve MAX within fwd_cust_v1 only.
// Customer cadence changed 2026-08-03: was weekly Wednesday, now weekly Monday.
// Do not assume fcc and fc share a vintage date — resolve each independently.
function makeQFCC(snapFilter: string | null): string {
  const vintageGuard = (USE_SNAP && snapFilter !== null)
    ? `AND forecast_date <= ${snapFilter}`
    : ''
  return `
WITH mx AS (
  SELECT MAX(forecast_date) AS fd
  FROM \`elife-data-warehouse-prod.ads.ads_forward_booking_forecast_customer\`
  WHERE model_version = "fwd_cust_v1"
  ${vintageGuard}
)
SELECT
  CAST(f.forecast_date AS STRING) AS fdate,
  f.pickup_month                        AS ym,
  IFNULL(f.customer,  "(Unknown)")      AS cust,
  IFNULL(f.cust_type, "\u2014")         AS ctype,
  CAST(ROUND(f.committed_rev,0) AS FLOAT64) AS committed,
  CAST(ROUND(f.rev_blended,0)   AS FLOAT64) AS rev,
  CAST(ROUND(f.pro_blended,0)   AS FLOAT64) AS pro
FROM \`elife-data-warehouse-prod.ads.ads_forward_booking_forecast_customer\` f, mx
WHERE f.model_version = "fwd_cust_v1" AND f.forecast_date = mx.fd
`
}
// §1.6 Q_MONTHS — single-month reconstruction (completed rides only)
// NOTE: not equivalent to the DAX measure. 2–4% high vs notebook. Label accordingly.
// Date floor 2025-12-01 because Dec 2025 is Jan 2026's comparison base.
const Q_MONTHS = `
WITH sa AS (
  SELECT service_area_id, ANY_VALUE(geo) AS geo
  FROM \`elife-data-warehouse-prod.ads.ads_driver_service_area\`
  WHERE service_area_id IS NOT NULL
  GROUP BY service_area_id
),
base AS (
  SELECT
    FORMAT_DATE("%Y-%m", r.date_calculate)   AS ym,
    IFNULL(d.department,"(Unassigned)")      AS dept,
    IFNULL(NULLIF(d.customer_name,""), d.fleet_name) AS cust,
    IFNULL(sa.geo,"(Unassigned)")            AS geo,
    SUM(r.complete_revenue - r.complete_cost) AS profit,
    SUM(r.complete_revenue)                   AS revenue,
    SUM(r.sales_amount)                       AS sales
  FROM \`elife-data-warehouse-prod.ads.ads_ride_summary\` r
  JOIN \`elife-data-warehouse-prod.dim.dim_fleet_as_customer\` d
    ON d.fleet_id = r.from_fleet_id_as_customer
  LEFT JOIN sa ON sa.service_area_id = r.service_area_id
  WHERE r.date_calculate BETWEEN DATE "2025-12-01" AND DATE "2026-12-31"
  GROUP BY 1,2,3,4
  HAVING SUM(r.complete_revenue) <> 0 OR SUM(r.sales_amount) <> 0
)
SELECT
  ym, dept, IFNULL(cust,"(Unknown)") AS cust, geo,
  CAST(ROUND(profit,2)  AS FLOAT64) AS profit,
  CAST(ROUND(revenue,2) AS FLOAT64) AS revenue,
  CAST(ROUND(sales,2)   AS FLOAT64) AS sales
FROM base
`

// §1.7 Q_PROD — product line from v2 (same table as Q_CUST, different GROUP BY)
// FROM clause swapped to snap when USE_SNAP=true — same DAX formula verbatim.
function makeQProd(snapFilter: string | null): string {
  const fromClause = (USE_SNAP && snapFilter !== null)
    ? v2SnapSubquery(snapFilter)
    : '`elife-data-warehouse-prod.ads.ads_weekly_meeting_revenue_and_profit_v2`'
  return `
WITH agg AS (
  SELECT
    product_line,
    SUM(mtd_sales)           AS sales,
    SUM(current_mtd_revenue) AS revenue,
    SUM(IF(complete=1, current_mtd_revenue-current_mtd_cost, 0))                 AS cp,
    SUM(IF(complete=1, current_mtd_revenue, 0))                                  AS cr,
    SUM(IF(complete=0 AND dispatched=1, current_mtd_revenue-current_mtd_cost,0)) AS dp,
    SUM(IF(complete=0 AND dispatched=0, current_mtd_revenue-current_mtd_cost,0)) AS ep,
    SUM(lmmtd_revenue - lmmtd_cost)                                              AS lm_profit
  FROM ${fromClause}
  GROUP BY 1
)
SELECT
  IFNULL(product_line,"(Unassigned)") AS pl,
  CAST(ROUND(sales,2)   AS FLOAT64) AS sales,
  CAST(ROUND(revenue,2) AS FLOAT64) AS revenue,
  CAST(ROUND(IFNULL(cp + dp*0.9 + ep*SAFE_DIVIDE(cp,cr)*0.9, 0),2) AS FLOAT64) AS profit,
  CAST(ROUND(lm_profit,2) AS FLOAT64) AS lm_profit
FROM agg
`
}

// §1.8 snap metadata queries (used only when USE_SNAP=true)
// Q_SNAP_DATES — populates the 'as at' selector. Reads class_c_raw_weekly
// (not kpi_weekly) so every offered date is guaranteed to have v2 data.
const Q_SNAP_DATES = `
SELECT DISTINCT CAST(snapshot_date AS STRING) AS snapshot_date
FROM \`elife-data-warehouse-prod.snap.class_c_raw_weekly\`
WHERE source_object = 'ads.ads_weekly_meeting_revenue_and_profit_v2'
ORDER BY snapshot_date DESC
`

// Q_STALENESS — records whether the source was stale at capture.
// Allows the frontend to warn users in a way the live page never could.
function makeQStaleness(snapFilter: string): string {
  return `
SELECT
  is_stale,
  CAST(staleness_days AS FLOAT64) AS staleness_days
FROM \`elife-data-warehouse-prod.snap.source_lineage_weekly\`
WHERE snapshot_date = ${snapFilter}
  AND source_object  = 'ads.ads_weekly_meeting_revenue_and_profit_v2'
`
}

// §1.8 Q_GEO — geography from v3 (DIFFERENT TABLE — not v2 — by design)
// v3 carries ~70% of v2's profit level; mix is representative, level is under-reported.
// GEO attainment is deliberately withheld because of this shortfall.
const Q_GEO = `
WITH agg AS (
  SELECT
    geo,
    SUM(mtd_sales)           AS sales,
    SUM(current_mtd_revenue) AS revenue,
    SUM(IF(complete=1, current_mtd_revenue-current_mtd_cost, 0))                 AS cp,
    SUM(IF(complete=1, current_mtd_revenue, 0))                                  AS cr,
    SUM(IF(complete=0 AND dispatched=1, current_mtd_revenue-current_mtd_cost,0)) AS dp,
    SUM(IF(complete=0 AND dispatched=0, current_mtd_revenue-current_mtd_cost,0)) AS ep,
    SUM(lmmtd_revenue - lmmtd_cost)                                              AS lm_profit
  FROM \`elife-data-warehouse-prod.ads.ads_weekly_meeting_revenue_and_profit_v3\`
  GROUP BY 1
)
SELECT
  IFNULL(geo,"(Unassigned)") AS geo,
  CAST(ROUND(sales,2)   AS FLOAT64) AS sales,
  CAST(ROUND(revenue,2) AS FLOAT64) AS revenue,
  CAST(ROUND(IFNULL(cp + dp*0.9 + ep*SAFE_DIVIDE(cp,cr)*0.9, 0),2) AS FLOAT64) AS profit,
  CAST(ROUND(lm_profit,2) AS FLOAT64) AS lm_profit
FROM agg
`

// §2.1 Q_B2C — MTD vs same-day-range last month
// GBP spend divided by rate (from_cur='USD',to_cur='GBP') = USD spend
const Q_B2C = `
WITH exch AS (
  SELECT rate AS gbp_usd
  FROM \`elife-data-warehouse-prod.mapping.mapping_cur_exch_rate\`
  WHERE from_cur = "USD" AND to_cur = "GBP"
),
raw AS (
  SELECT "Hoppa" AS brand, booking_date, marketing_channel, platform,
         overall_sessions, keyEvents, ttv, actual_profit, estimate_profit, Spend
  FROM \`elife-data-warehouse-prod.b2cdata.ads_ads_b2c_dashboard_v\`
  UNION ALL
  SELECT "Elife", booking_date, marketing_channel, platform,
         overall_sessions, keyEvents, ttv, actual_profit, estimate_profit, Spend
  FROM \`elife-data-warehouse-prod.ads.ads_b2c_dashboard_elife\`
),
tagged AS (
  SELECT brand,
         COALESCE(marketing_channel,"Untracked") AS channel,
         platform,
         CASE
           WHEN booking_date BETWEEN DATE_TRUNC(CURRENT_DATE(),MONTH) AND CURRENT_DATE()
             THEN "MTD"
           WHEN booking_date BETWEEN DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH),MONTH)
                                 AND DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH)
             THEN "LM"
         END AS period,
         overall_sessions, keyEvents, ttv, actual_profit, estimate_profit, Spend
  FROM raw
  WHERE platform IN ("APP","WEB")
)
SELECT
  g.brand, g.period, g.channel, g.platform,
  CAST(ROUND(SUM(g.overall_sessions),0) AS FLOAT64) AS sessions,
  CAST(ROUND(SUM(g.keyEvents),2)        AS FLOAT64) AS bookings,
  CAST(ROUND(SUM(g.ttv),2)              AS FLOAT64) AS ttv,
  CAST(ROUND(SUM(IFNULL(g.actual_profit,0)+IFNULL(g.estimate_profit,0)),2) AS FLOAT64) AS est_profit,
  CAST(ROUND(SUM(g.Spend)/ANY_VALUE(e.gbp_usd),2) AS FLOAT64) AS spend_usd
FROM tagged g CROSS JOIN exch e
WHERE g.period IS NOT NULL
GROUP BY 1,2,3,4
`

// §2.2 Q_B2C_M — calendar months from 2025-01-01
const Q_B2C_M = `
WITH exch AS (
  SELECT rate AS gbp_usd
  FROM \`elife-data-warehouse-prod.mapping.mapping_cur_exch_rate\`
  WHERE from_cur = "USD" AND to_cur = "GBP"
),
raw AS (
  SELECT "Hoppa" AS brand, booking_date, marketing_channel, platform,
         overall_sessions, keyEvents, ttv, actual_profit, estimate_profit, Spend
  FROM \`elife-data-warehouse-prod.b2cdata.ads_ads_b2c_dashboard_v\`
  UNION ALL
  SELECT "Elife", booking_date, marketing_channel, platform,
         overall_sessions, keyEvents, ttv, actual_profit, estimate_profit, Spend
  FROM \`elife-data-warehouse-prod.ads.ads_b2c_dashboard_elife\`
)
SELECT
  FORMAT_DATE("%Y-%m", g.booking_date) AS ym,
  g.brand,
  COALESCE(g.marketing_channel,"Untracked") AS channel,
  g.platform,
  CAST(ROUND(SUM(g.overall_sessions),0) AS FLOAT64) AS sessions,
  CAST(ROUND(SUM(g.keyEvents),2)        AS FLOAT64) AS bookings,
  CAST(ROUND(SUM(g.ttv),2)              AS FLOAT64) AS ttv,
  CAST(ROUND(SUM(IFNULL(g.actual_profit,0)+IFNULL(g.estimate_profit,0)),2) AS FLOAT64) AS est_profit,
  CAST(ROUND(SUM(g.Spend)/ANY_VALUE(e.gbp_usd),2) AS FLOAT64) AS spend_usd
FROM raw g CROSS JOIN exch e
WHERE g.platform IN ("APP","WEB")
  AND g.booking_date BETWEEN DATE "2025-01-01" AND CURRENT_DATE()
GROUP BY 1,2,3,4
`

// Q_RH — Ride Hailing trips, search and scope split
// §2: partner_name only (STRPOS), not the allow-list — avoids 34 extra July trips
// §4.2: sam CTE replicates Power BI's page-filter cross-filtering through service_area
// §3.4: per-row rounding before SUM
const Q_RH = `
WITH sa AS (
  SELECT service_area_id, ANY_VALUE(country) AS country
  FROM \`elife-data-warehouse-prod.ads.ads_driver_service_area\`
  WHERE service_area_id IS NOT NULL
  GROUP BY service_area_id
),
disp AS (
  SELECT
    FORMAT_DATE("%Y-%m", d.pickup_date) AS ym,
    IF(LOWER(sa.country)="japan","Japan","Global") AS scope,
    COUNT(*)                                  AS trips,
    COUNTIF(d.ride_stat="Cancelled")          AS cancelled,
    COUNTIF(d.dispatch_stat="At destination" AND d.ride_stat<>"Cancelled") AS completed,
    SUM(ROUND(IFNULL(d.elife_amount_usd,0),2)
      + ROUND(IFNULL(d.additional_charge_amount_usd,0),2)) AS rev,
    SUM(ROUND(IFNULL(d.dispatch_amount_net_usd,0),2))      AS cost
  FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\` d
  LEFT JOIN sa USING (service_area_id)
  WHERE d.pickup_date BETWEEN DATE "2025-01-01" AND CURRENT_DATE()
    AND STRPOS(IFNULL(d.partner_name,""), "Ride Hailing") > 0
  GROUP BY 1,2
),
sam AS (
  SELECT FORMAT_DATE("%Y-%m", pickup_date) AS ym, service_area_id
  FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\`
  WHERE pickup_date BETWEEN DATE "2025-01-01" AND CURRENT_DATE()
    AND ride_stat IN ("Accepted","Cancelled","Pending")
    AND service_area_id IS NOT NULL
  GROUP BY 1,2
),
srch AS (
  SELECT
    FORMAT_DATE("%Y-%m", r.date_calculate) AS ym,
    IF(LOWER(sa.country)="japan","Japan","Global") AS scope,
    SUM(r.request_number_by_search_date) AS inq,
    SUM(r.quote_number_by_search_date)   AS quotes,
    SUM(r.sales_trip)                    AS sales_trips
  FROM \`elife-data-warehouse-prod.ads.ads_ride_hailing_search_ride_summary\` r
  LEFT JOIN sa  ON sa.service_area_id = r.service_area_id
  LEFT JOIN sam m ON m.ym = FORMAT_DATE("%Y-%m", r.date_calculate)
                 AND m.service_area_id = r.service_area_id
  WHERE r.date_calculate BETWEEN DATE "2025-01-01" AND CURRENT_DATE()
    AND (r.service_area_id IS NULL OR m.service_area_id IS NOT NULL)
  GROUP BY 1,2
)
SELECT
  COALESCE(d.ym, s.ym)       AS ym,
  COALESCE(d.scope, s.scope) AS scope,
  CAST(IFNULL(s.inq,0)         AS FLOAT64) AS inq,
  CAST(IFNULL(s.quotes,0)      AS FLOAT64) AS quotes,
  CAST(IFNULL(s.sales_trips,0) AS FLOAT64) AS sales_trips,
  CAST(IFNULL(d.trips,0)       AS FLOAT64) AS trips,
  CAST(IFNULL(d.cancelled,0)   AS FLOAT64) AS cancelled,
  CAST(IFNULL(d.completed,0)   AS FLOAT64) AS completed,
  CAST(ROUND(IFNULL(d.rev,0),2)  AS FLOAT64) AS rev,
  CAST(ROUND(IFNULL(d.cost,0),2) AS FLOAT64) AS cost,
  CAST(ROUND(IFNULL(d.rev,0) - IFNULL(d.cost,0),2) AS FLOAT64) AS profit
FROM disp d
FULL JOIN srch s ON d.ym = s.ym AND d.scope = s.scope
`

// Q_MQ — Margin & Quality partner incident rate
// Reconciled to Power BI RP0036 to the row. Replaces Q_INC entirely.
// Sources: dwb.dwb_complaint (numerator), ads.ads_ride_dispatch_v (denominator)
//          dwb.dwb_dispatch_detail (maps dispatch_id → ride_id+trip_no)
// §4.2 IMPORTANT: inc CTE has NO date filter. Late-filed complaints must count
//      against the trip's pickup month. dwb_complaint covers back to 2022-01-01.
// §0.2 'Customer No show' exact string — capital N. Must be excluded from incident count.
// §0.3 Denominator includes has_complaint=1 regardless of ride_stat.
// §0.4 Product line from partner_name STRPOS only — no fleet-ID allow-list.
// §0.5 Deduplicate to trip grain: MAX(...) GROUP BY ride_id, trip_no.
// §4 dispatch_stat <> '' exclusion removes hoppa-fulfilled trips (no dispatch record).
const Q_MQ = `
WITH inc AS (
  SELECT
    dd.ride_id,
    dd.trip_no,
    MAX(IF(dc.complaint_reason <> 'Customer No show', 1, 0)) AS pi_in,
    MAX(IF(dc.complaint_reason <> 'Customer No show'
           AND dc.complaint_status IN ('Closed against Elife, lost','Initiated'), 1, 0)) AS pi_ex,
    MAX(IF(dc.complaint_reason <> 'Customer No show'
           AND dc.complaint_status = 'Closed against Elife, lost', 1, 0)) AS pi_lost
  FROM \`elife-data-warehouse-prod.dwb.dwb_complaint\` dc
  JOIN \`elife-data-warehouse-prod.dwb.dwb_dispatch_detail\` dd
    ON dd.dispatch_id = dc.dispatch_id
  GROUP BY 1, 2
),
sa AS (
  SELECT service_area_id, ANY_VALUE(geo) AS geo
  FROM \`elife-data-warehouse-prod.ads.ads_driver_service_area\`
  WHERE service_area_id IS NOT NULL
  GROUP BY service_area_id
),
cust AS (
  SELECT fleet_id, IFNULL(NULLIF(customer_name,''), fleet_name) AS cust
  FROM \`elife-data-warehouse-prod.dim.dim_fleet_as_customer\`
),
wt AS (
  SELECT
    FORMAT_DATE('%Y-%m', v.pickup_date) AS ym,
    IF(STRPOS(IFNULL(v.partner_name,''), 'Ride Hailing') > 0, 'Ride Hailing', 'Prebooked') AS biz,
    CASE
      WHEN STRPOS(IFNULL(v.partner_name,''), 'Ride Hailing') > 0 THEN 'Ride Hailing'
      WHEN v.vehicle_class_id < 110                              THEN 'Private Transfer'
      WHEN v.vehicle_class_id = 122                              THEN 'Rail'
      ELSE 'Shared Shuttle'
    END AS product_line,
    IFNULL(c.cust, '(Unmapped)')   AS cust,
    IFNULL(s.geo,  '(Unassigned)') AS geo,
    IFNULL(i.pi_in,   0) AS pi_in,
    IFNULL(i.pi_ex,   0) AS pi_ex,
    IFNULL(i.pi_lost, 0) AS pi_lost
  FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\` v
  LEFT JOIN inc  i ON i.ride_id = v.ride_id AND i.trip_no = v.trip_no
  LEFT JOIN sa   s ON s.service_area_id = v.service_area_id
  LEFT JOIN cust c ON c.fleet_id = v.from_fleet_id_as_customer
  WHERE v.pickup_date BETWEEN DATE '2025-01-01' AND CURRENT_DATE()
    AND (v.ride_stat IN ('Accepted','Pending') OR v.has_complaint = 1)
    AND IFNULL(v.dispatch_stat, 'x') <> ''
),
agg AS (
  SELECT 'biz'      AS grain, biz                       AS dim, ym, pi_in, pi_ex, pi_lost FROM wt
  UNION ALL
  SELECT 'product',            product_line,                     ym, pi_in, pi_ex, pi_lost FROM wt
  UNION ALL
  SELECT 'geo',                CONCAT(biz, ' | ', geo),          ym, pi_in, pi_ex, pi_lost FROM wt
  UNION ALL
  SELECT 'customer',           CONCAT(biz, ' | ', cust),         ym, pi_in, pi_ex, pi_lost FROM wt
)
SELECT
  grain, dim, ym,
  CAST(COUNT(*)      AS FLOAT64) AS valid_trips,
  CAST(SUM(pi_in)    AS FLOAT64) AS pi_in,
  CAST(SUM(pi_ex)    AS FLOAT64) AS pi_ex,
  CAST(SUM(pi_lost)  AS FLOAT64) AS pi_lost
FROM agg
GROUP BY grain, dim, ym
`

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    const serviceAccountJson =
      Deno.env.get('BIGQUERY_SERVICE_ACCOUNT_JSON') ??
      Deno.env.get('GA4_SERVICE_ACCOUNT_JSON')

    if (!serviceAccountJson) {
      return new Response(
        JSON.stringify({ error: 'BIGQUERY_SERVICE_ACCOUNT_JSON secret not configured' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }

    // The project is fixed in the SQL but allow override via secret for dev environments
    const projectId = Deno.env.get('BIGQUERY_PROJECT_ID') ?? 'elife-data-warehouse-prod'

    const accessToken = await getBQAccessToken(serviceAccountJson)

    // Parse and validate asAt from request body
    let bodyJson: any = {}
    try { bodyJson = await req.json() } catch { /* empty body is fine */ }
    const rawAsAt: string | null = typeof bodyJson?.asAt === 'string' ? bodyJson.asAt : null

    // Build the snap filter expression (scalar subquery or DATE literal)
    // buildSnapFilter throws if the date string is malformed.
    const snapFilter = buildSnapFilter(rawAsAt)

    // Wave 1 — fetch snap dates first so prevSnapFilter can be derived before wave 2.
    // All other queries don't depend on the previous snapshot date.
    const snapDatesRows: any[] = USE_SNAP
      ? await runQuery(projectId, Q_SNAP_DATES, accessToken).catch(() => [])
      : []

    // snapDates is sorted DESC (most recent first).
    // Index 0 = current (asAt), index 1 = previous snapshot.
    // §4.1 of Departments spec: month boundary guard is done client-side.
    const allSnapDates: string[] = snapDatesRows.map((r: any) => r.snapshot_date).filter(Boolean)
    const resolvedCurrent = allSnapDates[0] ?? null
    const prevDateStr:    string | null = allSnapDates[1] ?? null
    const prevSnapFilter: string | null = prevDateStr ? `DATE '${prevDateStr}'` : null

    // Build Q_CUST_PREV — same subquery as Q_CUST but pinned to the previous snapshot date.
    // §1 of Departments spec: reuse the existing v2 subquery, do not write a second parser.
    const Q_CUST_PREV = (USE_SNAP && prevSnapFilter !== null) ? makeQCust(prevSnapFilter) : null

    // Build queries — snap variants replace the FROM clause when USE_SNAP=true
    const Q_CUST    = makeQCust(snapFilter)
    const Q_TARGETS = makeQTargets(snapFilter)
    const Q_FC      = makeQFC(snapFilter)
    const Q_PROD    = makeQProd(snapFilter)
    const Q_FCC     = makeQFCC(snapFilter)

    // Wave 2 — run all remaining queries in parallel, including custPrev.
    const stalenessPromise = USE_SNAP
      ? runQuery(projectId, makeQStaleness(snapFilter), accessToken).catch(() => [])
      : Promise.resolve([])

    const [
      custRows, targetsRows, fcRows, monthsRows, fccRows,
      prodRows, geoRows, b2cRows, b2cMRows, rhRows, mqRows,
      stalenessRows, custPrevRows,
    ] = await Promise.all([
      runQuery(projectId, Q_CUST,    accessToken),
      runQuery(projectId, Q_TARGETS, accessToken),
      runQuery(projectId, Q_FC,      accessToken),
      runQuery(projectId, Q_MONTHS,  accessToken),
      runQuery(projectId, Q_FCC,     accessToken).catch(() => []),
      runQuery(projectId, Q_PROD,    accessToken).catch(() => []),
      runQuery(projectId, Q_GEO,     accessToken).catch(() => []),
      runQuery(projectId, Q_B2C,     accessToken).catch(() => []),
      runQuery(projectId, Q_B2C_M,   accessToken).catch(() => []),
      runQuery(projectId, Q_RH,      accessToken).catch(() => []),
      runQuery(projectId, Q_MQ,      accessToken).catch(() => []),
      stalenessPromise,
      Q_CUST_PREV ? runQuery(projectId, Q_CUST_PREV, accessToken).catch(() => []) : Promise.resolve([]),
    ])

    // Resolve the actual snapshot date used (may differ from rawAsAt if default was used)
    const resolvedAsAt: string | null = custRows[0]?.snapshot_date ?? resolvedCurrent ?? rawAsAt
    const staleness = stalenessRows[0] ?? null

    // Resolved forecast vintages — returned so the UI can label which week is on screen.
    // fdate is the resolved forecast_date on each row (all rows share the same value).
    // If the vintage is older than asAt, the frontend shows a stale-vintage warning.
    const fcVintage:  string | null = fcRows[0]?.fdate  ?? null
    const fccVintage: string | null = fccRows[0]?.fdate ?? null

    return new Response(
      JSON.stringify({
        queried_at:   new Date().toISOString(),
        cust:         custRows,
        custPrev:     custPrevRows,   // previous snapshot rows — Departments weekly delta (§3)
        prevSnapDate: prevDateStr,    // ISO date string of the previous snapshot
        targets:      targetsRows,
        fc:           fcRows,
        months:       monthsRows,
        fcc:          fccRows,
        prod:         prodRows,
        geo:          geoRows,
        b2c:          b2cRows,
        b2cM:         b2cMRows,
        rh:           rhRows,
        mq:           mqRows,
        // snap metadata
        snapDates:    allSnapDates,
        asAt:         resolvedAsAt,
        staleness:    staleness ? { is_stale: staleness.is_stale === 'true', staleness_days: Number(staleness.staleness_days) } : null,
        // forecast vintage metadata (§2.2 of forecast spec)
        fcVintage:    fcVintage,
        fccVintage:   fccVintage,
      }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  } catch (err: any) {
    console.error('leadership-dashboard error:', err)
    return new Response(
      JSON.stringify({ error: err?.message ?? 'Internal error' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }
})
