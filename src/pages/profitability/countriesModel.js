// Countries view model: payload (integer cents) → exactly what the Countries page shows.
// Pure and framework-free so the acceptance tests can check the rendered values.

import { compactMoney, signedMoney, pct, signedPct, pts, perTrip, count, utcMinute } from './format.js'
import { REGION_COLORS } from './model.js'
import {
  withDerived, top15Bars, trendModel, breakdownTotals, sparkline, median, tipMoney, sum,
} from './modelShared.js'

export { sparkline, median }

export const UNMAPPED = 'Unmapped'
const LOSS_MIN_REVENUE = 500_000      // $5,000
const GROWING_MIN_CP_REVENUE = 1_000_000 // $10,000
const BUBBLE_MIN_REVENUE = 1_000_000  // $10,000

const byProfitDesc = (a, b) => b.profit - a.profit || a.country.localeCompare(b.country)

export const EMPTY_SELECTION = 'No trips in this selection.'

/** Every summary row with derived values. `listed` = traded in the period (p_trips > 0). */
export function enrich(d) {
  return d.countries.map((r) => ({ ...withDerived(r, !!d.comparison), unmapped: r.country === UNMAPPED }))
}

// ── Header ───────────────────────────────────────────────────────────────────

export function header(d) {
  const label = d.period.label
  return {
    title: 'Countries',
    badge: `Data as of ${d.data_date}`,
    badgeTooltip: `Pinned ${utcMinute(d.as_of)} UTC · warehouse load ${utcMinute(d.warehouse_loaded_at)} UTC`,
    subtitle: `${label} profit by pickup country${d.comparison ? `, ${d.comparison.label}` : ''}.${d.region ? ` Region: ${d.region}.` : ''}`,
    sectionLabel: `${label} — total profit by country`.toUpperCase(),
  }
}

// ── KPI row ──────────────────────────────────────────────────────────────────

export function kpis(d) {
  const rows = enrich(d)
  const listed = rows.filter((r) => r.listed)
  const P = sum(listed, (r) => r.profit) // page total, Unmapped included
  const ranked = listed.filter((r) => !r.unmapped).sort(byProfitDesc)
  const share = (x) => (P > 0 ? x / P : null)
  const top5 = ranked.slice(0, 5)
  const cmp = d.comparison

  const withTrips = {
    label: 'Countries with trips', value: count(ranked.length), sub: 'in the selected period',
    sub2: cmp ? `${count(rows.filter((r) => !r.unmapped && r.cp_trips > 0).length)} last year` : null,
  }
  const largest = ranked[0]
    ? { label: 'Largest country', value: pct(share(ranked[0].profit)), sub: `${ranked[0].country} · ${compactMoney(ranked[0].profit)}`, sub2: 'share of Total Profit' }
    : { label: 'Largest country', value: '—', sub: EMPTY_SELECTION, sub2: 'share of Total Profit' }
  const top = {
    label: 'Top 5 countries', value: top5.length ? pct(share(sum(top5, (r) => r.profit))) : '—',
    sub: top5.map((r) => r.country).join(', '), subTitle: top5.map((r) => r.country).join(', '), sub2: 'share of Total Profit',
  }
  let growing
  if (cmp) {
    const base = rows.filter((r) => !r.unmapped && r.cp_revenue >= GROWING_MIN_CP_REVENUE)
    const changes = base.map((r) => r.ccProfit - r.cpProfit)
    const gains = sum(changes.filter((c) => c > 0), (c) => c)
    const falls = sum(changes.filter((c) => c < 0), (c) => c)
    growing = {
      label: 'Countries growing', value: `${count(base.filter((r) => r.ccProfit > r.cpProfit).length)} of ${count(base.length)}`,
      sub: `Total Profit up vs ${cmp.cp_label}`,
      sub2: `${compactMoney(gains)} gained · ${compactMoney(Math.abs(falls))} lost`,
      n: base.length, g: base.filter((r) => r.ccProfit > r.cpProfit).length, gains, falls,
    }
  } else {
    growing = { label: 'Countries growing', value: '—', sub: 'No comparison for this period', sub2: null }
  }
  const losers = ranked.filter((r) => r.profit < 0 && r.p_revenue >= LOSS_MIN_REVENUE)
  const loss = {
    label: 'Loss-making countries', value: count(losers.length), tone: losers.length ? 'down' : null,
    sub: losers.length ? `Total loss ${signedMoney(sum(losers, (r) => r.profit))}` : 'None in this period',
    sub2: 'with at least $5k revenue', names: losers.map((r) => r.country),
  }
  return { cards: [withTrips, largest, top, growing, loss], P, ranked }
}

// ── Top 15 bars ──────────────────────────────────────────────────────────────

export function top15(d) {
  const listed = enrich(d).filter((r) => r.listed && !r.unmapped)
  return top15Bars(listed, d.comparison, (r) => r.country, (a, b) => a.country.localeCompare(b.country))
}

// ── Bubble chart ─────────────────────────────────────────────────────────────

export function bubbles(d) {
  const pts = enrich(d).filter((r) => r.listed && !r.unmapped && r.p_revenue >= BUBBLE_MIN_REVENUE)
  const maxTrips = Math.max(1, ...pts.map((r) => r.p_trips))
  const points = pts.map((r) => ({
    country: r.country,
    region: r.main_region,
    color: REGION_COLORS[r.main_region] ?? '#C4C4C4',
    x: r.p_revenue / 100,
    y: Math.round(r.margin * 10000) / 100,
    r: 3 + 18 * Math.sqrt(r.p_trips / maxTrips),
    tooltip: [`Revenue ${tipMoney(r.p_revenue)}`, `Total Profit ${tipMoney(r.profit)}`, `Margin ${pct(r.margin)}`, `Trips ${count(r.p_trips)}`],
  }))
  const regions = Object.keys(REGION_COLORS).filter((g) => points.some((p) => p.region === g))
  return {
    points,
    medianX: median(points.map((p) => p.x)),
    medianY: median(points.map((p) => p.y)),
    legend: regions.map((g) => ({ name: g, color: REGION_COLORS[g] })),
  }
}

// ── Selection + monthly trend ────────────────────────────────────────────────

/** The URL's country when it is listed in this selection; otherwise the top country by period profit. */
export function selectedCountry(d, wanted) {
  const listed = enrich(d).filter((r) => r.listed)
  if (wanted && listed.some((r) => r.country === wanted)) return wanted
  return listed.filter((r) => !r.unmapped).sort(byProfitDesc)[0]?.country ?? listed[0]?.country ?? null
}

export function trend(d, country) {
  const row = enrich(d).find((r) => r.country === country)
  if (!row) return null
  const by = new Map(d.monthly.filter((m) => m.country === country).map((m) => [m.month, m]))
  return trendModel({
    title: `Monthly trend: ${country}`,
    months: d.months,
    series: d.months.map((m) => by.get(m) ?? { revenue: 0, cost: 0, trips: 0 }),
    currentMonth: d.current_month.start,
    periodEnd: d.period.end,
    row,
    hasComparison: !!d.comparison,
  })
}

// ── Table ────────────────────────────────────────────────────────────────────

export function table(d) {
  const all = enrich(d)
  const listed = all.filter((r) => r.listed)
  const monthly = new Map()
  for (const m of d.monthly) {
    if (!monthly.has(m.country)) monthly.set(m.country, new Map())
    monthly.get(m.country).set(m.month, m.revenue - m.cost)
  }
  const rows = listed.map((r) => ({
    ...r,
    name: r.country,
    regionLabel: r.main_region ? (r.all_regions.length > 1 ? `${r.main_region} +${r.all_regions.length - 1}` : r.main_region) : '—',
    regionTitle: r.all_regions.length > 1 ? `Trips in: ${r.all_regions.join(', ')}` : null,
    spark: sparkline(d.months.map((m) => (monthly.get(r.country)?.get(m) ?? 0) / 100)),
  }))
  // Year-on-year totals use every summary row — countries that stopped trading still count
  // in last year — so they equal the Executive Summary KPI deltas.
  return { rows, showYoy: !!d.comparison, total: breakdownTotals(all, listed, !!d.comparison) }
}

export const cells = { pct, perTrip, signedPct, pts, count }
