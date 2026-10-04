// Routes view model: payload (integer cents) → exactly what the Routes page shows.
// A route is (pickup service area, route key); labels are display-only (routeLabels.js).
// Route types cover 100% of trips; individual routes are transfer products only.

import { compactMoney, signedMoney, signedPct, pct, count, utcMinute, ratio, monthTick } from './format.js'
import { withDerived, top15Bars, trendModel, sparkline, tipMoney, sum, growth, diff } from './modelShared.js'
import { cityLabel, NO_SERVICE_AREA, EMPTY_SELECTION } from './citiesModel.js'
import { routeLabel } from './routeLabels.js'

export const ROLLUP_ID = -2
export const NO_ROUTES = 'Ride hailing has no fixed routes.'
export const NO_LOSSES = 'No route lost money in this period.'
export const RIDE_HAILING = 'Ride Hailing'
export const PRODUCTS = ['Private Transfer', 'Shared Shuttle', 'Rail', 'Ride Hailing']

export const ROUTE_TYPES = {
  0: { name: 'Airport → city', short: 'Airport → city', color: '#2D5BA6' },
  1: { name: 'City → airport', short: 'City → airport', color: '#9DB4DD' },
  2: { name: 'Airport → airport', short: 'Airport → airport', color: '#4A9F78' },
  3: { name: 'City → city', short: 'City → city', color: '#C4C4C4' },
  4: { name: 'Ride hailing (point to point)', short: 'Ride hailing', color: '#E0A43A' },
}
/** Stack / chart order, bottom → top (§5.4). */
export const TYPE_ORDER = [0, 1, 3, 2, 4]

const TITLE_MAX = 38
const truncate = (s, n = TITLE_MAX) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
/** Percentage with 2 decimals (loss share): 0.23% */
export const pct2 = (x) => (x == null || !isFinite(x) ? '—' : `${(x * 100).toFixed(2)}%`)

/** "vs last year" does not apply when the route (or type) made nothing last year. */
const isNew = (r) => r.cp_revenue === 0 && r.cp_cost === 0
const rhOnly = (d) => d.product === RIDE_HAILING

// ── Rows ─────────────────────────────────────────────────────────────────────

export function typeRows(d) {
  const cmp = !!d.comparison
  return d.route_types.map((t) => {
    const x = withDerived(t, cmp)
    const noLy = x.cpProfit === 0
    return {
      ...x, ...ROUTE_TYPES[t.route_type],
      yoy: cmp && !noLy ? x.yoy : null,
      mpts: cmp && !noLy ? x.mpts : null,
    }
  })
}

/** Listed routes + the roll-up row, with labels and derived fields. */
export function enrich(d) {
  const cmp = !!d.comparison
  const inCity = d.city != null
  return d.routes.map((r) => {
    const x = withDerived(r, cmp)
    const rollup = r.sa_id === ROLLUP_ID
    const none = r.sa_id === NO_SERVICE_AREA
    const label = rollup ? `All other routes (${count(r.n_routes)} routes)` : routeLabel(r.route_key)
    const city = rollup ? '' : none ? '(no service area)' : cityLabel(r.sa_name)
    return {
      ...x, rollup, none, label, city,
      display: rollup || inCity ? label : `${label} · ${city}`,
      // Margin is "—" when revenue ≤ 0 (refunds larger than fares make a ratio meaningless).
      margin: x.p_revenue > 0 ? x.margin : null,
      isNew: cmp && isNew(r),
      yoy: cmp && !isNew(r) ? x.yoy : null,
    }
  })
}

/** Routes that take part in charts and rankings: not the roll-up, not "(no service area)". */
const ranked = (rows) => rows.filter((r) => !r.rollup && !r.none)
const byProfitDesc = (a, b) => b.profit - a.profit || a.sa_id - b.sa_id || (a.route_key < b.route_key ? -1 : 1)

export function totals(d) {
  const types = d.route_types
  const pAll = sum(types, (t) => t.p_revenue - t.p_cost)
  const tr = types.filter((t) => t.route_type !== 4)
  return {
    P_all: pAll,
    revenue: sum(types, (t) => t.p_revenue), cost: sum(types, (t) => t.p_cost), trips: sum(types, (t) => t.p_trips),
    P_tr: d.route_kpis.transfer_profit,
    transferTrips: sum(tr, (t) => t.p_trips),
  }
}

// ── Header ───────────────────────────────────────────────────────────────────

export const cityChipLabel = (d) => (d.city_info
  ? `${d.city_info.sa_name ? cityLabel(d.city_info.sa_name) : `#${d.city_info.sa_id}`}${d.city_info.country ? `, ${d.city_info.country}` : ''}`
  : null)

export function header(d) {
  const label = d.period.label
  const city = cityChipLabel(d)
  return {
    title: 'Routes',
    badge: `Data as of ${d.data_date}`,
    badgeTooltip: `Pinned ${utcMinute(d.as_of)} UTC · warehouse load ${utcMinute(d.warehouse_loaded_at)} UTC`,
    subtitle: `${label} profit by route${d.comparison ? `, ${d.comparison.label}` : ''}.`
      + `${d.region ? ` Region: ${d.region}.` : ''}${d.country && !city ? ` Country: ${d.country}.` : ''}`
      + `${city ? ` City: ${city}.` : ''}${d.product ? ` Product: ${d.product}.` : ''}`,
    sectionLabel: `${label} — total profit by route`.toUpperCase(),
  }
}

// ── KPI row ──────────────────────────────────────────────────────────────────

export function kpis(d) {
  const k = d.route_kpis
  const t = totals(d)
  const rows = enrich(d)
  const listed = rows.filter((r) => !r.rollup).length
  const empty = t.trips === 0
  if (rhOnly(d) || empty) {
    const why = (empty ? EMPTY_SELECTION : NO_ROUTES).replace(/\.$/, '')
    return {
      cards: ['Routes with trips', 'Top route', 'Top 50 routes', 'Distance-priced', 'Loss-making routes']
        .map((label) => ({ label, value: '—', sub: why })),
    }
  }
  const P = t.P_tr
  const share = (x) => (P > 0 ? x / P : null)
  const top = rows.find((r) => `${r.sa_id}|${r.route_key}` === k.top1_key)
  const topText = top ? `${top.label} · ${top.city}` : k.top1_key ?? '—'
  const top50 = share(k.top50_profit)
  return {
    cards: [
      { label: 'Routes with trips', value: count(k.routes), sub: `${count(listed)} listed individually`, sub2: 'transfer products only' },
      { label: 'Top route', value: pct(share(k.top1_profit)), sub: topText, subTitle: topText, sub2: 'share of transfer profit' },
      { label: 'Top 50 routes', value: pct(top50), sub: 'share of transfer profit', sub2: top50 != null && top50 < 0.5 ? 'the network is long-tail' : null },
      { label: 'Distance-priced', value: pct(share(k.dp_profit)), sub: `${compactMoney(k.dp_profit)} · ${count(k.dp_trips)} trips`, sub2: 'transfers without a zone route' },
      {
        label: 'Loss-making routes', value: count(k.loss_routes), tone: k.loss_routes > 0 ? 'down' : null,
        sub: `Total loss ${signedMoney(k.loss_total)}`, sub2: `${P > 0 ? pct2(Math.abs(k.loss_total) / P) : '—'} of transfer profit`,
      },
    ],
  }
}

// ── Route types ──────────────────────────────────────────────────────────────

export function typeTable(d) {
  const rows = typeRows(d).sort((a, b) => b.profit - a.profit || a.route_type - b.route_type)
  const t = totals(d)
  const withShare = rows.map((r) => ({ ...r, share: ratio(r.profit, t.P_all) }))
  const cmp = !!d.comparison
  const ccP = sum(rows, (r) => r.ccProfit), cpP = sum(rows, (r) => r.cpProfit)
  const ccR = sum(rows, (r) => r.cc_revenue), cpR = sum(rows, (r) => r.cp_revenue)
  return {
    rows: withShare,
    showYoy: cmp,
    total: {
      trips: t.trips, revenue: t.revenue, cost: t.cost, profit: t.P_all,
      margin: ratio(t.P_all, t.revenue), ppt: ratio(t.P_all, t.trips), share: rows.length ? 1 : null,
      yoy: cmp ? growth(ccP, cpP) : null, mpts: cmp ? diff(ratio(ccP, ccR), ratio(cpP, cpR)) : null,
    },
  }
}

const inOrder = (rows) => TYPE_ORDER.map((id) => rows.find((r) => r.route_type === id)).filter(Boolean)

export function typeCombo(d) {
  const rows = inOrder(typeRows(d))
  return {
    labels: rows.map((r) => r.short),
    profit: rows.map((r) => r.profit / 100),
    marginPct: rows.map((r) => (r.margin == null ? null : Math.round(r.margin * 10000) / 100)),
    tooltip: (i) => [`Profit ${tipMoney(rows[i].profit)}`, `Margin ${pct(rows[i].margin)}`],
    rows,
  }
}

export function typeMonthly(d) {
  const { months, by_key } = d.type_monthly
  const cur = d.current_month.start.slice(0, 7)
  const isCurrent = months.map((m) => m === cur && d.period.end >= d.current_month.start)
  const present = TYPE_ORDER.filter((id) => d.route_types.some((t) => t.route_type === id))
  return {
    labels: months.map((m, i) => monthTick(m) + (isCurrent[i] ? ' (to date)' : '')),
    current: isCurrent,
    lines: present.map((id) => ({
      id, name: ROUTE_TYPES[id].name, color: ROUTE_TYPES[id].color,
      data: (by_key[id] ?? months.map(() => [0, 0, 0])).map(([r, c]) => (r - c) / 100),
    })),
  }
}

// ── Individual routes ────────────────────────────────────────────────────────

const rawTitle = (r) => `${r.display} (${r.route_key})`

export function top15(d) {
  const rows = ranked(enrich(d))
  const m = top15Bars(rows, d.comparison, (r) => r.display, (a, b) => a.sa_id - b.sa_id || (a.route_key < b.route_key ? -1 : 1))
  const change = (r) => (r.cpProfit === 0 ? 'New this year' : `Change ${signedPct(growth(r.ccProfit, r.cpProfit)).text}`)
  return {
    ...m,
    labels: m.rows.map((r) => truncate(r.display)),
    titles: m.rows.map(rawTitle),
    tooltip: d.comparison
      ? (i) => { const r = m.rows[i]; return [`Total Profit ${tipMoney(r.ccProfit)}`, `Same months last year ${tipMoney(r.cpProfit)}`, change(r)] }
      : m.tooltip,
  }
}

export function losses(d) {
  const k = d.route_kpis
  const P = d.route_kpis.transfer_profit
  const rows = ranked(enrich(d)).filter((r) => r.profit < 0).sort((a, b) => a.profit - b.profit || a.sa_id - b.sa_id)
  return {
    rows,
    empty: rows.length ? null : NO_LOSSES,
    footnote: `Total loss ${signedMoney(k.loss_total)}, ${P > 0 ? pct2(Math.abs(k.loss_total) / P) : '—'} of transfer profit`,
  }
}

export const MARGIN_BANDS = ['Loss', '0–10%', '10–20%', '20–30%', '30%+']
/** Band index from integer cents (exact; no floating-point boundary errors). */
export function marginBand(profit, revenue) {
  if (profit < 0) return 0
  if (profit * 10 < revenue) return 1
  if (profit * 5 < revenue) return 2
  if (profit * 10 < revenue * 3) return 3
  return 4
}

export function marginBands(d) {
  const rows = ranked(enrich(d)).filter((r) => r.p_revenue > 0)
  const bands = MARGIN_BANDS.map((name) => ({ name, n: 0, revenue: 0, profit: 0 }))
  for (const r of rows) {
    const b = bands[marginBand(r.profit, r.p_revenue)]
    b.n++; b.revenue += r.p_revenue; b.profit += r.profit
  }
  return {
    empty: rows.length ? null : EMPTY_SELECTION,
    bands,
    tooltip: (i) => [`${count(bands[i].n)} routes`, `Revenue ${tipMoney(bands[i].revenue)}`, `Total Profit ${tipMoney(bands[i].profit)}`],
  }
}

// ── Selection + trend ────────────────────────────────────────────────────────

export const routeKey = (r) => `${r.sa_id}|${r.route_key}`

/** The URL's route when it is listed (and rankable) in this selection; otherwise the top route by profit. */
export function selectedRoute(d, wanted) {
  const rows = ranked(enrich(d))
  if (wanted && rows.some((r) => routeKey(r) === wanted)) return wanted
  const top = rows.sort(byProfitDesc)[0]
  return top ? routeKey(top) : null
}

const seriesFor = (d, id) =>
  (d.monthly.by_key[id] ?? d.monthly.months.map(() => [0, 0, 0])).map(([revenue, cost, trips]) => ({ revenue, cost, trips }))

export function trend(d, id) {
  const row = enrich(d).find((r) => routeKey(r) === id)
  if (!row) return null
  const m = trendModel({
    title: `Monthly trend: ${row.label}`,
    months: d.monthly.months,
    series: seriesFor(d, id),
    currentMonth: d.current_month.start,
    periodEnd: d.period.end,
    row,
    hasComparison: !!d.comparison,
  })
  if (row.isNew) m.stat[m.stat.length - 1] = ['Profit vs last year', 'New this year']
  return { ...m, subtitle: `${row.city}, ${row.country}`, raw: row.route_key }
}

// ── Table ────────────────────────────────────────────────────────────────────

export function table(d) {
  const all = enrich(d)
  const rows = all.map((r) => ({
    ...r,
    spark: r.rollup ? null : sparkline(seriesFor(d, routeKey(r)).map((s) => (s.revenue - s.cost) / 100)),
  }))
  const tr = sum(all, (r) => r.p_revenue), tp = sum(all, (r) => r.profit), tn = sum(all, (r) => r.p_trips)
  const listed = all.filter((r) => !r.rollup)
  const P = d.route_kpis.transfer_profit
  const cmp = !!d.comparison
  const ccP = sum(all, (r) => r.ccProfit), cpP = sum(all, (r) => r.cpProfit)
  return {
    rows,
    showYoy: cmp,
    total: {
      trips: tn, revenue: tr, cost: sum(all, (r) => r.p_cost), profit: tp,
      margin: tr > 0 ? ratio(tp, tr) : null, ppt: ratio(tp, tn), yoy: cmp ? growth(ccP, cpP) : null,
    },
    footnote: `The ${count(listed.length)} routes listed hold ${pct(P > 0 ? sum(listed, (r) => r.profit) / P : null)} of transfer profit. `
      + 'The rest is in "All other routes". Ride hailing has no fixed routes.',
  }
}

/** Table pin tiers: "(no service area)" rows, then the roll-up, always at the bottom. */
export const pinTier = (r) => (r.rollup ? 2 : r.none ? 1 : 0)
