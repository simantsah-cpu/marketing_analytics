// Customers view model: payload (integer cents) → exactly what the Customers page shows.
// A customer is the customer group of the ordering fleet, named exactly as stored.
// "Unmapped" is listed last and excluded from charts and rankings.

import { compactMoney, pct, count, utcMinute, ratio, monthTick, signedPct, SMALL_BASE_CENTS } from './format.js'
import { withDerived, top15Bars, trendModel, breakdownTotals, sparkline, tipMoney, sum, growth, diff, yoyDelta } from './modelShared.js'
import { citiesFor80 } from './citiesModel.js'

export const UNMAPPED = 'Unmapped'
export const UNASSIGNED = 'Unassigned'
export const NO_CUSTOMERS = 'No customers in this selection.'
export const LOW_MARGIN_EMPTY = 'Not enough customers with $100k+ revenue in this selection.'
const LOW_MARGIN_MIN_REVENUE = 10_000_000 // $100,000
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2020-06-01' → 'Jun 2020'; blank → '—'. */
export const monthYear = (ymd) => (ymd ? `${MON[+ymd.slice(5, 7) - 1]} ${ymd.slice(0, 4)}` : '—')

export function enrich(d) {
  const cmp = !!d.comparison
  return d.customers.map((r) => ({
    ...withDerived(r, cmp, SMALL_BASE_CENTS),
    none: r.customer === UNMAPPED,
    isNew: r.p_new_profit > 0,
    firstTrade: monthYear(r.first_trade_month),
  }))
}

const byProfitDesc = (a, b) => b.profit - a.profit || (a.customer < b.customer ? -1 : 1)
/** Customers that take part in charts and rankings. */
const ranked = (rows) => rows.filter((r) => r.listed && !r.none).sort(byProfitDesc)
const pageTotal = (rows) => sum(rows, (r) => r.profit)

// ── Header ───────────────────────────────────────────────────────────────────

export function header(d) {
  const label = d.period.label
  const notes = [['Region', d.region], ['Country', d.country], ['Product', d.product], ['Team', d.team], ['Type', d.ctype]]
    .filter(([, v]) => v).map(([k, v]) => ` ${k}: ${v}.`).join('')
  return {
    title: 'Customers',
    badge: `Data as of ${d.data_date}`,
    badgeTooltip: `Pinned ${utcMinute(d.as_of)} UTC · warehouse load ${utcMinute(d.warehouse_loaded_at)} UTC`,
    subtitle: `${label} profit by customer${d.comparison ? `, ${d.comparison.label}` : ''}.${notes}`,
    sectionLabel: `${label} — total profit by customer`.toUpperCase(),
  }
}

// ── KPI row ──────────────────────────────────────────────────────────────────

export function kpis(d) {
  const rows = enrich(d)
  const P = pageTotal(rows)
  const top = ranked(rows)
  const M = top.length
  const share = (x) => (P > 0 ? x / P : null)
  const topN = (n) => sum(top.slice(0, n), (r) => r.profit)
  const newProfit = sum(rows, (r) => r.p_new_profit)
  const k = rows.filter((r) => r.p_new_profit !== 0).length
  const cmp = d.comparison
  const empty = { value: '—', sub: NO_CUSTOMERS }
  const cards = [
    {
      label: 'Customers with trips', value: count(M), sub: `of ${count(d.customer_groups)} customer groups`,
      sub2: cmp ? `${count(rows.filter((r) => !r.none && r.cp_trips > 0).length)} last year` : null,
    },
    M && P > 0
      ? { label: 'Largest customer', value: pct(share(top[0].profit)), sub: `${top[0].customer} · ${compactMoney(top[0].profit)}`, sub2: 'share of Total Profit' }
      : { label: 'Largest customer', ...empty, sub2: 'share of Total Profit' },
    { label: 'Top 10 customers', value: M && P > 0 ? pct(share(topN(10))) : '—', sub: M && P > 0 ? `Top 5: ${pct(share(topN(5)))}` : NO_CUSTOMERS, sub2: 'share of Total Profit' },
    {
      label: 'New customers', value: M && P > 0 ? pct(share(newProfit)) : '—',
      sub: `${compactMoney(newProfit)} from ${count(k)} ${k === 1 ? 'customer' : 'customers'}`, sub2: 'first trade within 12 months',
    },
  ]
  if (cmp) {
    const base = rows.filter((r) => !r.none && !r.smallBase)
    const change = (r) => r.ccProfit - r.cpProfit
    const up = base.filter((r) => r.ccProfit > r.cpProfit)
    cards.push({
      label: 'Customers growing', value: `${count(up.length)} of ${count(base.length)}`,
      sub: `Total Profit up vs ${cmp.cp_label}`,
      sub2: `${compactMoney(sum(up, change))} gained · ${compactMoney(-sum(base.filter((r) => change(r) < 0), change))} lost`,
      ids: up.map((r) => r.customer), base: base.map((r) => r.customer),
    })
  } else {
    cards.push({ label: 'Customers growing', value: '—', sub: 'No comparison for this period' })
  }
  return { cards, P, M, ranked: top }
}

// ── Top 15, teams ────────────────────────────────────────────────────────────

/** Blue/grey bars with the small-base rule in the tooltip ("New" instead of a change). */
function bars(rows, cmp, labelOf, tieBreak) {
  const m = top15Bars(rows, cmp, labelOf, tieBreak)
  return {
    ...m,
    titles: m.rows.map(labelOf),
    tooltip: cmp
      ? (i) => {
          const r = m.rows[i]
          return [`Total Profit ${tipMoney(r.ccProfit)}`, `Same months last year ${tipMoney(r.cpProfit)}`,
            r.smallBase ? 'New' : `Change ${signedPct(growth(r.ccProfit, r.cpProfit)).text}`]
        }
      : m.tooltip,
  }
}

export function top15(d) {
  return bars(ranked(enrich(d)), d.comparison, (r) => r.customer, (a, b) => (a.customer < b.customer ? -1 : 1))
}

export function teamRows(d) {
  const cmp = !!d.comparison
  const P = sum(d.teams, (t) => t.p_revenue - t.p_cost)
  return d.teams.map((t) => {
    const x = withDerived(t, cmp, SMALL_BASE_CENTS)
    return { ...x, name: t.team, unassigned: t.team === UNASSIGNED, share: ratio(x.profit, P) }
  })
}

const unassignedLast = (f) => (a, b) => (a.unassigned !== b.unassigned ? (a.unassigned ? 1 : -1) : f(a, b))

/** Team bars (blue vs grey), sorted by the blue value; "Unassigned" always last. */
export function teamBars(d) {
  const cmp = d.comparison
  const blue = (r) => (cmp ? r.ccProfit : r.profit)
  const rows = teamRows(d).sort(unassignedLast((a, b) => blue(b) - blue(a) || (a.team < b.team ? -1 : 1)))
  const datasets = cmp
    ? [
        { label: `Total Profit, ${cmp.cc_label}`, key: 'cc', values: rows.map((r) => r.ccProfit / 100) },
        { label: `Same months last year, ${cmp.cp_label}`, key: 'cp', values: rows.map((r) => r.cpProfit / 100) },
      ]
    : [{ label: 'Total Profit', key: 'p', values: rows.map((r) => r.profit / 100) }]
  return {
    rows,
    labels: rows.map((r) => r.team),
    titles: rows.map((r) => r.team),
    datasets,
    subtitle: cmp ? `${cmp.cc_label} vs ${cmp.cp_label}` : 'Selected period',
    tooltip: (i) => {
      const r = rows[i]
      if (!cmp) return [`Total Profit ${tipMoney(r.profit)}`]
      return [`Total Profit ${tipMoney(r.ccProfit)}`, `Same months last year ${tipMoney(r.cpProfit)}`,
        r.smallBase ? 'New' : `Change ${signedPct(growth(r.ccProfit, r.cpProfit)).text}`]
    },
  }
}

export function teamTable(d) {
  const rows = teamRows(d).sort(unassignedLast((a, b) => b.profit - a.profit || (a.team < b.team ? -1 : 1)))
  const cmp = !!d.comparison
  const ccP = sum(rows, (r) => r.ccProfit), cpP = sum(rows, (r) => r.cpProfit)
  const ccR = sum(rows, (r) => r.cc_revenue), cpR = sum(rows, (r) => r.cp_revenue)
  const P = sum(rows, (r) => r.profit), R = sum(rows, (r) => r.p_revenue), N = sum(rows, (r) => r.p_trips)
  const small = cmp && cpR < SMALL_BASE_CENTS
  return {
    rows,
    showYoy: cmp,
    total: {
      customers: sum(rows, (r) => r.customers), trips: N, revenue: R, cost: sum(rows, (r) => r.p_cost), profit: P,
      margin: ratio(P, R), ppt: ratio(P, N), share: rows.length ? 1 : null, smallBase: small,
      yoy: cmp && !small ? growth(ccP, cpP) : null, mpts: cmp && !small ? diff(ratio(ccP, ccR), ratio(cpP, cpR)) : null,
    },
  }
}

// ── Concentration, lowest margins, new vs existing ───────────────────────────

export function pareto(d) {
  const { ranked: top, P, M } = kpis(d)
  if (!M || !(P > 0)) return { empty: NO_CUSTOMERS, points: [] }
  const N = citiesFor80(top, P)
  let cum = 0
  const points = top.map((r, i) => { cum += r.profit; return { x: i + 1, y: Math.round((cum / P) * 10000) / 100 } })
  const ys = points.map((p) => p.y)
  return {
    empty: null, points, N, M, unit: 'customers', pointRadius: 2.5,
    yMin: Math.min(0, ...ys), yMax: Math.max(100, ...ys),
    markerLabel: N != null ? `${count(N)} ${N === 1 ? 'customer' : 'customers'} = 80% of profit` : null,
  }
}

export function lowestMargin(d) {
  const rows = enrich(d)
    .filter((r) => r.listed && !r.none && r.p_revenue >= LOW_MARGIN_MIN_REVENUE)
    .sort((a, b) => a.margin - b.margin || (a.customer < b.customer ? -1 : 1))
    .slice(0, 10)
  if (rows.length < 3) return { empty: LOW_MARGIN_EMPTY, rows: [] }
  return {
    empty: null,
    rows,
    labels: rows.map((r) => r.customer),
    values: rows.map((r) => Math.round(r.margin * 10000) / 100),
    tooltip: (i) => {
      const r = rows[i]
      return [`Margin ${(r.margin * 100).toFixed(2)}%`, `Total Profit ${tipMoney(r.profit)}`, `Revenue ${tipMoney(r.p_revenue)}`, `Team ${r.team}`]
    },
  }
}

export function newExisting(d) {
  const { months, existing, new: fresh } = d.new_existing
  const cur = d.current_month.start.slice(0, 7)
  const current = months.map((m) => m === cur && d.period.end >= d.current_month.start)
  const series = (arr) => arr.map(([r, c]) => (r - c) / 100)
  return {
    labels: months.map((m, i) => monthTick(m) + (current[i] ? ' (to date)' : '')),
    current,
    lines: [
      { name: 'Existing customers', color: '#2D5BA6', data: series(existing), customers: existing.map((v) => v[3]) },
      { name: 'New customers (first trade within 12 months)', color: '#4A9F78', data: series(fresh), customers: fresh.map((v) => v[3]) },
    ],
    totals: { existing: sum(existing, (v) => v[0] - v[1]), new: sum(fresh, (v) => v[0] - v[1]) },
  }
}

// ── Heatmap ──────────────────────────────────────────────────────────────────

export const HEAT_NEG = 'rgba(214,69,69,0.7)'

/** Top 8 customers × top 8 countries (+ "All other …"), with cell colour levels for a mode. */
export function heatmap(d, mode = 'profit') {
  const cells = new Map(d.grid.map((g) => [`${g.ki}|${g.ci}`, g]))
  const nameOf = (key, idx) => {
    const out = []
    for (let i = 1; i <= 9; i++) {
      const g = d.grid.find((x) => x[idx] === i)
      if (g) out.push({ i, name: g[key] })
    }
    return out
  }
  const rows = nameOf('customer', 'ki')
  const cols = nameOf('country', 'ci')
  const profitOf = (g) => g.revenue - g.cost
  const max = Math.max(0, ...d.grid.map(profitOf))
  const grid = rows.map((r) => cols.map((c) => {
    const g = cells.get(`${r.i}|${c.i}`)
    if (!g || !g.trips) return { empty: true }
    const profit = profitOf(g)
    const margin = ratio(profit, g.revenue)
    let level
    if (mode === 'profit') level = profit < 0 ? null : 0.06 + 0.84 * Math.sqrt(max > 0 ? profit / max : 0)
    else level = margin == null ? 0.06 : margin < 0 ? null : 0.06 + 0.84 * Math.min(1, margin / 0.4)
    return {
      empty: false, profit, revenue: g.revenue, trips: g.trips, margin,
      text: mode === 'profit' ? compactMoney(profit) : margin == null ? '—' : `${Math.round(margin * 100)}%`,
      bg: level == null ? HEAT_NEG : `rgba(45,91,166,${Math.round(level * 1000) / 1000})`,
      light: level == null || level > 0.55,
      title: `Profit ${tipMoney(profit)} | Revenue ${tipMoney(g.revenue)} | Margin ${margin == null ? '—' : (margin * 100).toFixed(1) + '%'} | Trips ${count(g.trips)}`,
    }
  }))
  return {
    rows: rows.map((r) => ({ ...r, other: r.i === 9 })),
    cols: cols.map((c) => ({ ...c, other: c.i === 9 })),
    grid,
    total: sum(d.grid, profitOf),
  }
}

// ── Selection + trend ────────────────────────────────────────────────────────

/** The URL's customer when it has trips in this selection; otherwise the top customer. */
export function selectedCustomer(d, wanted) {
  const rows = ranked(enrich(d))
  if (wanted && rows.some((r) => r.customer === wanted)) return wanted
  return rows[0]?.customer ?? null
}

const seriesFor = (d, name) =>
  (d.monthly.by_key[name] ?? d.monthly.months.map(() => [0, 0, 0])).map(([revenue, cost, trips]) => ({ revenue, cost, trips }))

export function trend(d, name) {
  const row = enrich(d).find((r) => r.customer === name)
  if (!row) return null
  const m = trendModel({
    title: `Monthly trend: ${row.customer}`,
    months: d.monthly.months,
    series: seriesFor(d, name),
    currentMonth: d.current_month.start,
    periodEnd: d.period.end,
    row,
    hasComparison: !!d.comparison,
  })
  if (row.smallBase) m.stat[m.stat.length - 1] = ['Profit vs last year', 'New']
  return { ...m, subtitle: `${row.customer_type} · ${row.team} · first trade ${row.firstTrade}` }
}

// ── Table ────────────────────────────────────────────────────────────────────

export function table(d) {
  const all = enrich(d)
  const listed = all.filter((r) => r.listed)
  const rows = listed.map((r) => ({
    ...r,
    delta: yoyDelta(r),
    spark: sparkline(seriesFor(d, r.customer).map((s) => (s.revenue - s.cost) / 100)),
  }))
  return { rows, showYoy: !!d.comparison, total: breakdownTotals(all, listed, !!d.comparison) }
}

/** "Profit vs last year" sort value: "New" (and no comparison) sort last in either direction. */
export const yoySortValue = (r) => (r.smallBase ? null : r.yoy)
