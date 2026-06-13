/**
 * Page load time benchmark — mirrors exactly what each dashboard page fetches.
 * Run: node scripts/page-load-bench.js
 *
 * For each page it fires the same GA4 edge function calls the React app makes,
 * in the same parallel/sequential pattern, and reports:
 *   - Total wall-clock time (what the user waits)
 *   - Per-call breakdown (which query was slow)
 *   - Cache status (HIT / MISS)
 */

const SUPABASE_URL = 'https://fpwgnceigulqonjdzfbo.supabase.co'
const ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZwd2duY2VpZ3VscW9uamR6ZmJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NDkyNzMsImV4cCI6MjA5MDAyNTI3M30.-F2XWED7EEku2aCUmNsom8KG8jCLueLimpRdBSXYtHQ'
const PROPERTY_ID  = '259261360'
const URL          = `${SUPABASE_URL}/functions/v1/ga4-query_affiliates`

// ─── Date helpers ─────────────────────────────────────────────────────────────
const today  = new Date()
const fmt    = d => d.toISOString().slice(0, 10)
const ago    = n => { const d = new Date(today); d.setDate(d.getDate() - n); return fmt(d) }
const SOM    = fmt(new Date(today.getFullYear(), today.getMonth(), 1))
const EOLM   = fmt(new Date(today.getFullYear(), today.getMonth(), 0))
const SOLM   = fmt(new Date(today.getFullYear(), today.getMonth() - 1, 1))

const LAST_30 = [{ startDate: ago(30), endDate: fmt(today) }, { startDate: ago(60), endDate: ago(31) }]
const LAST_7  = [{ startDate: ago(7),  endDate: fmt(today) }, { startDate: ago(14), endDate: ago(8) }]

// ─── Single GA4 call ──────────────────────────────────────────────────────────
async function callGA4(page, dateRanges = LAST_30, filters = {}) {
  const t0 = performance.now()
  const res = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ page, propertyId: PROPERTY_ID, dateRanges, filters }),
  })
  const ms = Math.round(performance.now() - t0)
  const data = await res.json()

  if (!res.ok || data.error) {
    return { page, ms, ok: false, error: data.error ?? `HTTP ${res.status}`, cached: false }
  }
  return {
    page,
    ms,
    ok:     true,
    cached: data._cached ?? false,
    stale:  data._stale  ?? false,
    rows:   (data.reports ?? []).reduce((s, r) => s + (Array.isArray(r) ? r.length : 0), 0),
  }
}

// ─── Page definitions — mirrors exactly what the React pages call ─────────────
// Each entry: { name, label, calls: [{ page, dateRanges?, parallel? }] }
// parallel=true means those calls fire simultaneously (Promise.all), like the app.

const PAGES = [
  {
    name: '/',
    label: 'Executive Summary',
    // getExecutiveSummary calls executive + scorecard in parallel
    parallel: ['executive', 'scorecard'],
  },
  {
    name: '/scorecard',
    label: 'Affiliate Scorecard',
    parallel: ['scorecard'],
  },
  {
    name: '/traffic',
    label: 'Traffic & Engagement',
    // getTrafficEngagement calls traffic + commercial in parallel
    parallel: ['traffic', 'commercial'],
  },
  {
    name: '/commercial',
    label: 'Commercial Performance',
    parallel: ['commercial'],
  },
  {
    name: '/funnel',
    label: 'Funnel Analysis',
    parallel: ['funnel'],
  },
  {
    name: '/destinations',
    label: 'Destination Intelligence',
    parallel: ['destinations'],
  },
  {
    name: '/llm',
    label: 'LLM Intelligence',
    parallel: ['llm'],
  },
  {
    name: '/llm-deep-dive',
    label: 'LLM Deep Dive (pages)',
    parallel: ['llm-pages'],
  },
  {
    name: '/ai-overview',
    label: 'AI Overview',
    // ai-overview fires 3 queries: kpis, trend, device
    parallel: ['ai-overview:kpis', 'ai-overview:trend', 'ai-overview:device'],
  },
]

// ─── Colour helpers ───────────────────────────────────────────────────────────
const GREEN  = s => `\x1b[32m${s}\x1b[0m`
const YELLOW = s => `\x1b[33m${s}\x1b[0m`
const RED    = s => `\x1b[31m${s}\x1b[0m`
const BOLD   = s => `\x1b[1m${s}\x1b[0m`
const DIM    = s => `\x1b[2m${s}\x1b[0m`

function msColour(ms) {
  if (ms < 500)  return GREEN(`${ms}ms`)
  if (ms < 2000) return YELLOW(`${ms}ms`)
  return RED(`${ms}ms`)
}

function cacheTag(r) {
  if (!r.ok) return RED('ERROR')
  if (r.cached && r.stale) return YELLOW('STALE')
  if (r.cached) return GREEN('HIT  ')
  return RED('MISS ')
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log()
  console.log(BOLD('━━━ Dashboard Page Load Benchmark ━━━'))
  console.log(DIM(`Property: ${PROPERTY_ID}  |  Date range: ${LAST_30[0].startDate} → ${LAST_30[0].endDate} (30d + comparison)`))
  console.log(DIM(`Supabase: ${SUPABASE_URL}`))
  console.log()

  const summary = []

  for (const pg of PAGES) {
    process.stdout.write(`  ${pg.name.padEnd(18)} ${pg.label}\n`)

    const pageStart = performance.now()
    const calls = pg.parallel.map(rawPage => {
      // ai-overview pages embed queryType as a suffix
      const [page, queryType] = rawPage.split(':')
      const filters = queryType ? { queryType } : {}
      return callGA4(page, LAST_30, filters)
    })

    const results = await Promise.all(calls)
    const pageMs  = Math.round(performance.now() - pageStart)

    for (const r of results) {
      const tag = cacheTag(r)
      const rowStr = r.ok ? DIM(`${r.rows} rows`) : ''
      console.log(`    ${tag}  ${msColour(r.ms).padEnd(12)}  ${r.page}  ${rowStr}`)
      if (!r.ok) console.log(`    ${RED('↳ ' + r.error)}`)
    }

    const allCached = results.every(r => r.cached)
    const anyError  = results.some(r => !r.ok)
    const wallLabel = anyError ? RED(`${pageMs}ms`) : allCached ? GREEN(`${pageMs}ms`) : YELLOW(`${pageMs}ms`)
    console.log(`    ${'─'.repeat(40)}`)
    console.log(`    Total wall-clock: ${wallLabel}  ${allCached ? DIM('(fully cached)') : anyError ? RED('(error)') : YELLOW('(cache miss)')}\n`)

    summary.push({ route: pg.name, label: pg.label, ms: pageMs, cached: allCached, error: anyError })
  }

  // ─── Summary table ───────────────────────────────────────────────────────
  console.log(BOLD('━━━ Summary ━━━'))
  console.log()
  console.log(`  ${'Route'.padEnd(20)} ${'Page'.padEnd(28)} ${'Time'.padEnd(10)} Status`)
  console.log(`  ${'─'.repeat(70)}`)
  for (const s of summary) {
    const timeStr = s.error ? RED(`${s.ms}ms`) : s.cached ? GREEN(`${s.ms}ms`) : YELLOW(`${s.ms}ms`)
    const status  = s.error ? RED('ERROR') : s.cached ? GREEN('cached') : YELLOW('live GA4')
    console.log(`  ${s.route.padEnd(20)} ${s.label.padEnd(28)} ${timeStr.padEnd(18)} ${status}`)
  }
  console.log()

  const avgMs = Math.round(summary.reduce((s, r) => s + r.ms, 0) / summary.length)
  const cacheHitRate = Math.round(summary.filter(s => s.cached).length / summary.length * 100)
  console.log(`  Average page load:  ${msColour(avgMs)}`)
  console.log(`  Cache hit rate:     ${cacheHitRate >= 80 ? GREEN(cacheHitRate + '%') : YELLOW(cacheHitRate + '%')}`)
  console.log()
}

main().catch(console.error)
