import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { requireAuth } from '../_shared/requireAuth.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function getBQToken(saJson: string): Promise<string> {
  const sa = JSON.parse(saJson), now = Math.floor(Date.now()/1000)
  const payload = { iss:sa.client_email, scope:['https://www.googleapis.com/auth/bigquery.readonly','https://www.googleapis.com/auth/cloud-platform.read-only'].join(' '), aud:'https://oauth2.googleapis.com/token', exp:now+3600, iat:now }
  const enc = (o: object) => btoa(JSON.stringify(o)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  const unsigned = `${enc({alg:'RS256',typ:'JWT'})}.${enc(payload)}`
  const pem = sa.private_key.replace('-----BEGIN PRIVATE KEY-----','').replace('-----END PRIVATE KEY-----','').replace(/\s/g,'')
  const pk = await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign'])
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pk,new TextEncoder().encode(unsigned))))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
  const r = await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsigned}.${sig}`})
  const d = await r.json(); if (!d.access_token) throw new Error(`BQ token: ${JSON.stringify(d)}`)
  return d.access_token
}

function parseRows(schema: any[], rows: any[]): Record<string,unknown>[] {
  return rows.map(row => {
    const obj: Record<string,unknown> = {}
    schema.forEach((f:any,i:number) => {
      const raw = row.f[i]?.v; if (raw==null){obj[f.name]=null;return}
      if (f.type==='STRING'||f.type==='DATE'){obj[f.name]=raw;return}
      const num=Number(raw); obj[f.name]=isNaN(num)?raw:num
    }); return obj
  })
}

async function runQuery(projectId: string, sql: string, token: string): Promise<Record<string,unknown>[]> {
  const res = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`,{
    method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql,useLegacySql:false,timeoutMs:55000}),
  })
  if (!res.ok) { const t=await res.text(); throw new Error(`BQ ${res.status}: ${t.slice(0,500)}`) }
  const result = await res.json()
  if (result.errors?.length) throw new Error(`BQ errors: ${JSON.stringify(result.errors)}`)
  if (result.jobComplete) return parseRows(result.schema?.fields??[],result.rows??[])
  const jobId = result.jobReference?.jobId; if (!jobId) throw new Error('BQ: no jobId')
  const rows: Record<string,unknown>[] = []; let schema: any[]=[], pageToken: string|undefined, attempts=0
  do {
    await new Promise(r=>setTimeout(r,3000)); if (attempts++>20) throw new Error('BQ: timed out')
    const u=new URL(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}`)
    u.searchParams.set('timeoutMs','5000'); u.searchParams.set('maxResults','100000')
    if (pageToken) u.searchParams.set('pageToken',pageToken)
    const pr=await fetch(u.toString(),{headers:{Authorization:`Bearer ${token}`}}); if (!pr.ok) continue
    const p=await pr.json(); if (!p.jobComplete) continue
    schema=p.schema?.fields??schema; pageToken=p.pageToken; rows.push(...parseRows(schema,p.rows??[]))
  } while (pageToken)
  return rows
}

const td = (s: string|undefined, fb: string) => !s?fb:s.length===7?`${s}-01`:s

// ── Dataset 1: ap_monthly (all airports × all months) ─────────────────────────
function sqlMonthly(asAt: string): string { return `
WITH params AS (
  SELECT DATE '2024-01-01' AS start_month,
         DATE '${asAt}' AS as_at_month
),
f AS (
  SELECT t.ride_id, t.trip_no, t.to_fleet_id AS fid,
         DATE_TRUNC(t.pickup_date, MONTH) AS m,
         t.dispatch_stat IN ('At destination','Customer no show') AS is_term,
         t.elife_amount_usd, t.additional_charge_amount_usd, t.dispatch_amount_net_usd, t.complaint_trip
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\` t, params p
  WHERE t.pickup_date BETWEEN p.start_month AND LAST_DAY(p.as_at_month)
),
fleet_month_flag AS (
  SELECT fid, m,
    IFNULL(SAFE_DIVIDE(
      SUM(IF(is_term, elife_amount_usd + IFNULL(additional_charge_amount_usd, 0), 0)),
      NULLIF(COUNTIF(is_term), 0)) > 2000, FALSE) AS is_outlier
  FROM f GROUP BY 1, 2
),
r AS (
  SELECT v.ride_id, v.trip_no,
         COALESCE(v.pickup_airport_code3, v.dropoff_airport_code3) AS airport
  FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\` v, params p
  WHERE v.pickup_date BETWEEN p.start_month AND LAST_DAY(p.as_at_month)
)
SELECT
  r.airport,
  f.m AS month_start,
  FORMAT_DATE('%Y-%m', f.m) AS month_label,
  COUNT(*) AS dispatched_trips,
  COUNT(DISTINCT IF(f.is_term, f.fid, NULL)) AS active_fleets,
  SUM(IF(f.is_term AND NOT fl.is_outlier, f.elife_amount_usd + IFNULL(f.additional_charge_amount_usd, 0), 0))
    - SUM(IF(f.is_term AND NOT fl.is_outlier, f.dispatch_amount_net_usd, 0)) AS elife_profit,
  SUM(f.complaint_trip) AS complaint_trips
FROM f
JOIN r USING (ride_id, trip_no)
JOIN fleet_month_flag fl USING (fid, m)
WHERE r.airport IS NOT NULL
GROUP BY r.airport, f.m
ORDER BY r.airport, f.m` }

// ── Dataset 2: ap_summary (range-parameterised) ───────────────────────────────
function sqlSummary(asAt: string, rStart: string, rEnd: string): string { return `
WITH params AS (
  SELECT DATE '2024-01-01' AS data_start,
         DATE '${asAt}' AS as_at_month,
         DATE '${rStart}' AS range_start,
         DATE '${rEnd}'   AS range_end
),
win AS (
  SELECT p.*,
    GREATEST(data_start, range_start) AS eff_start,
    DATE_DIFF(range_end, GREATEST(data_start, range_start), MONTH) + 1 AS n_months,
    GREATEST(data_start,
      DATE_SUB(GREATEST(data_start, range_start),
               INTERVAL DATE_DIFF(range_end, GREATEST(data_start, range_start), MONTH) + 1 MONTH)) AS prior_start,
    DATE_SUB(GREATEST(data_start, range_start), INTERVAL 1 MONTH) AS prior_end
  FROM params p
),
f AS (
  SELECT t.ride_id, t.trip_no, t.to_fleet_id AS fid,
         DATE_TRUNC(t.pickup_date, MONTH) AS m,
         t.dispatch_stat IN ('At destination','Customer no show') AS is_term,
         t.elife_amount_usd, t.additional_charge_amount_usd, t.dispatch_amount_net_usd, t.complaint_trip
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\` t, win w
  WHERE t.pickup_date BETWEEN w.data_start AND LAST_DAY(w.as_at_month)
),
fleet_month_flag AS (
  SELECT fid, m,
    IFNULL(SAFE_DIVIDE(
      SUM(IF(is_term, elife_amount_usd + IFNULL(additional_charge_amount_usd, 0), 0)),
      NULLIF(COUNTIF(is_term), 0)) > 2000, FALSE) AS is_outlier
  FROM f GROUP BY 1, 2
),
r AS (
  SELECT v.ride_id, v.trip_no,
         COALESCE(v.pickup_airport_code3, v.dropoff_airport_code3) AS airport
  FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\` v, win w
  WHERE v.pickup_date BETWEEN w.data_start AND LAST_DAY(w.as_at_month)
),
am AS (
  SELECT r.airport, f.m,
    COUNT(*) AS dispatched_trips,
    COUNT(DISTINCT IF(f.is_term, f.fid, NULL)) AS active_fleets,
    SUM(IF(f.is_term AND NOT fl.is_outlier, f.elife_amount_usd + IFNULL(f.additional_charge_amount_usd, 0), 0))
      - SUM(IF(f.is_term AND NOT fl.is_outlier, f.dispatch_amount_net_usd, 0)) AS elife_profit,
    SUM(f.complaint_trip) AS complaint_trips
  FROM f
  JOIN r USING (ride_id, trip_no)
  JOIN fleet_month_flag fl USING (fid, m)
  WHERE r.airport IS NOT NULL
  GROUP BY 1, 2
),
s AS (
  SELECT a.airport,
    SUM(IF(a.m BETWEEN w.eff_start   AND w.range_end, a.dispatched_trips, 0)) AS trips,
    SUM(IF(a.m BETWEEN w.prior_start AND w.prior_end, a.dispatched_trips, 0)) AS trips_prior,
    MAX(IF(a.m BETWEEN w.eff_start   AND w.range_end, a.active_fleets, NULL)) AS peak_active_fleets,
    SAFE_DIVIDE(SUM(IF(a.m BETWEEN w.eff_start AND w.range_end, a.active_fleets, 0)),
                ANY_VALUE(w.n_months)) AS avg_active_fleets,
    SUM(IF(a.m BETWEEN w.eff_start   AND w.range_end, a.elife_profit, 0))     AS profit,
    SUM(IF(a.m BETWEEN w.prior_start AND w.prior_end, a.elife_profit, 0))     AS profit_prior,
    SUM(IF(a.m BETWEEN w.eff_start   AND w.range_end, a.complaint_trips, 0))  AS complaint_trips
  FROM am a CROSS JOIN win w
  GROUP BY a.airport
)
SELECT
  airport, trips,
  IF(trips_prior > 0, SAFE_DIVIDE(trips - trips_prior, trips_prior), NULL) AS trips_vs_prior,
  peak_active_fleets, avg_active_fleets,
  SAFE_DIVIDE(trips, avg_active_fleets) AS trips_per_fleet,
  profit,
  IF(profit_prior <> 0, SAFE_DIVIDE(profit - profit_prior, ABS(profit_prior)), NULL) AS profit_vs_prior,
  SAFE_DIVIDE(profit, trips) AS profit_per_trip,
  SAFE_DIVIDE(complaint_trips, trips) AS complaint_rate
FROM s
WHERE trips > 0
ORDER BY trips DESC, airport
LIMIT 20` }

// ── Dataset 3: ap_dropdown (fixed, top 50 airports) ───────────────────────────
function sqlDropdown(asAt: string): string { return `
WITH params AS (
  SELECT DATE '2024-01-01' AS start_month,
         DATE '${asAt}' AS as_at_month
),
f AS (
  SELECT t.ride_id, t.trip_no
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\` t, params p
  WHERE t.pickup_date BETWEEN p.start_month AND LAST_DAY(p.as_at_month)
),
r AS (
  SELECT v.ride_id, v.trip_no,
         COALESCE(v.pickup_airport_code3, v.dropoff_airport_code3) AS airport
  FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\` v, params p
  WHERE v.pickup_date BETWEEN p.start_month AND LAST_DAY(p.as_at_month)
)
SELECT r.airport, COUNT(*) AS trips,
       ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, r.airport) AS rank
FROM f JOIN r USING (ride_id, trip_no)
WHERE r.airport IS NOT NULL
GROUP BY r.airport
ORDER BY rank LIMIT 50` }

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method==='OPTIONS') return new Response('ok',{headers:CORS})
  const auth = await requireAuth(req); if (auth instanceof Response) return auth
  try {
    const body = await req.json().catch(()=>({}))
    const { asAtMonth='2026-08-01', rangeStart='2025-09-01', rangeEnd='2026-08-01', dataset='dropdown' } = body
    const asAt=td(asAtMonth,'2026-08-01'), rStart=td(rangeStart,'2025-09-01'), rEnd=td(rangeEnd,'2026-08-01')
    const svcJson=Deno.env.get('BIGQUERY_SERVICE_ACCOUNT_JSON')??Deno.env.get('GA4_SERVICE_ACCOUNT_JSON')
    if (!svcJson) throw new Error('BIGQUERY_SERVICE_ACCOUNT_JSON not set')
    const projectId=Deno.env.get('BIGQUERY_PROJECT_ID'); if (!projectId) throw new Error('BIGQUERY_PROJECT_ID not set')
    const token = await getBQToken(svcJson)
    const jobs: {key:string;promise:Promise<Record<string,unknown>[]>}[]=[]
    if (dataset==='monthly')  jobs.push({key:'monthly',  promise:runQuery(projectId,sqlMonthly(asAt),token)})
    if (dataset==='summary')  jobs.push({key:'summary',  promise:runQuery(projectId,sqlSummary(asAt,rStart,rEnd),token)})
    if (dataset==='dropdown') jobs.push({key:'dropdown', promise:runQuery(projectId,sqlDropdown(asAt),token)})
    const results = await Promise.all(jobs.map(j=>j.promise))
    const payload: Record<string,unknown> = {meta:{as_at_month:asAt,range_start:rStart,range_end:rEnd,queried_at:new Date().toISOString()}}
    jobs.forEach(({key},i)=>{ payload[key]=results[i] })
    return new Response(JSON.stringify(payload),{headers:{...CORS,'Content-Type':'application/json'}})
  } catch(err: unknown) {
    const msg=err instanceof Error?err.message:String(err)
    console.error('[fleet-analysis-airports]',msg)
    return new Response(JSON.stringify({error:msg}),{status:500,headers:{...CORS,'Content-Type':'application/json'}})
  }
})
