/**
 * aiOverviewUtils.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared pure functions for the AI Overview Intelligence section.
 * No React imports — safe to use in any component or service.
 */

export const SNIPPET_KEY = 'customEvent:ai_overview_click'

// ─── Content categorisation ───────────────────────────────────────────────────

/**
 * categorise() — map a snippet text to a content category label.
 * Used for the donut chart, category pills in the table, and device split bars.
 */
export function categorise(text) {
  if (!text) return 'Other'

  // Transport tables (most specific — always first)
  if (/Table_title:|Table:/i.test(text)) return 'Transport tables'

  // Pricing (monetary / cost)
  if (/[€£$]|per person|per vehicle|fixed.{0,10}rate|\bfare\b|cheap|afford|expensive|tariff|\bcost\b|\bprice[sd]?\b/i.test(text)) return 'Pricing'

  // Travel timing (when to leave, pre-flight advice)
  if (/how early|hours? before|check.?in|before.{1,40}flight|before.{1,40}departure|recommended.{1,30}arriv|allow.{1,30}time|leave.{1,20}early|get.{1,15}early|domestic.{1,20}(flight|airport)|international.{1,20}(flight|airport)|boarding|security.{1,20}time|departure.{1,20}time|arrive.{1,30}airport.{1,30}(early|hour|time)|airport.{1,30}arrive.{1,30}(early|hour|time)/i.test(text)) return 'Travel timing'

  // Luggage & Baggage — before Transfer times (luggage ON transfers is a sub-topic)
  if (/\bluggage\b|\bbaggage\b|\bsuitcase\b|\bhand.?bag\b|\bhand luggage\b|\bcarry.?on\b|oversized|oversize.{0,10}(bag|item|luggage)|\bgolf bag\b|\bski(s|ing)?.{0,10}(bag|equipment)\b|baggage.{0,20}(allow|limit|rule|polic|fee|charge)|luggage.{0,20}(allow|limit|rule|polic|fee|charge)/i.test(text)) return 'Luggage & Baggage'

  // Transfer times (journey duration, transport options to/from airports)
  if (/\btaxi|\bcab\b|minicab|rideshare|private (car|vehicle)/i.test(text)) return 'Transfer times'
  if (/\btransfer\b|\bshuttle\b/i.test(text)) return 'Transfer times'
  if (/(train|bus|coach|metro|tube|tram|rail).{0,40}(airport|city|centre|center|terminal)|(airport|terminal).{0,40}(train|bus|coach|metro|tube|tram|rail)/i.test(text)) return 'Transfer times'
  if (/(minute|hour|km|mile).{0,25}(airport|terminal|city|centre|station)|(airport|terminal).{0,25}(minute|hour|km|mile)/i.test(text)) return 'Transfer times'
  if (/getting (from|to).{1,30}airport|how long.{1,30}(take|get to|travel|reach|journey)|distance.{1,20}airport|airport.{0,30}(route|distance|journey|drive)|airport express|fast link/i.test(text)) return 'Transfer times'

  // Destinations (places, tourism, attractions)
  if (/things to do|attraction|sightseeing|city cent(re|er)|museum|\bbeach\b|landmark|heritage|cultural|explore|discover|places to|nightlife|\brestaurant\b|holiday destination|holiday.*land|tour(ist|ism)|guide to|local.*guide|visit.{1,20}(city|town|island|country)|resort|famous for/i.test(text)) return 'Destinations'

  // Hoppa booking (direct booking references)
  if (/hoppa|pre.?book|door.?to.?door|private transfer|book.{1,20}(taxi|cab|shuttle|transfer|ride)|compare.{1,20}transfer/i.test(text)) return 'Hoppa booking'

  // Booking & Cancellation — after Hoppa booking to avoid stealing brand snippets
  if (/\bcancel(lation)?\b|\brefund\b|\bamend(ment)?\b|\bmodif(y|ied|ication)\b|no.?show|free.{0,15}cancel|cancel.{0,15}free|book.{0,20}(ahead|in advance|before arrival)|\bpolic(y|ies)\b.{0,30}(transfer|transport|booking|travel)|\bterms?.{0,10}(condition|cancel|book)/i.test(text)) return 'Booking & Cancellation'

  // Airport Information — terminals, parking, facilities, lounges
  if (/\bterminal[s]?\b.{0,30}(airport|depart|arriv|flight|gate|number|T\d)|\b(T1|T2|T3|T4|T5)\b|airport.{0,25}(terminal|parking|lounge|facilit|map|layout|level|floor|exit|hall)|\bairport lounge\b|\bparking.{0,20}airport\b|\barrival(s)? hall\b|\bdeparture(s)? (hall|gate|lounge)\b|\bgate number\b|which terminal/i.test(text)) return 'Airport Information'

  // Vehicle & Fleet Information — vehicle types, capacity, accessibility, child seats
  if (/\bminivan\b|\bminibus\b|\b(\d+).?seater\b|\bseater\b|vehicle.{0,20}(type|option|class|size|capacit)|\bcar seat\b|\bchild.{0,10}seat\b|\bchild.?booster\b|\bwheelchair.{0,20}(access|vehicle|friendly)\b|\bwheelchair accessible\b|\baccessible.{0,20}(vehicle|transfer|taxi)\b|\bexecutive.{0,20}(car|vehicle|transfer)\b|\bluxury.{0,20}(car|vehicle|transfer)\b|\bgroup.{0,15}(vehicle|transfer|taxi|transport)\b|\bpassenger(s)?.{0,15}(capacity|max|limit)\b/i.test(text)) return 'Vehicle & Fleet'

  // Flight Logistics — meet & greet, flight tracking, driver wait times, delays
  if (/meet.{0,10}greet|flight.{0,20}(track|monitor|delay|cancel|late)|driver.{0,20}wait|wait.{0,20}(flight|delay|free|includ)|\bfree.{0,15}wait\b|\bwait(ing)? time\b.{0,15}(free|includ|flight)|name.{0,10}(sign|board|card|plac)|arrival.{0,20}(track|monitor)|pickup.{0,20}(delay|late|track)|flight.{0,20}(cancel|divert).{0,20}(wait|transfer|policy)/i.test(text)) return 'Flight Logistics'

  return 'Other'
}


/**
 * classifySnippet() — simpler 3-way classification for device split bars.
 */
export function classifySnippet(text) {
  if (!text) return 'text'
  if (/Table_title:|Table:/i.test(text)) return 'table'
  if (/€|£|\$|per person|per vehicle|per night/i.test(text)) return 'price'
  return 'text'
}

// ─── Category colour map ──────────────────────────────────────────────────────

export const CATEGORY_COLORS = {
  'Transfer times':        '#1D9E75',
  'Travel timing':         '#378ADD',
  'Transport tables':      '#7F77DD',
  'Pricing':               '#EF9F27',
  'Destinations':          '#D85A30',
  'Hoppa booking':         '#D4537E',
  'Luggage & Baggage':     '#7C9EBF',
  'Booking & Cancellation':'#A07BD8',
  'Airport Information':   '#3ABCAD',
  'Vehicle & Fleet':       '#D4875A',
  'Flight Logistics':      '#5A8FD4',
  'Other':                 '#B4B2A9',
}

// ─── Week label helper ────────────────────────────────────────────────────────

/**
 * weekLabel(yearWeek) — convert GA4 yearWeek (e.g. "202611") to "W11 · Mar 10"
 * Uses ISO week convention: Week 1 contains the first Thursday of the year.
 */
export function weekLabel(yearWeek) {
  if (!yearWeek || yearWeek.length < 6) return yearWeek
  const year = parseInt(yearWeek.slice(0, 4), 10)
  const week = parseInt(yearWeek.slice(4), 10)

  // Find Jan 4 of the year (always in week 1 by ISO 8601)
  const jan4 = new Date(year, 0, 4)
  // Get the Monday of week 1
  const dayOfWeek = jan4.getDay() || 7 // 1=Mon … 7=Sun
  const week1Monday = new Date(jan4)
  week1Monday.setDate(jan4.getDate() - dayOfWeek + 1)

  // Advance to the target week's Monday
  const targetMonday = new Date(week1Monday)
  targetMonday.setDate(week1Monday.getDate() + (week - 1) * 7)

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const mon = months[targetMonday.getMonth()]
  const day = targetMonday.getDate()
  return `W${week} · ${mon} ${day}`
}

// ─── Trend status classifier ──────────────────────────────────────────────────

/**
 * computeTrendStatus(weeklyMap, allSortedWeeks) — determine lifecycle status for a snippet.
 * weeklyMap: { [yearWeek]: eventCount }
 * allSortedWeeks: sorted array of all yearWeek strings in the dataset
 */
export function computeTrendStatus(weeklyMap, allSortedWeeks) {
  const snippetWeeks = allSortedWeeks.filter(w => (weeklyMap[w] ?? 0) > 0)
  if (snippetWeeks.length === 0) return 'stable'

  const latestWeek = allSortedWeeks[allSortedWeeks.length - 1]
  const secondLatest = allSortedWeeks[allSortedWeeks.length - 2]
  const snippetStart = snippetWeeks[0]

  // "new" if the snippet only appears in the most recent 2 weeks
  if (snippetStart === latestWeek || snippetStart === secondLatest) {
    const appearsOnlyRecently = snippetWeeks.every(w => w === latestWeek || w === secondLatest)
    if (appearsOnlyRecently) return 'new'
  }

  const firstCount = weeklyMap[snippetWeeks[0]] ?? 0
  const lastCount = weeklyMap[snippetWeeks[snippetWeeks.length - 1]] ?? 0

  if (lastCount >= firstCount) return 'growing'
  if (lastCount < firstCount * 0.5) return 'declining'
  return 'stable'
}

// ─── Data processors ─────────────────────────────────────────────────────────

/**
/**
 * processKpisData — derive KPI summary from kpis query rows.
 *
 * The kpis query now returns snippet × pagePath rows (one row per unique
 * snippet + page combination). This function:
 *   1. Aggregates events/users per snippet (collapsing multiple page rows)
 *   2. Builds snippetToPages: snippetText → [{page, events}] sorted desc
 *   3. Returns aggregated snippet-level rows for the table / matrix / lifecycle
 *
 * Returns { totalEvents, uniqueSnippets, topSnippetEvents, topSnippetText,
 *           avgEventsPerSnippet, rows, snippetToPages }
 */
export function processKpisData(rows) {
  if (!rows || rows.length === 0) {
    return {
      totalEvents: 0, uniqueSnippets: 0, topSnippetEvents: 0,
      topSnippetText: '', avgEventsPerSnippet: '0.0',
      rows: [], snippetToPages: {},
    }
  }

  // Aggregate: collapse snippet × pagePath rows into one row per snippet.
  // sessions, transactions, purchaseRevenue are NOT in the kpis query —
  // they are sourced from the separate commerce query (joined by pagePath in the table).
  const snippetAgg     = {}  // snippetText → { events, users }
  const snippetPageMap = {}  // snippetText → { pagePath → totalEvents }

  rows.forEach(row => {
    const text   = row[SNIPPET_KEY] ?? ''
    const events = row.eventCount   || 0
    const users  = row.activeUsers  || 0
    const page   = row.pagePath     ?? ''

    if (!snippetAgg[text]) snippetAgg[text] = { events: 0, users: 0 }
    snippetAgg[text].events += events
    snippetAgg[text].users  += users

    if (page && page !== '(not set)' && page !== '(not provided)') {
      if (!snippetPageMap[text]) snippetPageMap[text] = {}
      snippetPageMap[text][page] = (snippetPageMap[text][page] || 0) + events
    }
  })

  // Convert page maps to sorted arrays
  const snippetPages = {}
  Object.entries(snippetPageMap).forEach(([text, pageMap]) => {
    snippetPages[text] = Object.entries(pageMap)
      .map(([page, events]) => ({ page, events }))
      .sort((a, b) => b.events - a.events)
  })

  // Build aggregated snippet-level rows sorted by total events desc
  const aggregated = Object.entries(snippetAgg)
    .map(([text, { events, users }]) => ({
      [SNIPPET_KEY]: text,
      eventCount:    events,
      activeUsers:   users,
    }))
    .sort((a, b) => b.eventCount - a.eventCount)

  const totalEvents         = aggregated.reduce((s, r) => s + r.eventCount, 0)
  const uniqueSnippets      = aggregated.length
  const topRow              = aggregated[0]
  const topSnippetEvents    = topRow?.eventCount || 0
  const topSnippetText      = (topRow?.[SNIPPET_KEY] ?? '').slice(0, 40)
  const avgEventsPerSnippet = uniqueSnippets > 0 ? (totalEvents / uniqueSnippets).toFixed(1) : '0.0'

  return {
    totalEvents, uniqueSnippets, topSnippetEvents, topSnippetText,
    avgEventsPerSnippet, rows: aggregated, snippetToPages: snippetPages,
  }
}

/**
 * processTrendData — group trend rows by week and by snippet.
 * Returns:
 *   weeklyTotals: [{ week, label, events }] sorted ascending
 *   snippetWeekMap: { snippetText: { [yearWeek]: eventCount } }
 *   allSortedWeeks: sorted string[] of all yearWeeks present
 */
export function processTrendData(rows) {
  if (!rows || rows.length === 0) {
    return { weeklyTotals: [], snippetWeekMap: {}, allSortedWeeks: [] }
  }

  const weekTotals = {}      // yearWeek → total eventCount
  const snippetWeekMap = {}  // snippetText → { yearWeek: eventCount }

  rows.forEach(row => {
    const week = row.yearWeek
    const snippet = row[SNIPPET_KEY] ?? ''
    const events = row.eventCount || 0

    weekTotals[week] = (weekTotals[week] || 0) + events

    if (!snippetWeekMap[snippet]) snippetWeekMap[snippet] = {}
    snippetWeekMap[snippet][week] = (snippetWeekMap[snippet][week] || 0) + events
  })

  const allSortedWeeks = Object.keys(weekTotals).sort()
  const weeklyTotals = allSortedWeeks.map(week => ({
    week,
    label: weekLabel(week),
    events: weekTotals[week],
  }))

  return { weeklyTotals, snippetWeekMap, allSortedWeeks }
}

/**
 * processDeviceData — compute per content-type device splits from device rows.
 * Returns { text, table, price } each with { mobile, desktop, tablet, total }
 */
export function processDeviceData(rows) {
  const buckets = {
    text:  { mobile: 0, desktop: 0, tablet: 0 },
    table: { mobile: 0, desktop: 0, tablet: 0 },
    price: { mobile: 0, desktop: 0, tablet: 0 },
  }
  if (!rows) return buckets

  rows.forEach(row => {
    const snippet = row[SNIPPET_KEY] ?? ''
    const device = (row.deviceCategory ?? '').toLowerCase()
    const events = row.eventCount || 0
    const type = classifySnippet(snippet)
    const bucket = buckets[type] ?? buckets.text
    if (device === 'mobile') bucket.mobile += events
    else if (device === 'desktop') bucket.desktop += events
    else if (device === 'tablet') bucket.tablet += events
  })

  // Add totals and percentages
  const withPct = (b) => {
    const total = b.mobile + b.desktop + b.tablet
    return {
      ...b,
      total,
      mobilePct: total > 0 ? Math.round((b.mobile / total) * 100) : 0,
      desktopPct: total > 0 ? Math.round((b.desktop / total) * 100) : 0,
    }
  }

  return {
    text:  withPct(buckets.text),
    table: withPct(buckets.table),
    price: withPct(buckets.price),
  }
}

/**
 * buildCategoryBreakdown — from kpis rows, produce category event totals + percentages.
 */
export function buildCategoryBreakdown(rows) {
  const catMap = {}
  rows.forEach(row => {
    const cat = categorise(row[SNIPPET_KEY] ?? '')
    catMap[cat] = (catMap[cat] || 0) + (row.eventCount || 0)
  })
  const total = Object.values(catMap).reduce((s, v) => s + v, 0) || 1
  return Object.entries(catMap)
    .map(([label, events]) => ({ label, events, pct: Math.round((events / total) * 100) }))
    .sort((a, b) => b.events - a.events)
}
