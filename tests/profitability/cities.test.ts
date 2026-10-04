// Acceptance tests for the Cities page (Brief 03 §7).
// Fixtures are real BigQuery results for as_of = 2026-09-28 08:30 UTC captured with
// scripts/profitability/acceptance-sql.ts (modes: cities-fixture, city-invariants, cities-top).
// The YTD fixture holds every row the rankings and charts depend on in full; the other 1,013
// rows are folded into "(no service area)" so page totals stay exact. Counts over *all*
// cities (cities with trips, 80% N, loss-makers) are cross-checked against values computed
// independently in BigQuery.
import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import {
  computeCitiesOnce, citiesPage, cityChecks, alignMonthly, mapCities, parseCountry,
} from '../../supabase/functions/_shared/profitability/cities.ts'
import { toCents } from '../../supabase/functions/_shared/profitability/payload.ts'
import type { Runner } from '../../supabase/functions/_shared/profitability/pinned.ts'
import type { PeriodKey } from '../../supabase/functions/_shared/profitability/time.ts'
import {
  cityLabel, uniqueLabels, header, kpis, top15, lowestMargin, pareto, selectedCity, trend, table, citiesFor80,
  NO_SERVICE_AREA, LOW_MARGIN_EMPTY,
} from '../../src/pages/profitability/citiesModel.js'
import { pct, signedPct, pts, perTrip, tableMoney } from '../../src/pages/profitability/format.js'
import { sortRows, filterRows } from '../../src/pages/profitability/tableSort.js'

const dir = new URL('../../supabase/functions/_shared/profitability/testdata/', import.meta.url)
const read = (f: string) => JSON.parse(Deno.readTextFileSync(new URL(f, dir)))
const CY = read('2026-09-28T08-30Z_cities_ytd.json')
const CTOP = read('2026-09-28T08-30Z_cities_other_periods_top.json')
const COUNTRIES_YTD = read('2026-09-28T08-30Z_countries_ytd_summary.json')
const ES_YTD = read('2026-09-28T08-30Z_ytd.json')
const ES_OTHER = read('2026-09-28T08-30Z_other_periods.json')
const AS_OF = Date.parse('2026-09-28T08:30:00Z')

const cityRow = (a: string[]) => ({
  sa_id: a[0], sa_name: a[1], country: a[2], region: a[3],
  p_revenue: a[4], p_cost: a[5], p_trips: a[6], cc_revenue: a[7], cc_cost: a[8], cc_trips: a[9],
  cp_revenue: a[10], cp_cost: a[11], cp_trips: a[12],
})
const foldedRow = (f: string[]) => cityRow(['-1', '(no service area)', 'Unmapped', 'Unmapped', ...f])
const countryRow = (a: string[]) => ({
  country: a[0], main_region: a[1] || null, all_regions: a[2] || null,
  p_revenue: a[3], p_cost: a[4], p_trips: a[5], cc_revenue: a[6], cc_cost: a[7], cc_trips: a[8],
  cp_revenue: a[9], cp_cost: a[10], cp_trips: a[11],
})
const monthRow = (a: string[]) => ({ sa_id: a[0], month: a[1], revenue: a[2], cost: a[3], trips: a[4] })

function runner(period: PeriodKey, cities: object[], monthly: object[]): Runner {
  return async (name) => {
    if (name === 'city_summary') return cities as any
    if (name === 'city_monthly') return monthly as any
    if (name === 'country_summary') return COUNTRIES_YTD.map(countryRow)
    if (name === 'kpi_totals') return period === 'ytd' ? ES_YTD.kpi_totals : [ES_OTHER.kpi_totals_by_period[period]]
    if (name === 'by_region') return ES_YTD.by_region
    return []
  }
}
const YTD_ROWS = [...CY.detailed.map(cityRow), foldedRow(CY.folded)]
const SAMPLE_MONTHS = CY.sample_monthly.map(monthRow)
const ytd = (region = '', country = '', rows = YTD_ROWS) =>
  computeCitiesOnce('ytd', region, country, AS_OF, AS_OF, runner('ytd', rows, SAMPLE_MONTHS))
const topPeriod = (period: 'last_year' | 'mtd') =>
  computeCitiesOnce(period, '', '', AS_OF, AS_OF,
    runner(period, [...CTOP[period].detailed.map(cityRow), foldedRow(CTOP[period].folded)], []))

Deno.test('label cleaning (§1.1) — display only', () => {
  assertEquals([
    'New York,USA', 'Tokyo, Japan', 'Seoul,Korean', 'Huntsville, AL, USA', 'HHN,Frankfurt',
    'Dubai-DWC,United Arab Emirates', 'Tenerife South Spain', 'Singapore', 'Washington DC',
    'Santa Cruz%EF%BC%8CBolivia', 'Shizuoka，Japan', 'CRL,Brussels', 'Macau，MFM，China', '',
  ].map(cityLabel), [
    'New York', 'Tokyo', 'Seoul', 'Huntsville, AL', 'Frankfurt (HHN)', 'Dubai-DWC', 'Tenerife South Spain',
    'Singapore', 'Washington DC', 'Santa Cruz', 'Shizuoka', 'Brussels (CRL)', 'Macau, MFM', '(no service area)',
  ])
})

Deno.test('7.5-7 labels never merge rows and never look identical', () => {
  const rows = [
    { sa_id: 1, sa_name: 'Portland,OR,USA', country: 'United States' },
    { sa_id: 2, sa_name: 'Portland,ME,USA', country: 'United States' },
    { sa_id: 3, sa_name: 'Portland,USA', country: 'United States' },
    { sa_id: 4, sa_name: 'Portland,USA', country: 'United States' },
    { sa_id: 5, sa_name: 'Portland,UK', country: 'United Kingdom' },
  ]
  const l = uniqueLabels(rows)
  assertEquals([...l.values()], ['Portland, OR', 'Portland, ME', 'Portland (Portland,USA, #3)', 'Portland (Portland,USA, #4)', 'Portland'])
  // Real data: every listed city's display text is unique.
  const real = mapCities(YTD_ROWS as any)
  const disp = uniqueLabels(real)
  assertEquals(new Set(disp.values()).size, real.length)
})

Deno.test('7.1 Year to date, no filters: top 15 by period Total Profit', async () => {
  const d = await ytd()
  const t = table(d)
  const top = t.rows.filter((r: any) => !r.none).sort((a: any, b: any) => b.profit - a.profit).slice(0, 15)
  assertEquals(top.map((r: any) => [r.label, r.sa_name, r.country, r.p_trips, r.p_revenue, r.p_cost, r.profit,
    (r.margin * 100).toFixed(2), perTrip(r.ppt), signedPct(r.yoy).text, pts(r.mpts).text]), [
    ['New York', 'New York,USA', 'United States', 40986, 252428677, 206166298, 46262379, '18.33', '$11.29', '-30.3%', '+0.3 pts'],
    ['Alicante', 'Alicante, Spain', 'Spain', 25824, 145337441, 103525914, 41811527, '28.77', '$16.19', '+90.4%', '+9.0 pts'],
    ['Paris', 'Paris,France', 'France', 26495, 162989413, 124159281, 38830132, '23.82', '$14.66', '-18.9%', '-0.9 pts'],
    ['Antalya', 'Antalya,Turkey', 'Turkey', 39690, 139835787, 101236236, 38599551, '27.60', '$9.73', '+25.2%', '-6.9 pts'],
    ['Palma', 'Palma,Spain', 'Spain', 15249, 127318661, 93621166, 33697495, '26.47', '$22.10', '+155.0%', '+17.0 pts'],
    ['Tokyo', 'Tokyo, Japan', 'Japan', 24905, 134415474, 102774504, 31640970, '23.54', '$12.70', '-11.1%', '-1.0 pts'],
    ['Kuala Lumpur', 'Kuala Lumpur, Malaysia', 'Malaysia', 66001, 125074028, 96069499, 29004529, '23.19', '$4.39', '+61.2%', '+5.4 pts'],
    ['London', 'London,UK', 'United Kingdom', 18024, 167433813, 138749121, 28684692, '17.13', '$15.91', '+90.6%', '-0.4 pts'],
    ['Los Angeles', 'Los Angeles,USA', 'United States', 20658, 115760541, 87486950, 28273591, '24.42', '$13.69', '+64.0%', '+0.4 pts'],
    ['Milan', 'Milan, Italy', 'Italy', 9850, 109264571, 86921705, 22342866, '20.45', '$22.68', '+133.4%', '+4.7 pts'],
    ['Rome', 'Rome,Italy', 'Italy', 18423, 141075324, 118972276, 22103048, '15.67', '$12.00', '+84.6%', '+0.6 pts'],
    ['Mexico City', 'Mexico City,Mexico', 'Mexico', 23742, 54543550, 33788636, 20754914, '38.05', '$8.74', '+167.8%', '+16.3 pts'],
    ['Barcelona', 'Barcelona,Spain', 'Spain', 11724, 79316672, 60262795, 19053877, '24.02', '$16.25', '+30.8%', '+6.5 pts'],
    ['Hong Kong', 'Hong Kong,China', 'Hong Kong', 21837, 84605356, 66029361, 18575995, '21.96', '$8.51', '+92.4%', '+3.7 pts'],
    ['Las Vegas', 'Las Vegas,USA', 'United States', 31099, 68519987, 50905753, 17614234, '25.71', '$5.66', '+11.5%', '-4.6 pts'],
  ])
})

Deno.test('7.2 Top 15 chart ranked by the comparison window', async () => {
  const c = top15(await ytd())
  assertEquals(c.subtitle, 'Jan–Aug 2026 vs Jan–Aug 2025, complete months')
  assertEquals(c.rows.map((r: any) => [r.display, r.ccProfit, r.cpProfit, signedPct(r.yoy).text]), [
    ['New York, United States', 41859646, 60040431, '-30.3%'],
    ['Alicante, Spain', 36622073, 19229477, '+90.4%'],
    ['Paris, France', 34100933, 42030960, '-18.9%'],
    ['Antalya, Turkey', 32586441, 26025678, '+25.2%'],
    ['Tokyo, Japan', 28665210, 32243424, '-11.1%'],
    ['Palma, Spain', 28415278, 11144602, '+155.0%'],
    ['Kuala Lumpur, Malaysia', 25872629, 16046171, '+61.2%'],
    ['London, United Kingdom', 25207899, 13224960, '+90.6%'],
    ['Los Angeles, United States', 25153410, 15339019, '+64.0%'],
    ['Rome, Italy', 19296688, 10451446, '+84.6%'],
    ['Milan, Italy', 19273425, 8257679, '+133.4%'],
    ['Mexico City, Mexico', 18890047, 7054580, '+167.8%'],
    ['Hong Kong, Hong Kong', 17258705, 8970069, '+92.4%'],
    ['Barcelona, Spain', 15909004, 12159204, '+30.8%'],
    ['Las Vegas, United States', 15577795, 13971948, '+11.5%'],
  ])
  assertEquals(c.tooltip(0), ['Total Profit $418,596', 'Same months last year $600,404', 'Change -30.3%'])
})

Deno.test('7.3 KPI cards (no filters), cross-checked against BigQuery', async () => {
  const d = await ytd()
  const k = kpis(d)
  assertEquals(k.P, 1256372199) // $12,563,721.99 — same as the Executive Summary
  const [, largest, top10, eighty, loss] = k.cards as any[]
  assertEquals([largest.value, largest.sub], ['3.7%', 'New York, United States · $463k'])
  assertEquals([top10.value, top10.sub2], ['27.0%', 'Top 25: 46.2%'])
  assertEquals([pct(Number(CY.sql.top10)), pct(Number(CY.sql.top25))], ['27.0%', '46.2%'])
  // N depends only on the top cities and P, both exact in the fixture.
  assertEquals(k.N, CY.sql.n80)
  assertEquals(k.N, 97)
  const M = CY.sql.m_cities // 1,074 cities with trips (BigQuery, all rows)
  assertEquals(`${k.N} of ${M.toLocaleString('en-US')}`, '97 of 1,074')
  assertEquals(pct(k.N! / M), '9.0%')
  assertEquals(eighty.sub2, 'highest profit first')
  // Loss-makers: none among the 50 largest; the two found are small.
  assertEquals([loss.value, loss.tone, loss.sub], [String(CY.sql.loss_n), 'down', 'Total loss $-3,679'])
  assertEquals(k.ranked.slice(0, 50).some((r: any) => r.profit < 0), false)
  assertEquals(loss.ids.sort(), [1007, 24861])
  // Top 50 hold 63.9% by profit (62.7% ranked by revenue; the brief's 63.0% ranked by revenue since Jan 2025).
  assertEquals(pct(k.ranked.slice(0, 50).reduce((a: number, r: any) => a + r.profit, 0) / k.P), '63.9%')
  assertEquals(header(d), {
    title: 'Cities',
    badge: 'Data as of 2026-09-28',
    badgeTooltip: 'Pinned 2026-09-28 08:30 UTC · warehouse load 2026-09-28 08:14 UTC',
    subtitle: '2026 to date profit by pickup city, vs Jan–Aug 2025 (complete months).',
    sectionLabel: '2026 TO DATE — TOTAL PROFIT BY CITY',
  })
})

Deno.test('7.3 lowest-margin cities', async () => {
  const lm = lowestMargin(await ytd())
  assertEquals(lm.rows.map((r: any) => [r.display, (r.margin * 100).toFixed(2)]), [
    ['Pattaya, Thailand', '6.70'], ['Bangkok, Thailand', '7.56'], ['Chiang Mai, Thailand', '8.98'],
    ['Seoul, South Korea', '14.10'], ['Phuket, Thailand', '14.96'], ['Amsterdam, Netherlands', '15.61'],
    ['Rome, Italy', '15.67'], ['Naples, Italy', '15.90'], ['Istanbul, Turkey', '15.93'],
    ['Tampa, United States', '16.13'], ['Lima, Peru', '16.87'], ['London, United Kingdom', '17.13'],
  ])
  assertEquals(lm.tooltip!(1), ['Margin 7.56%', 'Total Profit $97,816', 'Revenue $1,293,566'])
  assertEquals(lm.values!.slice(0, 2), [6.7, 7.56])
  // The brief's list (50 largest cities) keeps its order and values within ours.
  const t = table(await ytd())
  const m = (name: string) => t.rows.find((r: any) => r.display === name)
  assertEquals(['Bangkok, Thailand', 'Seoul, South Korea', 'Phuket, Thailand', 'Rome, Italy', 'Istanbul, Turkey',
    'London, United Kingdom', 'New York, United States', 'Melbourne, Australia'].map((n) => [n, tableMoney(m(n).p_revenue), (m(n).margin * 100).toFixed(2)]), [
    ['Bangkok, Thailand', '$1,293,566', '7.56'], ['Seoul, South Korea', '$709,113', '14.10'], ['Phuket, Thailand', '$757,812', '14.96'],
    ['Rome, Italy', '$1,410,753', '15.67'], ['Istanbul, Turkey', '$873,202', '15.93'], ['London, United Kingdom', '$1,674,338', '17.13'],
    ['New York, United States', '$2,524,287', '18.33'], ['Melbourne, Australia', '$317,053', '18.46'],
  ])
  const tiny = await ytd('', '', [YTD_ROWS[0], YTD_ROWS[1], foldedRow(CY.folded)])
  assertEquals(lowestMargin(tiny).empty, LOW_MARGIN_EMPTY)
})

Deno.test('7.3 Country = Spain', async () => {
  const spain = YTD_ROWS.filter((r: any) => r.country === 'Spain')
  const d = await ytd('', 'Spain', spain)
  assertEquals(d.checks[0], { name: 'cities = Countries row (Spain)', ok: true })
  const t = table(d)
  assertEquals(t.rows.sort((a: any, b: any) => b.profit - a.profit).slice(0, 8).map((r: any) => [r.label, tableMoney(r.profit)]), [
    ['Alicante', '$418,115'], ['Palma', '$336,975'], ['Barcelona', '$190,539'], ['Malaga', '$134,544'],
    ['Tenerife South Spain', '$112,598'], ['Las Palmas', '$100,569'], ['Lanzarote', '$96,594'], ['Madrid', '$80,852'],
  ])
  assertEquals(t.rows.find((r: any) => r.label === 'Tenerife South Spain').profit, 11259820) // $112,598.20
  // Inside a country filter, labels drop the country.
  assertEquals(kpis(d).cards[1].sub, 'Alicante · $418k')
  assertEquals([kpis(d).cards[0].value, kpis(d).cards[0].sub], ['41', 'in 1 country'])
  assertEquals(top15(d).labels[0], 'Alicante')
  assertEquals(header(d).subtitle, '2026 to date profit by pickup city, vs Jan–Aug 2025 (complete months). Country: Spain.')
  assertEquals([t.total.revenue, t.total.cost, t.total.trips], [649505093, 480102809, 102757])
})

Deno.test('7.4 Last year (2025) and Month to date', async () => {
  const ly = await topPeriod('last_year')
  const k = kpis(ly)
  assertEquals(k.P, 1388401962)
  assertEquals(k.cards[1].value, '6.3%')
  assertEquals(k.ranked.slice(0, 10).map((r: any) => [r.display, tableMoney(r.profit), (r.margin * 100).toFixed(2), signedPct(r.yoy).text]), [
    ['New York, United States', '$869,471', '18.17', '-16.0%'],
    ['Paris, France', '$674,659', '24.55', '+79.4%'],
    ['Tokyo, Japan', '$441,947', '23.04', '+22.1%'],
    ['Antalya, Turkey', '$383,378', '33.11', '+741.3%'],
    ['Alicante, Spain', '$361,968', '22.67', '+3720.0%'],
    ['Kuala Lumpur, Malaysia', '$251,876', '17.50', '+157.5%'],
    ['Los Angeles, United States', '$248,309', '22.96', '-29.4%'],
    ['London, United Kingdom', '$232,671', '17.68', '+103.9%'],
    ['San Francisco, United States', '$217,849', '22.14', '-4.7%'],
    ['Las Vegas, United States', '$216,881', '29.61', '+3.5%'],
  ])
  assertEquals(k.ranked[0].profit, 86947145) // exact $869,471.45
  // Palma lost money in 2024: signed growth against |cp_profit|.
  const palma = k.ranked.find((r: any) => r.display === 'Palma, Spain')
  assertEquals([palma.cpProfit, signedPct(palma.yoy).text], [-145870, '+13267.5%'])

  const mtd = await topPeriod('mtd')
  assertEquals(kpis(mtd).ranked.slice(0, 5).map((r: any) => [r.display, r.p_revenue, r.p_cost, r.profit, r.p_trips]), [
    ['Antalya, Turkey', 25388636, 19375526, 6013110, 7069],
    ['Palma, Spain', 20413159, 15130942, 5282217, 2536],
    ['Alicante, Spain', 19104255, 13914801, 5189454, 3185],
    ['Paris, France', 20322082, 15592883, 4729199, 3328],
    ['New York, United States', 26597714, 22194981, 4402733, 4271],
  ])
  assertEquals([top15(mtd).subtitle, top15(mtd).datasets.length], ['Selected period', 1])
  assertEquals(table(mtd).showYoy, false)
})

Deno.test('7.5 invariants 1–3, 6 (BigQuery, all rows)', () => {
  const t = Object.fromEntries(CY.invariants.city_totals.map((r: any) => [r.f, r]))
  const v = (r: any) => [toCents(r.revenue ?? r.p_revenue), toCents(r.cost ?? r.p_cost), r.trips ?? r.p_trips]
  // 1. No filters = Executive Summary KPI totals (through the extended base CTE).
  assertEquals(v(t.all), v(CY.invariants.es_kpi))
  assertEquals(v(t.all), [toCents(ES_YTD.kpi_totals[0].p_revenue), toCents(ES_YTD.kpi_totals[0].p_cost), ES_YTD.kpi_totals[0].p_trips])
  // 2. Country = Spain = Spain's Countries row.
  assertEquals(v(t.spain), v(CY.invariants.countries_spain))
  assertEquals(v(t.spain), [649505093, 480102809, 102757])
  // 3. Region = X = Executive Summary region row, for every region.
  for (const r of ES_YTD.by_region) {
    const row = CY.invariants.city_totals.find((x: any) => x.region === r.name)
    assertEquals(v(row), v(r), r.name)
  }
  // 6. Each service area once; listed rows = distinct service areas with trips in the base.
  for (const r of CY.invariants.city_totals) assertEquals(r.rows_all, r.distinct_ids, r.f)
  assertEquals(t.all.rows_listed, CY.invariants.distinct_sa_in_base)
  assertEquals(t.all.rows_all, 1179)
})

Deno.test('7.5 invariants 4–5: monthly arrays and the Pareto', async () => {
  // 4. Every city's months = its summary row (BigQuery over all 1,075 listed cities).
  assertEquals(CY.invariants.monthly_mismatch, 0)
  const d = await ytd()
  for (const id of [40, 429, 41, 1007, 24861]) {
    const tr = trend(d, id)!, row = d.cities.find((c) => c.sa_id === id)!
    assertEquals([tr.totals.revenue, tr.totals.cost, tr.totals.trips], [row.p_revenue, row.p_cost, row.p_trips], String(id))
  }
  // Savannakhet has no August trips: zero-filled so the axis stays continuous.
  const sav = trend(d, 1007)!
  assertEquals([sav.labels.length, sav.revenue[7], sav.profit[3]], [9, 0, -3618.07])
  // 5. N = first x where the Pareto reaches ≥ 80%.
  const p = pareto(d)
  assertEquals(p.points.findIndex((pt: any) => pt.y >= 80) + 1, p.N)
  assertEquals(p.markerLabel, '97 cities = 80% of profit')
  // End point over all rows (BigQuery): 100.03% — losses at the tail pull it back from a peak.
  assertEquals((Number(CY.sql.max_cum) * 100).toFixed(2), '100.03')
  // Complete synthetic set: end point = 100% exactly, and exceeds it when losses exist.
  const synth = (profits: number[]) => ({
    ...d, country: '', comparison: null,
    cities: profits.map((pr, i) => ({ ...d.cities[0], sa_id: i + 1, sa_name: `C${i},X`, p_revenue: 1000 + pr, p_cost: 1000, p_trips: 1, cp_trips: 0 })),
  })
  assertEquals(pareto(synth([50, 30, 20])).points.at(-1)!.y, 100)
  const withLoss = pareto(synth([60, 50, -10]))
  assertEquals([withLoss.points.map((x: any) => x.y), withLoss.yMax], [[60, 110, 100], 110])
  assertEquals(citiesFor80([{ profit: 60 }, { profit: 50 }, { profit: -10 }], 100), 2)
  assertEquals(citiesFor80([{ profit: 10 }], 0), null)
})

Deno.test('endpoint: monthly alignment, consistency checks, retry', async () => {
  const months = ['2026-01-01', '2026-02-01', '2026-03-01']
  const a = alignMonthly([{ sa_id: '7', month: '2026-03-01', revenue: '1.50', cost: '1', trips: '2' }] as any, months)
  assertEquals(a, { months: ['2026-01', '2026-02', '2026-03'], by_city: { '7': [[0, 0, 0], [0, 0, 0], [150, 100, 2]] } })
  assertThrows(() => alignMonthly([{ sa_id: '7', month: '2025-12-01', revenue: '1', cost: '1', trips: '1' }] as any, months))
  const cities = mapCities([{ sa_id: '7', sa_name: 'X,Y', country: 'Y', region: 'Europe', p_revenue: '1.50', p_cost: '1', p_trips: '2', cc_revenue: '0', cc_cost: '0', cc_trips: '0', cp_revenue: '0', cp_cost: '0', cp_trips: '0' }] as any)
  const want = { revenue: 150, cost: 100, trips: 2 }
  assertEquals(cityChecks(cities, a, want, 'X').map((c) => c.ok), [true, true, true, true])
  // A duplicated service area: totals no longer match the months, and the duplicate is named.
  assertEquals(cityChecks([...cities, ...cities], a, { revenue: 300, cost: 200, trips: 4 }, 'X').map((c) => [c.name, c.ok]), [
    ['cities = X', true], ['city months = cities', false], ['each city’s months = its row', true], ['each service area once', false],
  ])
  // Full endpoint with the partial monthly fixture: the months check fails, so it retries and flags.
  const seen: number[] = []
  const r = await citiesPage('ytd', '', '', AS_OF, async (n, s, pr, p) => { seen.push(p.as_of_ms); return runner('ytd', YTD_ROWS, SAMPLE_MONTHS)(n, s, pr, p) }, () => {})
  assertEquals([r.status, new Set(seen).size, r.data.checks[0].ok], ['inconsistent', 2, true])
  assertEquals(parseCountry(''), '')
  assertEquals(parseCountry("Côte d'Ivoire"), "Côte d'Ivoire")
  assertThrows(() => parseCountry('x'.repeat(200)))
  assertThrows(() => parseCountry(7))
})

Deno.test('country dropdown, region header, selection, table', async () => {
  const d = await ytd()
  assertEquals(d.country_options.at(-1), 'Unmapped')
  assertEquals(d.country_options.slice(0, 3), ['Albania', 'Algeria', 'Angola'])
  assertEquals(d.country_options.length, 168)
  const eu = await ytd('Europe', '', YTD_ROWS.filter((r: any) => r.region === 'Europe'))
  assertEquals(eu.checks[0].name, 'cities = Executive Summary region row (Europe)')
  assertEquals(header(eu).subtitle.endsWith(' Region: Europe.'), true)
  assertEquals(selectedCity(d, null), 40)
  assertEquals(selectedCity(d, '429'), 429)
  assertEquals(selectedCity(d, '-1'), 40) // "(no service area)" is never selectable
  assertEquals(selectedCity(d, '999999'), 40)
  assertEquals(trend(d, 40)!.title, 'Monthly trend: New York, United States')
  const t = table(d)
  const pin = (r: any) => r.none
  assertEquals(sortRows(t.rows, (r: any) => r.profit, -1, pin).at(-1).sa_id, NO_SERVICE_AREA)
  assertEquals(sortRows(t.rows, (r: any) => r.profit, 1, pin).at(-1).sa_id, NO_SERVICE_AREA)
  // Search matches the raw name as well as the cleaned label.
  const fields = [(r: any) => r.label, (r: any) => r.sa_name, (r: any) => r.country, (r: any) => r.region]
  assertEquals(filterRows(t.rows, 'USA', fields).some((r: any) => r.label === 'New York'), true)
  assertEquals(filterRows(t.rows, '%EF%BC%8C', fields).map((r: any) => r.label).includes('Santa Cruz'), true)
  // Totals equal the page total and the Executive Summary.
  assertEquals([t.total.revenue, t.total.cost, t.total.trips, t.total.profit], [5432963559, 4176591360, 2118428, 1256372199])
  assertEquals([signedPct(t.total.yoy).text, pts(t.total.mpts).text], ['+27.6%', '+1.5 pts'])
  assertEquals(t.rows.find((r: any) => r.sa_id === 40).spark.negative, false)
})

Deno.test('empty selection', async () => {
  const d = await computeCitiesOnce('mtd', 'Unmapped', 'Nowhere', AS_OF, AS_OF, runner('mtd', [], []))
  const k = kpis(d)
  assertEquals(k.cards.map((c: any) => c.value), ['0', '—', '—', '—', '0'])
  assertEquals(k.cards[1].sub, 'No trips in this selection.')
  assertEquals(pareto(d).empty, 'No trips in this selection.')
  assertEquals(selectedCity(d, null), null)
  assertEquals(top15(d).rows.length, 0)
})
