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

const td = (s: string|undefined, fb: string) => !s?fb:s.length===7?`${s}-01`:s

const BASE_SQL = `WITH params AS (
  SELECT DATE '2023-01-01' AS data_start,
         DATE '2026-08-01' AS as_at_month,
         DATE '@range_start@' AS range_start,
         DATE '@range_end@'   AS range_end
),
win AS (
  SELECT p.*,
    GREATEST(data_start,
      DATE_SUB(range_start, INTERVAL DATE_DIFF(range_end, range_start, MONTH) + 1 MONTH)) AS prior_start,
    DATE_SUB(range_start, INTERVAL 1 MONTH) AS prior_end
  FROM params p
),
f AS (
  SELECT t.to_fleet_id AS fid, t.service_area_id AS said,
         DATE_TRUNC(t.pickup_date, MONTH) AS m,
         t.dispatch_stat IN ('At destination','Customer no show') AS is_term,
         t.elife_amount_usd, t.additional_charge_amount_usd, t.dispatch_amount_net_usd
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
cm AS (
  SELECT
    IFNULL(sa.country, '(unmapped)') AS country,
    IFNULL(sa.geo, '(unmapped)')     AS geo,
    f.m,
    COUNT(*) AS dispatched_trips,
    COUNT(DISTINCT IF(f.is_term, f.fid, NULL)) AS active_fleets,
    SUM(IF(f.is_term AND NOT fl.is_outlier,
           f.elife_amount_usd + IFNULL(f.additional_charge_amount_usd, 0), 0))
      - SUM(IF(f.is_term AND NOT fl.is_outlier, f.dispatch_amount_net_usd, 0)) AS elife_profit
  FROM f
  JOIN fleet_month_flag fl USING (fid, m)
  LEFT JOIN \`elife-data-warehouse-prod.dim.dim_service_area\` sa ON sa.id = f.said
  GROUP BY 1, 2, 3
),
s AS (
  SELECT c.country,
    ANY_VALUE(c.geo) AS geo,
    SUM(IF(c.m BETWEEN w.range_start AND w.range_end, c.dispatched_trips, 0)) AS trips,
    SUM(IF(c.m BETWEEN w.prior_start AND w.prior_end, c.dispatched_trips, 0)) AS trips_prior,
    MAX(IF(c.m BETWEEN w.range_start AND w.range_end, c.active_fleets, NULL)) AS peak_active_fleets,
    SUM(IF(c.m BETWEEN w.range_start AND w.range_end, c.elife_profit, 0))     AS profit,
    SUM(IF(c.m BETWEEN w.prior_start AND w.prior_end, c.elife_profit, 0))     AS profit_prior
  FROM cm c CROSS JOIN win w
  GROUP BY c.country
)
SELECT
  country, geo, trips,
  IF(trips_prior > 0, SAFE_DIVIDE(trips - trips_prior, trips_prior), NULL) AS trips_vs_prior,
  peak_active_fleets, profit,
  IF(profit_prior <> 0, SAFE_DIVIDE(profit - profit_prior, ABS(profit_prior)), NULL) AS profit_vs_prior,
  SAFE_DIVIDE(profit, trips) AS profit_per_trip
FROM s WHERE trips > 0
ORDER BY trips DESC, country LIMIT 25`

serve(async (req) => {
  if (req.method==='OPTIONS') return new Response('ok',{headers:CORS})
  const auth=await requireAuth(req); if (auth instanceof Response) return auth
  try {
    const body=await req.json().catch(()=>({}))
    const { rangeStart='2025-09-01', rangeEnd='2026-08-01' }=body
    const rStart=td(rangeStart,'2025-09-01'), rEnd=td(rangeEnd,'2026-08-01')
    const svcJson=Deno.env.get('BIGQUERY_SERVICE_ACCOUNT_JSON')??Deno.env.get('GA4_SERVICE_ACCOUNT_JSON')
    if (!svcJson) throw new Error('BIGQUERY_SERVICE_ACCOUNT_JSON not set')
    const projectId=Deno.env.get('BIGQUERY_PROJECT_ID'); if (!projectId) throw new Error('BIGQUERY_PROJECT_ID not set')
    const token=await getBQToken(svcJson)
    const sql=BASE_SQL.replace('@range_start@',rStart).replace('@range_end@',rEnd)
    const rows=await runQuery(projectId,sql,token)
    return new Response(JSON.stringify({
      meta:{range_start:rStart,range_end:rEnd,queried_at:new Date().toISOString()},
      countries:rows,
    }),{headers:{...CORS,'Content-Type':'application/json'}})
  } catch(err: unknown) {
    const msg=err instanceof Error?err.message:String(err)
    console.error('[fleet-analysis-geography]',msg)
    return new Response(JSON.stringify({error:msg}),{status:500,headers:{...CORS,'Content-Type':'application/json'}})
  }
})
