// Profitability → Cities. City = pickup service area (keyed by sa_id). Every number comes from
// the `profitability` edge function (page 'cities') for one pinned as_of; the selected city
// lives in ?city={sa_id}, the country filter in ?country=.
import { useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  kpis, top15, lowestMargin, pareto, selectedCity, trend, table, header, EMPTY_SELECTION,
} from './citiesModel.js'
import { tableMoney, pct, perTrip, count, signedPct, pts } from './format.js'
import { KpiCard, Panel, SortableTable, Delta, KpiSkeleton, PanelSkeleton, Sparkline } from './components.jsx'
import { Top15Chart, MarginBars, ParetoChart, TrendChart } from './charts.jsx'

const money = (v) => <span className={v < 0 ? 'pf-neg' : ''}>{tableMoney(v)}</span>
const isNone = (r) => r.none

/** Link into Routes filtered to one city, keeping period, as_of, region and country. */
function routesHref(params, saId) {
  const q = new URLSearchParams()
  for (const k of ['period', 'as_of', 'region', 'country']) if (params.get(k)) q.set(k, params.get(k))
  q.set('city', String(saId))
  return `/profitability/routes?${q}`
}

function tableColumns(t) {
  const cols = [
    { key: 'city', label: 'City', value: (r) => r.label, render: (r) => <span title={r.sa_name}>{r.label}</span>, foot: 'Total' },
    { key: 'country', label: 'Country', value: (r) => r.country, render: (r) => <span className="pf-nowrap">{r.country}</span> },
    { key: 'region', label: 'Region', value: (r) => r.region, render: (r) => <span className="pf-nowrap">{r.region}</span> },
    { key: 'trips', label: 'Trips', num: true, value: (r) => r.p_trips, render: (r) => count(r.p_trips), foot: count(t.total.trips) },
    { key: 'revenue', label: 'Revenue', num: true, value: (r) => r.p_revenue, render: (r) => money(r.p_revenue), foot: tableMoney(t.total.revenue) },
    { key: 'cost', label: 'Cost', num: true, value: (r) => r.p_cost, render: (r) => money(r.p_cost), foot: tableMoney(t.total.cost) },
    { key: 'profit', label: 'Total Profit', num: true, value: (r) => r.profit, render: (r) => <b>{money(r.profit)}</b>, foot: tableMoney(t.total.profit) },
    { key: 'margin', label: 'Margin', num: true, value: (r) => r.margin,
      render: (r) => <span className={r.margin < 0 ? 'pf-neg' : ''}>{pct(r.margin)}</span>, foot: pct(t.total.margin) },
    { key: 'ppt', label: 'Profit per trip', num: true, value: (r) => r.ppt, render: (r) => perTrip(r.ppt), foot: perTrip(t.total.ppt) },
  ]
  if (t.showYoy) {
    cols.push(
      { key: 'yoy', label: 'Profit vs last year', num: true, value: (r) => r.yoy, render: (r) => <Delta d={signedPct(r.yoy)} />, foot: <Delta d={signedPct(t.total.yoy)} /> },
      { key: 'mpts', label: 'Margin vs last year', num: true, value: (r) => r.mpts, render: (r) => <Delta d={pts(r.mpts)} />, foot: <Delta d={pts(t.total.mpts)} /> },
    )
  }
  cols.push({ key: 'spark', label: 'Monthly profit', sortable: false, value: () => null, render: (r) => <Sparkline s={r.spark} /> })
  return cols
}

// Matches the cleaned label and the raw service-area name, plus country and region.
const SEARCH = {
  placeholder: 'Search cities, countries or regions',
  fields: [(r) => r.label, (r) => r.sa_name, (r) => r.country, (r) => r.region],
}

function LoadingBody() {
  return (
    <>
      <div className="pf-seclabel">&nbsp;</div>
      <div className="pf-krow">{Array.from({ length: 5 }, (_, i) => <KpiSkeleton key={i} />)}</div>
      <div className="pf-grid">
        <PanelSkeleton span={6} height={480} />
        <PanelSkeleton span={6} height={480} />
        <PanelSkeleton span={12} height={340} />
        <PanelSkeleton span={12} height={340} />
        <PanelSkeleton span={12} height={560} />
      </div>
    </>
  )
}

export default function Cities({ res, loading, params, setParam }) {
  const trendRef = useRef(null)
  const d = res?.data
  const select = useCallback((saId) => {
    setParam('city', String(saId), null)
    requestAnimationFrame(() => trendRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }, [setParam])

  // ?city= is cleared when that city is not in the filtered data (e.g. after a filter change).
  const wanted = params.get('city')
  useEffect(() => {
    if (d && wanted && selectedCity(d, wanted) !== Number(wanted)) setParam('city', null, null)
  }, [d, wanted]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return loading ? <LoadingBody /> : null

  const h = header(d)
  const k = kpis(d)
  const t = table(d)
  const empty = t.rows.length === 0
  const city = selectedCity(d, params.get('city'))
  const tr = city != null ? trend(d, city) : null
  const top = top15(d)
  const low = lowestMargin(d)
  const par = pareto(d)
  const emptyNote = <p className="pf-empty">{EMPTY_SELECTION}</p>

  return (
    <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
      <div className="pf-seclabel">{h.sectionLabel}</div>
      <div className="pf-krow">
        {k.cards.map((c) => <KpiCard key={c.label} label={c.label} value={c.value} tone={c.tone} sub={c.sub} sub2={c.sub2} />)}
      </div>

      <div className="pf-grid">
        <Panel span={6} title="Top 15 cities by Total Profit" subtitle={top.subtitle}>
          {top.rows.length ? <Top15Chart model={top} onSelect={(i) => select(top.rows[i].sa_id)} /> : emptyNote}
        </Panel>
        <Panel span={6} title="Lowest-margin cities" subtitle="At least $50k revenue in the period">
          {empty ? emptyNote : low.empty ? <p className="pf-empty">{low.empty}</p>
            : <MarginBars model={low} onSelect={(i) => select(low.rows[i].sa_id)} />}
        </Panel>

        <Panel span={12} title="Profit concentration across cities" subtitle="Cumulative share of Total Profit, highest-profit cities first">
          {par.empty ? <p className="pf-empty">{par.empty}</p> : <ParetoChart model={par} />}
        </Panel>

        <div ref={trendRef} className="s12" style={{ scrollMarginTop: 90 }}>
          <Panel span={12} title={tr ? tr.title : 'Monthly trend'} subtitle="Revenue, Total Profit and margin by month"
            action={tr && <Link className="pf-btn-secondary" to={routesHref(params, city)}>See routes in {tr.cityLabel}</Link>}>
            {tr ? (
              <>
                <p className="pf-stat">
                  {tr.stat.map(([l, v], i) => <span key={l}>{i > 0 && ' · '}{l} <b>{v}</b></span>)}
                </p>
                <TrendChart model={tr} />
              </>
            ) : emptyNote}
          </Panel>
        </div>

        <Panel span={12} title="All cities" subtitle="City = pickup service area. Select a row to see its monthly trend.">
          {empty ? emptyNote : (
            <SortableTable
              columns={tableColumns(t)} rows={t.rows} defaultSort="profit"
              rowKey={(r) => r.sa_id} pinLast={isNone} search={SEARCH} limit={25} step={100}
              onRowClick={(r) => { if (!r.none) select(r.sa_id) }} selectedKey={city}
              rowClass={(r) => (r.none ? 'pf-muted-row' : '')}
            />
          )}
        </Panel>
      </div>
    </div>
  )
}
