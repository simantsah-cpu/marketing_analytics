// Shared by every Profitability page: period → typed query parameters, and the
// "pin one as_of, verify, retry once 25 minutes earlier" load loop.

import { type PeriodKey, periodSpec, baseStart, RETRY_STEP_MS } from './time.ts'
import { bqParams, type QueryName, type QueryParams } from './sql.ts'
import type { Check } from './payload.ts'

type Row = Record<string, string | null>
export type Runner = (name: QueryName, sql: string, params: ReturnType<typeof bqParams>, p: QueryParams) => Promise<Row[]>

export function periodQueryParams(period: PeriodKey, asOfMs: number): QueryParams {
  const spec = periodSpec(period, asOfMs)
  // With no comparison, pass the period itself as cc/cp and ignore the results.
  const cc = spec.comparison?.cc ?? spec.p
  const cp = spec.comparison?.cp ?? spec.p
  return {
    as_of_ms: asOfMs,
    base_start: baseStart(spec, asOfMs),
    p_start: spec.p.start, p_end: spec.p.end,
    cc_start: cc.start, cc_end: cc.end,
    cp_start: cp.start, cp_end: cp.end,
  }
}

export type Status = 'ok' | 'reloading' | 'inconsistent'

type Verifiable = { as_of: string; T: string; period: { start: string }; checks: Check[] }

/**
 * Runs `compute` at the pinned as_of. A result is bad when it is empty (a mid-reload read —
 * unless the period only began today, where zero trips is genuine) or when any consistency
 * check fails; then it retries once 25 minutes earlier.
 */
export async function loadPinned<D extends Verifiable>(
  asOfMs: number,
  compute: (asOfMs: number) => Promise<D>,
  totalTrips: (d: D) => number,
  log: (msg: string) => void = console.warn,
): Promise<{ status: Status; retried: boolean; data: D }> {
  const empty = (d: D) => totalTrips(d) === 0 && d.period.start < d.T
  const bad = (d: D) => empty(d) || d.checks.some((c) => !c.ok)
  const describe = (d: D) => `trips=${totalTrips(d)} ${JSON.stringify(d.checks.filter((c) => !c.ok))}`

  const first = await compute(asOfMs)
  if (!bad(first)) return { status: 'ok', retried: false, data: first }
  log(`[profitability] first attempt failed at ${first.as_of}: ${describe(first)}`)

  const second = await compute(asOfMs - RETRY_STEP_MS)
  if (!bad(second)) return { status: 'ok', retried: true, data: second }
  log(`[profitability] retry failed at ${second.as_of}: ${describe(second)}`)
  return { status: empty(second) ? 'reloading' : 'inconsistent', retried: true, data: second }
}
