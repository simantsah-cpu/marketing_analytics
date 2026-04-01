/**
 * DATA SERVICE LAYER
 * ──────────────────────────────────────────────────────────────
 * Routes to real GA4 data via Supabase Edge Function (ga4-query_affiliates)
 * when MOCK_MODE = false.
 *
 * Field name reference (GA4 field → dashboard field):
 *   sessionSource           → affiliateId
 *   sessions                → sessions
 *   transactions            → bookings
 *   purchaseRevenue         → revenue
 *   sessionConversionRate   → convRate
 *   averagePurchaseRevenue  → aov
 *   engagedSessions         → engagedSessions
 *   engagementRate          → engagementRate
 *   bounceRate              → bounceRate
 *   averageSessionDuration  → avgDuration
 */

import { supabase } from './supabase'
import { subDays, format, eachDayOfInterval } from 'date-fns'
import { resolveAffiliateName, resolvePromotionMethod } from '../utils/affiliate-map'

const MOCK_MODE = false // Live GA4 data via Supabase Edge Function


// ─── Supabase Edge Function caller ────────────────────────────────────────────

async function callGA4(page, propertyId, filters) {
  const dateRanges = buildGA4DateRanges(filters.dateRanges)
  // Strip frontend-only fields — the edge function only needs the filter dimensions.
  // Sending groupBy/granularity/anomalies etc. to the backend can cause unexpected failures.
  const ga4Filters = {
    affiliateFilter: filters.affiliateFilter,
    countryFilter:   filters.countryFilter,
    deviceFilter:    filters.deviceFilter,
  }
  const { data, error } = await supabase.functions.invoke('ga4-query_affiliates', {
    body: { page, propertyId, dateRanges, filters: ga4Filters }
  })
  if (error) throw new Error(`ga4-query_affiliates error: ${error.message}`)
  if (data.error) throw new Error(`GA4 error: ${data.error}`)
  return data.reports // array of normalised report arrays
}

// Convert FiltersContext dateRanges to GA4 API format
function buildGA4DateRanges(dateRanges) {
  if (!dateRanges) return [{ startDate: '30daysAgo', endDate: 'today' }]
  const ranges = [{ startDate: dateRanges.primary.startDate, endDate: dateRanges.primary.endDate }]
  if (dateRanges.comparison?.startDate) {
    ranges.push({ startDate: dateRanges.comparison.startDate, endDate: dateRanges.comparison.endDate })
  }
  return ranges
}

/**
 * Fetches all unique affiliate (sessionSource) and country dimension values
 * for the given date range, for use in populating filter dropdowns.
 * Returns affiliates as { value, label } pairs (raw ID → resolved name).
 */
export async function getFilterOptions(propertyId, dateRanges) {
  if (!propertyId) return { affiliates: [], countries: [] }
  const dr = dateRanges?.primary
    ? [{ startDate: dateRanges.primary.startDate, endDate: dateRanges.primary.endDate }]
    : [{ startDate: '30daysAgo', endDate: 'yesterday' }]
  try {
    const { data, error } = await supabase.functions.invoke('ga4-query_affiliates', {
      body: { page: 'filter-options', propertyId, dateRanges: dr, filters: {} }
    })
    if (error || data?.error) return { affiliates: [], countries: [] }
    const affiliateRows = data.reports?.[0] ?? []
    const countryRows   = data.reports?.[1] ?? []

    // Map raw sessionSource IDs to human-readable names using the affiliate map
    const affiliates = affiliateRows
      .map(r => r.sessionSource)
      .filter(Boolean)
      .map(src => ({
        value: src,
        label: resolveAffiliateName(src) ?? src,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))

    // Countries are returned as names already — no mapping needed
    const countries = countryRows.map(r => r.country).filter(Boolean)

    return { affiliates, countries }
  } catch {
    return { affiliates: [], countries: [] }
  }
}

// ─── Live data transformers ────────────────────────────────────────────────────

// transformExecutive now accepts an optional scorecardReports arg.
// When provided, KPIs + affiliate leaderboard are sourced from the scorecard
// query (same query as Affiliate Scorecard page), guaranteeing identical numbers.
function transformExecutive(reports, scorecardReports = null) {
  const currentDaily = [...(reports[0] ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  // Exclude system/unset rows — same logic as isAffiliate() in AffiliateScorecard.jsx
  // to guarantee Executive Summary KPIs match the Scorecard TOTAL row exactly.
  const validRow = (r) => !!(r.sessionSource && r.sessionSource !== '(not set)' && r.sessionSource !== '(direct)' && r.sessionSource !== 'direct')
  const currentAff   = (scorecardReports?.[0]?.length ? scorecardReports[0] : (reports[1] ?? [])).filter(validRow)
  const prevDaily    = [...(reports[2] ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  const prevAff      = (scorecardReports?.[1]?.length ? scorecardReports[1] : (reports[3] ?? [])).filter(validRow)


  const fmtDate = r => `${r.date.slice(0,4)}-${r.date.slice(4,6)}-${r.date.slice(6,8)}`

  // KPI totals — current period only
  // Sessions sourced from canonical affiliate roll-up (report[1], currentOnlyParams)
  // — same query as Traffic/Commercial/Funnel report[1], guaranteeing identical totals.
  const totals = currentAff.reduce((acc, row) => ({
    sessions: acc.sessions + (row.sessions || 0),
    bookings: acc.bookings + (row.transactions || 0),
    revenue:  acc.revenue  + (row.purchaseRevenue || 0),
  }), { sessions: 0, bookings: 0, revenue: 0 })
  totals.convRate = totals.sessions > 0 ? totals.bookings / totals.sessions : 0
  totals.aov      = totals.bookings  > 0 ? totals.revenue  / totals.bookings : 0

  // KPI comparisons — real comparison period data when available, 90% fallback otherwise
  let prev
  if (prevAff.length > 0) {
    const pt = prevAff.reduce((acc, row) => ({
      sessions: acc.sessions + (row.sessions || 0),
      bookings: acc.bookings + (row.transactions || 0),
      revenue:  acc.revenue  + (row.purchaseRevenue || 0),
    }), { sessions: 0, bookings: 0, revenue: 0 })
    pt.convRate = pt.sessions > 0 ? pt.bookings / pt.sessions : 0
    pt.aov      = pt.bookings  > 0 ? pt.revenue  / pt.bookings : 0
    prev = pt
  } else {
    prev = {
      sessions: totals.sessions * 0.9,
      bookings: totals.bookings * 0.9,
      revenue:  totals.revenue  * 0.9,
      convRate: totals.convRate * 0.95,
      aov:      totals.aov      * 0.97,
    }
  }

  // Sessions trend — current period dates on x-axis; comparison aligned by day index
  // Each item has value (current) and prev_value (comparison at same position).
  // This ensures exactly N data points per dataset with no date mixing.
  const sessionsTrend = currentDaily.map((row, i) => ({
    date:       fmtDate(row),
    value:      row.sessions || 0,
    prev_value: prevDaily[i] ? (prevDaily[i].sessions || 0) : 0,
  }))

  const revenueTrend = currentDaily.map((row, i) => ({
    date:       fmtDate(row),
    value:      row.purchaseRevenue || 0,
    prev_value: prevDaily[i] ? (prevDaily[i].purchaseRevenue || 0) : 0,
  }))

  // Affiliate leaderboard — current period only (prevents duplicates in comparison mode)
  const affiliates = currentAff.map(row => ({
    affiliateId:     row.sessionSource,
    name:            resolveAffiliateName(row.sessionSource),
    promotionMethod: resolvePromotionMethod(row.sessionSource),
    sessions:        row.sessions || 0,
    bookings:        row.transactions || 0,
    revenue:         parseFloat((row.purchaseRevenue || 0).toFixed(2)),
    convRate:        row.sessions > 0 ? parseFloat(((row.transactions || 0) / row.sessions).toFixed(6)) : 0,
    aov:             parseFloat((row.averagePurchaseRevenue || 0).toFixed(2)),
    // Engagement quality metrics — same formulas as Traffic & Scorecard
    engagedSessions: row.engagedSessions || 0,
    engagementRate:  row.sessions > 0 ? parseFloat(((row.engagedSessions || 0) / row.sessions).toFixed(4)) : 0,
    bounceRate:      row.sessions > 0 ? parseFloat((1 - (row.engagedSessions || 0) / row.sessions).toFixed(4)) : 0,
    avgDuration:     parseFloat((row.averageSessionDuration || 0).toFixed(1)),
    pagesPerSession: row.sessions > 0 ? parseFloat(((row.screenPageViews || 0) / row.sessions).toFixed(1)) : 0,
    newUsers:        row.newUsers || 0,
  }))

  const topBySession = [...affiliates].sort((a, b) => b.sessions  - a.sessions ).slice(0, 10)
  const topByConv    = [...affiliates].sort((a, b) => b.convRate  - a.convRate  ).slice(0, 10)

  return {
    kpis: {
      sessions: { value: totals.sessions, prev: prev.sessions },
      bookings:  { value: totals.bookings, prev: prev.bookings },
      revenue:   { value: totals.revenue,  prev: prev.revenue  },
      convRate:  { value: totals.convRate, prev: prev.convRate },
      aov:       { value: totals.aov,      prev: prev.aov      },
    },
    sessionsTrend,
    revenueTrend,
    topBySession,
    topByConv,
    affiliates,
  }
}

function transformTraffic(reports, commercialReports = null) {
  // reports[0] = current period daily trend (currentOnlyParams)
  // reports[1] = current period per-affiliate (canonical metrics, currentOnlyParams)
  // reports[2] = current period country breakdown (currentOnlyParams)
  // reports[3] = current period device breakdown (currentOnlyParams)
  // reports[4] = current period landing pages (currentOnlyParams)
  // reports[5] = comparison period per-affiliate (prevOnlyParams, may be absent)
  // reports[6] = comparison period daily trend (prevOnlyParams, may be absent)
  const [dailyRaw, affiliateRaw, countryRaw, deviceRaw, landingRaw, prevAffRaw, prevDailyRaw] = reports

  // All reports are single-period (currentOnlyParams / prevOnlyParams) — no dateRange tag filtering needed.
  // Sort daily by date ascending.
  const currentDaily = [...(dailyRaw ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  const prevDaily    = [...(prevDailyRaw ?? [])].sort((a, b) => a.date.localeCompare(b.date))

  const currentAff = affiliateRaw ?? []
  const prevAff    = prevAffRaw    ?? []

  // FIX: KPI precision — manual summation math instead of relying on averaged daily rates
  const totals = currentAff.reduce((acc, row) => {
    const s  = row.sessions || 0
    const es = row.engagedSessions || 0
    const d  = row.averageSessionDuration || 0
    const pv = row.screenPageViews || 0
    return {
      sessions:        acc.sessions + s,
      engagedSessions: acc.engagedSessions + es,
      durationWt:      acc.durationWt + (d * s),
      pageViews:       acc.pageViews + pv,
      newUsers:        acc.newUsers + (row.newUsers || 0),
    }
  }, { sessions: 0, engagedSessions: 0, durationWt: 0, pageViews: 0, newUsers: 0 })

  const avgEngagementRate = totals.sessions > 0 ? totals.engagedSessions / totals.sessions : 0
  const avgDuration       = totals.sessions > 0 ? totals.durationWt      / totals.sessions : 0
  const pagesPerSession   = totals.sessions > 0 ? totals.pageViews       / totals.sessions : 0

  // Session-weighted aggregate for comparison period
  const prevTotals = prevAff.reduce((acc, row) => {
    const s  = row.sessions || 0
    const es = row.engagedSessions || 0
    const d  = row.averageSessionDuration || 0
    const pv = row.screenPageViews || 0
    return {
      sessions:        acc.sessions + s,
      engagedSessions: acc.engagedSessions + es,
      durationWt:      acc.durationWt + (d * s),
      pageViews:       acc.pageViews + pv,
    }
  }, { sessions: 0, engagedSessions: 0, durationWt: 0, pageViews: 0 })

  const prevAvgEngRate      = prevTotals.sessions > 0 ? prevTotals.engagedSessions / prevTotals.sessions : null
  const prevAvgDuration     = prevTotals.sessions > 0 ? prevTotals.durationWt      / prevTotals.sessions : null
  const prevPagesPerSession = prevTotals.sessions > 0 ? prevTotals.pageViews       / prevTotals.sessions : null

  // Commercial conv-rate data joined per affiliate — report[1] is already current-only
  const commRaw     = commercialReports?.[1] ?? []
  const commCurrent = commRaw
  const commPrev    = commercialReports?.[4] ?? []
  const commMap     = new Map(commCurrent.map(r => [String(r.sessionSource ?? '').trim().toLowerCase(), r]))
  const commPrevMap = new Map(commPrev.map(r => [String(r.sessionSource ?? '').trim().toLowerCase(), r]))

  // FIX 3: prev-period affiliate map for WoW; hasPrevAff=false means comparison is 'off'
  const hasPrevAff = prevAff.length > 0
  const prevAffMap = new Map(prevAff.map(r => [String(r.sessionSource ?? '').trim().toLowerCase(), r]))

  const affiliates = currentAff.map(row => {
    const sessions     = row.sessions || 0
    const affiliateKey = String(row.sessionSource ?? '').trim().toLowerCase()

    // FIX 2: consistent trimmed key for conv rate lookup
    const comm         = commMap.get(affiliateKey)
    const transactions = comm?.transactions ?? 0
    const convRate     = sessions > 0 ? transactions / sessions : 0

    // Manual recalculation using straight math to avoid GA4's pre-averaging issues
    const engagedSessions = row.engagedSessions || 0
    const engagementRate  = sessions > 0 ? engagedSessions / sessions : 0
    const bounceRate      = sessions > 0 ? 1 - engagementRate : 0
    
    // Exact mapping requested for leaderboard
    const avgDuration = row.averageSessionDuration || 0

    // FIX 1: per-affiliate pages/session — screenPageViews naturally fetched in edge fn
    const screenPageViews = row.screenPageViews || 0
    const pagesPerSession = sessions > 0 ? parseFloat((screenPageViews / sessions).toFixed(1)) : 0

    // FIX 3: WoW delta — null=comparison off (dash), 'NEW'=new affiliate, fractional=normal
    const prevRow      = prevAffMap.get(affiliateKey)
    const prevSessions = prevRow ? (prevRow.sessions || 0) : null
    const wowSessions  = !hasPrevAff
      ? null
      : prevSessions !== null
        ? prevSessions > 0 ? (sessions - prevSessions) / prevSessions : (sessions > 0 ? null : 0)
        : 'NEW'

    // Compute previous metrics for scorecard-style table
    const prevTransactions = commPrevMap.get(affiliateKey)?.transactions ?? 0
    const prevConvRate = prevSessions > 0 ? prevTransactions / prevSessions : null
    const prevEngagedSessions = prevRow ? (prevRow.engagedSessions || 0) : null
    const prevEngRate = prevSessions > 0 ? prevEngagedSessions / prevSessions : null
    const prevBounceRate = prevEngRate !== null ? 1 - prevEngRate : null
    const prevAvgDuration = prevRow ? (prevRow.averageSessionDuration || 0) : null
    const prevScreenPageViews = prevRow ? (prevRow.screenPageViews || 0) : null
    const prevPagesPerSession = prevSessions > 0 ? parseFloat((prevScreenPageViews / prevSessions).toFixed(1)) : null

    return {
      affiliateId:     row.sessionSource,
      name:            resolveAffiliateName(row.sessionSource),
      promotionMethod: resolvePromotionMethod(row.sessionSource),
      sessions,
      engagedSessions,
      engagementRate:  parseFloat(engagementRate.toFixed(4)),
      avgDuration:     parseFloat(avgDuration.toFixed(1)),
      bounceRate:      parseFloat(bounceRate.toFixed(4)),
      newUsers:        row.newUsers || 0,
      // Fix 3: activeUsers not in canonical metrics — compute returningUsers as sessions - newUsers
      returningUsers:  Math.max(0, sessions - (row.newUsers || 0)),
      convRate,
      pagesPerSession,
      wowSessions,
      prevSessions,
      prevConvRate,
      prevEngRate,
      prevBounceRate,
      prevAvgDuration,
      prevPagesPerSession,
    }
  })

  // Dual Y-axis: include awin, then top 4 others with >= 30 sessions
  const awinRow = affiliates.find(a => a.affiliateId.toLowerCase().includes('awin'))
  const topOthers = affiliates
    .filter(a => !a.affiliateId.toLowerCase().includes('awin') && a.sessions >= 30)
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 4)

  const selectedForTrend = []
  if (awinRow) selectedForTrend.push(awinRow)
  selectedForTrend.push(...topOthers)

  const totalSessionsForScale = totals.sessions || 1
  const prevTotalSessionsForScale = prevTotals.sessions || 1

  const sessionsTrends = selectedForTrend.map(aff => {
    const scale = aff.sessions / totalSessionsForScale
    const prevScale = (aff.prevSessions || 0) / prevTotalSessionsForScale
    return {
      affiliateId:     aff.affiliateId,
      name:            aff.name,
      promotionMethod: aff.promotionMethod,
      data: currentDaily.map(row => ({
        date:  `${row.date.slice(0,4)}-${row.date.slice(4,6)}-${row.date.slice(6,8)}`,
        value: Math.round((row.sessions || 0) * scale),
      })),
      prevData: prevDaily.map(row => ({
        date:  `${row.date.slice(0,4)}-${row.date.slice(4,6)}-${row.date.slice(6,8)}`,
        value: Math.round((row.sessions || 0) * prevScale),
      }))
    }
  })

  const countryData = (countryRaw ?? []).map(row => ({
    country:  row.country,
    sessions: row.sessions || 0,
  }))

  const byDevice = {}
  ;(deviceRaw ?? []).forEach(row => { byDevice[row.deviceCategory] = row.sessions || 0 })
  const totalDeviceSessions = Object.values(byDevice).reduce((s, v) => s + v, 0)

  const byEngagement = [...affiliates].sort((a, b) => b.engagementRate - a.engagementRate)

  // Real daily new users — now that edge function daily report includes newUsers metric
  const newUsersTrend = currentDaily.map(row => ({
    date:  `${row.date.slice(0,4)}-${row.date.slice(4,6)}-${row.date.slice(6,8)}`,
    value: row.newUsers || 0,
  }))
  const newUsersTrendPrev = prevDaily.length > 0
    ? prevDaily.map(row => ({
        date:  `${row.date.slice(0,4)}-${row.date.slice(4,6)}-${row.date.slice(6,8)}`,
        value: row.newUsers || 0,
      }))
    : null

  // IMPROVEMENT 1: Landing pages (from report[4] when edge function is deployed)
  const landingPages = (landingRaw ?? [])
    .filter(row => {
      const p = row.landingPage || ''
      return p !== '(not set)' && 
             p !== '' && 
             !p.includes('/user-dashboard/view/') && 
             !p.includes('{{')
    })
    .map(row => {
      const sessions = row.sessions || 0
      const engagedSessions = row.engagedSessions || 0
      const screenPageViews = row.screenPageViews || 0
      const averageSessionDuration = row.averageSessionDuration || 0
      const transactions = row.transactions || 0

      const engagementRate  = sessions > 0 ? (engagedSessions / sessions) * 100 : 0
      const convRate        = sessions > 0 ? (transactions / sessions) * 100 : 0
      const pagesPerSession = sessions > 0 ? parseFloat((screenPageViews / sessions).toFixed(1)) : 0

      return {
        path:           row.landingPage,
        sessions,
        engagementRate,
        convRate,
        averageSessionDuration,
        pagesPerSession
      }
    })

  return {
    kpis: {
      engagedSessions: {
        value: totals.engagedSessions,
        prev:  prevTotals.engagedSessions > 0 ? prevTotals.engagedSessions : totals.engagedSessions * 0.9,
      },
      engagementRate: {
        value: avgEngagementRate,
        prev:  prevAvgEngRate ?? avgEngagementRate * 0.95,
      },
      avgDuration: {
        value: avgDuration,
        prev:  prevAvgDuration ?? avgDuration * 0.93,
      },
      pagesPerSession: {
        value: parseFloat(pagesPerSession.toFixed(1)),
        prev:  prevPagesPerSession != null ? parseFloat(prevPagesPerSession.toFixed(1)) : null,
      },
    },
    sessionsTrends,
    byEngagement,
    countryData,
    newUsersTrend,
    newUsersTrendPrev,
    landingPages,
    affiliates: affiliates.map(a => ({
      ...a,
      mobile:  Math.round(a.sessions * ((byDevice.mobile  || 0) / Math.max(totalDeviceSessions, 1))),
      desktop: Math.round(a.sessions * ((byDevice.desktop || 0) / Math.max(totalDeviceSessions, 1))),
      tablet:  Math.round(a.sessions * ((byDevice.tablet  || 0) / Math.max(totalDeviceSessions, 1))),
    })),
  }
}


function transformCommercial(reports, filters) {
  // reports[0] = current period daily trend (currentOnlyParams)
  // reports[1] = current period per-affiliate (canonical metrics, currentOnlyParams)
  // reports[2] = current period country bookings (currentOnlyParams)
  // reports[3] = comparison period daily trend (prevOnlyParams, may be absent)
  // reports[4] = comparison period per-affiliate (prevOnlyParams, may be absent)
  // reports[5] = comparison period country bookings (prevOnlyParams, may be absent)
  const currentDaily   = [...(reports[0] ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  const currentAffRaw  = reports[1] ?? []
  const countryReport  = reports[2] ?? []
  const prevDaily      = [...(reports[3] ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  const prevAffRaw     = reports[4] ?? []

  const totals = currentAffRaw.reduce((acc, row) => ({
    sessions: acc.sessions + (row.sessions || 0),
    bookings: acc.bookings + (row.transactions || 0),
    revenue: acc.revenue + (row.purchaseRevenue || 0),
  }), { sessions: 0, bookings: 0, revenue: 0 })

  const prevTotals = prevAffRaw.reduce((acc, row) => ({
    sessions: acc.sessions + (row.sessions || 0),
    bookings: acc.bookings + (row.transactions || 0),
    revenue: acc.revenue + (row.purchaseRevenue || 0),
  }), { sessions: 0, bookings: 0, revenue: 0 })

  totals.convRate = totals.sessions > 0 ? totals.bookings / totals.sessions : 0
  totals.aov = totals.bookings > 0 ? totals.revenue / totals.bookings : 0
  totals.revenuePerSession = totals.sessions > 0 ? totals.revenue / totals.sessions : 0

  prevTotals.convRate = prevTotals.sessions > 0 ? prevTotals.bookings / prevTotals.sessions : 0
  prevTotals.aov = prevTotals.bookings > 0 ? prevTotals.revenue / prevTotals.bookings : 0
  prevTotals.revenuePerSession = prevTotals.sessions > 0 ? prevTotals.revenue / prevTotals.sessions : 0

  const convTrend = currentDaily.map((row, i) => ({
    date: `${row.date.slice(0,4)}-${row.date.slice(4,6)}-${row.date.slice(6,8)}`,
    sessions: row.sessions || 0,
    transactions: row.transactions || 0,
    prevSessions: prevDaily[i]?.sessions || 0,
    prevTransactions: prevDaily[i]?.transactions || 0,
  }))

  const dailyRevenue = currentDaily.map((row, i) => ({
    date: `${row.date.slice(0,4)}-${row.date.slice(4,6)}-${row.date.slice(6,8)}`,
    revenue: (row.purchaseRevenue || 0),
    prevRevenue: prevDaily[i]?.purchaseRevenue || 0,
  }))

  const dailyBookings = currentDaily.map((row, i) => ({
    date: `${row.date.slice(0,4)}-${row.date.slice(4,6)}-${row.date.slice(6,8)}`,
    bookings: (row.transactions || 0),
    prevBookings: prevDaily[i]?.transactions || 0,
  }))

  // Create lookup map for comparison data
  const prevAffMap = new Map(prevAffRaw.map(r => [String(r.sessionSource ?? '').trim().toLowerCase(), r]))

  const affiliates = currentAffRaw.map(row => {
    const sourceKey = row.sessionSource
    const id = String(sourceKey ?? '').trim().toLowerCase()
    const prevRow = prevAffMap.get(id) || {}

    const sessions = row.sessions || 0
    const bookings = row.transactions || 0
    const revenue = row.purchaseRevenue || 0
    const convRate = sessions > 0 ? bookings / sessions : 0
    const aov = row.averagePurchaseRevenue || 0
    // Fix 1: Compute engagementRate manually as engagedSessions/sessions (same as Traffic & Scorecard)
    // Do NOT use raw row.engagementRate — GA4 pre-averages this field, causing inconsistency.
    const engagedSessions = row.engagedSessions || 0
    const engagementRate = sessions > 0 ? engagedSessions / sessions : 0
    const healthScore = computeHealthScore({ engagementRate, convRate, sessions, bookings })

    const prevSessions = prevRow.sessions || 0
    const prevBookings = prevRow.transactions || 0
    const prevRevenue = prevRow.purchaseRevenue || 0
    const prevConvRate = prevSessions > 0 ? prevBookings / prevSessions : 0
    const prevAov = prevRow.averagePurchaseRevenue || 0

    return {
      affiliateId: sourceKey,
      name: resolveAffiliateName(sourceKey),
      promotionMethod: resolvePromotionMethod(sourceKey),
      sessions, bookings, revenue: parseFloat(revenue.toFixed(2)),
      convRate: parseFloat(convRate.toFixed(4)),
      aov: parseFloat(aov.toFixed(2)),
      engagedSessions,
      engagementRate: parseFloat(engagementRate.toFixed(4)),
      
      prevSessions, prevBookings, prevRevenue,
      prevConvRate: parseFloat(prevConvRate.toFixed(4)),
      prevAov: parseFloat(prevAov.toFixed(2)),
      
      revenuePerSession: sessions > 0 ? parseFloat((revenue / sessions).toFixed(2)) : 0,
      prevRevenuePerSession: prevSessions > 0 ? parseFloat((prevRevenue / prevSessions).toFixed(2)) : 0,
      wowRevenue: prevRevenue > 0 ? (revenue - prevRevenue) / prevRevenue : (revenue > 0 ? null : 0),
      healthScore,
    }
  })

  // Hide 0 revenue & 0 booking affiliates from charts
  const chartEligible = affiliates.filter(a => a.revenue > 0 || a.bookings > 0)
  
  const byConvRate = [...chartEligible].sort((a, b) => b.convRate - a.convRate)
  const byAov = [...chartEligible].sort((a, b) => b.aov - a.aov)

  const top5Revenue = [...chartEligible].sort((a, b) => b.revenue - a.revenue).slice(0, 5)
  const otherRevenue = [...chartEligible].sort((a, b) => b.revenue - a.revenue).slice(5).reduce((s, a) => s + a.revenue, 0)
  const revenueSplit = [
    ...top5Revenue.map(a => ({ name: a.name || a.affiliateId, value: a.revenue })),
    ...(otherRevenue > 0 ? [{ name: 'Other', value: otherRevenue }] : [])
  ]

  const countryData = countryReport.map(row => ({
    country: row.country,
    bookings: row.transactions || 0,
    revenue: parseFloat((row.purchaseRevenue || 0).toFixed(2)),
  }))

  return {
    kpis: {
      revenue:  { value: totals.revenue,  prev: prevTotals.revenue },
      bookings: { value: totals.bookings, prev: prevTotals.bookings },
      convRate: { value: totals.convRate, prev: prevTotals.convRate },
      aov:      { value: totals.aov,      prev: prevTotals.aov },
    },
    convTrend,
    dailyRevenue,
    dailyBookings,
    byConvRate,
    byAov,
    countryData,
    revenueSplit,
    affiliates,
    totals,
    prevTotals,
  }
}

function transformFunnel(reports, filters) {
  const [dailyReport, affiliateEventReport, dailyEventReport, prevDailyReportRaw, affiliateSessionReport] = reports

  // dailyReport is now current-period only (uses currentOnlyParams in edge fn).
  // No dateRange tag filtering needed — all rows are current period.
  const currStart = (filters?.dateRanges?.primary?.startDate || '').replace(/-/g, '') // "YYYYMMDD"
  const currEnd   = (filters?.dateRanges?.primary?.endDate   || '').replace(/-/g, '')

  const inCurrentPeriod = (r) => {
    if (r.dateRange === 'date_range_1') return false            // safety: drop any prev-period rows
    if (r.date && currStart && currEnd)
      return r.date >= currStart && r.date <= currEnd
    return true                                                 // no date dim → include
  }

  const currentDaily      = dailyReport.filter(inCurrentPeriod)
  // previous daily now comes from dedicated report[3] rather than filtered `date_range_1` rows
  const prevDailyReport   = (prevDailyReportRaw ?? [])

  // report[1] uses commonParams so GA4 injects dateRange tags.
  // Rows with no dateRange tag (single-period requests) are treated as current period.
  const isCurrentAffRow = r => !r.dateRange || r.dateRange === 'date_range_0'
  const isPrevAffRow    = r => r.dateRange === 'date_range_1'
  const currentAffEvent   = affiliateEventReport.filter(isCurrentAffRow)
  const prevAffEvent      = affiliateEventReport.filter(isPrevAffRow)

  const currentDailyEvent = dailyEventReport.filter(inCurrentPeriod)

  // Total sessions — use per-affiliate report[4] which is the same source used by
  // Traffic & Commercial dashboards, guaranteeing identical session totals across all dashboards.
  // Fall back to daily sum if the affiliate sessions report is unavailable.
  const affSessionSum = (affiliateSessionReport ?? []).reduce((s, r) => s + (r.sessions || 0), 0)
  const dailySum      = currentDaily.reduce((s, r) => s + (r.sessions || 0), 0)
  const totalSessions     = affSessionSum > 0 ? affSessionSum : dailySum
  const prevTotalSessions = prevDailyReport.reduce((s, r) => s + (r.sessions || 0), 0)

  // Aggregate events by name across all affiliates (current period)
  const eventTotals = {}
  currentAffEvent.forEach(row => {
    const en = row.eventName
    if (!eventTotals[en]) eventTotals[en] = 0
    eventTotals[en] += (row.eventCount || 0)
  })

  // Comparison period event totals for the Booking Funnel grey overlay bars
  const prevEventTotals = {}
  prevAffEvent.forEach(row => {
    const en = row.eventName
    if (!prevEventTotals[en]) prevEventTotals[en] = 0
    prevEventTotals[en] += (row.eventCount || 0)
  })

  const formSubmit    = eventTotals['form_submit']          || 0
  const vsr           = eventTotals['view_search_results']  || 0
  const beginCheckout = eventTotals['begin_checkout']       || 0
  const purchases     = eventTotals['purchase']             || 0
  const paymentFail   = eventTotals['payment_failure']      || 0
  const checkout      = Math.floor(beginCheckout * 0.7) // approximate

  const s = totalSessions || 1
  const funnelSteps = [
    { label: 'Sessions',            value: totalSessions,  pct: 100 },
    { label: 'View Search Results', value: vsr,            pct: parseFloat(((vsr           / s) * 100).toFixed(1)) },
    { label: 'Form Submit',         value: formSubmit,     pct: parseFloat(((formSubmit    / s) * 100).toFixed(1)) },
    { label: 'Begin Checkout',      value: beginCheckout,  pct: parseFloat(((beginCheckout / s) * 100).toFixed(1)) },
    { label: 'Checkout',            value: checkout,       pct: parseFloat(((checkout      / s) * 100).toFixed(1)) },
    { label: 'Purchase',            value: purchases,      pct: parseFloat(((purchases     / s) * 100).toFixed(1)) },
  ].map(step => {
    if (!prevAffEvent.length) return step

    let prevVal = 0
    if      (step.label === 'Sessions')            prevVal = prevTotalSessions
    else if (step.label === 'View Search Results') prevVal = prevEventTotals['view_search_results'] || 0
    else if (step.label === 'Form Submit')         prevVal = prevEventTotals['form_submit']         || 0
    else if (step.label === 'Begin Checkout')      prevVal = prevEventTotals['begin_checkout']      || 0
    else if (step.label === 'Checkout')            prevVal = Math.floor((prevEventTotals['begin_checkout'] || 0) * 0.7)
    else if (step.label === 'Purchase')            prevVal = prevEventTotals['purchase']            || 0

    return { ...step, prevValue: prevVal, prevPct: parseFloat(((prevVal / (prevTotalSessions || 1)) * 100).toFixed(1)) }
  })

  // Funnel trend — build from unique dates in currentDaily only (date_range_0)
  const stageMap = { 'Sessions': {}, 'Begin Checkout': {}, 'Purchase': {} }
  // Use a Set to deduplicate dates (GA4 can return dupes if sessions + events overlap)
  const trendDates = [...new Set(
    currentDaily.map(r => `${r.date.slice(0,4)}-${r.date.slice(4,6)}-${r.date.slice(6,8)}`)
  )].sort()

  currentDaily.forEach(row => {
    const date = `${row.date.slice(0,4)}-${row.date.slice(4,6)}-${row.date.slice(6,8)}`
    stageMap['Sessions'][date] = (stageMap['Sessions'][date] || 0) + (row.sessions || 0)
  })
  currentDailyEvent.forEach(row => {
    const date = `${row.date.slice(0,4)}-${row.date.slice(4,6)}-${row.date.slice(6,8)}`
    if (row.eventName === 'begin_checkout')
      stageMap['Begin Checkout'][date] = (stageMap['Begin Checkout'][date] || 0) + (row.eventCount || 0)
    if (row.eventName === 'purchase')
      stageMap['Purchase'][date] = (stageMap['Purchase'][date] || 0) + (row.eventCount || 0)
  })

  const funnelTrend = Object.entries(stageMap).map(([stage, dayMap]) => ({
    stage,
    data: trendDates.map(dateStr => ({ date: dateStr, value: dayMap[dateStr] || 0 }))
  }))

  // Per-affiliate checkout funnel — FIX: min beginCheckout >= 3, completionRate capped at 100%
  const affMap = {}
  currentAffEvent.forEach(row => {
    const id = String(row.sessionSource || '').trim()
    if (!id) return
    if (!affMap[id]) affMap[id] = { affiliateId: id, viewSearchResults: 0, formSubmit: 0, beginCheckout: 0, purchases: 0, paymentFailure: 0, prevBeginCheckout: 0, prevPurchases: 0 }
    if (row.eventName === 'view_search_results') affMap[id].viewSearchResults += (row.eventCount || 0)
    if (row.eventName === 'form_submit')         affMap[id].formSubmit         += (row.eventCount || 0)
    if (row.eventName === 'begin_checkout')      affMap[id].beginCheckout      += (row.eventCount || 0)
    if (row.eventName === 'purchase')            affMap[id].purchases           += (row.eventCount || 0)
    if (row.eventName === 'payment_failure')     affMap[id].paymentFailure      += (row.eventCount || 0)
  })

  // Map previous period events into the same object to support UI comparisons
  prevAffEvent.forEach(row => {
    const id = String(row.sessionSource || '').trim()
    if (!id) return
    if (!affMap[id]) affMap[id] = { affiliateId: id, viewSearchResults: 0, formSubmit: 0, beginCheckout: 0, purchases: 0, paymentFailure: 0, prevBeginCheckout: 0, prevPurchases: 0 }
    
    // Safety check for keys if the object was created during current-iteration before I added prev keys universally above
    if (affMap[id].prevBeginCheckout === undefined) affMap[id].prevBeginCheckout = 0
    if (affMap[id].prevPurchases === undefined)     affMap[id].prevPurchases = 0

    if (row.eventName === 'begin_checkout') affMap[id].prevBeginCheckout += (row.eventCount || 0)
    if (row.eventName === 'purchase')       affMap[id].prevPurchases     += (row.eventCount || 0)
  })

  const affiliateCheckoutDrop = Object.values(affMap)
    .filter(a => a.beginCheckout >= 3)   // FIX 3: min 3 checkouts for statistical validity
    .map(a => {
      const rawDrop = ((a.beginCheckout - a.purchases) / a.beginCheckout) * 100
      const dropOffRate    = Math.min(Math.max(rawDrop, 0), 100)          // cap 0–100
      const completionRate = Math.min((a.purchases / a.beginCheckout) * 100, 100) // cap at 100
      return { ...a, dropOffRate, completionRate }
    })

  // Export the raw affMap so the JSX can join sessions per affiliate for type grouping
  const affiliateSessionMap = affMap

  // FIX 4: Payment failure by device cleanly mapped to current Daily Dates
  const paymentFailDayMap = { mobile: {}, desktop: {} }
  currentDailyEvent.forEach(row => {
    if (row.eventName === 'payment_failure') {
      const date = `${row.date.slice(0,4)}-${row.date.slice(4,6)}-${row.date.slice(6,8)}`
      const device = (row.deviceCategory || '').toLowerCase()
      if (device === 'mobile') paymentFailDayMap.mobile[date] = (paymentFailDayMap.mobile[date] || 0) + (row.eventCount || 0)
      else if (device === 'desktop') paymentFailDayMap.desktop[date] = (paymentFailDayMap.desktop[date] || 0) + (row.eventCount || 0)
    }
  })
  
  const paymentFailTrend = {
    mobile: currentDaily.map(row => {
      const date = `${row.date.slice(0,4)}-${row.date.slice(4,6)}-${row.date.slice(6,8)}`
      return { date, value: paymentFailDayMap.mobile[date] || 0 }
    }),
    desktop: currentDaily.map(row => {
      const date = `${row.date.slice(0,4)}-${row.date.slice(4,6)}-${row.date.slice(6,8)}`
      return { date, value: paymentFailDayMap.desktop[date] || 0 }
    })
  }

  const checkoutToConv = beginCheckout > 0 ? parseFloat((purchases / beginCheckout).toFixed(4)) : 0

  return {
    kpis: {
      evtBeginCheckout:   { value: beginCheckout,  prev: prevEventTotals['begin_checkout']     || beginCheckout  * 0.88 },
      checkoutToPurchase: { value: checkoutToConv, prev: checkoutToConv * 0.95 },
      evtViewSearch:      { value: vsr,            prev: prevEventTotals['view_search_results'] || vsr            * 0.9  },
      evtPaymentFail:     { value: paymentFail,    prev: prevEventTotals['payment_failure']     || paymentFail    * 0.85 },
    },
    funnelSteps,
    funnelTrend,
    affiliateCheckoutDrop,
    affiliateSessionMap,   // raw per-affiliate event data for type grouping in JSX
    affiliateSessions: affiliateSessionReport ?? [],  // canonical per-affiliate sessions (report[4], currentOnlyParams)
    paymentFailTrend,
  }
}

function computeHealthScore(aff) {
  // engagementRate: 0-1 → scale to 0-100. Missing = use 0.
  const engScore   = Math.min((aff.engagementRate || 0) * 100, 100) * 0.25

  // convRate: 5% = 100pts, linear scale. (convRate * 2000 caps at 100)
  const convScore  = Math.min((aff.convRate || 0) * 2000, 100) * 0.35

  // wowSessions: +20% → 100pts, 0% → 50pts, -20% → 0pts
  // Formula: clamp((wow + 0.20) / 0.40, 0, 1) * 100
  const wowS = aff.wowSessions != null
    ? Math.min(Math.max(((aff.wowSessions + 0.20) / 0.40), 0), 1) * 100
    : 50 // neutral when not available
  const wowSScore  = wowS * 0.20

  // wowRevenue: same scale as wowSessions
  const wowR = aff.wowRevenue != null
    ? Math.min(Math.max(((aff.wowRevenue + 0.20) / 0.40), 0), 1) * 100
    : 50 // neutral when not available
  const wowRScore  = wowR * 0.20

  return Math.min(100, Math.round(engScore + convScore + wowSScore + wowRScore))
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function getExecutiveSummary(propertyId, filters) {
  if (MOCK_MODE) return getMockExecutiveSummary(propertyId, filters)
  // Fetch trend data (executive) and KPI/affiliate data (scorecard) in parallel.
  // KPIs are sourced from the scorecard query — the same query used by the
  // Affiliate Scorecard page — so both dashboards always show identical totals.
  const [execReports, scorecardReports] = await Promise.all([
    callGA4('executive', propertyId, filters),
    callGA4('scorecard', propertyId, filters),
  ])
  return transformExecutive(execReports, scorecardReports)
}

export async function getTrafficEngagement(propertyId, filters) {
  if (MOCK_MODE) return getMockTrafficEngagement(propertyId, filters)
  // Fetch traffic data (engagement) and commercial data (transactions) in parallel.
  // Commercial data is merged per-affiliate for conv rate (Fix 3).
  const [trafficReports, commercialReports] = await Promise.all([
    callGA4('traffic', propertyId, filters),
    callGA4('commercial', propertyId, filters),
  ])
  return transformTraffic(trafficReports, commercialReports)
}

export async function getCommercialPerformance(propertyId, filters) {
  if (MOCK_MODE) return getMockCommercialPerformance(propertyId, filters)
  const reports = await callGA4('commercial', propertyId, filters)
  return transformCommercial(reports, filters)
}

export async function getFunnelAnalysis(propertyId, filters) {
  if (MOCK_MODE) return getMockFunnelAnalysis(propertyId, filters)
  const reports = await callGA4('funnel', propertyId, filters)
  return transformFunnel(reports, filters)
}

// Dedicated scorecard query — limit 250, sessionMedium=affiliates enforced in Edge Function
// Returns { current: GA4Row[], comparison: GA4Row[]|null }
export async function getAffiliateScorecard(propertyId, filters) {
  if (MOCK_MODE) {
    const exec = await getMockExecutiveSummary(propertyId, filters)
    return { current: exec.affiliates ?? [], comparison: null }
  }
  const reports = await callGA4('scorecard', propertyId, filters)
  return {
    current:    reports[0] ?? [],
    comparison: reports[1] ?? null,   // null when comparison is 'off' or no second dateRange
  }
}

// ─── Destination Intelligence ─────────────────────────────────────────────────

function transformDestinations(reports, affiliateMapping) {
  const rawRows = reports[0] || []

  const isAffiliate = (id) => id === 'awin' || /^\d+$/.test(String(id))
  const currAffRows = rawRows.filter(r => isAffiliate(r.sessionSource))

  const extractDestination = (path) => {
    if (!path || path === '(not set)') return null
    const skipPaths = [
      '/en/booking', '/en/user-dashboard',
      '/en/search-results', '/en/agents',
      '/en/booking-details', '/de', '/fr',
      '/es', '/it', '/en/discover',
    ]
    if (skipPaths.some(s => path.startsWith(s))) return null
    if (path === '/en' || path === '/') {
      return { destination: 'Homepage', country: null }
    }
    const parts = path.replace(/^\/en\//, '').split('/')
    if (parts.length >= 2) {
      const country = parts[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      const destination = parts[1]
        .replace(/-intl-airport|-airport|-international/g, '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim()
      return { destination, country }
    }
    if (parts.length === 1 && parts[0]) {
      const country = parts[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      return { destination: country + ' (country)', country }
    }
    return null
  }

  const affiliateMap = new Map()

  currAffRows.forEach(row => {
    const affId = String(row.sessionSource).trim()
    const dest = extractDestination(row.landingPage)
    if (!dest) return

    if (!affiliateMap.has(affId)) {
      affiliateMap.set(affId, {
        affiliateId: affId,
        affiliateName: affiliateMapping[affId]?.name || affId,
        affiliateType: affiliateMapping[affId]?.type || 'N/A',
        totalSessions: 0,
        totalBookings: 0,
        totalRevenue: 0,
        destinations: new Map(),
      })
    }

    const aff = affiliateMap.get(affId)
    aff.totalSessions += row.sessions || 0
    aff.totalBookings += row.transactions || 0
    aff.totalRevenue += row.purchaseRevenue || 0

    const destKey = dest.destination
    if (!aff.destinations.has(destKey)) {
      aff.destinations.set(destKey, {
        destination: dest.destination,
        country: dest.country,
        sessions: 0, bookings: 0, revenue: 0, engagedSessions: 0,
        isHomepage: dest.destination === 'Homepage',
      })
    }
    const d = aff.destinations.get(destKey)
    d.sessions += row.sessions || 0
    d.bookings += row.transactions || 0
    d.revenue += row.purchaseRevenue || 0
    d.engagedSessions += row.engagedSessions || 0
  })

  const affiliates = Array.from(affiliateMap.values())
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, 10)
    .map(aff => ({
      ...aff,
      destinations: Array.from(aff.destinations.values())
        .sort((a, b) => b.revenue - a.revenue)
        .map(d => ({
          ...d,
          convRate: d.sessions > 0 ? (d.bookings / d.sessions) * 100 : 0,
          aov: d.bookings > 0 ? d.revenue / d.bookings : 0,
          revPerSession: d.sessions > 0 ? d.revenue / d.sessions : 0,
          engagementRate: d.sessions > 0 ? (d.engagedSessions / d.sessions) * 100 : 0,
        })),
    }))

  return { affiliates }
}

export async function getDestinationIntelligence(propertyId, filters) {
  const reports = await callGA4('destinations', propertyId, filters)
  // Build a mapping from resolveAffiliateName for each unique source in the report
  const rawRows = reports[0] || []
  const affiliateMapping = {}
  const seenIds = new Set()
  rawRows.forEach(row => {
    const id = String(row.sessionSource || '').trim()
    if (id && !seenIds.has(id)) {
      seenIds.add(id)
      const name = resolveAffiliateName(id)
      affiliateMapping[id] = { name: name || id, type: resolvePromotionMethod(id) || 'N/A' }
    }
  })
  return transformDestinations(reports, affiliateMapping)
}

// Returns site-wide funnel steps (no affiliate filter) for benchmark comparison

export async function getSiteWideFunnel(propertyId, filters) {
  if (MOCK_MODE) {
    await delay(180)
    const { days } = getDateBounds(filters)
    const m = days / 30
    // Site-wide: ~3.2× more sessions, but lower funnel conversion rates
    const sSessions   = Math.round(10900 * m)
    const sVSR        = Math.round(7200  * m)
    const sFormSubmit = Math.round(5800  * m)
    const sCheckout   = Math.round(6300  * m)
    const sConv       = Math.round(4100  * m)
    const sPurchase   = Math.round(1640  * m)
    return [
      { label: 'Sessions',              value: sSessions,   pct: 100 },
      { label: 'Search Results Viewed', value: sVSR,        pct: parseFloat(((sVSR / sSessions) * 100).toFixed(1)) },
      { label: 'Search Submitted',      value: sFormSubmit, pct: parseFloat(((sFormSubmit / sSessions) * 100).toFixed(1)) },
      { label: 'Checkout Started',      value: sCheckout,   pct: parseFloat(((sCheckout / sSessions) * 100).toFixed(1)) },
      { label: 'Checkout Page',         value: sConv,       pct: parseFloat(((sConv / sSessions) * 100).toFixed(1)) },
      { label: 'Booking Completed',     value: sPurchase,   pct: parseFloat(((sPurchase / sSessions) * 100).toFixed(1)) },
    ]
  }
  // Real GA4: call without affiliate medium filter
  const reports = await callGA4('funnel', propertyId, { ...filters, affiliateFilter: 'all' })
  return transformFunnel(reports, { ...filters, affiliateFilter: 'all' }).funnelSteps
}

// ─── Mock data fallbacks (used when MOCK_MODE = true) ──────────────────────────

const AFFILIATE_IDS = [
  'skyscanner', 'kayak', 'booking.com', 'omio', 'rome2rio',
  'getyourguide', 'viator', 'tripadvisor', 'expedia', 'lastminute',
  'jet2', 'easyjet', 'ryanair', 'ba.com', 'hotels.com',
]

function rand(min, max) { return Math.random() * (max - min) + min }
function randInt(min, max) { return Math.floor(rand(min, max)) }

// Generate daily trend data over an actual date range
function generateDailyData(startDate, endDate, baseValue, variance = 0.25) {
  const days = eachDayOfInterval({ start: new Date(startDate), end: new Date(endDate) })
  return days.map(d => ({
    date: format(d, 'yyyy-MM-dd'),
    value: Math.max(0, baseValue * (1 + (Math.random() - 0.5) * variance * 2)),
  }))
}

// Generate daily trend with a prev_value (comparison series)
function generateDailyTrend(startDate, endDate, baseValue, prevBase, variance = 0.25) {
  const days = eachDayOfInterval({ start: new Date(startDate), end: new Date(endDate) })
  return days.map(d => ({
    date: format(d, 'yyyy-MM-dd'),
    value: Math.max(0, baseValue * (1 + (Math.random() - 0.5) * variance * 2)),
    prev_value: Math.max(0, prevBase * (1 + (Math.random() - 0.5) * variance * 2)),
  }))
}

// Extract the real date bounds from filters
function getDateBounds(filters) {
  const start = filters?.dateRanges?.primary?.startDate ?? format(subDays(new Date(), 30), 'yyyy-MM-dd')
  const end   = filters?.dateRanges?.primary?.endDate   ?? format(subDays(new Date(), 1),  'yyyy-MM-dd')
  const dayList = eachDayOfInterval({ start: new Date(start), end: new Date(end) })
  return { start, end, days: dayList.length }
}

// Canonical 30-day baseline for all hoppa affiliates
// bookings = round(sessions × convRate) so overall convRate = totalBookings/totalSessions ≈ correct weighted rate
const HOPPA_AFFILIATES = [
  { affiliateId: 'awin (bulk)', name: 'awin (bulk)',               promotionMethod: 'Sub Networks',   sessions: 2498, bookings: 84,  revenue: 71374, convRate: 0.0337, aov: 84.87, engagementRate: 0.663, wowSessions: 0.142, wowRevenue: 0.058, engagedSessions: 1657, avgDuration: 228, mobile: 1773, desktop: 674, tablet: 51  },
  { affiliateId: '57697',       name: 'Topcashback Ltd',           promotionMethod: 'Cashback',        sessions: 366,  bookings: 14,  revenue: 31149, convRate: 0.0391, aov: 85.11, engagementRate: 0.622, wowSessions: 0.091, wowRevenue: 0.092, engagedSessions: 228,  avgDuration: 192, mobile: 260,  desktop: 99,  tablet: 7   },
  { affiliateId: '63136',       name: 'Blue Light Card LTD',       promotionMethod: 'Loyalty',         sessions: 189,  bookings: 8,   revenue: 15556, convRate: 0.0424, aov: 91.51, engagementRate: 0.693, wowSessions: 0.064, wowRevenue: 0.087, engagedSessions: 131,  avgDuration: 241, mobile: 134,  desktop: 51,  tablet: 4   },
  { affiliateId: '71759',       name: 'Collinson Valuedynamx',     promotionMethod: 'Loyalty',         sessions: 82,   bookings: 3,   revenue: 7553,  convRate: 0.0417, aov: 76.29, engagementRate: 0.756, wowSessions: -0.047, wowRevenue: -0.014, engagedSessions: 62, avgDuration: 262, mobile: 58,   desktop: 22,  tablet: 2   },
  { affiliateId: '313605',      name: 'Brandreward - Incentivized',promotionMethod: 'Sub Networks',   sessions: 227,  bookings: 6,   revenue: 5421,  convRate: 0.0281, aov: 84.70, engagementRate: 0.626, wowSessions: 0.091, wowRevenue: 0.073, engagedSessions: 142,  avgDuration: 185, mobile: 161,  desktop: 61,  tablet: 5   },
  { affiliateId: '264419',      name: 'FlexOffers.com, LLC',       promotionMethod: 'Sub Networks',   sessions: 144,  bookings: 3,   revenue: 2628,  convRate: 0.0215, aov: 84.77, engagementRate: 0.604, wowSessions: 0.220, wowRevenue: 0.181, engagedSessions: 87,   avgDuration: 174, mobile: 102,  desktop: 39,  tablet: 3   },
  { affiliateId: '412875',      name: '412875',                    promotionMethod: 'N/A',             sessions: 51,   bookings: 2,   revenue: 1527,  convRate: 0.0353, aov: 84.83, engagementRate: 0.745, wowSessions: 0.032, wowRevenue: 0.021, engagedSessions: 38,   avgDuration: 255, mobile: 36,   desktop: 14,  tablet: 1   },
  { affiliateId: '321967',      name: '321967',                    promotionMethod: 'N/A',             sessions: 64,   bookings: 2,   revenue: 1700,  convRate: 0.031,  aov: 85.0,  engagementRate: 0.641, wowSessions: 0.123, wowRevenue: 0.050, engagedSessions: 41,   avgDuration: 185, mobile: 45,   desktop: 17,  tablet: 2   },
  { affiliateId: '282949',      name: 'Atolls UK',                 promotionMethod: 'Discount Code', sessions: 31,   bookings: 1,   revenue: 765,   convRate: 0.030,  aov: 85.0,  engagementRate: 0.581, wowSessions: -0.081, wowRevenue: -0.040, engagedSessions: 18, avgDuration: 161, mobile: 22,   desktop: 8,   tablet: 1   },
  { affiliateId: '1543081',     name: 'ConvertSocial FZ-LLC',      promotionMethod: 'Sub Networks',   sessions: 43,   bookings: 1,   revenue: 680,   convRate: 0.019,  aov: 85.0,  engagementRate: 0.563, wowSessions: -0.060, wowRevenue: -0.025, engagedSessions: 24, avgDuration: 155, mobile: 30,   desktop: 12,  tablet: 1   },
]

// Scale a baseline affiliate (30d) to the selected period
function scaleAffiliate(aff, days) {
  const m = days / 30
  return {
    ...aff,
    sessions:       Math.round(aff.sessions * m),
    bookings:       Math.round(aff.bookings * m),
    revenue:        parseFloat((aff.revenue * m).toFixed(2)),
    engagedSessions: Math.round((aff.engagedSessions || 0) * m),
  }
}

// Apply the affiliateFilter from FiltersContext
function filterByAffiliate(affiliates, filters) {
  const af = filters?.affiliateFilter
  if (!af || af === 'all') return [...affiliates]
  return affiliates.filter(a => a.affiliateId === af)
}

// Apply deviceFilter — scale sessions/revenue to only that device's share
// Each HOPPA_AFFILIATE has mobile/desktop/tablet counts as fractions of total sessions
function applyDeviceFilter(affiliates, filters) {
  const dev = filters?.deviceFilter
  if (!dev || dev === 'all') return affiliates
  return affiliates.map(a => {
    const deviceSessions = a[dev] ?? 0  // e.g. a.mobile, a.desktop, a.tablet
    const totalSessions  = (a.mobile ?? 0) + (a.desktop ?? 0) + (a.tablet ?? 0)
    const ratio = totalSessions > 0 ? deviceSessions / totalSessions : 0
    return {
      ...a,
      sessions:        Math.round(a.sessions * ratio),
      bookings:        Math.round(a.bookings * ratio),
      revenue:         parseFloat((a.revenue * ratio).toFixed(2)),
      engagedSessions: Math.round((a.engagedSessions || 0) * ratio),
      mobile:          dev === 'mobile'  ? (a.mobile ?? 0) : 0,
      desktop:         dev === 'desktop' ? (a.desktop ?? 0) : 0,
      tablet:          dev === 'tablet'  ? (a.tablet ?? 0) : 0,
    }
  })
}

// Apply countryFilter — UK≈70%, US≈30% of all traffic
const COUNTRY_RATIOS = { UK: 0.70, US: 0.30 }
function applyCountryFilter(affiliates, filters) {
  const country = filters?.countryFilter
  if (!country || country === 'all') return affiliates
  const ratio = COUNTRY_RATIOS[country] ?? 1
  return affiliates.map(a => ({
    ...a,
    sessions:        Math.round(a.sessions * ratio),
    bookings:        Math.round(a.bookings * ratio),
    revenue:         parseFloat((a.revenue * ratio).toFixed(2)),
    engagedSessions: Math.round((a.engagedSessions || 0) * ratio),
  }))
}

// Apply all three filters in sequence
function applyFilters(affiliates, filters) {
  let result = filterByAffiliate(affiliates, filters)
  result = applyDeviceFilter(result, filters)
  result = applyCountryFilter(result, filters)
  return result
}

function seededAffiliateData() {
  return AFFILIATE_IDS.map((id, i) => {
    const sessionBase  = Math.floor(800 * Math.exp(-i * 0.25) + 30)
    const convBase     = 0.04 + Math.random() * 0.06
    const aovBase      = 180 + randInt(-60, 120)
    const engRate      = 0.45 + Math.random() * 0.4
    const sessions     = sessionBase + randInt(-30, 30)
    const bookings     = Math.floor(sessions * convBase)
    return {
      affiliateId: id,
      name: resolveAffiliateName(id),
      promotionMethod: resolvePromotionMethod(id),
      sessions, bookings,
      revenue: parseFloat((bookings * aovBase).toFixed(2)),
      convRate: parseFloat(convBase.toFixed(4)),
      aov: parseFloat(aovBase.toFixed(2)),
      engagedSessions: Math.floor(sessions * engRate),
      engagementRate: parseFloat(engRate.toFixed(4)),
      avgDuration: parseFloat(rand(90, 360).toFixed(1)),
      mobile: Math.floor(sessions * rand(0.4, 0.65)),
      desktop: Math.floor(sessions * rand(0.28, 0.45)),
      tablet: Math.floor(sessions * rand(0.03, 0.1)),
    }
  })
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

// ─── Mock implementations ──────────────────────────────────────────────────────

async function getMockExecutiveSummary(propertyId, filters) {
  await delay(200)

  const { start, end, days } = getDateBounds(filters)

  const affiliates = applyFilters(HOPPA_AFFILIATES, filters).map(a => scaleAffiliate(a, days))

  const totalSessions = affiliates.reduce((s, a) => s + a.sessions, 0) || 1
  const totalBookings = affiliates.reduce((s, a) => s + a.bookings, 0)
  const totalRevenue  = affiliates.reduce((s, a) => s + a.revenue,  0)
  const totalConvRate = totalBookings / totalSessions

  const dailySessionBase = totalSessions / days
  const dailyRevenueBase = totalRevenue  / days

  const sessionsTrend = generateDailyTrend(start, end, dailySessionBase, dailySessionBase * 0.88)
  const revenueTrend  = generateDailyTrend(start, end, dailyRevenueBase, dailyRevenueBase * 0.88)

  const topBySession = [...affiliates].sort((a, b) => b.sessions - a.sessions).slice(0, 10)
  const topByConv    = [...affiliates].sort((a, b) => b.convRate  - a.convRate ).slice(0, 10)

  const totalAov      = totalBookings > 0 ? totalRevenue / totalBookings : 0

  return {
    kpis: {
      sessions: { value: totalSessions, prev: Math.round(totalSessions / 1.141) },
      bookings:  { value: totalBookings, prev: Math.round(totalBookings / 1.083) },
      revenue:   { value: parseFloat(totalRevenue.toFixed(2)), prev: parseFloat((totalRevenue / 1.061).toFixed(2)) },
      convRate:  { value: parseFloat(totalConvRate.toFixed(4)), prev: parseFloat((totalConvRate + 0.004).toFixed(4)) },
      aov:       { value: parseFloat(totalAov.toFixed(2)), prev: parseFloat((totalAov * 0.97).toFixed(2)) },
    },
    sessionsTrend,
    revenueTrend,
    topBySession,
    topByConv,
    affiliates,
  }
}

async function getMockTrafficEngagement(propertyId, filters) {
  await delay(200)

  const { start, end, days } = getDateBounds(filters)

  const affiliates = applyFilters(HOPPA_AFFILIATES, filters).map(a => scaleAffiliate(a, days))

  const totalEngaged  = affiliates.reduce((s, a) => s + (a.engagedSessions || 0), 0)
  const avgEngRate    = affiliates.length > 0
    ? affiliates.reduce((s, a) => s + (a.engagementRate || 0), 0) / affiliates.length : 0.66
  const avgDuration   = affiliates.length > 0
    ? affiliates.reduce((s, a) => s + (a.avgDuration    || 0), 0) / affiliates.length : 222

  const top5 = [...affiliates].sort((a, b) => b.sessions - a.sessions).slice(0, 5)
  const sessionsTrends = top5.map(aff => ({
    affiliateId: aff.affiliateId,
    data: generateDailyData(start, end, aff.sessions / days, 0.3),
  }))

  const totalNewUsers = affiliates.reduce((s, a) => s + (a.newUsers ?? Math.round(a.sessions * 0.28)), 0)
  const newUsersTrend = generateDailyData(start, end, totalNewUsers / days, 0.35)
    .map(d => ({ date: d.date, value: Math.round(d.value) }))

  // prev-period approximation (–12% on new users)
  const newUsersTrendPrev = generateDailyData(start, end, (totalNewUsers / days) * 0.88, 0.35)
    .map(d => ({ date: d.date, value: Math.round(d.value) }))

  return {
    kpis: {
      engagedSessions: { value: totalEngaged, prev: Math.round(totalEngaged / 1.112) },
      engagementRate:  { value: parseFloat(avgEngRate.toFixed(4)), prev: parseFloat((avgEngRate - 0.018).toFixed(4)) },
      avgDuration:     { value: parseFloat(avgDuration.toFixed(1)), prev: parseFloat((avgDuration / 1.084).toFixed(1)) },
      pagesPerSession: { value: 4.2, prev: 4.2 },
    },
    sessionsTrends,
    newUsersTrend,
    newUsersTrendPrev,
    byEngagement: [...affiliates].sort((a, b) => b.engagementRate - a.engagementRate),
    affiliates,
  }
}

async function getMockCommercialPerformance(propertyId, filters) {
  await delay(200)

  const { start, end, days } = getDateBounds(filters)

  const leaderboardIds = ['awin (bulk)', '57697', '63136', '71759', '313605', '264419', '412875']
  const base = HOPPA_AFFILIATES.filter(a => leaderboardIds.includes(a.affiliateId))
  const affiliates = applyFilters(base, filters).map(a => ({
    ...scaleAffiliate(a, days),
    wowRevenue:  a.wowRevenue,
    wowSessions: a.wowSessions,
    healthScore: computeHealthScore(a),
  }))

  const totalRevenue  = affiliates.reduce((s, a) => s + a.revenue,  0)
  const totalBookings = affiliates.reduce((s, a) => s + a.bookings, 0)
  const totalSessions = affiliates.reduce((s, a) => s + a.sessions, 0) || 1
  const totalConvRate = totalBookings / totalSessions
  const totalAov      = totalBookings > 0 ? totalRevenue / totalBookings : 0

  const convTrend = generateDailyData(start, end, totalConvRate * 100, 0.15).map(d => ({
    date: d.date,
    sessions: 1000,
    transactions: Math.round(1000 * (d.value / 100)),
  }))
  const dailyRevenue = generateDailyData(start, end, totalRevenue / days, 0.25)
    .map(d => ({ date: d.date, revenue: d.value }))
  const dailyBookings = generateDailyData(start, end, totalBookings / days, 0.3)
    .map(d => ({ date: d.date, bookings: Math.round(d.value) }))
  const prevDailyRevenue = generateDailyData(start, end, (totalRevenue / days) * 0.94, 0.25)
    .map(d => ({ date: d.date, revenue: d.value }))

  return {
    kpis: {
      revenue:  { value: parseFloat(totalRevenue.toFixed(2)), prev: parseFloat((totalRevenue / 1.061).toFixed(2)) },
      bookings: { value: totalBookings, prev: Math.round(totalBookings / 1.083) },
      convRate: { value: parseFloat(totalConvRate.toFixed(4)), prev: parseFloat((totalConvRate + 0.0004).toFixed(4)) },
      aov:      { value: parseFloat(totalAov.toFixed(2)), prev: parseFloat((totalAov / 0.98).toFixed(2)) },
    },
    convTrend,
    dailyRevenue,
    dailyBookings,
    prevDailyRevenue,
    byConvRate: [...affiliates].sort((a, b) => b.convRate - a.convRate),
    byAov:      [...affiliates].sort((a, b) => b.aov - a.aov),
    affiliates,
  }
}

async function getMockFunnelAnalysis(propertyId, filters) {
  await delay(200)

  const { start, end, days } = getDateBounds(filters)
  const m = days / 30

  const baseAffiliates = [
    { affiliateId: 'awin (bulk)', dropOff: 712, beginCheckout: 1192, purchases: 480, checkoutRate: 0.403 },
    { affiliateId: '57697',       dropOff: 198, beginCheckout: 340,  purchases: 142, checkoutRate: 0.431 },
    { affiliateId: '63136',       dropOff: 142, beginCheckout: 264,  purchases: 122, checkoutRate: 0.462 },
    { affiliateId: '313605',      dropOff: 97,  beginCheckout: 150,  purchases: 53,  checkoutRate: 0.354 },
    { affiliateId: '264419',      dropOff: 84,  beginCheckout: 118,  purchases: 34,  checkoutRate: 0.286 },
    { affiliateId: '71759',       dropOff: 61,  beginCheckout: 111,  purchases: 50,  checkoutRate: 0.448 },
    { affiliateId: '321967',      dropOff: 0,   beginCheckout: 88,   purchases: 33,  checkoutRate: 0.378 },
  ]

  const affiliates = applyFilters(baseAffiliates, filters).map(a => ({
    ...a,
    dropOff:       Math.round(a.dropOff * m),
    beginCheckout: Math.round(a.beginCheckout * m),
    purchases:     Math.round(a.purchases * m),
  }))

  // Device ratio: mobile ~71%, desktop ~27%, all = 1.0
  const deviceRatio = filters?.funnelDevice === 'mobile' ? 0.71
    : filters?.funnelDevice === 'desktop' ? 0.27
    : 1.0

  const sSessions   = Math.round(3394 * m * deviceRatio)
  const sVSR        = Math.round(2614 * m * deviceRatio)
  const sFormSubmit = Math.round(2190 * m * deviceRatio)
  const sCheckout   = Math.round(2847 * m * deviceRatio)
  const sConv       = Math.round(2052 * m * deviceRatio)
  const sPurchase   = Math.round(1089 * m * deviceRatio)

  const funnelSteps = [
    { label: 'Sessions',              value: sSessions,   pct: 100 },
    { label: 'Search Results Viewed', value: sVSR,        pct: parseFloat(((sVSR / sSessions) * 100).toFixed(1)) },
    { label: 'Search Submitted',      value: sFormSubmit, pct: parseFloat(((sFormSubmit / sSessions) * 100).toFixed(1)) },
    { label: 'Checkout Started',      value: sCheckout,   pct: parseFloat(((sCheckout / sSessions) * 100).toFixed(1)) },
    { label: 'Checkout Page',         value: sConv,       pct: parseFloat(((sConv / sSessions) * 100).toFixed(1)) },
    { label: 'Booking Completed',     value: sPurchase,   pct: parseFloat(((sPurchase / sSessions) * 100).toFixed(1)) },
  ]

  const funnelTrend = [
    { stage: 'Sessions',         data: generateDailyData(start, end, sSessions / days, 0.25) },
    { stage: 'Checkout Started', data: generateDailyData(start, end, sCheckout / days, 0.25) },
    { stage: 'Booking Completed',data: generateDailyData(start, end, sPurchase / days, 0.25) },
  ]

  const checkoutToConv = sPurchase > 0 ? parseFloat((sPurchase / sCheckout).toFixed(4)) : 0

  return {
    kpis: {
      evtBeginCheckout:   { value: sCheckout,  prev: Math.round(sCheckout / 1.074) },
      checkoutToPurchase: { value: checkoutToConv, prev: parseFloat((checkoutToConv - 0.011).toFixed(4)) },
      evtViewSearch:      { value: sVSR,        prev: Math.round(sVSR / 1.052) },
      evtPaymentFail:     { value: Math.round(31 * m), prev: Math.round(28 * m) },
    },
    funnelSteps,
    funnelTrend,
    affiliateCheckoutDrop: affiliates,
    paymentFailTrend: {
      mobile:  generateDailyData(start, end, (19 * m) / days, 0.4).map(d => ({ date: d.date, value: Math.round(d.value) })),
      desktop: generateDailyData(start, end, (12 * m) / days, 0.4).map(d => ({ date: d.date, value: Math.round(d.value) })),
    },
    deadAffiliates: [],
  }
}

