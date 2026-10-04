// Acceptance tests for the Countries page (Brief 02 §7).
// Fixtures are real BigQuery results for as_of = 2026-09-28 08:30 UTC, captured with
// scripts/profitability/acceptance-sql.ts (modes: countries, country-invariants, countries-top).
import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import {
  computeCountriesOnce, countriesPage, countryChecks, mapCountries, mapCountryMonthly, parseRegion,
} from '../../supabase/functions/_shared/profitability/countries.ts'
import { toCents } from '../../supabase/functions/_shared/profitability/payload.ts'
import type { Runner } from '../../supabase/functions/_shared/profitability/pinned.ts'
import type { PeriodKey } from '../../supabase/functions/_shared/profitability/time.ts'
import {
  header, kpis, top15, bubbles, selectedCountry, trend, table, sparkline, median, UNMAPPED,
} from '../../src/pages/profitability/countriesModel.js'
import { pct, signedPct, pts, perTrip, tableMoney } from '../../src/pages/profitability/format.js'
import { sortRows, filterRows, defaultDir } from '../../src/pages/profitability/tableSort.js'

const dir = new URL('../../supabase/functions/_shared/profitability/testdata/', import.meta.url)
const read = (f: string) => JSON.parse(Deno.readTextFileSync(new URL(f, dir)))
const SUMMARY = read('2026-09-28T08-30Z_countries_ytd_summary.json')
const INV = read('2026-09-28T08-30Z_countries_ytd_invariants.json')
const TOP = read('2026-09-28T08-30Z_countries_other_periods_top.json')
const ES_YTD = read('2026-09-28T08-30Z_ytd.json')
const ES_OTHER = read('2026-09-28T08-30Z_other_periods.json')
const AS_OF = Date.parse('2026-09-28T08:30:00Z')

// Compact fixture rows → the row shape country_summary / country_monthly return.
const summaryRow = (a: string[]) => ({
  country: a[0], main_region: a[1] || null, all_regions: a[2] || null,
  p_revenue: a[3], p_cost: a[4], p_trips: a[5], cc_revenue: a[6], cc_cost: a[7], cc_trips: a[8],
  cp_revenue: a[9], cp_cost: a[10], cp_trips: a[11],
})
const monthlyRow = (a: string[]) => ({ month: `${a[0]}-01`, country: a[1], revenue: a[2], cost: a[3], trips: a[4] })

function runner(period: PeriodKey, summary: string[][], monthly: string[][]): Runner {
  return async (name) => {
    if (name === 'country_summary') return summary.map(summaryRow)
    if (name === 'country_monthly') return monthly.map(monthlyRow)
    if (name === 'kpi_totals') return period === 'ytd' ? ES_YTD.kpi_totals : [ES_OTHER.kpi_totals_by_period[period]]
    if (name === 'by_region') return ES_YTD.by_region
    return []
  }
}
// YTD with the real full summary and monthly rows for five countries (the full 1,293 monthly
// rows are verified inside BigQuery — see the invariants tests below).
const ytd = () => computeCountriesOnce('ytd', '', AS_OF, AS_OF, runner('ytd', SUMMARY, INV.sample_monthly))
// Top-N captures carry one '(all others)' row; treating it as Unmapped keeps it in the page
// total but out of rankings — exactly how the model treats Unmapped.
const topPeriod = (period: 'last_year' | 'mtd') =>
  computeCountriesOnce(period, '', AS_OF, AS_OF,
    runner(period, TOP[period].map((a: string[]) => (a[0] === '(all others)' ? [UNMAPPED, ...a.slice(1)] : a)), []))

Deno.test('7.1 Year to date top 15 by period Total Profit', async () => {
  const d = await ytd()
  const t = table(d)
  const top = t.rows.filter((r: any) => !r.unmapped).sort((a: any, b: any) => b.profit - a.profit).slice(0, 15)
  assertEquals(top.map((r: any) => [r.country, r.main_region, r.p_trips, r.p_revenue, r.p_cost, r.profit,
    (r.margin * 100).toFixed(2), perTrip(r.ppt), signedPct(r.yoy).text, pts(r.mpts).text]), [
    ['United States', 'America & LATAM', 182951, 907002527, 710916877, 196085650, '21.62', '$10.72', '-8.4%', '-0.9 pts'],
    ['Spain', 'Europe', 102757, 649505093, 480102809, 169402284, '26.08', '$16.49', '+84.7%', '+10.2 pts'],
    ['Turkey', 'Turkey & others', 101887, 364725256, 277290140, 87435116, '23.97', '$8.58', '+16.2%', '-6.2 pts'],
    ['Italy', 'Southeast Asia & Rest of Italy', 37580, 353647211, 287980048, 65667163, '18.57', '$17.47', '+93.9%', '+2.0 pts'],
    ['Japan', 'Rest of Asia, Africa & Oceania', 41103, 224622164, 172552927, 52069237, '23.18', '$12.67', '-0.7%', '-0.7 pts'],
    ['Egypt', 'Rest of Asia, Africa & Oceania', 132888, 137236682, 88551085, 48685597, '35.48', '$3.66', '+139.6%', '+3.0 pts'],
    ['France', 'Europe', 30245, 200748029, 152748744, 47999285, '23.91', '$15.87', '-19.9%', '-0.4 pts'],
    ['Mexico', 'America & LATAM', 41718, 142115152, 99595467, 42519685, '29.92', '$10.19', '+77.6%', '+12.2 pts'],
    ['United Kingdom', 'Rest of Asia, Africa & Oceania', 22430, 201018626, 164606554, 36412072, '18.11', '$16.23', '+69.1%', '-0.7 pts'],
    ['Australia', 'Rest of Asia, Africa & Oceania', 34689, 156992676, 125049034, 31943642, '20.35', '$9.21', '+111.8%', '+6.5 pts'],
    ['Malaysia', 'Southeast Asia & Rest of Italy', 67975, 130485191, 99638475, 30846716, '23.64', '$4.54', '+55.3%', '+5.2 pts'],
    ['Canada', 'Rest of Asia, Africa & Oceania', 19084, 94879074, 65031736, 29847338, '31.46', '$15.64', '+17.9%', '-3.0 pts'],
    ['Vietnam', 'Southeast Asia & Rest of Italy', 133198, 122966439, 95169281, 27797158, '22.61', '$2.09', '+34.8%', '-4.7 pts'],
    ['Thailand', 'Southeast Asia & Rest of Italy', 704723, 262662437, 235803158, 26859279, '10.23', '$0.38', '+18.7%', '-13.9 pts'],
    ['Portugal', 'Europe', 28648, 96026200, 69522117, 26504083, '27.60', '$9.25', '+5.7%', '+9.4 pts'],
  ])
  // Region shown exactly as in the source; multi-region countries get "+k" and a tooltip.
  const italy = t.rows.find((r: any) => r.country === 'Italy')
  assertEquals([italy.regionLabel, italy.regionTitle],
    ['Southeast Asia & Rest of Italy +1', 'Trips in: Southeast Asia & Rest of Italy, America & LATAM'])
  const uk = t.rows.find((r: any) => r.country === 'United Kingdom')
  assertEquals([uk.regionLabel, uk.regionTitle], ['Rest of Asia, Africa & Oceania', null])
})

Deno.test('7.2 Top 15 chart: ranked by the comparison window', async () => {
  const c = top15(await ytd())
  assertEquals(c.subtitle, 'Jan–Aug 2026 vs Jan–Aug 2025, complete months')
  assertEquals(c.datasets.map((x: any) => x.label), ['Total Profit, Jan–Aug 2026', 'Same months last year, Jan–Aug 2025'])
  assertEquals(c.rows.map((r: any) => [r.country, r.ccProfit, r.cpProfit, signedPct(r.yoy).text]), [
    ['United States', 174828859, 190809296, '-8.4%'],
    ['Spain', 147258838, 79748331, '+84.7%'],
    ['Turkey', 74779075, 64368305, '+16.2%'],
    ['Italy', 56140983, 28956608, '+93.9%'],
    ['Japan', 47486544, 47806233, '-0.7%'],
    ['Egypt', 42950597, 17928209, '+139.6%'],
    ['France', 42242586, 52767045, '-19.9%'],
    ['Mexico', 38854940, 21878599, '+77.6%'],
    ['United Kingdom', 31951074, 18897308, '+69.1%'],
    ['Australia', 28890120, 13637519, '+111.8%'],
    ['Malaysia', 27569128, 17749681, '+55.3%'],
    ['Vietnam', 25828625, 19163941, '+34.8%'],
    ['Canada', 25014772, 21221411, '+17.9%'],
    ['Thailand', 24783709, 20876168, '+18.7%'],
    ['Portugal', 22673675, 21442224, '+5.7%'],
  ])
  assertEquals(c.tooltip(0), ['Total Profit $1,748,289', 'Same months last year $1,908,093', 'Change -8.4%'])
  assertEquals(c.datasets[0].values[0], 1748288.59)
})

Deno.test('7.3 KPI cards, Year to date, All regions', async () => {
  const d = await ytd()
  const k = kpis(d)
  assertEquals(k.P, 1256372199) // $12,563,721.99 — same as the Executive Summary
  const [withTrips, largest, top5, growing, loss] = k.cards as any[]
  assertEquals(largest.value, '15.6%')
  assertEquals(largest.sub, 'United States · $1.96M')
  assertEquals(top5.value, '45.4%')
  assertEquals(top5.sub, 'United States, Spain, Turkey, Italy, Japan')
  const top10 = k.ranked.slice(0, 10).reduce((a: number, r: any) => a + r.profit, 0)
  assertEquals(pct(top10 / k.P), '61.9%')
  // Countries with trips = table rows excluding Unmapped.
  assertEquals(withTrips.value, String(table(d).rows.filter((r: any) => !r.unmapped).length))
  assertEquals(withTrips.value, '167')
  assertEquals(withTrips.sub2, '165 last year')
  // Brief: 44 of the 50 largest countries (by period revenue) grew.
  const largest50 = k.ranked.slice().sort((a: any, b: any) => b.p_revenue - a.p_revenue).slice(0, 50)
  assertEquals(largest50.filter((r: any) => r.ccProfit > r.cpProfit).length, 44)
  assertEquals([growing.value, growing.sub], ['58 of 86', 'Total Profit up vs Jan–Aug 2025'])
  assertEquals(growing.sub2, '$2.88M gained · $481k lost')
  assertEquals([growing.gains, growing.falls], [288359955, -48141728]) // cross-checked with Python Decimal
  // No loss-maker among the 50 largest; Laos (outside them) loses money on > $5k revenue.
  assertEquals(largest50.filter((r: any) => r.profit < 0).length, 0)
  assertEquals([loss.value, loss.tone, loss.sub, loss.names], ['1', 'down', 'Total loss $-1,662', ['Laos']])
  // Lowest margins among the 50 largest.
  assertEquals(largest50.slice().sort((a: any, b: any) => a.margin - b.margin).slice(0, 5)
    .map((r: any) => [r.country, (r.margin * 100).toFixed(2)]),
  [['Thailand', '10.23'], ['South Korea', '15.04'], ['Netherlands', '16.69'], ['Peru', '17.69'], ['United Kingdom', '18.11']])
  assertEquals(header(d), {
    title: 'Countries',
    badge: 'Data as of 2026-09-28',
    badgeTooltip: 'Pinned 2026-09-28 08:30 UTC · warehouse load 2026-09-28 08:14 UTC',
    subtitle: '2026 to date profit by pickup country, vs Jan–Aug 2025 (complete months).',
    sectionLabel: '2026 TO DATE — TOTAL PROFIT BY COUNTRY',
  })
})

Deno.test('7.3 table totals equal the Executive Summary KPIs', async () => {
  const t = table(await ytd())
  assertEquals([t.total.trips, t.total.revenue, t.total.cost, t.total.profit], [2118428, 5432963559, 4176591360, 1256372199])
  assertEquals([tableMoney(t.total.profit), pct(t.total.margin), perTrip(t.total.ppt), signedPct(t.total.yoy).text, pts(t.total.mpts).text],
    ['$12,563,722', '23.1%', '$5.93', '+27.6%', '+1.5 pts'])
  // Countries that stopped trading are not listed.
  assertEquals(t.rows.some((r: any) => ['Benin', 'Bhutan', 'São Tomé and Príncipe'].includes(r.country)), false)
  assertEquals(t.rows.find((r: any) => r.country === 'Cook Islands')?.p_trips, 2) // traded, $0 revenue — listed
})

Deno.test('7.4 Last year (2025)', async () => {
  const d = await topPeriod('last_year')
  const k = kpis(d)
  assertEquals(k.P, 1388401962) // $13,884,019.62 — Executive Summary total for 2025
  assertEquals(k.cards[1].value, '20.2%')
  assertEquals(k.cards[1].sub, 'United States · $2.81M')
  assertEquals(k.ranked.slice(0, 10).map((r: any) => [r.country, tableMoney(r.profit), (r.margin * 100).toFixed(2), signedPct(r.yoy).text]), [
    ['United States', '$2,805,861', '22.26', '-10.8%'],
    ['Spain', '$1,421,066', '18.69', '+1185.0%'],
    ['Turkey', '$927,056', '28.79', '+46.6%'],
    ['France', '$844,123', '24.34', '+92.7%'],
    ['Japan', '$686,049', '22.85', '+31.3%'],
    ['Italy', '$501,617', '17.31', '+94.2%'],
    ['Mexico', '$382,415', '19.35', '+15.1%'],
    ['Egypt', '$368,357', '32.78', '+406.2%'],
    ['United Kingdom', '$328,152', '19.30', '+94.3%'],
    ['Thailand', '$317,734', '20.51', '-11.0%'],
  ])
  assertEquals(k.ranked[0].profit, 280586097) // exact $2,805,860.97
  assertEquals(k.ranked[1].profit, 142106551) // exact $1,421,065.51
  assertEquals(top15(d).subtitle, '2025 vs 2024, complete months')
})

Deno.test('7.4 Month to date (1–28 Sep 2026)', async () => {
  const d = await topPeriod('mtd')
  const k = kpis(d)
  assertEquals(k.P, 145052260) // $1,450,522.60 — Executive Summary MTD total
  assertEquals(k.ranked.slice(0, 5).map((r: any) => [r.country, r.p_revenue, r.p_cost, r.profit, r.p_trips]), [
    ['Spain', 88042058, 65898612, 22143446, 13460],
    ['United States', 99375834, 78119043, 21256791, 20464],
    ['Turkey', 55684568, 43028527, 12656041, 14651],
    ['Italy', 51865550, 42339370, 9526180, 5144],
    ['France', 24491159, 18734460, 5756699, 3805],
  ])
  // No comparison: single blue dataset ranked by period profit; no growing card; no YoY columns.
  const c = top15(d)
  assertEquals([c.subtitle, c.datasets.length, c.datasets[0].label, c.labels[0]], ['Selected period', 1, 'Total Profit', 'Spain'])
  assertEquals([k.cards[3].value, k.cards[3].sub], ['—', 'No comparison for this period'])
  assertEquals(table(d).showYoy, false)
  assertEquals(header(d).subtitle, 'September 2026 to date profit by pickup country.')
})

Deno.test('7.5 invariants 1–3: countries add back to Executive Summary totals, by region', () => {
  const t = Object.fromEntries(INV.region_totals.map((r: any) => [r.region, [toCents(r.revenue), toCents(r.cost), r.trips]]))
  // 1. All regions = Executive Summary KPI totals.
  const k = ES_YTD.kpi_totals[0]
  assertEquals(t[''], [toCents(k.p_revenue), toCents(k.p_cost), k.p_trips])
  // 2. Each region = its Executive Summary region-table row; Europe as in the brief.
  for (const r of ES_YTD.by_region) assertEquals(t[r.name], [toCents(r.p_revenue), toCents(r.p_cost), r.p_trips], r.name)
  assertEquals(t['Europe'], [1224971683, 919018371, 197792])
  // 3. Σ over regions run separately = All regions.
  const regions = Object.entries(t).filter(([name]) => name !== '')
  assertEquals(regions.length, 6)
  assertEquals([0, 1, 2].map((i) => regions.reduce((a, [, v]: any) => a + v[i], 0)), t[''])
})

Deno.test('7.5 invariants 4–5: country months', async () => {
  // 4. Every country's months add up to its summary row (checked in BigQuery over all 1,293 rows).
  assertEquals([INV.monthly_mismatch_all, INV.monthly_mismatch_europe], [0, 0])
  // 5. Σ countries per month = Executive Summary monthly series (Brief 01 §11.5).
  const es = new Map<string, number[]>()
  for (const r of ES_YTD.monthly_by_product_line) {
    const a = es.get(r.month) ?? [0, 0, 0]
    es.set(r.month, [a[0] + toCents(r.revenue), a[1] + toCents(r.cost), a[2] + r.trips])
  }
  assertEquals(INV.monthly_all_countries.map((r: any) => [r.month, toCents(r.revenue), toCents(r.cost), r.trips]),
    [...es.entries()].map(([m, v]) => [m, ...v]))
  // The same checks run inside the endpoint on every load.
  const countries = mapCountries(SUMMARY.map(summaryRow))
  const monthsAsRows = INV.monthly_all_countries.map((r: any) => ({ month: r.month, country: '*', revenue: r.revenue, cost: r.cost, trips: String(r.trips) }))
  const kpi = { revenue: toCents(ES_YTD.kpi_totals[0].p_revenue), cost: toCents(ES_YTD.kpi_totals[0].p_cost), trips: ES_YTD.kpi_totals[0].p_trips }
  assertEquals(countryChecks(countries, mapCountryMonthly(monthsAsRows), kpi, 'ES').map((c) => c.ok), [true, true])
  const broken = mapCountryMonthly(monthsAsRows.slice(1))
  assertEquals(countryChecks(countries, broken, kpi, 'ES').map((c) => c.ok), [true, false])
  // Sampled countries: months sum to the summary row.
  const d = await ytd()
  for (const c of ['United States', 'Spain', 'Italy', 'Thailand', 'Laos']) {
    const tr = trend(d, c)!, row = d.countries.find((r) => r.country === c)!
    assertEquals([tr.totals.revenue, tr.totals.cost, tr.totals.trips], [row.p_revenue, row.p_cost, row.p_trips], c)
  }
})

Deno.test('7.5 invariant 6: margin = Σprofit ÷ Σrevenue of the rows shown', async () => {
  const d = await ytd()
  const t = table(d)
  assertEquals(t.total.margin, t.total.profit / t.total.revenue)
  for (const r of t.rows) if (r.p_revenue) assertEquals(r.margin, r.profit / r.p_revenue)
})

Deno.test('7.5 invariant 7: identical payloads for the same as_of', async () => {
  assertEquals(await ytd(), await ytd())
})

Deno.test('endpoint: consistency failure retries once, then flags', async () => {
  const good = runner('ytd', SUMMARY, INV.sample_monthly)
  const seen: number[] = []
  const r = await countriesPage('ytd', '', AS_OF, async (n, s, pr, p) => { seen.push(p.as_of_ms); return good(n, s, pr, p) }, () => {})
  // Only 5 countries' months are in the fixture, so "country months = countries" fails both times.
  assertEquals([r.status, r.retried, new Set(seen).size], ['inconsistent', true, 2])
  assertEquals(r.data.checks.map((c) => c.ok), [true, false])
  const empty = await countriesPage('ytd', '', AS_OF, async (n) => (n === 'kpi_totals' ? [{ p_trips: '0' }] : []), () => {})
  assertEquals(empty.status, 'reloading')
})

Deno.test('region filter: checked against the region row; bad values rejected', async () => {
  const europe = SUMMARY.filter((a: string[]) => a[1] === 'Europe') // shape only; totals checked above in BigQuery
  const d = await computeCountriesOnce('ytd', 'Europe', AS_OF, AS_OF, runner('ytd', europe, []))
  assertEquals(d.region, 'Europe')
  assertEquals(d.checks[0].name, 'countries = Executive Summary region row (Europe)')
  assertEquals(header(d).subtitle, '2026 to date profit by pickup country, vs Jan–Aug 2025 (complete months). Region: Europe.')
  assertEquals(parseRegion(''), '')
  assertEquals(parseRegion('Turkey & others'), 'Turkey & others')
  assertThrows(() => parseRegion('Europe; DROP TABLE'))
  assertThrows(() => parseRegion('europe'))
})

Deno.test('bubble chart', async () => {
  const b = bubbles(await ytd())
  const all = (await ytd()).countries.filter((r) => r.p_trips > 0 && r.country !== UNMAPPED && r.p_revenue >= 1_000_000)
  assertEquals(b.points.length, all.length)
  assertEquals(b.points.some((p: any) => p.country === UNMAPPED), false)
  const us = b.points.find((p: any) => p.country === 'United States')
  assertEquals([us.x, us.y, us.color], [9070025.27, 21.62, '#2D5BA6'])
  const th = b.points.find((p: any) => p.country === 'Thailand')
  assertEquals(th.r, 21) // most trips → 3 + 18
  assertEquals(b.medianX, median(b.points.map((p: any) => p.x)))
  assertEquals(median([1, 3, 2]), 2)
  assertEquals(median([1, 2, 3, 4]), 2.5)
  assertEquals(b.legend.map((l: any) => l.name), ['America & LATAM', 'Europe', 'Rest of Asia, Africa & Oceania', 'Southeast Asia & Rest of Italy', 'Turkey & others'])
})

Deno.test('monthly trend and selection', async () => {
  const d = await ytd()
  assertEquals(selectedCountry(d, null), 'United States')
  assertEquals(selectedCountry(d, 'Spain'), 'Spain')
  assertEquals(selectedCountry(d, 'Atlantis'), 'United States')
  assertEquals(selectedCountry(d, 'Benin'), 'United States') // stopped trading → not selectable
  const us = trend(d, 'United States')!
  assertEquals(us.title, 'Monthly trend: United States')
  assertEquals(us.labels, ["Jan '26", "Feb '26", "Mar '26", "Apr '26", "May '26", "Jun '26", "Jul '26", "Aug '26", "Sep '26 (to date)"])
  assertEquals(us.current.at(-1), true)
  assertEquals(us.stat, [['Total Profit', '$1.96M'], ['Margin', '21.6%'], ['Trips', '182,951'], ['Profit vs last year', '-8.4%']])
  // Laos: April is a loss month.
  const laos = trend(d, 'Laos')!
  assertEquals(laos.profit[3], -3309.83)
  // A country with no captured months is zero-filled, keeping the axis continuous.
  const gabon = trend(d, 'Gabon')!
  assertEquals([gabon.labels.length, gabon.revenue.every((v: number) => v === 0)], [9, true])
})

Deno.test('table: search, sort, Unmapped pinned last, sparkline', async () => {
  const t = table(await ytd())
  const pin = (r: any) => r.unmapped
  const byProfit = sortRows(t.rows, (r: any) => r.profit, -1, pin)
  assertEquals(byProfit[0].country, 'United States')
  assertEquals(byProfit.at(-1).country, UNMAPPED)
  const asc = sortRows(t.rows, (r: any) => r.profit, 1, pin)
  assertEquals(asc[0].country, 'Laos')
  assertEquals(asc.at(-1).country, UNMAPPED)
  assertEquals(sortRows(t.rows, (r: any) => r.country, 1, pin).at(-1).country, UNMAPPED)
  assertEquals([defaultDir('x'), defaultDir(1)], [1, -1])
  const q = filterRows(t.rows, 'europe', [(r: any) => r.country, (r: any) => r.regionLabel])
  assertEquals(q.every((r: any) => r.regionLabel.includes('Europe')), true)
  assertEquals(filterRows(t.rows, 'ital', [(r: any) => r.country]).map((r: any) => r.country), ['Italy'])
  const s = sparkline([-1, 2, 3])!
  assertEquals(s.negative, false)
  assertEquals(sparkline([1, -2])!.negative, true)
  assertEquals(sparkline([5, 5])!.zeroY, '21.0') // range always includes 0
})

Deno.test('empty region/period selection', async () => {
  const d = await computeCountriesOnce('mtd', 'Unmapped', AS_OF, AS_OF, runner('mtd', [], []))
  const k = kpis(d)
  assertEquals([k.cards[0].value, k.cards[1].value, k.cards[1].sub, k.cards[2].value], ['0', '—', 'No trips in this selection.', '—'])
  assertEquals(selectedCountry(d, null), null)
  assertEquals(top15(d).rows.length, 0)
  assertEquals(bubbles(d).points.length, 0)
})
