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
      if (f.type==='BOOL'||f.type==='BOOLEAN'){obj[f.name]=raw==='true';return}
      const num=Number(raw); obj[f.name]=isNaN(num)?raw:num
    }); return obj
  })
}

async function runQuery(projectId: string, sql: string, token: string): Promise<Record<string,unknown>[]> {
  const res = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql,useLegacySql:false,timeoutMs:55000}),
  })
  if (!res.ok){ const t=await res.text(); throw new Error(`BQ ${res.status}: ${t.slice(0,500)}`) }
  const result=await res.json()
  if (result.errors?.length) throw new Error(`BQ errors: ${JSON.stringify(result.errors)}`)
  if (result.jobComplete) return parseRows(result.schema?.fields??[],result.rows??[])
  const jobId=result.jobReference?.jobId; if (!jobId) throw new Error('BQ: no jobId')
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

const SQL_MONTHLY = `WITH params AS (
  SELECT DATE '2023-01-01' AS start_month,
         DATE '2026-08-01' AS as_at_month
),
fm AS (
  SELECT t.to_fleet_id AS fid, DATE_TRUNC(t.pickup_date, MONTH) AS m,
    COUNT(*) AS disp,
    COUNTIF(t.dispatch_stat IN ('At destination','Customer no show')) AS term,
    SUM(IF(t.dispatch_stat IN ('At destination','Customer no show'),
           t.elife_amount_usd + IFNULL(t.additional_charge_amount_usd, 0), 0)) AS rev,
    SUM(IF(t.dispatch_stat IN ('At destination','Customer no show'),
           t.dispatch_amount_net_usd, 0)) AS cost,
    SUM(t.complaint_trip) AS ct,
    SUM(t.complaint_lost_trip) AS cl,
    SUM(t.gps_check_trip) AS ge,
    COUNTIF(t.dispatch_type IN ('Public Auction','Price-Change Public Auction','Private Auction')) AS auc,
    COUNTIF(t.score IS NOT NULL) AS rv,
    SUM(IFNULL(t.score, 0)) AS scsum
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\` t, params p
  WHERE t.pickup_date BETWEEN p.start_month AND LAST_DAY(p.as_at_month)
  GROUP BY 1, 2
),
fmc AS (
  SELECT *, IFNULL(SAFE_DIVIDE(rev, NULLIF(term, 0)) > 2000, FALSE) AS is_outlier FROM fm
),
top10 AS (
  SELECT m, SAFE_DIVIDE(SUM(IF(rk <= 10, p, 0)), SUM(p)) AS top10_profit_share
  FROM (
    SELECT m, rev - cost AS p,
           ROW_NUMBER() OVER (PARTITION BY m ORDER BY rev - cost DESC, fid) AS rk
    FROM fmc WHERE NOT is_outlier
  ) GROUP BY m
),
mon AS (
  SELECT m, SUM(disp) AS disp, SUM(ct) AS ct, SUM(cl) AS cl, SUM(ge) AS ge,
         SUM(auc) AS auc, SUM(rv) AS rv, SUM(scsum) AS scsum
  FROM fmc GROUP BY m
)
SELECT
  mon.m AS month_start,
  FORMAT_DATE('%Y-%m', mon.m) AS month_label,
  mon.disp AS dispatched_trips,
  SAFE_DIVIDE(mon.ct, mon.disp) AS complaint_rate,
  IF(mon.m >= DATE '2023-12-01', SAFE_DIVIDE(mon.cl, mon.disp), NULL) AS lost_complaint_rate,
  IF(mon.m >= DATE '2024-03-01', SAFE_DIVIDE(mon.ge, mon.disp), NULL) AS driver_event_rate,
  SAFE_DIVIDE(mon.auc, mon.disp) AS auction_share,
  t.top10_profit_share,
  SAFE_DIVIDE(mon.scsum, mon.rv) AS avg_score
FROM mon LEFT JOIN top10 t USING (m) ORDER BY mon.m`
const SQL_SCATTER  = `WITH params AS (SELECT DATE '2026-08-01' AS as_at_month),
win AS (
  SELECT DATE_SUB(as_at_month, INTERVAL 2 MONTH) AS cur_start,
         as_at_month                             AS cur_end,
         DATE_SUB(as_at_month, INTERVAL 5 MONTH) AS pri_start,
         DATE_SUB(as_at_month, INTERVAL 3 MONTH) AS pri_end
  FROM params
),
fm AS (
  SELECT t.to_fleet_id AS fid, DATE_TRUNC(t.pickup_date, MONTH) AS m,
    COUNT(*) AS disp,
    COUNTIF(t.dispatch_stat IN ('At destination','Customer no show')) AS term,
    SUM(IF(t.dispatch_stat IN ('At destination','Customer no show'),
           t.elife_amount_usd + IFNULL(t.additional_charge_amount_usd, 0), 0)) AS rev,
    SUM(IF(t.dispatch_stat IN ('At destination','Customer no show'),
           t.dispatch_amount_net_usd, 0)) AS cost,
    SUM(t.complaint_trip) AS ct,
    COUNTIF(t.dispatch_type IN ('Public Auction','Price-Change Public Auction','Private Auction')) AS auc,
    COUNTIF(t.score IS NOT NULL) AS rv,
    SUM(IFNULL(t.score, 0)) AS scsum
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\` t, win w
  WHERE t.pickup_date BETWEEN w.pri_start AND LAST_DAY(w.cur_end)
  GROUP BY 1, 2
),
fmc AS (
  SELECT *, IFNULL(SAFE_DIVIDE(rev, NULLIF(term, 0)) > 2000, FALSE) AS is_outlier FROM fm
),
fw AS (
  SELECT x.fid,
    SUM(IF(x.m BETWEEN w.cur_start AND w.cur_end, x.disp, 0)) AS trips_now,
    SUM(IF(x.m BETWEEN w.pri_start AND w.pri_end, x.disp, 0)) AS trips_prior,
    SUM(IF(x.m BETWEEN w.cur_start AND w.cur_end AND NOT x.is_outlier, x.rev - x.cost, 0)) AS profit_now,
    SUM(IF(x.m BETWEEN w.pri_start AND w.pri_end AND NOT x.is_outlier, x.rev - x.cost, 0)) AS profit_prior,
    SUM(IF(x.m BETWEEN w.cur_start AND w.cur_end AND NOT x.is_outlier, x.rev, 0)) AS rev_now,
    SUM(IF(x.m BETWEEN w.cur_start AND w.cur_end, x.ct, 0)) AS ct_now,
    SUM(IF(x.m BETWEEN w.pri_start AND w.pri_end, x.ct, 0)) AS ct_prior,
    SUM(IF(x.m BETWEEN w.cur_start AND w.cur_end, x.auc, 0)) AS auc_now,
    SUM(IF(x.m BETWEEN w.cur_start AND w.cur_end, x.rv, 0)) AS rv_now,
    SUM(IF(x.m BETWEEN w.cur_start AND w.cur_end, x.scsum, 0)) AS sc_now
  FROM fmc x CROSS JOIN win w GROUP BY x.fid
),
fleet_names AS (
  SELECT to_fleet_id AS fid,
    ARRAY_AGG(TRIM(to_fleet) ORDER BY pickup_date DESC, ride_id DESC LIMIT 1)[SAFE_OFFSET(0)] AS fleet_name
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\`, params p
  WHERE pickup_date BETWEEN DATE '2023-01-01' AND LAST_DAY(p.as_at_month)
    AND to_fleet IS NOT NULL GROUP BY 1
)
SELECT
  CASE WHEN fw.fid = 15 THEN '(no dim_fleet record)'
       ELSE IFNULL(fn.fleet_name, CONCAT('Fleet ', CAST(fw.fid AS STRING))) END AS fleet_name,
  fw.fid AS fleet_id,
  fw.trips_now AS dispatched_trips,
  fw.profit_now AS elife_profit,
  SAFE_DIVIDE(fw.profit_now, fw.rev_now) AS margin,
  SAFE_DIVIDE(fw.ct_now, fw.trips_now) AS complaint_rate,
  SAFE_DIVIDE(fw.auc_now, fw.trips_now) AS auction_share,
  SAFE_DIVIDE(fw.sc_now, fw.rv_now) AS avg_score
FROM fw LEFT JOIN fleet_names fn USING (fid)
WHERE fw.trips_now >= 30 AND fw.rev_now <> 0
ORDER BY fw.trips_now DESC, fw.fid LIMIT 400`
const SQL_MOVERS   = `WITH params AS (SELECT DATE '2026-08-01' AS as_at_month),
win AS (
  SELECT DATE_SUB(as_at_month, INTERVAL 2 MONTH) AS cur_start,
         as_at_month                             AS cur_end,
         DATE_SUB(as_at_month, INTERVAL 5 MONTH) AS pri_start,
         DATE_SUB(as_at_month, INTERVAL 3 MONTH) AS pri_end
  FROM params
),
fm AS (
  SELECT t.to_fleet_id AS fid, DATE_TRUNC(t.pickup_date, MONTH) AS m,
    COUNT(*) AS disp,
    COUNTIF(t.dispatch_stat IN ('At destination','Customer no show')) AS term,
    SUM(IF(t.dispatch_stat IN ('At destination','Customer no show'),
           t.elife_amount_usd + IFNULL(t.additional_charge_amount_usd, 0), 0)) AS rev,
    SUM(IF(t.dispatch_stat IN ('At destination','Customer no show'),
           t.dispatch_amount_net_usd, 0)) AS cost,
    SUM(t.complaint_trip) AS ct,
    COUNTIF(t.dispatch_type IN ('Public Auction','Price-Change Public Auction','Private Auction')) AS auc,
    COUNTIF(t.score IS NOT NULL) AS rv,
    SUM(IFNULL(t.score, 0)) AS scsum
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\` t, win w
  WHERE t.pickup_date BETWEEN w.pri_start AND LAST_DAY(w.cur_end)
  GROUP BY 1, 2
),
fmc AS (
  SELECT *, IFNULL(SAFE_DIVIDE(rev, NULLIF(term, 0)) > 2000, FALSE) AS is_outlier FROM fm
),
fw AS (
  SELECT x.fid,
    SUM(IF(x.m BETWEEN w.cur_start AND w.cur_end, x.disp, 0)) AS trips_now,
    SUM(IF(x.m BETWEEN w.pri_start AND w.pri_end, x.disp, 0)) AS trips_prior,
    SUM(IF(x.m BETWEEN w.cur_start AND w.cur_end AND NOT x.is_outlier, x.rev - x.cost, 0)) AS profit_now,
    SUM(IF(x.m BETWEEN w.pri_start AND w.pri_end AND NOT x.is_outlier, x.rev - x.cost, 0)) AS profit_prior,
    SUM(IF(x.m BETWEEN w.cur_start AND w.cur_end AND NOT x.is_outlier, x.rev, 0)) AS rev_now,
    SUM(IF(x.m BETWEEN w.cur_start AND w.cur_end, x.ct, 0)) AS ct_now,
    SUM(IF(x.m BETWEEN w.pri_start AND w.pri_end, x.ct, 0)) AS ct_prior,
    SUM(IF(x.m BETWEEN w.cur_start AND w.cur_end, x.auc, 0)) AS auc_now,
    SUM(IF(x.m BETWEEN w.cur_start AND w.cur_end, x.rv, 0)) AS rv_now,
    SUM(IF(x.m BETWEEN w.cur_start AND w.cur_end, x.scsum, 0)) AS sc_now
  FROM fmc x CROSS JOIN win w GROUP BY x.fid
),
fleet_names AS (
  SELECT to_fleet_id AS fid,
    ARRAY_AGG(TRIM(to_fleet) ORDER BY pickup_date DESC, ride_id DESC LIMIT 1)[SAFE_OFFSET(0)] AS fleet_name
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\`, params p
  WHERE pickup_date BETWEEN DATE '2023-01-01' AND LAST_DAY(p.as_at_month)
    AND to_fleet IS NOT NULL GROUP BY 1
),
ranked AS (
  SELECT fw.*,
    fw.profit_now - fw.profit_prior AS profit_change,
    ROW_NUMBER() OVER (ORDER BY fw.profit_now - fw.profit_prior DESC, fw.fid) AS rk_up,
    ROW_NUMBER() OVER (ORDER BY fw.profit_now - fw.profit_prior ASC,  fw.fid) AS rk_down
  FROM fw
)
SELECT
  CASE WHEN r.profit_change > 0 THEN 'increase' ELSE 'decrease' END AS side,
  IF(r.profit_change > 0, r.rk_up, r.rk_down) AS rank,
  CASE WHEN r.fid = 15 THEN '(no dim_fleet record)'
       ELSE IFNULL(fn.fleet_name, CONCAT('Fleet ', CAST(r.fid AS STRING))) END AS fleet_name,
  r.fid AS fleet_id,
  r.profit_now, r.profit_prior, r.profit_change,
  r.trips_now, r.trips_prior,
  IF(r.trips_now   > 0, SAFE_DIVIDE(r.ct_now,   r.trips_now),   NULL) AS complaint_rate_now,
  IF(r.trips_prior > 0, SAFE_DIVIDE(r.ct_prior, r.trips_prior), NULL) AS complaint_rate_prior
FROM ranked r LEFT JOIN fleet_names fn USING (fid)
WHERE (r.profit_change > 0 AND r.rk_up   <= 12)
   OR (r.profit_change < 0 AND r.rk_down <= 12)
ORDER BY side DESC, rank`

serve(async (req) => {
  if (req.method==='OPTIONS') return new Response('ok',{headers:CORS})
  const auth=await requireAuth(req); if (auth instanceof Response) return auth
  try {
    const body=await req.json().catch(()=>({}))
    const { dataset='monthly' }=body
    const svcJson=Deno.env.get('BIGQUERY_SERVICE_ACCOUNT_JSON')??Deno.env.get('GA4_SERVICE_ACCOUNT_JSON')
    if (!svcJson) throw new Error('BIGQUERY_SERVICE_ACCOUNT_JSON not set')
    const projectId=Deno.env.get('BIGQUERY_PROJECT_ID'); if (!projectId) throw new Error('BIGQUERY_PROJECT_ID not set')
    const token=await getBQToken(svcJson)
    const jobs: {key:string;promise:Promise<Record<string,unknown>[]>}[]=[]
    if (dataset==='monthly') jobs.push({key:'monthly', promise:runQuery(projectId,SQL_MONTHLY,token)})
    if (dataset==='scatter') jobs.push({key:'scatter', promise:runQuery(projectId,SQL_SCATTER,token)})
    if (dataset==='movers')  jobs.push({key:'movers',  promise:runQuery(projectId,SQL_MOVERS,token)})
    const results=await Promise.all(jobs.map(j=>j.promise))
    const payload: Record<string,unknown>={meta:{queried_at:new Date().toISOString()}}
    jobs.forEach(({key},i)=>{ payload[key]=results[i] })
    return new Response(JSON.stringify(payload),{headers:{...CORS,'Content-Type':'application/json'}})
  } catch(err: unknown) {
    const msg=err instanceof Error?err.message:String(err)
    console.error('[fleet-analysis-performance]',msg)
    return new Response(JSON.stringify({error:msg}),{status:500,headers:{...CORS,'Content-Type':'application/json'}})
  }
})
