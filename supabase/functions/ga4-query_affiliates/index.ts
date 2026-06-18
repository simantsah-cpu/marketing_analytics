import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ─── BigQuery table references ────────────────────────────────────────────────
const BQ_PROJECT = 'elife-data-warehouse-prod'
const BQ_DATASET = 'ga4_affiliates'
const SD = `\`${BQ_PROJECT}.${BQ_DATASET}.sessions_daily\``
const LP = `\`${BQ_PROJECT}.${BQ_DATASET}.landing_pages_daily\``
const EV = `\`${BQ_PROJECT}.${BQ_DATASET}.events_daily\``

// Funnel event names — single source of truth used in every events_daily query
const FUNNEL_EVENTS = `'view_search_results','form_submit','begin_checkout','purchase','payment_failure'`

// Pages handled by BigQuery; ai-overview is still served by GA4
const BQ_PAGES  = new Set(['executive','traffic','commercial','scorecard','funnel','destinations','filter-options','llm','llm-pages'])
const ALL_PAGES = new Set([...BQ_PAGES, 'ai-overview'])

// ─── New env var required in Supabase dashboard ───────────────────────────────
// BIGQUERY_SERVICE_ACCOUNT_JSON — same service account as GA4_SERVICE_ACCOUNT_JSON
//   (elife SA already has BigQuery access). Add this secret to the Supabase
//   dashboard. GA4_SERVICE_ACCOUNT_JSON can remain for the ai-overview page.

// ─── Token caches — one per Google API scope ──────────────────────────────────
// Concurrent page loads all fire together. Caching avoids hammering oauth2.
let _bqToken: string | null = null
let _bqTokenExp = 0
let _ga4Token: string | null = null
let _ga4TokenExp = 0

async function mintGoogleToken(serviceAccountJson: string, scope: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson)
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss:   sa.client_email,
    scope, // caller specifies: bigquery.readonly or analytics.readonly
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now,
  }

  const enc = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(payload)}`

  const pemBody = sa.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')

  const keyData = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(unsigned)
  )
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const jwt = `${unsigned}.${sig}`
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) {
    throw new Error(`Token fetch failed: ${JSON.stringify(tokenData)}`)
  }
  return tokenData.access_token
}

async function getBQToken(saJson: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (_bqToken && now < _bqTokenExp - 60) return _bqToken
  _bqToken = await mintGoogleToken(
    saJson,
    'https://www.googleapis.com/auth/bigquery.readonly https://www.googleapis.com/auth/cloud-platform.read-only',
  )
  _bqTokenExp = now + 3300
  return _bqToken!
}

async function getGA4Token(saJson: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (_ga4Token && now < _ga4TokenExp - 60) return _ga4Token
  _ga4Token = await mintGoogleToken(saJson, 'https://www.googleapis.com/auth/analytics.readonly')
  _ga4TokenExp = now + 3300
  return _ga4Token!
}

// ─── BigQuery runner ──────────────────────────────────────────────────────────
//
// BigQuery REST /queries endpoint returns everything as strings inside
// { f: [{v: "..."}] }. We cast based on the BigQuery schema field type returned
// in the query response — this is equivalent to (and more robust than) a
// hardcoded field-name list:
//
//   SQL column type     BigQuery schema type   Cast applied
//   ────────────────────────────────────────────────────────
//   SUM(sessions)       INTEGER / INT64        parseInt()    ← sessions, new_users,
//   SUM(transactions)                                          screen_page_views,
//   SUM(event_count)                                           engaged_sessions,
//   SUM(new_users)                                             active_users
//   ────────────────────────────────────────────────────────
//   SUM(purchase_rev)   FLOAT64 / NUMERIC      parseFloat()  ← purchase_revenue,
//   SAFE_DIVIDE(...)                                           averageSessionDuration,
//   SUM(session_dur)                                           averagePurchaseRevenue,
//                                                              session_duration_total
//   ────────────────────────────────────────────────────────
//   FORMAT_DATE(...)    STRING                 String(raw)   ← date (YYYYMMDD),
//   'date_range_0'                                             dateRange literal,
//   session_source                                             sessionSource, country
//
// Using schema types catches every column automatically — no manual field-name
// list to maintain. SAFE_DIVIDE null (zero denominator) → raw=null → 0.0. ✓

function normalizeBQResult(schema: any, rows: any[]): object[] {
  if (!rows?.length) return []
  const fields = (schema.fields || []) as Array<{ name: string; type: string }>
  return rows.map((row: any) => {
    const obj: Record<string, any> = {}
    ;(row.f || []).forEach((cell: any, i: number) => {
      const field = fields[i] ?? { name: `_col${i}`, type: 'STRING' }
      const raw   = cell.v
      const t     = field.type
      const isInt   = t === 'INTEGER' || t === 'INT64'
      const isFloat = t === 'FLOAT'   || t === 'FLOAT64' || t === 'NUMERIC' || t === 'BIGNUMERIC'
      if (raw === null || raw === undefined) {
        obj[field.name] = isInt ? 0 : isFloat ? 0.0 : null
      } else if (isInt) {
        obj[field.name] = parseInt(String(raw), 10) || 0
      } else if (isFloat) {
        obj[field.name] = parseFloat(String(raw)) || 0.0
      } else {
        obj[field.name] = String(raw)
      }
    })
    return obj
  })
}

const RETRYABLE_BQ = new Set([429, 500, 502, 503, 504])
const BQ_MAX_RETRIES = 3

async function runBQQuery(sql: string, token: string): Promise<object[]> {
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${BQ_PROJECT}/queries`
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= BQ_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = Math.pow(2, attempt - 1) * 300
      console.log(`BQ retry attempt ${attempt}/${BQ_MAX_RETRIES} after ${delayMs}ms`)
      await new Promise(r => setTimeout(r, delayMs))
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 20000, maxResults: 10000 }),
    })

    if (!res.ok) {
      const errText = await res.text()
      lastError = new Error(`BigQuery HTTP ${res.status}: ${errText}`)
      if (!RETRYABLE_BQ.has(res.status)) {
        console.error(`BQ non-retryable error ${res.status}`)
        break
      }
      console.warn(`BQ transient error ${res.status} on attempt ${attempt + 1} — retrying`)
      continue
    }

    const data = await res.json()
    if (data.error) throw new Error(`BigQuery error: ${JSON.stringify(data.error)}`)

    // If the synchronous endpoint hasn't finished, poll getQueryResults once
    if (!data.jobComplete) {
      const jobId = data.jobReference?.jobId
      const loc   = data.jobReference?.location
      if (!jobId) throw new Error('BQ: jobComplete=false but no jobId returned')
      const qs = new URLSearchParams({ timeoutMs: '20000', maxResults: '10000' })
      if (loc) qs.set('location', loc)
      const pollRes = await fetch(
        `https://bigquery.googleapis.com/bigquery/v2/projects/${BQ_PROJECT}/queries/${encodeURIComponent(jobId)}?${qs}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!pollRes.ok) throw new Error(`BQ poll error ${pollRes.status}`)
      const pollData = await pollRes.json()
      if (!pollData.jobComplete) throw new Error('BQ: query still incomplete after poll')
      if (!pollData.schema || !pollData.rows?.length) return []
      return collectBQPages(pollData, token)
    }

    if (!data.schema || !data.rows?.length) return []
    return collectBQPages(data, token)
  }

  throw lastError ?? new Error('BQ: unknown error after retries')
}

async function collectBQPages(data: any, token: string): Promise<object[]> {
  const schema = data.schema
  const rows   = normalizeBQResult(schema, data.rows || [])

  // Handle BQ result pagination (rare for our data sizes but correct to handle)
  let pageToken = data.pageToken
  const jobId   = data.jobReference?.jobId
  const loc     = data.jobReference?.location

  while (pageToken && jobId) {
    const qs = new URLSearchParams({ pageToken, maxResults: '10000' })
    if (loc) qs.set('location', loc)
    const pageRes = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${BQ_PROJECT}/queries/${encodeURIComponent(jobId)}?${qs}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!pageRes.ok) break
    const pageData = await pageRes.json()
    if (pageData.rows) rows.push(...normalizeBQResult(schema, pageData.rows))
    pageToken = pageData.pageToken
  }

  return rows
}

// ─── GA4 runner (kept unchanged — ai-overview page only) ─────────────────────
const RETRYABLE_GA4 = new Set([429, 500, 502, 503, 504])
const GA4_MAX_RETRIES = 3

async function batchRunReports(
  propertyId: string, requests: object[], accessToken: string
): Promise<object> {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= GA4_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = Math.pow(2, attempt - 1) * 300
      console.log(`GA4 retry attempt ${attempt}/${GA4_MAX_RETRIES} after ${delayMs}ms`)
      await new Promise(r => setTimeout(r, delayMs))
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    })
    if (res.ok) return await res.json()
    const errBody = await res.text()
    lastError = new Error(`GA4 API error ${res.status}: ${errBody}`)
    if (!RETRYABLE_GA4.has(res.status)) {
      console.error(`GA4 non-retryable error ${res.status} — not retrying`)
      break
    }
    console.warn(`GA4 transient error ${res.status} on attempt ${attempt + 1} — retrying`)
  }
  throw lastError!
}

function normaliseReport(report: any): object[] {
  const dimHeaders = report.dimensionHeaders?.map((h: any) => h.name) || []
  const metHeaders = report.metricHeaders?.map((h: any) => h.name) || []
  return (report.rows || []).map((row: any) => {
    const obj: Record<string, string | number> = {}
    row.dimensionValues?.forEach((v: any, i: number) => { obj[dimHeaders[i]] = v.value })
    row.metricValues?.forEach((v: any, i: number) => { obj[metHeaders[i]] = parseFloat(v.value) || 0 })
    return obj
  })
}

// ─── Cache helpers (Supabase Postgres via REST) — unchanged ──────────────────
const SB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SB_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

function buildCacheKey(page: string, propertyId: string, dateRanges: any[], filters: any): string {
  const canonical = {
    a: [...(filters?.affiliateFilter ?? [])].sort(),
    c: [...(filters?.countryFilter   ?? [])].sort(),
    d: [...(filters?.deviceFilter    ?? [])].sort(),
  }
  const dateKey = dateRanges.map((r: any) => `${r.startDate}_${r.endDate}`).join(':')
  return `${page}:${propertyId}:${dateKey}:${JSON.stringify(canonical)}`
}

function computeTTL(page: string, dateRanges: any[]): number {
  if (page === 'filter-options') return 6 * 3600
  const endDate = dateRanges?.[0]?.endDate ?? ''
  if (!endDate) return 2 * 3600
  const now       = new Date()
  const today     = now.toISOString().slice(0, 10)
  const yesterday = new Date(now.getTime() - 86400_000).toISOString().slice(0, 10)
  if (endDate >= today)     return 2  * 3600
  if (endDate >= yesterday) return 6  * 3600
  return                           24 * 3600
}

type CacheRow = { reports: object[][], cached_at: string, expires_at: string }

async function readCache(key: string): Promise<CacheRow | null> {
  if (!SB_URL || !SB_KEY) return null
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/ga4_cache?cache_key=eq.${encodeURIComponent(key)}&select=reports,cached_at,expires_at&limit=1`,
      { headers: SB_HEADERS }
    )
    if (!res.ok) return null
    const rows = await res.json()
    return rows.length ? rows[0] : null
  } catch { return null }
}

async function writeCache(
  key: string, page: string, propertyId: string,
  reports: object[][], ttlSeconds: number
): Promise<void> {
  if (!SB_URL || !SB_KEY) return
  try {
    const now      = new Date()
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)
    await fetch(`${SB_URL}/rest/v1/ga4_cache`, {
      method: 'POST',
      headers: { ...SB_HEADERS, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        cache_key:   key,
        page,
        property_id: propertyId,
        reports,
        cached_at:   now.toISOString(),
        expires_at:  expiresAt.toISOString(),
      }),
    })
  } catch (e) { console.warn('Cache write failed (non-fatal):', e) }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

// Resolve GA4-style relative dates to YYYY-MM-DD for BigQuery WHERE clauses
function resolveDate(d: string): string {
  if (!d) return ''
  const now = new Date()
  if (d === 'today')     return now.toISOString().slice(0, 10)
  if (d === 'yesterday') return new Date(now.getTime() - 86400_000).toISOString().slice(0, 10)
  const m = d.match(/^(\d+)daysAgo$/)
  if (m) return new Date(now.getTime() - parseInt(m[1]) * 86400_000).toISOString().slice(0, 10)
  return d // already YYYY-MM-DD
}

// ─── SQL helpers ──────────────────────────────────────────────────────────────

// SQL-safe single-quoted string literal
function sqStr(v: string): string {
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

// Normalise a filter field (accepts string | string[] | 'all' | null)
function parseFilterArray(val: any): string[] {
  if (Array.isArray(val)) return val.filter(Boolean)
  if (val && val !== 'all') return [String(val)]
  return []
}

// Extract all three filter arrays from the request filters object
function extractFilters(filters: any): { affiliates: string[]; devices: string[]; countries: string[] } {
  return {
    affiliates: parseFilterArray(filters?.affiliateFilter),
    devices:    parseFilterArray(filters?.deviceFilter),
    countries:  parseFilterArray(filters?.countryFilter),
  }
}

interface WhereOpts {
  trafficType:     'affiliates' | 'llm'
  dateRange:       { startDate: string; endDate: string }
  affiliateFilter?: string[]  // maps to session_source IN (...)
  deviceFilter?:   string[]   // maps to device_category IN (...)
  countryFilter?:  string[]   // maps to country IN (...)
  extra?:          string[]   // additional raw SQL clauses
}

function buildWhere(opts: WhereOpts): string {
  const start = resolveDate(opts.dateRange.startDate)
  const end   = resolveDate(opts.dateRange.endDate)
  const clauses: string[] = [
    `traffic_type = ${sqStr(opts.trafficType)}`,
    `date BETWEEN DATE(${sqStr(start)}) AND DATE(${sqStr(end)})`,
  ]
  if (opts.affiliateFilter?.length) clauses.push(`session_source IN (${opts.affiliateFilter.map(sqStr).join(', ')})`)
  if (opts.deviceFilter?.length)    clauses.push(`device_category IN (${opts.deviceFilter.map(sqStr).join(', ')})`)
  if (opts.countryFilter?.length)   clauses.push(`country IN (${opts.countryFilter.map(sqStr).join(', ')})`)
  if (opts.extra?.length)           clauses.push(...opts.extra)
  return clauses.join('\n  AND ')
}

// ─── Reusable SQL templates ───────────────────────────────────────────────────
//
// Field aliases are chosen to match exactly what the data-service.js transformers
// access by name. The critical ones:
//   session_source   → sessionSource
//   engaged_sessions → engagedSessions
//   new_users        → newUsers
//   screen_page_views → screenPageViews
//   purchase_revenue → purchaseRevenue
//   device_category  → deviceCategory
//   landing_page     → landingPage
//   event_name       → eventName
//   event_count      → eventCount
//   SAFE_DIVIDE(SUM(session_duration_total), SUM(sessions)) → averageSessionDuration
//   SAFE_DIVIDE(SUM(purchase_revenue), NULLIF(SUM(transactions), 0)) → averagePurchaseRevenue
//
// Date column: FORMAT_DATE('%Y%m%d', date) → date as 'YYYYMMDD' string.
// The transformers do r.date.slice(0,4) / .slice(4,6) / .slice(6,8) and will
// silently break if BigQuery returns the native YYYY-MM-DD DATE format.

// Canonical per-source aggregate — used for executive/traffic/commercial/scorecard/llm
function sqlCanonicalPerSource(w: string, orderBy = 'purchaseRevenue DESC', limit = 5000): string {
  return `
SELECT
  session_source AS sessionSource,
  SUM(sessions) AS sessions,
  SUM(engaged_sessions) AS engagedSessions,
  SUM(new_users) AS newUsers,
  SUM(screen_page_views) AS screenPageViews,
  SUM(transactions) AS transactions,
  SUM(purchase_revenue) AS purchaseRevenue,
  SAFE_DIVIDE(SUM(session_duration_total), SUM(sessions)) AS averageSessionDuration,
  SAFE_DIVIDE(SUM(purchase_revenue), NULLIF(SUM(transactions), 0)) AS averagePurchaseRevenue
FROM ${SD}
WHERE ${w}
GROUP BY session_source
ORDER BY ${orderBy}
LIMIT ${limit}`.trim()
}

// Daily trend rows — caller specifies metric columns
function sqlDailyTrend(w: string, metricCols: string, table = SD): string {
  return `
SELECT
  FORMAT_DATE('%Y%m%d', date) AS date,
  ${metricCols}
FROM ${table}
WHERE ${w}
GROUP BY date
ORDER BY date`.trim()
}

// Country breakdown
function sqlCountry(w: string, metricCols: string, limit = 12): string {
  return `
SELECT
  country,
  ${metricCols}
FROM ${SD}
WHERE ${w}
GROUP BY country
ORDER BY sessions DESC
LIMIT ${limit}`.trim()
}

// Device breakdown (sessions only)
function sqlDevice(w: string): string {
  return `
SELECT
  device_category AS deviceCategory,
  SUM(sessions) AS sessions
FROM ${SD}
WHERE ${w}
GROUP BY device_category`.trim()
}

// Landing pages — from landing_pages_daily
function sqlLandingPages(w: string, metricCols: string, orderCol = 'sessions DESC', limit = 10): string {
  return `
SELECT
  landing_page AS landingPage,
  ${metricCols}
FROM ${LP}
WHERE ${w}
GROUP BY landing_page
ORDER BY ${orderCol}
LIMIT ${limit}`.trim()
}

// Destination Intelligence — per session_source × landing_page
function sqlDestinations(w: string): string {
  return `
SELECT
  session_source AS sessionSource,
  landing_page AS landingPage,
  SUM(sessions) AS sessions,
  SUM(transactions) AS transactions,
  SUM(purchase_revenue) AS purchaseRevenue,
  SUM(engaged_sessions) AS engagedSessions,
  SAFE_DIVIDE(SUM(session_duration_total), SUM(sessions)) AS averageSessionDuration
FROM ${LP}
WHERE ${w}
GROUP BY session_source, landing_page
ORDER BY purchaseRevenue DESC
LIMIT 5000`.trim()
}

// Funnel: per-affiliate × eventName
// When a comparison period exists, returns a UNION ALL with dateRange tags so
// the transformer can split current vs prev using r.dateRange field (lines 607-610
// of data-service.js: isCurrentAffRow / isPrevAffRow).
function sqlFunnelAffiliateEvents(currW: string, prevW: string | null): string {
  const curr = `
SELECT
  session_source AS sessionSource,
  event_name AS eventName,
  SUM(event_count) AS eventCount,
  'date_range_0' AS dateRange
FROM ${EV}
WHERE ${currW}
GROUP BY session_source, event_name`.trim()

  if (!prevW) return curr

  const prev = `
SELECT
  session_source AS sessionSource,
  event_name AS eventName,
  SUM(event_count) AS eventCount,
  'date_range_1' AS dateRange
FROM ${EV}
WHERE ${prevW}
GROUP BY session_source, event_name`.trim()

  return `${curr}\nUNION ALL\n${prev}`
}

// Funnel: daily × eventName × deviceCategory (current period only)
// device_category is included so the payment_failure trend chart works
// (transformFunnel reads row.deviceCategory from currentDailyEvent).
function sqlDailyFunnelEvents(w: string): string {
  return `
SELECT
  FORMAT_DATE('%Y%m%d', date) AS date,
  event_name AS eventName,
  device_category AS deviceCategory,
  SUM(event_count) AS eventCount
FROM ${EV}
WHERE ${w}
GROUP BY date, event_name, device_category
ORDER BY date`.trim()
}

// ─── Per-page BigQuery executors ──────────────────────────────────────────────
//
// Each function returns object[][] — the reports array — matching the slot
// ordering the GA4 version produced. Slot indices must be identical because
// data-service.js and llm-data-service.js destructure by position.

async function bqExecutive(dateRanges: any[], filters: any, token: string): Promise<object[][]> {
  // report[0] current daily (date, sessions, transactions, purchaseRevenue)
  // report[1] current per-affiliate canonical
  // report[2] prev daily                      ([] when no comparison)
  // report[3] prev per-affiliate canonical    ([] when no comparison)
  const curr = dateRanges[0]
  const prev = dateRanges[1] ?? null
  const { affiliates, devices, countries } = extractFilters(filters)

  const currW = buildWhere({ trafficType: 'affiliates', dateRange: curr, affiliateFilter: affiliates, deviceFilter: devices, countryFilter: countries })
  const prevW = prev ? buildWhere({ trafficType: 'affiliates', dateRange: prev, affiliateFilter: affiliates, deviceFilter: devices, countryFilter: countries }) : null

  const dailyCols = `SUM(sessions) AS sessions, SUM(transactions) AS transactions, SUM(purchase_revenue) AS purchaseRevenue`

  const [r0, r1, r2, r3] = await Promise.all([
    runBQQuery(sqlDailyTrend(currW, dailyCols), token),
    runBQQuery(sqlCanonicalPerSource(currW), token),
    prevW ? runBQQuery(sqlDailyTrend(prevW, dailyCols), token) : Promise.resolve([]),
    prevW ? runBQQuery(sqlCanonicalPerSource(prevW), token)   : Promise.resolve([]),
  ])
  return [r0, r1, r2, r3]
}

async function bqTraffic(dateRanges: any[], filters: any, token: string): Promise<object[][]> {
  // report[0] current daily (date, sessions, engagedSessions, newUsers, screenPageViews)
  // report[1] current per-affiliate canonical
  // report[2] current country (country, sessions)                             LIMIT 12
  // report[3] current device  (deviceCategory, sessions)
  // report[4] current landing pages from landing_pages_daily                  LIMIT 10
  // report[5] prev per-affiliate canonical   ([] when no comparison)
  // report[6] prev daily                     ([] when no comparison)
  const curr = dateRanges[0]
  const prev = dateRanges[1] ?? null
  const { affiliates, devices, countries } = extractFilters(filters)

  const currW = buildWhere({ trafficType: 'affiliates', dateRange: curr, affiliateFilter: affiliates, deviceFilter: devices, countryFilter: countries })
  const prevW = prev ? buildWhere({ trafficType: 'affiliates', dateRange: prev, affiliateFilter: affiliates, deviceFilter: devices, countryFilter: countries }) : null

  // Landing pages uses landing_pages_daily with same filter dimensions
  const currWlp = buildWhere({ trafficType: 'affiliates', dateRange: curr, affiliateFilter: affiliates, deviceFilter: devices, countryFilter: countries })

  const dailyCols = `SUM(sessions) AS sessions, SUM(engaged_sessions) AS engagedSessions, SUM(new_users) AS newUsers, SUM(screen_page_views) AS screenPageViews`
  const lpCols    = `SUM(sessions) AS sessions, SUM(engaged_sessions) AS engagedSessions, SUM(transactions) AS transactions, SUM(purchase_revenue) AS purchaseRevenue, SAFE_DIVIDE(SUM(session_duration_total), SUM(sessions)) AS averageSessionDuration, SUM(screen_page_views) AS screenPageViews`

  const [r0, r1, r2, r3, r4, r5, r6] = await Promise.all([
    runBQQuery(sqlDailyTrend(currW, dailyCols), token),
    runBQQuery(sqlCanonicalPerSource(currW, 'sessions DESC'), token),
    runBQQuery(sqlCountry(currW, 'SUM(sessions) AS sessions', 12), token),
    runBQQuery(sqlDevice(currW), token),
    runBQQuery(sqlLandingPages(currWlp, lpCols, 'sessions DESC', 10), token),
    prevW ? runBQQuery(sqlCanonicalPerSource(prevW, 'sessions DESC'), token) : Promise.resolve([]),
    prevW ? runBQQuery(sqlDailyTrend(prevW, dailyCols), token)                    : Promise.resolve([]),
  ])
  return [r0, r1, r2, r3, r4, r5, r6]
}

async function bqCommercial(dateRanges: any[], filters: any, token: string): Promise<object[][]> {
  // report[0] current daily (date, sessions, transactions, purchaseRevenue)
  // report[1] current per-affiliate canonical
  // report[2] current country (country, transactions, purchaseRevenue)        LIMIT 10
  // report[3] prev daily                      ([] when no comparison)
  // report[4] prev per-affiliate canonical    ([] when no comparison)
  // report[5] prev country                    ([] when no comparison)
  const curr = dateRanges[0]
  const prev = dateRanges[1] ?? null
  const { affiliates, devices, countries } = extractFilters(filters)

  const currW = buildWhere({ trafficType: 'affiliates', dateRange: curr, affiliateFilter: affiliates, deviceFilter: devices, countryFilter: countries })
  const prevW = prev ? buildWhere({ trafficType: 'affiliates', dateRange: prev, affiliateFilter: affiliates, deviceFilter: devices, countryFilter: countries }) : null

  const dailyCols   = `SUM(sessions) AS sessions, SUM(transactions) AS transactions, SUM(purchase_revenue) AS purchaseRevenue`
  const countryCols = `SUM(transactions) AS transactions, SUM(purchase_revenue) AS purchaseRevenue`

  const countrySql = (w: string) => `
SELECT country, ${countryCols}
FROM ${SD}
WHERE ${w}
GROUP BY country
ORDER BY transactions DESC
LIMIT 10`.trim()

  const [r0, r1, r2, r3, r4, r5] = await Promise.all([
    runBQQuery(sqlDailyTrend(currW, dailyCols), token),
    runBQQuery(sqlCanonicalPerSource(currW), token),
    runBQQuery(countrySql(currW), token),
    prevW ? runBQQuery(sqlDailyTrend(prevW, dailyCols), token) : Promise.resolve([]),
    prevW ? runBQQuery(sqlCanonicalPerSource(prevW), token)    : Promise.resolve([]),
    prevW ? runBQQuery(countrySql(prevW), token)               : Promise.resolve([]),
  ])
  return [r0, r1, r2, r3, r4, r5]
}

async function bqScorecard(dateRanges: any[], filters: any, token: string): Promise<object[][]> {
  // report[0] current per-affiliate canonical
  // report[1] prev per-affiliate canonical    ([] when no comparison)
  const curr = dateRanges[0]
  const prev = dateRanges[1] ?? null
  const { affiliates, devices, countries } = extractFilters(filters)

  const currW = buildWhere({ trafficType: 'affiliates', dateRange: curr, affiliateFilter: affiliates, deviceFilter: devices, countryFilter: countries })
  const prevW = prev ? buildWhere({ trafficType: 'affiliates', dateRange: prev, affiliateFilter: affiliates, deviceFilter: devices, countryFilter: countries }) : null

  const [r0, r1] = await Promise.all([
    runBQQuery(sqlCanonicalPerSource(currW), token),
    prevW ? runBQQuery(sqlCanonicalPerSource(prevW), token) : Promise.resolve([]),
  ])
  return [r0, r1]
}

async function bqFunnel(dateRanges: any[], filters: any, token: string): Promise<object[][]> {
  // report[0] current daily sessions (date, sessions)
  // report[1] per-affiliate × eventName — UNION ALL current ('date_range_0')
  //           + prev ('date_range_1') when comparison is active
  // report[2] daily × eventName × deviceCategory — current period only
  // report[3] prev daily sessions                       ([] when no comparison)
  // report[4] current per-affiliate canonical (same query as scorecard r0)
  const curr = dateRanges[0]
  const prev = dateRanges[1] ?? null
  const { affiliates, devices, countries } = extractFilters(filters)

  const currW = buildWhere({ trafficType: 'affiliates', dateRange: curr, affiliateFilter: affiliates, deviceFilter: devices, countryFilter: countries })
  const prevW = prev ? buildWhere({ trafficType: 'affiliates', dateRange: prev, affiliateFilter: affiliates, deviceFilter: devices, countryFilter: countries }) : null

  // Events WHERE for report[1]: affiliate/device/country + event name filter
  const currEvW = buildWhere({
    trafficType: 'affiliates', dateRange: curr,
    affiliateFilter: affiliates, deviceFilter: devices, countryFilter: countries,
    extra: [`event_name IN (${FUNNEL_EVENTS})`],
  })
  const prevEvW = prev ? buildWhere({
    trafficType: 'affiliates', dateRange: prev,
    affiliateFilter: affiliates, deviceFilter: devices, countryFilter: countries,
    extra: [`event_name IN (${FUNNEL_EVENTS})`],
  }) : null

  // Events WHERE for report[2]: no user-dimension filters (matches original GA4
  // dailyEventFilter which was mediumFilter + funnelEventFilter only)
  const dailyEvW = buildWhere({
    trafficType: 'affiliates', dateRange: curr,
    extra: [`event_name IN (${FUNNEL_EVENTS})`],
  })

  const [r0, r1, r2, r3, r4] = await Promise.all([
    runBQQuery(sqlDailyTrend(currW, 'SUM(sessions) AS sessions'), token),
    runBQQuery(sqlFunnelAffiliateEvents(currEvW, prevEvW), token),
    runBQQuery(sqlDailyFunnelEvents(dailyEvW), token),
    prevW ? runBQQuery(sqlDailyTrend(prevW, 'SUM(sessions) AS sessions'), token) : Promise.resolve([]),
    runBQQuery(sqlCanonicalPerSource(currW, 'sessions DESC'), token),
  ])
  return [r0, r1, r2, r3, r4]
}

async function bqDestinations(dateRanges: any[], filters: any, token: string): Promise<object[][]> {
  // report[0] current per (session_source × landing_page)
  // report[1] prev per (session_source × landing_page)   ([] when no comparison)
  const curr = dateRanges[0]
  const prev = dateRanges[1] ?? null
  const { affiliates, devices, countries } = extractFilters(filters)

  const currW = buildWhere({ trafficType: 'affiliates', dateRange: curr, affiliateFilter: affiliates, deviceFilter: devices, countryFilter: countries })
  const prevW = prev ? buildWhere({ trafficType: 'affiliates', dateRange: prev, affiliateFilter: affiliates, deviceFilter: devices, countryFilter: countries }) : null

  const [r0, r1] = await Promise.all([
    runBQQuery(sqlDestinations(currW), token),
    prevW ? runBQQuery(sqlDestinations(prevW), token) : Promise.resolve([]),
  ])
  return [r0, r1]
}

async function bqFilterOptions(_dateRanges: any[], _filters: any, token: string): Promise<object[][]> {
  // report[0] distinct session_source with sessions  (affiliates only)  LIMIT 500
  // report[1] distinct country with sessions         (affiliates only)  LIMIT 300
  //
  // IMPORTANT: always query a fixed 90-day rolling window, ignoring the user's
  // selected date range entirely. The dashboard filter dropdowns must always be
  // fully populated — if we used the user's date range, selecting a narrow window
  // like "last 7 days" would empty the affiliate and country dropdowns, breaking
  // the filter UI for all other pages.
  //
  // No affiliate/device/country dimension filters either — we want all available
  // values so users can see every option regardless of their current selection.
  const now        = new Date()
  const fixedEnd   = now.toISOString().slice(0, 10)                              // today YYYY-MM-DD
  const fixedStart = new Date(now.getTime() - 90 * 86400_000).toISOString().slice(0, 10) // 90 days ago
  const w = buildWhere({ trafficType: 'affiliates', dateRange: { startDate: fixedStart, endDate: fixedEnd } })

  const [r0, r1] = await Promise.all([
    runBQQuery(`
SELECT session_source AS sessionSource, SUM(sessions) AS sessions
FROM ${SD}
WHERE ${w}
GROUP BY session_source
ORDER BY sessions DESC
LIMIT 500`.trim(), token),
    runBQQuery(`
SELECT country, SUM(sessions) AS sessions
FROM ${SD}
WHERE ${w}
GROUP BY country
ORDER BY sessions DESC
LIMIT 300`.trim(), token),
  ])
  return [r0, r1]
}

async function bqLLM(dateRanges: any[], filters: any, token: string): Promise<object[][]> {
  // LLM pages: traffic_type = 'llm'. The table already contains only the nine
  // LLM referrer sources, so no source filter is needed unless the caller has
  // passed a sub-selection of LLM sources via affiliateFilter.
  //
  // report[0] current daily totals       (date, sessions, transactions, purchaseRevenue, engagedSessions)
  // report[1] current per-source canonical
  // report[2] current per-source daily breakdown
  // report[3] prev daily totals          ([] when no comparison)
  // report[4] prev per-source canonical  ([] when no comparison)
  // report[5] prev per-source daily      ([] when no comparison)
  const curr = dateRanges[0]
  const prev = dateRanges[1] ?? null
  const { affiliates, devices, countries } = extractFilters(filters)

  // For LLM, affiliateFilter holds LLM source keys (e.g. ['chatgpt.com'])
  const currW = buildWhere({ trafficType: 'llm', dateRange: curr, affiliateFilter: affiliates, deviceFilter: devices, countryFilter: countries })
  const prevW = prev ? buildWhere({ trafficType: 'llm', dateRange: prev, affiliateFilter: affiliates, deviceFilter: devices, countryFilter: countries }) : null

  const dailyCols    = `SUM(sessions) AS sessions, SUM(transactions) AS transactions, SUM(purchase_revenue) AS purchaseRevenue, SUM(engaged_sessions) AS engagedSessions`
  const srcDailyCols = `SUM(sessions) AS sessions, SUM(transactions) AS transactions, SUM(purchase_revenue) AS purchaseRevenue, SUM(engaged_sessions) AS engagedSessions`

  const srcDailySql = (w: string) => `
SELECT
  FORMAT_DATE('%Y%m%d', date) AS date,
  session_source AS sessionSource,
  ${srcDailyCols}
FROM ${SD}
WHERE ${w}
GROUP BY date, session_source
ORDER BY date
LIMIT 5000`.trim()

  const [r0, r1, r2, r3, r4, r5] = await Promise.all([
    runBQQuery(sqlDailyTrend(currW, dailyCols), token),
    runBQQuery(sqlCanonicalPerSource(currW, 'purchaseRevenue DESC', 50), token),
    runBQQuery(srcDailySql(currW), token),
    prevW ? runBQQuery(sqlDailyTrend(prevW, dailyCols), token)                            : Promise.resolve([]),
    prevW ? runBQQuery(sqlCanonicalPerSource(prevW, 'purchaseRevenue DESC', 50), token) : Promise.resolve([]),
    prevW ? runBQQuery(srcDailySql(prevW), token)                                         : Promise.resolve([]),
  ])
  return [r0, r1, r2, r3, r4, r5]
}

async function bqLLMPages(dateRanges: any[], filters: any, token: string): Promise<object[][]> {
  // report[0] landing pages with ≥1 purchase, ordered by revenue        LIMIT 500
  // report[1] all landing pages by sessions                              LIMIT 500
  const curr = dateRanges[0]
  const { affiliates, devices, countries } = extractFilters(filters)

  const w = buildWhere({ trafficType: 'llm', dateRange: curr, affiliateFilter: affiliates, deviceFilter: devices, countryFilter: countries })

  // report[0]: inline SQL so HAVING is correctly placed before ORDER BY and LIMIT.
  // The sqlLandingPages template already appends ORDER BY + LIMIT, so we cannot
  // safely concatenate HAVING after it — it would produce invalid SQL.
  const purchasePagesSql = `
SELECT
  landing_page AS landingPage,
  SUM(sessions) AS sessions,
  SUM(transactions) AS transactions,
  SUM(purchase_revenue) AS purchaseRevenue
FROM ${LP}
WHERE ${w}
GROUP BY landing_page
HAVING transactions > 0
ORDER BY purchaseRevenue DESC
LIMIT 500`.trim()

  const [r0, r1] = await Promise.all([
    runBQQuery(purchasePagesSql, token),
    runBQQuery(sqlLandingPages(
      w,
      `SUM(sessions) AS sessions`,
      'sessions DESC',
      500
    ), token),
  ])
  return [r0, r1]
}

// Dispatch: run the correct BQ executor for the given page
async function executeBQPage(
  page: string, dateRanges: any[], filters: any, token: string
): Promise<object[][]> {
  switch (page) {
    case 'executive':     return bqExecutive(dateRanges, filters, token)
    case 'traffic':       return bqTraffic(dateRanges, filters, token)
    case 'commercial':    return bqCommercial(dateRanges, filters, token)
    case 'scorecard':     return bqScorecard(dateRanges, filters, token)
    case 'funnel':        return bqFunnel(dateRanges, filters, token)
    case 'destinations':  return bqDestinations(dateRanges, filters, token)
    case 'filter-options':return bqFilterOptions(dateRanges, filters, token)
    case 'llm':           return bqLLM(dateRanges, filters, token)
    case 'llm-pages':     return bqLLMPages(dateRanges, filters, token)
    default:              throw new Error(`Unknown BQ page: '${page}'`)
  }
}

// ─── GA4 request builder (ai-overview only — unchanged from original) ─────────
function buildAiOverviewRequests(dateRanges: object[], filters: any): object[] {
  const deviceValues: string[] = Array.isArray(filters?.deviceFilter)
    ? filters.deviceFilter
    : (filters?.deviceFilter && filters.deviceFilter !== 'all' ? [filters.deviceFilter] : [])

  const deviceFilter = deviceValues.length > 0
    ? deviceValues.length === 1
      ? { fieldName: 'deviceCategory', stringFilter: { matchType: 'EXACT', value: deviceValues[0] } }
      : { fieldName: 'deviceCategory', inListFilter: { values: deviceValues, caseSensitive: false } }
    : null

  const aiOverviewFilter = {
    notExpression: {
      orGroup: {
        expressions: [
          { filter: { fieldName: 'customEvent:ai_overview_click', stringFilter: { matchType: 'EXACT', value: '' } } },
          { filter: { fieldName: 'customEvent:ai_overview_click', stringFilter: { matchType: 'EXACT', value: '(not set)' } } },
        ],
      },
    },
  }

  const buildAiFilter = (extraFilters: any[] = []) => {
    const all = [aiOverviewFilter, ...extraFilters].filter(Boolean)
    if (all.length === 1) return all[0]
    return { andGroup: { expressions: all } }
  }

  const deviceExtraFilters: any[] = []
  if (deviceFilter) deviceExtraFilters.push({ filter: deviceFilter })

  const queryType = filters?.queryType ?? 'kpis'

  if (queryType === 'kpis') {
    const aiFilter = buildAiFilter(deviceExtraFilters)
    const currentReq = {
      dateRanges: [dateRanges[0]],
      dimensions: [{ name: 'customEvent:ai_overview_click' }],
      metrics: [{ name: 'eventCount' }, { name: 'activeUsers' }],
      dimensionFilter: aiFilter,
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
      keepEmptyRows: false,
      limit: 50,
    }
    const reqs: object[] = [currentReq]
    if (dateRanges.length > 1 && dateRanges[1]) {
      reqs.push({
        dateRanges: [dateRanges[1]],
        dimensions: [{ name: 'customEvent:ai_overview_click' }],
        metrics: [{ name: 'eventCount' }, { name: 'activeUsers' }],
        dimensionFilter: aiFilter,
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        keepEmptyRows: false,
        limit: 50,
      })
    }
    return reqs
  }

  if (queryType === 'trend') {
    const aiFilter = buildAiFilter(deviceExtraFilters)
    return [{
      dateRanges: [dateRanges[0]],
      dimensions: [{ name: 'yearWeek' }, { name: 'customEvent:ai_overview_click' }],
      metrics: [{ name: 'eventCount' }, { name: 'activeUsers' }],
      dimensionFilter: aiFilter,
      orderBys: [{ dimension: { dimensionName: 'yearWeek' } }],
      keepEmptyRows: false,
      limit: 1000,
    }]
  }

  if (queryType === 'device') {
    const aiFilter = buildAiFilter() // no device filter for device split
    return [{
      dateRanges: [dateRanges[0]],
      dimensions: [{ name: 'deviceCategory' }, { name: 'customEvent:ai_overview_click' }],
      metrics: [{ name: 'eventCount' }, { name: 'sessions' }],
      dimensionFilter: aiFilter,
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
      keepEmptyRows: false,
      limit: 500,
    }]
  }

  return []
}

// ─── fetchAndCache — updated to route BQ vs GA4 ───────────────────────────────
async function fetchAndCache(
  page: string,
  propertyId: string,
  dateRanges: object[],
  filters: any,
  bqSaJson: string,
  ga4SaJson: string | null,
  cacheKey: string,
): Promise<object[][]> {
  let allReports: object[][]

  if (BQ_PAGES.has(page)) {
    // BigQuery path — all affiliate/LLM dashboard pages
    const token = await getBQToken(bqSaJson)
    allReports  = await executeBQPage(page, dateRanges, filters, token)
  } else if (page === 'ai-overview') {
    // GA4 path — ai-overview remains on GA4 (separate workstream)
    if (!ga4SaJson) throw new Error('GA4_SERVICE_ACCOUNT_JSON not configured for ai-overview')
    const requests = buildAiOverviewRequests(dateRanges, filters)
    if (!requests.length) throw new Error(`Unknown ai-overview queryType: '${filters?.queryType}'`)
    const accessToken = await getGA4Token(ga4SaJson)
    const BATCH_LIMIT = 5
    allReports = []
    for (let i = 0; i < requests.length; i += BATCH_LIMIT) {
      const chunk       = requests.slice(i, i + BATCH_LIMIT)
      const batchResult: any = await batchRunReports(propertyId, chunk, accessToken)
      allReports.push(...(batchResult.reports || []).map((r: any) => normaliseReport(r)))
    }
  } else {
    throw new Error(`Unknown page type: '${page}'`)
  }

  const ttl = computeTTL(page, dateRanges)
  await writeCache(cacheKey, page, propertyId, allReports, ttl)
  return allReports
}

// ─── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { page, propertyId, dateRanges, filters } = await req.json()

    if (!page || !propertyId || !dateRanges) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: page, propertyId, dateRanges' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    if (String(propertyId).trim().toUpperCase() === 'TBC' || String(propertyId).trim() === '') {
      return new Response(
        JSON.stringify({ error: `Property ID '${propertyId}' is not yet configured.` }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    if (!ALL_PAGES.has(page)) {
      return new Response(
        JSON.stringify({ error: `Unknown page type: '${page}'.` }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    // BQ service account — required for all non-ai-overview pages
    const bqSaJson = Deno.env.get('BIGQUERY_SERVICE_ACCOUNT_JSON')
    if (!bqSaJson && BQ_PAGES.has(page)) {
      return new Response(
        JSON.stringify({ error: 'BIGQUERY_SERVICE_ACCOUNT_JSON secret not configured' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    // GA4 service account — only needed for ai-overview
    const ga4SaJson = Deno.env.get('GA4_SERVICE_ACCOUNT_JSON') ?? null

    // ─ Cache check ───────────────────────────────────────────────────────────
    const cacheKey = buildCacheKey(page, propertyId, dateRanges, filters)
    const cached   = await readCache(cacheKey)

    if (cached) {
      const isStale = cached.expires_at < new Date().toISOString()

      if (!isStale) {
        console.log(`Cache HIT (fresh): ${page} ${propertyId}`)
        return new Response(
          JSON.stringify({ page, propertyId, reports: cached.reports, cached_at: cached.cached_at, _cached: true }),
          { headers: { ...CORS, 'Content-Type': 'application/json' } }
        )
      }

      // Stale — return immediately, revalidate in background
      console.log(`Cache HIT (stale, revalidating): ${page} ${propertyId}`)
      const backgroundRefresh = fetchAndCache(page, propertyId, dateRanges, filters, bqSaJson!, ga4SaJson, cacheKey)
        .catch(e => console.error('Background revalidation failed:', e))

      try { EdgeRuntime.waitUntil(backgroundRefresh) } catch { /* not available in all runtimes */ }

      return new Response(
        JSON.stringify({ page, propertyId, reports: cached.reports, cached_at: cached.cached_at, _cached: true, _stale: true }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    // ─ Cache miss — fetch from BQ/GA4, write to cache, return ────────────────
    console.log(`Cache MISS: ${page} ${propertyId}`)
    const allReports = await fetchAndCache(page, propertyId, dateRanges, filters, bqSaJson!, ga4SaJson, cacheKey)
    const now        = new Date().toISOString()
    return new Response(
      JSON.stringify({ page, propertyId, reports: allReports, cached_at: now, _cached: false }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('ga4-query_affiliates error:', err)
    return new Response(
      JSON.stringify({ error: 'An internal error occurred.' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
