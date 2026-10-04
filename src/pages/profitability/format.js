// Profitability number formatting — shared by every Profitability page.
// Money inputs are integer cents unless a name says "dollars" (chart values).

const EN = 'en-US'
const commas = (n) => Math.round(n).toLocaleString(EN)

/** a / b, or null when b is 0 or either side is missing. */
export const ratio = (a, b) => (a == null || b == null || b === 0 ? null : a / b)

const tone = (x) => (x == null ? 'flat' : x > 0.0005 ? 'up' : x < -0.0005 ? 'down' : 'flat')

/** KPI values and "LY $…": $12.56M · $496k · $840 */
export function compactMoney(cents) {
  if (cents == null) return '—'
  const v = cents / 100, a = Math.abs(v), s = v < 0 ? '-' : ''
  if (a >= 999_500) return `${s}$${(a / 1e6).toFixed(2)}M`
  if (a >= 999.5) return `${s}$${Math.round(a / 1e3)}k`
  return `${s}$${Math.round(a)}`
}

/** Row-2 values: +$2,402,548 · $-27,122 */
export function signedMoney(cents) {
  const d = Math.round(Math.abs(cents) / 100)
  return (cents < 0 && d !== 0 ? '$-' : '+$') + commas(d)
}

/** Table money: whole dollars with commas; negatives as -$1,234. */
export function tableMoney(cents) {
  if (cents == null) return '—'
  const d = Math.round(Math.abs(cents) / 100)
  return (cents < 0 && d !== 0 ? '-$' : '$') + commas(d)
}

/** 23.1% */
export const pct = (x) => (x == null || !isFinite(x) ? '—' : `${(x * 100).toFixed(1)}%`)

/** Row-2 sub-line percentage: 27.6% · -27.0% (minus only) */
export const plainPct = (x) => (x == null || !isFinite(x) ? '—' : `${x < 0 ? '-' : ''}${Math.abs(x * 100).toFixed(1)}%`)

/** Last-year revenue below which "% vs last year" is meaningless: shown as "New" instead. */
export const SMALL_BASE_CENTS = 500_000 // $5,000

/**
 * Deltas: { text: '+27.6%', tone: 'up' | 'down' | 'flat' }. With `minBase`, a comparison base
 * (`base`, in cents — last year's revenue) below it gives { text: 'New', tone: 'new' }.
 */
export function signedPct(x, { base, minBase } = {}) {
  if (minBase && base != null && base < minBase) return { text: 'New', tone: 'new' }
  if (x == null || !isFinite(x)) return { text: '—', tone: 'flat' }
  return { text: `${x < 0 ? '-' : '+'}${Math.abs(x * 100).toFixed(1)}%`, tone: tone(x) }
}

/** Margin change: difference of two margins → { text: '+1.5 pts', tone } */
export function pts(dx) {
  if (dx == null || !isFinite(dx)) return { text: '—', tone: 'flat' }
  return { text: `${dx < 0 ? '-' : '+'}${Math.abs(dx * 100).toFixed(1)} pts`, tone: tone(dx) }
}

/** Profit per trip from cents-per-trip: $5.93 */
export const perTrip = (centsPerTrip) =>
  centsPerTrip == null || !isFinite(centsPerTrip) ? '—' : `${centsPerTrip < 0 ? '-' : ''}$${(Math.abs(centsPerTrip) / 100).toFixed(2)}`

/** Signed profit per trip: +$2.18 · $-2.18 */
export const signedPerTrip = (centsPerTrip) =>
  `${centsPerTrip < 0 ? '$-' : '+$'}${(Math.abs(centsPerTrip) / 100).toFixed(2)}`

export const count = (n) => (n == null ? '—' : commas(n))
export const signedCount = (n) => `${n < 0 ? '-' : '+'}${commas(Math.abs(n))}`

/** Axis ticks (dollars): $0.00 · $1.20M · $200k */
export function moneyTick(v) {
  const a = Math.abs(v), s = v < 0 ? '-' : ''
  if (a === 0) return '$0.00'
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${s}$${Math.round(a / 1e3)}k`
  return `${s}$${a.toFixed(0)}`
}

/** Bar end labels (dollars): $1.19M · $859k · -$160k */
export function barLabel(v) {
  const a = Math.abs(v), s = v < 0 ? '-' : ''
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${s}$${Math.round(a / 1e3)}k`
  return `${s}$${a.toFixed(0)}`
}

/** Exact dollars for tooltips: $1,234,567 · -$1,234 */
export const tooltipMoney = (dollars) => `${dollars < 0 ? '-' : ''}$${commas(Math.abs(dollars))}`

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** '2026-09-01' → "Sep '26" */
export const monthTick = (ymd) => `${MON[+ymd.slice(5, 7) - 1]} '${ymd.slice(2, 4)}`

/** '2026-09-28T08:30:00Z' → '2026-09-28 08:30' */
export const utcMinute = (iso) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : '—')
