/**
 * blog-banner-funnel — Edge Function
 *
 * Dedicated function for querying the blog_banner_click funnel from GA4.
 * Tracks the internal_referrer=transfers_banner parameter through the full
 * funnel: blog_banner_click → view_search_results → begin_checkout →
 * checkout → purchase.
 *
 * GA4 Property: 259261360 (hoppa.com)
 * Custom parameters: internal_referrer (hardcoded "transfers_banner"),
 *                    last_internal_page (referring blog URL)
 * Tracking live since: 25 Jun 2026
 *
 * KNOWN DATA QUALITY ISSUE (confirmed site-wide):
 *   The checkout and purchase GTM tags do NOT pass the internal_referrer /
 *   last_internal_page parameters. Zero out of 16,949 checkout events and
 *   zero out of 9,728 purchase events site-wide (any source, 30 days)
 *   carry internal_referrer = transfers_banner. This is a tagging gap, not
 *   a volume issue. Stages 3–4 of the funnel are therefore unattributable
 *   until a GTM fix is deployed.
 *
 * Request body:
 *   {
 *     propertyId:  string       — GA4 property ID (e.g. "259261360")
 *     dateRanges:  [            — 1 or 2 date range objects
 *       { startDate: string, endDate: string }
 *     ]
 *     queryType:   string       — one of:
 *       'funnel'        — banner click → funnel session counts per stage
 *       'daily'         — daily event counts for blog_banner_click
 *       'pages'         — click counts grouped by last_internal_page
 *       'channels'      — session counts grouped by sessionDefaultChannelGroup
 *       'devices'       — session counts grouped by deviceCategory
 *       'sitewide'      — site-wide benchmark: sessions, funnel rates (30d)
 *   }
 *
 * Response:
 *   { reports: Row[][] }
 *   where Row is a flat object of { dimensionName: value, metricName: number }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { requireAuth } from '../_shared/requireAuth.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ─── Google Service Account JWT → Access Token ────────────────────────────────

async function getGoogleAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson)
  const now = Math.floor(Date.now() / 1000)

  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }

  const enc = (obj: object) =>
    btoa(JSON.stringify(obj))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')

  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(payload)}`

  const pemBody = sa.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')

  const keyData = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(unsigned)
  )

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  const jwt = `${unsigned}.${sig}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })

  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) {
    throw new Error(`Failed to get Google access token: ${JSON.stringify(tokenData)}`)
  }
  return tokenData.access_token
}

// ─── GA4 batchRunReports ──────────────────────────────────────────────────────

async function batchRunReports(
  propertyId: string,
  requests: object[],
  accessToken: string
): Promise<object> {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:batchRunReports`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`GA4 API error ${res.status}: ${errText}`)
  }

  return res.json()
}

// ─── Normalise GA4 report rows to flat objects ────────────────────────────────

function normaliseReport(report: any): object[] {
  const dimHeaders = (report.dimensionHeaders ?? []).map((h: any) => h.name)
  const metHeaders = (report.metricHeaders ?? []).map((h: any) => h.name)

  return (report.rows ?? []).map((row: any) => {
    const obj: Record<string, string | number> = {}
    row.dimensionValues?.forEach((v: any, i: number) => { obj[dimHeaders[i]] = v.value })
    row.metricValues?.forEach((v: any, i: number) => { obj[metHeaders[i]] = parseFloat(v.value) || 0 })
    return obj
  })
}

// ─── Shared filter: internal_referrer = transfers_banner ─────────────────────
//
// This filter is applied to funnel events that carry the custom parameter.
// NOTE: checkout and purchase events do NOT pass this parameter (confirmed
// site-wide tagging gap) — so these event filters will return 0 rows for
// those stages even with the filter present. The front-end should reflect
// this as "unattributable" rather than "zero conversions confirmed".

const bannerFilter = {
  filter: {
    fieldName: 'customEvent:internal_referrer',
    stringFilter: { matchType: 'EXACT', value: 'transfers_banner' },
  },
}

// ─── Build GA4 report requests ────────────────────────────────────────────────

function buildRequests(dateRanges: object[], queryType: string): object[] {

  // ── funnel: session counts at each funnel stage filtered by internal_referrer
  //
  // DESIGN NOTE: Each funnel stage is a separate event-level query filtered to
  // eventName + internal_referrer = transfers_banner. We count sessions (not
  // events) to de-duplicate multi-click users. Stage 0 is blog_banner_click
  // (the entry event). Stages 3–4 (checkout, purchase) will return 0 sessions
  // due to the confirmed tagging gap — this is the expected, documented result.
  if (queryType === 'funnel') {
    const funnelEvents = [
      'blog_banner_click',
      'view_search_results',
      'begin_checkout',
      'checkout',
      'purchase',
    ]

    return funnelEvents.map(eventName => ({
      dateRanges: [dateRanges[0]],
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'sessions' }, { name: 'eventCount' }],
      dimensionFilter: {
        andGroup: {
          expressions: [
            {
              filter: {
                fieldName: 'eventName',
                stringFilter: { matchType: 'EXACT', value: eventName },
              },
            },
            bannerFilter,
          ],
        },
      },
      keepEmptyRows: false,
      limit: 1,
    }))
  }

  // ── daily: date × eventCount for blog_banner_click (no funnel filter needed
  //    since this is the entry event itself, which does carry the parameter)
  if (queryType === 'daily') {
    return [
      {
        dateRanges: [dateRanges[0]],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'eventCount' }, { name: 'sessions' }],
        dimensionFilter: {
          andGroup: {
            expressions: [
              {
                filter: {
                  fieldName: 'eventName',
                  stringFilter: { matchType: 'EXACT', value: 'blog_banner_click' },
                },
              },
              bannerFilter,
            ],
          },
        },
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        keepEmptyRows: false,
        limit: 100,
      },
    ]
  }

  // ── pages: last_internal_page breakdown for blog_banner_click
  //    Shows which blog pages are driving banner clicks.
  if (queryType === 'pages') {
    return [
      {
        dateRanges: [dateRanges[0]],
        dimensions: [
          { name: 'customEvent:last_internal_page' },
        ],
        metrics: [{ name: 'eventCount' }, { name: 'sessions' }],
        dimensionFilter: {
          andGroup: {
            expressions: [
              {
                filter: {
                  fieldName: 'eventName',
                  stringFilter: { matchType: 'EXACT', value: 'blog_banner_click' },
                },
              },
              bannerFilter,
            ],
          },
        },
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        keepEmptyRows: false,
        limit: 100,
      },
    ]
  }

  // ── channels: sessionDefaultChannelGroup breakdown for banner click sessions
  if (queryType === 'channels') {
    return [
      {
        dateRanges: [dateRanges[0]],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
        dimensionFilter: {
          andGroup: {
            expressions: [
              {
                filter: {
                  fieldName: 'eventName',
                  stringFilter: { matchType: 'EXACT', value: 'blog_banner_click' },
                },
              },
              bannerFilter,
            ],
          },
        },
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        keepEmptyRows: false,
        limit: 50,
      },
    ]
  }

  // ── devices: deviceCategory breakdown for banner click sessions
  if (queryType === 'devices') {
    return [
      {
        dateRanges: [dateRanges[0]],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'sessions' }],
        dimensionFilter: {
          andGroup: {
            expressions: [
              {
                filter: {
                  fieldName: 'eventName',
                  stringFilter: { matchType: 'EXACT', value: 'blog_banner_click' },
                },
              },
              bannerFilter,
            ],
          },
        },
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        keepEmptyRows: false,
        limit: 10,
      },
    ]
  }

  // ── sitewide: site-wide funnel benchmark (all traffic, last 30 days)
  //
  // Returns session counts at each funnel step for ALL traffic (no banner filter).
  // Used to compute site-average conversion rates for the expected-vs-observed
  // modelling section. Also returns total revenue and transactions for AOV calc.
  //
  // IMPORTANT: dateRanges[0] here should be the benchmark period (last 30 days),
  // not the banner campaign window. The client should pass the appropriate range.
  if (queryType === 'sitewide') {
    const funnelStages = [
      'session_start',
      'view_search_results',
      'begin_checkout',
      'checkout',
      'purchase',
    ]

    const stageRequests = funnelStages.map(eventName => ({
      dateRanges: [dateRanges[0]],
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'sessions' }, { name: 'eventCount' }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          stringFilter: { matchType: 'EXACT', value: eventName },
        },
      },
      keepEmptyRows: false,
      limit: 1,
    }))

    // Append a revenue query (purchase event + purchaseRevenue metric)
    const revenueRequest = {
      dateRanges: [dateRanges[0]],
      dimensions: [{ name: 'eventName' }],
      metrics: [
        { name: 'transactions' },
        { name: 'purchaseRevenue' },
      ],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          stringFilter: { matchType: 'EXACT', value: 'purchase' },
        },
      },
      keepEmptyRows: false,
      limit: 1,
    }

    return [...stageRequests, revenueRequest]
  }

  throw new Error(`Unknown queryType: ${queryType}`)
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult

  try {
    const body = await req.json()
    const { propertyId, dateRanges, queryType } = body

    if (!propertyId || !dateRanges?.length) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: propertyId, dateRanges' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    const resolvedQueryType: string = queryType ?? 'funnel'

    const serviceAccountJson = Deno.env.get('GA4_SERVICE_ACCOUNT_JSON')
    if (!serviceAccountJson) {
      return new Response(
        JSON.stringify({ error: 'GA4_SERVICE_ACCOUNT_JSON secret not configured' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    const accessToken = await getGoogleAccessToken(serviceAccountJson)
    const requests = buildRequests(dateRanges, resolvedQueryType)
    const batchResult: any = await batchRunReports(propertyId, requests, accessToken)

    const reports = (batchResult.reports ?? []).map((r: any) => normaliseReport(r))

    return new Response(
      JSON.stringify({ reports }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('blog-banner-funnel error:', err)
    return new Response(
      JSON.stringify({ error: 'An internal error occurred.' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
