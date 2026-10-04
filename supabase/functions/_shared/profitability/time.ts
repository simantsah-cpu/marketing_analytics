// Profitability time model — pure functions, no I/O.
//
// Every date on a Profitability page derives from one pinned moment, as_of (UTC).
// T = DATE(as_of), M0 = first day of T's month, LCM = the month before M0
// (the last complete month). All month labels are generated from these dates.

export type Ymd = string // 'YYYY-MM-DD'

export const PERIOD_KEYS = ['ytd', 'complete', 'mtd', 'last_year', 'since2025'] as const
export type PeriodKey = typeof PERIOD_KEYS[number]

export const PERIOD_OPTION_LABELS: Record<PeriodKey, string> = {
  ytd:        'Year to date',
  complete:   'Complete months this year',
  mtd:        'Month to date',
  last_year:  'Last year',
  since2025: 'Since Jan 2025',
}

// The dashboard's own periods never start before this date (business request).
export const DASHBOARD_FLOOR: Ymd = '2025-01-01'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December']

// ── Date arithmetic on 'YYYY-MM-DD' strings (UTC, no local-time leakage) ──────

const pad = (n: number) => String(n).padStart(2, '0')
export const ymd = (y: number, m: number, d: number): Ymd => `${y}-${pad(m)}-${pad(d)}`
export const parts = (s: Ymd) => ({ y: +s.slice(0, 4), m: +s.slice(5, 7), d: +s.slice(8, 10) })
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
export const lastDayOfMonth = (y: number, m: number): Ymd => ymd(y, m, daysInMonth(y, m))

export function addDays(s: Ymd, n: number): Ymd {
  const { y, m, d } = parts(s)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function addMonths(s: Ymd, n: number): Ymd {
  // Only used on first-of-month dates, so day overflow cannot occur.
  const { y, m, d } = parts(s)
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, Math.min(d, daysInMonth(t.getUTCFullYear(), t.getUTCMonth() + 1)))
}

export const minYmd = (...xs: Ymd[]) => xs.reduce((a, b) => (b < a ? b : a))

// ── Labels ────────────────────────────────────────────────────────────────────

/** 'Jan–Aug 2025', 'Jan 2026', 'Nov 2025–Feb 2026', 'full year 2024' */
export function monthRangeLabel(start: Ymd, end: Ymd): string {
  const a = parts(start), b = parts(end)
  if (a.m === 1 && a.d === 1 && b.m === 12 && b.d === 31 && a.y === b.y) return `full year ${a.y}`
  if (a.y === b.y && a.m === b.m) return `${MON[a.m - 1]} ${a.y}`
  if (a.y === b.y) return `${MON[a.m - 1]}–${MON[b.m - 1]} ${a.y}`
  return `${MON[a.m - 1]} ${a.y}–${MON[b.m - 1]} ${b.y}`
}

/** '1–27 Sep 2026', '28 Sep 2026', '30 Sep – 2 Oct 2026' */
export function dayRangeLabel(start: Ymd, end: Ymd): string {
  const a = parts(start), b = parts(end)
  if (start === end) return `${a.d} ${MON[a.m - 1]} ${a.y}`
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MON[a.m - 1]} ${a.y}`
  if (a.y === b.y) return `${a.d} ${MON[a.m - 1]} – ${b.d} ${MON[b.m - 1]} ${a.y}`
  return `${a.d} ${MON[a.m - 1]} ${a.y} – ${b.d} ${MON[b.m - 1]} ${b.y}`
}

export const monthName = (s: Ymd) => `${MONTH[parts(s).m - 1]} ${parts(s).y}`

// ── as_of resolution ─────────────────────────────────────────────────────────

export const TIME_TRAVEL_DAYS = 7
export const LATEST_LAG_MS = 3 * 60_000
export const RETRY_STEP_MS = 25 * 60_000

export type AsOfMode = { kind: 'latest' } | { kind: 'eod'; date: Ymd } | { kind: 'exact'; iso: string }

/** Parses the request's as_of selector. Throws on anything malformed. */
export function parseAsOfSelector(raw: unknown): AsOfMode {
  if (raw === undefined || raw === null || raw === '' || raw === 'latest') return { kind: 'latest' }
  if (typeof raw !== 'string') throw new Error('as_of must be a string')
  const eod = /^eod:(\d{4}-\d{2}-\d{2})$/.exec(raw)
  if (eod) return { kind: 'eod', date: eod[1] }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:00)?(\.000)?Z$/.test(raw)) return { kind: 'exact', iso: raw }
  throw new Error(`Invalid as_of: ${raw}`)
}

export const floorMinute = (ms: number) => Math.floor(ms / 60_000) * 60_000
export const latestAsOfMs = (nowMs: number) => floorMinute(nowMs - LATEST_LAG_MS)

/** Resolves a selector to a pinned instant (ms). Validates the time-travel window. */
export function resolveAsOf(mode: AsOfMode, nowMs: number): number {
  const latest = latestAsOfMs(nowMs)
  const oldest = nowMs - TIME_TRAVEL_DAYS * 86_400_000 + 60 * 60_000 // keep an hour of headroom
  let ms: number
  if (mode.kind === 'latest') return latest
  if (mode.kind === 'eod') {
    const t = Date.parse(`${mode.date}T00:00:00Z`)
    if (!isFinite(t)) throw new Error(`Invalid date: ${mode.date}`)
    ms = t + 86_400_000 // end of that day = next midnight UTC
  } else {
    ms = Date.parse(mode.iso)
    if (!isFinite(ms)) throw new Error(`Invalid as_of: ${mode.iso}`)
    ms = floorMinute(ms)
  }
  if (ms > latest) throw new Error('as_of is in the future or less than 3 minutes ago')
  if (ms < oldest) throw new Error('as_of is outside the warehouse time-travel window (about 7 days)')
  return ms
}

/** BigQuery TIMESTAMP literal text, e.g. '2026-09-28 08:30:00+00'. Input must be a validated ms value. */
export function bqTimestampText(ms: number): string {
  const iso = new Date(floorMinute(ms)).toISOString() // YYYY-MM-DDTHH:MM:00.000Z
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}+00`
}

export const isoMinute = (ms: number) => new Date(ms).toISOString().slice(0, 16) + ':00Z'
export const dateOf = (ms: number): Ymd => new Date(ms).toISOString().slice(0, 10)

/** "End of day" snapshot choices for the previous `n` days, relative to the latest T. */
export function snapshotOptions(nowMs: number, n = 6) {
  const T = dateOf(latestAsOfMs(nowMs))
  const out: { value: string; label: string }[] = [{ value: 'latest', label: `Latest (${T})` }]
  for (let i = 1; i <= n; i++) {
    const d = addDays(T, -i)
    out.push({ value: `eod:${d}`, label: `End of day ${d}` })
  }
  return out
}

// ── Period windows ────────────────────────────────────────────────────────────

export type Range = { start: Ymd; end: Ymd }

export type PeriodSpec = {
  key: PeriodKey
  option_label: string
  label: string              // '2026 to date', 'Jan–Aug 2026', 'September 2026 to date', '2025', 'Since Jan 2025'
  p: Range
  comparison: null | {
    cc: Range
    cp: Range
    label: string            // text shown after deltas, e.g. 'vs Jan–Aug 2025 (complete months)'
    cc_label: string         // 'Jan–Aug 2026'
    cp_label: string         // 'Jan–Aug 2025'
  }
}

export type TimeContext = {
  T: Ymd
  M0: Ymd
  lcm: Range                 // last complete month
  current_month_label: string
}

export function timeContext(asOfMs: number): TimeContext {
  const T = dateOf(asOfMs)
  const { y, m } = parts(T)
  const M0 = ymd(y, m, 1)
  const lcmStart = addMonths(M0, -1)
  return { T, M0, lcm: { start: lcmStart, end: addDays(M0, -1) }, current_month_label: monthName(M0) }
}

/** Periods that can be shown at T (complete months needs at least one complete month this year). */
export function availablePeriods(T: Ymd): { key: PeriodKey; label: string; available: boolean }[] {
  return PERIOD_KEYS.map((key) => ({
    key,
    label: PERIOD_OPTION_LABELS[key],
    available: key !== 'complete' || parts(T).m > 1,
  }))
}

export function periodSpec(key: PeriodKey, asOfMs: number): PeriodSpec {
  const { T, M0, lcm } = timeContext(asOfMs)
  const { y, m } = parts(T)
  const jan1 = ymd(y, 1, 1)
  // Same complete months one year earlier: Jan 1 → last day of LCM's month, a year back.
  const ytdCmp = () => {
    const l = parts(lcm.end)
    const cc = { start: jan1, end: lcm.end }
    const cp = { start: ymd(y - 1, 1, 1), end: lastDayOfMonth(y - 1, l.m) }
    return { cc, cp, cc_label: monthRangeLabel(cc.start, cc.end), cp_label: monthRangeLabel(cp.start, cp.end) }
  }
  const base = { key, option_label: PERIOD_OPTION_LABELS[key] }
  switch (key) {
    case 'ytd': {
      const c = m > 1 ? ytdCmp() : null
      return {
        ...base, label: `${y} to date`, p: { start: jan1, end: T },
        comparison: c && { ...c, label: `vs ${c.cp_label} (complete months)` },
      }
    }
    case 'complete': {
      if (m === 1) throw new Error('No complete months this year yet')
      const c = ytdCmp()
      return { ...base, label: c.cc_label, p: c.cc, comparison: { ...c, label: `vs ${c.cp_label}` } }
    }
    case 'mtd':
      return { ...base, label: `${monthName(M0)} to date`, p: { start: M0, end: T }, comparison: null }
    case 'last_year': {
      const cc = { start: ymd(y - 1, 1, 1), end: ymd(y - 1, 12, 31) }
      const cp = { start: ymd(y - 2, 1, 1), end: ymd(y - 2, 12, 31) }
      return {
        ...base, label: String(y - 1), p: cc,
        comparison: { cc, cp, label: `vs full year ${y - 2}`, cc_label: String(y - 1), cp_label: String(y - 2) },
      }
    }
    case 'since2025':
      return { ...base, label: 'Since Jan 2025', p: { start: DASHBOARD_FLOOR, end: T }, comparison: null }
  }
}

/** Earliest pickup_date any Executive Summary query needs (prunes the base CTE scan). */
export function baseStart(spec: PeriodSpec, asOfMs: number): Ymd {
  const { M0 } = timeContext(asOfMs)
  const xs = [spec.p.start, addMonths(M0, -12)] // mtd_same_days reaches back to M0 − 12 months
  if (spec.comparison) xs.push(spec.comparison.cc.start, spec.comparison.cp.start)
  return minYmd(...xs)
}

/** First-of-month dates covering a range, e.g. 2026-01-01 … 2026-09-01. */
export function monthsBetween(start: Ymd, end: Ymd): Ymd[] {
  const out: Ymd[] = []
  const last = end.slice(0, 7) + '-01'
  for (let m = start.slice(0, 7) + '-01'; m <= last; m = addMonths(m, 1)) out.push(m)
  return out
}
