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

// runQueryParameterised — same as runQuery but accepts a pre-built BQ request body
// (used by makeQB2C which needs queryParameters for @as_at)
async function runQueryParameterised(
  projectId:   string,
  body:        object,
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
    body: JSON.stringify({ ...body, timeoutMs }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`BigQuery HTTP ${res.status}: ${errText}`)
  }

  let result = await res.json()

  if (result.errors?.length) {
    throw new Error(`BigQuery errors: ${JSON.stringify(result.errors)}`)
  }

  if (!result.jobComplete) {
    const jobId    = result.jobReference?.jobId
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

// v3 snap subquery — 39-field parser (v2 + geo at position 6).
// IFNULL on geo is mandatory: 64 of 930 rows have NULL geo in the 24 Aug snapshot.
// All other field names are identical to v2 — same DAX formula, same shape.
function v3SnapSubquery(snapFilter: string): string {
  return `(
  SELECT
    JSON_VALUE(row_json, '$.department')                              AS department,
    JSON_VALUE(row_json, '$.customer_name')                           AS customer_name,
    JSON_VALUE(row_json, '$.product_line')                            AS product_line,
    CAST(JSON_VALUE(row_json, '$.complete')                AS INT64)   AS complete,
    CAST(JSON_VALUE(row_json, '$.dispatched')              AS INT64)   AS dispatched,
    IFNULL(JSON_VALUE(row_json, '$.geo'), '(Unassigned)')             AS geo,
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
  WHERE source_object = 'ads.ads_weekly_meeting_revenue_and_profit_v3'
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
// Executive Summary uses kind='dept' only; others fetched for GEO and product-line tabs.
// When USE_SNAP=true:
//   - dept  targets: snap.mapping_weekly, mapping_name='profit_target_by_department'
//   - geo   targets: snap.mapping_weekly, mapping_name='profit_target_by_geo'
//   - pl    targets: snap.mapping_weekly, mapping_name='profit_target_by_product_line'
// All three are pinned to the same snapshot_date so geo/pl targets are consistent with data.
function makeQTargets(snapFilter: string | null): string {
  const useSnap = USE_SNAP && snapFilter !== null

  const deptFrom = useSnap
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

  const geoFrom = useSnap
    ? `(
  SELECT
    'geo'                                      AS kind,
    FORMAT_DATE('%Y-%m', key_date)             AS ym,
    key_1                                      AS dim,
    CAST(ROUND(value_num, 2) AS FLOAT64)       AS tgt,
    ''                                         AS notes
  FROM \`elife-data-warehouse-prod.snap.mapping_weekly\`
  WHERE snapshot_date = ${snapFilter}
    AND mapping_name  = 'profit_target_by_geo'
)`
    : `(
  SELECT 'geo' AS kind,
         FORMAT_DATE('%Y-%m', target_month) AS ym,
         geo AS dim,
         CAST(ROUND(profit_target,2) AS FLOAT64) AS tgt,
         notes
  FROM \`elife-data-warehouse-prod.mapping.mapping_profit_target_by_geo\`
)`

  const plFrom = useSnap
    ? `(
  SELECT
    'pl'                                       AS kind,
    FORMAT_DATE('%Y-%m', key_date)             AS ym,
    key_1                                      AS dim,
    CAST(ROUND(value_num, 2) AS FLOAT64)       AS tgt,
    ''                                         AS notes
  FROM \`elife-data-warehouse-prod.snap.mapping_weekly\`
  WHERE snapshot_date = ${snapFilter}
    AND mapping_name  = 'profit_target_by_product_line'
)`
    : `(
  SELECT 'pl' AS kind,
         FORMAT_DATE('%Y-%m', target_month) AS ym,
         product_line AS dim,
         CAST(ROUND(profit_target,2) AS FLOAT64) AS tgt,
         notes
  FROM \`elife-data-warehouse-prod.mapping.mapping_profit_target_by_product_line\`
)`

  return `
WITH u AS (
  SELECT kind, ym, dim, tgt, notes FROM ${deptFrom}
  UNION ALL
  SELECT kind, ym, dim, tgt, notes FROM ${geoFrom}
  UNION ALL
  SELECT kind, ym, dim, tgt, notes FROM ${plFrom}
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
// period='week': uses last_week_* columns with simple margin (no complete/dispatched split
//   exists at weekly grain). Revenue and cost are aggregated separately then subtracted
//   in the outer SELECT to prevent NULL-cost rows from silently dropping their revenue.
function makeQProd(snapFilter: string | null, period = 'mtd'): string {
  const fromClause = (USE_SNAP && snapFilter !== null)
    ? v2SnapSubquery(snapFilter)
    : '`elife-data-warehouse-prod.ads.ads_weekly_meeting_revenue_and_profit_v2`'

  if (period === 'week') {
    return `
WITH agg AS (
  SELECT
    product_line,
    SUM(last_week_sales)   AS sales,
    SUM(last_week_revenue) AS revenue,
    SUM(last_week_cost)    AS cost,
    SUM(prev_week_revenue) AS prev_revenue,
    SUM(prev_week_sales)   AS prev_sales,
    SUM(prev_week_cost)    AS prev_cost
  FROM ${fromClause}
  GROUP BY 1
)
SELECT
  IFNULL(product_line,"(Unassigned)")        AS pl,
  CAST(ROUND(sales,2)                  AS FLOAT64) AS sales,
  CAST(ROUND(revenue,2)                AS FLOAT64) AS revenue,
  CAST(ROUND(revenue - cost, 2)        AS FLOAT64) AS profit,
  CAST(ROUND(prev_revenue,2)           AS FLOAT64) AS prev_revenue,
  CAST(ROUND(prev_sales,2)             AS FLOAT64) AS prev_sales,
  CAST(ROUND(prev_revenue - prev_cost, 2) AS FLOAT64) AS prev_profit
FROM agg
`
  }

  // MTD / QTD / YTD — verbatim DAX formula, must not be changed.
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

// §1.8 makeQGeo — geography from v3, snapped when USE_SNAP=true.
// v3 == v2 on the 2026-08-24 snapshot (verified: revenue 6,842,682 identical).
// GEO attainment is now enabled — v3 revival confirmed correct.
// The lm_profit column (lmmtd_revenue - lmmtd_cost) is valid in the snap and must remain.
// When USE_SNAP=false, falls back to live v3 table (IFNULL(geo,...) handled in SQL).
// period='week': mirrors makeQProd week branch — separate SUM then outer subtract.
function makeQGeo(snapFilter: string | null, period = 'mtd'): string {
  const fromClause = (USE_SNAP && snapFilter !== null)
    ? v3SnapSubquery(snapFilter)
    // Live fallback: v3 table with explicit IFNULL on geo
    : `(
  SELECT
    IFNULL(geo,"(Unassigned)") AS geo,
    mtd_sales, current_mtd_revenue, current_mtd_cost,
    lmmtd_revenue, lmmtd_cost, complete, dispatched,
    last_week_sales, last_week_revenue, last_week_cost,
    prev_week_sales, prev_week_revenue, prev_week_cost
  FROM \`elife-data-warehouse-prod.ads.ads_weekly_meeting_revenue_and_profit_v3\`
)`

  if (period === 'week') {
    return `
WITH agg AS (
  SELECT
    geo,
    SUM(last_week_sales)   AS sales,
    SUM(last_week_revenue) AS revenue,
    SUM(last_week_cost)    AS cost,
    SUM(prev_week_revenue) AS prev_revenue,
    SUM(prev_week_sales)   AS prev_sales,
    SUM(prev_week_cost)    AS prev_cost
  FROM ${fromClause}
  GROUP BY 1
)
SELECT
  geo,
  CAST(ROUND(sales,2)                  AS FLOAT64) AS sales,
  CAST(ROUND(revenue,2)                AS FLOAT64) AS revenue,
  CAST(ROUND(revenue - cost, 2)        AS FLOAT64) AS profit,
  CAST(ROUND(prev_revenue,2)           AS FLOAT64) AS prev_revenue,
  CAST(ROUND(prev_sales,2)             AS FLOAT64) AS prev_sales,
  CAST(ROUND(prev_revenue - prev_cost, 2) AS FLOAT64) AS prev_profit
FROM agg
`
  }

  // MTD / QTD / YTD — verbatim DAX formula, must not be changed.
  return `
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
  FROM ${fromClause}
  GROUP BY 1
)
SELECT
  geo,
  CAST(ROUND(sales,2)   AS FLOAT64) AS sales,
  CAST(ROUND(revenue,2) AS FLOAT64) AS revenue,
  CAST(ROUND(IFNULL(cp + dp*0.9 + ep*SAFE_DIVIDE(cp,cr)*0.9, 0),2) AS FLOAT64) AS profit,
  CAST(ROUND(lm_profit,2) AS FLOAT64) AS lm_profit
FROM agg
`
}

// §2.1 makeQB2C — weekly window from snap.kpi_weekly, live sources, three grains
// Sources: ads.ads_b2c_dashboard_v (Hoppa) + ads.ads_b2c_dashboard_elife (eLife)
// NOT b2cdata.ads_ads_b2c_dashboard_v — see spec §1 / §11
// FX via scalar subquery (not CROSS JOIN — avoids double-counting if a 2nd row appears)
// period is a ROW dimension ('cur' / 'prev'), never pivoted — preserves NULLs to frontend
function makeQB2C(asAt: string | null): object {
  const query = `
WITH
w AS (
  SELECT DISTINCT snapshot_date, week_key, week_start, week_end
  FROM \`elife-data-warehouse-prod.snap.kpi_weekly\`
),
sel AS (SELECT * FROM w WHERE snapshot_date = @as_at),
prv AS (SELECT * FROM w WHERE snapshot_date < @as_at ORDER BY snapshot_date DESC LIMIT 1),
win AS (
  SELECT 'cur'  AS period, week_key, week_start AS s, week_end AS e FROM sel
  UNION ALL
  SELECT 'prev', week_key, week_start, week_end FROM prv
),
fx AS (
  SELECT rate AS g
  FROM \`elife-data-warehouse-prod.mapping.mapping_cur_exch_rate\`
  WHERE from_cur = 'USD' AND to_cur = 'GBP' LIMIT 1
),
raw AS (
  SELECT 'Hoppa' AS brand, booking_date, platform, marketing_channel,
         overall_sessions, keyEvents, ttv, actual_profit, estimate_profit, Spend
  FROM \`elife-data-warehouse-prod.ads.ads_b2c_dashboard_v\`
  UNION ALL
  SELECT 'Elife', booking_date, platform, marketing_channel,
         overall_sessions, keyEvents, ttv, actual_profit, estimate_profit, Spend
  FROM \`elife-data-warehouse-prod.ads.ads_b2c_dashboard_elife\`
),
t AS (
  SELECT win.period, win.week_key, win.s, win.e, r.brand, r.platform,
    CASE COALESCE(r.marketing_channel, 'Untracked')
      WHEN 'AI Assistants'  THEN 'AI / LLM'
      WHEN 'Organic Social' THEN 'Social'
      ELSE COALESCE(r.marketing_channel, 'Untracked')
    END AS channel,
    r.overall_sessions, r.keyEvents, r.ttv, r.actual_profit, r.estimate_profit, r.Spend
  FROM raw r
  JOIN win ON r.booking_date BETWEEN win.s AND win.e
  WHERE r.platform IN ('APP', 'WEB')
)
SELECT period, week_key, s AS week_start, e AS week_end,
       grain, dim, parent, platform,
       sessions, bookings, ttv, profit, spend_usd
FROM (
  -- brand grain
  SELECT period, week_key, s, e,
         'brand' AS grain, brand AS dim,
         CAST(NULL AS STRING) AS parent,
         CAST(NULL AS STRING) AS platform,
         SUM(overall_sessions)  AS sessions,
         SUM(keyEvents)         AS bookings,
         SUM(ttv)               AS ttv,
         SUM(IFNULL(actual_profit,0) + IFNULL(estimate_profit,0)) AS profit,
         SUM(Spend) / (SELECT g FROM fx) AS spend_usd
  FROM t GROUP BY 1,2,3,4,5,6,7,8
  UNION ALL
  -- channel grain (aggregated across platforms)
  SELECT period, week_key, s, e,
         'channel', channel, brand, CAST(NULL AS STRING),
         SUM(overall_sessions), SUM(keyEvents), SUM(ttv),
         SUM(IFNULL(actual_profit,0) + IFNULL(estimate_profit,0)),
         SUM(Spend) / (SELECT g FROM fx)
  FROM t GROUP BY 1,2,3,4,5,6,7,8
  UNION ALL
  -- channel × platform grain (for UI drill-down)
  SELECT period, week_key, s, e,
         'channel_platform', channel, brand, platform,
         SUM(overall_sessions), SUM(keyEvents), SUM(ttv),
         SUM(IFNULL(actual_profit,0) + IFNULL(estimate_profit,0)),
         SUM(Spend) / (SELECT g FROM fx)
  FROM t GROUP BY 1,2,3,4,5,6,7,8
)
ORDER BY period DESC, grain, parent NULLS FIRST, bookings DESC NULLS LAST
`
  return {
    query,
    queryParameters: [
      { name: 'as_at', parameterType: { type: 'STRING' },
        parameterValue: { value: asAt ?? '' } },
    ],
    useLegacySql: false,
  }
}


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

// makeQRH — Ride Hailing weekly, live sources, parameterised by @as_at
// §0:  rh_sales_trips excluded — broken since 2026-07-11
// §2:  partner_name LIKE '%Ride Hailing%' (case-sensitive, §4.3)
// §2.1: completed excludes ride_stat='Cancelled' even at dispatch_stat='At destination'
// §2.2: per-row rounding before SUM (matches Power BI)
// §2.3: failed_quotes added (by_pickup_date basis)
// §3:  dim.dim_service_area for Japan/Global — cannot fan out (1,558 rows, all distinct)
// §4.1: by_pickup_date — NOT by_search_date (10.9× wrong)
// §4.2: BETWEEN window excludes 2099-12-31 sentinel automatically
// §4.3: case-sensitive LIKE — 13 Tujing rows excluded, matches snapshot/Power BI basis
// Long format: 26 rows for 2 periods × (2 scopes × 5 metrics + 1 company × 3 metrics)
function makeQRH(asAt: string | null): { query: string; queryParameters: any[]; useLegacySql: boolean } {
  const query = `
WITH
w AS (
  SELECT DISTINCT snapshot_date, week_key, week_start, week_end
  FROM \`elife-data-warehouse-prod.snap.kpi_weekly\`
),
sel AS (SELECT * FROM w WHERE snapshot_date = @as_at),
prv AS (SELECT * FROM w WHERE snapshot_date < @as_at ORDER BY snapshot_date DESC LIMIT 1),
win AS (
  SELECT 'cur'  AS period, week_key, week_start AS s, week_end AS e FROM sel
  UNION ALL
  SELECT 'prev', week_key, week_start, week_end FROM prv
),
disp AS (
  SELECT win.period, win.week_key, win.s, win.e,
    IF(sa.country = 'Japan', 'Japan', 'Global') AS scope,
    r.dispatch_stat, r.ride_stat,
    r.elife_amount_usd, r.additional_charge_amount_usd, r.dispatch_amount_net_usd
  FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\` r
  LEFT JOIN \`elife-data-warehouse-prod.dim.dim_service_area\` sa
    ON r.service_area_id = sa.id
  JOIN win ON r.pickup_date BETWEEN win.s AND win.e
  WHERE r.partner_name LIKE '%Ride Hailing%'
),
disp_agg AS (
  SELECT period, week_key, s, e, scope,
    COUNT(*) AS service_trips,
    COUNTIF(dispatch_stat = 'At destination' AND IFNULL(ride_stat,'') <> 'Cancelled') AS completed_trips,
    COUNTIF(ride_stat = 'Cancelled') AS cancelled_trips,
    SUM(ROUND(IFNULL(elife_amount_usd,0),2) + ROUND(IFNULL(additional_charge_amount_usd,0),2)) AS revenue_usd,
    SUM(ROUND(IFNULL(dispatch_amount_net_usd,0),2)) AS cost_usd
  FROM disp GROUP BY 1,2,3,4,5
),
srch AS (
  SELECT win.period, win.week_key, win.s, win.e,
    SUM(t.request_number_by_pickup_date)      AS requests,
    SUM(t.quote_number_by_pickup_date)        AS quotes,
    SUM(t.failed_quote_number_by_pickup_date) AS failed_quotes
  FROM \`elife-data-warehouse-prod.ads.ads_ride_hailing_search_ride_summary\` t
  JOIN win ON t.date_calculate BETWEEN win.s AND win.e
  GROUP BY 1,2,3,4
)
SELECT period, week_key, week_start, week_end, grain, dim, metric, value FROM (
  SELECT period, week_key, s AS week_start, e AS week_end,
         'scope' AS grain, scope AS dim, m.metric, m.value
  FROM disp_agg, UNNEST([
    STRUCT('rh_service_trips'   AS metric, CAST(service_trips   AS NUMERIC) AS value),
    STRUCT('rh_completed_trips', CAST(completed_trips AS NUMERIC)),
    STRUCT('rh_cancelled_trips', CAST(cancelled_trips AS NUMERIC)),
    STRUCT('rh_revenue_usd',     CAST(revenue_usd     AS NUMERIC)),
    STRUCT('rh_cost_usd',        CAST(cost_usd        AS NUMERIC))
  ]) m
  UNION ALL
  SELECT period, week_key, s, e, 'company', 'Ride Hailing', m.metric, m.value
  FROM srch, UNNEST([
    STRUCT('rh_request_number'  AS metric, CAST(requests      AS NUMERIC) AS value),
    STRUCT('rh_quote_number',    CAST(quotes        AS NUMERIC)),
    STRUCT('rh_failed_quotes',   CAST(failed_quotes AS NUMERIC))
  ]) m
)
ORDER BY period DESC, grain, dim, metric
`
  return {
    query,
    queryParameters: [
      { name: 'as_at', parameterType: { type: 'STRING' },
        parameterValue: { value: asAt ?? '' } },
    ],
    useLegacySql: false,
  }
}

// makeQAI — AI Code & Test, snapshot-only via snap.kpi_weekly
// §0:  source is snap.manual_kpi_input — no live ads.* table exists
// §1.1: values stored on 0-100 scale — display as-is, do NOT multiply by 100
// §1.2: values are % ratios — never summed across periods
// §3.1: LEFT JOIN (not inner) — missing week returns NULL-metric row, distinguishable from zero
// §3.2: QUALIFY ROW_NUMBER() — collapses duplicates to latest etl_time
// §4:   @as_at via queryParameters
// Returns: 4 rows normal, 2 rows if no prior snapshot, ~1 row if current week has no manual data
function makeQAI(asAt: string | null): { query: string; queryParameters: any[]; useLegacySql: boolean } {
  const query = `
WITH
w AS (
  SELECT DISTINCT snapshot_date, week_key, week_start, week_end
  FROM \`elife-data-warehouse-prod.snap.kpi_weekly\`
),
sel AS (SELECT * FROM w WHERE snapshot_date = @as_at),
prv AS (SELECT * FROM w WHERE snapshot_date < @as_at ORDER BY snapshot_date DESC LIMIT 1),
win AS (
  SELECT 'cur'  AS period, snapshot_date, week_key, week_start, week_end FROM sel
  UNION ALL
  SELECT 'prev', snapshot_date, week_key, week_start, week_end FROM prv
)
SELECT
  win.period,
  win.week_key,
  CAST(win.week_start AS STRING) AS week_start,
  CAST(win.week_end   AS STRING) AS week_end,
  k.grain,
  k.dim,
  k.metric,
  k.value,
  CAST(k.etl_time AS STRING) AS etl_time
FROM win
LEFT JOIN (
  SELECT snapshot_date, grain, dim, metric, value, etl_time
  FROM \`elife-data-warehouse-prod.snap.kpi_weekly\`
  WHERE page = 'ai_code_test'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY snapshot_date, grain, dim, metric ORDER BY etl_time DESC
  ) = 1
) k
  ON k.snapshot_date = win.snapshot_date
ORDER BY win.period DESC, k.metric
`
  return {
    query,
    queryParameters: [
      { name: 'as_at', parameterType: { type: 'STRING' },
        parameterValue: { value: asAt ?? '' } },
    ],
    useLegacySql: false,
  }
}

// makeQWilson — Wilson's Partner Incident Rate (Lost) table
// Build spec: Quality tab §4
// Three windows derived from snap.kpi_weekly week_end for @as_at:
//   cur_28d  = [week_end-27d .. week_end]
//   prev_28d = [week_end-34d .. week_end-7d]
//   ytd      = [Jan 1 .. week_end]
// Returns 9 rows: 3 windows × (Total + Prebooked + Ride Hailing) via ROLLUP
// §1.1 guardrails enforced here (exact string, has_complaint, dispatch_stat, dedup, partner_name only)
function makeQWilson(asAt: string | null): { query: string; queryParameters: any[]; useLegacySql: boolean } {
  const query = `
WITH
-- Anchor: resolve week_end from the selected snapshot
sel AS (
  SELECT DISTINCT snapshot_date, week_end
  FROM \`elife-data-warehouse-prod.snap.kpi_weekly\`
  WHERE snapshot_date = @as_at
  LIMIT 1
),
-- Three windows derived from week_end (§2)
win AS (
  SELECT 'cur_28d'  AS col, DATE_SUB(week_end, INTERVAL 27 DAY) AS s, week_end               AS e FROM sel
  UNION ALL
  SELECT 'prev_28d',        DATE_SUB(week_end, INTERVAL 34 DAY),     DATE_SUB(week_end, INTERVAL 7 DAY)  FROM sel
  UNION ALL
  SELECT 'ytd',             DATE_TRUNC(week_end, YEAR),               week_end                           FROM sel
),
-- Incident flags deduplicated to trip grain (§1.1 — exact string, §1.1.4 dedup)
inc AS (
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
-- Valid trips per window, with product line from partner_name only (§1.1.5)
wt AS (
  SELECT
    win.col,
    win.s,
    win.e,
    IF(STRPOS(IFNULL(v.partner_name,''), 'Ride Hailing') > 0,
       'Ride Hailing', 'Prebooked') AS biz,
    IFNULL(i.pi_in,   0) AS pi_in,
    IFNULL(i.pi_ex,   0) AS pi_ex,
    IFNULL(i.pi_lost, 0) AS pi_lost
  FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\` v
  JOIN win ON v.pickup_date BETWEEN win.s AND win.e
  LEFT JOIN inc i ON i.ride_id = v.ride_id AND i.trip_no = v.trip_no
  -- §1.1.2: has_complaint trips included in denominator even if ride_stat not Accepted/Pending
  WHERE (v.ride_stat IN ('Accepted','Pending') OR v.has_complaint = 1)
  -- §1.1.3: exclude dispatch_stat = '' (empty string — Hoppa self-supply)
    AND IFNULL(v.dispatch_stat, 'x') <> ''
)
-- ROLLUP produces the weighted Total row (§4.1 — not an average of two rates)
SELECT
  col,
  MIN(s)             AS window_start,
  MAX(e)             AS window_end,
  IFNULL(biz,'Total') AS product_line,
  CAST(COUNT(*)       AS FLOAT64) AS valid_trips,
  CAST(SUM(pi_lost)   AS FLOAT64) AS incidents_lost,
  CAST(SUM(pi_ex)     AS FLOAT64) AS incidents_ex,
  CAST(SUM(pi_in)     AS FLOAT64) AS incidents_in
FROM wt
GROUP BY ROLLUP(col, biz)
HAVING col IS NOT NULL
ORDER BY col,
  CASE IFNULL(biz,'Total') WHEN 'Total' THEN 0 WHEN 'Prebooked' THEN 1 ELSE 2 END
`
  return {
    query,
    queryParameters: [
      { name: 'as_at', parameterType: { type: 'STRING' },
        parameterValue: { value: asAt ?? '' } },
    ],
    useLegacySql: false,
  }
}

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

    // Parse and validate asAt + period from request body
    let bodyJson: any = {}
    try { bodyJson = await req.json() } catch { /* empty body is fine */ }
    const rawAsAt: string | null = typeof bodyJson?.asAt === 'string' ? bodyJson.asAt : null

    // Validate period against allowlist — reject unknown values with 400.
    const VALID_PERIODS = new Set(['mtd', 'qtd', 'ytd', 'week'])
    const rawPeriod: string = typeof bodyJson?.period === 'string' ? bodyJson.period : 'mtd'
    if (!VALID_PERIODS.has(rawPeriod)) {
      return new Response(JSON.stringify({ error: `Unknown period: ${rawPeriod}` }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      })
    }
    const period: string = rawPeriod

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
    const Q_PROD    = makeQProd(snapFilter, period)
    const Q_GEO     = makeQGeo(snapFilter, period)
    const Q_FCC     = makeQFCC(snapFilter)

    // Wave 2 — run all remaining queries in parallel, including custPrev.
    const stalenessPromise = USE_SNAP
      ? runQuery(projectId, makeQStaleness(snapFilter), accessToken).catch(() => [])
      : Promise.resolve([])

    const [
      custRows, targetsRows, fcRows, monthsRows, fccRows,
      prodRows, geoRows, b2cRows, b2cMRows, rhRows, mqRows, aiRows,
      wilsonRows,
      stalenessRows, custPrevRows,
    ] = await Promise.all([
      runQuery(projectId, Q_CUST,    accessToken),
      runQuery(projectId, Q_TARGETS, accessToken),
      runQuery(projectId, Q_FC,      accessToken),
      runQuery(projectId, Q_MONTHS,  accessToken),
      runQuery(projectId, Q_FCC,     accessToken).catch(() => []),
      runQuery(projectId, Q_PROD,    accessToken).catch(() => []),
      runQuery(projectId, Q_GEO,     accessToken).catch(() => []),  // v3 snapped
      runQueryParameterised(projectId, makeQB2C(rawAsAt ?? resolvedCurrent), accessToken).catch(() => []),
      runQuery(projectId, Q_B2C_M,   accessToken).catch(() => []),
      runQueryParameterised(projectId, makeQRH(rawAsAt ?? resolvedCurrent), accessToken).catch(() => []),
      runQuery(projectId, Q_MQ,      accessToken).catch(() => []),
      runQueryParameterised(projectId, makeQAI(rawAsAt ?? resolvedCurrent), accessToken).catch(() => []),
      runQueryParameterised(projectId, makeQWilson(rawAsAt ?? resolvedCurrent), accessToken).catch(() => []),
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
        // week-period data-quality flags (independent per source table)
        prod_week_empty: period === 'week' && prodRows.every((r: any) => !r.revenue || r.revenue === 0),
        geo_week_empty:  period === 'week' && geoRows.every((r: any)  => !r.revenue || r.revenue === 0),
        b2c:          b2cRows,
        b2cM:         b2cMRows,
        rh:           rhRows,
        mq:           mqRows,
        ai:           aiRows,
        wilson:       wilsonRows,
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
