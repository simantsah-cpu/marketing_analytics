// Profitability → Executive Summary.
// Every number comes from the `profitability` edge function payload for one pinned as_of.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  header, kpiRow1, kpiRow2, mtdPanel, breakdownTable, monthlyProductChart, monthlyRegionChart, moversChart,
  NO_COMPARISON, PRODUCT_LINE_COLORS, REGION_COLORS,
} from './model.js'
import { tableMoney, pct, count, signedPct, pts } from './format.js'
import {
  KpiCard, Panel, Segmented, Swatch, SortableTable, Delta, KpiSkeleton, PanelSkeleton,
} from './components.jsx'
import { MonthlyProductChart, RegionTrendChart, MoversChart } from './charts.jsx'

const money = (v) => <span className={v < 0 ? 'pf-neg' : ''}>{tableMoney(v)}</span>

function breakdownColumns(t, nameLabel) {
  const cols = [
    { key: 'name', label: nameLabel, value: (r) => r.name, render: (r) => <><Swatch color={r.color} />{r.name}</>, foot: 'Total' },
    { key: 'trips', label: 'Trips', num: true, value: (r) => r.trips, render: (r) => count(r.trips), foot: count(t.total.trips) },
    { key: 'revenue', label: 'Revenue', num: true, value: (r) => r.revenue, render: (r) => money(r.revenue), foot: tableMoney(t.total.revenue) },
    { key: 'cost', label: 'Cost', num: true, value: (r) => r.cost, render: (r) => money(r.cost), foot: tableMoney(t.total.cost) },
    { key: 'profit', label: 'Profit', num: true, value: (r) => r.profit, render: (r) => <b>{money(r.profit)}</b>, foot: tableMoney(t.total.profit) },
    { key: 'margin', label: 'Margin', num: true, value: (r) => r.margin, render: (r) => <span className={r.margin < 0 ? 'pf-neg' : ''}>{pct(r.margin)}</span>, foot: pct(t.total.margin) },
    { key: 'share', label: 'Share of profit', num: true, value: (r) => r.share, render: (r) => pct(r.share), foot: pct(t.total.share) },
  ]
  if (t.showYoy) {
    cols.push({ key: 'yoy', label: 'Profit vs last year', num: true, value: (r) => r.yoy, render: (r) => <Delta d={signedPct(r.yoy)} />, foot: <Delta d={signedPct(t.total.yoy)} /> })
  }
  if (t.showMarginVsLy) {
    cols.push({ key: 'mpts', label: 'Margin vs last year', num: true, value: (r) => r.mpts, render: (r) => <Delta d={pts(r.mpts)} />, foot: <Delta d={pts(t.total.mpts)} /> })
  }
  return cols
}

function MtdTable({ m }) {
  if (!m.rows.length) return <p className="pf-empty">{m.subtitle}</p>
  const sub = (d, prefix = '') => <small>{prefix}<Delta d={d} /></small>
  return (
    <>
      <div className="pf-twrap">
        <table className="pf-mtd">
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col" className="num">Profit</th>
              <th scope="col" className="num">Revenue</th>
              <th scope="col" className="num">Margin</th>
              <th scope="col" className="num">Trips</th>
            </tr>
          </thead>
          <tbody>
            {m.rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.label}<small>{r.range}</small></th>
                <td className="num"><b>{r.profit}</b>{r.vs && sub(r.vs.profit, 'This month ')}</td>
                <td className="num">{r.revenue}{r.vs && sub(r.vs.revenue)}</td>
                <td className="num">{r.margin}{r.vs && sub(r.vs.margin)}</td>
                <td className="num">{r.trips}{r.vs && sub(r.vs.trips)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pf-note">{m.note}</p>
    </>
  )
}

function LoadingBody() {
  return (
    <>
      <div className="pf-seclabel">&nbsp;</div>
      <div className="pf-krow">{Array.from({ length: 5 }, (_, i) => <KpiSkeleton key={i} />)}</div>
      <div className="pf-krow k4">{Array.from({ length: 4 }, (_, i) => <KpiSkeleton key={i} />)}</div>
      <div className="pf-grid">
        <PanelSkeleton span={12} height={400} />
        <PanelSkeleton span={5} height={260} />
        <PanelSkeleton span={7} height={260} />
        <PanelSkeleton span={12} height={300} />
        <PanelSkeleton span={6} height={340} />
        <PanelSkeleton span={6} height={340} />
      </div>
    </>
  )
}

export default function ExecutiveSummary({ res, loading, params }) {
  const [dim, setDim] = useState('country')
  const navigate = useNavigate()
  // A customer bar opens Customers with that customer selected, keeping period and as_of.
  const openCustomer = (row) => {
    const q = new URLSearchParams()
    for (const k of ['period', 'as_of']) if (params?.get(k)) q.set(k, params.get(k))
    q.set('customer', row.name)
    navigate(`/profitability/customers?${q}`)
  }
  const d = res?.data
  if (!d) return loading ? <LoadingBody /> : null

  const h = header(d)
  const row2 = kpiRow2(d)
  const monthly = monthlyProductChart(d)
  const pl = breakdownTable(d, d.by_pl, { colors: PRODUCT_LINE_COLORS })
  const rg = breakdownTable(d, d.by_region, { colors: REGION_COLORS, marginVsLy: true })
  const mv = moversChart(d, dim)
  const mtd = mtdPanel(d)

  return (
    <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
      <div className="pf-seclabel">{h.sectionLabel}</div>
      <div className="pf-krow">
        {kpiRow1(d).map((c) => <KpiCard key={c.label} {...c} noComparison={NO_COMPARISON} />)}
      </div>
      {row2.length > 0 && (
        <div className="pf-krow k4">
          {row2.map((c) => <KpiCard key={c.label} label={c.label} value={c.value} tone={c.tone} sub={c.sub} />)}
        </div>
      )}

      <div className="pf-grid">
        <Panel span={12} title="Total Profit by month and product line" subtitle={monthly.subtitle}>
          {monthly.labels.length ? <MonthlyProductChart model={monthly} /> : <p className="pf-empty">No trips in this period.</p>}
        </Panel>

        <Panel span={5} title="This month so far" subtitle={mtd.rows.length ? mtd.subtitle : ''}>
          <MtdTable m={mtd} />
        </Panel>

        <Panel span={7} title="Total Profit by product line" subtitle="Selected period">
          <SortableTable columns={breakdownColumns(pl, 'Product line')} rows={pl.rows} defaultSort="profit" />
        </Panel>

        <Panel span={12} title="Total Profit by region" subtitle="Selected period">
          <SortableTable columns={breakdownColumns(rg, 'Region')} rows={rg.rows} defaultSort="profit" />
        </Panel>

        <Panel span={6} title="Total Profit by region and month" subtitle="Monthly profit trend">
          <RegionTrendChart model={monthlyRegionChart(d)} />
        </Panel>

        <Panel
          span={6}
          title="Biggest changes in Total Profit"
          action={<Segmented label="Show changes by" value={dim} onChange={setDim}
            options={[{ value: 'country', label: 'Countries' }, { value: 'customer', label: 'Customers' }]} />}
          subtitle={mv.subtitle}
        >
          {mv.empty ? <p className="pf-empty">{mv.empty}</p> : <MoversChart rows={mv.rows} onSelect={dim === 'customer' ? openCustomer : undefined} />}
        </Panel>
      </div>
    </div>
  )
}
