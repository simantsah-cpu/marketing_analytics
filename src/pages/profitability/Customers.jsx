// Profitability → Customers. Customer = customer group of the ordering fleet, named as stored.
// Every number comes from the `profitability` edge function (page 'customers') for one pinned
// as_of. The selected customer lives in ?customer=; the team and type filters in ?team= / ?ctype=.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  kpis, top15, teamBars, teamTable, pareto, lowestMargin, newExisting, heatmap, selectedCustomer, trend, table,
  yoySortValue, NO_CUSTOMERS,
} from './customersModel.js'
import { tableMoney, pct, perTrip, count, pts } from './format.js'
import { yoyDelta } from './modelShared.js'
import { KpiCard, Panel, SortableTable, Delta, KpiSkeleton, PanelSkeleton, Sparkline, Segmented } from './components.jsx'
import { Top15Chart, MarginBars, ParetoChart, TrendChart, NewExistingChart } from './charts.jsx'

const money = (v) => <span className={v < 0 ? 'pf-neg' : ''}>{tableMoney(v)}</span>
const isNone = (r) => r.none
const isUnassigned = (r) => r.unassigned

function teamColumns(t) {
  const cols = [
    { key: 'team', label: 'Team', value: (r) => r.team, foot: 'Total', render: (r) => <span className="pf-nowrap">{r.team}</span> },
    { key: 'customers', label: 'Customers', num: true, value: (r) => r.customers, render: (r) => count(r.customers), foot: count(t.total.customers) },
    { key: 'trips', label: 'Trips', num: true, value: (r) => r.p_trips, render: (r) => count(r.p_trips), foot: count(t.total.trips) },
    { key: 'revenue', label: 'Revenue', num: true, value: (r) => r.p_revenue, render: (r) => money(r.p_revenue), foot: tableMoney(t.total.revenue) },
    { key: 'cost', label: 'Cost', num: true, value: (r) => r.p_cost, render: (r) => money(r.p_cost), foot: tableMoney(t.total.cost) },
    { key: 'profit', label: 'Total Profit', num: true, value: (r) => r.profit, render: (r) => <b>{money(r.profit)}</b>, foot: tableMoney(t.total.profit) },
    { key: 'margin', label: 'Margin', num: true, value: (r) => r.margin, render: (r) => <span className={r.margin < 0 ? 'pf-neg' : ''}>{pct(r.margin)}</span>, foot: pct(t.total.margin) },
    { key: 'ppt', label: 'Profit per trip', num: true, value: (r) => r.ppt, render: (r) => perTrip(r.ppt), foot: perTrip(t.total.ppt) },
    { key: 'share', label: 'Share of profit', num: true, value: (r) => r.share, render: (r) => pct(r.share), foot: pct(t.total.share) },
  ]
  if (t.showYoy) {
    cols.push(
      { key: 'yoy', label: 'Profit vs last year', num: true, value: yoySortValue, render: (r) => <Delta d={yoyDelta(r)} />, foot: <Delta d={yoyDelta(t.total)} /> },
      { key: 'mpts', label: 'Margin vs last year', num: true, value: (r) => r.mpts, render: (r) => <Delta d={pts(r.mpts)} />, foot: <Delta d={pts(t.total.mpts)} /> },
    )
  }
  return cols
}

function customerColumns(t) {
  const cols = [
    {
      key: 'customer', label: 'Customer', value: (r) => r.customer, foot: 'Total',
      render: (r) => <span className="pf-nowrap">{r.customer}{r.isNew && <span className="pf-new-tag">New</span>}</span>,
    },
    { key: 'type', label: 'Type', value: (r) => r.customer_type, render: (r) => r.customer_type },
    { key: 'team', label: 'Team', value: (r) => r.team, render: (r) => <span className="pf-nowrap">{r.team}</span> },
    { key: 'first', label: 'First trade', value: (r) => r.first_trade_month, render: (r) => <span className="pf-nowrap">{r.firstTrade}</span> },
    { key: 'trips', label: 'Trips', num: true, value: (r) => r.p_trips, render: (r) => count(r.p_trips), foot: count(t.total.trips) },
    { key: 'revenue', label: 'Revenue', num: true, value: (r) => r.p_revenue, render: (r) => money(r.p_revenue), foot: tableMoney(t.total.revenue) },
    { key: 'cost', label: 'Cost', num: true, value: (r) => r.p_cost, render: (r) => money(r.p_cost), foot: tableMoney(t.total.cost) },
    { key: 'profit', label: 'Total Profit', num: true, value: (r) => r.profit, render: (r) => <b>{money(r.profit)}</b>, foot: tableMoney(t.total.profit) },
    { key: 'margin', label: 'Margin', num: true, value: (r) => r.margin, render: (r) => <span className={r.margin < 0 ? 'pf-neg' : ''}>{pct(r.margin)}</span>, foot: pct(t.total.margin) },
    { key: 'ppt', label: 'Profit per trip', num: true, value: (r) => r.ppt, render: (r) => perTrip(r.ppt), foot: perTrip(t.total.ppt) },
  ]
  if (t.showYoy) {
    cols.push(
      { key: 'yoy', label: 'Profit vs last year', num: true, value: yoySortValue, render: (r) => <Delta d={r.delta} />, foot: <Delta d={yoyDelta(t.total)} /> },
      { key: 'mpts', label: 'Margin vs last year', num: true, value: (r) => r.mpts, render: (r) => <Delta d={pts(r.mpts)} />, foot: <Delta d={pts(t.total.mpts)} /> },
    )
  }
  cols.push({ key: 'spark', label: 'Monthly profit', sortable: false, value: () => null, render: (r) => <Sparkline s={r.spark} /> })
  return cols
}

const SEARCH = {
  placeholder: 'Search customers, types or teams',
  fields: [(r) => r.customer, (r) => r.customer_type, (r) => r.team],
}

/** Countries page link for a heatmap column, keeping period, as_of, region and product. */
function countryHref(params, country) {
  const q = new URLSearchParams()
  for (const k of ['period', 'as_of', 'region', 'product']) if (params.get(k)) q.set(k, params.get(k))
  q.set('country', country)
  return `/profitability/countries?${q}`
}

function Heatmap({ d, params, onSelect }) {
  const [mode, setMode] = useState('profit')
  const h = heatmap(d, mode)
  return (
    <Panel
      span={12} title="Where top customers make money"
      subtitle="Top 8 customers × top 8 countries by Total Profit in the selected period."
      action={<Segmented label="Show" value={mode} onChange={setMode}
        options={[{ value: 'profit', label: 'Profit' }, { value: 'margin', label: 'Margin' }]} />}
    >
      {h.rows.length === 0 ? <p className="pf-empty">{NO_CUSTOMERS}</p> : (
        <div className="pf-twrap">
          <table className="pf-heat">
            <thead>
              <tr>
                <th scope="col">Customer</th>
                {h.cols.map((c) => (
                  <th key={c.i} scope="col" className="num">
                    {c.other ? c.name : <Link to={countryHref(params, c.name)} title={`Open ${c.name} in Countries`}>{c.name}</Link>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {h.rows.map((r, ri) => (
                <tr key={r.i}>
                  <th scope="row">
                    {r.other ? r.name : <button type="button" className="pf-linkbtn" onClick={() => onSelect(r.name)}>{r.name}</button>}
                  </th>
                  {h.grid[ri].map((c, ci) => (c.empty
                    ? <td key={ci} className="num pf-heat-empty">—</td>
                    : <td key={ci} className="num" title={c.title} style={{ background: c.bg, color: c.light ? '#fff' : undefined }}>{c.text}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function LoadingBody() {
  return (
    <>
      <div className="pf-seclabel">&nbsp;</div>
      <div className="pf-krow">{Array.from({ length: 5 }, (_, i) => <KpiSkeleton key={i} />)}</div>
      <div className="pf-grid">
        <PanelSkeleton span={6} height={480} />
        <PanelSkeleton span={6} height={340} />
        <PanelSkeleton span={12} height={300} />
        <PanelSkeleton span={6} height={340} />
        <PanelSkeleton span={6} height={340} />
        <PanelSkeleton span={12} height={340} />
        <PanelSkeleton span={12} height={420} />
        <PanelSkeleton span={12} height={340} />
        <PanelSkeleton span={12} height={560} />
      </div>
    </>
  )
}

export default function Customers({ res, loading, params, setParam }) {
  const trendRef = useRef(null)
  const d = res?.data
  const scrollToTrend = () => requestAnimationFrame(() => trendRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  const select = useCallback((name) => { setParam('customer', name, null); scrollToTrend() }, [setParam])
  const toggleTeam = (team) => setParam('team', params.get('team') === team ? null : team, null)

  // ?customer= is cleared when that customer has no trips in the filtered data; a customer
  // arriving from another page (e.g. the Executive Summary) scrolls the trend into view once.
  const wanted = params.get('customer')
  const arrived = useRef(false)
  useEffect(() => {
    if (!d) return
    if (wanted && selectedCustomer(d, wanted) !== wanted) setParam('customer', null, null)
    // Instant, after the charts' first layout (a smooth scroll is cancelled by that layout).
    else if (wanted && !arrived.current) setTimeout(() => trendRef.current?.scrollIntoView({ block: 'start' }), 150)
    arrived.current = true
  }, [d, wanted]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return loading ? <LoadingBody /> : null

  const k = kpis(d)
  const t = table(d)
  const empty = t.rows.filter((r) => !r.none).length === 0
  const customer = selectedCustomer(d, wanted)
  const tr = customer ? trend(d, customer) : null
  const top = top15(d)
  const teams = teamBars(d)
  const tt = teamTable(d)
  const par = pareto(d)
  const low = lowestMargin(d)
  const note = (text) => <p className="pf-empty">{text}</p>
  const sectionLabel = `${d.period.label} — total profit by customer`.toUpperCase()

  return (
    <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
      <div className="pf-seclabel">{sectionLabel}</div>
      <div className="pf-krow">
        {k.cards.map((c) => <KpiCard key={c.label} label={c.label} value={c.value} tone={c.tone} sub={c.sub} sub2={c.sub2} />)}
      </div>

      <div className="pf-grid">
        <Panel span={6} title="Top 15 customers by Total Profit" subtitle={empty ? ' ' : top.subtitle}>
          {empty ? note(NO_CUSTOMERS) : <Top15Chart model={top} onSelect={(i) => select(top.rows[i].customer)} />}
        </Panel>
        <Panel span={6} title="Total Profit by team" subtitle={empty ? ' ' : teams.subtitle}>
          {empty ? note(NO_CUSTOMERS) : <Top15Chart model={teams} size="" onSelect={(i) => toggleTeam(teams.rows[i].team)} />}
        </Panel>

        <Panel span={12} title="Teams">
          {empty ? note(NO_CUSTOMERS) : (
            <SortableTable columns={teamColumns(tt)} rows={tt.rows} defaultSort="profit" rowKey={(r) => r.team} pinLast={isUnassigned}
              onRowClick={(r) => toggleTeam(r.team)} selectedKey={params.get('team')} />
          )}
        </Panel>

        <Panel span={6} title="Customer concentration" subtitle="Cumulative share of Total Profit, highest first">
          {par.empty ? note(par.empty) : <ParetoChart model={par} />}
        </Panel>
        <Panel span={6} title="Lowest-margin customers" subtitle="At least $100k revenue in the period">
          {empty ? note(NO_CUSTOMERS) : low.empty ? note(low.empty)
            : <MarginBars model={low} size="" onSelect={(i) => select(low.rows[i].customer)} />}
        </Panel>

        <Panel span={12} title="Monthly profit: new vs existing customers" subtitle="Total Profit by month; a customer counts as new for its first 12 months">
          {empty ? note(NO_CUSTOMERS) : <NewExistingChart model={newExisting(d)} />}
        </Panel>

        <Heatmap d={d} params={params} onSelect={select} />

        <div ref={trendRef} className="s12" style={{ scrollMarginTop: 140 }}>
          <Panel span={12} title={tr ? tr.title : 'Monthly trend'} subtitle={tr ? tr.subtitle : null}>
            {tr ? (
              <>
                <p className="pf-stat">{tr.stat.map(([l, v], i) => <span key={l}>{i > 0 && ' · '}{l} <b>{v}</b></span>)}</p>
                <TrendChart model={tr} />
              </>
            ) : note(NO_CUSTOMERS)}
          </Panel>
        </div>

        <Panel span={12} title="All customers">
          {empty ? note(NO_CUSTOMERS) : (
            <div className="pf-tight"><SortableTable
              columns={customerColumns(t)} rows={t.rows} defaultSort="profit"
              rowKey={(r) => r.customer} pinLast={isNone} search={SEARCH} limit={25}
              onRowClick={(r) => { if (!r.none) select(r.customer) }} selectedKey={customer}
              rowClass={(r) => (r.none ? 'pf-muted-row' : '')}
            /></div>
          )}
        </Panel>
      </div>
    </div>
  )
}
