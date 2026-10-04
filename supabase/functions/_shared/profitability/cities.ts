// Cities page: city_summary + city_monthly on one pinned as_of, checked against the
// Countries-page row (country filter), the Executive Summary region row (region filter) or
// the Executive Summary totals (no filter).

import { type PeriodKey, periodSpec, timeContext, isoMinute, dateOf, monthsBetween } from './time.ts'
import { componentSql, bqParams, type QueryName, type QueryParams } from './sql.ts'
import { toCents, mapKpi, mapBreakdown, type Check, type Totals } from './payload.ts'
import { mapCountries } from './countries.ts'
import { periodQueryParams, loadPinned, type Runner, type Status } from './pinned.ts'

type Row = Record<string, string | null>
const int = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? 0 : parseInt(v, 10))

/** '' = all countries; otherwise any country name (sent as a typed query parameter). */
export function parseCountry(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return ''
  if (typeof raw !== 'string' || raw.length > 120 || /[\u0000-\u001f]/.test(raw)) throw new Error('Invalid country')
  return raw
}

export const NO_SERVICE_AREA_ID = -1

export const mapCities = (rows: Row[]) =>
  rows.map((r) => ({
    sa_id: int(r.sa_id),
    sa_name: r.sa_name ?? '(no service area)',
    country: r.country ?? 'Unmapped',
    region: r.region ?? 'Unmapped',
    p_revenue: toCents(r.p_revenue), p_cost: toCents(r.p_cost), p_trips: int(r.p_trips),
    cc_revenue: toCents(r.cc_revenue), cc_cost: toCents(r.cc_cost), cc_trips: int(r.cc_trips),
    cp_revenue: toCents(r.cp_revenue), cp_cost: toCents(r.cp_cost), cp_trips: int(r.cp_trips),
  }))

/** Aligns (sa_id, month) rows to the period's months: by_city[sa_id][i] = [revenue, cost, trips]. */
export function alignMonthly(rows: Row[], months: string[]) {
  const idx = new Map(months.map((m, i) => [m, i]))
  const by_city: Record<string, [number, number, number][]> = {}
  for (const r of rows) {
    const i = idx.get(r.month!)
    if (i === undefined) throw new Error(`Month ${r.month} outside the period`)
    const arr = (by_city[r.sa_id!] ??= months.map(() => [0, 0, 0] as [number, number, number]))
    arr[i] = [toCents(r.revenue), toCents(r.cost), int(r.trips)]
  }
  return { months: months.map((m) => m.slice(0, 7)), by_city }
}

export function cityChecks(
  cities: ReturnType<typeof mapCities>,
  monthly: ReturnType<typeof alignMonthly>,
  expected: Totals,
  expectedName: string,
): Check[] {
  const same = (a: Totals, b: Totals) => a.revenue === b.revenue && a.cost === b.cost && a.trips === b.trips
  const check = (name: string, got: Totals, want: Totals): Check =>
    same(got, want) ? { name, ok: true } : { name, ok: false, detail: `got ${JSON.stringify(got)} expected ${JSON.stringify(want)}` }
  const c: Totals = { revenue: 0, cost: 0, trips: 0 }
  for (const x of cities) { c.revenue += x.p_revenue; c.cost += x.p_cost; c.trips += x.p_trips }
  const m: Totals = { revenue: 0, cost: 0, trips: 0 }
  let cityMismatch = 0
  const seen = new Set<number>()
  let duplicates = 0
  for (const x of cities) {
    if (seen.has(x.sa_id)) duplicates++
    seen.add(x.sa_id)
    const arr = monthly.by_city[x.sa_id] ?? []
    const t = arr.reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0])
    if (t[0] !== x.p_revenue || t[1] !== x.p_cost || t[2] !== x.p_trips) cityMismatch++
  }
  for (const arr of Object.values(monthly.by_city)) for (const v of arr) { m.revenue += v[0]; m.cost += v[1]; m.trips += v[2] }
  return [
    check(`cities = ${expectedName}`, c, expected),
    check('city months = cities', m, c),
    cityMismatch ? { name: 'each city’s months = its row', ok: false, detail: `${cityMismatch} cities differ` } : { name: 'each city’s months = its row', ok: true },
    duplicates ? { name: 'each service area once', ok: false, detail: `${duplicates} duplicates` } : { name: 'each service area once', ok: true },
  ]
}

export async function computeCitiesOnce(
  period: PeriodKey, region: string, country: string, asOfMs: number, requestedAsOfMs: number, run: Runner,
) {
  const spec = periodSpec(period, asOfMs)
  const tc = timeContext(asOfMs)
  const base = periodQueryParams(period, asOfMs)
  const p: QueryParams = { ...base, region, country }
  const pr: QueryParams = { ...base, region } // Countries page for the same region: country options + check row
  const q = (name: QueryName, params: QueryParams) => run(name, componentSql(name, asOfMs), bqParams(params), params)
  const [summary, monthlyRows, countryRows, kpiRows, regionRows] = await Promise.all([
    q('city_summary', p),
    q('city_monthly', p),
    q('country_summary', pr),
    q('kpi_totals', base),
    region && !country ? q('by_region', base) : Promise.resolve([]),
  ])
  const months = monthsBetween(spec.p.start, spec.p.end < tc.T ? spec.p.end : tc.T)
  const cities = mapCities(summary)
  const monthly = alignMonthly(monthlyRows, months)
  const countries = mapCountries(countryRows)
  const kpi = mapKpi(kpiRows[0])

  let expected: Totals = kpi.p
  let expectedName = 'Executive Summary totals'
  if (country) {
    const r = countries.find((x) => x.country === country)
    expected = { revenue: r?.p_revenue ?? 0, cost: r?.p_cost ?? 0, trips: r?.p_trips ?? 0 }
    expectedName = `Countries row (${country}${region ? `, ${region}` : ''})`
  } else if (region) {
    const r = mapBreakdown(regionRows).find((x) => x.name === region)
    expected = { revenue: r?.p_revenue ?? 0, cost: r?.p_cost ?? 0, trips: r?.p_trips ?? 0 }
    expectedName = `Executive Summary region row (${region})`
  }
  // Country dropdown: countries with trips in this period and region, A→Z, Unmapped last.
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
    region,
    country,
    country_options,
    company_trips: kpi.p.trips,
    cities,
    monthly,
    checks: cityChecks(cities, monthly, expected, expectedName),
  }
}

export type CitiesPayload = Awaited<ReturnType<typeof computeCitiesOnce>>

export function citiesPage(
  period: PeriodKey, region: string, country: string, asOfMs: number, run: Runner, log?: (msg: string) => void,
): Promise<{ status: Status; retried: boolean; data: CitiesPayload }> {
  return loadPinned(asOfMs, (at) => computeCitiesOnce(period, region, country, at, asOfMs, run), (d) => d.company_trips, log)
}
