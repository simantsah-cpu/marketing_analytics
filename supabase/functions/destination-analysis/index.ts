import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ─────────────────────────────────────────────────────────────────────────────
// BigQuery REST helper — same pattern as bigquery-report-109
// ─────────────────────────────────────────────────────────────────────────────

async function getBQAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson)
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: sa.client_email,
    scope: [
      'https://www.googleapis.com/auth/bigquery.readonly',
      'https://www.googleapis.com/auth/cloud-platform.read-only',
    ].join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }

  const enc = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

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
    ['sign'],
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(unsigned),
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
    throw new Error(`BQ token error: ${JSON.stringify(tokenData)}`)
  }
  return tokenData.access_token
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic query runner — uses queryParameters for safe array handling
// ─────────────────────────────────────────────────────────────────────────────

interface BQParam {
  name: string
  parameterType: { type: string; arrayType?: { type: string } }
  parameterValue: { value?: string; arrayValues?: { value: string }[] }
}

async function runQueryWithParams(
  projectId: string,
  sql: string,
  accessToken: string,
  queryParameters: BQParam[],
  timeoutMs = 25000,
): Promise<Record<string, unknown>[]> {
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: sql,
      useLegacySql: false,
      timeoutMs,
      queryParameters,
      parameterMode: 'NAMED',
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`BigQuery error ${res.status}: ${errText}`)
  }

  const result = await res.json()

  if (result.errors?.length) {
    throw new Error(`BigQuery query errors: ${JSON.stringify(result.errors)}`)
  }
  if (!result.jobComplete) {
    // If job didn't complete in timeoutMs, poll for completion via jobReference
    if (result.jobReference) {
      return await pollJob(projectId, result.jobReference.jobId, accessToken)
    }
    throw new Error('BigQuery job did not complete within timeout.')
  }

  return extractRows(result)
}

function extractRows(result: any): Record<string, unknown>[] {
  const schema = result.schema?.fields ?? []
  const rows = result.rows ?? []
  return rows.map((row: any) => {
    const obj: Record<string, unknown> = {}
    schema.forEach((field: any, i: number) => {
      const raw = row.f[i]?.v
      // FIX: empty string must NOT be coerced to Number (Number('') === 0).
      // Only convert to a number when the string is non-empty AND truly numeric.
      if (raw == null || raw === '') {
        obj[field.name] = null
      } else if (raw.trim() !== '' && !isNaN(Number(raw)) && raw.trim() !== '') {
        obj[field.name] = Number(raw)
      } else {
        obj[field.name] = raw
      }
    })
    return obj
  })
}

async function pollJob(
  projectId: string,
  jobId: string,
  accessToken: string,
  maxAttempts = 20,
): Promise<Record<string, unknown>[]> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 1500))
    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${jobId}?timeoutMs=5000&maxResults=100000`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) throw new Error(`BigQuery poll error ${res.status}`)
    const result = await res.json()
    if (result.jobComplete) return extractRows(result)
  }
  throw new Error('BigQuery job polling timed out after max attempts.')
}

// Helper to build a named INT64 array parameter
function intArrayParam(name: string, values: number[]): BQParam {
  return {
    name,
    parameterType: { type: 'ARRAY', arrayType: { type: 'INT64' } },
    parameterValue: { arrayValues: values.map((v) => ({ value: String(v) })) },
  }
}

// Helper to build a named STRING parameter
function stringParam(name: string, value: string): BQParam {
  return {
    name,
    parameterType: { type: 'STRING' },
    parameterValue: { value },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL builders
// ─────────────────────────────────────────────────────────────────────────────

// 3a. Airport list — only airports with clean, human-readable Latin names
const AIRPORTS_SQL = `
SELECT DISTINCT
  code3                   AS code,
  TRIM(name)              AS name
FROM \`elife-data-warehouse-prod.dim.dim_airport\`
WHERE code3 IS NOT NULL
  AND name IS NOT NULL
  AND TRIM(name) != ''
  AND LENGTH(TRIM(name)) > 3
  AND NOT REGEXP_CONTAINS(TRIM(name), r'^[0-9/\\-]+$')
  AND NOT REGEXP_CONTAINS(TRIM(name), r'^[\\?]+$')
  AND REGEXP_CONTAINS(TRIM(name), r'[A-Za-z]')
ORDER BY TRIM(name)
`

// 3b. Searches — GA4 events_* with pick_up_code + drop_off_code unnesting
function buildSearchesSQL(includeDropoff: boolean): string {
  const dropoffFilter = includeDropoff
    ? `AND ep_dropoff.value.string_value = @dropoff_code`
    : ''

  return `
WITH base AS (
  SELECT
    ep_pickup.value.string_value  AS pickup_code,
    ep_dropoff.value.string_value AS dropoff_code,
    EXTRACT(ISOWEEK FROM PARSE_DATE('%Y%m%d', event_date)) AS iso_week,
    EXTRACT(YEAR  FROM PARSE_DATE('%Y%m%d', event_date)) AS yr,
    device.category AS device_category,
    CASE
      WHEN traffic_source.medium IN ('cpc','organic')
        OR collected_traffic_source.manual_medium IN ('cpc','organic')
        THEN 'search'
      WHEN LOWER(traffic_source.medium) = 'email'
        OR LOWER(collected_traffic_source.manual_medium) = 'email'
        THEN 'email'
      WHEN traffic_source.medium = 'referral'
        OR collected_traffic_source.manual_medium = 'referral'
        THEN 'affiliates'
      WHEN LOWER(traffic_source.medium) = '(none)'
        AND LOWER(traffic_source.source) = '(direct)'
        THEN 'direct'
      ELSE 'other'
    END AS channel
  FROM \`elife-data-warehouse-prod.analytics_259261360.events_*\`,
    UNNEST(event_params) AS ep_pickup,
    UNNEST(event_params) AS ep_dropoff
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
                           AND FORMAT_DATE('%Y%m%d', CURRENT_DATE())
    AND event_name = 'view_search_results'
    AND ep_pickup.key  = 'pick_up_code'
    AND ep_dropoff.key = 'drop_off_code'
    AND EXTRACT(ISOWEEK FROM PARSE_DATE('%Y%m%d', event_date)) IN UNNEST(@weeks)
    AND EXTRACT(YEAR  FROM PARSE_DATE('%Y%m%d', event_date)) IN UNNEST(@years)
    AND ep_pickup.value.string_value = @pickup_code
    ${dropoffFilter}
)
SELECT
  pickup_code,
  dropoff_code,
  iso_week,
  yr      AS year,
  channel,
  device_category,
  COUNT(*) AS search_count
FROM base
GROUP BY 1,2,3,4,5,6
ORDER BY yr, iso_week
`
}

// 3c. Bookings — GA4 begin_checkout events (matches original report's bco metric)
// This uses the same BigQuery GA4 table as searches, so both metrics are consistent.
// event_name = 'begin_checkout' fires when a user starts checkout for a specific route.
function buildBookingsSQL(includeDropoff: boolean): string {
  const dropoffFilter = includeDropoff
    ? `AND ep_dropoff.value.string_value = @dropoff_code`
    : ''

  return `
WITH base AS (
  SELECT
    ep_pickup.value.string_value  AS pickup_code,
    ep_dropoff.value.string_value AS dropoff_code,
    EXTRACT(ISOWEEK FROM PARSE_DATE('%Y%m%d', event_date)) AS iso_week,
    EXTRACT(YEAR  FROM PARSE_DATE('%Y%m%d', event_date)) AS yr,
    device.category AS device_category,
    CASE
      WHEN traffic_source.medium IN ('cpc','organic')
        OR collected_traffic_source.manual_medium IN ('cpc','organic')
        THEN 'search'
      WHEN LOWER(traffic_source.medium) = 'email'
        OR LOWER(collected_traffic_source.manual_medium) = 'email'
        THEN 'email'
      WHEN traffic_source.medium = 'referral'
        OR collected_traffic_source.manual_medium = 'referral'
        THEN 'affiliates'
      WHEN LOWER(traffic_source.medium) = '(none)'
        AND LOWER(traffic_source.source) = '(direct)'
        THEN 'direct'
      ELSE 'other'
    END AS channel
  FROM \`elife-data-warehouse-prod.analytics_259261360.events_*\`,
    UNNEST(event_params) AS ep_pickup,
    UNNEST(event_params) AS ep_dropoff
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
                           AND FORMAT_DATE('%Y%m%d', CURRENT_DATE())
    AND event_name = 'begin_checkout'
    AND ep_pickup.key  = 'pick_up_code'
    AND ep_dropoff.key = 'drop_off_code'
    AND EXTRACT(ISOWEEK FROM PARSE_DATE('%Y%m%d', event_date)) IN UNNEST(@weeks)
    AND EXTRACT(YEAR  FROM PARSE_DATE('%Y%m%d', event_date)) IN UNNEST(@years)
    AND ep_pickup.value.string_value = @pickup_code
    ${dropoffFilter}
)
SELECT
  pickup_code,
  dropoff_code,
  iso_week,
  yr      AS year,
  channel,
  device_category,
  COUNT(*) AS booking_count
FROM base
GROUP BY 1,2,3,4,5,6
ORDER BY yr, iso_week
`
}

// 3c-hist. Historical bookings — ads_ride_dispatch_v for years before GA4 data exists (pre-2026)
// GA4 BigQuery export (analytics_259261360.events_*) only contains data from 2026 onwards.
// For YoY comparison we fall back to the ads table which has historical booking records.
function buildHistoricalBookingsSQL(includeDropoff: boolean, isIATADropoff: boolean, hasZoneName: boolean): string {
  let dropoffFilter = ''
  if (includeDropoff) {
    if (isIATADropoff) {
      dropoffFilter = `AND dropoff_airport_code3 = @dropoff_code`
    } else if (hasZoneName) {
      // Zone destinations: fuzzy match on zone name (case-insensitive)
      dropoffFilter = `AND LOWER(COALESCE(dropoff_zone_name, '')) LIKE CONCAT('%', LOWER(@dropoff_name), '%')`
    }
    // If zone but no name available, return no rows (safer than returning wrong aggregated totals)
    else {
      dropoffFilter = `AND FALSE`
    }
  }

  return `
SELECT
  pickup_airport_code3                              AS pickup_code,
  COALESCE(dropoff_airport_code3, dropoff_zone_name) AS dropoff_code,
  CAST(EXTRACT(ISOWEEK FROM DATE(booking_date)) AS INT64) AS iso_week,
  CAST(EXTRACT(ISOYEAR FROM DATE(booking_date)) AS INT64) AS year,
  'all'                                             AS channel,
  'all'                                             AS device_category,
  COUNT(*)                                          AS booking_count
FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\`
WHERE pickup_airport_code3 = @pickup_code
  AND dispatch_stat NOT IN ('cancelled', 'failed')
  AND EXTRACT(ISOYEAR FROM DATE(booking_date)) < 2026
  AND EXTRACT(ISOWEEK FROM DATE(booking_date)) IN UNNEST(@weeks)
  AND EXTRACT(ISOYEAR FROM DATE(booking_date)) IN UNNEST(@years)
  ${dropoffFilter}
GROUP BY 1,2,3,4,5,6
ORDER BY year, iso_week
`
}


// 3d. Funnel — all 4 GA4 events
function buildFunnelSQL(includeDropoff: boolean): string {
  const dropoffFilter = includeDropoff
    ? `AND ep_dropoff.value.string_value = @dropoff_code`
    : ''

  return `
WITH base AS (
  SELECT
    event_name,
    ep_pickup.value.string_value  AS pickup_code,
    ep_dropoff.value.string_value AS dropoff_code,
    EXTRACT(ISOWEEK FROM PARSE_DATE('%Y%m%d', event_date)) AS iso_week,
    EXTRACT(YEAR  FROM PARSE_DATE('%Y%m%d', event_date)) AS yr
  FROM \`elife-data-warehouse-prod.analytics_259261360.events_*\`,
    UNNEST(event_params) AS ep_pickup,
    UNNEST(event_params) AS ep_dropoff
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
                           AND FORMAT_DATE('%Y%m%d', CURRENT_DATE())
    AND event_name IN ('view_search_results','begin_checkout','checkout','purchase')
    AND ep_pickup.key  = 'pick_up_code'
    AND ep_dropoff.key = 'drop_off_code'
    AND EXTRACT(ISOWEEK FROM PARSE_DATE('%Y%m%d', event_date)) IN UNNEST(@weeks)
    AND EXTRACT(YEAR  FROM PARSE_DATE('%Y%m%d', event_date)) IN UNNEST(@years)
    AND ep_pickup.value.string_value = @pickup_code
    ${dropoffFilter}
)
SELECT
  event_name,
  iso_week,
  yr     AS year,
  COUNT(*) AS event_count
FROM base
GROUP BY 1,2,3
ORDER BY yr, iso_week, event_name
`
}

// ─────────────────────────────────────────────────────────────────────────────
// Compute current ISO week from JS Date (ISO 8601)
// ─────────────────────────────────────────────────────────────────────────────
function currentISOWeek(): { week: number; year: number } {
  const now = new Date()
  const tmp = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return { week, year: tmp.getUTCFullYear() }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    const {
      type,
      pickup,
      dropoff,
      dropoffZoneCode,
      dropoffName,
      weeks: weeksRaw,
      years: yearsRaw,
    } = body

    // ── Auth ────────────────────────────────────────────────────────────────
    const serviceAccountJson =
      Deno.env.get('BIGQUERY_SERVICE_ACCOUNT_JSON') ??
      Deno.env.get('GA4_SERVICE_ACCOUNT_JSON')

    if (!serviceAccountJson) {
      return new Response(
        JSON.stringify({ error: 'BIGQUERY_SERVICE_ACCOUNT_JSON secret not configured' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }

    const projectId = Deno.env.get('BIGQUERY_PROJECT_ID')
    if (!projectId) {
      return new Response(
        JSON.stringify({ error: 'BIGQUERY_PROJECT_ID secret not configured' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }

    const accessToken = await getBQAccessToken(serviceAccountJson)

    // ── Schema probe (debug only) ──────────────────────────────────────────────
    if (type === 'schema_probe') {
      const pickupCode = typeof body.pickup === 'string' ? body.pickup : 'PMI'
      const sql = `
        SELECT
          dropoff_airport_code3,
          dropoff_zone_name,
          dropoff_airport_name,
          route_name,
          COUNT(*) AS cnt,
          SUM(elife_amount_usd) AS ttv
        FROM \`elife-data-warehouse-prod.ads.ads_ride_dispatch_v\`
        WHERE pickup_airport_code3 = '${pickupCode}'
          AND EXTRACT(YEAR FROM DATE(booking_date)) IN (2025, 2026)
          AND EXTRACT(ISOWEEK FROM DATE(booking_date)) IN (19,20,21,22,23,24)
          AND dispatch_stat NOT IN ('cancelled','failed')
        GROUP BY 1,2,3,4
        ORDER BY cnt DESC
        LIMIT 30
      `
      const rows = await runQueryWithParams(projectId, sql, accessToken, [])
      // Also probe dim_airport for zone codes relevant to this pickup
      const dimSql = `
        SELECT code3, TRIM(name) AS name
        FROM \`elife-data-warehouse-prod.dim.dim_airport\`
        WHERE code3 IN ('2QZ','PMN','PUP','PTA','1IB','1MG','27J','CFA','CAO','0FZ','PQT','CLR','0JR','2EP','SIL','YWQ','02U','0QY','0HY','2EX','CRU','SAN')
        ORDER BY name
      `
      let dimRows: Record<string, unknown>[] = []
      // Try multiple plausible zone/resort dimension tables
      const tablesToTry = [
        'elife-data-warehouse-prod.dim.dim_zone',
        'elife-data-warehouse-prod.dim.dim_resort',
        'elife-data-warehouse-prod.dim.dim_location',
        'elife-data-warehouse-prod.ads.dim_dropoff',
      ]
      const dimResults: Record<string, unknown> = {}
      for (const tbl of tablesToTry) {
        try {
          const testSql = `SELECT * FROM \`${tbl}\` LIMIT 3`
          const testRows = await runQueryWithParams(projectId, testSql, accessToken, [])
          dimResults[tbl] = testRows
        } catch(e: any) {
          dimResults[tbl] = { error: e.message?.slice(0, 120) }
        }
      }
      return new Response(
        JSON.stringify({ rows, dimResults }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }

    // ── Booking event probe ────────────────────────────────────────────────────
    if (type === 'booking_probe') {
      const pickupCode = typeof body.pickup === 'string' ? body.pickup : 'PMI'
      const dropoffCode = typeof body.dropoffCode === 'string' ? body.dropoffCode : '2QZ'
      const sql = `
        SELECT
          event_name,
          COUNT(*) AS event_count
        FROM \`elife-data-warehouse-prod.analytics_259261360.events_*\`,
          UNNEST(event_params) AS ep_pickup,
          UNNEST(event_params) AS ep_dropoff
        WHERE _TABLE_SUFFIX BETWEEN '20260101' AND FORMAT_DATE('%Y%m%d', CURRENT_DATE())
          AND ep_pickup.key  = 'pick_up_code'
          AND ep_dropoff.key = 'drop_off_code'
          AND ep_pickup.value.string_value  = '${pickupCode}'
          AND ep_dropoff.value.string_value = '${dropoffCode}'
          AND EXTRACT(ISOWEEK FROM PARSE_DATE('%Y%m%d', event_date)) IN (16,17,18,19,20,21)
        GROUP BY 1
        ORDER BY event_count DESC
      `
      const rows = await runQueryWithParams(projectId, sql, accessToken, [])
      return new Response(
        JSON.stringify({ rows }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }

    // ── Airports ─────────────────────────────────────────────────────────────
    if (type === 'airports') {
      const rows = await runQueryWithParams(projectId, AIRPORTS_SQL, accessToken, [])
      return new Response(
        JSON.stringify({ airports: rows }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }

    // ── Resolve weeks/years (default = rolling 6 from current week) ─────────
    let weeks: number[] = Array.isArray(weeksRaw) && weeksRaw.length > 0 ? weeksRaw : []
    let years: number[] = Array.isArray(yearsRaw) && yearsRaw.length > 0 ? yearsRaw : []

    if (weeks.length === 0) {
      const { week: curWeek } = currentISOWeek()
      weeks = Array.from({ length: 6 }, (_, i) => {
        const w = curWeek - 5 + i
        return w < 1 ? w + 52 : w
      })
    }
    if (years.length === 0) {
      const { year: curYear } = currentISOWeek()
      years = [curYear - 1, curYear]
    }

    const includeDropoff = typeof dropoff === 'string' && dropoff !== '__all__' && dropoff !== ''
    const pickupCode = typeof pickup === 'string' ? pickup : 'TFS'
    // dropoffCode       → zone name for TGRS bookings filter (e.g. "Cala Millor")
    // searchDropoffCode → zone code for GA4 searches filter  (e.g. "2QZ")
    //   If dropoffZoneCode not provided, fall back to dropoffCode (works for IATA airports).
    const dropoffCode = includeDropoff ? dropoff : ''
    const searchDropoffCode = includeDropoff
      ? (typeof dropoffZoneCode === 'string' && dropoffZoneCode ? dropoffZoneCode : dropoffCode)
      : ''

    // Shared params (used by all queries)
    const baseParams: BQParam[] = [
      stringParam('pickup_code', pickupCode),
      intArrayParam('weeks', weeks),
      intArrayParam('years', years),
    ]

    // ── Searches ─────────────────────────────────────────────────────────────
    // GA4 stores the zone CODE (e.g. 2QZ) in drop_off_code — use searchDropoffCode
    if (type === 'searches') {
      const sql = buildSearchesSQL(includeDropoff)
      const params = [...baseParams]
      if (includeDropoff) params.push(stringParam('dropoff_code', searchDropoffCode))
      const rows = await runQueryWithParams(projectId, sql, accessToken, params)
      return new Response(
        JSON.stringify({ searches: rows }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }

    // ── Bookings ─────────────────────────────────────────────────────────────
    // GA4 begin_checkout — uses zone CODE (same as searches), not zone name.
    // GA4 BigQuery export only has data from 2026+. For earlier years we run a
    // parallel query against ads_ride_dispatch_v and merge the results so YoY
    // comparison shows real 2025 numbers instead of zeros.
    if (type === 'bookings') {
      const ga4Sql    = buildBookingsSQL(includeDropoff)
      const ga4Params = [...baseParams]
      if (includeDropoff) ga4Params.push(stringParam('dropoff_code', searchDropoffCode))

      // Historical query — only for years before GA4 data starts (< 2026)
      const prevYears = years.filter((y: number) => y < 2026)
      const isIATADropoff = includeDropoff && /^[A-Z]{3}$/.test(searchDropoffCode)
      const dropoffNameStr = typeof dropoffName === 'string' ? dropoffName.trim() : ''
      const hasZoneName   = !isIATADropoff && dropoffNameStr.length > 0

      let histPromise: Promise<Record<string, unknown>[]> = Promise.resolve([])
      if (prevYears.length > 0) {
        const histSql    = buildHistoricalBookingsSQL(includeDropoff, isIATADropoff, hasZoneName)
        const histParams: BQParam[] = [
          stringParam('pickup_code', pickupCode),
          intArrayParam('weeks', weeks),
          intArrayParam('years', prevYears),
        ]
        if (includeDropoff) {
          if (isIATADropoff) {
            histParams.push(stringParam('dropoff_code', searchDropoffCode))
          } else if (hasZoneName) {
            histParams.push(stringParam('dropoff_name', dropoffNameStr))
          }
        }
        histPromise = runQueryWithParams(projectId, histSql, accessToken, histParams)
          .catch((err: Error) => {
            // Non-fatal — log and fall back to empty so GA4 data still renders
            console.warn('[destination-analysis] Historical bookings query failed:', err.message)
            return []
          })
      }

      const [ga4Rows, histRows] = await Promise.all([
        runQueryWithParams(projectId, ga4Sql, accessToken, ga4Params),
        histPromise,
      ])

      return new Response(
        JSON.stringify({ bookings: [...ga4Rows, ...histRows] }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }

    // ── Funnel ───────────────────────────────────────────────────────────────
    // GA4 funnel also uses zone CODE — use searchDropoffCode
    if (type === 'funnel') {
      const sql = buildFunnelSQL(includeDropoff)
      const params = [...baseParams]
      if (includeDropoff) params.push(stringParam('dropoff_code', searchDropoffCode))
      const rows = await runQueryWithParams(projectId, sql, accessToken, params)
      return new Response(
        JSON.stringify({ funnel: rows }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({ error: `Unknown type: ${type}. Expected airports|searches|bookings|funnel` }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  } catch (err: any) {
    console.error('destination-analysis error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }
})
