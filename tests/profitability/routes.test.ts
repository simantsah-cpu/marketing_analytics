// Acceptance tests for the Routes page (Brief 04 §7).
// Fixtures are real BigQuery results for as_of = 2026-09-28 08:30 UTC captured with
// scripts/profitability/acceptance-sql.ts (modes: routes, routes-top). The YTD fixture keeps
// every listed route the rankings, loss table and trend need in full; the other 470 listed
// routes and the real roll-up are folded into one "All other routes" row, so Σ listed stays
// exactly the transfer total. Counts over all routes are cross-checked with BigQuery.
import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1'
import {
  computeRoutesOnce, routeChecks, alignByKey, mapRoutes, mapRouteTypes, mapRouteKpis, parseProduct, parseCity, ROLLUP_ID,
} from '../../supabase/functions/_shared/profitability/routes.ts'
import { NO_CITY } from '../../supabase/functions/_shared/profitability/sql.ts'
import { toCents } from '../../supabase/functions/_shared/profitability/payload.ts'
import type { Runner } from '../../supabase/functions/_shared/profitability/pinned.ts'
import type { PeriodKey } from '../../supabase/functions/_shared/profitability/time.ts'
import { routeLabel } from '../../src/pages/profitability/routeLabels.js'
import {
  header, kpis, typeTable, typeCombo, typeMonthly, top15, losses, marginBands, marginBand, selectedRoute, trend, table,
  enrich, pinTier, cityChipLabel, routeKey, NO_LOSSES, TYPE_ORDER,
} from '../../src/pages/profitability/routesModel.js'
import { pct, signedPct, pts, perTrip, tableMoney } from '../../src/pages/profitability/format.js'
import { sortRows, filterRows } from '../../src/pages/profitability/tableSort.js'

const dir = new URL('../../supabase/functions/_shared/profitability/testdata/', import.meta.url)
const read = (f: string) => JSON.parse(Deno.readTextFileSync(new URL(f, dir)))
const RY = read('2026-09-28T08-30Z_routes_ytd.json')
const RO = read('2026-09-28T08-30Z_routes_other_periods.json')
const ES_YTD = read('2026-09-28T08-30Z_ytd.json')
const ES_OTHER = read('2026-09-28T08-30Z_other_periods.json')
const COUNTRIES_YTD = read('2026-09-28T08-30Z_countries_ytd_summary.json')
const CITIES_YTD = read('2026-09-28T08-30Z_cities_ytd.json')
const AS_OF = Date.parse('2026-09-28T08:30:00Z')

const routeRow = (a: string[]) => ({
  sa_id: a[0], route_key: a[1], sa_name: a[2], country: a[3], region: a[4], is_distance_priced: a[5] === '' ? null : a[5],
  p_revenue: a[6], p_cost: a[7], p_trips: a[8], cc_revenue: a[9], cc_cost: a[10], cp_revenue: a[11], cp_cost: a[12], n_routes: a[13],
})
const rollupRow = (f: string[]) => routeRow(['-2', 'All other routes', '', '', '', '', ...f.slice(0, 3), ...f.slice(3, 7), f[7]])
const countryRow = (a: string[]) => ({
  country: a[0], main_region: a[1] || null, all_regions: a[2] || null,
  p_revenue: a[3], p_cost: a[4], p_trips: a[5], cc_revenue: a[6], cc_cost: a[7], cc_trips: a[8],
  cp_revenue: a[9], cp_cost: a[10], cp_trips: a[11],
})
const cityRow = (a: string[]) => ({
  sa_id: a[0], sa_name: a[1], country: a[2], region: a[3],
  p_revenue: a[4], p_cost: a[5], p_trips: a[6], cc_revenue: a[7], cc_cost: a[8], cc_trips: a[9],
  cp_revenue: a[10], cp_cost: a[11], cp_trips: a[12],
})
const sampleMonth = (a: string[]) => ({ sa_id: a[0], route_key: a[1], month: a[2], revenue: a[3], cost: a[4], trips: a[5] })
const str = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? null : String(v)]))

const LISTED = [...RY.detailed.map(routeRow), rollupRow(RY.folded)]
const SAMPLES = new Set(RY.sample_monthly.map((a: string[]) => `${a[0]}|${a[1]}`))
// Real monthly series for the two sampled routes; every other detailed route gets its period
// totals in January (the per-route month check only needs Σ months = the row).
const MONTHLY = [
  ...RY.sample_monthly.map(sampleMonth),
  ...RY.detailed.filter((a: string[]) => !SAMPLES.has(`${a[0]}|${a[1]}`))
    .map((a: string[]) => ({ sa_id: a[0], route_key: a[1], month: '2026-01-01', revenue: a[6], cost: a[7], trips: a[8] })),
]

type Over = Partial<Record<string, object[]>>
function runner(period: PeriodKey, over: Over = {}): Runner {
  return async (name) => {
    if (over[name]) return over[name] as any
    if (name === 'route_types') return RY.route_types.map(str)
    if (name === 'route_type_monthly') return RY.route_type_monthly.map(str)
    if (name === 'routes_listed') return LISTED
    if (name === 'route_kpis') return [str(RY.route_kpis)]
    if (name === 'route_monthly') return MONTHLY
    if (name === 'kpi_totals') return period === 'ytd' ? ES_YTD.kpi_totals : [ES_OTHER.kpi_totals_by_period[period]]
    if (name === 'country_summary') return COUNTRIES_YTD.map(countryRow)
    if (name === 'city_summary') return CITIES_YTD.detailed.map(cityRow)
    if (name === 'by_product_line') return ES_YTD.by_product_line
    if (name === 'by_region') return ES_YTD.by_region
    if (name === 'city_info') return [{ sa_id: '451', sa_name: 'Alicante, Spain', country: 'Spain' }]
    return []
  }
}
const F0 = { region: '', country: '', product: '', city: NO_CITY }
const ytd = (f = {}, over: Over = {}) => computeRoutesOnce('ytd', { ...F0, ...f }, AS_OF, AS_OF, runner('ytd', over))
const cents = toCents
const money2 = (c: number) => `${c < 0 ? '$-' : '$'}${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`

// ── §1.3 labels ──────────────────────────────────────────────────────────────

Deno.test('§1.3 route labels (display only)', () => {
  const cases: [string, string][] = [
    ['ALC - 贝尼多姆', 'ALC → Benidorm'], ['JFK - 曼哈顿2', 'JFK → Manhattan 2'], ['曼哈顿 - JFK', 'Manhattan → JFK'],
    ['ICN - 1-首尔', 'ICN → 1-Seoul'], ['CPT - 市区1', 'CPT → city centre 1'], ['SYD - Sydney市区', 'SYD → Sydney city centre'],
    ['~JFK>', 'JFK → city, distance-priced'], ['~>', 'Within city, distance-priced'], ['~HKG>MFM', 'HKG → MFM, distance-priced'],
    // §7.2 / §7.4 expected labels
    ['KUL - 吉隆坡', 'KUL → Kuala Lumpur'], ['MEX - Mexico city mid', 'MEX → Mexico city mid'], ['HAN - 市区', 'HAN → city centre'],
    ['吉隆坡 - KUL', 'Kuala Lumpur → KUL'], ['NRT - 东京2', 'NRT → Tokyo 2'], ['HKG - 九龙', 'HKG → Kowloon'],
    ['~>ADB', 'City → ADB, distance-priced'], ['~SBH>SBH', 'SBH → SBH, distance-priced'], ['SID - 1', 'SID → 1'],
    ['机场 - SGN', 'airport → SGN'], ['头顿 - 1郡', '头顿 → District 1'],
  ]
  assertEquals(cases.map(([k]) => routeLabel(k)), cases.map(([, l]) => l))
})

// ── §7.1 route types ─────────────────────────────────────────────────────────

Deno.test('7.1 route types, Year to date', async () => {
  const d = await ytd()
  const t = typeTable(d)
  const got = t.rows.map((r: any) => [r.name, r.p_trips, money2(r.p_revenue), money2(r.p_cost), money2(r.profit),
    (r.margin * 100).toFixed(2) + '%', perTrip(r.ppt), pct(r.share), signedPct(r.yoy).text, pts(r.mpts).text])
  assertEquals(got, [
    ['Airport → city', 877726, '$29,843,531.91', '$23,020,743.84', '$6,822,788.07', '22.86%', '$7.77', '54.3%', '+32.9%', '+3.0 pts'],
    ['City → airport', 448358, '$17,283,931.09', '$13,061,920.39', '$4,222,010.70', '24.43%', '$9.42', '33.6%', '+29.1%', '+2.3 pts'],
    ['City → city', 59925, '$4,104,269.92', '$2,959,956.60', '$1,144,313.32', '27.88%', '$19.10', '9.1%', '-2.9%', '-1.0 pts'],
    ['Airport → airport', 43399, '$1,090,469.57', '$801,693.69', '$288,775.88', '26.48%', '$6.65', '2.3%', '+16.9%', '+1.7 pts'],
    ['Ride hailing (point to point)', 689020, '$2,007,433.10', '$1,921,599.08', '$85,834.02', '4.28%', '$0.12', '0.7%', '+658.6%', '-8.0 pts'],
  ])
  assertEquals([t.total.trips, money2(t.total.revenue), money2(t.total.cost), money2(t.total.profit),
    (t.total.margin! * 100).toFixed(2) + '%', perTrip(t.total.ppt), pct(t.total.share)],
  [2118428, '$54,329,635.59', '$41,765,913.60', '$12,563,721.99', '23.12%', '$5.93', '100.0%'])
  assertEquals([money2(d.route_kpis.transfer_profit), d.route_kpis.transfer_trips], ['$12,477,887.97', 1429408])
  // Combo chart: TYPE_ORDER, "Ride hailing" shortened on the axis, tooltip lines.
  const c = typeCombo(d)
  assertEquals(c.labels, ['Airport → city', 'City → airport', 'City → city', 'Airport → airport', 'Ride hailing'])
  assertEquals(c.tooltip(0), ['Profit $6,822,788', 'Margin 22.9%'])
  // Stacked monthly: stack order and Σ = type profit; September is "(to date)".
  const m = typeMonthly(d)
  assertEquals(m.lines.map((l: any) => l.id), TYPE_ORDER)
  assertEquals(m.labels.at(-1), "Sep '26 (to date)")
  assertEquals(m.current.filter(Boolean).length, 1)
  for (const l of m.lines) {
    const row = t.rows.find((r: any) => r.route_type === l.id)
    assertEquals(Math.round(l.data.reduce((a: number, v: number) => a + v, 0) * 100), row.profit)
  }
})

Deno.test('7.1 route types, Last year and Month to date', async () => {
  const ly = await computeRoutesOnce('last_year', F0, AS_OF, AS_OF, runner('last_year', {
    route_types: RO.last_year.route_types.map(str), route_type_monthly: [], routes_listed: [], route_monthly: [],
    route_kpis: [str(RO.last_year.route_kpis)],
  }))
  assertEquals(typeTable(ly).rows.map((r: any) => [r.short, r.p_trips, money2(r.p_revenue), money2(r.p_cost), money2(r.profit),
    (r.margin * 100).toFixed(2) + '%', pct(r.share), signedPct(r.yoy).text]), [
    ['Airport → city', 1044276, '$35,630,335.12', '$28,356,826.42', '$7,273,508.70', '20.41%', '52.4%', '+29.9%'],
    ['City → airport', 543839, '$20,329,144.12', '$15,727,763.74', '$4,601,380.38', '22.63%', '33.1%', '+66.8%'],
    ['City → city', 72947, '$5,509,744.98', '$3,895,550.81', '$1,614,194.17', '29.30%', '11.6%', '+50.6%'],
    ['Airport → airport', 48255, '$1,387,040.61', '$1,036,664.41', '$350,376.20', '25.26%', '2.5%', '+8.0%'],
    ['Ride hailing', 120782, '$521,664.93', '$477,104.76', '$44,560.17', '8.54%', '0.3%', '—'], // did not exist in 2024
  ])
  assertEquals(ly.checks.find((c) => c.name === 'route types = Executive Summary totals')?.ok, true)
  const mtdTypes = RO.mtd.route_types.map((t: any) => ({ ...t, cc_revenue: t.p_revenue, cc_cost: t.p_cost, cp_revenue: t.p_revenue, cp_cost: t.p_cost }))
  const mtd = await computeRoutesOnce('mtd', F0, AS_OF, AS_OF, runner('mtd', {
    route_types: mtdTypes.map(str), route_type_monthly: [], routes_listed: [], route_monthly: [], route_kpis: [{}],
  }))
  const t = typeTable(mtd)
  assertEquals(t.showYoy, false)
  assertEquals(t.rows.map((r: any) => [r.short, r.p_trips, money2(r.p_revenue), money2(r.profit), (r.margin * 100).toFixed(2) + '%']), [
    ['Airport → city', 100596, '$3,518,147.91', '$802,353.13', '22.81%'],
    ['City → airport', 50279, '$1,992,742.79', '$473,924.86', '23.78%'],
    ['City → city', 6950, '$473,425.81', '$130,227.59', '27.51%'],
    ['Airport → airport', 4823, '$111,155.03', '$28,544.68', '25.68%'],
    ['Ride hailing', 70679, '$115,452.14', '$15,472.34', '13.40%'],
  ])
  assertEquals(mtd.checks.find((c) => c.name === 'route types = Executive Summary totals')?.ok, true)
})

// ── §7.2 / 7.3 top routes ────────────────────────────────────────────────────

Deno.test('7.2 top 15 routes by period Total Profit (table order)', async () => {
  const d = await ytd()
  const t = table(d)
  const rows = sortRows(t.rows, (r: any) => r.profit, -1, pinTier).slice(0, 15)
  assertEquals(rows.map((r: any) => [r.route_key, r.label, r.sa_name, r.country, r.p_trips, money2(r.p_revenue), money2(r.p_cost),
    money2(r.profit), (r.margin * 100).toFixed(2) + '%', perTrip(r.ppt), signedPct(r.yoy).text]), [
    ['ALC - 贝尼多姆', 'ALC → Benidorm', 'Alicante, Spain', 'Spain', 16704, '$868,655.61', '$605,320.78', '$263,334.83', '30.32%', '$15.76', '+315.0%'],
    ['KUL - 吉隆坡', 'KUL → Kuala Lumpur', 'Kuala Lumpur, Malaysia', 'Malaysia', 42071, '$740,875.33', '$589,770.66', '$151,104.67', '20.40%', '$3.59', '+62.6%'],
    ['MEX - Mexico city mid', 'MEX → Mexico city mid', 'Mexico City,Mexico', 'Mexico', 17935, '$372,126.49', '$227,658.20', '$144,468.29', '38.82%', '$8.06', '+250.2%'],
    ['LAS - Las vegas stripe', 'LAS → Las vegas stripe', 'Las Vegas,USA', 'United States', 22408, '$480,654.58', '$357,287.81', '$123,366.77', '25.67%', '$5.51', '+46.1%'],
    ['JFK - 曼哈顿2', 'JFK → Manhattan 2', 'New York,USA', 'United States', 8534, '$490,266.79', '$393,743.12', '$96,523.67', '19.69%', '$11.31', '+15.5%'],
    ['CDG - Paris', 'CDG → Paris', 'Paris,France', 'France', 5801, '$341,958.43', '$257,867.25', '$84,091.18', '24.59%', '$14.50', '-6.9%'],
    ['FCO - Roma', 'FCO → Roma', 'Rome,Italy', 'Italy', 8477, '$531,583.21', '$448,776.77', '$82,806.44', '15.58%', '$9.77', '+102.6%'],
    ['JFK - 曼哈顿', 'JFK → Manhattan', 'New York,USA', 'United States', 9270, '$533,600.60', '$463,865.70', '$69,734.90', '13.07%', '$7.52', '-53.9%'],
    ['HAN - 市区', 'HAN → city centre', 'Hanoi,Vietnam', 'Vietnam', 38360, '$357,049.68', '$288,843.76', '$68,205.92', '19.10%', '$1.78', '+46.1%'],
    ['吉隆坡 - KUL', 'Kuala Lumpur → KUL', 'Kuala Lumpur, Malaysia', 'Malaysia', 14220, '$262,541.80', '$194,433.01', '$68,108.79', '25.94%', '$4.79', '+163.2%'],
    ['CPT - 市区1', 'CPT → city centre 1', 'Cape Town,South Africa', 'South Africa', 12887, '$206,198.79', '$143,389.26', '$62,809.53', '30.46%', '$4.87', '+331.2%'],
    ['NRT - 东京2', 'NRT → Tokyo 2', 'Tokyo, Japan', 'Japan', 4102, '$324,662.64', '$262,608.28', '$62,054.36', '19.11%', '$15.13', '+18.2%'],
    // CAI → Kirdasah ($57,837.17) is not in the snapshot's 60 routes; the brief allows others in between.
    ['CAI - Kirdasah', 'CAI → Kirdasah', 'Cairo,Egypt', 'Egypt', 12038, '$152,934.33', '$95,097.16', '$57,837.17', '37.82%', '$4.80', '+716.2%'],
    ['FAO - Albufeira', 'FAO → Albufeira', 'Faro,Portugal', 'Portugal', 4216, '$175,644.62', '$120,496.77', '$55,147.85', '31.40%', '$13.08', '+52.5%'],
    ['ACE - Playa Blanca', 'ACE → Playa Blanca', 'Lanzarote,Spain', 'Spain', 3797, '$228,434.19', '$173,366.62', '$55,067.57', '24.11%', '$14.50', '+239.7%'],
  ])
  const hkg = t.rows.find((r: any) => r.route_key === 'HKG - 九龙')
  assertEquals([hkg.p_trips, money2(hkg.profit), (hkg.margin * 100).toFixed(2) + '%', perTrip(hkg.ppt), signedPct(hkg.yoy).text],
    [7477, '$54,807.34', '19.72%', '$7.33', '+176.2%'])
})

Deno.test('7.3 Top 15 chart ranked by the comparison window', async () => {
  const d = await ytd()
  const m = top15(d)
  assertEquals(m.subtitle, 'Jan–Aug 2026 vs Jan–Aug 2025, complete months')
  assertEquals(m.datasets.map((x: any) => x.label), ['Total Profit, Jan–Aug 2026', 'Same months last year, Jan–Aug 2025'])
  const full = m.rows.map((r: any) => r.display)
  assertEquals(m.rows.map((r: any, i: number) => [full[i], money2(r.ccProfit), money2(r.cpProfit), m.tooltip(i)[2]]), [
    ['ALC → Benidorm · Alicante', '$229,400.74', '$55,278.45', 'Change +315.0%'],
    ['KUL → Kuala Lumpur · Kuala Lumpur', '$133,071.66', '$81,827.61', 'Change +62.6%'],
    ['MEX → Mexico city mid · Mexico City', '$130,685.50', '$37,313.04', 'Change +250.2%'],
    ['LAS → Las vegas stripe · Las Vegas', '$108,668.98', '$74,403.73', 'Change +46.1%'],
    ['JFK → Manhattan 2 · New York', '$88,896.92', '$76,954.15', 'Change +15.5%'],
    ['FCO → Roma · Rome', '$75,789.12', '$37,402.64', 'Change +102.6%'],
    ['CDG → Paris · Paris', '$73,896.85', '$79,379.25', 'Change -6.9%'],
    ['HAN → city centre · Hanoi', '$61,605.73', '$42,177.85', 'Change +46.1%'],
    ['JFK → Manhattan · New York', '$60,586.02', '$131,481.22', 'Change -53.9%'],
    ['Kuala Lumpur → KUL · Kuala Lumpur', '$59,952.47', '$22,775.12', 'Change +163.2%'],
    ['NRT → Tokyo 2 · Tokyo', '$55,525.38', '$46,965.72', 'Change +18.2%'],
    ['CPT → city centre 1 · Cape Town', '$55,280.47', '$12,819.84', 'Change +331.2%'],
    // CAI → Kirdasah ($53,357.37) is not in the snapshot's 60 routes; others may sit between.
    ['CAI → Kirdasah · Cairo', '$53,357.37', '$6,537.18', 'Change +716.2%'],
    ['ACE → Playa Blanca · Lanzarote', '$50,944.24', '$14,997.18', 'Change +239.7%'],
    ['HKG → Kowloon · Hong Kong', '$50,691.40', '$18,356.33', 'Change +176.2%'],
  ])
  // Axis labels truncate at 38 characters; the tooltip title has the full label + raw name.
  assert(m.labels.every((l: string) => l.length <= 38))
  assertEquals(m.labels[1], 'KUL → Kuala Lumpur · Kuala Lumpur')
  assertEquals(m.titles[0], 'ALC → Benidorm · Alicante (ALC - 贝尼多姆)')
  // A route with no profit last year says "New this year".
  const n = await ytd({}, { routes_listed: [routeRow(['7', 'X - Y', 'Z,Q', 'Q', 'Europe', 'false', '900', '100', '3', '900', '100', '0', '0', '1'])], route_monthly: [] })
  assertEquals(top15(n).tooltip(0)[2], 'New this year')
})

// ── KPI row ──────────────────────────────────────────────────────────────────

Deno.test('5.1 KPI cards, Year to date (BigQuery route_kpis over all 12,785 routes)', async () => {
  const d = await ytd()
  const k = kpis(d).cards.map((c: any) => [c.label, c.value, c.sub, c.sub2 ?? null])
  assertEquals(k, [
    ['Routes with trips', '12,785', '130 listed individually', 'transfer products only'],
    ['Top route', '2.1%', 'ALC → Benidorm · Alicante', 'share of transfer profit'],
    ['Top 50 routes', '22.5%', 'share of transfer profit', 'the network is long-tail'],
    ['Distance-priced', '19.3%', '$2.41M · 137,210 trips', 'transfers without a zone route'],
    ['Loss-making routes', '562', 'Total loss $-28,737', '0.23% of transfer profit'],
  ])
  // The real payload lists 600 routes (BigQuery): the fixture keeps 130 of them in full.
  assertEquals(RY.invariants.listed_n, 600)
  assertEquals((kpis(d).cards[4] as any).tone, "down")
})

// ── §7.4 losses ──────────────────────────────────────────────────────────────

Deno.test('7.4 loss-making routes, Year to date', async () => {
  const d = await ytd()
  const l = losses(d)
  const byLabel = new Map(l.rows.map((r: any) => [r.display, r]))
  const expect: [string, number, string, string, string][] = [
    ['MLB → PBI · Palm Beach', 2, '$-572.00', '$276.00', '$-848.00'],
    ['AMS → Groningen · Amsterdam', 9, '$328.68', '$1,154.77', '$-826.09'],
    ['City → ADB, distance-priced · Antalya', 1, '$-598.60', '$0.00', '$-598.60'],
    ['Within city, distance-priced · Providence, RI', 12, '$1,724.22', '$2,165.00', '$-440.78'],
    ['SBH → SBH, distance-priced · St. Jean', 8, '$215.96', '$442.48', '$-226.52'],
    ['ATH → Kalamos · Athens', 4, '$242.16', '$409.56', '$-167.40'],
    ['FRA → Strasbourg · Frankfurt', 1, '$1,496.40', '$1,638.30', '$-141.90'],
  ]
  for (const [lab, n, rv, cs, pr] of expect) {
    const r: any = byLabel.get(lab)
    assert(r, `${lab} is listed`)
    assertEquals([r.p_trips, money2(r.p_revenue), money2(r.p_cost), money2(r.profit)], [n, rv, cs, pr])
  }
  // Largest loss first; every listed loss-maker (the 100 largest) is in the table.
  assertEquals(l.rows[0].display, 'MLB → PBI · Palm Beach')
  assertEquals(l.rows.length, 100)
  assert(l.rows.every((r: any, i: number) => i === 0 || l.rows[i - 1].profit <= r.profit))
  assertEquals(l.footnote, 'Total loss $-28,737, 0.23% of transfer profit')
  // SID → 1 (-$29.08) and INN → Lech am arlberg (-$3.95) have exactly the brief's values in BigQuery,
  // but rank 234th and 470th of 562 loss-makers: the §4.4 rule (top 500 by revenue or the 100
  // largest losses) rolls them into "All other routes".
  assertEquals(RO.ytd_probe, [
    ['1334', 'SID - 1', '39.18', '68.26', '2', '-29.08', '234', '11313'],
    ['1451', 'INN - Lech am arlberg', '1093.94', '1097.89', '6', '-3.95', '470', '4018'],
  ])
  assert(!l.rows.some((r: any) => r.route_key === 'SID - 1' || r.route_key === 'INN - Lech am arlberg'))
  // No losses → the empty message.
  const none = await ytd({}, { routes_listed: [LISTED[0]], route_monthly: [] })
  assertEquals(losses(none).empty, NO_LOSSES)
})

Deno.test('7.4 largest loss-makers, Last year (2025)', () => {
  const p = new Map(RO.last_year.probe.map((a: string[]) => [a[1], a]))
  const row = (k: string) => { const a: any = p.get(k); return [routeLabel(k), Number(a[5]), money2(cents(a[3]) - cents(a[4])), a[12]] }
  assertEquals(row('机场 - SGN'), ['airport → SGN', 75, '$-1,559.69', 'true'])
  assertEquals(row('PMI - Cala dOr'), ['PMI → Cala dOr', 698, '$-1,289.68', 'true'])
  assertEquals(row('FRA - Strasbourg'), ['FRA → Strasbourg', 17, '$-870.15', 'true'])
  assertEquals(RO.last_year.loss5[0][1], '机场 - SGN') // the largest loss in 2025
})

// ── §7.5 month to date ───────────────────────────────────────────────────────

Deno.test('7.5 Month to date: top routes', () => {
  const rows = [...RO.mtd.top5, ...RO.mtd.more].map((a: string[]) => ({ key: a[1], label: routeLabel(a[1]), rv: cents(a[3]), pr: cents(a[3]) - cents(a[4]), n: Number(a[5]) }))
  const get = (k: string) => { const r = rows.find((x) => x.key === k)!; return [r.label, money2(r.rv), money2(r.pr), r.n] }
  assertEquals(get('ALC - 贝尼多姆'), ['ALC → Benidorm', '$124,281.56', '$33,934.09', 2169])
  assertEquals(get('KUL - 吉隆坡'), ['KUL → Kuala Lumpur', '$85,844.29', '$18,033.01', 4691])
  assertEquals(get('LAS - Las vegas stripe'), ['LAS → Las vegas stripe', '$56,358.49', '$14,697.79', 2662])
  assertEquals(get('MEX - Mexico city mid'), ['MEX → Mexico city mid', '$38,913.70', '$13,782.79', 2148])
  assertEquals(get('CDG - Paris'), ['CDG → Paris', '$41,992.37', '$10,194.33', 730])
  // Ranked by profit: ALC, KUL, then two Palma distance-priced routes (not in the snapshot's 60), then LAS.
  assertEquals(RO.mtd.top5.map((a: string[]) => a[1]), ['ALC - 贝尼多姆', 'KUL - 吉隆坡', '~PMI>', '~>PMI', 'LAS - Las vegas stripe'])
})

// ── §7.6 invariants ──────────────────────────────────────────────────────────

Deno.test('7.6 invariants 1–5, 7 (evaluated in BigQuery over all rows)', () => {
  const v = RY.invariants
  assertEquals(v.types_all, v.es_kpi)            // 1. Σ route types = Executive Summary
  assertEquals(v.types_rh, v.es_rh)              // 2. Ride hailing = the ES Ride Hailing row
  assertEquals(v.listed_all, v.types_transfer)   // 3. Σ listed + roll-up = types 0–3
  assertEquals(v.types_spain, v.countries_spain) // 4. Country = Spain → Countries row
  assertEquals(v.types_city451, v.cities_451)    //    City = Alicante → Cities row
  assertEquals(v.types_pt, v.es_pt)              //    Product = Private Transfer → ES product-line row
  assertEquals(v.type_months, v.types_all)       //    monthly by type sums to the types
  assertEquals(v.listed_n + v.rollup_n, RY.route_kpis.routes) // 5.
  assertEquals(v.listed_distinct, v.listed_n)
  assertEquals(v.monthly_mismatch, 0)            // every listed route's months = its row
  assertEquals(v.dp_flag_mismatch, 0)            // 7. distance-priced ⇔ key starts with '~'
})

Deno.test('7.6 invariants 6 and 8: direction and service area are part of the key; labels never group', async () => {
  const d = await ytd()
  const rows = enrich(d)
  const ny = rows.filter((r: any) => r.sa_id === 40 && ['JFK - 曼哈顿', '曼哈顿 - JFK'].includes(r.route_key))
  assertEquals(ny.map((r: any) => r.label).sort(), ['JFK → Manhattan', 'Manhattan → JFK'])
  assertEquals(RY.invariants.jfk_pair_rows, 2)
  // The same route name in two service areas stays two rows; two raw keys with the same label too.
  const two = await ytd({}, {
    routes_listed: [
      routeRow(['1', '~>', 'A,X', 'X', 'Europe', 'true', '100', '50', '1', '0', '0', '0', '0', '1']),
      routeRow(['2', '~>', 'B,X', 'X', 'Europe', 'true', '100', '50', '1', '0', '0', '0', '0', '1']),
      routeRow(['1', 'CPT - 市区', 'A,X', 'X', 'Europe', 'false', '100', '50', '1', '0', '0', '0', '0', '1']),
      routeRow(['1', 'CPT - city centre', 'A,X', 'X', 'Europe', 'false', '100', '50', '1', '0', '0', '0', '0', '1']),
    ],
    route_monthly: [],
  })
  const e = enrich(two)
  assertEquals(new Set(e.map(routeKey)).size, 4)
  assertEquals(e[2].label, e[3].label) // same label, different identity
  assertEquals(two.checks.find((c) => c.name === 'each route listed once')?.ok, true)
  // Distance-priced flag round-trips as a boolean; the roll-up has none.
  assertEquals(mapRoutes(LISTED).filter((r) => r.is_distance_priced).every((r) => r.route_key.startsWith('~')), true)
  assertEquals(mapRoutes(LISTED).find((r) => r.sa_id === ROLLUP_ID)?.is_distance_priced, null)
})

Deno.test('5.7 margin bands: exact band edges; the Loss band matches BigQuery', async () => {
  assertEquals([[-1, 100], [0, 100], [999, 10000], [1000, 10000], [1999, 10000], [2000, 10000], [2999, 10000], [3000, 10000]]
    .map(([p, r]) => marginBand(p, r)), [0, 1, 1, 2, 2, 3, 3, 4])
  const d = await ytd()
  const b = marginBands(d)
  // Every listed loss-maker is in the fixture in full, so the Loss band is exact.
  const sql = RY.invariants.margin_bands[0]
  assertEquals([b.bands[0].n, b.bands[0].revenue, b.bands[0].profit], [sql.n, cents(sql.revenue), cents(sql.profit)])
  assertEquals(b.tooltip(0), ['73 routes', 'Revenue $46,819', 'Total Profit -$13,325'])
  // Over all 600 listed routes (BigQuery): 73 / 4 / 141 / 280 / 75.
  assertEquals(RY.invariants.margin_bands.map((x: any) => x.n), [73, 4, 141, 280, 75])
})

// ── Endpoint ─────────────────────────────────────────────────────────────────

Deno.test('endpoint: consistency checks pass on the YTD fixture and catch drift', async () => {
  const d = await ytd()
  assertEquals(d.checks.map((c) => [c.name, c.ok]), [
    ['route types = Executive Summary totals', true],
    ['route types months = route types', true],
    ['listed routes + roll-up = transfer route types', true],
    ['route KPIs transfer profit = listed profit', true],
    ['route KPIs routes = listed + roll-up count', true],
    ['each listed route’s months = its row', true],
    ['each route listed once', true],
  ])
  // One cent off in one route, a lost month, a duplicate row: each is caught.
  const off = LISTED.map((r, i) => (i === 3 ? { ...r, p_cost: String(Number(r.p_cost) + 0.01) } : r))
  const bad = await ytd({}, { routes_listed: off })
  assertEquals(bad.checks.filter((c) => !c.ok).map((c) => c.name), [
    'listed routes + roll-up = transfer route types', 'route KPIs transfer profit = listed profit', 'each listed route’s months = its row',
  ])
  const dup = await ytd({}, { routes_listed: [...LISTED, LISTED[5]] })
  assert(dup.checks.some((c) => c.name === 'each route listed once' && !c.ok))
  assertThrows(() => alignByKey([{ month: '2025-12-01', revenue: '1', cost: '1', trips: '1', route_type: '0' }], ['2026-01-01'], (r) => r.route_type!))
  // Aligned arrays, keyed by "{sa_id}|{route_key}".
  assertEquals(d.monthly.months, ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'])
  assertEquals(d.monthly.by_key['451|ALC - 贝尼多姆'].reduce((a, v) => a + v[0], 0), cents('868655.61'))
})

Deno.test('endpoint: the cross-page check follows the filters (§4.7, §7.6-4)', async () => {
  const one = (x: { revenue: string; cost: string; trips: number }) =>
    [str({ route_type: 0, p_revenue: x.revenue, p_cost: x.cost, p_trips: x.trips, cc_revenue: 0, cc_cost: 0, cp_revenue: 0, cp_cost: 0 })]
  const empty = { route_type_monthly: [], routes_listed: [], route_monthly: [], route_kpis: [{}] }
  const nameOf = async (f: object, types: object[]) => (await ytd(f, { ...empty, route_types: types })).checks[0]
  const v = RY.invariants
  assertEquals(await nameOf({ country: 'Spain' }, one(v.types_spain)), { name: 'route types = Countries row (Spain)', ok: true })
  assertEquals(await nameOf({ city: 451 }, one(v.types_city451)), { name: 'route types = Cities row (451)', ok: true })
  assertEquals(await nameOf({ product: 'Private Transfer' }, one(v.types_pt)), { name: 'route types = Executive Summary product line (Private Transfer)', ok: true })
  const rh = await nameOf({ product: 'Ride Hailing' }, [str({ ...RY.route_types[4] })])
  assertEquals(rh, { name: 'route types = Executive Summary product line (Ride Hailing)', ok: true })
  assertEquals((await nameOf({ country: 'Spain' }, one(v.types_city451))).ok, false)
  // Product + geography has no counterpart page: only the internal checks run.
  const both = await ytd({ product: 'Rail', country: 'Spain' }, { ...empty, route_types: [] })
  assert(!both.checks.some((c) => c.name.startsWith('route types = ')))
  assertEquals(parseProduct(''), '')
  assertEquals(parseProduct('Rail'), 'Rail')
  assertThrows(() => parseProduct('Taxi'))
  assertEquals([parseCity(''), parseCity('451'), parseCity(451)], [NO_CITY, 451, 451])
  assertThrows(() => parseCity('451; DROP'))
})

// ── Page model: header, city chip, selection, trend, table, states ───────────

Deno.test('header, city chip and filters', async () => {
  const d = await ytd()
  assertEquals(header(d), {
    title: 'Routes', badge: 'Data as of 2026-09-28', badgeTooltip: 'Pinned 2026-09-28 08:30 UTC · warehouse load 2026-09-28 08:14 UTC',
    subtitle: '2026 to date profit by route, vs Jan–Aug 2025 (complete months).',
    sectionLabel: '2026 TO DATE — TOTAL PROFIT BY ROUTE',
  })
  const c = await ytd({ city: 451, product: 'Private Transfer', region: 'Europe' })
  assertEquals(cityChipLabel(c), 'Alicante, Spain')
  assertEquals(header(c).subtitle, '2026 to date profit by route, vs Jan–Aug 2025 (complete months). Region: Europe. City: Alicante, Spain. Product: Private Transfer.')
  // Inside a city, routes show without the " · {city}" suffix.
  assertEquals(enrich(c).find((r: any) => r.route_key === 'ALC - 贝尼多姆').display, 'ALC → Benidorm')
})

Deno.test('route selection and trend (§5.8)', async () => {
  const d = await ytd()
  assertEquals(selectedRoute(d, null), '451|ALC - 贝尼多姆')
  assertEquals(selectedRoute(d, '40|JFK - 曼哈顿'), '40|JFK - 曼哈顿')
  assertEquals(selectedRoute(d, '40|nope'), '451|ALC - 贝尼多姆')
  assertEquals(selectedRoute(d, `${ROLLUP_ID}|All other routes`), '451|ALC - 贝尼多姆')
  const t = trend(d, '451|ALC - 贝尼多姆')!
  assertEquals([t.title, t.subtitle], ['Monthly trend: ALC → Benidorm', 'Alicante, Spain'])
  assertEquals(t.stat, [['Total Profit', '$263k'], ['Margin', '30.3%'], ['Trips', '16,704'], ['Profit vs last year', '+315.0%']])
  assertEquals(t.labels.at(-1), "Sep '26 (to date)")
  assertEquals([t.totals.revenue, t.totals.cost, t.totals.trips], [cents('868655.61'), cents('605320.78'), 16704])
  const n = await ytd({}, { routes_listed: [routeRow(['7', 'X - Y', 'Z,Q', 'Q', 'Europe', 'false', '900', '100', '3', '900', '100', '0', '0', '1'])], route_monthly: [] })
  assertEquals(trend(n, '7|X - Y')!.stat.at(-1), ['Profit vs last year', 'New this year'])
})

Deno.test('listed-routes table: totals = transfer profit, pinned roll-up, search, footnote', async () => {
  const d = await ytd()
  const t = table(d)
  assertEquals([t.total.profit, t.total.trips], [d.route_kpis.transfer_profit, d.route_kpis.transfer_trips])
  assertEquals(tableMoney(t.total.profit), '$12,477,888')
  // Sorting any way keeps "(no service area)" rows, then the roll-up, at the bottom.
  const none = { ...t.rows[0], sa_id: -1, none: true, profit: 1e12 }
  for (const dirn of [1, -1]) {
    const s = sortRows([...t.rows, none], (r: any) => r.profit, dirn, pinTier)
    assertEquals([s.at(-2).none, s.at(-1).rollup], [true, true])
  }
  assertEquals(t.rows.at(-1).label, 'All other routes (12,655 routes)')
  assertEquals(t.rows.at(-1).spark, null)
  // Search matches the label, the raw (Chinese) name, the city and the country.
  const fields = [(r: any) => r.label, (r: any) => r.route_key, (r: any) => r.city, (r: any) => r.sa_name, (r: any) => r.country]
  assertEquals(filterRows(t.rows, '贝尼多姆', fields).map((r: any) => r.label), ['ALC → Benidorm'])
  assertEquals(filterRows(t.rows, 'benidorm', fields).length, 1)
  assert(filterRows(t.rows, 'Alicante', fields).length >= 3)
  // Margin is "—" when revenue ≤ 0; "New this year" when nothing last year.
  const neg = t.rows.find((r: any) => r.route_key === 'MLB - PBI')
  assertEquals([neg.margin, neg.isNew, neg.yoy], [null, true, null])
  assertEquals(t.footnote.endsWith('of transfer profit. The rest is in "All other routes". Ride hailing has no fixed routes.'), true)
  assertEquals(t.footnote.startsWith('The 130 routes listed hold '), true)
})

Deno.test('states: Ride Hailing only, empty selection', async () => {
  const rh = await ytd({ product: 'Ride Hailing' }, {
    route_types: [str(RY.route_types[4])], route_type_monthly: RY.route_type_monthly.filter((m: any) => m.route_type === 4).map(str),
    routes_listed: [], route_monthly: [], route_kpis: [str({ routes: 0, loss_routes: 0, loss_total: 0, transfer_profit: 0, top1_profit: 0, top50_profit: 0, dp_profit: 0, dp_trips: 0, transfer_trips: 0 })],
  })
  assertEquals(kpis(rh).cards.map((c: any) => [c.value, c.sub]), Array(5).fill(['—', 'Ride hailing has no fixed routes']))
  assertEquals(typeTable(rh).rows.map((r: any) => r.short), ['Ride hailing'])
  assertEquals(typeTable(rh).total.share, 1)
  assertEquals(rh.checks.every((c) => c.ok), true)
  const e = await ytd({ country: 'Nowhere' }, { route_types: [], route_type_monthly: [], routes_listed: [], route_monthly: [], route_kpis: [{}] })
  assertEquals(kpis(e).cards[0], { label: 'Routes with trips', value: '—', sub: 'No trips in this selection' })
  assertEquals([top15(e).rows.length, losses(e).rows.length, marginBands(e).empty, selectedRoute(e, null)], [0, 0, 'No trips in this selection.', null])
  assertEquals(typeTable(e).total.share, null)
  assertEquals(mapRouteKpis(undefined).routes, 0)
  assertEquals(mapRouteTypes([]).length, 0)
  assertEquals(routeChecks([], { months: [], by_key: {} }, [], mapRouteKpis(undefined), { months: [], by_key: {} }, null, '').every((c) => c.ok), true)
})
