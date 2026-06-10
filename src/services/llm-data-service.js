/**
 * LLM INTELLIGENCE DATA SERVICE
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetches GA4 data for LLM referral traffic via page: 'llm' on the Edge
 * Function — a new page case with NO sessionMedium filter (LLM traffic comes
 * via referral/none/organic, not the 'affiliates' medium used by every other
 * page). The source is filtered by sessionSource inListFilter instead.
 *
 * Report layout returned by the Edge Function for page: 'llm':
 *   report[0] — current period daily totals (date)
 *   report[1] — current period per-source aggregates (sessionSource)
 *   report[2] — current period per-source daily breakdown (date, sessionSource)
 *   report[3] — comparison period daily totals          (absent when off)
 *   report[4] — comparison period per-source aggregates (absent when off)
 *   report[5] — comparison period per-source daily      (absent when off)
 *
 * Merge rule (critical):
 *   Multiple source variants for the same LLM (e.g. copilot.com +
 *   copilot.microsoft.com + copilot.cloud.microsoft) are merged by SUMMING
 *   raw counts (sessions, bookings, revenue, engagedSessions) in pass 1.
 *   Derived metrics (CVR, AOV, EngRate, Rev/Session) are computed from the
 *   merged totals in pass 2. CVRs are never averaged.
 *
 * Trend chart:
 *   report[2] gives exact daily values per source — no approximation needed.
 *   The per-LLM daily arrays are built from real GA4 rows, then merged for
 *   LLMs with multiple source variants (same sum-then-derive rule).
 */

import { supabase } from './supabase'

// ─── LLM source definitions ───────────────────────────────────────────────────

export const LLM_SOURCE_KEYS = [
  'chatgpt.com',
  'gemini.google.com',
  'copilot.microsoft.com',
  'copilot.com',
  'copilot.cloud.microsoft',
  'perplexity',
  'perplexity.ai',
  'claude.ai',
  'grok.com',
]

export const LLM_SOURCE_MAP = {
  'chatgpt.com':             'ChatGPT',
  'gemini.google.com':       'Gemini',
  'copilot.microsoft.com':   'Copilot',
  'copilot.com':             'Copilot',
  'copilot.cloud.microsoft': 'Copilot',
  'perplexity':              'Perplexity',
  'perplexity.ai':           'Perplexity',
  'claude.ai':               'Claude',
  'grok.com':                'Grok',
}

export const LLM_COLORS = {
  ChatGPT:    '#10A37F',
  Gemini:     '#4285F4',
  Copilot:    '#7B61FF',
  Perplexity: '#FF6B35',
  Claude:     '#D97706',
  Grok:       '#1DA1F2',
}

export const LLM_ORDER = ['ChatGPT', 'Gemini', 'Copilot', 'Perplexity', 'Claude', 'Grok']

// ─── Source resolver ──────────────────────────────────────────────────────────

function resolveLLMName(source) {
  if (!source) return null
  const s = source.toLowerCase().trim()
  if (LLM_SOURCE_MAP[s]) return LLM_SOURCE_MAP[s]
  for (const [key, name] of Object.entries(LLM_SOURCE_MAP)) {
    if (s.includes(key)) return name
  }
  return null
}

// ─── Row merger — pass 1: sum counts; pass 2: derive metrics ─────────────────

export function mergeLLMRows(rows) {
  const groups = {}

  rows.forEach(row => {
    const name = resolveLLMName(row.sessionSource)
    if (!name) return
    if (!groups[name]) {
      groups[name] = { llm: name, _s: 0, _bk: 0, _rev: 0, _eng: 0, _durWt: 0 }
    }
    const g = groups[name]
    const s = row.sessions || 0
    g._s   += s
    g._bk  += (row.transactions || row.ecommercePurchases || 0)
    g._rev += (row.purchaseRevenue || 0)
    g._eng += (row.engagedSessions || 0)
    g._durWt += s * (row.averageSessionDuration || 0)
  })

  return LLM_ORDER.map(name => {
    const g = groups[name]
    if (!g) return { llm: name, sessions: 0, bookings: 0, revenue: 0, engagementRate: 0, convRate: 0, aov: 0, revPerSession: 0, bounceRate: 0, avgDuration: 0 }
    const { _s: ses, _bk: bk, _rev: rev, _eng: eng, _durWt: durWt } = g
    return {
      llm: name,
      sessions:       ses,
      bookings:       bk,
      revenue:        parseFloat(rev.toFixed(2)),
      engagementRate: ses > 0 ? eng / ses : 0,
      convRate:       ses > 0 ? bk  / ses : 0,
      aov:            bk  > 0 ? rev / bk  : 0,
      revPerSession:  ses > 0 ? rev / ses : 0,
      bounceRate:     ses > 0 ? 1 - eng / ses : 0,
      avgDuration:    ses > 0 ? durWt / ses : 0,
    }
  })
}

// ─── Exact daily series builder (from report[2] / report[5]) ─────────────────
//
// report[2] has rows like: { date: '20250101', sessionSource: 'chatgpt.com',
//   sessions: 12, transactions: 1, purchaseRevenue: 87.5, engagedSessions: 9 }
//
// We group these by date × resolved-LLM-name, summing variants (Copilot, etc.)
// then produce one array per LLM per metric.

function buildExactDailySeries(dailySourceRows, mergedAgg) {
  const sortDate  = (a, b) => a.date.localeCompare(b.date)
  const fmtDate   = r => `${r.date.slice(0,4)}-${r.date.slice(4,6)}-${r.date.slice(6,8)}`

  // Collect all unique sorted dates
  const dateSet = new Set()
  dailySourceRows.forEach(r => dateSet.add(r.date))
  const sortedDates = [...dateSet].sort()
  const dates = sortedDates.map(d => `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`)

  // Build lookup: date → llmName → { sessions, bookings, revenue, engagedSessions }
  const byDateLLM = {}
  dailySourceRows.forEach(row => {
    const name = resolveLLMName(row.sessionSource)
    if (!name) return
    const d = row.date
    if (!byDateLLM[d]) byDateLLM[d] = {}
    if (!byDateLLM[d][name]) byDateLLM[d][name] = { sessions: 0, bookings: 0, revenue: 0, engagedSessions: 0 }
    const g = byDateLLM[d][name]
    g.sessions       += (row.sessions || 0)
    g.bookings       += (row.transactions || 0)
    g.revenue        += (row.purchaseRevenue || 0)
    g.engagedSessions += (row.engagedSessions || 0)
  })

  const series = {}
  LLM_ORDER.forEach(name => {
    const agg = mergedAgg?.find(r => r.llm === name) || {}

    series[name] = {
      sessions:      sortedDates.map(d => byDateLLM[d]?.[name]?.sessions       ?? 0),
      bookings:      sortedDates.map(d => byDateLLM[d]?.[name]?.bookings       ?? 0),
      revenue:       sortedDates.map(d => parseFloat((byDateLLM[d]?.[name]?.revenue ?? 0).toFixed(2))),
      // Ratio metrics: derive daily where denominator > 0, else use aggregate constant
      cvr: sortedDates.map(d => {
        const cell = byDateLLM[d]?.[name]
        return cell && cell.sessions > 0 ? cell.bookings / cell.sessions : (agg.convRate ?? 0)
      }),
      aov: sortedDates.map(d => {
        const cell = byDateLLM[d]?.[name]
        return cell && cell.bookings > 0 ? cell.revenue / cell.bookings : (agg.aov ?? 0)
      }),
      engagementRate: sortedDates.map(d => {
        const cell = byDateLLM[d]?.[name]
        return cell && cell.sessions > 0 ? cell.engagedSessions / cell.sessions : (agg.engagementRate ?? 0)
      }),
      bounceRate: sortedDates.map(d => {
        const cell = byDateLLM[d]?.[name]
        return cell && cell.sessions > 0 ? 1 - cell.engagedSessions / cell.sessions : (agg.bounceRate ?? 0)
      }),
      avgDuration: sortedDates.map(() => agg.avgDuration ?? 0), // not in daily breakdown
    }
  })

  return { dates, series }
}

// ─── Date range builder (mirrors data-service.js) ────────────────────────────

async function buildGA4DateRanges(dateRanges) {
  if (!dateRanges) return [{ startDate: '30daysAgo', endDate: 'today' }]
  const ranges = [{ startDate: dateRanges.primary.startDate, endDate: dateRanges.primary.endDate }]
  if (dateRanges.comparison?.startDate) {
    ranges.push({ startDate: dateRanges.comparison.startDate, endDate: dateRanges.comparison.endDate })
  }
  return ranges
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches all LLM scorecard + trend data for the current filter state.
 *
 * Uses page: 'llm' — a new Edge Function case that applies NO sessionMedium
 * filter, so LLM referral traffic (medium: referral/none/organic) is included.
 *
 * Returns:
 *   current     — merged LLM rows for current period
 *   comparison  — merged LLM rows for comparison period | null
 *   dailySeries — { dates, series } with exact per-LLM daily arrays from GA4
 */
export async function getLLMData(propertyId, filters) {
  if (!propertyId) {
    return { current: mergeLLMRows([]), comparison: null, dailySeries: null }
  }

  await supabase.auth.getSession()

  const dateRanges = await buildGA4DateRanges(filters.dateRanges)

  const ga4Filters = {
    affiliateFilter: LLM_SOURCE_KEYS,   // tells Edge Fn to filter by these sources
    countryFilter:   filters.countryFilter  ?? [],
    deviceFilter:    filters.deviceFilter   ?? [],
  }

  const { data, error } = await supabase.functions.invoke('ga4-query_affiliates', {
    body: { page: 'llm', propertyId, dateRanges, filters: ga4Filters }
  })

  if (error) throw new Error(`LLM data fetch error: ${error.message}`)
  if (data?.error) throw new Error(`GA4 error: ${data.error}`)

  const reports = data.reports ?? []

  // report[0] = current daily totals
  // report[1] = current per-source aggregates
  // report[2] = current per-source daily breakdown
  // report[3] = comparison daily totals        (absent when comparison = 'off')
  // report[4] = comparison per-source aggregates (absent when comparison = 'off')
  // report[5] = comparison per-source daily     (absent when comparison = 'off')

  const currentSourceRows  = reports[1] ?? []
  const currentDailySource = reports[2] ?? []
  const compSourceRows     = reports[4] ?? null
  const compDailySource    = reports[5] ?? []

  const current    = mergeLLMRows(currentSourceRows)
  const comparison = compSourceRows && compSourceRows.length > 0
    ? mergeLLMRows(compSourceRows)
    : null

  // Build exact daily series for the trend chart
  const curSeries  = buildExactDailySeries(currentDailySource, current)
  const compSeries = comparison && compDailySource.length > 0
    ? buildExactDailySeries(compDailySource, comparison)
    : null

  // Merge into unified dailySeries shape consumed by LLMTrendChart
  const dailySeries = {
    currentDates:    curSeries.dates,
    comparisonDates: compSeries?.dates ?? [],
    series: Object.fromEntries(
      LLM_ORDER.map(name => [name, {
        current:    curSeries.series[name],
        comparison: compSeries?.series[name] ?? null,
      }])
    ),
  }

  return { current, comparison, dailySeries }
}

/**
 * Fetches per-page purchase breakdown for LLM sources.
 * Returns the top pagePaths where purchases originated from LLM-referred sessions.
 *
 * @param {string}   propertyId  GA4 property ID
 * @param {string[]} sourceKeys  Raw GA4 sessionSource keys to filter (e.g. ['chatgpt.com'])
 *                               If empty, all LLM sources are included.
 * @param {object}   filters     Global filter state (dateRanges, deviceFilter, countryFilter)
 * @returns {Promise<Array<{pagePath, sessions, purchases, revenue}>>}
 */
export async function getLLMPageData(propertyId, sourceKeys = [], filters = {}) {
  if (!propertyId) return []

  await supabase.auth.getSession()

  const dateRanges = await buildGA4DateRanges(filters.dateRanges)

  const ga4Filters = {
    affiliateFilter: sourceKeys.length > 0 ? sourceKeys : LLM_SOURCE_KEYS,
    countryFilter:   filters.countryFilter ?? [],
    deviceFilter:    filters.deviceFilter  ?? [],
  }

  const { data, error } = await supabase.functions.invoke('ga4-query_affiliates', {
    body: { page: 'llm-pages', propertyId, dateRanges, filters: ga4Filters }
  })

  if (error) throw new Error(`LLM page data fetch error: ${error.message}`)
  if (data?.error) throw new Error(`GA4 error: ${data.error}`)

  const rows = data?.reports?.[0] ?? []

  // Group by landingPage, summing across source variants (e.g. copilot.com + copilot.microsoft.com)
  const pageMap = {}
  rows.forEach(row => {
    const path = row.landingPage || '/'
    if (!pageMap[path]) {
      pageMap[path] = { landingPage: path, sessions: 0, purchases: 0, revenue: 0 }
    }
    pageMap[path].sessions  += (row.sessions          || 0)
    pageMap[path].purchases += (row.transactions       || 0)
    pageMap[path].revenue   += (row.purchaseRevenue    || 0)
  })

  return Object.values(pageMap)
    .map(p => ({ ...p, revenue: parseFloat(p.revenue.toFixed(2)) }))
    .sort((a, b) => b.revenue - a.revenue)
}
