/**
 * GA4 CACHE WARMER
 * ─────────────────────────────────────────────────────────────────────────────
 * Pre-warms the ga4_cache table by firing queries for a SINGLE page + preset
 * per invocation. Supabase free tier edge functions have a 26-second execution
 * timeout — we can't warm all 24 combinations in one call.
 *
 * The GitHub Actions workflow calls this once per page per preset in a loop,
 * with a 2s sleep between each to avoid GA4 quota exhaustion.
 *
 * Also handles cache cleanup: when called with {"action":"cleanup"}, deletes
 * rows expired more than 48h ago. One cleanup call per workflow run is enough.
 *
 * Auth: x-warmer-secret header must match WARMER_SECRET env var.
 *
 * Request body:
 *   { "action": "cleanup" }                          → delete stale rows
 *   { "page": "executive", "preset": "last30d" }    → warm one page/preset
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-warmer-secret',
}

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')   ?? ''
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY       = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const WARMER_SECRET  = Deno.env.get('WARMER_SECRET')  ?? ''

// ─── Date presets ─────────────────────────────────────────────────────────────
const DATE_PRESETS: Record<string, () => object[]> = {
  last30d: () => {
    const t = new Date(), fmt = (d: Date) => d.toISOString().slice(0, 10)
    const ago = (n: number) => { const d = new Date(t); d.setDate(d.getDate() - n); return fmt(d) }
    return [{ startDate: ago(30), endDate: fmt(t) }, { startDate: ago(60), endDate: ago(31) }]
  },
  last7d: () => {
    const t = new Date(), fmt = (d: Date) => d.toISOString().slice(0, 10)
    const ago = (n: number) => { const d = new Date(t); d.setDate(d.getDate() - n); return fmt(d) }
    return [{ startDate: ago(7), endDate: fmt(t) }, { startDate: ago(14), endDate: ago(8) }]
  },
  thisMonth: () => {
    const t = new Date(), fmt = (d: Date) => d.toISOString().slice(0, 10)
    const som  = new Date(t.getFullYear(), t.getMonth(), 1)
    const eolm = new Date(t.getFullYear(), t.getMonth(), 0)
    const solm = new Date(t.getFullYear(), t.getMonth() - 1, 1)
    return [{ startDate: fmt(som), endDate: fmt(t) }, { startDate: fmt(solm), endDate: fmt(eolm) }]
  },
  last90d: () => {
    const t = new Date(), fmt = (d: Date) => d.toISOString().slice(0, 10)
    const ago = (n: number) => { const d = new Date(t); d.setDate(d.getDate() - n); return fmt(d) }
    return [{ startDate: ago(90), endDate: fmt(t) }]
  },
}

// ─── Property ─────────────────────────────────────────────────────────────────
const PROPERTY_ID = '259261360'

// ─── Cleanup ──────────────────────────────────────────────────────────────────
async function cleanupExpiredRows(): Promise<string> {
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ga4_cache?expires_at=lt.${encodeURIComponent(cutoff)}`,
    {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: 'return=minimal' },
    }
  )
  return res.ok ? `Cleanup OK (cutoff: ${cutoff.slice(0, 16)})` : `Cleanup failed: ${res.status}`
}

// ─── Warm one page + preset ──────────────────────────────────────────────────
// ai-overview fires 3 separate queryType sub-queries. We treat each as a
// distinct page key so the warmer caches all 3 independently.
const PAGE_EXTRA_FILTERS: Record<string, object> = {
  'ai-overview:kpis':   { queryType: 'kpis' },
  'ai-overview:trend':  { queryType: 'trend' },
  'ai-overview:device': { queryType: 'device' },
}

async function warmOne(page: string, preset: string): Promise<{ result: string, cached: boolean }> {
  const dateRanges = DATE_PRESETS[preset]?.()
  if (!dateRanges) return { result: `Unknown preset: ${preset}`, cached: false }

  // Resolve page name and any extra filters
  const filters = PAGE_EXTRA_FILTERS[page] ?? {}
  const ga4Page = page.includes(':') ? page.split(':')[0] : page

  const res = await fetch(`${SUPABASE_URL}/functions/v1/ga4-query_affiliates`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ page: ga4Page, propertyId: PROPERTY_ID, dateRanges, filters }),
  })

  if (!res.ok) {
    const body = await res.text()
    return { result: `HTTP ${res.status}: ${body.slice(0, 100)}`, cached: false }
  }

  const data = await res.json()
  return {
    result: data._cached ? 'hit' : 'miss (warmed)',
    cached: data._cached ?? false,
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const secret = req.headers.get('x-warmer-secret') ?? new URL(req.url).searchParams.get('secret')
  if (!WARMER_SECRET || secret !== WARMER_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}

  // Cleanup action
  if (body.action === 'cleanup') {
    const msg = await cleanupExpiredRows()
    return new Response(JSON.stringify({ ok: true, msg }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Warm one page + preset
  const { page, preset } = body
  if (!page || !preset) {
    return new Response(
      JSON.stringify({ error: 'Provide either {action:"cleanup"} or {page, preset}', presets: Object.keys(DATE_PRESETS) }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }

  const { result, cached } = await warmOne(page, preset)
  console.log(`Warm ${page}/${preset}: ${result}`)
  return new Response(
    JSON.stringify({ ok: true, page, preset, result, cached }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } }
  )
})
