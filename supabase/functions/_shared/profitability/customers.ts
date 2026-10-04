// Customers page: one row per customer group, teams, the customer × country grid, new vs
// existing monthly profit and per-customer monthly series — all on one pinned as_of, checked
// against each other and (without a team/type filter) against the other pages.

import { type PeriodKey, periodSpec, timeContext, isoMinute, dateOf, monthsBetween } from './time.ts'
import { componentSql, bqParams, CUSTOMER_HISTORY_START, type QueryName, type QueryParams } from './sql.ts'
import { toCents, mapKpi, mapBreakdown, type Check, type Totals } from './payload.ts'
import { mapCountries } from './countries.ts'
import { alignByKey } from './routes.ts'
import { periodQueryParams, loadPinned, type Runner, type Status } from './pinned.ts'

type Row = Record<string, string | null>
const int = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? 0 : parseInt(v, 10))

export const UNMAPPED = 'Unmapped'
export const UNASSIGNED = 'Unassigned'

/** Team or customer type filter: '' = all; otherwise the stored label (bound as a parameter). */
export function parseLabel(raw: unknown, what: string): string {
  if (raw === undefined || raw === null || raw === '') return ''
  if (typeof raw !== 'string' || raw.length > 120 || /[\u0000-\u001f]/.test(raw)) throw new Error(`Invalid ${what}`)
  return raw
}

export const mapCustomers = (rows: Row[]) =>
  rows.map((r) => ({
    customer: r.customer!, customer_type: r.customer_type ?? UNASSIGNED, team: r.team ?? UNASSIGNED,
    first_trade_month: r.first_trade_month ?? null,
    p_revenue: toCents(r.p_revenue), p_cost: toCents(r.p_cost), p_trips: int(r.p_trips), p_new_profit: toCents(r.p_new_profit),
    cc_revenue: toCents(r.cc_revenue), cc_cost: toCents(r.cc_cost),
    cp_revenue: toCents(r.cp_revenue), cp_cost: toCents(r.cp_cost), cp_trips: int(r.cp_trips),
  }))

export const mapTeams = (rows: Row[]) =>
  rows.map((r) => ({
    team: r.team!, customers: int(r.customers),
    p_revenue: toCents(r.p_revenue), p_cost: toCents(r.p_cost), p_trips: int(r.p_trips),
    cc_revenue: toCents(r.cc_revenue), cc_cost: toCents(r.cc_cost),
    cp_revenue: toCents(r.cp_revenue), cp_cost: toCents(r.cp_cost),
  }))

export const mapGrid = (rows: Row[]) =>
  rows.map((r) => ({
    ki: int(r.ki), ci: int(r.ci), customer: r.customer!, country: r.country!,
    revenue: toCents(r.revenue), cost: toCents(r.cost), trips: int(r.trips),
  }))

export const mapAttrs = (rows: Row[]) =>
  rows.map((r) => ({
    customer: r.customer!, customer_type: r.customer_type ?? UNASSIGNED, team: r.team ?? UNASSIGNED,
    first_trade_month: r.first_trade_month ?? null, first_seen_month: r.first_seen_month ?? null,
    dim_first_trade: r.dim_first_trade ?? null, p_trips: int(r.p_trips),
  }))

/** new_existing_monthly → { months, existing[i], new[i] } as [revenue, cost, trips, customers]. */
export function alignNewExisting(rows: Row[], months: string[]) {
  const idx = new Map(months.map((m, i) => [m, i]))
  const blank = () => months.map(() => [0, 0, 0, 0] as [number, number, number, number])
  const out = { months: months.map((m) => m.slice(0, 7)), existing: blank(), new: blank() }
  for (const r of rows) {
    const i = idx.get(r.month!)
    if (i === undefined) throw new Error(`Month ${r.month} outside the period`)
    const isNew = String(r.is_new) === 'true'
    ;(isNew ? out.new : out.existing)[i] = [toCents(r.revenue), toCents(r.cost), int(r.trips), int(r.customers)]
  }
  return out
}

/** Dropdown options: A→Z (as stored), "Unassigned" last. */
export function labelOptions(xs: string[]) {
  return [...new Set(xs)].sort((a, b) => (a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : a.localeCompare(b)))
}

type Customers = ReturnType<typeof mapCustomers>
type Teams = ReturnType<typeof mapTeams>
type Grid = ReturnType<typeof mapGrid>
type NewExisting = ReturnType<typeof alignNewExisting>
type Monthly = ReturnType<typeof alignByKey>

export function customerChecks(
  customers: Customers, teams: Teams, grid: Grid, ne: NewExisting, monthly: Monthly,
  expected: Totals | null, expectedName: string,
): Check[] {
  const same = (a: Totals, b: Totals) => a.revenue === b.revenue && a.cost === b.cost && a.trips === b.trips
  const check = (name: string, ok: boolean, detail: string): Check => (ok ? { name, ok } : { name, ok, detail })
  const add = (a: Totals, r: number, c: number, t: number): Totals => ({ revenue: a.revenue + r, cost: a.cost + c, trips: a.trips + t })
  const Z: Totals = { revenue: 0, cost: 0, trips: 0 }
  const cust = customers.reduce((a, x) => add(a, x.p_revenue, x.p_cost, x.p_trips), Z)
  const team = teams.reduce((a, x) => add(a, x.p_revenue, x.p_cost, x.p_trips), Z)
  const cells = grid.reduce((a, x) => add(a, x.revenue, x.cost, x.trips), Z)
  const months = [...ne.existing, ...ne.new].reduce((a, v) => add(a, v[0], v[1], v[2]), Z)
  const newProfit = customers.reduce((a, x) => a + x.p_new_profit, 0)
  const newMonths = ne.new.reduce((a, v) => a + v[0] - v[1], 0)
  let monthMismatch = 0
  for (const r of customers) {
    const t = (monthly.by_key[r.customer] ?? []).reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0])
    if (t[0] !== r.p_revenue || t[1] !== r.p_cost || t[2] !== r.p_trips) monthMismatch++
  }
  const j = (x: unknown) => JSON.stringify(x)
  const checks: Check[] = [
    check('teams = customers', same(team, cust), `${j(team)} vs ${j(cust)}`),
    check('country grid = customers', same(cells, cust), `${j(cells)} vs ${j(cust)}`),
    check('new + existing months = customers', same(months, cust), `${j(months)} vs ${j(cust)}`),
    check('new-customer profit = new months', newProfit === newMonths, `${newProfit} vs ${newMonths}`),
    check('each customer’s months = its row', monthMismatch === 0, `${monthMismatch} customers differ`),
    check('each customer listed once', new Set(customers.map((c) => c.customer)).size === customers.length, 'duplicate customers'),
  ]
  if (expected) checks.unshift(check(`customers = ${expectedName}`, same(cust, expected), `${j(cust)} vs ${j(expected)}`))
  return checks
}

export type CustomerFilters = { region: string; country: string; product: string; team: string; ctype: string }

export async function computeCustomersOnce(
  period: PeriodKey, f: CustomerFilters, asOfMs: number, requestedAsOfMs: number, run: Runner,
) {
  const spec = periodSpec(period, asOfMs)
  const tc = timeContext(asOfMs)
  const base = periodQueryParams(period, asOfMs)
  // Attributes and "first seen" need the full history, whatever the period.
  const p: QueryParams = { ...base, base_start: CUSTOMER_HISTORY_START, ...f }
  const q = (name: QueryName, params: QueryParams) => run(name, componentSql(name, asOfMs), bqParams(params), params)
  // The cross-page check for this filter combination (none with a team/type filter, or with
  // product + geography, which no other page shows).
  const external = f.team || f.ctype ? null
    : f.product ? (f.region || f.country ? null : 'product')
    : f.country ? 'country' : f.region ? 'region' : 'all'
  const none = Promise.resolve([] as Row[])
  const [custRows, monthRows, neRows, teamRows, gridRows, attrRows, kpiRows, countryRows, regionRows, productRows] = await Promise.all([
    q('customer_summary', p),
    q('customer_monthly', p),
    q('new_existing_monthly', p),
    q('team_summary', p),
    q('customer_country_grid', p),
    q('customer_attrs', p),
    q('kpi_totals', base),
    q('country_summary', { ...base, region: f.region }), // country dropdown + Countries-row check
    external === 'region' ? q('by_region', base) : none,
    external === 'product' ? q('by_product_line', base) : none,
  ])
  const months = monthsBetween(spec.p.start, spec.p.end < tc.T ? spec.p.end : tc.T)
  const customers = mapCustomers(custRows)
  const teams = mapTeams(teamRows)
  const grid = mapGrid(gridRows)
  const new_existing = alignNewExisting(neRows, months)
  const monthly = alignByKey(monthRows, months, (r) => r.customer!)
  const attrs = mapAttrs(attrRows)
  const kpi = mapKpi(kpiRows[0])
  const countries = mapCountries(countryRows)

  const row = (r: { p_revenue: number; p_cost: number; p_trips: number } | undefined): Totals =>
    ({ revenue: r?.p_revenue ?? 0, cost: r?.p_cost ?? 0, trips: r?.p_trips ?? 0 })
  let expected: Totals | null = null
  let expectedName = ''
  if (external === 'all') { expected = kpi.p; expectedName = 'Executive Summary totals' }
  if (external === 'region') { expected = row(mapBreakdown(regionRows).find((x) => x.name === f.region)); expectedName = `Executive Summary region row (${f.region})` }
  if (external === 'product') { expected = row(mapBreakdown(productRows).find((x) => x.name === f.product)); expectedName = `Executive Summary product line (${f.product})` }
  if (external === 'country') { expected = row(countries.find((x) => x.country === f.country)); expectedName = `Countries row (${f.country})` }

  const active = attrs.filter((a) => a.p_trips > 0 && a.customer !== UNMAPPED)
  return {
    as_of: isoMinute(asOfMs),
    as_of_requested: isoMinute(requestedAsOfMs),
    data_date: dateOf(asOfMs - 1),
    T: tc.T,
    warehouse_loaded_at: kpi.warehouse_loaded_at,
    period: { key: spec.key, label: spec.label, option_label: spec.option_label, start: spec.p.start, end: spec.p.end },
    comparison: spec.comparison,
    current_month: { start: tc.M0, label: tc.current_month_label },
    region: f.region, country: f.country, product: f.product, team: f.team, ctype: f.ctype,
    customer_groups: int(attrRows[0]?.customer_groups),
    // Teams / types with trips in this period under the geography and product filters.
    team_options: labelOptions(active.map((a) => a.team)),
    ctype_options: labelOptions(active.map((a) => a.customer_type)),
    country_options: countries.filter((c) => c.p_trips > 0).map((c) => c.country)
      .sort((a, b) => (a === UNMAPPED ? 1 : b === UNMAPPED ? -1 : a.localeCompare(b))),
    company_trips: kpi.p.trips,
    customers,
    teams,
    grid,
    new_existing,
    monthly,
    checks: customerChecks(customers, teams, grid, new_existing, monthly, expected, expectedName),
  }
}

export type CustomersPayload = Awaited<ReturnType<typeof computeCustomersOnce>>

export function customersPage(
  period: PeriodKey, f: CustomerFilters, asOfMs: number, run: Runner, log?: (msg: string) => void,
): Promise<{ status: Status; retried: boolean; data: CustomersPayload }> {
  return loadPinned(asOfMs, (at) => computeCustomersOnce(period, f, at, asOfMs, run), (d) => d.company_trips, log)
}
