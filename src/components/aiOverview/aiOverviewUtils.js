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
  if (/Table_title:|Table_content:|Table:/i.test(text)) return 'Transport tables'

  // Hoppa brand — checked early so Transfer times / Travel timing can't steal brand snippets
  if (/\bhoppa\b/i.test(text)) return 'Hoppa booking'

  // Cruise & Port Transfers — before Hoppa pre-book intent so "book a cruise port transfer" lands here
  if (/cruise.{0,25}(port|terminal|ship|pier|transfer|dock)|port.{0,20}(cruise|ferry|transfer)|\bferry.{0,20}(port|terminal|transfer)|\bsea.?port\b|cruise.{0,30}(arrival|pickup|collect)/i.test(text)) return 'Cruise & Port Transfers'

  // Hotel Pickup & Collection — before pre-book intent so hotel-pickup phrases are caught here
  if (/hotel.{0,20}(pick.?up|collect|transfer|drop.?off|to airport|to cruise)|collect.{0,15}(from|at).{0,15}hotel|from.{0,20}hotel.{0,20}(airport|cruise|port)|accommodation.{0,20}(pick.?up|collect|transfer)|resort.{0,15}(pick.?up|collect)/i.test(text)) return 'Hotel Pickup & Collection'

  // Pre-booking intent and booking-action phrases — before Transfer times so these stay in Hoppa booking
  if (/pre.?book|door.?to.?door|book.{0,5}(a|your|an).{0,20}(taxi|cab|transfers?|ride)/i.test(text)) return 'Hoppa booking'

  // Safety & Driver Trust — driver vetting, licensing, insurance, trust signals
  // Checked after Hoppa brand (which owns "trusted by hoppa") but before generic transfer patterns
  if (/\bfully.{0,10}licens|\binsured.{0,15}(driver|vehicle|transfer)|\bvetted\b|\bbackground.?check|\bDBS\b|\bCRB\b|licens.{0,20}(driver|operator)|safe(ty)?.{0,15}(driver|transfer|ride|journey)|driver.{0,20}(licen|insur|vetted|safe)|trusted.{0,20}(driver|operator|partner)/i.test(text)) return 'Safety & Driver Trust'

  // Airport Overview location phrases — before Transfer times so "X km from city" in airport descriptions
  // doesn't get stolen by the distance pattern in Transfer times
  if (/airport.{0,25}(is located|is situated)|\b\w+ airport is\b/i.test(text)) return 'Airport Overview'

  // Luggage & Baggage — before Pricing so "baggage allowance per person" doesn't fire Pricing first
  if (/\bluggage\b|\bbaggage\b|\bsuitcase\b|\bhand.?bag\b|\bhand luggage\b|\bcarry.?on\b|oversized|oversize.{0,10}(bag|item|luggage)|\bgolf bag\b|\bski(s|ing)?.{0,10}(bag|equipment)\b|baggage.{0,20}(allow|limit|rule|polic|fee|charge)|luggage.{0,20}(allow|limit|rule|polic|fee|charge)/i.test(text)) return 'Luggage & Baggage'

  // Pricing (monetary / cost)
  if (/[€£$]|per person|per vehicle|fixed.{0,10}rate|\bfare\b|cheap|afford|expensive|tariff|\bcost\b|\bprice[sd]?\b/i.test(text)) return 'Pricing'

  // Travel timing (when to leave, pre-flight advice)
  // "hours before" requires flight/departure context so cancellation policy ("24 hours before pick-up") doesn't match here
  // "international airport" alone (without flight) is excluded to avoid stealing Airport Overview snippets
  if (/how early|hours? before.{0,25}(flight|depart|boarding|check.?in|land)|check.?in|before.{1,40}flight|before.{1,40}departure|recommended.{1,30}arriv|allow.{1,30}time|leave.{1,20}early|get.{1,15}early|domestic.{1,20}flight|international.{1,20}flight|boarding|security.{1,20}time|departure.{1,20}time|arrive.{1,30}airport.{1,30}(early|hour|time)|airport.{1,30}arrive.{1,30}(early|hour|time)|peak.{0,15}travel.{0,15}(hour|time)/i.test(text)) return 'Travel timing'

  // Vehicle & Fleet — checked before the broad coach/bus/train Transfer times pattern so vehicle-type
  // listings (minibuses, coaches, wheelchair-accessible) aren't stolen by the transport-mode check
  if (/\bminivans?\b|\bminibuses?\b|\b(\d+).?seater\b|\bseater\b|vehicle.{0,20}(type|option|class|size|capacit)|\bcar seat\b|\bchild.{0,10}seat\b|\bchild.?booster\b|\bwheelchair.{0,20}(access|vehicle|friendly)\b|\bwheelchair accessible\b|\baccessible.{0,20}(vehicle|transfer|taxi)\b|\bexecutive.{0,20}(car|vehicle|transfer)\b|\bluxury.{0,20}(car|vehicle|transfer)\b|\bgroup.{0,15}(vehicle|transfer|taxi|transport)\b|\bpassenger(s)?.{0,15}(capacity|max|limit)\b/i.test(text)) return 'Vehicle & Fleet'

  // Transfer Comparison — before Transfer times (`taxi` would steal "taxi vs private")
  if (/\bvs\.?\b.{0,20}(taxi|transfer|shuttle|bus|train)|compar(e|ing|ison).{0,30}(transfer|taxi|shuttle|transport|option)|which.{0,20}(better|faster|cheaper).{0,20}(transfer|taxi|transport)|(taxi|transfer|shuttle).{0,15}vs\.?.{0,15}(taxi|transfer|shuttle|bus)/i.test(text)) return 'Transfer Comparison'

  // Transfer times (journey duration, transport options to/from airports)
  if (/\btaxi|\bcab\b|minicab|rideshare|private (car|vehicle)|\buber\b|careem|lyft|\bbolt\b/i.test(text)) return 'Transfer times'
  if (/\btransfers?\b|\bshuttles?\b/i.test(text)) return 'Transfer times'
  if (/(train|bus|coach|metro|tube|tram|rail).{0,40}(airport|city|centre|center|terminal)|(airport|terminal).{0,40}(train|bus|coach|metro|tube|tram|rail)/i.test(text)) return 'Transfer times'
  if (/(minute|hour|km|mile).{0,25}(airport|terminal|city|centre|station)|(airport|terminal).{0,25}(minute|hour|km|mile)/i.test(text)) return 'Transfer times'
  if (/getting (from|to).{1,30}airport|how long.{1,30}(take|get to|travel|reach|journey)|distance.{1,20}airport|airport.{0,30}(route|distance|journey|drive)|airport express|fast link/i.test(text)) return 'Transfer times'
  // Edge-case Transfer times phrases not matched above
  if (/\bride\b.{0,20}(airport|terminal)|how (do i|to) get (to|from).{0,20}airport|options?.{0,20}(from|to).{0,20}airport|journey.{0,20}(in)?to.{0,20}(city|centre|center|hotel)/i.test(text)) return 'Transfer times'

  // Destinations (places, tourism, attractions)
  if (/things to do|attraction|sightseeing|city cent(re|er)|museum|\bbeach\b|landmark|heritage|cultural|explore|discover|places to|nightlife|\brestaurant\b|holiday destination|holiday.*land|tour(ist|ism)|guide to|local.*guide|visit.{1,20}(city|town|island|country)|resort|famous for/i.test(text)) return 'Destinations'

  // Hoppa booking — non-brand booking patterns (brand + pre-book already caught above)
  if (/private transfers?|book.{1,20}(taxi|cab|shuttle|transfers?|ride)|compare.{1,20}transfers?/i.test(text)) return 'Hoppa booking'

  // Booking & Cancellation — after Hoppa booking to avoid stealing brand snippets
  if (/\bcancel(lation[s]?|led|ling|s|ing)?\b|\brefunds?\b|\bamend(ment)?\b|\bmodif(y|ied|ication)\b|no.?show|free.{0,15}cancel|cancel.{0,15}free|book.{0,20}(ahead|in advance|before arrival)|\bpolic(y|ies)\b.{0,30}(transfer|transport|booking|travel)|\bterms?.{0,10}(condition|cancel|book)|voucher.{0,20}(email|sent|confirm)|e.?ticket.{0,15}confirm|booking.{0,20}voucher/i.test(text)) return 'Booking & Cancellation'

  // Payment & Booking Process — payment methods, confirmation, currency
  if (/pay(ment|pal)?.{0,20}(online|secure|method|option|card|upfront|arrival|driver)|credit.?card|debit.?card|\bvisa\b|\bmastercard\b|\bamex\b|instant.{0,15}(confirm|booking)|booking.{0,15}confirm(ation)?|pay.{0,10}(local|currency|convert)|deposit.{0,20}(required|booking)|pay.{0,15}(on arrival|driver|day)/i.test(text)) return 'Payment & Booking Process'

  // Corporate Travel — business accounts, executive transfers
  if (/\bcorporate.{0,20}(transfer|travel|account|booking|rate)|business.{0,20}(travel|transfer|account|class|traveller)|executive.{0,20}transfer|managed.{0,20}travel|company.{0,20}(account|travel|invoice)|invoice.{0,15}(available|receipt|corporate)/i.test(text)) return 'Corporate Travel'

  // Airport Information — terminals, parking, facilities, lounges
  if (/\bterminal[s]?\b.{0,30}(airport|depart|arriv|flight|gate|number|T\d)|\b(T1|T2|T3|T4|T5)\b|airport.{0,25}(terminal|parking|lounge|facilit|map|layout|level|floor|exit|hall)|\bairport lounge\b|\bparking.{0,20}airport\b|\barrival(s)? hall\b|\bdeparture(s)? (hall|gate|lounge)\b|\bgate number\b|which terminal/i.test(text)) return 'Airport Information'

  // Flight Logistics — meet & greet, flight tracking, driver wait times, delays
  if (/meet.{0,10}greet|flight.{0,20}(track|monitor|delay|cancel|late)|driver.{0,20}wait|wait.{0,20}(flight|delay|free|includ)|\bfree.{0,15}wait\b|\bwait(ing)? time\b.{0,15}(free|includ|flight)|name.{0,10}(sign|board|card|plac)|arrival.{0,20}(track|monitor)|pickup.{0,20}(delay|late|track)|flight.{0,20}(cancel|divert).{0,20}(wait|transfer|policy)|driver.{0,20}wait(ing)?.{0,20}(arrival|outside|exit)|waiting.{0,20}arrival[s]?|name.?board.{0,20}(arrival|exit|customs)/i.test(text)) return 'Flight Logistics'

  // Airport Overview — general airport introductions and quick-facts (distinct from terminal/parking specifics)
  // Also catches named-airport "X airport is…" descriptions (e.g. "The London Gatwick airport is…")
  if (/quick facts.{0,20}(airport|arrival)|airport.{0,25}(code|IATA|is located|is situated|is (a|the) (major|international|regional|closest|nearest|busiest|small|new|newly))|airport (overview|guide|information|facts)|\bFerenc Liszt\b|\bKopernicus\b|(international|regional) airport.{0,30}(located|situated|serves|connect)|\b\w+\s+airport is\b|\w+.{0,15}airport.{0,20}(handles?|serves?|process|million|passenger|busiest|ranked)/i.test(text)) return 'Airport Overview'

  // Immigration & Customs — border control, passport control, customs queues
  if (/\bimmigration\b|\bcustoms\b.{0,30}(queue|check|proced|clear|time|declar)|\bpassport.{0,20}control\b|\bborder.{0,20}(check|control|proced)\b|customs.{0,20}(and|&).{0,20}immigration|immigration.{0,20}(work|proced|queue|check|time)/i.test(text)) return 'Immigration & Customs'

  // Promotions & Discounts — promo codes, voucher codes, % savings, sign-up offers
  if (/\d+%.{0,10}(off|discount|saving)|save.{0,15}\d+%|promo.?code|voucher[s]?|discount.?code|sign.{0,8}up.{0,20}(sav|offer|deal)|\bspar\b.{0,20}(penge|nu)|spar penge/i.test(text)) return 'Promotions & Discounts'

  // Customer Reviews — testimonial snippets and trust/review signals (without brand name)
  if (/rated by.{0,20}traveller|traveller[s]?.{0,20}(review|say|rate|trust)|trustpilot.{0,20}(rating|score|review)|\d[\s,]*star[s]?.{0,20}(rating|review|experience)|what.{0,15}traveller[s]?.{0,10}say|entirely happy|customer[s]?.{0,20}(review|rating|feedback|say|trust)/i.test(text)) return 'Customer Reviews'

  // Customer Service — support availability, contact channels, response stats
  if (/support.{0,30}(available|round.?the.?clock|24.?7|24 hours)|customer.{0,20}(service|care|support).{0,30}(available|hours|team)|missed.?call[s]?|response.{0,20}time.{0,20}(fast|quick|guaran)|contact.{0,20}(us|team|agent).{0,20}(by|via|through|on)/i.test(text)) return 'Customer Service'

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
  'Transfer times':           '#1D9E75',
  'Travel timing':            '#378ADD',
  'Transport tables':         '#7F77DD',
  'Pricing':                  '#EF9F27',
  'Destinations':             '#D85A30',
  'Hoppa booking':            '#D4537E',
  'Luggage & Baggage':        '#7C9EBF',
  'Booking & Cancellation':   '#A07BD8',
  'Airport Information':      '#3ABCAD',
  'Vehicle & Fleet':          '#D4875A',
  'Flight Logistics':         '#5A8FD4',
  'Airport Overview':         '#2E8B8B',
  'Immigration & Customs':    '#8B5E3C',
  'Promotions & Discounts':   '#E8A838',
  'Customer Reviews':         '#6AAF47',
  'Customer Service':         '#C45FA0',
  'Safety & Driver Trust':    '#3D7ABF',
  'Cruise & Port Transfers':  '#1A7A8A',
  'Hotel Pickup & Collection':'#8A6DBF',
  'Transfer Comparison':      '#BF8A3D',
  'Payment & Booking Process':'#5BA85B',
  'Corporate Travel':         '#7A7ABF',
  'Other':                    '#B4B2A9',
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
