// View-model helpers shared by the breakdown pages (Countries, Cities, Routes, Customers).
import { ratio, compactMoney, pct, signedPct, count, monthTick } from './format.js'

export const growth = (a, b) => (a == null || b == null || b === 0 ? null : (a - b) / Math.abs(b))
export const diff = (a, b) => (a == null || b == null ? null : a - b)
export const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0)

/**
 * Adds profit, margin, profit per trip and the year-on-year fields to a summary row. With
 * `minBase` (cents), a row whose last-year revenue is below it is `smallBase`: no % change or
 * margin change (shown as "New"; see signedPct).
 */
export function withDerived(r, hasComparison, minBase = 0) {
  const profit = r.p_revenue - r.p_cost
  const ccProfit = r.cc_revenue - r.cc_cost, cpProfit = r.cp_revenue - r.cp_cost
  const smallBase = !!(hasComparison && minBase && r.cp_revenue < minBase)
  return {
    ...r,
    profit, ccProfit, cpProfit, smallBase,
    listed: r.p_trips > 0,
    margin: ratio(profit, r.p_revenue),
    ppt: ratio(profit, r.p_trips),
    yoy: hasComparison && !smallBase ? growth(ccProfit, cpProfit) : null,
    mpts: hasComparison && !smallBase ? diff(ratio(ccProfit, r.cc_revenue), ratio(cpProfit, r.cp_revenue)) : null,
  }
}

/** "Profit vs last year" delta for a withDerived row: "New" for a small base. */
export const yoyDelta = (r) => (r.smallBase ? { text: 'New', tone: 'new' } : signedPct(r.yoy))

/** Exact dollars for tooltips: $1,748,289 · -$1,234 */
export const tipMoney = (cents) => {
  const d = Math.round(Math.abs(cents) / 100)
  return `${cents < 0 && d ? '-' : ''}$${d.toLocaleString('en-US')}`
}

/**
 * Top 15 bars. With a comparison: ranked by the comparison window (blue) with the same
 * months last year (grey); without: ranked by period profit, one blue series.
 */
export function top15Bars(rows, cmp, labelOf, tieBreak) {
  if (cmp) {
    const top = rows.slice().sort((a, b) => b.ccProfit - a.ccProfit || tieBreak(a, b)).slice(0, 15)
    return {
      subtitle: `${cmp.cc_label} vs ${cmp.cp_label}, complete months`,
      labels: top.map(labelOf),
      rows: top,
      datasets: [
        { label: `Total Profit, ${cmp.cc_label}`, key: 'cc', values: top.map((r) => r.ccProfit / 100) },
        { label: `Same months last year, ${cmp.cp_label}`, key: 'cp', values: top.map((r) => r.cpProfit / 100) },
      ],
      tooltip: (i) => {
        const r = top[i]
        return [`Total Profit ${tipMoney(r.ccProfit)}`, `Same months last year ${tipMoney(r.cpProfit)}`, `Change ${signedPct(r.yoy).text}`]
      },
    }
  }
  const top = rows.slice().sort((a, b) => b.profit - a.profit || tieBreak(a, b)).slice(0, 15)
  return {
    subtitle: 'Selected period',
    labels: top.map(labelOf),
    rows: top,
    datasets: [{ label: 'Total Profit', key: 'p', values: top.map((r) => r.profit / 100) }],
    tooltip: (i) => [`Total Profit ${tipMoney(top[i].profit)}`],
  }
}

/**
 * Monthly trend model. `months` are 'YYYY-MM' or 'YYYY-MM-DD'; `series[i]` is
 * { revenue, cost, trips } in cents for months[i] (zero-filled by the caller).
 */
export function trendModel({ title, months, series, currentMonth, periodEnd, row, hasComparison }) {
  const isCurrent = (m) => m.slice(0, 7) === currentMonth.slice(0, 7) && periodEnd >= currentMonth
  const stat = [
    ['Total Profit', compactMoney(row.profit)],
    ['Margin', pct(row.margin)],
    ['Trips', count(row.p_trips)],
  ]
  if (hasComparison) stat.push(['Profit vs last year', signedPct(row.yoy).text])
  return {
    title,
    stat,
    labels: months.map((m) => monthTick(m) + (isCurrent(m) ? ' (to date)' : '')),
    current: months.map(isCurrent),
    revenue: series.map((s) => s.revenue / 100),
    profit: series.map((s) => (s.revenue - s.cost) / 100),
    marginPct: series.map((s) => (s.revenue ? ((s.revenue - s.cost) / s.revenue) * 100 : null)),
    totals: { revenue: sum(series, (s) => s.revenue), cost: sum(series, (s) => s.cost), trips: sum(series, (s) => s.trips) },
  }
}

export function median(xs) {
  if (!xs.length) return null
  const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Inline sparkline geometry (84×22); the y range always includes 0. */
export function sparkline(profits, w = 84, h = 22) {
  if (!profits.length) return null
  const lo = Math.min(0, ...profits), hi = Math.max(0, ...profits)
  const span = hi - lo || 1
  const x = (i) => (profits.length === 1 ? w / 2 : (i / (profits.length - 1)) * (w - 2) + 1)
  const y = (v) => h - 1 - ((v - lo) / span) * (h - 2)
  return {
    points: profits.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '),
    zeroY: y(0).toFixed(1),
    negative: profits[profits.length - 1] < 0,
  }
}

/** Table totals: period sums over listed rows; year-on-year over every summary row. */
export function breakdownTotals(all, listed, hasComparison) {
  const tr = sum(listed, (r) => r.p_revenue), tp = sum(listed, (r) => r.profit), tn = sum(listed, (r) => r.p_trips)
  const ccP = sum(all, (r) => r.ccProfit), cpP = sum(all, (r) => r.cpProfit)
  const ccR = sum(all, (r) => r.cc_revenue), cpR = sum(all, (r) => r.cp_revenue)
  return {
    trips: tn, revenue: tr, cost: sum(listed, (r) => r.p_cost), profit: tp,
    margin: ratio(tp, tr), ppt: ratio(tp, tn),
    yoy: hasComparison ? growth(ccP, cpP) : null,
    mpts: hasComparison ? diff(ratio(ccP, ccR), ratio(cpP, cpR)) : null,
  }
}
