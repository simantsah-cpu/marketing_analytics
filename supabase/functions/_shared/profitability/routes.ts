// Routes page: route types (100% of trips), listed routes + one roll-up row, route KPIs over all
// routes, and monthly series — all on one pinned as_of, checked against the other pages.

import { type PeriodKey, periodSpec, timeContext, isoMinute, dateOf, monthsBetween } from './time.ts'
import { componentSql, bqParams, PRODUCT_LINES, NO_CITY, type QueryName, type QueryParams } from './sql.ts'
import { toCents, mapKpi, mapBreakdown, type Check, type Totals } from './payload.ts'
import { mapCountries } from './countries.ts'
import { mapCities } from './cities.ts'
import { periodQueryParams, loadPinned, type Runner, type Status } from './pinned.ts'

type Row = Record<string, string | null>
const int = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? 0 : parseInt(v, 10))

export const ROLLUP_ID = -2
export const TRANSFER_TYPES = [0, 1, 2, 3]

/** '' = all product lines; otherwise one of PRODUCT_LINES. */
export function parseProduct(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return ''
  if (typeof raw === 'string' && (PRODUCT_LINES as readonly string[]).includes(raw)) return raw
  throw new Error(`Unknown product: ${String(raw)}`)
}

/** Service-area id, or NO_CITY. */
export function parseCity(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return NO_CITY
  const s = String(raw)
  if (!/^-?\d{1,12}$/.test(s)) throw new Error(`Invalid city: ${s}`)
  return Number(s)
}

export const routeId = (saId: number, key: string) => `${saId}|${key}`

export const mapRouteTypes = (rows: Row[]) =>
  rows.map((r) => ({
    route_type: int(r.route_type),
    p_revenue: toCents(r.p_revenue), p_cost: toCents(r.p_cost), p_trips: int(r.p_trips),
    cc_revenue: toCents(r.cc_revenue), cc_cost: toCents(r.cc_cost),
    cp_revenue: toCents(r.cp_revenue), cp_cost: toCents(r.cp_cost),
  }))

export const mapRoutes = (rows: Row[]) =>
  rows.map((r) => ({
    id: routeId(int(r.sa_id), r.route_key!),
    sa_id: int(r.sa_id), route_key: r.route_key!,
    sa_name: r.sa_name ?? '', country: r.country ?? '', region: r.region ?? '',
    is_distance_priced: r.is_distance_priced === null || r.is_distance_priced === undefined ? null : r.is_distance_priced === 'true',
    p_revenue: toCents(r.p_revenue), p_cost: toCents(r.p_cost), p_trips: int(r.p_trips),
    cc_revenue: toCents(r.cc_revenue), cc_cost: toCents(r.cc_cost),
    cp_revenue: toCents(r.cp_revenue), cp_cost: toCents(r.cp_cost),
    n_routes: int(r.n_routes),
  }))

export function mapRouteKpis(r: Row | undefined) {
  return {
    routes: int(r?.routes), loss_routes: int(r?.loss_routes), loss_total: toCents(r?.loss_total),
    transfer_profit: toCents(r?.transfer_profit), top1_profit: toCents(r?.top1_profit), top1_key: r?.top1_key ?? null,
    top50_profit: toCents(r?.top50_profit), dp_profit: toCents(r?.dp_profit), dp_trips: int(r?.dp_trips),
    transfer_trips: int(r?.transfer_trips),
  }
}

/** Aligns (key, month) rows to the period's months: by_key[key][i] = [revenue, cost, trips]. */
export function alignByKey<R extends Row>(rows: R[], months: string[], keyOf: (r: R) => string) {
  const idx = new Map(months.map((m, i) => [m, i]))
  const by_key: Record<string, [number, number, number][]> = {}
  for (const r of rows) {
    const i = idx.get(r.month!)
    if (i === undefined) throw new Error(`Month ${r.month} outside the period`)
    const arr = (by_key[keyOf(r)] ??= months.map(() => [0, 0, 0] as [number, number, number]))
    arr[i] = [toCents(r.revenue), toCents(r.cost), int(r.trips)]
  }
  return { months: months.map((m) => m.slice(0, 7)), by_key }
}

type Types = ReturnType<typeof mapRouteTypes>
type Routes = ReturnType<typeof mapRoutes>
type Kpis = ReturnType<typeof mapRouteKpis>
type Monthly = ReturnType<typeof alignByKey>

export function routeChecks(
  types: Types, typeMonthly: Monthly, routes: Routes, kpis: Kpis, monthly: Monthly,
  expected: Totals | null, expectedName: string,
): Check[] {
  const tot = <T extends { p_revenue: number; p_cost: number; p_trips: number }>(xs: T[]): Totals =>
    xs.reduce((a, x) => ({ revenue: a.revenue + x.p_revenue, cost: a.cost + x.p_cost, trips: a.trips + x.p_trips }), { revenue: 0, cost: 0, trips: 0 })
  const same = (a: Totals, b: Totals) => a.revenue === b.revenue && a.cost === b.cost && a.trips === b.trips
  const check = (name: string, ok: boolean, detail: string): Check => (ok ? { name, ok } : { name, ok, detail })
  const all = tot(types)
  const transfer = tot(types.filter((t) => TRANSFER_TYPES.includes(t.route_type)))
  const listed = tot(routes)
  const listedProfit = listed.revenue - listed.cost
  const listedRows = routes.filter((r) => r.sa_id !== ROLLUP_ID)
  const rollup = routes.find((r) => r.sa_id === ROLLUP_ID)
  let typeMonths: Totals = { revenue: 0, cost: 0, trips: 0 }
  for (const arr of Object.values(typeMonthly.by_key)) for (const v of arr) typeMonths = { revenue: typeMonths.revenue + v[0], cost: typeMonths.cost + v[1], trips: typeMonths.trips + v[2] }
  let monthMismatch = 0
  for (const r of listedRows) {
    const t = (monthly.by_key[r.id] ?? []).reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0])
    if (t[0] !== r.p_revenue || t[1] !== r.p_cost || t[2] !== r.p_trips) monthMismatch++
  }
  const ids = new Set(listedRows.map((r) => r.id))
  const checks: Check[] = [
    check('route types months = route types', same(typeMonths, all), `${JSON.stringify(typeMonths)} vs ${JSON.stringify(all)}`),
    check('listed routes + roll-up = transfer route types', same(listed, transfer), `${JSON.stringify(listed)} vs ${JSON.stringify(transfer)}`),
    check('route KPIs transfer profit = listed profit', kpis.transfer_profit === listedProfit, `${kpis.transfer_profit} vs ${listedProfit}`),
    check('route KPIs routes = listed + roll-up count', kpis.routes === listedRows.length + (rollup?.n_routes ?? 0), `${kpis.routes} vs ${listedRows.length} + ${rollup?.n_routes ?? 0}`),
    check('each listed route’s months = its row', monthMismatch === 0, `${monthMismatch} routes differ`),
    check('each route listed once', ids.size === listedRows.length, `${listedRows.length - ids.size} duplicates`),
  ]
  if (expected) checks.unshift(check(`route types = ${expectedName}`, same(all, expected), `${JSON.stringify(all)} vs ${JSON.stringify(expected)}`))
  return checks
}

export async function computeRoutesOnce(
  period: PeriodKey, f: { region: string; country: string; product: string; city: number },
  asOfMs: number, requestedAsOfMs: number, run: Runner,
) {
  const spec = periodSpec(period, asOfMs)
  const tc = timeContext(asOfMs)
  const base = periodQueryParams(period, asOfMs)
  const p: QueryParams = { ...base, ...f }
  const q = (name: QueryName, params: QueryParams) => run(name, componentSql(name, asOfMs), bqParams(params), params)
  const hasCity = f.city !== NO_CITY
  // The cross-page check that applies to this filter combination (product + geography has
  // no counterpart on another page; the internal checks still run).
  const external = !f.product
    ? hasCity ? 'city' : f.country ? 'country' : f.region ? 'region' : 'all'
    : !f.region && !f.country && !hasCity ? 'product' : null
  const none = Promise.resolve([] as Row[])
  const [typeRows, typeMonthRows, listedRows, kpiRows, monthRows, kpiTotals, countryRows, cityRows, regionRows, productRows, cityInfo] = await Promise.all([
    q('route_types', p),
    q('route_type_monthly', p),
    q('routes_listed', p),
    q('route_kpis', p),
    q('route_monthly', p),
    q('kpi_totals', base),
    q('country_summary', { ...base, region: f.region }), // country dropdown + Countries-row check
    external === 'city' ? q('city_summary', { ...base, region: f.region, country: f.country }) : none,
    external === 'region' ? q('by_region', base) : none,
    external === 'product' ? q('by_product_line', base) : none,
    hasCity ? q('city_info', p) : none,
  ])
  const months = monthsBetween(spec.p.start, spec.p.end < tc.T ? spec.p.end : tc.T)
  const route_types = mapRouteTypes(typeRows)
  const type_monthly = alignByKey(typeMonthRows, months, (r) => r.route_type!)
  const routes = mapRoutes(listedRows)
  const route_kpis = mapRouteKpis(kpiRows[0])
  const monthly = alignByKey(monthRows, months, (r) => routeId(int(r.sa_id), r.route_key!))
  const kpi = mapKpi(kpiTotals[0])
  const countries = mapCountries(countryRows)

  const row = (r: { p_revenue: number; p_cost: number; p_trips: number } | undefined): Totals =>
    ({ revenue: r?.p_revenue ?? 0, cost: r?.p_cost ?? 0, trips: r?.p_trips ?? 0 })
  let expected: Totals | null = null
  let expectedName = ''
  if (external === 'all') { expected = kpi.p; expectedName = 'Executive Summary totals' }
  if (external === 'region') { expected = row(mapBreakdown(regionRows).find((x) => x.name === f.region)); expectedName = `Executive Summary region row (${f.region})` }
  if (external === 'product') { expected = row(mapBreakdown(productRows).find((x) => x.name === f.product)); expectedName = `Executive Summary product line (${f.product})` }
  if (external === 'country') { expected = row(countries.find((x) => x.country === f.country)); expectedName = `Countries row (${f.country})` }
  if (external === 'city') { expected = row(mapCities(cityRows).find((x) => x.sa_id === f.city)); expectedName = `Cities row (${f.city})` }

  const country_options = countries.filter((c) => c.p_trips > 0).map((c) => c.country)
    .sort((a, b) => (a === 'Unmapped' ? 1 : b === 'Unmapped' ? -1 : a.localeCompare(b)))
  return {
    as_of: isoMinute(asOfMs),
    as_of_requested: isoMinute(requestedAsOfMs),
    data_date: dateOf(asOfMs - 1),
    T: tc.T,
    warehouse_loaded_at: kpi.warehouse_loaded_at,
    period: { key: spec.key, label: spec.label, option_label: spec.option_label, start: spec.p.start, end: spec.p.end },
    comparison: spec.comparison,
    current_month: { start: tc.M0, label: tc.current_month_label },
    region: f.region, country: f.country, product: f.product, city: hasCity ? f.city : null,
    city_info: hasCity ? { sa_id: f.city, sa_name: cityInfo[0]?.sa_name ?? null, country: cityInfo[0]?.country ?? null } : null,
    country_options,
    company_trips: kpi.p.trips,
    route_types,
    type_monthly,
    routes,
    route_kpis,
    monthly,
    checks: routeChecks(route_types, type_monthly, routes, route_kpis, monthly, expected, expectedName),
  }
}

export type RoutesPayload = Awaited<ReturnType<typeof computeRoutesOnce>>

export function routesPage(
  period: PeriodKey, f: { region: string; country: string; product: string; city: number },
  asOfMs: number, run: Runner, log?: (msg: string) => void,
): Promise<{ status: Status; retried: boolean; data: RoutesPayload }> {
  return loadPinned(asOfMs, (at) => computeRoutesOnce(period, f, at, asOfMs, run), (d) => d.company_trips, log)
}
