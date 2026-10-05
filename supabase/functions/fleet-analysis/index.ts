import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { requireAuth } from '../_shared/requireAuth.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ─── BigQuery helpers (identical scopes to bigquery-report-109) ───────────────
async function getBQToken(saJson: string): Promise<string> {
  const sa  = JSON.parse(saJson)
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss:   sa.client_email,
    scope: [
      'https://www.googleapis.com/auth/bigquery.readonly',
      'https://www.googleapis.com/auth/cloud-platform.read-only',
    ].join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }
  const enc = (o: object) =>
    btoa(JSON.stringify(o)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')

  const unsigned = `${enc({ alg:'RS256', typ:'JWT' })}.${enc(payload)}`

  const pem = sa.private_key
    .replace('-----BEGIN PRIVATE KEY-----','')
    .replace('-----END PRIVATE KEY-----','')
    .replace(/\s/g,'')

  const privKey = await crypto.subtle.importKey(
    'pkcs8',
    Uint8Array.from(atob(pem), c => c.charCodeAt(0)),
    { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' },
    false, ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privKey, new TextEncoder().encode(unsigned))
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')

  const jwt = `${unsigned}.${sig}`
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) throw new Error(`BQ token: ${JSON.stringify(tokenData)}`)
  return tokenData.access_token
}

// Parse a BigQuery query response into plain JS objects
function parseRows(schema: any[], rows: any[]): Record<string,unknown>[] {
  return rows.map(row => {
    const obj: Record<string,unknown> = {}
    schema.forEach((f: any, i: number) => {
      const raw = row.f[i]?.v
      if (raw == null) { obj[f.name] = null; return }
      if (f.type === 'STRING' || f.type === 'DATE') { obj[f.name] = raw; return }
      const num = Number(raw)
      obj[f.name] = isNaN(num) ? raw : num
    })
    return obj
  })
}

// Run a BigQuery query using the synchronous /queries endpoint (same as bigquery-report-109).
// Uses readonly scopes. If the first call times out (jobComplete=false) we poll via /queries/{jobId}.
async function runQuery(
  projectId: string,
  sql:       string,
  token:     string,
): Promise<Record<string,unknown>[]> {
  const url  = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`
  const body = JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 55000 })

  const res = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`BQ query ${res.status}: ${txt.slice(0, 600)}`)
  }

  const result = await res.json()
  if (result.errors?.length) throw new Error(`BQ errors: ${JSON.stringify(result.errors)}`)

  // Happy path — query finished within 55 s
  if (result.jobComplete) {
    const schema = result.schema?.fields ?? []
    return parseRows(schema, result.rows ?? [])
  }

  // Still running — poll via /queries/{jobId}
  const jobId = result.jobReference?.jobId
  if (!jobId) throw new Error('BQ: jobComplete=false and no jobId')

  let schema: any[] = []
  const rows: Record<string,unknown>[] = []
  let pageToken: string | undefined
  let attempts = 0

  do {
    await new Promise(r => setTimeout(r, 3000))
    if (attempts++ > 20) throw new Error('BQ: job timed out after 60 s of polling')

    const pollUrl = new URL(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}`,
    )
    pollUrl.searchParams.set('timeoutMs', '5000')
    pollUrl.searchParams.set('maxResults', '50000')
    if (pageToken) pollUrl.searchParams.set('pageToken', pageToken)

    const pollRes = await fetch(pollUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!pollRes.ok) continue

    const pr = await pollRes.json()
    if (!pr.jobComplete) continue   // still running, loop again

    schema    = pr.schema?.fields ?? schema
    pageToken = pr.pageToken
    rows.push(...parseRows(schema, pr.rows ?? []))
  } while (pageToken)

  return rows
}

// ─── Date normaliser (accept YYYY-MM or YYYY-MM-DD) ──────────────────────────
function toDate(s: string | undefined, fallback: string): string {
  if (!s) return fallback
  return s.length === 7 ? `${s}-01` : s
}

// ─── SQL builders (verbatim from brief) ──────────────────────────────────────
function sqlMonthly(asAt: string): string {
  return `
WITH params AS (
  SELECT DATE '2023-01-01' AS start_month,
         DATE '${asAt}' AS as_at_month
),
base AS (
  SELECT t.to_fleet_id AS fid, DATE_TRUNC(t.pickup_date, MONTH) AS m,
         t.dispatch_stat, t.elife_amount_usd, t.additional_charge_amount_usd,
         t.dispatch_amount_net_usd, t.complaint_trip
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\` t, params p
  WHERE t.pickup_date BETWEEN p.start_month AND LAST_DAY(p.as_at_month)
),
fm AS (
  SELECT fid, m, COUNT(*) AS disp,
    COUNTIF(dispatch_stat IN ('At destination','Customer no show')) AS term,
    SUM(IF(dispatch_stat IN ('At destination','Customer no show'),
           elife_amount_usd + IFNULL(additional_charge_amount_usd, 0), 0)) AS rev,
    SUM(IF(dispatch_stat IN ('At destination','Customer no show'),
           dispatch_amount_net_usd, 0)) AS cost,
    SUM(complaint_trip) AS ct
  FROM base GROUP BY fid, m
),
fm_clean AS (
  SELECT *, IFNULL(SAFE_DIVIDE(rev, NULLIF(term, 0)) > 2000, FALSE) AS is_outlier
  FROM fm
),
act AS (
  SELECT fid, m,
    LAG(m)  OVER (PARTITION BY fid ORDER BY m) AS prev_m,
    LEAD(m) OVER (PARTITION BY fid ORDER BY m) AS next_m
  FROM fm WHERE term > 0
),
started_returned AS (
  SELECT m,
    COUNTIF(prev_m IS NULL) AS started,
    COUNTIF(prev_m IS NOT NULL AND DATE_DIFF(m, prev_m, MONTH) >= 4) AS returned
  FROM act GROUP BY m
),
stopped AS (
  SELECT DATE_ADD(a.m, INTERVAL 1 MONTH) AS m, COUNT(*) AS stopped
  FROM act a, params p
  WHERE (a.next_m IS NULL OR DATE_DIFF(a.next_m, a.m, MONTH) >= 4)
    AND DATE_ADD(a.m, INTERVAL 1 MONTH) <= DATE_SUB(p.as_at_month, INTERVAL 3 MONTH)
  GROUP BY 1
),
monthly AS (
  SELECT m, COUNTIF(term > 0) AS active_fleets, SUM(disp) AS dispatched_trips,
    SUM(IF(is_outlier, 0, rev)) AS elife_revenue,
    SUM(IF(is_outlier, 0, cost)) AS fleet_revenue,
    SUM(ct) AS complaint_trips
  FROM fm_clean GROUP BY m
)
SELECT
  g.m AS month_start, FORMAT_DATE('%Y-%m', g.m) AS month_label,
  g.active_fleets,
  IFNULL(sr.started, 0) AS started, IFNULL(sr.returned, 0) AS returned,
  IF(g.m <= DATE_SUB(p.as_at_month, INTERVAL 3 MONTH), IFNULL(s.stopped, 0), NULL) AS stopped,
  IF(g.m <= DATE_SUB(p.as_at_month, INTERVAL 3 MONTH),
     IFNULL(sr.started,0) + IFNULL(sr.returned,0) - IFNULL(s.stopped,0), NULL) AS net_fleets,
  g.dispatched_trips, g.elife_revenue, g.fleet_revenue,
  g.elife_revenue - g.fleet_revenue AS elife_profit,
  SAFE_DIVIDE(g.elife_revenue - g.fleet_revenue, g.active_fleets) AS profit_per_active_fleet,
  g.complaint_trips
FROM monthly g
CROSS JOIN params p
LEFT JOIN started_returned sr ON sr.m = g.m
LEFT JOIN stopped s           ON s.m  = g.m
ORDER BY g.m`
}

function sqlKpis(asAt: string, rStart: string, rEnd: string): string {
  return `
WITH params AS (
  SELECT DATE '2023-01-01' AS data_start,
         DATE '${asAt}'   AS as_at_month,
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
base AS (
  SELECT t.to_fleet_id AS fid, DATE_TRUNC(t.pickup_date, MONTH) AS m, t.dispatch_stat,
         t.elife_amount_usd, t.additional_charge_amount_usd, t.dispatch_amount_net_usd, t.complaint_trip
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\` t, win w
  WHERE t.pickup_date BETWEEN w.data_start AND LAST_DAY(w.as_at_month)
),
fm AS (
  SELECT fid, m, COUNT(*) AS disp,
    COUNTIF(dispatch_stat IN ('At destination','Customer no show')) AS term,
    SUM(IF(dispatch_stat IN ('At destination','Customer no show'),
           elife_amount_usd + IFNULL(additional_charge_amount_usd,0), 0)) AS rev,
    SUM(IF(dispatch_stat IN ('At destination','Customer no show'),
           dispatch_amount_net_usd, 0)) AS cost,
    SUM(complaint_trip) AS ct
  FROM base GROUP BY 1, 2
),
fmc AS (SELECT *, IFNULL(SAFE_DIVIDE(rev, NULLIF(term,0)) > 2000, FALSE) AS is_outlier FROM fm),
act AS (
  SELECT fid, m,
    LAG(m)  OVER (PARTITION BY fid ORDER BY m) AS prev_m,
    LEAD(m) OVER (PARTITION BY fid ORDER BY m) AS next_m
  FROM fm WHERE term > 0
),
mon AS (
  SELECT m, COUNTIF(term > 0) AS active, SUM(disp) AS disp,
    SUM(IF(is_outlier,0,rev)) AS rev, SUM(IF(is_outlier,0,cost)) AS cost, SUM(ct) AS ct
  FROM fmc GROUP BY m
),
ev AS (
  SELECT m,
    COUNTIF(prev_m IS NULL) AS st,
    COUNTIF(prev_m IS NOT NULL AND DATE_DIFF(m, prev_m, MONTH) >= 4) AS rt
  FROM act GROUP BY m
),
sp AS (
  SELECT DATE_ADD(a.m, INTERVAL 1 MONTH) AS m, COUNT(*) AS sp
  FROM act a, win w
  WHERE (a.next_m IS NULL OR DATE_DIFF(a.next_m, a.m, MONTH) >= 4)
    AND DATE_ADD(a.m, INTERVAL 1 MONTH) <= DATE_SUB(w.as_at_month, INTERVAL 3 MONTH)
  GROUP BY 1
),
m2 AS (
  SELECT mon.*, IFNULL(ev.st,0) AS st, IFNULL(ev.rt,0) AS rt, IFNULL(sp.sp,0) AS sp
  FROM mon LEFT JOIN ev USING (m) LEFT JOIN sp USING (m)
),
agg AS (
  SELECT
    SUM(IF(m BETWEEN w.range_start AND w.range_end, st,   0))  AS started,
    SUM(IF(m BETWEEN w.prior_start AND w.prior_end, st,   0))  AS started_prior,
    SUM(IF(m BETWEEN w.range_start AND w.range_end, rt,   0))  AS returned,
    SUM(IF(m BETWEEN w.range_start AND w.range_end, sp,   0))  AS stopped,
    SUM(IF(m BETWEEN w.prior_start AND w.prior_end, sp,   0))  AS stopped_prior,
    SUM(IF(m BETWEEN w.range_start AND w.range_end, disp, 0))  AS dispatched,
    SUM(IF(m BETWEEN w.prior_start AND w.prior_end, disp, 0))  AS dispatched_prior,
    SUM(IF(m BETWEEN w.range_start AND w.range_end, rev,  0))  AS rev,
    SUM(IF(m BETWEEN w.prior_start AND w.prior_end, rev,  0))  AS rev_prior,
    SUM(IF(m BETWEEN w.range_start AND w.range_end, rev-cost, 0)) AS profit,
    SUM(IF(m BETWEEN w.prior_start AND w.prior_end, rev-cost, 0)) AS profit_prior,
    AVG(IF(m BETWEEN w.range_start AND w.range_end, active, NULL)) AS avg_active,
    SUM(IF(m BETWEEN w.range_start AND w.range_end, ct,   0))  AS complaints,
    MAX(IF(m = w.range_end,   active, NULL)) AS active_end,
    MAX(IF(m = w.prior_end,   active, NULL)) AS active_end_prior,
    ANY_VALUE(w.n_months) AS n_months
  FROM m2 CROSS JOIN win w
)
SELECT
  active_end,
  SAFE_DIVIDE(active_end - active_end_prior, active_end_prior)   AS active_end_vs_prior,
  started, SAFE_DIVIDE(started - started_prior, started_prior)   AS started_vs_prior,
  returned, stopped,
  SAFE_DIVIDE(stopped - stopped_prior, stopped_prior)            AS stopped_vs_prior,
  started + returned - stopped                                   AS net_fleets,
  dispatched,
  SAFE_DIVIDE(dispatched - dispatched_prior, dispatched_prior)   AS dispatched_vs_prior,
  profit                                                         AS elife_profit,
  SAFE_DIVIDE(profit - profit_prior, ABS(profit_prior))          AS profit_vs_prior,
  SAFE_DIVIDE(profit, rev)                                       AS margin,
  SAFE_DIVIDE(
    SAFE_DIVIDE(profit, rev) - SAFE_DIVIDE(profit_prior, rev_prior),
    ABS(SAFE_DIVIDE(profit_prior, rev_prior))
  )                                                              AS margin_vs_prior,
  SAFE_DIVIDE(profit, avg_active)                                AS profit_per_active_fleet,
  SAFE_DIVIDE(complaints, dispatched)                            AS complaint_rate,
  n_months
FROM agg`
}

function sqlLifecycle(asAt: string): string {
  return `
WITH params AS (
  SELECT DATE '2023-01-01' AS start_month,
         DATE '${asAt}' AS as_at_month
),
fm AS (
  SELECT t.to_fleet_id AS fid, DATE_TRUNC(t.pickup_date, MONTH) AS m,
    COUNTIF(t.dispatch_stat IN ('At destination','Customer no show')) AS term
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\` t, params p
  WHERE t.pickup_date BETWEEN p.start_month AND LAST_DAY(p.as_at_month)
  GROUP BY 1, 2
),
last_act AS (
  SELECT fid, MAX(m) AS last_active_month FROM fm WHERE term > 0 GROUP BY fid
)
SELECT
  CASE
    WHEN DATE_DIFF(p.as_at_month, l.last_active_month, MONTH) = 0              THEN 1
    WHEN DATE_DIFF(p.as_at_month, l.last_active_month, MONTH) BETWEEN 1 AND 2  THEN 2
    WHEN DATE_DIFF(p.as_at_month, l.last_active_month, MONTH) BETWEEN 3 AND 5  THEN 3
    WHEN DATE_DIFF(p.as_at_month, l.last_active_month, MONTH) BETWEEN 6 AND 11 THEN 4
    ELSE 5
  END AS sort_order,
  CASE
    WHEN DATE_DIFF(p.as_at_month, l.last_active_month, MONTH) = 0              THEN 'Active (this month)'
    WHEN DATE_DIFF(p.as_at_month, l.last_active_month, MONTH) BETWEEN 1 AND 2  THEN 'Active (1\u20132 mo ago)'
    WHEN DATE_DIFF(p.as_at_month, l.last_active_month, MONTH) BETWEEN 3 AND 5  THEN 'Dormant (3\u20135 mo)'
    WHEN DATE_DIFF(p.as_at_month, l.last_active_month, MONTH) BETWEEN 6 AND 11 THEN 'Lapsed (6\u201311 mo)'
    ELSE 'Churned (12+ mo)'
  END AS lifecycle_state,
  COUNT(*) AS fleets
FROM last_act l CROSS JOIN params p
GROUP BY 1, 2
ORDER BY 1`
}

// ─── Main handler ─────────────────────────────────────────────────────────────
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
    if (!svcJson) throw new Error('BIGQUERY_SERVICE_ACCOUNT_JSON not configured')

    const projectId = Deno.env.get('BIGQUERY_PROJECT_ID')
    if (!projectId) throw new Error('BIGQUERY_PROJECT_ID not configured')

    const token = await getBQToken(svcJson)

    const jobs: { key: string; promise: Promise<Record<string,unknown>[]> }[] = []

    if (dataset === 'all' || dataset === 'monthly')
      jobs.push({ key: 'monthly',   promise: runQuery(projectId, sqlMonthly(asAt), token) })
    if (dataset === 'all' || dataset === 'kpis')
      jobs.push({ key: 'kpis',      promise: runQuery(projectId, sqlKpis(asAt, rStart, rEnd), token) })
    if (dataset === 'all' || dataset === 'lifecycle')
      jobs.push({ key: 'lifecycle', promise: runQuery(projectId, sqlLifecycle(asAt), token) })

    const results = await Promise.all(jobs.map(j => j.promise))

    const payload: Record<string,unknown> = {
      meta: { as_at_month: asAt, range_start: rStart, range_end: rEnd, queried_at: new Date().toISOString() },
    }
    jobs.forEach(({ key }, i) => {
      payload[key] = key === 'kpis' ? (results[i][0] ?? null) : results[i]
    })

    return new Response(JSON.stringify(payload), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[fleet-analysis]', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
