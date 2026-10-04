// Acceptance tests for the Customers page (Brief 05 §7).
// Fixtures are real BigQuery results for as_of = 2026-09-28 08:30 UTC: the YTD fixture comes
// from the exact component SQL (acceptance-sql.ts mode 'customers') and holds every customer
// row; the other periods come from an independent compact query. Counts and sums the brief
// does not list were computed independently (Python Decimal over the fixture rows).
import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1'
import {
  computeCustomersOnce, customerChecks, mapCustomers, parseLabel, labelOptions, alignNewExisting,
} from '../../supabase/functions/_shared/profitability/customers.ts'
import { toCents } from '../../supabase/functions/_shared/profitability/payload.ts'
import type { Runner } from '../../supabase/functions/_shared/profitability/pinned.ts'
import type { PeriodKey } from '../../supabase/functions/_shared/profitability/time.ts'
import {
  header, kpis, top15, teamBars, teamTable, pareto, lowestMargin, newExisting, heatmap, selectedCustomer, trend, table,
  enrich, monthYear, yoySortValue, HEAT_NEG, NO_CUSTOMERS, LOW_MARGIN_EMPTY,
} from '../../src/pages/profitability/customersModel.js'
import { withDerived, yoyDelta } from '../../src/pages/profitability/modelShared.js'
import { pct, signedPct, pts, perTrip, SMALL_BASE_CENTS } from '../../src/pages/profitability/format.js'
import { sortRows, filterRows } from '../../src/pages/profitability/tableSort.js'

const dir = new URL('../../supabase/functions/_shared/profitability/testdata/', import.meta.url)
const read = (f: string) => JSON.parse(Deno.readTextFileSync(new URL(f, dir)))
const CY = read('2026-09-28T08-30Z_customers_ytd.json')
const CO = read('2026-09-28T08-30Z_customers_other_periods.json')
const ES_YTD = read('2026-09-28T08-30Z_ytd.json')
const ES_OTHER = read('2026-09-28T08-30Z_other_periods.json')
const COUNTRIES_YTD = read('2026-09-28T08-30Z_countries_ytd_summary.json')
const AS_OF = Date.parse('2026-09-28T08:30:00Z')

const custRow = (a: string[]) => ({
  customer: a[0], customer_type: a[1], team: a[2], first_trade_month: a[3] || null,
  p_revenue: a[4], p_cost: a[5], p_trips: a[6], p_new_profit: a[7], cc_revenue: a[8], cc_cost: a[9],
  cp_revenue: a[10], cp_cost: a[11], cp_trips: a[12],
})
// Other-period rows carry no separate comparison window: cc = p there.
const otherRow = (a: string[]) => custRow([a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[4], a[5], a[8], a[9], a[10]])
const teamRow = (a: string[]) => ({ team: a[0], customers: a[1], p_revenue: a[2], p_cost: a[3], p_trips: a[4], cc_revenue: a[5], cc_cost: a[6], cp_revenue: a[7], cp_cost: a[8] })
const gridRow = (a: string[]) => ({ ki: a[0], ci: a[1], customer: a[2], country: a[3], revenue: a[4], cost: a[5], trips: a[6] })
const neRow = (a: string[]) => ({ month: a[0], is_new: a[1], revenue: a[2], cost: a[3], trips: a[4], customers: a[5] })
const countryRow = (a: string[]) => ({
  country: a[0], main_region: a[1] || null, all_regions: a[2] || null,
  p_revenue: a[3], p_cost: a[4], p_trips: a[5], cc_revenue: a[6], cc_cost: a[7], cc_trips: a[8],
  cp_revenue: a[9], cp_cost: a[10], cp_trips: a[11],
})
const CUSTOMERS = CY.customers.map(custRow)
const SAMPLES = new Set(CY.sample_monthly.map((a: string[]) => a[0]))
// Real monthly series for three customers; every other customer's period totals sit in January.
const MONTHLY = [
  ...CY.sample_monthly.map((a: string[]) => ({ customer: a[0], month: a[1], revenue: a[2], cost: a[3], trips: a[4] })),
  ...CY.customers.filter((a: string[]) => !SAMPLES.has(a[0]) && a[6] !== '0')
    .map((a: string[]) => ({ customer: a[0], month: '2026-01-01', revenue: a[4], cost: a[5], trips: a[6] })),
]
const ATTRS = CY.customers.map((a: string[]) => ({
  customer: a[0], customer_type: a[1], team: a[2], first_trade_month: a[3], p_trips: a[6], customer_groups: String(CY.customer_groups),
}))

type Over = Partial<Record<string, object[]>>
function runner(period: PeriodKey, over: Over = {}): Runner {
  return async (name) => {
    if (over[name]) return over[name] as any
    if (name === 'customer_summary') return CUSTOMERS
    if (name === 'customer_monthly') return MONTHLY
    if (name === 'new_existing_monthly') return CY.new_existing.map(neRow)
    if (name === 'team_summary') return CY.teams.map(teamRow)
    if (name === 'customer_country_grid') return CY.grid.map(gridRow)
    if (name === 'customer_attrs') return ATTRS
    if (name === 'kpi_totals') return period === 'ytd' ? ES_YTD.kpi_totals : [ES_OTHER.kpi_totals_by_period[period]]
    if (name === 'country_summary') return COUNTRIES_YTD.map(countryRow)
    if (name === 'by_product_line') return ES_YTD.by_product_line
    if (name === 'by_region') return ES_YTD.by_region
    return []
  }
}
const F0 = { region: '', country: '', product: '', team: '', ctype: '' }
const ytd = (f = {}, over: Over = {}) => computeCustomersOnce('ytd', { ...F0, ...f }, AS_OF, AS_OF, runner('ytd', over))
/** An other-period payload: top rows + the rest folded into "Unmapped" (in P, never ranked). */
function other(period: 'last_year' | 'mtd' | 'since2025', extra: Over = {}) {
  const x = CO[period]
  const top = (x.top ?? []).map(otherRow)
  const dec = (c: number) => `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`
  const rest = (i: number, k: string) => dec(toCents(x.totals[i]) - top.reduce((a: number, r: any) => a + toCents(r[k]), 0))
  const folded = custRow(['Unmapped', 'Unassigned', 'Unassigned', '', rest(0, 'p_revenue'), rest(1, 'p_cost'),
    String(Number(x.totals[2]) - top.reduce((a: number, r: any) => a + Number(r.p_trips), 0)), rest(3, 'p_new_profit'), '0', '0', '0', '0', '0'])
  const empty = { customer_monthly: [], new_existing_monthly: [], team_summary: [], customer_country_grid: [], customer_attrs: [] }
  return computeCustomersOnce(period, F0, AS_OF, AS_OF, runner(period, { ...empty, customer_summary: [...top, folded], ...extra }))
}
const money2 = (c: number) => `${c < 0 ? '$-' : '$'}${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
const dollars = (c: number) => `$${Math.round(c / 100).toLocaleString('en-US')}`

// ── §1 small-base rule (shared delta helper) ─────────────────────────────────

Deno.test('§1 small-base rule: "New" when last-year revenue < $5,000', () => {
  assertEquals(SMALL_BASE_CENTS, 500_000)
  assertEquals(signedPct(2929163.64, { base: 4414, minBase: SMALL_BASE_CENTS }), { text: 'New', tone: 'new' })
  assertEquals(signedPct(0.185, { base: 58436146, minBase: SMALL_BASE_CENTS }).text, '+18.5%')
  assertEquals(signedPct(0.185).text, '+18.5%') // no minBase → unchanged behaviour
  const r = withDerived({ p_revenue: 100, p_cost: 50, p_trips: 1, cc_revenue: 100, cc_cost: 50, cp_revenue: 4414, cp_cost: 4400 }, true, SMALL_BASE_CENTS)
  assertEquals([r.smallBase, r.yoy, r.mpts, yoyDelta(r).text], [true, null, null, 'New'])
  const s = withDerived({ p_revenue: 100, p_cost: 50, p_trips: 1, cc_revenue: 100, cc_cost: 50, cp_revenue: 4414, cp_cost: 4400 }, true)
  assertEquals(s.smallBase, false) // other pages keep their behaviour
})

// ── §7.1 top 15 ──────────────────────────────────────────────────────────────

Deno.test('7.1 Year to date, no filters: top 15 by Total Profit', async () => {
  const d = await ytd()
  const t = table(d)
  const rows = sortRows(t.rows, (r: any) => r.profit, -1, (r: any) => r.none).slice(0, 15)
  assertEquals(rows.map((r: any) => [r.customer, r.customer_type, r.team, r.firstTrade, r.p_trips, money2(r.p_revenue), money2(r.p_cost),
    money2(r.profit), (r.margin * 100).toFixed(2) + '%', perTrip(r.ppt), r.delta.text, pts(r.mpts).text]), [
    ['Booking.com', 'partner', 'EAM Chris', 'Jun 2020', 626515, '$12,775,604.56', '$9,868,954.30', '$2,906,650.26', '22.75%', '$4.64', '+59.8%', '+4.7 pts'],
    // Blank dimension first trade: first seen in the warehouse (no 2024 trips) → Feb 2025.
    ['hoppa_Resorthoppa Direct', 'Unassigned', 'B2C Matt', 'Feb 2025', 128118, '$7,868,977.64', '$5,434,801.87', '$2,434,175.77', '30.93%', '$19.00', '+72.8%', '+7.2 pts'],
    ['ETG', 'partner', 'EAM Chris', 'Aug 2024', 215125, '$8,873,634.38', '$7,085,111.57', '$1,788,522.81', '20.16%', '$8.31', '+64.9%', '+1.4 pts'],
    ['City Airport Taxi', 'partner', 'EAM Chris', 'Jun 2020', 108712, '$6,870,684.57', '$5,775,891.36', '$1,094,793.21', '15.93%', '$10.07', '+36.1%', '-0.6 pts'],
    ['China Ctrip API', 'partner', 'EAM Gloria', 'Jun 2020', 42724, '$2,101,665.98', '$1,547,182.62', '$554,483.36', '26.38%', '$12.98', '+22.2%', '-4.0 pts'],
    ['Getyourguide', 'partner', 'EAM Gloria', 'Apr 2022', 31173, '$1,430,114.70', '$1,054,691.50', '$375,423.20', '26.25%', '$12.04', '+340.9%', '+1.2 pts'],
    ['Expedia', 'partner', 'EAM Chris', 'Jun 2020', 31521, '$1,160,211.46', '$920,374.64', '$239,836.82', '20.67%', '$7.61', '-15.0%', '-3.3 pts'],
    ['Servantrip', 'partner', 'EAM Chris', 'Sep 2023', 18865, '$1,092,111.50', '$871,726.93', '$220,384.57', '20.18%', '$11.68', '-8.1%', '-2.8 pts'],
    ['Klook', 'partner', 'EAM Gloria', 'Dec 2020', 14360, '$777,401.11', '$569,765.05', '$207,636.06', '26.71%', '$14.46', '-2.0%', '+4.7 pts'],
    // Dimension says 2025-12, but trips start Feb 2025 → LEAST(…) = Feb 2025; normal % (large base).
    ['6 Tour', 'Unassigned', 'EAM Chris', 'Feb 2025', 18200, '$803,056.57', '$613,567.41', '$189,489.16', '23.60%', '$10.41', '+18.5%', '-0.6 pts'],
    ['hoppa_Tier 4', 'Unassigned', 'EAM Renaldo', 'Aug 2024', 18842, '$680,200.38', '$507,230.53', '$172,969.85', '25.43%', '$9.18', '-51.5%', '+3.8 pts'],
    ['hoppa_SAS Scandinavian Air', 'Unassigned', 'EAM Chris', 'Mar 2025', 5864, '$535,715.01', '$369,984.75', '$165,730.26', '30.94%', '$28.26', '+38.2%', '+3.4 pts'],
    ['Civitatis', 'partner', 'EAM Chris', 'Sep 2020', 13470, '$592,989.55', '$446,151.15', '$146,838.40', '24.76%', '$10.90', '+62.8%', '-1.1 pts'],
    ['Book Taxi', 'partner', 'EAM Chris', 'Aug 2020', 20812, '$554,411.19', '$415,401.47', '$139,009.72', '25.07%', '$6.68', '-54.8%', '+1.2 pts'],
    ['Tripadvisor', 'partner', 'EAM Gloria', 'Jan 2021', 9615, '$450,897.57', '$326,825.44', '$124,072.13', '27.52%', '$12.90', '+4.0%', '+2.4 pts'],
  ])
  assertEquals(CY.attrs.find((a: string[]) => a[0] === '6 Tour').slice(3, 6), ['2025-02-01', '2025-02-01', '2025-12-01'])
  assertEquals(CY.attrs.find((a: string[]) => a[0] === 'hoppa_Resorthoppa Direct')[5], '') // blank in the dimension
})

// ── §7.2 chart + KPI cards ───────────────────────────────────────────────────

Deno.test('7.2 Top 15 chart ranked by the comparison window', async () => {
  const d = await ytd()
  const m = top15(d)
  assertEquals(m.subtitle, 'Jan–Aug 2026 vs Jan–Aug 2025, complete months')
  assertEquals(m.rows.map((r: any, i: number) => [r.customer, money2(r.ccProfit), money2(r.cpProfit), m.tooltip(i)[2]]), [
    ['Booking.com', '$2,600,349.32', '$1,627,595.56', 'Change +59.8%'],
    ['hoppa_Resorthoppa Direct', '$2,124,457.81', '$1,229,414.17', 'Change +72.8%'],
    ['ETG', '$1,582,676.73', '$960,044.20', 'Change +64.9%'],
    ['City Airport Taxi', '$982,719.77', '$721,852.86', 'Change +36.1%'],
    ['China Ctrip API', '$486,808.13', '$398,340.08', 'Change +22.2%'],
    ['Getyourguide', '$317,844.37', '$72,088.78', 'Change +340.9%'],
    ['Expedia', '$210,050.56', '$247,029.92', 'Change -15.0%'],
    ['Servantrip', '$198,496.04', '$216,083.23', 'Change -8.1%'],
    ['Klook', '$185,766.38', '$189,476.70', 'Change -2.0%'],
    ['6 Tour', '$167,718.24', '$141,481.17', 'Change +18.5%'],
    ['hoppa_Tier 4', '$152,186.20', '$313,723.90', 'Change -51.5%'],
    ['hoppa_SAS Scandinavian Air', '$143,063.04', '$103,496.65', 'Change +38.2%'],
    ['Civitatis', '$130,980.19', '$80,446.50', 'Change +62.8%'],
    ['Elife website', '$107,008.71', '$95,356.81', 'Change +12.2%'], // 14th, ahead of Book Taxi
    ['Book Taxi', '$107,000.08', '$236,638.71', 'Change -54.8%'],
  ])
  assert(!m.rows.some((r: any) => r.customer === 'Tripadvisor'))
  // A small comparison base says "New" in the tooltip.
  const small = await ytd({}, { customer_summary: [custRow(['X', 'partner', 'EAM Chris', '2024-01-01', '900', '100', '3', '0', '900', '100', '44.14', '44', '1'])], customer_monthly: [] })
  assertEquals(top15(small).tooltip(0)[2], 'New')
})

Deno.test('5.1 KPI cards, Year to date', async () => {
  const d = await ytd()
  const k = kpis(d)
  assertEquals(k.cards.map((c: any) => [c.label, c.value, c.sub, c.sub2 ?? null]), [
    ['Customers with trips', '100', 'of 184 customer groups', '101 last year'],
    ['Largest customer', '23.1%', 'Booking.com · $2.91M', 'share of Total Profit'],
    ['Top 10 customers', '79.7%', 'Top 5: 69.9%', 'share of Total Profit'],
    ['New customers', '2.6%', '$332k from 52 customers', 'first trade within 12 months'],
    ['Customers growing', '34 of 72', 'Total Profit up vs Jan–Aug 2025', '$3.66M gained · $1.37M lost'],
  ])
  assertEquals(money2(k.P), '$12,563,721.99') // = Executive Summary
  // 7.6-7: the denominator is exactly the customers with cp_revenue ≥ $5,000.
  const base = CY.customers.filter((a: string[]) => a[0] !== 'Unmapped' && toCents(a[10]) >= SMALL_BASE_CENTS).map((a: string[]) => a[0])
  assertEquals((k.cards[4] as any).base.sort(), base.sort())
  // Without a comparison: "—".
  const mtd = await other('mtd')
  assertEquals(kpis(mtd).cards[4] as any, { label: 'Customers growing', value: '—', sub: 'No comparison for this period' })
})

Deno.test('5.5 concentration: 11 customers = 80% of profit', async () => {
  const p = pareto(await ytd())
  assertEquals([p.N, p.M, p.markerLabel, p.unit], [11, 100, '11 customers = 80% of profit', 'customers'])
  assertEquals(p.points[9].y, 79.68)
  assertEquals(p.points.at(-1)!.y, 99.99) // Unmapped ($712.13) is in P but outside the rankings
})

Deno.test('5.6 lowest-margin customers (≥ $100k revenue)', async () => {
  const l = lowestMargin(await ytd())
  assertEquals(l.rows.map((r: any) => [r.customer, money2(r.p_revenue), money2(r.profit), (r.margin * 100).toFixed(2) + '%']), [
    ['Gaode - Ride Hailing', '$1,863,562.94', '$60,581.54', '3.25%'],
    ['City Airport Taxi', '$6,870,684.57', '$1,094,793.21', '15.93%'],
    // Not in the snapshot's top 40 by revenue; it qualifies with $125k revenue.
    ['Ctrip API - Ride Hailing', '$125,396.00', '$22,889.72', '18.25%'],
    ['hoppa_Simply Sun', '$216,489.37', '$42,042.72', '19.42%'],
    ['ETG', '$8,873,634.38', '$1,788,522.81', '20.16%'],
    ['Servantrip', '$1,092,111.50', '$220,384.57', '20.18%'],
    ['Expedia', '$1,160,211.46', '$239,836.82', '20.67%'],
    ['hoppa_H-Resa', '$273,701.16', '$56,688.43', '20.71%'],
    ['Booking.com', '$12,775,604.56', '$2,906,650.26', '22.75%'],
    ['hoppa_DerTour Romania', '$257,483.45', '$59,782.37', '23.22%'],
  ])
  assertEquals(l.tooltip!(0), ['Margin 3.25%', 'Total Profit $60,582', 'Revenue $1,863,563', 'Team EAM Gloria'])
  const few = await ytd({}, { customer_summary: CUSTOMERS.slice(0, 2) })
  assertEquals(lowestMargin(few).empty, LOW_MARGIN_EMPTY)
})

// ── §7.4 teams ───────────────────────────────────────────────────────────────

Deno.test('7.4 teams: ≥ the top-40 lower bounds, sum to the page total, Unassigned last', async () => {
  const d = await ytd()
  const t = teamTable(d)
  const byTeam = new Map(t.rows.map((r: any) => [r.team, r]))
  for (const [team, n, lower] of [['EAM Chris', 12, '7083247.15'], ['B2C Matt', 4, '2607165.17'], ['EAM Gloria', 11, '1642470.63'], ['EAM Renaldo', 13, '735787.88']] as const) {
    const r: any = byTeam.get(team)
    assert(r.profit >= toCents(lower), `${team} ≥ lower bound`)
    assert(r.customers >= n)
  }
  assertEquals(t.rows.map((r: any) => [r.team, r.customers, money2(r.profit)]), [
    ['EAM Chris', 18, '$7,139,761.10'], ['B2C Matt', 5, '$2,607,250.85'], ['EAM Gloria', 24, '$1,811,201.41'],
    ['EAM Renaldo', 43, '$919,040.90'], ['Sales Mo', 3, '$75,981.55'], ['Sales Jojo', 7, '$9,774.05'], ['Unassigned', 0, '$712.13'],
  ])
  assertEquals([money2(t.total.profit), t.total.customers, pct(t.total.share)], ['$12,563,721.99', 100, '100.0%'])
  // Sales Jojo had nothing last year: small base → "New".
  assertEquals(yoyDelta(byTeam.get('Sales Jojo')).text, 'New')
  const b = teamBars(d)
  assertEquals(b.labels, ['EAM Chris', 'B2C Matt', 'EAM Gloria', 'EAM Renaldo', 'Sales Mo', 'Sales Jojo', 'Unassigned'])
  assertEquals(b.subtitle, 'Jan–Aug 2026 vs Jan–Aug 2025')
  assertEquals(b.datasets.map((x: any) => x.values[0]), [6346997.34, 4742265.54]) // EAM Chris cc / cp
})

// ── §7.3 other periods ───────────────────────────────────────────────────────

Deno.test('7.3 Last year (2025): top 10, "New" for small bases, KPI shares', async () => {
  const d = await other('last_year')
  const rows = sortRows(table(d).rows, (r: any) => r.profit, -1, (r: any) => r.none).slice(0, 10)
  assertEquals(rows.map((r: any) => [r.customer, money2(r.profit), (r.margin * 100).toFixed(2) + '%', r.delta.text]), [
    ['Booking.com', '$2,550,136.56', '18.67%', '-32.4%'],
    ['hoppa_Resorthoppa Direct', '$2,064,542.74', '26.01%', 'New'],
    ['ETG', '$1,654,305.08', '19.04%', '+320.3%'],
    ['City Airport Taxi', '$1,178,693.73', '16.12%', '+38.5%'],
    ['China Ctrip API', '$668,090.96', '29.65%', '-9.8%'],
    ['Mozio', '$410,867.20', '21.97%', '-50.0%'],
    ['hoppa_Tier 4', '$410,083.05', '22.54%', 'New'], // 2024 revenue $44.14
    ['Expedia', '$372,453.58', '22.96%', '+13.8%'],
    ['Book Taxi', '$371,494.10', '22.87%', '+21.3%'],
    ['Servantrip', '$358,381.33', '22.42%', '+56.0%'],
  ])
  const k = kpis(d).cards
  assertEquals([k[1].value, k[2].value], ['18.4%', '72.3%'])
})

Deno.test('7.3 Month to date: top 5, hoppa_Resorthoppa Direct overtakes Booking.com', async () => {
  const d = await other('mtd')
  const rows = sortRows(table(d).rows, (r: any) => r.profit, -1, (r: any) => r.none).slice(0, 5)
  assertEquals(rows.map((r: any) => [r.customer, money2(r.p_revenue), money2(r.p_cost), money2(r.profit), r.p_trips]), [
    ['hoppa_Resorthoppa Direct', '$1,054,260.16', '$744,542.20', '$309,717.96', 17217],
    ['Booking.com', '$1,364,522.34', '$1,058,221.40', '$306,300.94', 67424],
    ['ETG', '$1,067,987.89', '$862,141.81', '$205,846.08', 24632],
    ['City Airport Taxi', '$668,539.99', '$556,466.55', '$112,073.44', 10661],
    ['China Ctrip API', '$246,991.01', '$179,315.78', '$67,675.23', 4487],
  ])
  assertEquals(table(d).showYoy, false)
})

// ── §7.5 heatmap ─────────────────────────────────────────────────────────────

Deno.test('7.5 heatmap, Since Jan 2025: profit, margin, empty cells, colours', async () => {
  const d = await other('since2025', { customer_country_grid: CO.since2025.grid.map(gridRow) })
  const h = heatmap(d, 'profit')
  assertEquals(h.cols.map((c: any) => c.name), ['United States', 'Spain', 'Turkey', 'France', 'Japan', 'Italy', 'Egypt', 'Mexico', 'All other countries'])
  // The brief prints whole dollars, truncated (e.g. $322,072.54 → $322,072).
  const whole = (c: any) => (c.empty ? '—' : `$${Math.trunc(c.profit / 100).toLocaleString('en-US')}`)
  assertEquals(h.rows.map((r: any, i: number) => [r.name, ...h.grid[i].map(whole)]), [
    ['Booking.com', '$1,229,711', '—', '$322,072', '$24', '$117', '—', '$540,815', '$375,238', '$2,988,806'],
    ['hoppa_Resorthoppa Direct', '$215,851', '$2,138,125', '$588,567', '$168,654', '$15,840', '$131,411', '$50,187', '$44,009', '$1,146,071'],
    ['ETG', '$396,754', '$187,198', '$341,890', '$283,555', '$268,617', '$279,233', '$67,401', '$58,052', '$1,560,125'],
    ['City Airport Taxi', '$477,094', '$153,169', '$102,932', '$105,440', '$211,597', '$178,823', '$17,326', '$59,353', '$967,748'],
    ['China Ctrip API', '$467,420', '$9,712', '$249', '$21,867', '$2,567', '$51,941', '$33,121', '$47,677', '$588,016'],
    ['Expedia', '$318,277', '—', '$2,486', '—', '$140,488', '$6,026', '—', '—', '$145,012'],
    ['hoppa_Tier 4', '$70,755', '$58,254', '$63,890', '$29,114', '$15,902', '$40,972', '$41,919', '$4,929', '$257,314'],
    ['Servantrip', '$56,439', '$52,689', '$5,811', '$241,986', '$26,266', '$42,453', '$1,735', '$13,962', '$137,420'],
    ['All other customers', '$1,534,412', '$515,938', '$373,505', '$473,472', '$525,344', '$427,427', '$102,705', '$204,388', '$3,622,043'],
  ])
  assertEquals(money2(h.grid[0][2].profit!), '$322,072.54')
  assertEquals(money2(h.total), '$26,447,741.61')
  const m = heatmap(d, 'margin')
  const mg = (c: any) => (c.empty ? '—' : (c.margin * 100).toFixed(1) + '%')
  assertEquals(m.grid.slice(0, 3).map((r: any[]) => r.map(mg)), [
    ['17.9%', '—', '23.5%', '19.3%', '100.0%', '—', '33.1%', '24.3%', '19.9%'],
    ['33.2%', '25.7%', '37.8%', '30.8%', '38.3%', '25.0%', '44.7%', '33.7%', '29.3%'],
    ['20.4%', '18.5%', '19.9%', '20.9%', '21.6%', '14.9%', '31.0%', '17.6%', '19.8%'],
  ])
  assertEquals([m.grid[0][4].text, h.grid[0][4].text, h.grid[0][0].text], ['100%', '$118', '$1.23M'])
  // Colours: the largest cell is the darkest (0.90) with white text; √-scaled below it.
  const maxCell = h.grid[8][8]
  assertEquals([maxCell.bg, maxCell.light], ['rgba(45,91,166,0.9)', true])
  assertEquals(h.grid[0][3].light, false)
  const neg = heatmap({ ...d, grid: [{ ki: 1, ci: 1, customer: 'A', country: 'B', revenue: 100, cost: 300, trips: 2 }] } as any, 'profit')
  assertEquals([neg.grid[0][0].bg, neg.grid[0][0].light], [HEAT_NEG, true])
  assertEquals(h.grid[0][0].title, 'Profit $1,229,711 | Revenue $6,881,691 | Margin 17.9% | Trips 161,041')
})

// ── §7.6 invariants ──────────────────────────────────────────────────────────

Deno.test('7.6 invariants 1–7 (evaluated in BigQuery over all rows)', () => {
  const v = CY.invariants
  assertEquals(v.customers, v.es_kpi)                          // 1.
  assertEquals(v.teams, v.es_kpi)
  assertEquals(v.grid, v.es_kpi)
  assertEquals(v.new_existing, v.es_kpi)
  assertEquals(v.spain_page, v.spain_country_row)               //    same geography/product filters
  assertEquals(v.pt_page, v.pt_es_row)
  assertEquals(v.team_chris_page, v.team_chris_row)             // 2.
  assertEquals(v.ctype_partner_page, v.ctype_partner_rows)
  assertEquals(v.attrs_differ_ly, 0)                            // 3. attributes identical YTD vs Last year
  assertEquals([v.summary_rows, v.summary_distinct], [118, 118]) //   one row (one type, one team) per customer
  assertEquals(v.first_trade_after_seen, 0)                     // 4.
  assertEquals(v.new_profit_customers, v.new_profit_months)     // 5.
  assertEquals(v.monthly_mismatch, 0)                           // 6.
})

Deno.test('7.6-4/5 new vs existing monthly chart', async () => {
  const d = await ytd()
  const n = newExisting(d)
  assertEquals(n.lines.map((l: any) => l.name), ['Existing customers', 'New customers (first trade within 12 months)'])
  assertEquals(n.totals.new, toCents(CY.invariants.new_profit_customers))
  assertEquals(n.totals.new + n.totals.existing, toCents('12563721.99'))
  assertEquals([n.labels.at(-1), n.lines[1].customers[0], n.lines[1].customers.at(-1)], ["Sep '26 (to date)", 47, 5])
  assertThrows(() => alignNewExisting([{ month: '2025-12-01', is_new: 'true', revenue: '1', cost: '1', trips: '1', customers: '1' }], ['2026-01-01']))
})

// ── Endpoint ─────────────────────────────────────────────────────────────────

Deno.test('endpoint: checks pass on the YTD fixture, catch drift, follow the filters', async () => {
  const d = await ytd()
  assertEquals(d.checks.map((c) => [c.name, c.ok]), [
    ['customers = Executive Summary totals', true],
    ['teams = customers', true],
    ['country grid = customers', true],
    ['new + existing months = customers', true],
    ['new-customer profit = new months', true],
    ['each customer’s months = its row', true],
    ['each customer listed once', true],
  ])
  const off = CUSTOMERS.map((r: any, i: number) => (i === 4 ? { ...r, p_cost: String(Number(r.p_cost) + 0.01) } : r))
  const bad = await ytd({}, { customer_summary: off })
  assertEquals(bad.checks.filter((c) => !c.ok).map((c) => c.name), [
    'customers = Executive Summary totals', 'teams = customers', 'country grid = customers', 'new + existing months = customers', 'each customer’s months = its row',
  ])
  // Team / type filters: no cross-page check; product + geography: none either.
  assert(!(await ytd({ team: 'EAM Chris' })).checks.some((c) => c.name.startsWith('customers = ')))
  assert(!(await ytd({ product: 'Rail', country: 'Spain' })).checks.some((c) => c.name.startsWith('customers = ')))
  assertEquals((await ytd({ country: 'Spain' })).checks[0].name, 'customers = Countries row (Spain)')
  assertEquals((await ytd({ product: 'Rail' })).checks[0].name, 'customers = Executive Summary product line (Rail)')
  assertEquals((await ytd({ region: 'Europe' })).checks[0].name, 'customers = Executive Summary region row (Europe)')
  // Payload extras.
  assertEquals(d.customer_groups, 184)
  assertEquals(d.team_options, ['B2C Matt', 'EAM Chris', 'EAM Gloria', 'EAM Renaldo', 'Sales Jojo', 'Sales Mo'])
  assertEquals(d.ctype_options, ['agency', 'corporate', 'partner', 'Unassigned'])
  assertEquals(labelOptions(['b', 'Unassigned', 'a', 'b']), ['a', 'b', 'Unassigned'])
  assertEquals([parseLabel('', 'team'), parseLabel('EAM Chris', 'team'), parseLabel('小红书', 'x')], ['', 'EAM Chris', '小红书'])
  assertThrows(() => parseLabel('x'.repeat(121), 'team'))
  assertThrows(() => parseLabel(3, 'team'))
  assertEquals(mapCustomers([]).length, 0)
  assertEquals(customerChecks([], [], [], { months: [], existing: [], new: [] }, { months: [], by_key: {} }, null, '').every((c) => c.ok), true)
})

// ── Page model ───────────────────────────────────────────────────────────────

Deno.test('header, selection, trend', async () => {
  const d = await ytd()
  assertEquals(header(d).subtitle, '2026 to date profit by customer, vs Jan–Aug 2025 (complete months).')
  assertEquals(header(d).sectionLabel, '2026 TO DATE — TOTAL PROFIT BY CUSTOMER')
  const f = await ytd({ region: 'Europe', team: 'EAM Chris', ctype: 'partner' })
  assertEquals(header(f).subtitle, '2026 to date profit by customer, vs Jan–Aug 2025 (complete months). Region: Europe. Team: EAM Chris. Type: partner.')
  assertEquals(selectedCustomer(d, null), 'Booking.com')
  assertEquals(selectedCustomer(d, '6 Tour'), '6 Tour')
  assertEquals(selectedCustomer(d, 'Groundspan'), 'Booking.com') // no trips this period
  assertEquals(selectedCustomer(d, 'Unmapped'), 'Booking.com')
  const t = trend(d, '6 Tour')!
  assertEquals([t.title, t.subtitle], ['Monthly trend: 6 Tour', 'Unassigned · EAM Chris · first trade Feb 2025'])
  assertEquals(t.stat, [['Total Profit', '$189k'], ['Margin', '23.6%'], ['Trips', '18,200'], ['Profit vs last year', '+18.5%']])
  assertEquals([t.totals.revenue, t.totals.trips], [toCents('803056.57'), 18200])
  const b = trend(d, 'Babylon')! // first trade Jan 2026: nothing last year → "New"
  assertEquals(b.stat.at(-1), ['Profit vs last year', 'New'])
  assertEquals(monthYear('2020-06-01'), 'Jun 2020')
})

Deno.test('all-customers table: rows, pinned Unmapped, totals, search, New tags and sorting', async () => {
  const d = await ytd()
  const t = table(d)
  assertEquals(t.rows.length, 101) // 100 customers with trips + Unmapped
  const sorted = sortRows(t.rows, (r: any) => r.profit, 1, (r: any) => r.none)
  assertEquals(sorted.at(-1).customer, 'Unmapped')
  assertEquals([t.total.profit, t.total.trips], [toCents('12563721.99'), 2118428])
  const fields = [(r: any) => r.customer, (r: any) => r.customer_type, (r: any) => r.team]
  assertEquals(filterRows(t.rows, '小红书', fields).map((r: any) => r.customer), ['小红书'])
  assertEquals(filterRows(t.rows, 'b2c matt', fields).length, 5)
  assertEquals(t.rows.filter((r: any) => r.isNew).length, 50)
  // "New" sorts last in both directions.
  const byYoy = (dirn: number) => sortRows(t.rows, yoySortValue, dirn, (r: any) => r.none).map((r: any) => r.customer)
  const newNames = new Set(t.rows.filter((r: any) => r.smallBase).map((r: any) => r.customer))
  for (const dirn of [1, -1]) {
    const order = byYoy(dirn).filter((c: string) => c !== 'Unmapped')
    const firstNew = order.findIndex((c: string) => newNames.has(c))
    assert(order.slice(firstNew).every((c: string) => newNames.has(c)))
  }
  const babylon = t.rows.find((r: any) => r.customer === 'Babylon')
  assertEquals([babylon.delta.text, babylon.mpts], ['New', null])
})

Deno.test('states: no customers in this selection', async () => {
  const e = await ytd({ team: 'Nobody' }, {
    customer_summary: [], customer_monthly: [], new_existing_monthly: [], team_summary: [], customer_country_grid: [],
  })
  assertEquals(kpis(e).cards.slice(1, 3).map((c: any) => c.sub), [NO_CUSTOMERS, NO_CUSTOMERS])
  assertEquals([top15(e).rows.length, pareto(e).empty, lowestMargin(e).empty, selectedCustomer(e, null), table(e).rows.length],
    [0, NO_CUSTOMERS, LOW_MARGIN_EMPTY, null, 0])
  assertEquals(heatmap(e).rows.length, 0)
  assertEquals(e.checks.every((c) => c.ok), true)
  assertEquals(enrich(e).length, 0)
})
