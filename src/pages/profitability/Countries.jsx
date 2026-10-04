// Profitability → Countries. Every number comes from the `profitability` edge function
// (page 'countries') for one pinned as_of; the selected country lives in ?country=.
import { useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  header, kpis, top15, bubbles, selectedCountry, trend, table, EMPTY_SELECTION, UNMAPPED,
} from './countriesModel.js'
import { tableMoney, pct, perTrip, count, signedPct, pts } from './format.js'
import { KpiCard, Panel, SortableTable, Delta, KpiSkeleton, PanelSkeleton, Sparkline } from './components.jsx'
import { Top15Chart, BubbleChart, TrendChart } from './charts.jsx'

const money = (v) => <span className={v < 0 ? 'pf-neg' : ''}>{tableMoney(v)}</span>
const isUnmapped = (r) => r.unmapped

function tableColumns(t) {
  const cols = [
    { key: 'country', label: 'Country', value: (r) => r.country, render: (r) => r.country, foot: 'Total' },
    { key: 'region', label: 'Region', value: (r) => r.regionLabel,
      render: (r) => <span className="pf-nowrap" title={r.regionTitle || undefined}>{r.regionLabel}</span> },
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

/** Link into Cities filtered to one country, keeping period, as_of and region. */
function citiesHref(params, country) {
  const q = new URLSearchParams()
  for (const k of ['period', 'as_of', 'region']) if (params.get(k)) q.set(k, params.get(k))
  q.set('country', country)
  return `/profitability/cities?${q}`
}

const SEARCH = { placeholder: 'Search countries or regions', fields: [(r) => r.country, (r) => r.regionLabel, (r) => r.all_regions.join(' ')] }

function LoadingBody() {
  return (
    <>
      <div className="pf-seclabel">&nbsp;</div>
      <div className="pf-krow">{Array.from({ length: 5 }, (_, i) => <KpiSkeleton key={i} />)}</div>
      <div className="pf-grid">
        <PanelSkeleton span={6} height={480} />
        <PanelSkeleton span={6} height={480} />
        <PanelSkeleton span={12} height={340} />
        <PanelSkeleton span={12} height={560} />
      </div>
    </>
  )
}

export default function Countries({ res, loading, params, setParam }) {
  const trendRef = useRef(null)
  const d = res?.data
  const select = useCallback((country) => {
    setParam('country', country, null)
    requestAnimationFrame(() => trendRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }, [setParam])

  if (!d) return loading ? <LoadingBody /> : null

  const h = header(d)
  const k = kpis(d)
  const t = table(d)
  const empty = t.rows.length === 0
  const country = selectedCountry(d, params.get('country'))
  const tr = country ? trend(d, country) : null
  const top = top15(d)
  const bub = bubbles(d)
  const emptyNote = <p className="pf-empty">{EMPTY_SELECTION}</p>

  return (
    <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
      <div className="pf-seclabel">{h.sectionLabel}</div>
      <div className="pf-krow">
        {k.cards.map((c) => (
          <KpiCard key={c.label} label={c.label} value={c.value} tone={c.tone} sub={c.sub} subTitle={c.subTitle} sub2={c.sub2} />
        ))}
      </div>

      <div className="pf-grid">
        <Panel span={6} title="Top 15 countries by Total Profit" subtitle={top.subtitle}>
          {top.rows.length ? <Top15Chart model={top} onSelect={(i) => select(top.rows[i].country)} /> : emptyNote}
        </Panel>
        <Panel span={6} title="Size vs margin by country" subtitle="Revenue against profit margin, bubble size = trips">
          {bub.points.length ? <BubbleChart model={bub} onSelect={select} /> : emptyNote}
        </Panel>

        <div ref={trendRef} className="s12" style={{ scrollMarginTop: 90 }}>
          <Panel span={12} title={tr ? tr.title : 'Monthly trend'} subtitle="Revenue, Total Profit and margin by month"
            action={country && <Link className="pf-btn-secondary" to={citiesHref(params, country)}>See cities in {country}</Link>}>
            {tr ? (
              <>
                <p className="pf-stat">
                  {tr.stat.map(([l, v], i) => (
                    <span key={l}>{i > 0 && ' · '}{l} <b>{v}</b></span>
                  ))}
                </p>
                <TrendChart model={tr} />
              </>
            ) : emptyNote}
          </Panel>
        </div>

        <Panel span={12} title="All countries" subtitle="Pickup country. Select a row to see its monthly trend.">
          {empty ? emptyNote : (
            <SortableTable
              columns={tableColumns(t)} rows={t.rows} defaultSort="profit"
              rowKey={(r) => r.country} pinLast={isUnmapped} search={SEARCH} limit={25}
              onRowClick={(r) => select(r.country)} selectedKey={country}
              rowClass={(r) => (r.country === UNMAPPED ? 'pf-muted-row' : '')}
            />
          )}
        </Panel>
      </div>
    </div>
  )
}
