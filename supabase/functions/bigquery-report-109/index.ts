import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { requireAuth } from '../_shared/requireAuth.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ─────────────────────────────────────────────────────────────────────────────
// BigQuery REST helper
// ─────────────────────────────────────────────────────────────────────────────

async function getBQAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson)
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss:  sa.client_email,
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
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) {
    throw new Error(`BQ token error: ${JSON.stringify(tokenData)}`)
  }
  return tokenData.access_token
}

async function runQuery(
  projectId:   string,
  sql:         string,
  accessToken: string,
  timeoutMs = 9000,
): Promise<Record<string, unknown>[]> {
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs }),
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
    throw new Error('BigQuery job did not complete within timeout.')
  }

  const schema = result.schema?.fields ?? []
  const rows   = result.rows ?? []

  return rows.map((row: any) => {
    const obj: Record<string, unknown> = {}
    schema.forEach((field: any, i: number) => {
      const raw = row.f[i]?.v
      obj[field.name] = raw == null ? null : isNaN(Number(raw)) ? raw : Number(raw)
    })
    return obj
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL builders
// Source: elife-data-warehouse-prod.b2cdata.ads_ads_b2c_dashboard_v
//
// Query structure matches the canonical report query:
//   - Filter on booking_date (not event_date)
//   - Sessions  = SUM(overall_sessions)
//   - Bookings  = SUM(keyEvents)
//   - Conv %    = keyEvents / overall_sessions * 100
//   - TTV       = SUM(ttv)
//   - ATV       = ttv / keyEvents
//   - Spend_USD = SUM(Spend) / exchangeRate   (Spend is in GBP)
//   - Net Contrib = SUM(actual_profit)
//   - ROI       = actual_profit / Spend_USD
// ─────────────────────────────────────────────────────────────────────────────

const BQ_TABLE = '`elife-data-warehouse-prod.b2cdata.ads_ads_b2c_dashboard_v`'

/** Build platform + channel WHERE clauses from filter arrays. */
function filterClauses(platforms: string[], channels: string[]): string {
  const parts: string[] = []
  if (platforms.length > 0) {
    const vals = platforms.map(p => `'${p.replace(/'/g, "''")}'`).join(', ')
    parts.push(`platform IN (${vals})`)
  }
  if (channels.length > 0) {
    const vals = channels.map(c => `'${c.replace(/'/g, "''")}'`).join(', ')
    parts.push(`marketing_channel IN (${vals})`)
  }
  return parts.length > 0 ? `AND ${parts.join('\n      AND ')}` : ''
}

// ── Summary (KPI totals for a date range) ────────────────────────────────────
function buildSummarySQL(
  startDate:    string,
  endDate:      string,
  platforms:    string[],
  channels:     string[],
  exchangeRate: number,
): string {
  return `
    SELECT
      ROUND(SUM(overall_sessions), 0)                                                        AS sessions,
      ROUND(SUM(keyEvents), 0)                                                               AS bookings,
      ROUND(SAFE_DIVIDE(SUM(keyEvents), NULLIF(SUM(overall_sessions), 0)) * 100, 2)          AS conv_pct,
      ROUND(SUM(ttv), 2)                                                                     AS ttv,
      ROUND(SAFE_DIVIDE(SUM(ttv), NULLIF(SUM(keyEvents), 0)), 2)                             AS atv,
      ROUND(SUM(Spend) / ${exchangeRate}, 2)                                                 AS spend_usd,
      ROUND(SUM(IFNULL(actual_profit, 0) + IFNULL(estimate_profit, 0)), 2)                  AS estimated_profit,
      ROUND(SUM(IFNULL(actual_profit, 0) + IFNULL(estimate_profit, 0)) - SUM(Spend) / ${exchangeRate}, 2)   AS net_contribution,
      ROUND(
        SAFE_DIVIDE(
          SUM(IFNULL(actual_profit, 0) + IFNULL(estimate_profit, 0)) - SUM(Spend) / ${exchangeRate},
          NULLIF(SUM(Spend) / ${exchangeRate}, 0)
        ), 2
      )                                                                                      AS roi
    FROM ${BQ_TABLE}
    WHERE booking_date BETWEEN '${startDate}' AND '${endDate}'
      ${filterClauses(platforms, channels)}
  `
}

// ── Trend (daily time series for trend charts) ────────────────────────────────
function buildTrendSQL(
  startDate:    string,
  endDate:      string,
  platforms:    string[],
  channels:     string[],
  exchangeRate: number,
): string {
  return `
    SELECT
      CAST(booking_date AS STRING)                                                            AS d,
      ROUND(SUM(overall_sessions), 0)                                                        AS s,
      ROUND(SUM(keyEvents), 0)                                                               AS b,
      ROUND(SAFE_DIVIDE(SUM(keyEvents), NULLIF(SUM(overall_sessions), 0)) * 100, 2)          AS conv,
      ROUND(SUM(ttv), 2)                                                                     AS ttv,
      ROUND(SUM(Spend) / ${exchangeRate}, 2)                                                 AS sp,
      ROUND(SUM(IFNULL(actual_profit, 0) + IFNULL(estimate_profit, 0)) - SUM(Spend) / ${exchangeRate}, 2) AS np
    FROM ${BQ_TABLE}
    WHERE booking_date BETWEEN '${startDate}' AND '${endDate}'
      ${filterClauses(platforms, channels)}
    GROUP BY booking_date
    ORDER BY booking_date
  `
}

// ── Channel breakdown ─────────────────────────────────────────────────────────
function buildChannelsSQL(
  startDate:    string,
  endDate:      string,
  platforms:    string[],
  channels:     string[],
  exchangeRate: number,
): string {
  return `
    SELECT
      COALESCE(marketing_channel, 'Untracked')                                               AS channel,
      ROUND(SUM(overall_sessions), 0)                                                        AS sessions,
      ROUND(SAFE_DIVIDE(SUM(keyEvents), NULLIF(SUM(overall_sessions), 0)) * 100, 2)          AS conv_pct,
      ROUND(SUM(keyEvents), 2)                                                               AS bookings,
      ROUND(SUM(ttv), 0)                                                                     AS ttv,
      ROUND(SUM(IFNULL(actual_profit, 0) + IFNULL(estimate_profit, 0)), 1)                  AS estimated_profit,
      ROUND(SAFE_DIVIDE(SUM(ttv), NULLIF(SUM(keyEvents), 0)), 1)                             AS atv,
      ROUND(SAFE_DIVIDE(SUM(IFNULL(actual_profit, 0) + IFNULL(estimate_profit, 0)), NULLIF(SUM(keyEvents), 0)), 1) AS amv,
      ROUND(SUM(Spend) / ${exchangeRate}, 1)                                                 AS spend_usd,
      ROUND(SUM(IFNULL(actual_profit, 0) + IFNULL(estimate_profit, 0)) - SUM(Spend) / ${exchangeRate}, 0) AS net_contribution,
      ROUND(
        SAFE_DIVIDE(
          SUM(IFNULL(actual_profit, 0) + IFNULL(estimate_profit, 0)) - SUM(Spend) / ${exchangeRate},
          NULLIF(SUM(Spend) / ${exchangeRate}, 0)
        ), 2
      )                                                                                      AS roi,
      ROUND(
        SAFE_DIVIDE(
          SUM(IFNULL(actual_profit, 0) + IFNULL(estimate_profit, 0)) - SUM(Spend) / ${exchangeRate},
          NULLIF(SUM(keyEvents), 0)
        ), 0
      )                                                                                      AS ncpb
    FROM ${BQ_TABLE}
    WHERE booking_date BETWEEN '${startDate}' AND '${endDate}'
      ${filterClauses(platforms, channels)}
    GROUP BY marketing_channel
    ORDER BY sessions DESC NULLS LAST
  `
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function toDateStr(d: string | undefined): string {
  if (!d) return new Date().toISOString().slice(0, 10)
  return new Date(d).toISOString().slice(0, 10)
}

// ─── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const authResult = await requireAuth(req)
  if (authResult instanceof Response) return authResult

  try {
    const body = await req.json()
    const {
      dateRanges,
      compMode       = 'prev',
      platformFilter = ['APP', 'WEB'],  // default: both APP and WEB (per canonical query)
      channelFilter  = [],              // empty = all channels
      exchangeRate   = 0.744,           // GBP → USD rate; passed from dashboard filter bar
    } = body

    // Normalise arrays
    const platforms: string[] = Array.isArray(platformFilter) && platformFilter.length > 0
      ? platformFilter : ['APP', 'WEB']
    const channels: string[]  = Array.isArray(channelFilter) ? channelFilter : []
    const exRate: number      = typeof exchangeRate === 'number' && exchangeRate > 0
      ? exchangeRate : 0.744

    // ── Resolve date ranges ─────────────────────────────────────────────────
    const currRange = dateRanges?.[0] ?? {}
    const compRange = dateRanges?.[1] ?? {}

    const currStart = toDateStr(currRange.startDate ?? currRange.start_date)
    const currEnd   = toDateStr(currRange.endDate   ?? currRange.end_date)
    const compStart = toDateStr(compRange.startDate ?? compRange.start_date)
    const compEnd   = toDateStr(compRange.endDate   ?? compRange.end_date)

    // ── Auth ────────────────────────────────────────────────────────────────
    const serviceAccountJson = Deno.env.get('BIGQUERY_SERVICE_ACCOUNT_JSON')
      ?? Deno.env.get('GA4_SERVICE_ACCOUNT_JSON')

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

    // ── Parse optional channel comparison range ──────────────────────────────
    const chComp      = body.channelCompRange ?? {}
    const chCompStart = chComp.startDate ?? chComp.start_date
    const chCompEnd   = chComp.endDate   ?? chComp.end_date
    const hasChComp   = !!(chCompStart && chCompEnd)

    // ── Run all queries in parallel ─────────────────────────────────────────
    const baseQueries = [
      runQuery(projectId, buildSummarySQL(currStart, currEnd, platforms, channels, exRate), accessToken),
      runQuery(projectId, buildSummarySQL(compStart, compEnd, platforms, channels, exRate), accessToken),
      runQuery(projectId, buildTrendSQL(currStart, currEnd, platforms, channels, exRate),   accessToken),
      runQuery(projectId, buildChannelsSQL(currStart, currEnd, platforms, channels, exRate), accessToken),
      runQuery(projectId, buildChannelsSQL(compStart, compEnd, platforms, channels, exRate), accessToken),
    ]
    if (hasChComp) {
      baseQueries.push(runQuery(projectId, buildChannelsSQL(chCompStart, chCompEnd, platforms, channels, exRate), accessToken))
    }
    const [currRows, compRows, trendRows, channelRows, prevChannelRows, compChannelRows] = await Promise.all(baseQueries)

    const currKPIs = currRows[0] ?? {}
    const compKPIs = compRows[0] ?? {}

    // Helper to build a KPI snapshot object
    const kpiShape = (k: Record<string, unknown>) => ({
      sessions:         k.sessions,
      bookings:         k.bookings,
      conv_pct:         k.conv_pct,
      ttv:              k.ttv,
      atv:              k.atv,
      spend_usd:        k.spend_usd,
      estimated_profit: k.estimated_profit,
      net_contribution: k.net_contribution,
      roi:              k.roi,
    })

    const payload = {
      meta: {
        curr_range:    `${currStart} – ${currEnd}`,
        prev_range:    `${compStart} – ${compEnd}`,
        queried_at:    new Date().toISOString(),
        comp_mode:     compMode,
        exchange_rate: exRate,
        platforms,
        channels,
      },
      curr:         kpiShape(currKPIs),
      prev:         compMode !== 'yoy' ? kpiShape(compKPIs) : null,
      yoy:          compMode === 'yoy' ? kpiShape(compKPIs) : null,
      trend:        trendRows,
      channels:     channelRows,
      prevChannels: prevChannelRows,
      ...(hasChComp && compChannelRows ? { compChannels: compChannelRows } : {}),
    }

    return new Response(
      JSON.stringify(payload),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  } catch (err: any) {
    console.error('bigquery-report-109 error:', err)
    return new Response(
      JSON.stringify({ error: 'An internal error occurred.' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }
})
