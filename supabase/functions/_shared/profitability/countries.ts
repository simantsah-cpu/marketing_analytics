// Countries page: country_summary + country_monthly on one pinned as_of, checked against
// the Executive Summary totals (all regions) or that region's row (one region).

import { type PeriodKey, periodSpec, timeContext, isoMinute, dateOf, monthsBetween } from './time.ts'
import { componentSql, bqParams, REGIONS, type QueryName, type QueryParams } from './sql.ts'
import { toCents, mapKpi, mapBreakdown, type Check, type Totals } from './payload.ts'
import { periodQueryParams, loadPinned, type Runner, type Status } from './pinned.ts'

type Row = Record<string, string | null>
const int = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? 0 : parseInt(v, 10))

/** '' = all regions; otherwise one of the display labels. */
export function parseRegion(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return ''
  if (typeof raw === 'string' && (REGIONS as readonly string[]).includes(raw)) return raw
  throw new Error(`Unknown region: ${String(raw)}`)
}

export const mapCountries = (rows: Row[]) =>
  rows.map((r) => ({
    country: r.country!,
    main_region: r.main_region ?? null,
    all_regions: r.all_regions ? r.all_regions.split('|') : [],
    p_revenue: toCents(r.p_revenue), p_cost: toCents(r.p_cost), p_trips: int(r.p_trips),
    cc_revenue: toCents(r.cc_revenue), cc_cost: toCents(r.cc_cost), cc_trips: int(r.cc_trips),
    cp_revenue: toCents(r.cp_revenue), cp_cost: toCents(r.cp_cost), cp_trips: int(r.cp_trips),
  }))

export const mapCountryMonthly = (rows: Row[]) =>
  rows.map((r) => ({ month: r.month!, country: r.country!, revenue: toCents(r.revenue), cost: toCents(r.cost), trips: int(r.trips) }))

export function countryChecks(
  countries: ReturnType<typeof mapCountries>,
  monthly: ReturnType<typeof mapCountryMonthly>,
  expected: Totals,
  expectedName: string,
): Check[] {
  const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0)
  const c: Totals = { revenue: sum(countries, (x) => x.p_revenue), cost: sum(countries, (x) => x.p_cost), trips: sum(countries, (x) => x.p_trips) }
  const m: Totals = { revenue: sum(monthly, (x) => x.revenue), cost: sum(monthly, (x) => x.cost), trips: sum(monthly, (x) => x.trips) }
  const same = (a: Totals, b: Totals) => a.revenue === b.revenue && a.cost === b.cost && a.trips === b.trips
  const check = (name: string, got: Totals, want: Totals): Check =>
    same(got, want) ? { name, ok: true } : { name, ok: false, detail: `got ${JSON.stringify(got)} expected ${JSON.stringify(want)}` }
  return [check(`countries = ${expectedName}`, c, expected), check('country months = countries', m, c)]
}

export async function computeCountriesOnce(
  period: PeriodKey, region: string, asOfMs: number, requestedAsOfMs: number, run: Runner,
) {
  const spec = periodSpec(period, asOfMs)
  const tc = timeContext(asOfMs)
  const p: QueryParams = { ...periodQueryParams(period, asOfMs), region }
  const q = (name: QueryName) => run(name, componentSql(name, asOfMs), bqParams(p), p)
  // kpi_totals gives the company totals (and warehouse load time); by_region the
  // per-region totals the page must add back to when a region is selected.
  const [summary, monthlyRows, kpiRows, regionRows] = await Promise.all([
    q('country_summary'),
    q('country_monthly'),
    q('kpi_totals'),
    region ? q('by_region') : Promise.resolve([]),
  ])
  const countries = mapCountries(summary)
  const monthly = mapCountryMonthly(monthlyRows)
  const kpi = mapKpi(kpiRows[0])
  let expected: Totals = kpi.p
  let expectedName = 'Executive Summary totals'
  if (region) {
    const r = mapBreakdown(regionRows).find((x) => x.name === region)
    expected = { revenue: r?.p_revenue ?? 0, cost: r?.p_cost ?? 0, trips: r?.p_trips ?? 0 }
    expectedName = `Executive Summary region row (${region})`
  }
  return {
    as_of: isoMinute(asOfMs),
    as_of_requested: isoMinute(requestedAsOfMs),
    data_date: dateOf(asOfMs - 1),
    T: tc.T,
    warehouse_loaded_at: kpi.warehouse_loaded_at,
    period: { key: spec.key, label: spec.label, option_label: spec.option_label, start: spec.p.start, end: spec.p.end },
    comparison: spec.comparison,
    current_month: { start: tc.M0, label: tc.current_month_label },
    months: monthsBetween(spec.p.start, spec.p.end < tc.T ? spec.p.end : tc.T),
    region,
    // Company totals for the same period and as_of, so a reload never has to be trusted blindly.
    company_trips: kpi.p.trips,
    countries,
    monthly,
    checks: countryChecks(countries, monthly, expected, expectedName),
  }
}

export type CountriesPayload = Awaited<ReturnType<typeof computeCountriesOnce>>

export function countriesPage(
  period: PeriodKey, region: string, asOfMs: number, run: Runner, log?: (msg: string) => void,
): Promise<{ status: Status; retried: boolean; data: CountriesPayload }> {
  // "Empty" is judged on the company total: a region can legitimately have no trips.
  return loadPinned(asOfMs, (at) => computeCountriesOnce(period, region, at, asOfMs, run), (d) => d.company_trips, log)
}
