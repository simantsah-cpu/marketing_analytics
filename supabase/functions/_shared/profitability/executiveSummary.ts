// Executive Summary: resolve windows → run component queries in parallel on one pinned
// as_of → assemble payload → verify consistency, retrying once 25 minutes earlier.

import { type PeriodKey, periodSpec, timeContext } from './time.ts'
import { componentSql, bqParams, type QueryName, type QueryParams } from './sql.ts'
import { buildPayload, type RawResults, type ExecutiveSummaryPayload } from './payload.ts'
import { periodQueryParams, loadPinned, type Runner, type Status } from './pinned.ts'

export type { Runner, Status }

export async function computeOnce(period: PeriodKey, asOfMs: number, requestedAsOfMs: number, run: Runner) {
  const spec = periodSpec(period, asOfMs)
  const tc = timeContext(asOfMs)
  const p = periodQueryParams(period, asOfMs)
  const q = (name: QueryName, extra: Partial<QueryParams> = {}) => {
    const pp = { ...p, ...extra }
    return run(name, componentSql(name, asOfMs), bqParams(pp), pp)
  }
  const [kpi_totals, mtd_same_days, monthly_by_product_line, monthly_by_region, by_product_line, by_region,
    movers_country, movers_customer] = await Promise.all([
    q('kpi_totals'),
    q('mtd_same_days'),
    q('monthly_by_product_line'),
    q('monthly_by_region'),
    q('by_product_line'),
    q('by_region'),
    spec.comparison ? q('movers_country', { dim: 'country' }) : Promise.resolve(null),
    spec.comparison ? q('movers_customer', { dim: 'customer' }) : Promise.resolve(null),
  ])
  const raw: RawResults = {
    kpi_totals, mtd_same_days, monthly_by_product_line, monthly_by_region, by_product_line, by_region,
    movers_country, movers_customer,
  }
  return buildPayload({ asOfMs, requestedAsOfMs, spec, tc, raw })
}

export function executiveSummary(
  period: PeriodKey, asOfMs: number, run: Runner, log?: (msg: string) => void,
): Promise<{ status: Status; retried: boolean; data: ExecutiveSummaryPayload }> {
  return loadPinned(asOfMs, (at) => computeOnce(period, at, asOfMs, run), (d) => d.kpi.p.trips, log)
}
