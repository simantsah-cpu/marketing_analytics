import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { requireAuth } from '../_shared/requireAuth.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function getBQToken(saJson: string): Promise<string> {
  const sa  = JSON.parse(saJson)
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: sa.client_email,
    scope: ['https://www.googleapis.com/auth/bigquery.readonly','https://www.googleapis.com/auth/cloud-platform.read-only'].join(' '),
    aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now,
  }
  const enc = (o: object) => btoa(JSON.stringify(o)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  const unsigned = `${enc({alg:'RS256',typ:'JWT'})}.${enc(payload)}`
  const pem = sa.private_key.replace('-----BEGIN PRIVATE KEY-----','').replace('-----END PRIVATE KEY-----','').replace(/\s/g,'')
  const pk  = await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign'])
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pk,new TextEncoder().encode(unsigned)))))
    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  const r = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsigned}.${sig}`})
  const d = await r.json()
  if (!d.access_token) throw new Error(`BQ token: ${JSON.stringify(d)}`)
  return d.access_token
}

function parseRows(schema: any[], rows: any[]): Record<string,unknown>[] {
  return rows.map(row => {
    const obj: Record<string,unknown> = {}
    schema.forEach((f:any,i:number) => {
      const raw = row.f[i]?.v
      if (raw == null) { obj[f.name] = null; return }
      if (f.type === 'STRING' || f.type === 'DATE') { obj[f.name] = raw; return }
      const num = Number(raw); obj[f.name] = isNaN(num) ? raw : num
    })
    return obj
  })
}

async function runQuery(projectId: string, sql: string, token: string): Promise<Record<string,unknown>[]> {
  const res = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`,{
    method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body: JSON.stringify({query:sql,useLegacySql:false,timeoutMs:55000}),
  })
  if (!res.ok) { const t=await res.text(); throw new Error(`BQ ${res.status}: ${t.slice(0,500)}`) }
  const result = await res.json()
  if (result.errors?.length) throw new Error(`BQ errors: ${JSON.stringify(result.errors)}`)
  if (result.jobComplete) return parseRows(result.schema?.fields??[],result.rows??[])
  const jobId = result.jobReference?.jobId
  if (!jobId) throw new Error('BQ: no jobId')
  const rows: Record<string,unknown>[] = []
  let schema: any[] = [], pageToken: string|undefined, attempts = 0
  do {
    await new Promise(r=>setTimeout(r,3000))
    if (attempts++ > 20) throw new Error('BQ: timed out')
    const u = new URL(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}`)
    u.searchParams.set('timeoutMs','5000'); u.searchParams.set('maxResults','50000')
    if (pageToken) u.searchParams.set('pageToken',pageToken)
    const pr = await fetch(u.toString(),{headers:{Authorization:`Bearer ${token}`}})
    if (!pr.ok) continue
    const p = await pr.json()
    if (!p.jobComplete) continue
    schema = p.schema?.fields ?? schema; pageToken = p.pageToken
    rows.push(...parseRows(schema, p.rows??[]))
  } while (pageToken)
  return rows
}

function td(s: string|undefined, fallback: string): string {
  if (!s) return fallback; return s.length===7 ? `${s}-01` : s
}

// ── Dataset 1: drv_monthly ────────────────────────────────────────────────────
function sqlMonthly(asAt: string): string { return `
WITH params AS (
  SELECT DATE '2023-01-01' AS start_month,
         DATE '${asAt}' AS as_at_month
),
t AS (
  SELECT f.fleet_driver_id AS did, DATE_TRUNC(f.pickup_date, MONTH) AS m, f.DNS_trip AS dns
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\` f, params p
  WHERE f.pickup_date BETWEEN p.start_month AND LAST_DAY(p.as_at_month)
),
dm AS (SELECT did, m FROM t WHERE did IS NOT NULL GROUP BY 1, 2),
seq AS (
  SELECT did, m,
    LAG(m)  OVER (PARTITION BY did ORDER BY m) AS prev_m,
    LEAD(m) OVER (PARTITION BY did ORDER BY m) AS next_m
  FROM dm
),
ev AS (
  SELECT m,
    COUNTIF(prev_m IS NULL) AS started,
    COUNTIF(prev_m IS NOT NULL AND DATE_DIFF(m, prev_m, MONTH) >= 4) AS returned
  FROM seq GROUP BY m
),
stp AS (
  SELECT DATE_ADD(s.m, INTERVAL 1 MONTH) AS m, COUNT(*) AS stopped
  FROM seq s, params p
  WHERE (s.next_m IS NULL OR DATE_DIFF(s.next_m, s.m, MONTH) >= 4)
    AND DATE_ADD(s.m, INTERVAL 1 MONTH) <= DATE_SUB(p.as_at_month, INTERVAL 3 MONTH)
  GROUP BY 1
),
tot AS (
  SELECT m, COUNT(*) AS dispatched_trips,
    COUNTIF(did IS NOT NULL) AS trips_with_driver,
    COUNT(DISTINCT did) AS active_drivers, SUM(dns) AS dns_trips
  FROM t GROUP BY m
)
SELECT
  x.m AS month_start, FORMAT_DATE('%Y-%m', x.m) AS month_label,
  x.dispatched_trips, x.trips_with_driver, x.active_drivers, x.dns_trips,
  IFNULL(e.started, 0) AS drivers_started, IFNULL(e.returned, 0) AS drivers_returned,
  IF(x.m <= DATE_SUB(p.as_at_month, INTERVAL 3 MONTH), IFNULL(s.stopped, 0), NULL) AS drivers_stopped,
  SAFE_DIVIDE(x.trips_with_driver, x.dispatched_trips) AS driver_id_coverage,
  SAFE_DIVIDE(x.dns_trips, x.dispatched_trips) AS dns_rate,
  SAFE_DIVIDE(x.trips_with_driver, x.active_drivers) AS trips_per_driver
FROM tot x CROSS JOIN params p
LEFT JOIN ev e ON e.m = x.m LEFT JOIN stp s ON s.m = x.m
ORDER BY x.m` }

// ── Dataset 2: drv_kpis ───────────────────────────────────────────────────────
function sqlKpis(asAt: string, rStart: string, rEnd: string): string { return `
WITH params AS (
  SELECT DATE '2023-01-01' AS data_start,
         DATE '${asAt}' AS as_at_month,
         DATE '${rStart}' AS range_start,
         DATE '${rEnd}' AS range_end
),
win AS (
  SELECT p.*,
    DATE_DIFF(range_end, range_start, MONTH) + 1 AS n_months,
    GREATEST(data_start, DATE_SUB(range_start, INTERVAL DATE_DIFF(range_end, range_start, MONTH) + 1 MONTH)) AS prior_start,
    DATE_SUB(range_start, INTERVAL 1 MONTH) AS prior_end
  FROM params p
),
t AS (
  SELECT f.fleet_driver_id AS did, DATE_TRUNC(f.pickup_date, MONTH) AS m, f.DNS_trip AS dns
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\` f, win w
  WHERE f.pickup_date BETWEEN w.data_start AND LAST_DAY(w.as_at_month)
),
dm AS (SELECT did, m FROM t WHERE did IS NOT NULL GROUP BY 1, 2),
seq AS (
  SELECT did, m,
    LAG(m)  OVER (PARTITION BY did ORDER BY m) AS prev_m,
    LEAD(m) OVER (PARTITION BY did ORDER BY m) AS next_m
  FROM dm
),
ev AS (
  SELECT m, COUNTIF(prev_m IS NULL) AS st,
    COUNTIF(prev_m IS NOT NULL AND DATE_DIFF(m, prev_m, MONTH) >= 4) AS rt
  FROM seq GROUP BY m
),
sp AS (
  SELECT DATE_ADD(s.m, INTERVAL 1 MONTH) AS m, COUNT(*) AS sp
  FROM seq s, win w
  WHERE (s.next_m IS NULL OR DATE_DIFF(s.next_m, s.m, MONTH) >= 4)
    AND DATE_ADD(s.m, INTERVAL 1 MONTH) <= DATE_SUB(w.as_at_month, INTERVAL 3 MONTH)
  GROUP BY 1
),
mon AS (
  SELECT m, COUNT(*) AS trips, COUNTIF(did IS NOT NULL) AS wd,
         COUNT(DISTINCT did) AS drv, SUM(dns) AS dns
  FROM t GROUP BY m
),
m2 AS (
  SELECT mon.*, IFNULL(ev.st,0) AS st, IFNULL(ev.rt,0) AS rt, IFNULL(sp.sp,0) AS sp
  FROM mon LEFT JOIN ev USING (m) LEFT JOIN sp USING (m)
),
agg AS (
  SELECT
    MAX(IF(m = w.range_end, drv, NULL)) AS active_end,
    MAX(IF(m = w.prior_end, drv, NULL)) AS active_end_prior,
    SUM(IF(m BETWEEN w.range_start AND w.range_end, st,   0)) AS started,
    SUM(IF(m BETWEEN w.range_start AND w.range_end, rt,   0)) AS returned,
    SUM(IF(m BETWEEN w.range_start AND w.range_end, sp,   0)) AS stopped,
    SUM(IF(m BETWEEN w.range_start AND w.range_end, dns,  0)) AS dns,
    SUM(IF(m BETWEEN w.range_start AND w.range_end, trips,0)) AS trips,
    SUM(IF(m BETWEEN w.range_start AND w.range_end, wd,   0)) AS wd,
    ANY_VALUE(w.n_months) AS n_months
  FROM m2 CROSS JOIN win w
)
SELECT
  active_end,
  SAFE_DIVIDE(active_end - active_end_prior, active_end_prior) AS active_end_vs_prior,
  started, returned, stopped,
  SAFE_DIVIDE(dns, trips) AS driver_no_show_rate,
  SAFE_DIVIDE(wd, trips)  AS trips_with_driver_id,
  n_months
FROM agg` }

// ── Dataset 3: drv_events ─────────────────────────────────────────────────────
function sqlEvents(asAt: string): string { return `
WITH params AS (SELECT DATE '${asAt}' AS as_at_month)
SELECT
  DATE_TRUNC(DATE(e.pickup_datetime), MONTH) AS month_start,
  FORMAT_DATE('%Y-%m', DATE_TRUNC(DATE(e.pickup_datetime), MONTH)) AS month_label,
  SUM(e.ad_check)  AS ad_check,
  SUM(e.cns_check) AS cns_check
FROM \`elife-data-warehouse-prod.ads.ads_driver_event_detail\` e, params p
WHERE DATE(e.pickup_datetime) BETWEEN DATE '2024-03-01' AND LAST_DAY(p.as_at_month)
GROUP BY 1, 2
ORDER BY 1` }

// ── Dataset 4: drv_lifecycle ──────────────────────────────────────────────────
function sqlLifecycle(asAt: string): string { return `
WITH params AS (
  SELECT DATE '2023-01-01' AS start_month,
         DATE '${asAt}' AS as_at_month
),
la AS (
  SELECT f.fleet_driver_id AS id, MAX(DATE_TRUNC(f.pickup_date, MONTH)) AS last_active_month
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\` f, params p
  WHERE f.pickup_date BETWEEN p.start_month AND LAST_DAY(p.as_at_month)
    AND f.fleet_driver_id IS NOT NULL
  GROUP BY 1
),
served AS (
  SELECT CASE
      WHEN DATE_DIFF(p.as_at_month, la.last_active_month, MONTH) = 0             THEN 1
      WHEN DATE_DIFF(p.as_at_month, la.last_active_month, MONTH) BETWEEN 1 AND 2  THEN 2
      WHEN DATE_DIFF(p.as_at_month, la.last_active_month, MONTH) BETWEEN 3 AND 5  THEN 3
      WHEN DATE_DIFF(p.as_at_month, la.last_active_month, MONTH) BETWEEN 6 AND 11 THEN 4
      ELSE 5 END AS sort_order
  FROM la CROSS JOIN params p
),
dim_only AS (
  SELECT CASE
      WHEN d.last_service_date IS NULL                           THEN 6
      WHEN DATE(d.last_service_date) > LAST_DAY(p.as_at_month)  THEN 6
      WHEN DATE(d.last_service_date) < p.start_month             THEN 5
      ELSE NULL END AS sort_order
  FROM \`elife-data-warehouse-prod.dim.dim_fleet_driver\` d, params p
  WHERE DATE(d.inserted_at) <= LAST_DAY(p.as_at_month)
    AND d.id NOT IN (SELECT id FROM la)
),
allc AS (
  SELECT sort_order FROM served
  UNION ALL
  SELECT sort_order FROM dim_only WHERE sort_order IS NOT NULL
)
SELECT
  sort_order,
  CASE sort_order
    WHEN 1 THEN 'Active this month'
    WHEN 2 THEN 'Active 1–2 mo'
    WHEN 3 THEN 'Dormant 3–5 mo'
    WHEN 4 THEN 'Lapsed 6–11 mo'
    WHEN 5 THEN 'Churned 12+ mo'
    ELSE 'Never served' END AS lifecycle_state,
  COUNT(*) AS drivers
FROM allc
GROUP BY 1, 2
ORDER BY 1` }

// ── Shared CTEs for Datasets 5-9 ─────────────────────────────────────────────
function sharedCtqs(asAt: string): string { return `
WITH params AS (SELECT DATE '${asAt}' AS as_at_month),
win AS (
  SELECT DATE_SUB(as_at_month, INTERVAL 11 MONTH) AS ws, LAST_DAY(as_at_month) AS we FROM params
),
t AS (
  SELECT f.fleet_driver_id AS did, f.to_fleet_id AS fid, f.dispatch_stat,
         f.complaint_trip AS ct, f.DNS_trip AS dns, f.gps_check_trip AS ge, f.score
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\` f, win w
  WHERE f.pickup_date BETWEEN w.ws AND w.we
    AND f.fleet_driver_id IS NOT NULL
),
driver_names AS (
  SELECT fleet_driver_id AS did,
    ARRAY_AGG(TRIM(fleet_driver) ORDER BY pickup_date DESC, ride_id DESC LIMIT 1)[SAFE_OFFSET(0)] AS driver_name
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\`, params p
  WHERE pickup_date BETWEEN DATE '2023-01-01' AND LAST_DAY(p.as_at_month)
    AND fleet_driver_id IS NOT NULL AND fleet_driver IS NOT NULL
  GROUP BY 1
),
fleet_names AS (
  SELECT to_fleet_id AS fid,
    ARRAY_AGG(TRIM(to_fleet) ORDER BY pickup_date DESC, ride_id DESC LIMIT 1)[SAFE_OFFSET(0)] AS fleet_name
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\`, params p
  WHERE pickup_date BETWEEN DATE '2023-01-01' AND LAST_DAY(p.as_at_month)
    AND to_fleet IS NOT NULL
  GROUP BY 1
),
d AS (
  SELECT did, COUNT(*) AS trips, SUM(dns) AS dns,
    COUNTIF(dispatch_stat = 'Customer no show') AS cns,
    SUM(ct) AS ct, SUM(ge) AS ge,
    COUNTIF(score IS NOT NULL) AS reviews, AVG(score) AS avg_score
  FROM t GROUP BY did
)` }

// ── Dataset 5: drv_bands ──────────────────────────────────────────────────────
function sqlBands(asAt: string): string { return sharedCtqs(asAt) + `
SELECT
  CASE WHEN trips < 10 THEN '1–9' WHEN trips < 50 THEN '10–49'
       WHEN trips < 200 THEN '50–199' WHEN trips < 500 THEN '200–499'
       ELSE '500+' END AS band,
  CASE WHEN trips < 10 THEN 5 WHEN trips < 50 THEN 4 WHEN trips < 200 THEN 3
       WHEN trips < 500 THEN 2 ELSE 1 END AS sort_order,
  COUNT(*) AS drivers, SUM(trips) AS trips,
  SAFE_DIVIDE(COUNT(*), SUM(COUNT(*)) OVER ())     AS share_of_drivers,
  SAFE_DIVIDE(SUM(trips), SUM(SUM(trips)) OVER ()) AS share_of_trips
FROM d GROUP BY 1, 2 ORDER BY sort_order` }

// ── Dataset 6: drv_fleet_concentration ───────────────────────────────────────
function sqlFleetConc(asAt: string): string { return sharedCtqs(asAt) + `,
fd AS (SELECT fid, did, COUNT(*) AS n, SUM(dns) AS dns FROM t GROUP BY 1, 2),
f AS (
  SELECT fid, SUM(n) AS attributed_trips, COUNT(*) AS drivers,
         MAX(n) AS top_driver_trips, SUM(dns) AS dns
  FROM fd GROUP BY fid
)
SELECT
  CASE WHEN f.fid = 15 THEN '(no dim_fleet record)'
       ELSE IFNULL(fn.fleet_name, CONCAT('Fleet ', CAST(f.fid AS STRING))) END AS fleet_name,
  f.fid AS fleet_id,
  f.attributed_trips, f.drivers, f.top_driver_trips,
  SAFE_DIVIDE(f.top_driver_trips, f.attributed_trips) AS top_driver_share,
  SAFE_DIVIDE(f.dns, f.attributed_trips) AS dns_rate
FROM f LEFT JOIN fleet_names fn USING (fid)
ORDER BY f.attributed_trips DESC LIMIT 25` }

// ── Dataset 7: drv_worst_dns ──────────────────────────────────────────────────
function sqlWorstDns(asAt: string): string { return sharedCtqs(asAt) + `,
main_fleet AS (
  SELECT did, ARRAY_AGG(fid ORDER BY n DESC, fid LIMIT 1)[OFFSET(0)] AS main_fid
  FROM (SELECT did, fid, COUNT(*) AS n FROM t GROUP BY 1, 2) GROUP BY did
)
SELECT
  IFNULL(dn.driver_name, CONCAT('Driver ', CAST(d.did AS STRING))) AS driver_name,
  d.did AS driver_id,
  CASE WHEN mf.main_fid = 15 THEN '(no dim_fleet record)'
       ELSE IFNULL(fn.fleet_name, CONCAT('Fleet ', CAST(mf.main_fid AS STRING))) END AS fleet_name,
  d.trips, d.dns,
  SAFE_DIVIDE(d.dns, d.trips) AS dns_rate,
  d.cns, d.ct AS complaints,
  SAFE_DIVIDE(d.ct, d.trips) AS complaint_rate
FROM d JOIN main_fleet mf USING (did)
LEFT JOIN driver_names dn USING (did)
LEFT JOIN fleet_names fn ON fn.fid = mf.main_fid
WHERE d.trips >= 100
ORDER BY SAFE_DIVIDE(d.dns, d.trips) DESC, d.trips DESC, d.did
LIMIT 20` }

// ── Dataset 8: drv_top ────────────────────────────────────────────────────────
function sqlTopDrivers(asAt: string): string { return sharedCtqs(asAt) + `,
main_fleet AS (
  SELECT did, ARRAY_AGG(fid ORDER BY n DESC, fid LIMIT 1)[OFFSET(0)] AS main_fid
  FROM (SELECT did, fid, COUNT(*) AS n FROM t GROUP BY 1, 2) GROUP BY did
)
SELECT
  IFNULL(dn.driver_name, CONCAT('Driver ', CAST(d.did AS STRING))) AS driver_name,
  d.did AS driver_id,
  CASE WHEN mf.main_fid = 15 THEN '(no dim_fleet record)'
       ELSE IFNULL(fn.fleet_name, CONCAT('Fleet ', CAST(mf.main_fid AS STRING))) END AS fleet_name,
  d.trips,
  SAFE_DIVIDE(d.dns, d.trips) AS dns_rate,
  SAFE_DIVIDE(d.cns, d.trips) AS cns_rate,
  SAFE_DIVIDE(d.ct,  d.trips) AS complaint_rate,
  SAFE_DIVIDE(d.ge,  d.trips) AS event_rate,
  d.reviews, d.avg_score
FROM d JOIN main_fleet mf USING (did)
LEFT JOIN driver_names dn USING (did)
LEFT JOIN fleet_names fn ON fn.fid = mf.main_fid
ORDER BY d.trips DESC, d.did LIMIT 25` }

// ── Dataset 9: drv_qualification ──────────────────────────────────────────────
function sqlQualification(asAt: string): string { return sharedCtqs(asAt) + `
SELECT
  IFNULL(CAST(dd.qualified_check AS STRING), '(null)') AS qualified_check,
  CASE IFNULL(CAST(dd.qualified_check AS STRING), '(null)')
    WHEN 'Yes' THEN 1 WHEN 'No' THEN 2 ELSE 3 END AS sort_order,
  COUNT(*) AS drivers, SUM(d.trips) AS trips,
  SAFE_DIVIDE(SUM(d.dns), SUM(d.trips)) AS dns_rate,
  SAFE_DIVIDE(SUM(d.ct),  SUM(d.trips)) AS complaint_rate
FROM d
JOIN \`elife-data-warehouse-prod.dim.dim_fleet_driver\` dd ON dd.id = d.did
GROUP BY 1, 2 ORDER BY sort_order` }

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth
  try {
    const body = await req.json().catch(()=>({}))
    const { asAtMonth='2026-08-01', rangeStart='2025-09-01', rangeEnd='2026-08-01', dataset='all' } = body
    const asAt   = td(asAtMonth,  '2026-08-01')
    const rStart = td(rangeStart, '2025-09-01')
    const rEnd   = td(rangeEnd,   '2026-08-01')

    const svcJson = Deno.env.get('BIGQUERY_SERVICE_ACCOUNT_JSON') ?? Deno.env.get('GA4_SERVICE_ACCOUNT_JSON')
    if (!svcJson) throw new Error('BIGQUERY_SERVICE_ACCOUNT_JSON not configured')
    const projectId = Deno.env.get('BIGQUERY_PROJECT_ID')
    if (!projectId) throw new Error('BIGQUERY_PROJECT_ID not configured')
    const token = await getBQToken(svcJson)

    const jobs: {key:string;promise:Promise<Record<string,unknown>[]>}[] = []
    if (dataset==='all'||dataset==='monthly')   jobs.push({key:'monthly',       promise:runQuery(projectId,sqlMonthly(asAt),token)})
    if (dataset==='all'||dataset==='kpis')      jobs.push({key:'kpis',          promise:runQuery(projectId,sqlKpis(asAt,rStart,rEnd),token)})
    if (dataset==='all'||dataset==='events')    jobs.push({key:'events',         promise:runQuery(projectId,sqlEvents(asAt),token)})
    if (dataset==='all'||dataset==='lifecycle') jobs.push({key:'lifecycle',      promise:runQuery(projectId,sqlLifecycle(asAt),token)})
    if (dataset==='all'||dataset==='fixed'||dataset==='bands')       jobs.push({key:'bands',         promise:runQuery(projectId,sqlBands(asAt),token)})
    if (dataset==='all'||dataset==='fixed'||dataset==='fleet_conc')  jobs.push({key:'fleet_conc',    promise:runQuery(projectId,sqlFleetConc(asAt),token)})
    if (dataset==='all'||dataset==='fixed'||dataset==='worst_dns')   jobs.push({key:'worst_dns',     promise:runQuery(projectId,sqlWorstDns(asAt),token)})
    if (dataset==='all'||dataset==='fixed'||dataset==='top_drivers') jobs.push({key:'top_drivers',   promise:runQuery(projectId,sqlTopDrivers(asAt),token)})
    if (dataset==='all'||dataset==='fixed'||dataset==='qualification')jobs.push({key:'qualification', promise:runQuery(projectId,sqlQualification(asAt),token)})

    const results = await Promise.all(jobs.map(j=>j.promise))
    const payload: Record<string,unknown> = {
      meta:{as_at_month:asAt,range_start:rStart,range_end:rEnd,queried_at:new Date().toISOString()}
    }
    jobs.forEach(({key},i) => {
      payload[key] = key==='kpis' ? (results[i][0]??null) : results[i]
    })
    return new Response(JSON.stringify(payload),{headers:{...CORS,'Content-Type':'application/json'}})
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[fleet-analysis-drivers]', msg)
    return new Response(JSON.stringify({error:msg}),{status:500,headers:{...CORS,'Content-Type':'application/json'}})
  }
})
