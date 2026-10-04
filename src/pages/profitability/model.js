// Executive Summary view model: payload (integer cents) → exactly what the page shows.
// Pure and framework-free so the acceptance tests can check the rendered strings.

import {
  ratio, compactMoney, signedMoney, tableMoney, pct, plainPct, signedPct, pts, perTrip, signedPerTrip,
  count, signedCount, monthTick, utcMinute,
} from './format.js'

export const PRODUCT_LINE_ORDER = ['Private Transfer', 'Ride Hailing', 'Shared Shuttle', 'Rail']
export const PRODUCT_LINE_COLORS = {
  'Private Transfer': '#2D5BA6', 'Ride Hailing': '#4A9F78', 'Shared Shuttle': '#9DB4DD', Rail: '#C4C4C4',
}
export const REGION_ORDER = [
  'America & LATAM', 'Europe', 'Rest of Asia, Africa & Oceania', 'Southeast Asia & Rest of Italy', 'Turkey & others', 'Unmapped',
]
export const REGION_COLORS = {
  'America & LATAM': '#2D5BA6', Europe: '#4A9F78', 'Rest of Asia, Africa & Oceania': '#9DB4DD',
  'Southeast Asia & Rest of Italy': '#E0A43A', 'Turkey & others': '#8C7BC4', Unmapped: '#C4C4C4',
}
export const MARGIN_COLOR = '#4A9F78'
export const GAIN_COLOR = '#3C9A6A'
export const FALL_COLOR = '#D64545'

const profit = (t) => t.revenue - t.cost
const ppt = (t) => ratio(profit(t), t.trips)
const margin = (t) => ratio(profit(t), t.revenue)
const growth = (a, b) => (a == null || b == null || b === 0 ? null : (a - b) / Math.abs(b))
const diff = (a, b) => (a == null || b == null ? null : a - b)
const plural = (n, one, many) => (n === 1 ? one : many)

// ── Header ───────────────────────────────────────────────────────────────────

export function header(d) {
  const cmp = d.comparison
  const label = d.period.label
  return {
    title: 'Executive Summary',
    badge: `Data as of ${d.data_date}`,
    badgeTooltip: `Pinned ${utcMinute(d.as_of)} UTC · warehouse load ${utcMinute(d.warehouse_loaded_at)} UTC`,
    subtitle: `${label} profit, revenue and margin${cmp ? `, ${cmp.label}` : ''}.`,
    sectionLabel: `${label} — profit, revenue and margin`.toUpperCase(),
  }
}

// ── KPI cards ────────────────────────────────────────────────────────────────

export const NO_COMPARISON = 'No year-on-year comparison for this period'

export function kpiRow1(d) {
  const { p, cc, cp } = d.kpi
  const cmp = d.comparison
  const delta = (x) => (cmp ? { ...x, suffix: cmp.label } : null)
  return [
    { label: 'Total Profit', value: compactMoney(profit(p)), sub: `Complete revenue ${compactMoney(p.revenue)}`,
      delta: delta(signedPct(growth(profit(cc), profit(cp)))) },
    { label: 'Revenue', value: compactMoney(p.revenue), sub: `Cost ${compactMoney(p.cost)}`,
      delta: delta(signedPct(growth(cc.revenue, cp.revenue))) },
    { label: 'Profit margin', value: pct(margin(p)), sub: 'Profit ÷ revenue',
      delta: delta(pts(diff(margin(cc), margin(cp)))) },
    { label: 'Trips', value: count(p.trips), sub: 'Completed trips',
      delta: delta(signedPct(growth(cc.trips, cp.trips))) },
    { label: 'Profit per trip', value: perTrip(ppt(p)), sub: 'Profit ÷ trips',
      delta: delta(signedPct(growth(ppt(cc), ppt(cp)))) },
  ]
}

const vsCard = (label, value, positive, sub) => ({ label, value, tone: positive ? 'up' : 'down', sub })

function moneyVs(label, a, b, tag) {
  return vsCard(label, signedMoney(a - b), a - b >= 0, `${plainPct(growth(a, b))} · ${tag} ${compactMoney(b)}`)
}
function tripsVs(label, a, b, tag) {
  return vsCard(label, signedCount(a - b), a - b >= 0, `${plainPct(growth(a, b))} · ${tag} ${count(b)}`)
}

/** Row 2: "vs last year" cards, or the month-to-date same-days cards for Month to date. */
export function kpiRow2(d) {
  if (d.comparison) {
    const { cc, cp } = d.kpi
    const a = ppt(cc), b = ppt(cp)
    return [
      moneyVs('Total Profit vs last year', profit(cc), profit(cp), 'LY'),
      moneyVs('Revenue vs last year', cc.revenue, cp.revenue, 'LY'),
      tripsVs('Trips vs last year', cc.trips, cp.trips, 'LY'),
      a == null || b == null ? vsCard('Profit per trip vs last year', '—', true, '—')
        : vsCard('Profit per trip vs last year', signedPerTrip(a - b), a - b >= 0, `${plainPct(growth(a, b))} · LY ${perTrip(b)}`),
    ]
  }
  if (d.period.key === 'mtd') {
    const w = Object.fromEntries(d.mtd.rows.map((r) => [r.win, r]))
    const t = w.this_month, lm = w.last_month, ly = w.same_month_last_year
    if (!t || !lm || !ly) return []
    return [
      moneyVs('Total Profit vs last month MTD', profit(t), profit(lm), 'LM'),
      moneyVs('Revenue vs last month MTD', t.revenue, lm.revenue, 'LM'),
      moneyVs('Total Profit vs last year MTD', profit(t), profit(ly), 'LY'),
      tripsVs('Trips vs last year MTD', t.trips, ly.trips, 'LY'),
    ]
  }
  return []
}

// ── This month so far ────────────────────────────────────────────────────────

const MTD_LABELS = { this_month: 'This month', last_month: 'Last month', same_month_last_year: 'Same month last year' }

export function mtdPanel(d) {
  const days = d.mtd.days
  if (days === 0 || d.mtd.rows.length === 0) {
    return { days, subtitle: 'This month has no complete days yet', rows: [], note: null }
  }
  const w = Object.fromEntries(d.mtd.rows.map((r) => [r.win, r]))
  const t = w.this_month
  const rows = ['this_month', 'last_month', 'same_month_last_year'].filter((k) => w[k]).map((k) => {
    const r = w[k], isThis = k === 'this_month'
    return {
      key: k, label: MTD_LABELS[k], range: r.label,
      profit: compactMoney(profit(r)), revenue: compactMoney(r.revenue), margin: pct(margin(r)), trips: count(r.trips),
      vs: isThis ? null : {
        profit: signedPct(growth(profit(t), profit(r))),
        revenue: signedPct(growth(t.revenue, r.revenue)),
        margin: pts(diff(margin(t), margin(r))),
        trips: signedPct(growth(t.trips, r.trips)),
      },
    }
  })
  const dd = `${days} complete ${plural(days, 'day', 'days')}`
  return { days, subtitle: `Same ${dd} compared`, rows, note: `Same ${dd} in each month, all product lines.` }
}

// ── Breakdown tables ─────────────────────────────────────────────────────────

export function breakdownTable(d, rowsIn, { colors, marginVsLy = false }) {
  const cmp = !!d.comparison
  const totalProfit = profit(d.kpi.p)
  const rows = rowsIn.map((r) => {
    const pr = r.p_revenue - r.p_cost
    return {
      name: r.name, color: colors[r.name] ?? '#C4C4C4',
      trips: r.p_trips, revenue: r.p_revenue, cost: r.p_cost, profit: pr,
      margin: ratio(pr, r.p_revenue),
      share: totalProfit > 0 ? pr / totalProfit : null,
      yoy: cmp ? growth(r.cc_profit, r.cp_profit) : null,
      mpts: cmp && marginVsLy ? diff(ratio(r.cc_profit, r.cc_revenue), ratio(r.cp_profit, r.cp_revenue)) : null,
    }
  }).sort((a, b) => b.profit - a.profit)
  const sum = (f) => rows.reduce((a, r) => a + f(r), 0)
  const tr = sum((r) => r.revenue), tp = sum((r) => r.profit)
  const { cc, cp } = d.kpi
  const total = {
    trips: sum((r) => r.trips), revenue: tr, cost: sum((r) => r.cost), profit: tp,
    margin: ratio(tp, tr), share: rows.length ? 1 : null,
    // Company-level change (the same figure as the KPI delta), not a sum of row percentages.
    yoy: cmp ? growth(profit(cc), profit(cp)) : null,
    mpts: cmp && marginVsLy ? diff(margin(cc), margin(cp)) : null,
  }
  return { rows, total, showYoy: cmp, showMarginVsLy: cmp && marginVsLy }
}

export const tableCells = {
  trips: (v) => count(v),
  money: (v) => tableMoney(v),
  pct: (v) => pct(v),
  delta: (v) => signedPct(v),
  pts: (v) => pts(v),
}

// ── Charts ───────────────────────────────────────────────────────────────────

export function monthlyProductChart(d) {
  const months = [...new Set(d.monthly_pl.map((r) => r.month))].sort()
  const isCurrent = (m) => m === d.current_month.start && d.period.end >= d.current_month.start
  const idx = Object.fromEntries(months.map((m, i) => [m, i]))
  const lines = PRODUCT_LINE_ORDER.map((name) => {
    const data = months.map(() => 0)
    for (const r of d.monthly_pl) if (r.name === name) data[idx[r.month]] += (r.revenue - r.cost) / 100
    return { name, color: PRODUCT_LINE_COLORS[name], data }
  }).filter((l) => l.data.some((v) => v !== 0))
  const rev = months.map(() => 0), prof = months.map(() => 0)
  for (const r of d.monthly_pl) { rev[idx[r.month]] += r.revenue; prof[idx[r.month]] += r.revenue - r.cost }
  const marginPct = months.map((_, i) => (rev[i] ? (prof[i] / rev[i]) * 100 : null))
  const hasCurrent = months.some(isCurrent)
  return {
    labels: months.map((m) => monthTick(m) + (isCurrent(m) ? ' (to date)' : '')),
    current: months.map(isCurrent),
    lines, marginPct,
    subtitle: `Stacked profit with margin line.${hasCurrent ? ` Lighter bars: ${d.current_month.label} to date.` : ''}`,
  }
}

export function monthlyRegionChart(d) {
  const months = [...new Set(d.monthly_region.map((r) => r.month))].sort()
  const isCurrent = (m) => m === d.current_month.start && d.period.end >= d.current_month.start
  const idx = Object.fromEntries(months.map((m, i) => [m, i]))
  const lines = REGION_ORDER.filter((n) => n !== 'Unmapped').map((name) => {
    const data = months.map(() => 0)
    for (const r of d.monthly_region) if (r.name === name) data[idx[r.month]] += (r.revenue - r.cost) / 100
    return { name, color: REGION_COLORS[name], data }
  }).filter((l) => l.data.some((v) => v !== 0))
  return { labels: months.map((m) => monthTick(m) + (isCurrent(m) ? ' (to date)' : '')), lines }
}

export const MOVERS_EMPTY = 'Choose a period with complete months that also exist last year.'

export function moversChart(d, dim) {
  if (!d.comparison || !d.movers) return { empty: MOVERS_EMPTY, rows: [], subtitle: '' }
  const src = d.movers[dim] ?? []
  const up = src.filter((r) => r.change > 0).sort((a, b) => b.change - a.change).slice(0, 8)
  const down = src.filter((r) => r.change < 0).sort((a, b) => b.change - a.change).slice(-8)
  const rows = up.concat(down)
  return {
    empty: rows.length ? null : 'No changes in profit between these periods.',
    rows,
    subtitle: `Change in profit, ${d.comparison.cc_label} vs ${d.comparison.cp_label}.`,
  }
}
