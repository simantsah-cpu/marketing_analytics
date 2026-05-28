/**
 * ga4-ai-overview — Edge Function
 *
 * Dedicated function for querying Google AI Overview click data from GA4.
 * Uses the custom event-scoped dimension `customEvent:ai_overview_click`
 * which captures the exact snippet text a user clicked inside Google's
 * AI Overview before landing on hoppa.com.
 *
 * GA4 Property: 259261360 (hoppa.com)
 * Custom dimension active since: 30 Sept 2025
 *
 * Request body:
 *   {
 *     propertyId: string          — GA4 property ID
 *     dateRanges: [               — 1 or 2 date range objects
 *       { startDate: string, endDate: string }
 *     ]
 *     filters: {
 *       queryType: 'kpis' | 'trend' | 'device'
 *       deviceFilter?: string[]   — optional device filter (e.g. ['mobile'])
 *     }
 *   }
 *
 * Response:
 *   { reports: Row[][] }
 *   where Row is a flat object of { dimensionName: value, metricName: number }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

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

// ─── Build GA4 report requests ────────────────────────────────────────────────
//
// AI Overview filter:
//   Excludes rows where customEvent:ai_overview_click = '(not set)'.
//   GA4 already excludes empty-string values when keepEmptyRows: false.
//
function buildRequests(
  dateRanges: object[],
  queryType: string,
  deviceFilter: string[]
) {
  // Mandatory filter: include ONLY rows where the dimension has a real snippet value.
  // FULL_REGEXP '.+' matches any non-empty string, which excludes both:
  //   - empty string ""  (sessions where the custom dimension was never set)
  //   - "(not set)"      (GA4 placeholder for missing dimension values)
  const aiFilter = {
    filter: {
      fieldName: 'customEvent:ai_overview_click',
      stringFilter: { matchType: 'FULL_REGEXP', value: '.+' },
    },
  }

  // Also explicitly exclude the "(not set)" placeholder via a second condition
  const notSetFilter = {
    notExpression: {
      filter: {
        fieldName: 'customEvent:ai_overview_click',
        stringFilter: { matchType: 'EXACT', value: '(not set)' },
      },
    },
  }

  // Optional device category filter
  const devFilter =
    deviceFilter.length === 0
      ? null
      : deviceFilter.length === 1
      ? {
          filter: {
            fieldName: 'deviceCategory',
            stringFilter: { matchType: 'EXACT', value: deviceFilter[0] },
          },
        }
      : {
          filter: {
            fieldName: 'deviceCategory',
            inListFilter: { values: deviceFilter, caseSensitive: false },
          },
        }

  // Combine: MUST match regexp AND MUST NOT be "(not set)" AND (optionally) device
  const buildFilter = (includeDevice: boolean) => {
    const expressions: object[] = [aiFilter, notSetFilter]
    if (includeDevice && devFilter) expressions.push(devFilter)
    if (expressions.length === 1) return expressions[0]
    return { andGroup: { expressions } }
  }

  // ── kpis: snippet-level aggregates (supports up to 2 date ranges for comparison)
  if (queryType === 'kpis') {
    const filter = buildFilter(true)
    const baseReq = (dr: object) => ({
      dateRanges: [dr],
      dimensions: [{ name: 'customEvent:ai_overview_click' }],
      metrics: [
        { name: 'eventCount' },
        { name: 'activeUsers' },
      ],
      dimensionFilter: filter,
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
      keepEmptyRows: false,
      limit: 500,
    })
    const reqs = [baseReq(dateRanges[0])]
    if (dateRanges.length > 1 && dateRanges[1]) reqs.push(baseReq(dateRanges[1]))
    return reqs
  }

  // ── trend: yearWeek × snippet for weekly trend chart + lifecycle matrix
  if (queryType === 'trend') {
    return [
      {
        dateRanges: [dateRanges[0]],
        dimensions: [
          { name: 'yearWeek' },
          { name: 'customEvent:ai_overview_click' },
        ],
        metrics: [{ name: 'eventCount' }, { name: 'activeUsers' }],
        dimensionFilter: buildFilter(true),
        orderBys: [{ dimension: { dimensionName: 'yearWeek' } }],
        keepEmptyRows: false,
        limit: 5000,
      },
    ]
  }

  // ── device: deviceCategory × snippet for device split bars
  if (queryType === 'device') {
    return [
      {
        dateRanges: [dateRanges[0]],
        dimensions: [
          { name: 'deviceCategory' },
          { name: 'customEvent:ai_overview_click' },
        ],
        metrics: [{ name: 'eventCount' }, { name: 'sessions' }],
        dimensionFilter: buildFilter(false), // no device filter — we want ALL devices
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        keepEmptyRows: false,
        limit: 5000,
      },
    ]
  }

  throw new Error(`Unknown queryType: ${queryType}`)
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    const { propertyId, dateRanges, filters } = body

    if (!propertyId || !dateRanges?.length) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: propertyId, dateRanges' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    const queryType: string = filters?.queryType ?? 'kpis'
    const deviceFilter: string[] = Array.isArray(filters?.deviceFilter)
      ? filters.deviceFilter
      : filters?.deviceFilter && filters.deviceFilter !== 'all'
      ? [filters.deviceFilter]
      : []

    const serviceAccountJson = Deno.env.get('GA4_SERVICE_ACCOUNT_JSON')
    if (!serviceAccountJson) {
      return new Response(
        JSON.stringify({ error: 'GA4_SERVICE_ACCOUNT_JSON secret not configured' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    const accessToken = await getGoogleAccessToken(serviceAccountJson)
    const requests = buildRequests(dateRanges, queryType, deviceFilter)
    const batchResult: any = await batchRunReports(propertyId, requests, accessToken)

    const reports = (batchResult.reports ?? []).map((r: any) => normaliseReport(r))

    return new Response(
      JSON.stringify({ reports }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('ga4-ai-overview error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
