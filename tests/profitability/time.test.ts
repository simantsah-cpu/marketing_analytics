// deno test tests/profitability
import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import {
  periodSpec, timeContext, availablePeriods, parseAsOfSelector, resolveAsOf, bqTimestampText,
  monthRangeLabel, dayRangeLabel, snapshotOptions, baseStart, latestAsOfMs,
} from '../../supabase/functions/_shared/profitability/time.ts'

const at = (iso: string) => Date.parse(iso)
const ACCEPT = at('2026-09-28T08:30:00Z')

Deno.test('periods at the acceptance moment (5.2)', () => {
  const ytd = periodSpec('ytd', ACCEPT)
  assertEquals(ytd.label, '2026 to date')
  assertEquals(ytd.p, { start: '2026-01-01', end: '2026-09-28' })
  assertEquals(ytd.comparison?.cc, { start: '2026-01-01', end: '2026-08-31' })
  assertEquals(ytd.comparison?.cp, { start: '2025-01-01', end: '2025-08-31' })
  assertEquals(ytd.comparison?.label, 'vs Jan–Aug 2025 (complete months)')

  const complete = periodSpec('complete', ACCEPT)
  assertEquals(complete.label, 'Jan–Aug 2026')
  assertEquals(complete.p, { start: '2026-01-01', end: '2026-08-31' })
  assertEquals(complete.comparison?.label, 'vs Jan–Aug 2025')

  const mtd = periodSpec('mtd', ACCEPT)
  assertEquals(mtd.label, 'September 2026 to date')
  assertEquals(mtd.p, { start: '2026-09-01', end: '2026-09-28' })
  assertEquals(mtd.comparison, null)

  const ly = periodSpec('last_year', ACCEPT)
  assertEquals(ly.label, '2025')
  assertEquals(ly.p, { start: '2025-01-01', end: '2025-12-31' })
  assertEquals(ly.comparison?.cp, { start: '2024-01-01', end: '2024-12-31' })
  assertEquals(ly.comparison?.label, 'vs full year 2024')

  const since = periodSpec('since2025', ACCEPT)
  assertEquals(since.p, { start: '2025-01-01', end: '2026-09-28' })
  assertEquals(since.comparison, null)
})

Deno.test('January: YTD has no comparison and complete months is unavailable', () => {
  const t = at('2027-01-15T12:00:00Z')
  assertEquals(periodSpec('ytd', t).comparison, null)
  assertEquals(availablePeriods('2027-01-15').find((p) => p.key === 'complete')?.available, false)
  assertThrows(() => periodSpec('complete', t))
  // Last year rolls forward with the date: 2026 vs 2025.
  assertEquals(periodSpec('last_year', t).p, { start: '2026-01-01', end: '2026-12-31' })
  assertEquals(periodSpec('last_year', t).comparison?.label, 'vs full year 2025')
})

Deno.test('February 1st compares January only; labels are generated', () => {
  const s = periodSpec('ytd', at('2027-02-01T00:10:00Z'))
  assertEquals(s.comparison?.cc, { start: '2027-01-01', end: '2027-01-31' })
  assertEquals(s.comparison?.cp, { start: '2026-01-01', end: '2026-01-31' })
  assertEquals(s.comparison?.label, 'vs Jan 2026 (complete months)')
})

Deno.test('leap years: prior-year window ends on its own month end', () => {
  const s = periodSpec('ytd', at('2028-03-10T00:00:00Z'))
  assertEquals(s.comparison?.cc, { start: '2028-01-01', end: '2028-02-29' })
  assertEquals(s.comparison?.cp, { start: '2027-01-01', end: '2027-02-28' })
})

Deno.test('time context and base start', () => {
  const tc = timeContext(ACCEPT)
  assertEquals(tc, { T: '2026-09-28', M0: '2026-09-01', lcm: { start: '2026-08-01', end: '2026-08-31' }, current_month_label: 'September 2026' })
  assertEquals(baseStart(periodSpec('ytd', ACCEPT), ACCEPT), '2025-01-01')
  assertEquals(baseStart(periodSpec('mtd', ACCEPT), ACCEPT), '2025-09-01')
  assertEquals(baseStart(periodSpec('last_year', ACCEPT), ACCEPT), '2024-01-01')
})

Deno.test('as_of selectors and the time-travel window', () => {
  const now = at('2026-09-30T10:07:31Z')
  assertEquals(new Date(latestAsOfMs(now)).toISOString(), '2026-09-30T10:04:00.000Z')
  assertEquals(resolveAsOf(parseAsOfSelector('latest'), now), at('2026-09-30T10:04:00Z'))
  assertEquals(resolveAsOf(parseAsOfSelector('eod:2026-09-27'), now), at('2026-09-28T00:00:00Z'))
  assertEquals(resolveAsOf(parseAsOfSelector('2026-09-28T08:30:00Z'), now), ACCEPT)
  assertThrows(() => resolveAsOf(parseAsOfSelector('2026-09-20T08:30:00Z'), now)) // > 7 days
  assertThrows(() => resolveAsOf(parseAsOfSelector('2026-09-30T10:06:00Z'), now)) // < 3 minutes ago
  assertThrows(() => parseAsOfSelector("2026-09-28'; DROP"))
  assertThrows(() => parseAsOfSelector(42))
  assertEquals(bqTimestampText(ACCEPT), '2026-09-28 08:30:00+00')
  const snaps = snapshotOptions(now)
  assertEquals(snaps[0], { value: 'latest', label: 'Latest (2026-09-30)' })
  assertEquals(snaps.length, 7)
  assertEquals(snaps[6].value, 'eod:2026-09-24')
  // Every offered snapshot resolves inside the window.
  for (const s of snaps) resolveAsOf(parseAsOfSelector(s.value), now)
})

Deno.test('labels', () => {
  assertEquals(monthRangeLabel('2025-01-01', '2025-08-31'), 'Jan–Aug 2025')
  assertEquals(monthRangeLabel('2024-01-01', '2024-12-31'), 'full year 2024')
  assertEquals(monthRangeLabel('2026-01-01', '2026-01-31'), 'Jan 2026')
  assertEquals(dayRangeLabel('2026-09-01', '2026-09-27'), '1–27 Sep 2026')
  assertEquals(dayRangeLabel('2026-09-01', '2026-09-01'), '1 Sep 2026')
})
