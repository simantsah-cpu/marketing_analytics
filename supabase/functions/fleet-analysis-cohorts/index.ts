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

const td = (s: string|undefined, fb: string) => !s?fb:s.length===7?`${s}-01`:s

// ── Dataset 1: coh_cells ──────────────────────────────────────────────────────
function sqlCells(asAt: string): string { return `
WITH params AS (
  SELECT DATE '2020-01-01' AS history_start,
         DATE '2023-01-01' AS cohort_start,
         DATE '${asAt}' AS as_at_month
),
fm AS (
  SELECT t.to_fleet_id AS fid, DATE_TRUNC(t.pickup_date, MONTH) AS m,
    COUNTIF(t.dispatch_stat IN ('At destination','Customer no show')) AS term,
    SUM(IF(t.dispatch_stat IN ('At destination','Customer no show'),
           t.elife_amount_usd + IFNULL(t.additional_charge_amount_usd, 0), 0)) AS rev,
    SUM(IF(t.dispatch_stat IN ('At destination','Customer no show'),
           t.dispatch_amount_net_usd, 0)) AS cost
  FROM \`elife-data-warehouse-prod.ads.ads_fleet_trips\` t, params p
  WHERE t.pickup_date BETWEEN p.history_start AND LAST_DAY(p.as_at_month)
  GROUP BY 1, 2
),
fmc AS (
  SELECT *, IFNULL(SAFE_DIVIDE(rev, NULLIF(term, 0)) > 2000, FALSE) AS is_outlier
  FROM fm WHERE term > 0
),
first_act AS (
  SELECT fid, MIN(m) AS c0 FROM fmc GROUP BY fid
),
coh AS (
  SELECT DATE_TRUNC(fa.c0, QUARTER) AS cq, fa.fid,
         DATE_DIFF(x.m, fa.c0, MONTH) AS k,
         IF(x.is_outlier, 0, x.rev - x.cost) AS profit
  FROM first_act fa
  JOIN fmc x USING (fid)
  CROSS JOIN params p
  WHERE DATE_TRUNC(fa.c0, QUARTER) >= p.cohort_start
    AND DATE_ADD(DATE_TRUNC(fa.c0, QUARTER), INTERVAL 2 MONTH) <= p.as_at_month
),
sizes AS (
  SELECT cq, COUNT(DISTINCT fid) AS cohort_size FROM coh WHERE k = 0 GROUP BY cq
),
cells AS (
  SELECT cq, k, COUNT(DISTINCT fid) AS fleets_active, SUM(profit) AS cohort_profit
  FROM coh WHERE k BETWEEN 0 AND 12 GROUP BY 1, 2
),
k1 AS (
  SELECT cq, fleets_active AS fleets_k1 FROM cells WHERE k = 1
)
SELECT
  c.cq AS cohort_quarter_start,
  CONCAT(CAST(EXTRACT(YEAR FROM c.cq) AS STRING), 'Q',
         CAST(EXTRACT(QUARTER FROM c.cq) AS STRING)) AS cohort,
  s.cohort_size,
  c.k,
  c.k <= DATE_DIFF(p.as_at_month, DATE_ADD(c.cq, INTERVAL 2 MONTH), MONTH) AS observable,
  c.fleets_active,
  c.cohort_profit,
  SAFE_DIVIDE(c.fleets_active, s.cohort_size) AS retention,
  SAFE_DIVIDE(c.cohort_profit, c.fleets_active) AS profit_per_surviving_fleet,
  IF(c.k >= 1, SAFE_DIVIDE(c.fleets_active, k1.fleets_k1) * 100, NULL) AS retention_index
FROM cells c
JOIN sizes s USING (cq)
LEFT JOIN k1 USING (cq)
CROSS JOIN params p
ORDER BY c.cq, c.k` }

// ── Dataset 2: coh_signup ─────────────────────────────────────────────────────
function sqlSignup(asAt: string): string { return `
WITH params AS (
  SELECT DATE '2024-01-01' AS signup_start,
         DATE '${asAt}' AS as_at_month
),
q AS (
  SELECT
    DATE_TRUNC(DATE(f.inserted_at), QUARTER) AS sq,
    f.first_month_completed_count,
    IF(f.first_service_time IS NOT NULL
       AND DATE(f.first_service_time) <= LAST_DAY(p.as_at_month),
       DATE_DIFF(DATE(f.first_service_time), DATE(f.inserted_at), DAY), NULL) AS days_to_first
  FROM \`elife-data-warehouse-prod.dim.dim_fleet\` f, params p
  WHERE DATE(f.inserted_at) >= p.signup_start
    AND DATE_ADD(DATE_TRUNC(DATE(f.inserted_at), QUARTER), INTERVAL 2 MONTH) <= p.as_at_month
),
med AS (
  SELECT DISTINCT sq,
    PERCENTILE_CONT(days_to_first, 0.5) OVER (PARTITION BY sq) AS median_days
  FROM q WHERE days_to_first IS NOT NULL
)
SELECT
  q.sq AS signup_quarter_start,
  CONCAT(CAST(EXTRACT(YEAR FROM q.sq) AS STRING), 'Q',
         CAST(EXTRACT(QUARTER FROM q.sq) AS STRING)) AS signup_quarter,
  COUNT(*) AS signed_up,
  COUNTIF(q.days_to_first IS NOT NULL) AS activated,
  SAFE_DIVIDE(COUNTIF(q.days_to_first IS NOT NULL), COUNT(*)) AS activation_rate,
  ANY_VALUE(m.median_days) AS median_days,
  AVG(q.first_month_completed_count) AS avg_first_month_trips
FROM q
LEFT JOIN med m USING (sq)
GROUP BY q.sq
ORDER BY q.sq` }

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method==='OPTIONS') return new Response('ok',{headers:CORS})
  const auth=await requireAuth(req); if (auth instanceof Response) return auth
  try {
    const body=await req.json().catch(()=>({}))
    const { asAtMonth='2026-08-01', dataset='cells' }=body
    const asAt=td(asAtMonth,'2026-08-01')
    const svcJson=Deno.env.get('BIGQUERY_SERVICE_ACCOUNT_JSON')??Deno.env.get('GA4_SERVICE_ACCOUNT_JSON')
    if (!svcJson) throw new Error('BIGQUERY_SERVICE_ACCOUNT_JSON not set')
    const projectId=Deno.env.get('BIGQUERY_PROJECT_ID'); if (!projectId) throw new Error('BIGQUERY_PROJECT_ID not set')
    const token=await getBQToken(svcJson)
    const jobs: {key:string;promise:Promise<Record<string,unknown>[]>}[]=[]
    if (dataset==='cells'||dataset==='all') jobs.push({key:'cells',  promise:runQuery(projectId,sqlCells(asAt),token)})
    if (dataset==='signup'||dataset==='all') jobs.push({key:'signup', promise:runQuery(projectId,sqlSignup(asAt),token)})
    const results=await Promise.all(jobs.map(j=>j.promise))
    const payload: Record<string,unknown>={meta:{as_at_month:asAt,queried_at:new Date().toISOString()}}
    jobs.forEach(({key},i)=>{ payload[key]=results[i] })
    return new Response(JSON.stringify(payload),{headers:{...CORS,'Content-Type':'application/json'}})
  } catch(err: unknown) {
    const msg=err instanceof Error?err.message:String(err)
    console.error('[fleet-analysis-cohorts]',msg)
    return new Response(JSON.stringify({error:msg}),{status:500,headers:{...CORS,'Content-Type':'application/json'}})
  }
})
