/**
 * analyse_other_bucket.mjs
 * Fetches live AI Overview snippet data from Supabase and shows
 * what's currently landing in the "Other" category.
 *
 * Run: node scripts/analyse_other_bucket.mjs
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL  = 'https://fpwgnceigulqonjdzfbo.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZwd2duY2VpZ3VscW9uamR6ZmJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NDkyNzMsImV4cCI6MjA5MDAyNTI3M30.-F2XWED7EEku2aCUmNsom8KG8jCLueLimpRdBSXYtHQ'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON)

// ── Same categorise() as aiOverviewUtils.js ───────────────────────────────────
function categorise(text) {
  if (!text) return 'Other'
  if (/Table_title:|Table_content:|Table:/i.test(text)) return 'Transport tables'
  if (/\bhoppa\b/i.test(text)) return 'Hoppa booking'
  if (/pre.?book|door.?to.?door|book.{0,5}(a|your|an).{0,20}(taxi|cab|transfers?|ride)/i.test(text)) return 'Hoppa booking'
  if (/airport.{0,25}(is located|is situated)|\b\w+ airport is\b/i.test(text)) return 'Airport Overview'
  if (/\bluggage\b|\bbaggage\b|\bsuitcase\b|\bhand.?bag\b|\bhand luggage\b|\bcarry.?on\b|oversized|oversize.{0,10}(bag|item|luggage)|\bgolf bag\b|\bski(s|ing)?.{0,10}(bag|equipment)\b|baggage.{0,20}(allow|limit|rule|polic|fee|charge)|luggage.{0,20}(allow|limit|rule|polic|fee|charge)/i.test(text)) return 'Luggage & Baggage'
  if (/[€£$]|per person|per vehicle|fixed.{0,10}rate|\bfare\b|cheap|afford|expensive|tariff|\bcost\b|\bprice[sd]?\b/i.test(text)) return 'Pricing'
  if (/how early|hours? before.{0,25}(flight|depart|boarding|check.?in|land)|check.?in|before.{1,40}flight|before.{1,40}departure|recommended.{1,30}arriv|allow.{1,30}time|leave.{1,20}early|get.{1,15}early|domestic.{1,20}flight|international.{1,20}flight|boarding|security.{1,20}time|departure.{1,20}time|arrive.{1,30}airport.{1,30}(early|hour|time)|airport.{1,30}arrive.{1,30}(early|hour|time)|peak.{0,15}travel.{0,15}(hour|time)/i.test(text)) return 'Travel timing'
  if (/\bminivans?\b|\bminibuses?\b|\b(\d+).?seater\b|\bseater\b|vehicle.{0,20}(type|option|class|size|capacit)|\bcar seat\b|\bchild.{0,10}seat\b|\bchild.?booster\b|\bwheelchair.{0,20}(access|vehicle|friendly)\b|\bwheelchair accessible\b|\baccessible.{0,20}(vehicle|transfer|taxi)\b|\bexecutive.{0,20}(car|vehicle|transfer)\b|\bluxury.{0,20}(car|vehicle|transfer)\b|\bgroup.{0,15}(vehicle|transfer|taxi|transport)\b|\bpassenger(s)?.{0,15}(capacity|max|limit)\b/i.test(text)) return 'Vehicle & Fleet'
  if (/\btaxi|\bcab\b|minicab|rideshare|private (car|vehicle)|\buber\b|careem|lyft|\bbolt\b/i.test(text)) return 'Transfer times'
  if (/\btransfers?\b|\bshuttles?\b/i.test(text)) return 'Transfer times'
  if (/(train|bus|coach|metro|tube|tram|rail).{0,40}(airport|city|centre|center|terminal)|(airport|terminal).{0,40}(train|bus|coach|metro|tube|tram|rail)/i.test(text)) return 'Transfer times'
  if (/(minute|hour|km|mile).{0,25}(airport|terminal|city|centre|station)|(airport|terminal).{0,25}(minute|hour|km|mile)/i.test(text)) return 'Transfer times'
  if (/getting (from|to).{1,30}airport|how long.{1,30}(take|get to|travel|reach|journey)|distance.{1,20}airport|airport.{0,30}(route|distance|journey|drive)|airport express|fast link/i.test(text)) return 'Transfer times'
  if (/things to do|attraction|sightseeing|city cent(re|er)|museum|\bbeach\b|landmark|heritage|cultural|explore|discover|places to|nightlife|\brestaurant\b|holiday destination|holiday.*land|tour(ist|ism)|guide to|local.*guide|visit.{1,20}(city|town|island|country)|resort|famous for/i.test(text)) return 'Destinations'
  if (/private transfers?|book.{1,20}(taxi|cab|shuttle|transfers?|ride)|compare.{1,20}transfers?/i.test(text)) return 'Hoppa booking'
  if (/\bcancel(lation[s]?|led|ling|s|ing)?\b|\brefunds?\b|\bamend(ment)?\b|\bmodif(y|ied|ication)\b|no.?show|free.{0,15}cancel|cancel.{0,15}free|book.{0,20}(ahead|in advance|before arrival)|\bpolic(y|ies)\b.{0,30}(transfer|transport|booking|travel)|\bterms?.{0,10}(condition|cancel|book)/i.test(text)) return 'Booking & Cancellation'
  if (/\bterminal[s]?\b.{0,30}(airport|depart|arriv|flight|gate|number|T\d)|\b(T1|T2|T3|T4|T5)\b|airport.{0,25}(terminal|parking|lounge|facilit|map|layout|level|floor|exit|hall)|\bairport lounge\b|\bparking.{0,20}airport\b|\barrival(s)? hall\b|\bdeparture(s)? (hall|gate|lounge)\b|\bgate number\b|which terminal/i.test(text)) return 'Airport Information'
  if (/meet.{0,10}greet|flight.{0,20}(track|monitor|delay|cancel|late)|driver.{0,20}wait|wait.{0,20}(flight|delay|free|includ)|\bfree.{0,15}wait\b|\bwait(ing)? time\b.{0,15}(free|includ|flight)|name.{0,10}(sign|board|card|plac)|arrival.{0,20}(track|monitor)|pickup.{0,20}(delay|late|track)|flight.{0,20}(cancel|divert).{0,20}(wait|transfer|policy)/i.test(text)) return 'Flight Logistics'
  if (/quick facts.{0,20}(airport|arrival)|airport.{0,25}(code|IATA|is located|is situated|is (a|the) (major|international|regional|closest|nearest|busiest|small|new|newly))|airport (overview|guide|information|facts)|\bFerenc Liszt\b|\bKopernicus\b|(international|regional) airport.{0,30}(located|situated|serves|connect)|\b\w+\s+airport is\b/i.test(text)) return 'Airport Overview'
  if (/\bimmigration\b|\bcustoms\b.{0,30}(queue|check|proced|clear|time|declar)|\bpassport.{0,20}control\b|\bborder.{0,20}(check|control|proced)\b|customs.{0,20}(and|&).{0,20}immigration|immigration.{0,20}(work|proced|queue|check|time)/i.test(text)) return 'Immigration & Customs'
  if (/\d+%.{0,10}(off|discount|saving)|save.{0,15}\d+%|promo.?code|voucher[s]?|discount.?code|sign.{0,8}up.{0,20}(sav|offer|deal)|\bspar\b.{0,20}(penge|nu)|spar penge/i.test(text)) return 'Promotions & Discounts'
  if (/rated by.{0,20}traveller|traveller[s]?.{0,20}(review|say|rate|trust)|trustpilot.{0,20}(rating|score|review)|\d[\s,]*star[s]?.{0,20}(rating|review|experience)|what.{0,15}traveller[s]?.{0,10}say|entirely happy|customer[s]?.{0,20}(review|rating|feedback|say|trust)/i.test(text)) return 'Customer Reviews'
  if (/support.{0,30}(available|round.?the.?clock|24.?7|24 hours)|customer.{0,20}(service|care|support).{0,30}(available|hours|team)|missed.?call[s]?|response.{0,20}time.{0,20}(fast|quick|guaran)|contact.{0,20}(us|team|agent).{0,20}(by|via|through|on)/i.test(text)) return 'Customer Service'
  return 'Other'
}

// ── Fetch all snippets via Supabase function ──────────────────────────────────
async function fetchSnippets() {
  const today = new Date()
  const ninetyDaysAgo = new Date(today)
  ninetyDaysAgo.setDate(today.getDate() - 90)

  const fmt = d => d.toISOString().split('T')[0]

  const { data, error } = await supabase.functions.invoke('ga4-ai-overview', {
    body: {
      propertyId: '259261360',
      dateRanges: [{ startDate: fmt(ninetyDaysAgo), endDate: fmt(today) }],
      filters: { queryType: 'kpis' },
    },
  })

  if (error) throw new Error(error.message)
  return data?.reports?.[0] ?? []
}

// ── Theme-detection for Other snippets ───────────────────────────────────────
function detectTheme(text) {
  const t = text.toLowerCase()
  if (/insur|licens|vetted|crb|dbs|background.?check|safe(ty|r)|trusted.{0,15}driver/.test(t)) return '🔒 Safety & Driver Trust'
  if (/cruise|port.{0,20}transfer|sea.?port|harbour|ferry/.test(t)) return '🚢 Cruise & Port Transfers'
  if (/hotel.{0,20}(pickup|transfer|collect)|collect.{0,15}hotel|hotel.{0,15}airport/.test(t)) return '🏨 Hotel Transfers'
  if (/pay(ment|pal|ing)?|credit card|debit|cash|accept|invoice|card.{0,10}(accept|payment)/.test(t)) return '💳 Payment Methods'
  if (/corporate|business.{0,20}(travel|transfer|account)|account.{0,10}(business|corporate)|business class/.test(t)) return '💼 Corporate Travel'
  if (/wedding|hen|stag|birthday|event.{0,15}(transfer|transport)|concert|festival|sport/.test(t)) return '🎉 Events & Group Travel'
  if (/eco|electric|carbon|sustainab|environment|green.{0,15}(transport|travel|vehicle)|ev.{0,10}(vehicle|car)/.test(t)) return '🌱 Eco & Sustainability'
  if (/driver.{0,20}(speak|english|language|multilin)|english.{0,15}driver|language.{0,15}driver/.test(t)) return '🗣️ Driver Language'
  if (/stop(s|ping|over)?|multi.?stop|via|additional.{0,15}stop|en.?route/.test(t)) return '📍 Multi-Stop Journeys'
  if (/lost.{0,15}(item|property|belong)|found.{0,15}item/.test(t)) return '🔎 Lost & Found'
  if (/comparison|compar(e|ing|ison)|vs\.?|versus|differ(ent|ence).{0,15}(taxi|transfer|shuttle)/.test(t)) return '⚖️ Transfer Comparisons'
  if (/night.{0,15}(transfer|flight|arriv)|early.{0,15}(morning|flight|arriv)|late.{0,15}(night|flight)|24.?hour/.test(t)) return '🌙 Night & Early Morning'
  if (/tip.{0,15}driver|gratuity|\btip\b.{0,10}(includ|expect|requir|custom)/.test(t)) return '💰 Tipping'
  if (/child|infant|baby|toddler|famil/.test(t)) return '👨‍👩‍👧 Family & Child Travel'
  if (/pet|dog|cat|animal/.test(t)) return '🐾 Pet-Friendly Travel'
  if (/app.{0,15}(download|available|book)|mobile.?app|google play|app store/.test(t)) return '📱 App & Technology'
  if (/driv(er|ing).{0,20}(meet|arrival|arriv|sign|wait|outside|collect)/.test(t)) return '🚗 Driver Meeting Point'
  if (/visa|entry.{0,15}(require|rule)|travel.{0,15}document|id.{0,10}(check|require)/.test(t)) return '📋 Travel Documents'
  if (/weather|season|summer|winter|rain|peak.{0,10}season/.test(t)) return '🌤️ Weather & Seasons'
  if (/tip|advice|recommend|suggest|guide|help|what.{0,10}(should|do|to know)/.test(t)) return '💡 General Travel Tips'
  return '❓ Uncategorised'
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🔍 Fetching AI Overview snippets (last 90 days)...\n')

  let rows
  try {
    rows = await fetchSnippets()
  } catch (e) {
    console.error('❌ Failed to fetch:', e.message)
    process.exit(1)
  }

  const SNIPPET_KEY = 'customEvent:ai_overview_click'
  const allSnippets = []

  rows.forEach(row => {
    const text   = row[SNIPPET_KEY] ?? ''
    const events = row.eventCount || 0
    if (text) allSnippets.push({ text, events })
  })

  // Aggregate by snippet (collapse duplicates)
  const agg = {}
  allSnippets.forEach(({ text, events }) => {
    agg[text] = (agg[text] || 0) + events
  })

  const all = Object.entries(agg).map(([text, events]) => ({ text, events, cat: categorise(text) }))
  const total = all.reduce((s, r) => s + r.events, 0)

  // ── Category summary ──────────────────────────────────────────────────────
  console.log('═'.repeat(70))
  console.log('  CATEGORY BREAKDOWN (all snippets)')
  console.log('═'.repeat(70))

  const catTotals = {}
  all.forEach(({ cat, events }) => { catTotals[cat] = (catTotals[cat] || 0) + events })
  Object.entries(catTotals)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, events]) => {
      const pct = ((events / total) * 100).toFixed(1)
      const bar = '█'.repeat(Math.round(pct / 2))
      console.log(`  ${cat.padEnd(28)} ${String(events).padStart(5)} events  ${pct.padStart(5)}%  ${bar}`)
    })

  // ── Other deep dive ───────────────────────────────────────────────────────
  const otherSnippets = all
    .filter(r => r.cat === 'Other')
    .sort((a, b) => b.events - a.events)

  const otherTotal = otherSnippets.reduce((s, r) => s + r.events, 0)
  const otherPct   = ((otherTotal / total) * 100).toFixed(1)

  console.log('\n' + '═'.repeat(70))
  console.log(`  OTHER BUCKET DEEP DIVE  —  ${otherSnippets.length} snippets  /  ${otherTotal} events  (${otherPct}% of total)`)
  console.log('═'.repeat(70))

  // Group by theme
  const themes = {}
  otherSnippets.forEach(r => {
    const theme = detectTheme(r.text)
    if (!themes[theme]) themes[theme] = { events: 0, snippets: [] }
    themes[theme].events += r.events
    themes[theme].snippets.push(r)
  })

  Object.entries(themes)
    .sort((a, b) => b[1].events - a[1].events)
    .forEach(([theme, { events, snippets }]) => {
      const pct = ((events / otherTotal) * 100).toFixed(1)
      console.log(`\n  ${theme}  —  ${events} events (${pct}% of Other)`)
      snippets.slice(0, 5).forEach(({ text, events: ev }) => {
        const preview = text.length > 90 ? text.slice(0, 87) + '...' : text
        console.log(`    [${String(ev).padStart(4)}]  ${preview}`)
      })
      if (snippets.length > 5) console.log(`    ... and ${snippets.length - 5} more snippets`)
    })

  // ── Top Other snippets by volume ──────────────────────────────────────────
  console.log('\n' + '═'.repeat(70))
  console.log('  TOP 30 "OTHER" SNIPPETS BY EVENT COUNT')
  console.log('═'.repeat(70))
  otherSnippets.slice(0, 30).forEach(({ text, events: ev }, i) => {
    const preview = text.length > 80 ? text.slice(0, 77) + '...' : text
    console.log(`  ${String(i+1).padStart(2)}. [${String(ev).padStart(4)}]  ${preview}`)
  })

  console.log('\n✅ Done.\n')
}

main()
