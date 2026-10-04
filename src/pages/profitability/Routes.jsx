// Profitability → Routes. Route types cover 100% of trips; individual routes are
// (pickup service area, route key) for transfer products only. Every number comes from the
// `profitability` edge function (page 'routes') for one pinned as_of. The selected route lives
// in ?route={sa_id}|{route_key}; the city filter in ?city={sa_id} (shown as a removable chip).
import { useCallback, useEffect, useRef } from 'react'
import {
  kpis, typeTable, typeCombo, typeMonthly, top15, losses, marginBands, selectedRoute, trend, table, cityChipLabel,
  routeKey, pinTier, NO_ROUTES, RIDE_HAILING,
} from './routesModel.js'
import { EMPTY_SELECTION } from './citiesModel.js'
import { tableMoney, pct, perTrip, count, signedPct, pts } from './format.js'
import { KpiCard, Panel, SortableTable, Delta, KpiSkeleton, PanelSkeleton, Sparkline, Swatch } from './components.jsx'
import { Top15Chart, TrendChart, RouteTypeCombo, RouteTypeMonthlyChart, MarginBandChart } from './charts.jsx'

const money = (v) => <span className={v < 0 ? 'pf-neg' : ''}>{tableMoney(v)}</span>
const marginCell = (m) => <span className={m < 0 ? 'pf-neg' : ''}>{pct(m)}</span>

function typeColumns(t) {
  const cols = [
    { key: 'type', label: 'Route type', value: (r) => r.name, render: (r) => <span className="pf-type"><Swatch color={r.color} />{r.name}</span>, foot: 'Total' },
    { key: 'trips', label: 'Trips', num: true, value: (r) => r.p_trips, render: (r) => count(r.p_trips), foot: count(t.total.trips) },
    { key: 'revenue', label: 'Revenue', num: true, value: (r) => r.p_revenue, render: (r) => money(r.p_revenue), foot: tableMoney(t.total.revenue) },
    { key: 'cost', label: 'Cost', num: true, value: (r) => r.p_cost, render: (r) => money(r.p_cost), foot: tableMoney(t.total.cost) },
    { key: 'profit', label: 'Total Profit', num: true, value: (r) => r.profit, render: (r) => <b>{money(r.profit)}</b>, foot: tableMoney(t.total.profit) },
    { key: 'margin', label: 'Margin', num: true, value: (r) => r.margin, render: (r) => marginCell(r.margin), foot: pct(t.total.margin) },
    { key: 'ppt', label: 'Profit per trip', num: true, value: (r) => r.ppt, render: (r) => perTrip(r.ppt), foot: perTrip(t.total.ppt) },
    { key: 'share', label: 'Share of profit', num: true, value: (r) => r.share, render: (r) => pct(r.share), foot: pct(t.total.share) },
  ]
  if (t.showYoy) {
    cols.push(
      { key: 'yoy', label: 'Profit vs last year', num: true, value: (r) => r.yoy, render: (r) => <Delta d={signedPct(r.yoy)} />, foot: <Delta d={signedPct(t.total.yoy)} /> },
      { key: 'mpts', label: 'Margin vs last year', num: true, value: (r) => r.mpts, render: (r) => <Delta d={pts(r.mpts)} />, foot: <Delta d={pts(t.total.mpts)} /> },
    )
  }
  return cols
}

const routeCell = (r) => (
  <span title={r.rollup ? undefined : r.route_key}>
    {r.is_distance_priced ? r.label.replace(/, distance-priced$/, '') : r.label}
    {r.is_distance_priced && <span className="pf-tag">distance-priced</span>}
  </span>
)

const lossColumns = [
  { key: 'route', label: 'Route', value: (r) => r.label, render: routeCell },
  { key: 'city', label: 'City', value: (r) => r.city, render: (r) => <span className="pf-nowrap" title={r.sa_name}>{r.city}</span> },
  { key: 'trips', label: 'Trips', num: true, value: (r) => r.p_trips, render: (r) => count(r.p_trips) },
  { key: 'revenue', label: 'Revenue', num: true, value: (r) => r.p_revenue, render: (r) => money(r.p_revenue) },
  { key: 'cost', label: 'Cost', num: true, value: (r) => r.p_cost, render: (r) => money(r.p_cost) },
  { key: 'profit', label: 'Total Profit', num: true, value: (r) => r.profit, render: (r) => <b>{money(r.profit)}</b> },
]

function routeColumns(t) {
  const cols = [
    { key: 'route', label: 'Route', value: (r) => r.label, render: routeCell, foot: 'Total' },
    { key: 'city', label: 'City', value: (r) => r.city, render: (r) => <span className="pf-nowrap" title={r.sa_name}>{r.city}</span> },
    { key: 'country', label: 'Country', value: (r) => r.country, render: (r) => <span className="pf-nowrap">{r.country}</span> },
    { key: 'trips', label: 'Trips', num: true, value: (r) => r.p_trips, render: (r) => count(r.p_trips), foot: count(t.total.trips) },
    { key: 'revenue', label: 'Revenue', num: true, value: (r) => r.p_revenue, render: (r) => money(r.p_revenue), foot: tableMoney(t.total.revenue) },
    { key: 'cost', label: 'Cost', num: true, value: (r) => r.p_cost, render: (r) => money(r.p_cost), foot: tableMoney(t.total.cost) },
    { key: 'profit', label: 'Total Profit', num: true, value: (r) => r.profit, render: (r) => <b>{money(r.profit)}</b>, foot: tableMoney(t.total.profit) },
    { key: 'margin', label: 'Margin', num: true, value: (r) => r.margin, render: (r) => marginCell(r.margin), foot: pct(t.total.margin) },
    { key: 'ppt', label: 'Profit per trip', num: true, value: (r) => r.ppt, render: (r) => perTrip(r.ppt), foot: perTrip(t.total.ppt) },
  ]
  if (t.showYoy) {
    cols.push({
      key: 'yoy', label: 'Profit vs last year', num: true, value: (r) => r.yoy,
      render: (r) => (r.isNew ? <span className="pf-muted">New this year</span> : <Delta d={signedPct(r.yoy)} />),
      foot: <Delta d={signedPct(t.total.yoy)} />,
    })
  }
  cols.push({ key: 'spark', label: 'Monthly profit', sortable: false, value: () => null, render: (r) => <Sparkline s={r.spark} /> })
  return cols
}

// Matches the label, the raw route name (so Chinese input works), the city (label and raw) and country.
const SEARCH = {
  placeholder: 'Search routes, cities or countries',
  fields: [(r) => r.label, (r) => r.route_key, (r) => r.city, (r) => r.sa_name, (r) => r.country],
}

function LoadingBody() {
  return (
    <>
      <div className="pf-seclabel">&nbsp;</div>
      <div className="pf-krow">{Array.from({ length: 5 }, (_, i) => <KpiSkeleton key={i} />)}</div>
      <div className="pf-grid">
        <PanelSkeleton span={7} height={300} />
        <PanelSkeleton span={5} height={340} />
        <PanelSkeleton span={12} height={340} />
        <PanelSkeleton span={6} height={480} />
        <PanelSkeleton span={6} height={480} />
        <PanelSkeleton span={4} height={340} />
        <PanelSkeleton span={8} height={340} />
        <PanelSkeleton span={12} height={560} />
      </div>
    </>
  )
}

/** "City: Alicante, Spain ✕" under the header while ?city= is set. */
export function CityChip({ d, params, setParam }) {
  if (!params.get('city')) return null
  const label = d ? cityChipLabel(d) : null
  return (
    <div className="pf-chip-row">
      <span className="pf-chip">
        City: {label ?? `#${params.get('city')}`}
        <button type="button" aria-label="Remove city filter" onClick={() => { setParam('city', null, null); setParam('route', null, null) }}>✕</button>
      </span>
    </div>
  )
}

export default function Routes({ res, loading, params, setParam }) {
  const trendRef = useRef(null)
  const d = res?.data
  const select = useCallback((id) => {
    setParam('route', id, null)
    requestAnimationFrame(() => trendRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }, [setParam])

  // ?route= is cleared when that route is no longer listed (e.g. after a filter change).
  const wanted = params.get('route')
  useEffect(() => {
    if (d && wanted && selectedRoute(d, wanted) !== wanted) setParam('route', null, null)
  }, [d, wanted]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return loading ? <><CityChip d={null} params={params} setParam={setParam} /><LoadingBody /></> : null

  const k = kpis(d)
  const tt = typeTable(d)
  const empty = tt.rows.length === 0
  const noRoutes = d.product === RIDE_HAILING
  const t = table(d)
  const route = selectedRoute(d, wanted)
  const tr = route ? trend(d, route) : null
  const top = top15(d)
  const loss = losses(d)
  const bands = marginBands(d)
  const note = (text) => <p className="pf-empty">{text}</p>
  // Route-level panels: "No trips…" for an empty selection, "Ride hailing has no fixed routes." for RH.
  const routeState = empty ? note(EMPTY_SELECTION) : noRoutes ? note(NO_ROUTES) : null
  const sectionLabel = `${d.period.label} — total profit by route`.toUpperCase()

  return (
    <div className="pf-routes" style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
      <CityChip d={d} params={params} setParam={setParam} />
      <div className="pf-seclabel">{sectionLabel}</div>
      <div className="pf-krow">
        {k.cards.map((c) => <KpiCard key={c.label} label={c.label} value={c.value} tone={c.tone} sub={c.sub} sub2={c.sub2} subTitle={c.subTitle} />)}
      </div>

      <div className="pf-grid">
        <Panel span={7} title="Total Profit by route type" subtitle="Covers 100% of trips">
          {empty ? note(EMPTY_SELECTION) : (
            <div className="pf-compact">
              <SortableTable columns={typeColumns(tt)} rows={tt.rows} defaultSort="profit" rowKey={(r) => r.route_type} />
            </div>
          )}
        </Panel>
        <Panel span={5} title="Route types: profit and margin" subtitle="Bars: profit. Diamonds: margin.">
          {empty ? note(EMPTY_SELECTION) : <RouteTypeCombo model={typeCombo(d)} />}
        </Panel>

        <Panel span={12} title="Monthly profit by route type" subtitle="Monthly Total Profit, stacked by route type">
          {empty ? note(EMPTY_SELECTION) : <RouteTypeMonthlyChart model={typeMonthly(d)} />}
        </Panel>

        <Panel span={6} title="Top 15 routes by Total Profit" subtitle={routeState ? ' ' : top.subtitle}>
          {routeState ?? (top.rows.length ? <Top15Chart model={top} maxLabel={38} onSelect={(i) => select(routeKey(top.rows[i]))} /> : note(EMPTY_SELECTION))}
        </Panel>
        <Panel span={6} title="Routes losing money">
          {routeState ?? (loss.empty ? note(loss.empty) : (
            <>
              <SortableTable
                columns={lossColumns} rows={loss.rows} defaultSort="profit" defaultDir={1} footer={false}
                rowKey={routeKey} limit={10} onRowClick={(r) => select(routeKey(r))} selectedKey={route}
              />
              <p className="pf-note">{loss.footnote}</p>
            </>
          ))}
        </Panel>

        <Panel span={4} title="Routes by margin" subtitle="Listed routes, by margin band">
          {routeState ?? (bands.empty ? note(bands.empty) : <MarginBandChart model={bands} />)}
        </Panel>
        <div ref={trendRef} className="s8" style={{ scrollMarginTop: 90 }}>
          <Panel span={12} title={tr ? tr.title : 'Monthly trend'} subtitle={tr ? tr.subtitle : null}>
            {routeState ?? (tr ? (
              <>
                <p className="pf-stat">
                  {tr.stat.map(([l, v], i) => <span key={l}>{i > 0 && ' · '}{l} <b>{v}</b></span>)}
                </p>
                <TrendChart model={tr} />
              </>
            ) : note(EMPTY_SELECTION))}
          </Panel>
        </div>

        <Panel span={12} title="All listed routes">
          {routeState ?? (
            <>
              <SortableTable
                columns={routeColumns(t)} rows={t.rows} defaultSort="profit"
                rowKey={routeKey} pinLast={pinTier} search={SEARCH} limit={25} step={100}
                onRowClick={(r) => { if (!r.rollup && !r.none) select(routeKey(r)) }} selectedKey={route}
                rowClass={(r) => (r.rollup || r.none ? 'pf-muted-row' : '')}
              />
              <p className="pf-note">{t.footnote}</p>
            </>
          )}
        </Panel>
      </div>
    </div>
  )
}
