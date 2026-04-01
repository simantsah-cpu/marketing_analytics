import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ─── JWT helper for Google service account ───────────────────────────────────
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

  // Build JWT header.payload
  const enc = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(payload)}`

  // Import the private key
  const pemBody = sa.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')

  const keyData = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
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
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const jwt = `${unsigned}.${sig}`

  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })

  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) {
    throw new Error(`Failed to get access token: ${JSON.stringify(tokenData)}`)
  }
  return tokenData.access_token
}

// ─── GA4 batchRunReports ─────────────────────────────────────────────────────
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
    const err = await res.text()
    throw new Error(`GA4 API error ${res.status}: ${err}`)
  }

  return await res.json()
}

// ─── Normalise a GA4 report row into flat objects ────────────────────────────
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

// ─── Build requests per page type ────────────────────────────────────────────
function buildRequests(page: string, dateRanges: object[], filters: any) {
  // Full dimension set per implementation plan to avoid GA4 cardinality sampling
  const fullDims = [
    { name: 'date' },
    { name: 'sessionSource' },
    { name: 'deviceCategory' },
    { name: 'country' },
  ]

  const affiliateDims = filters?.groupBy === 'promotion_method' 
    ? [{ name: 'sessionMedium' }] 
    : [{ name: 'sessionSource' }]
  const dateDims = [{ name: 'date' }]
  const countryDims = [{ name: 'country' }]

  // Affiliate filter — supports string 'all' (legacy) or string[] (new multi-select)
  const affiliateValues: string[] = Array.isArray(filters?.affiliateFilter)
    ? filters.affiliateFilter
    : (filters?.affiliateFilter && filters.affiliateFilter !== 'all' ? [filters.affiliateFilter] : [])

  const affiliateFilter = affiliateValues.length > 0
    ? affiliateValues.length === 1
      ? { fieldName: 'sessionSource', stringFilter: { matchType: 'EXACT', value: affiliateValues[0] } }
      : { fieldName: 'sessionSource', inListFilter: { values: affiliateValues, caseSensitive: false } }
    : null

  // Device filter — same pattern
  const deviceValues: string[] = Array.isArray(filters?.deviceFilter)
    ? filters.deviceFilter
    : (filters?.deviceFilter && filters.deviceFilter !== 'all' ? [filters.deviceFilter] : [])

  const deviceFilter = deviceValues.length > 0
    ? deviceValues.length === 1
      ? { fieldName: 'deviceCategory', stringFilter: { matchType: 'EXACT', value: deviceValues[0] } }
      : { fieldName: 'deviceCategory', inListFilter: { values: deviceValues, caseSensitive: false } }
    : null

  // Country filter — same pattern
  const countryValues: string[] = Array.isArray(filters?.countryFilter)
    ? filters.countryFilter
    : (filters?.countryFilter && filters.countryFilter !== 'all' ? [filters.countryFilter] : [])

  const countryFilter = countryValues.length > 0
    ? countryValues.length === 1
      ? { fieldName: 'country', stringFilter: { matchType: 'EXACT', value: countryValues[0] } }
      : { fieldName: 'country', inListFilter: { values: countryValues, caseSensitive: false } }
    : null

  const buildDimensionFilter = () => {
    const conditions = [affiliateFilter, deviceFilter, countryFilter].filter(Boolean)
    if (!conditions.length) return undefined
    if (conditions.length === 1) return { filter: conditions[0] }
    return { andGroup: { expressions: conditions.map((f: any) => ({ filter: f })) } }
  }

  // Mandatory sessionMedium = affiliates filter applied to all page blocks
  const mediumFilter = {
    filter: {
      fieldName: 'sessionMedium',
      stringFilter: { matchType: 'EXACT', value: 'affiliates', caseSensitive: false },
    }
  }

  // Combines mediumFilter with any user-selected dimension filters (affiliate, device, country)
  const withMediumFilter = () => {
    const existing = buildDimensionFilter()
    if (!existing) return mediumFilter
    return { andGroup: { expressions: [mediumFilter, existing] } }
  }

  const commonParams = {
    dateRanges,
    dimensionFilter: withMediumFilter(),
    keepEmptyRows: false,
  }

  const currentOnlyParams = {
    dateRanges: [dateRanges[0]],
    dimensionFilter: withMediumFilter(),
    keepEmptyRows: false,
  }
  // Comparison params — only built when a second dateRange exists
  const prevOnlyParams = dateRanges.length > 1 && dateRanges[1] ? {
    dateRanges: [dateRanges[1]],
    dimensionFilter: withMediumFilter(),
    keepEmptyRows: false,
  } : null

  if (page === 'executive') {
    const dailyMetrics = [
      { name: 'sessions' }, { name: 'transactions' },
      { name: 'purchaseRevenue' }, { name: 'sessionConversionRate' },
    ]
    const affiliateMetrics = [
      { name: 'sessions' }, { name: 'engagedSessions' },
      { name: 'engagementRate' }, { name: 'averageSessionDuration' },
      { name: 'transactions' }, { name: 'purchaseRevenue' },
      { name: 'averagePurchaseRevenue' }, { name: 'sessionConversionRate' },
      { name: 'bounceRate' }, { name: 'newUsers' },
    ]
    const reqs: object[] = [
      // report[0]: current period daily trend
      {
        ...currentOnlyParams,
        dimensions: dateDims,
        metrics: dailyMetrics,
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      },
      // report[1]: current period affiliate totals — identical query to scorecard
      {
        ...currentOnlyParams,
        dimensions: affiliateDims,
        metrics: affiliateMetrics,
        orderBys: [{ metric: { metricName: 'purchaseRevenue' }, desc: true }],
        limit: 5000,
      },
    ]
    if (prevOnlyParams) {
      reqs.push({
        ...prevOnlyParams,
        dimensions: dateDims,
        metrics: dailyMetrics,
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      })
      reqs.push({
        ...prevOnlyParams,
        dimensions: affiliateDims,
        metrics: affiliateMetrics,
        orderBys: [{ metric: { metricName: 'purchaseRevenue' }, desc: true }],
        limit: 5000,
      })
    }
    return reqs
  }

  if (page === 'traffic') {
    return [
      // KPIs by date
      {
        ...commonParams,
        dimensions: dateDims,
        metrics: [
          { name: 'sessions' }, { name: 'engagedSessions' },
          { name: 'engagementRate' }, { name: 'averageSessionDuration' },
          { name: 'screenPageViewsPerSession' }, { name: 'screenPageViews' },
          { name: 'newUsers' },
        ],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      },
      // Per affiliate engagement
      {
        ...commonParams,
        dimensions: affiliateDims,
        metrics: [
          { name: 'sessions' }, { name: 'engagedSessions' }, { name: 'engagementRate' },
          { name: 'averageSessionDuration' }, { name: 'bounceRate' },
          { name: 'newUsers' }, { name: 'activeUsers' }, { name: 'screenPageViews' },
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 5000,
      },
      // Country breakdown
      {
        ...commonParams,
        dimensions: countryDims,
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 12,
      },
      // Device breakdown
      {
        ...commonParams,
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'sessions' }],
      },
      // Top Landing Pages
      {
        ...commonParams,
        dimensions: [{ name: 'landingPage' }],
        metrics: [
          { name: 'sessions' },
          { name: 'engagedSessions' },
          { name: 'screenPageViews' },
          { name: 'averageSessionDuration' },
          { name: 'transactions' },
          { name: 'purchaseRevenue' }
        ],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 15,
      },
    ]
  }

  if (page === 'commercial') {
    return [
      // Daily trend
      {
        ...commonParams,
        dimensions: dateDims,
        metrics: [
          { name: 'sessions' }, { name: 'transactions' },
          { name: 'purchaseRevenue' }, { name: 'sessionConversionRate' },
          { name: 'averagePurchaseRevenue' },
        ],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      },
      // Per affiliate commercial
      {
        ...commonParams,
        dimensions: affiliateDims,
        metrics: [
          { name: 'sessions' }, { name: 'transactions' },
          { name: 'purchaseRevenue' }, { name: 'sessionConversionRate' },
          { name: 'averagePurchaseRevenue' }, { name: 'engagementRate' },
        ],
        orderBys: [{ metric: { metricName: 'purchaseRevenue' }, desc: true }],
        limit: 5000,
      },
      // Country bookings
      {
        ...commonParams,
        dimensions: countryDims,
        metrics: [{ name: 'transactions' }, { name: 'purchaseRevenue' }],
        orderBys: [{ metric: { metricName: 'transactions' }, desc: true }],
        limit: 10,
      },
    ]
  }

  if (page === 'funnel') {
    // We already have withMediumFilter() logically built in commonParams.
    // However, since we need to add 'eventName' filters to requests 2 & 3,
    // we must combine existing conditions (which include mediumFilter + user filters)
    // with the eventName filter carefully.
    
    // Extract the expressions from withMediumFilter() or wrap the single filter
    const baseFilter: any = withMediumFilter();
    const baseExpressions = baseFilter?.andGroup?.expressions 
      || (baseFilter?.filter ? [baseFilter.filter] : []);

    return [
      // report[0]: current period events by date
      {
        ...currentOnlyParams,
        dimensions: dateDims,
        metrics: [
          { name: 'sessions' },
          { name: 'eventCount' },
        ],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      },
      // report[1]: Per affiliate funnel (both periods tagged)
      {
        ...commonParams,
        dimensions: [{ name: 'sessionSource' }, { name: 'eventName' }, { name: 'date' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          andGroup: {
            expressions: [
              ...baseExpressions,
              {
                filter: {
                  fieldName: 'eventName',
                  inListFilter: {
                    values: ['view_search_results', 'form_submit', 'begin_checkout', 'purchase', 'payment_failure']
                  }
                }
              }
            ]
          }
        },
        limit: 5000,
      },
      // report[2]: Daily event counts per event name (used for payment failures)
      // Including deviceCategory to split mobile/desktop payment failures
      {
        ...commonParams,
        dimensions: [{ name: 'date' }, { name: 'eventName' }, { name: 'deviceCategory' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          andGroup: {
            expressions: [
              ...baseExpressions,
              {
                filter: {
                  fieldName: 'eventName',
                  inListFilter: {
                    values: ['view_search_results', 'form_submit', 'begin_checkout', 'purchase', 'payment_failure']
                  }
                }
              }
            ]
          }
        },
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      },
      // report[3]: PREVIOUS period daily sessions (for prev total sessions comparison)
      ...(prevOnlyParams ? [{
        ...prevOnlyParams,
        dimensions: dateDims,
        metrics: [
          { name: 'sessions' },
          { name: 'eventCount' },
        ],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      }] : []),
      // report[4]: current period per-affiliate sessions — used to compute the total sessions
      // KPI using the same affiliate-aggregate source as Traffic & Commercial dashboards,
      // ensuring all dashboards report the identical session count.
      {
        ...currentOnlyParams,
        dimensions: [{ name: 'sessionSource' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 5000,
      },
    ]
  }

  if (page === 'scorecard') {
    // Hard-code the sessionMedium=affiliates filter so only affiliate traffic is returned.
    // Combine with any other dimension filters (device, country) already in filters.
    const mediumFilter = {
      filter: {
        fieldName: 'sessionMedium',
        stringFilter: { matchType: 'EXACT', value: 'affiliates', caseSensitive: false },
      }
    }
    const existingFilter = buildDimensionFilter()
    const scorecardFilter = existingFilter
      ? { andGroup: { expressions: [mediumFilter, existingFilter] } }
      : mediumFilter

    const scorecardMetrics = [
      { name: 'sessions' }, { name: 'engagedSessions' },
      { name: 'engagementRate' }, { name: 'averageSessionDuration' },
      { name: 'transactions' }, { name: 'purchaseRevenue' },
      { name: 'averagePurchaseRevenue' }, { name: 'sessionConversionRate' },
      { name: 'bounceRate' }, { name: 'newUsers' },
    ]

    // Always fetch the current period (dateRanges[0])
    const currentRequest = {
      dateRanges: [dateRanges[0]],
      dimensionFilter: scorecardFilter,
      keepEmptyRows: false,
      dimensions: affiliateDims,
      metrics: scorecardMetrics,
      orderBys: [{ metric: { metricName: 'purchaseRevenue' }, desc: true }],
      limit: 5000,
    }

    const requests = [currentRequest]

    // If a comparison period exists (dateRanges[1]), add a second request for it
    if (dateRanges.length > 1 && dateRanges[1]) {
      requests.push({
        dateRanges: [dateRanges[1]],
        dimensionFilter: scorecardFilter,
        keepEmptyRows: false,
        dimensions: affiliateDims,
        metrics: scorecardMetrics,
        orderBys: [{ metric: { metricName: 'purchaseRevenue' }, desc: true }],
        limit: 5000,
      })
    }

    return requests
  }

  if (page === 'filter-options') {
    // Dedicated dimension-list fetch for populating filter dropdowns.
    // No medium filter — returns ALL session sources and countries.
    return [
      // report[0]: all affiliates (sessionSource) for the current date range
      {
        dateRanges,
        keepEmptyRows: false,
        dimensions: [{ name: 'sessionSource' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 500,
      },
      // report[1]: all countries for the current date range
      {
        dateRanges,
        keepEmptyRows: false,
        dimensions: [{ name: 'country' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 300,
      },
    ]
  }

  return []
}

// ─── Main handler ────────────────────────────────────────────────────────────
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

    const serviceAccountJson = Deno.env.get('GA4_SERVICE_ACCOUNT_JSON')
    if (!serviceAccountJson) {
      return new Response(
        JSON.stringify({ error: 'GA4_SERVICE_ACCOUNT_JSON secret not configured' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    const accessToken = await getGoogleAccessToken(serviceAccountJson)
    const requests = buildRequests(page, dateRanges, filters)

    if (!requests.length) {
      return new Response(
        JSON.stringify({ error: `Unknown page: ${page}` }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
      )
    }

    const batchResult: any = await batchRunReports(propertyId, requests, accessToken)

    // Normalise each report
    const reports = (batchResult.reports || []).map((r: any) => normaliseReport(r))

    return new Response(
      JSON.stringify({ page, propertyId, reports }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('ga4-query_affiliates error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
