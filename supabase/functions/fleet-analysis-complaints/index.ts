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
    u.searchParams.set('timeoutMs','5000'); u.searchParams.set('maxResults','50000')
    if (pageToken) u.searchParams.set('pageToken',pageToken)
    const pr=await fetch(u.toString(),{headers:{Authorization:`Bearer ${token}`}}); if (!pr.ok) continue
    const p=await pr.json(); if (!p.jobComplete) continue
    schema=p.schema?.fields??schema; pageToken=p.pageToken; rows.push(...parseRows(schema,p.rows??[]))
  } while (pageToken)
  return rows
}

const td = (s: string|undefined, fb: string) => !s?fb:s.length===7?`${s}-01`:s

// ── Dataset 1: cm_monthly ─────────────────────────────────────────────────────
function sqlMonthly(asAt: string): string { return `
WITH params AS (
  SELECT DATE '2023-01-01' AS start_month,
         DATE '${asAt}' AS as_at_month
),
c AS (
  SELECT DATE_TRUNC(DATE(x.pickup_datetime), MONTH) AS m,
         x.complaint_status AS s,
         TRIM(x.complaint_reason) AS r,
         x.cns_evidence_provided AS ev
  FROM \`elife-data-warehouse-prod.ads.ads_ride_complaint_detail\` x, params p
  WHERE DATE(x.pickup_datetime) BETWEEN p.start_month AND LAST_DAY(p.as_at_month)
)
SELECT
  m AS month_start, FORMAT_DATE('%Y-%m', m) AS month_label,
  COUNT(*) AS complaints,
  COUNTIF(s = 'Closed against Elife, lost') AS lost,
  COUNTIF(s IN ('Deleted Complaint', 'Initiated')) AS deleted_or_open,
  SAFE_DIVIDE(COUNTIF(s = 'Closed against Elife, lost'), COUNT(*)) AS loss_rate,
  SAFE_DIVIDE(COUNTIF(r = 'Customer No show'), COUNT(*)) AS share_customer_no_show,
  SAFE_DIVIDE(COUNTIF(r = 'Driver No Show'), COUNT(*)) AS share_driver_no_show,
  SAFE_DIVIDE(COUNTIF(r = 'Waiving cancellation fee'), COUNT(*)) AS share_waiving_fee,
  SAFE_DIVIDE(COUNTIF(r = 'Driver Late'), COUNT(*)) AS share_driver_late
FROM c GROUP BY m ORDER BY m` }

// ── Dataset 2: cm_kpis ────────────────────────────────────────────────────────
function sqlKpis(rStart: string, rEnd: string): string { return `
WITH params AS (
  SELECT DATE '2023-01-01' AS data_start,
         DATE '${rStart}' AS range_start,
         DATE '${rEnd}'   AS range_end
),
win AS (
  SELECT p.*,
    DATE_DIFF(range_end, range_start, MONTH) + 1 AS n_months,
    GREATEST(data_start, DATE_SUB(range_start, INTERVAL DATE_DIFF(range_end, range_start, MONTH) + 1 MONTH)) AS prior_start,
    DATE_SUB(range_start, INTERVAL 1 MONTH) AS prior_end
  FROM params p
),
c AS (
  SELECT DATE_TRUNC(DATE(x.pickup_datetime), MONTH) AS m,
         x.complaint_status AS s, TRIM(x.complaint_reason) AS r, x.cns_evidence_provided AS ev
  FROM \`elife-data-warehouse-prod.ads.ads_ride_complaint_detail\` x, win w
  WHERE DATE(x.pickup_datetime) BETWEEN w.prior_start AND LAST_DAY(w.range_end)
),
agg AS (
  SELECT
    COUNTIF(m BETWEEN w.range_start AND w.range_end) AS complaints,
    COUNTIF(m BETWEEN w.prior_start AND w.prior_end) AS complaints_prior,
    COUNTIF(m BETWEEN w.range_start AND w.range_end AND s = 'Closed against Elife, lost') AS lost,
    COUNTIF(m BETWEEN w.prior_start AND w.prior_end AND s = 'Closed against Elife, lost') AS lost_prior,
    COUNTIF(m BETWEEN w.range_start AND w.range_end AND r = 'Driver No Show') AS dns,
    COUNTIF(m BETWEEN w.range_start AND w.range_end AND r = 'Customer No show') AS cns,
    COUNTIF(m BETWEEN w.range_start AND w.range_end AND ev = 1) AS ev1,
    COUNTIF(m BETWEEN w.range_start AND w.range_end AND ev = 0) AS ev0,
    ANY_VALUE(w.n_months) AS n_months
  FROM c CROSS JOIN win w
)
SELECT
  complaints,
  SAFE_DIVIDE(complaints - complaints_prior, complaints_prior) AS complaints_vs_prior,
  lost,
  SAFE_DIVIDE(lost - lost_prior, lost_prior) AS lost_vs_prior,
  SAFE_DIVIDE(lost, complaints) AS loss_rate,
  SAFE_DIVIDE(
    SAFE_DIVIDE(lost, complaints) - SAFE_DIVIDE(lost_prior, complaints_prior),
    SAFE_DIVIDE(lost_prior, complaints_prior)
  ) AS loss_rate_vs_prior,
  SAFE_DIVIDE(dns, complaints) AS driver_no_show_share,
  SAFE_DIVIDE(cns, complaints) AS customer_no_show_share,
  SAFE_DIVIDE(ev1, ev1 + ev0) AS evidence_provided,
  n_months
FROM agg` }

// ── Dataset 3: cm_reason ──────────────────────────────────────────────────────
function sqlReason(asAt: string): string { return shared(asAt) + `
SELECT
  complaint_reason,
  COUNT(*) AS complaints,
  SAFE_DIVIDE(COUNT(*), SUM(COUNT(*)) OVER ()) AS share,
  COUNTIF(complaint_status = 'Closed against Elife, lost') AS lost,
  SAFE_DIVIDE(COUNTIF(complaint_status = 'Closed against Elife, lost'), COUNT(*)) AS loss_rate
FROM c
GROUP BY complaint_reason
ORDER BY complaints DESC, complaint_reason
LIMIT 15` }

// ── Dataset 4: cm_fault ───────────────────────────────────────────────────────
function sqlFault(asAt: string): string { return shared(asAt) + `
SELECT
  department_duty,
  COUNT(*) AS lost_complaints,
  SAFE_DIVIDE(COUNT(*), SUM(COUNT(*)) OVER ()) AS share
FROM c
WHERE complaint_status = 'Closed against Elife, lost'
  AND department_duty IS NOT NULL
GROUP BY department_duty
ORDER BY lost_complaints DESC, department_duty` }

// ── Dataset 5: cm_lost_reason ─────────────────────────────────────────────────
function sqlLostReason(asAt: string): string { return shared(asAt) + `
SELECT
  lost_reason,
  COUNT(*) AS lost_complaints,
  SAFE_DIVIDE(COUNT(*), SUM(COUNT(*)) OVER ()) AS share
FROM c
WHERE complaint_status = 'Closed against Elife, lost'
  AND lost_reason IS NOT NULL
GROUP BY lost_reason
ORDER BY lost_complaints DESC, lost_reason
LIMIT 12` }

// ── Dataset 6: cm_evidence ────────────────────────────────────────────────────
function sqlEvidence(asAt: string): string { return shared(asAt) + `
SELECT
  CASE cns_evidence_provided WHEN 1 THEN 'Evidence provided' WHEN 0 THEN 'No evidence' ELSE '(not recorded)' END AS evidence,
  CASE cns_evidence_provided WHEN 1 THEN 1 WHEN 0 THEN 2 ELSE 3 END AS sort_order,
  COUNT(*) AS cns_complaints,
  COUNTIF(complaint_status = 'Closed against Elife, lost') AS lost,
  SAFE_DIVIDE(COUNTIF(complaint_status = 'Closed against Elife, lost'), COUNT(*)) AS loss_rate
FROM c
WHERE complaint_reason = 'Customer No show'
GROUP BY 1, 2 ORDER BY sort_order` }

// ── Dataset 7: cm_fleet ───────────────────────────────────────────────────────
function sqlFleet(asAt: string): string { return shared(asAt) + `,
fleet_names AS (
  SELECT to_fleet_id AS fid,
    ARRAY_AGG(TRIM(to_fleet) ORDER BY pickup_date DESC, ride_id DESC LIMIT 1)[SAFE_OFFSET(0)] AS fleet_name
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\`, params p
  WHERE pickup_date BETWEEN DATE '2023-01-01' AND LAST_DAY(p.as_at_month)
    AND to_fleet IS NOT NULL
  GROUP BY 1
)
SELECT
  CASE WHEN c.fid = 15 THEN '(no dim_fleet record)'
       ELSE IFNULL(ANY_VALUE(fn.fleet_name), CONCAT('Fleet ', CAST(c.fid AS STRING))) END AS fleet_name,
  c.fid AS fleet_id,
  COUNT(*) AS complaints,
  COUNTIF(c.complaint_status = 'Closed against Elife, lost') AS lost,
  SAFE_DIVIDE(COUNTIF(c.complaint_status = 'Closed against Elife, lost'), COUNT(*)) AS loss_rate,
  COUNTIF(c.complaint_reason = 'Customer No show') AS cns,
  COUNTIF(c.complaint_reason = 'Driver No Show') AS dns
FROM c LEFT JOIN fleet_names fn USING (fid)
GROUP BY c.fid ORDER BY complaints DESC, fleet_id LIMIT 20` }

// ── Dataset 8: cm_airport ─────────────────────────────────────────────────────
function sqlAirport(asAt: string): string { return shared(asAt) + `,
r AS (
  SELECT v.ride_id, v.trip_no, COALESCE(v.pickup_airport_code3, v.dropoff_airport_code3) AS airport
  FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\` v, win w
  WHERE v.pickup_date BETWEEN w.ws AND w.we
)
SELECT
  r.airport,
  COUNT(*) AS complaints,
  COUNTIF(c.complaint_status = 'Closed against Elife, lost') AS lost,
  SAFE_DIVIDE(COUNTIF(c.complaint_status = 'Closed against Elife, lost'), COUNT(*)) AS loss_rate,
  COUNTIF(c.complaint_reason = 'Customer No show') AS cns,
  COUNTIF(c.complaint_reason = 'Driver No Show') AS dns
FROM c JOIN r USING (ride_id, trip_no)
WHERE r.airport IS NOT NULL
GROUP BY r.airport ORDER BY complaints DESC, r.airport LIMIT 15` }

function shared(asAt: string): string { return `
WITH params AS (SELECT DATE '${asAt}' AS as_at_month),
win AS (
  SELECT DATE_SUB(as_at_month, INTERVAL 11 MONTH) AS ws, LAST_DAY(as_at_month) AS we FROM params
),
c AS (
  SELECT x.ride_id, x.trip_no,
         x.to_fleet_id                              AS fid,
         x.complaint_status,
         TRIM(x.complaint_reason)                   AS complaint_reason,
         TRIM(x.lost_reason)                        AS lost_reason,
         NULLIF(TRIM(x.department_duty), '')        AS department_duty,
         x.cns_evidence_provided
  FROM \`elife-data-warehouse-prod.ads.ads_ride_complaint_detail\` x, win w
  WHERE DATE(x.pickup_datetime) BETWEEN w.ws AND w.we
)` }

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method==='OPTIONS') return new Response('ok',{headers:CORS})
  const auth = await requireAuth(req); if (auth instanceof Response) return auth
  try {
    const body = await req.json().catch(()=>({}))
    const { asAtMonth='2026-08-01', rangeStart='2025-09-01', rangeEnd='2026-08-01', dataset='all' } = body
    const asAt=td(asAtMonth,'2026-08-01'), rStart=td(rangeStart,'2025-09-01'), rEnd=td(rangeEnd,'2026-08-01')
    const svcJson=Deno.env.get('BIGQUERY_SERVICE_ACCOUNT_JSON')??Deno.env.get('GA4_SERVICE_ACCOUNT_JSON')
    if (!svcJson) throw new Error('BIGQUERY_SERVICE_ACCOUNT_JSON not set')
    const projectId=Deno.env.get('BIGQUERY_PROJECT_ID'); if (!projectId) throw new Error('BIGQUERY_PROJECT_ID not set')
    const token = await getBQToken(svcJson)
    const jobs: {key:string;promise:Promise<Record<string,unknown>[]>}[]=[]
    if (dataset==='all'||dataset==='monthly')     jobs.push({key:'monthly',     promise:runQuery(projectId,sqlMonthly(asAt),token)})
    if (dataset==='all'||dataset==='kpis')        jobs.push({key:'kpis',        promise:runQuery(projectId,sqlKpis(rStart,rEnd),token)})
    if (dataset==='all'||dataset==='fixed'||dataset==='reason')      jobs.push({key:'reason',      promise:runQuery(projectId,sqlReason(asAt),token)})
    if (dataset==='all'||dataset==='fixed'||dataset==='fault')       jobs.push({key:'fault',        promise:runQuery(projectId,sqlFault(asAt),token)})
    if (dataset==='all'||dataset==='fixed'||dataset==='lost_reason') jobs.push({key:'lost_reason',  promise:runQuery(projectId,sqlLostReason(asAt),token)})
    if (dataset==='all'||dataset==='fixed'||dataset==='evidence')    jobs.push({key:'evidence',     promise:runQuery(projectId,sqlEvidence(asAt),token)})
    if (dataset==='all'||dataset==='fixed'||dataset==='fleet')       jobs.push({key:'fleet',        promise:runQuery(projectId,sqlFleet(asAt),token)})
    if (dataset==='all'||dataset==='fixed'||dataset==='airport')     jobs.push({key:'airport',      promise:runQuery(projectId,sqlAirport(asAt),token)})
    const results = await Promise.all(jobs.map(j=>j.promise))
    const payload: Record<string,unknown> = {meta:{as_at_month:asAt,range_start:rStart,range_end:rEnd,queried_at:new Date().toISOString()}}
    jobs.forEach(({key},i)=>{ payload[key]=key==='kpis'?(results[i][0]??null):results[i] })
    return new Response(JSON.stringify(payload),{headers:{...CORS,'Content-Type':'application/json'}})
  } catch(err: unknown) {
    const msg=err instanceof Error?err.message:String(err)
    console.error('[fleet-analysis-complaints]',msg)
    return new Response(JSON.stringify({error:msg}),{status:500,headers:{...CORS,'Content-Type':'application/json'}})
  }
})
