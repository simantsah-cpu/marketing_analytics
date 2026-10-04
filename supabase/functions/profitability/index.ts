// profitability — backend for the Profitability dashboard.
//
// POST { page: 'executive-summary' | 'countries' | 'cities' | 'routes' | 'customers', period, as_of, region, country, product, city, team, ctype, force }
//   period: 'ytd' | 'complete' | 'mtd' | 'last_year' | 'since2025'
//   as_of:  'latest' | 'eod:YYYY-MM-DD' | 'YYYY-MM-DDTHH:MM:00Z' (within the ~7-day time-travel window)
//   region: countries/cities — '' (all) or a region display label
//   country: cities/routes/customers — '' (all) or a country name
//   product: routes/customers — '' (all) or a product line;  city: routes only — service-area id or ''
//   team, ctype: customers only — '' (all) or a team / customer type as stored
//   force:  true skips the cache read (Refresh button)
//
// All queries of one response share one pinned as_of (FOR SYSTEM_TIME AS OF + pickup cut-off).
// Money is returned as integer cents.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { requireAuth } from '../_shared/requireAuth.ts'
import { getBQAccessToken, runQuery, tableLastModifiedMs } from '../_shared/profitability/bigquery.ts'
import {
  PERIOD_KEYS, type PeriodKey, parseAsOfSelector, resolveAsOf, availablePeriods, snapshotOptions,
  dateOf, isoMinute,
} from '../_shared/profitability/time.ts'
import { FACT_TABLE } from '../_shared/profitability/sql.ts'
import { executiveSummary } from '../_shared/profitability/executiveSummary.ts'
import { countriesPage, parseRegion } from '../_shared/profitability/countries.ts'
import { citiesPage, parseCountry } from '../_shared/profitability/cities.ts'
import { routesPage, parseProduct, parseCity } from '../_shared/profitability/routes.ts'
import { NO_CITY } from '../_shared/profitability/sql.ts'
import { customersPage, parseLabel } from '../_shared/profitability/customers.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

/** JSON response, gzip-compressed when the client accepts it and the body is large (Cities ≈ 1,100 rows × months). */
async function jsonMaybeGzip(req: Request, body: unknown): Promise<Response> {
  const text = JSON.stringify(body)
  if (text.length < 20_000 || !(req.headers.get('accept-encoding') ?? '').includes('gzip')) return json(body)
  const gz = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
  return new Response(gz, {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' },
  })
}

const PAGES = new Set(['executive-summary', 'countries', 'cities', 'routes', 'customers'])
const CACHE_VERSION = 'v4'

// ── Payload cache (shared ga4_cache table; service role only) ─────────────────
const SB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SB_HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

async function readCache(key: string): Promise<any | null> {
  if (!SB_URL || !SB_KEY) return null
  try {
    const now = encodeURIComponent(new Date().toISOString())
    const res = await fetch(
      `${SB_URL}/rest/v1/ga4_cache?cache_key=eq.${encodeURIComponent(key)}&expires_at=gt.${now}&select=reports&limit=1`,
      { headers: SB_HEADERS },
    )
    if (!res.ok) return null
    const rows = await res.json()
    return rows.length ? rows[0].reports : null
  } catch { return null }
}

async function writeCache(key: string, page: string, body: unknown, ttlSeconds: number) {
  if (!SB_URL || !SB_KEY) return
  try {
    const now = new Date()
    await fetch(`${SB_URL}/rest/v1/ga4_cache`, {
      method: 'POST',
      headers: { ...SB_HEADERS, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        cache_key: key, page: `profitability-${page}`, property_id: 'bigquery',
        reports: body, cached_at: now.toISOString(),
        expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
      }),
    })
  } catch (e) { console.warn('[profitability] cache write failed (non-fatal):', e) }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  let body: any = {}
  try { body = await req.json() } catch { /* empty body → defaults */ }

  const page = typeof body.page === 'string' ? body.page : 'executive-summary'
  if (!PAGES.has(page)) return json({ error: `Unknown page: ${page}` }, 400)
  const period = (typeof body.period === 'string' ? body.period : 'ytd') as PeriodKey
  if (!(PERIOD_KEYS as readonly string[]).includes(period)) return json({ error: `Unknown period: ${period}` }, 400)

  const nowMs = Date.now()
  let asOfMs: number
  let selector
  let region = ''
  let country = ''
  let product = ''
  let city = NO_CITY
  let team = ''
  let ctype = ''
  try {
    selector = parseAsOfSelector(body.as_of)
    asOfMs = resolveAsOf(selector, nowMs)
    if (page === 'countries' || page === 'cities' || page === 'routes' || page === 'customers') region = parseRegion(body.region)
    if (page === 'cities' || page === 'routes' || page === 'customers') country = parseCountry(body.country)
    if (page === 'routes' || page === 'customers') product = parseProduct(body.product)
    if (page === 'routes') city = parseCity(body.city)
    if (page === 'customers') { team = parseLabel(body.team, 'team'); ctype = parseLabel(body.ctype, 'customer type') }
  } catch (e: any) {
    return json({ error: e.message }, 400)
  }
  const periods = availablePeriods(dateOf(asOfMs))
  if (!periods.find((p) => p.key === period)?.available) {
    return json({ error: 'No complete months this year yet — choose another period.' }, 400)
  }

  try {
    const sa = Deno.env.get('BIGQUERY_SERVICE_ACCOUNT_JSON') ?? Deno.env.get('GA4_SERVICE_ACCOUNT_JSON')
    if (!sa) return json({ error: 'BIGQUERY_SERVICE_ACCOUNT_JSON secret not configured' }, 500)
    const projectId = Deno.env.get('BIGQUERY_PROJECT_ID') ?? 'elife-data-warehouse-prod'
    const token = await getBQAccessToken(sa)

    // Cache key: exact as_of for pinned snapshots; 10-minute bucket for "latest".
    const isLatest = selector.kind === 'latest'
    const bucket = isLatest ? Math.floor(asOfMs / 600_000) * 600_000 : asOfMs
    const key = `profitability:${CACHE_VERSION}:${page}:${period}:${[region, country, product, city, team, ctype].map((x) => encodeURIComponent(String(x))).join(':')}:${isoMinute(bucket)}`

    if (!body.force) {
      const hit = await readCache(key)
      if (hit) {
        // A pinned as_of is immutable. For "latest", discard the entry if the warehouse
        // reloaded after the cached as_of (MAX(etl_time) moved on).
        const modified = isLatest ? await tableLastModifiedMs(token, FACT_TABLE) : null
        const stale = modified !== null && modified > Date.parse(hit.data.as_of)
        if (!stale) return jsonMaybeGzip(req, { ...hit, cached: true, snapshots: snapshotOptions(nowMs), periods })
      }
    }

    const run = (_name: string, sql: string, params: object[]) => runQuery(projectId, token, sql, params)
    const result = page === 'customers'
      ? await customersPage(period, { region, country, product, team, ctype }, asOfMs, run)
      : page === 'routes'
      ? await routesPage(period, { region, country, product, city }, asOfMs, run)
      : page === 'cities'
      ? await citiesPage(period, region, country, asOfMs, run)
      : page === 'countries'
        ? await countriesPage(period, region, asOfMs, run)
        : await executiveSummary(period, asOfMs, run)
    const response = { status: result.status, retried: result.retried, data: result.data }
    if (result.status === 'ok') await writeCache(key, page, response, isLatest ? 2 * 3600 : 7 * 86400)
    return jsonMaybeGzip(req, { ...response, cached: false, snapshots: snapshotOptions(nowMs), periods })
  } catch (err: any) {
    console.error('[profitability] error:', err)
    return json({ error: err?.message ?? 'Internal error' }, 500)
  }
})
