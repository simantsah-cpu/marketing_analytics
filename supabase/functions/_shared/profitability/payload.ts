// Executive Summary payload assembly — pure functions, no I/O.
// All money leaves here as integer cents; the UI divides by 100 only to render.

import { type PeriodSpec, type TimeContext, dayRangeLabel, isoMinute, dateOf } from './time.ts'

type Row = Record<string, string | null>

/**
 * Exact decimal string → integer cents. BigQuery NUMERIC arrives as a string such as
 * '41789883.44' or '-0.5'; parse digits instead of multiplying floats.
 */
export function toCents(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0
  const s = String(v).trim()
  const m = /^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s)
  if (!m || m[4] !== undefined) {
    // Scientific notation or anything unexpected: fall back to rounding (still exact below 2^53 cents).
    const n = Number(s)
    if (!isFinite(n)) throw new Error(`Not a number: ${s}`)
    return Math.round(n * 100)
  }
  const [, sign, int = '', frac = ''] = m
  const f = (frac + '00').slice(0, 2)
  let cents = Number(int || '0') * 100 + Number(f)
  // Values are already rounded to 2 dp per row in SQL; a third decimal would mean a query bug.
  if (/[1-9]/.test(frac.slice(2))) {
    cents += Number(frac[2]) >= 5 ? 1 : 0
  }
  return sign === '-' ? -cents : cents
}

const int = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? 0 : parseInt(v, 10))

export type Totals = { revenue: number; cost: number; trips: number }

export function mapKpi(r: Row | undefined) {
  const w = (k: string): Totals => ({
    revenue: toCents(r?.[`${k}_revenue`]), cost: toCents(r?.[`${k}_cost`]), trips: int(r?.[`${k}_trips`]),
  })
  return { p: w('p'), cc: w('cc'), cp: w('cp'), warehouse_loaded_at: r?.warehouse_loaded_at ?? null }
}

export const mapMonthly = (rows: Row[]) =>
  rows.map((r) => ({ month: r.month!, name: r.name!, revenue: toCents(r.revenue), cost: toCents(r.cost), trips: int(r.trips) }))

export const mapBreakdown = (rows: Row[]) =>
  rows.map((r) => ({
    name: r.name!,
    p_revenue: toCents(r.p_revenue), p_cost: toCents(r.p_cost), p_trips: int(r.p_trips),
    cc_profit: toCents(r.cc_profit), cp_profit: toCents(r.cp_profit),
    cc_revenue: toCents(r.cc_revenue), cp_revenue: toCents(r.cp_revenue),
  }))

export const mapMtd = (rows: Row[]) =>
  rows.map((r) => ({
    win: r.win!, start: r.ws!, end: r.we!, label: dayRangeLabel(r.ws!, r.we!),
    revenue: toCents(r.revenue), cost: toCents(r.cost), trips: int(r.trips),
  }))

export const mapMovers = (rows: Row[]) =>
  rows.map((r) => ({
    name: r.name!, cc_profit: toCents(r.cc_profit), cp_profit: toCents(r.cp_profit), change: toCents(r.change), dir: r.dir!,
  }))

// ── Consistency checks ───────────────────────────────────────────────────────

const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0)

export type Check = { name: string; ok: boolean; detail?: string }

export function consistencyChecks(q: {
  kpi: ReturnType<typeof mapKpi>
  by_pl: ReturnType<typeof mapBreakdown>
  by_region: ReturnType<typeof mapBreakdown>
  monthly_pl: ReturnType<typeof mapMonthly>
  monthly_region: ReturnType<typeof mapMonthly>
}): Check[] {
  const k = q.kpi.p
  const eq = (name: string, t: Totals): Check => {
    const ok = t.revenue === k.revenue && t.cost === k.cost && t.trips === k.trips
    return ok ? { name, ok } : { name, ok, detail: `got ${JSON.stringify(t)} expected ${JSON.stringify(k)}` }
  }
  const bd = (xs: ReturnType<typeof mapBreakdown>): Totals =>
    ({ revenue: sum(xs, (x) => x.p_revenue), cost: sum(xs, (x) => x.p_cost), trips: sum(xs, (x) => x.p_trips) })
  const mo = (xs: ReturnType<typeof mapMonthly>): Totals =>
    ({ revenue: sum(xs, (x) => x.revenue), cost: sum(xs, (x) => x.cost), trips: sum(xs, (x) => x.trips) })
  return [
    eq('product lines = KPI totals', bd(q.by_pl)),
    eq('regions = KPI totals', bd(q.by_region)),
    eq('monthly by product line = KPI totals', mo(q.monthly_pl)),
    eq('monthly by region = KPI totals', mo(q.monthly_region)),
  ]
}

// ── Payload ──────────────────────────────────────────────────────────────────

export type RawResults = {
  kpi_totals: Row[]
  mtd_same_days: Row[]
  monthly_by_product_line: Row[]
  monthly_by_region: Row[]
  by_product_line: Row[]
  by_region: Row[]
  movers_country: Row[] | null
  movers_customer: Row[] | null
}

export function buildPayload(args: {
  asOfMs: number
  requestedAsOfMs: number
  spec: PeriodSpec
  tc: TimeContext
  raw: RawResults
}) {
  const { asOfMs, requestedAsOfMs, spec, tc, raw } = args
  const kpi = mapKpi(raw.kpi_totals[0])
  const by_pl = mapBreakdown(raw.by_product_line)
  const by_region = mapBreakdown(raw.by_region)
  const monthly_pl = mapMonthly(raw.monthly_by_product_line)
  const monthly_region = mapMonthly(raw.monthly_by_region)
  const mtdRows = mapMtd(raw.mtd_same_days)
  const checks = consistencyChecks({ kpi, by_pl, by_region, monthly_pl, monthly_region })
  const days = Math.max(0, +tc.T.slice(8, 10) - 1)
  return {
    as_of: isoMinute(asOfMs),
    as_of_requested: isoMinute(requestedAsOfMs),
    // Date the data covers up to (end-of-day snapshots pin to the next midnight).
    data_date: dateOf(asOfMs - 1),
    T: tc.T,
    warehouse_loaded_at: kpi.warehouse_loaded_at,
    period: { key: spec.key, label: spec.label, option_label: spec.option_label, start: spec.p.start, end: spec.p.end },
    comparison: spec.comparison,
    current_month: { start: tc.M0, label: tc.current_month_label },
    kpi: { p: kpi.p, cc: kpi.cc, cp: kpi.cp },
    mtd: { days, rows: mtdRows },
    monthly_pl,
    by_pl,
    by_region,
    monthly_region,
    movers: spec.comparison
      ? { country: mapMovers(raw.movers_country ?? []), customer: mapMovers(raw.movers_customer ?? []) }
      : null,
    checks,
  }
}

export type ExecutiveSummaryPayload = ReturnType<typeof buildPayload>
