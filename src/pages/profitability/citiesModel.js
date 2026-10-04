// Cities view model: payload (integer cents) → exactly what the Cities page shows.
// A city is a pickup service area keyed by sa_id; names are cleaned for display only.

import { compactMoney, signedMoney, pct, count, utcMinute } from './format.js'
import { withDerived, top15Bars, trendModel, breakdownTotals, sparkline, tipMoney, sum } from './modelShared.js'

export const NO_SERVICE_AREA = -1
export const NO_SERVICE_AREA_LABEL = '(no service area)'
export const EMPTY_SELECTION = 'No trips in this selection.'
const LOSS_MIN_REVENUE = 500_000          // $5,000
const LOW_MARGIN_MIN_REVENUE = 5_000_000  // $50,000

/** Display label for a raw service-area name (Brief 03 §1.1). Never used for grouping. */
export function cityLabel(raw) {
  if (!raw) return NO_SERVICE_AREA_LABEL
  const s = raw.replace(/%EF%BC%8C/gi, ',').replace(/，/g, ',')
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean)
  if (parts.length > 1 && /^[A-Z]{3}$/.test(parts[0])) return parts.slice(1).join(', ') + ' (' + parts[0] + ')'
  if (parts.length > 1) return parts.slice(0, -1).join(', ')
  return parts[0] ?? NO_SERVICE_AREA_LABEL
}

/**
 * sa_id → label, unique within (label, country) so two rows never look identical: repeats
 * get their raw name appended, and the service-area id if even that repeats.
 */
export function uniqueLabels(rows) {
  const base = new Map(rows.map((r) => [r.sa_id, r.sa_id === NO_SERVICE_AREA ? NO_SERVICE_AREA_LABEL : cityLabel(r.sa_name)]))
  const groups = new Map()
  for (const r of rows) {
    const k = `${base.get(r.sa_id)}\u0000${r.country}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  const out = new Map(base)
  for (const g of groups.values()) {
    if (g.length < 2) continue
    const raws = new Map()
    for (const r of g) raws.set(r.sa_name, (raws.get(r.sa_name) ?? 0) + 1)
    for (const r of g) {
      const l = base.get(r.sa_id)
      out.set(r.sa_id, raws.get(r.sa_name) > 1 ? `${l} (${r.sa_name}, #${r.sa_id})` : `${l} (${r.sa_name})`)
    }
  }
  return out
}

export function enrich(d) {
  const cmp = !!d.comparison
  const labels = uniqueLabels(d.cities)
  const withCountry = !d.country // outside a country filter, show "{label}, {country}"
  return d.cities.map((r) => {
    const x = withDerived(r, cmp)
    const label = labels.get(r.sa_id)
    const none = r.sa_id === NO_SERVICE_AREA
    return { ...x, none, label, display: none || !withCountry ? label : `${label}, ${r.country}` }
  })
}

const byProfitDesc = (a, b) => b.profit - a.profit || a.sa_id - b.sa_id

// ── Header ───────────────────────────────────────────────────────────────────

export function header(d) {
  const label = d.period.label
  return {
    title: 'Cities',
    badge: `Data as of ${d.data_date}`,
    badgeTooltip: `Pinned ${utcMinute(d.as_of)} UTC · warehouse load ${utcMinute(d.warehouse_loaded_at)} UTC`,
    subtitle: `${label} profit by pickup city${d.comparison ? `, ${d.comparison.label}` : ''}.`
      + `${d.region ? ` Region: ${d.region}.` : ''}${d.country ? ` Country: ${d.country}.` : ''}`,
    sectionLabel: `${label} — total profit by city`.toUpperCase(),
  }
}

// ── KPI row ──────────────────────────────────────────────────────────────────

/** Smallest N such that the top N cities' cumulative profit reaches ≥ 80% of P, or null. */
export function citiesFor80(ranked, P) {
  if (!(P > 0)) return null
  let cum = 0
  for (let i = 0; i < ranked.length; i++) {
    cum += ranked[i].profit
    if (cum >= 0.8 * P) return i + 1
  }
  return null
}

const inCountries = (k) => `in ${count(k)} ${k === 1 ? 'country' : 'countries'}`

export function kpis(d) {
  const rows = enrich(d)
  const listed = rows.filter((r) => r.listed)
  const P = sum(listed, (r) => r.profit) // page total, "(no service area)" included
  const ranked = listed.filter((r) => !r.none).sort(byProfitDesc)
  const M = ranked.length
  const share = (x) => (P > 0 ? x / P : null)
  const top = (n) => sum(ranked.slice(0, n), (r) => r.profit)
  const N = citiesFor80(ranked, P)
  const losers = ranked.filter((r) => r.profit < 0 && r.p_revenue >= LOSS_MIN_REVENUE)
  const cards = [
    {
      label: 'Cities with trips', value: count(M), sub: inCountries(new Set(ranked.map((r) => r.country)).size),
      sub2: d.comparison ? `${count(rows.filter((r) => !r.none && r.cp_trips > 0).length)} last year` : null,
    },
    ranked[0] && P > 0
      ? { label: 'Largest city', value: pct(share(ranked[0].profit)), sub: `${ranked[0].display} · ${compactMoney(ranked[0].profit)}`, sub2: 'share of Total Profit' }
      : { label: 'Largest city', value: '—', sub: M ? 'No profit in this selection' : EMPTY_SELECTION, sub2: 'share of Total Profit' },
    { label: 'Top 10 cities', value: P > 0 && M ? pct(share(top(10))) : '—', sub: 'share of Total Profit', sub2: P > 0 && M ? `Top 25: ${pct(share(top(25)))}` : null },
    N != null
      ? { label: 'Cities making 80% of profit', value: `${count(N)} of ${count(M)}`, sub: `${pct(N / M)} of cities`, sub2: 'highest profit first' }
      : { label: 'Cities making 80% of profit', value: '—', sub: M ? 'No profit in this selection' : EMPTY_SELECTION, sub2: 'highest profit first' },
    {
      label: 'Loss-making cities', value: count(losers.length), tone: losers.length ? 'down' : null,
      sub: losers.length ? `Total loss ${signedMoney(sum(losers, (r) => r.profit))}` : 'None in this period',
      sub2: 'with at least $5k revenue', ids: losers.map((r) => r.sa_id),
    },
  ]
  return { cards, P, ranked, N, M }
}

// ── Charts ───────────────────────────────────────────────────────────────────

export function top15(d) {
  const rows = enrich(d).filter((r) => r.listed && !r.none)
  return top15Bars(rows, d.comparison, (r) => r.display, (a, b) => a.sa_id - b.sa_id)
}

export const LOW_MARGIN_EMPTY = 'Not enough cities with $50k+ revenue in this selection.'

export function lowestMargin(d) {
  const rows = enrich(d)
    .filter((r) => r.listed && !r.none && r.p_revenue >= LOW_MARGIN_MIN_REVENUE)
    .sort((a, b) => a.margin - b.margin || a.sa_id - b.sa_id)
    .slice(0, 12)
  if (rows.length < 3) return { empty: LOW_MARGIN_EMPTY, rows: [] }
  return {
    empty: null,
    rows,
    labels: rows.map((r) => r.display),
    values: rows.map((r) => Math.round(r.margin * 10000) / 100),
    tooltip: (i) => {
      const r = rows[i]
      return [`Margin ${(r.margin * 100).toFixed(2)}%`, `Total Profit ${tipMoney(r.profit)}`, `Revenue ${tipMoney(r.p_revenue)}`]
    },
  }
}

export function pareto(d) {
  const { ranked, P, N, M } = kpis(d)
  if (!M || !(P > 0)) return { empty: EMPTY_SELECTION, points: [] }
  let cum = 0
  const points = ranked.map((r, i) => { cum += r.profit; return { x: i + 1, y: Math.round((cum / P) * 10000) / 100 } })
  const ys = points.map((p) => p.y)
  return {
    empty: null, points, N, M,
    yMin: Math.min(0, ...ys), yMax: Math.max(100, ...ys),
    markerLabel: N != null ? `${count(N)} cities = 80% of profit` : null,
  }
}

// ── Selection + trend ────────────────────────────────────────────────────────

/** The URL's city when it is listed in this selection; otherwise the top city by profit. */
export function selectedCity(d, wanted) {
  const listed = enrich(d).filter((r) => r.listed && !r.none)
  const id = wanted == null || wanted === '' ? null : Number(wanted)
  if (id != null && listed.some((r) => r.sa_id === id)) return id
  return listed.sort(byProfitDesc)[0]?.sa_id ?? null
}

const seriesFor = (d, saId) => {
  const arr = d.monthly.by_city[saId] ?? d.monthly.months.map(() => [0, 0, 0])
  return arr.map(([revenue, cost, trips]) => ({ revenue, cost, trips }))
}

export function trend(d, saId) {
  const row = enrich(d).find((r) => r.sa_id === saId)
  if (!row) return null
  return {
    ...trendModel({
      title: `Monthly trend: ${row.label}, ${row.country}`,
      months: d.monthly.months,
      series: seriesFor(d, saId),
      currentMonth: d.current_month.start,
      periodEnd: d.period.end,
      row,
      hasComparison: !!d.comparison,
    }),
    cityLabel: row.label,
  }
}

// ── Table ────────────────────────────────────────────────────────────────────

export function table(d) {
  const all = enrich(d)
  const listed = all.filter((r) => r.listed)
  const rows = listed.map((r) => ({
    ...r,
    name: r.label,
    spark: sparkline(seriesFor(d, r.sa_id).map((s) => (s.revenue - s.cost) / 100)),
  }))
  return { rows, showYoy: !!d.comparison, total: breakdownTotals(all, listed, !!d.comparison) }
}
