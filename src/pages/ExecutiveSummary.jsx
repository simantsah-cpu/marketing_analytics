import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler
} from 'chart.js'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import { Line, Bar } from 'react-chartjs-2'
import KPICard from '../components/KPICard'
import ChartCard from '../components/ChartCard'
import ChatPanel from '../components/ChatPanel'
import { getExecutiveSummary } from '../services/data-service'
import { useFilters } from '../context/FiltersContext'
import { useProperty } from '../context/PropertyContext'
import { aggregateTrend, granularityLabel } from '../utils/time-aggregation'
import { getDateRangeLabel } from '../utils/date-ranges'
import DateRangePill from '../components/DateRangePill'


ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler, ChartDataLabels)

const CHART_COLORS = { primary: '#0F5FA6', teal: '#0D8A72', red: '#C0392B', amber: '#D97706', mid: '#1A7FD4', light: '#DBEAFE' }
const GRANULARITIES = ['Day', 'Week', 'Month', 'Quarter', 'Year']

const lineOpts = (label) => ({
  responsive: true, maintainAspectRatio: false,
  spanGaps: false,
  plugins: {
    legend: { display: true, position: 'bottom', align: 'start', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 6, font: { family: 'DM Sans', size: 11 }, padding: 20 } },
    tooltip: { mode: 'index', intersect: false },
    datalabels: { display: false }
  },
  interaction: { mode: 'index', intersect: false },
  scales: {
    x: { grid: { display: false }, ticks: { font: { family: 'DM Sans', size: 11 }, color: '#5A6A7A', maxTicksLimit: 8 } },
    y: { grid: { color: '#F1F5F9' }, border: { display: false }, ticks: { font: { family: 'DM Sans', size: 11 }, color: '#5A6A7A' } },
  },
})

const revenueLineOpts = {
  responsive: true, maintainAspectRatio: false,
  spanGaps: false,
  plugins: {
    legend: { display: true, position: 'bottom', align: 'start', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 6, font: { family: 'DM Sans', size: 11 }, padding: 20 } },
    tooltip: {
      mode: 'index', intersect: false,
      callbacks: {
        label: (ctx) => {
          const val = Number(ctx.raw)
          return ` ${ctx.dataset.label}: £${val.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        }
      }
    },
    datalabels: { display: false }
  },
  interaction: { mode: 'index', intersect: false },
  scales: {
    x: { grid: { display: false }, ticks: { font: { family: 'DM Sans', size: 11 }, color: '#5A6A7A', maxTicksLimit: 8 } },
    y: {
      grid: { color: '#F1F5F9' }, border: { display: false },
      ticks: {
        font: { family: 'DM Sans', size: 11 }, color: '#5A6A7A',
        callback: (v) => v >= 1000 ? `£${Math.round(v / 1000)}K` : `£${v}`
      }
    },
  },
}

const barOpts = (dataArray, formatter = (v) => v) => ({
  responsive: true, maintainAspectRatio: false,
  indexAxis: 'y',
  layout: { padding: { right: 0 } },
  plugins: {
    legend: { display: false },
    datalabels: { display: false },
    tooltip: { enabled: true, mode: 'index', intersect: false }
  },
  scales: {
    x: { display: false, grid: { display: false }, stacked: true, max: Math.max(...dataArray) * 1.05 },
    y: {
      grid: { display: false }, border: { display: false }, stacked: true,
      ticks: { font: { family: 'DM Sans', size: 11 }, color: '#5A6A7A', mirror: false, padding: 8, autoSkip: false },
    },
    y2: {
      position: 'right',
      grid: { display: false }, border: { display: false },
      ticks: {
        font: { family: 'DM Sans', size: 11, weight: 700 }, color: '#0A2540', padding: 8,
        callback: function(value, index) { return formatter(dataArray[index]) }
      }
    }
  },
})


// ── Trend-direction detection ─────────────────────────────────────────────────
function getTrendDirection(trendData) {
  if (!trendData || trendData.length < 4) return { direction: 'stable', pct: 0 }
  const mid   = Math.floor(trendData.length / 2)
  const first = trendData.slice(0, mid)
  const second = trendData.slice(mid)
  const avgFirst  = first.reduce((s, r)  => s + (r.value ?? 0), 0) / first.length
  const avgSecond = second.reduce((s, r) => s + (r.value ?? 0), 0) / second.length
  if (avgFirst === 0) return { direction: 'stable', pct: 0 }
  const pct = ((avgSecond - avgFirst) / avgFirst) * 100
  if (pct < -5) return { direction: 'declining', pct: Math.abs(pct).toFixed(1) }
  if (pct >  5) return { direction: 'rising',    pct: pct.toFixed(1) }
  return { direction: 'stable', pct: 0 }
}

function TrendPill({ trend }) {
  if (trend.direction === 'stable') return null
  const declining = trend.direction === 'declining'
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
      marginBottom: 8, alignSelf: 'flex-start',
      background: declining ? '#FEF3C7' : '#D1FAE5',
      color:      declining ? '#92400E'  : '#065F46',
      border:     `1px solid ${declining ? '#FDE68A' : '#A7F3D0'}`,
    }}>
      {declining
        ? `⚠ Sessions declining — down ${trend.pct}% in second half of period`
        : `↑ Sessions growing — up ${trend.pct}% in second half of period`
      }
    </div>
  )
}

function RevenueTrendPill({ trend }) {
  if (trend.direction === 'stable') return null
  const declining = trend.direction === 'declining'
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
      marginBottom: 8, alignSelf: 'flex-start',
      background: declining ? '#FEF3C7' : '#D1FAE5',
      color:      declining ? '#92400E'  : '#065F46',
      border:     `1px solid ${declining ? '#FDE68A' : '#A7F3D0'}`,
    }}>
      {declining
        ? `⚠ Revenue declining — down ${trend.pct}% in second half of period`
        : `↑ Revenue growing — up ${trend.pct}% in second half of period`
      }
    </div>
  )
}


// ── Component ────────────────────────────────────────────────────────────────

export default function ExecutiveSummary() {
  const { filters } = useFilters()
  const { selectedProperty } = useProperty()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [chat, setChat] = useState({ open: false, title: '' })

  // Per-chart granularity state — independent -> now global
  useEffect(() => {
    setLoading(true)
    getExecutiveSummary(selectedProperty?.ga4_property_id, filters).then(d => {
      setData(d)
      setLoading(false)
    })
  }, [selectedProperty, filters.dateRanges, filters.affiliateFilter, filters.countryFilter, filters.deviceFilter])

  // ── Aggregate by chosen granularity (must be before any conditional returns) ──
  const sessionsAgg = useMemo(
    () => aggregateTrend(data?.sessionsTrend ?? [], filters.granularity),
    [data, filters.granularity]
  )
  const revenueAgg = useMemo(
    () => aggregateTrend(data?.revenueTrend ?? [], filters.granularity),
    [data, filters.granularity]
  )

  if (loading && !data) return <PageSkeleton />

  const { kpis, topBySession, topByConv } = data
  const comparison = filters.comparison // 'off' | 'prevPeriod' | 'prevYear'
  const showComparison = comparison !== 'off'
  const compLabel = comparison === 'prevYear' ? 'vs Last Year' : 'vs Prev Period'
  const getLabel = (a) => {
    const raw = filters.groupBy === 'promotion_method' ? a.promotionMethod : a.name
    const name = raw || a.affiliateId || 'Unknown'
    // Normalize the raw 'awin' source ID to its display name
    if (String(a.affiliateId || '').toLowerCase() === 'awin') return 'awin (bulk)'
    return name
  }

  // sessionsAgg / revenueAgg already computed above via useMemo

  // ── Build chart datasets ──
  const sessionsChartData = {
    labels: sessionsAgg.map(r => granularityLabel(r.key, filters.granularity)),
    datasets: [
      {
        label: 'Sessions 2026',
        data: sessionsAgg.map(r => Math.floor(r.value)),
        borderColor: CHART_COLORS.primary,
        backgroundColor: 'rgba(15,95,166,0.08)',
        fill: true, tension: 0.4, borderWidth: 2,
        pointRadius: 4, pointBackgroundColor: CHART_COLORS.primary, pointBorderColor: '#fff', pointBorderWidth: 1
      },
      ...(showComparison ? [{
        label: compLabel,
        data: sessionsAgg.map(r => Math.floor(r.prev_value)),
        borderColor: '#CBD5E1', borderDash: [5, 5],
        backgroundColor: 'transparent',
        fill: false, tension: 0.4, borderWidth: 2,
        pointRadius: 0, pointHoverRadius: 0
      }] : []),
    ],
  }

  const revenueChartData = {
    labels: revenueAgg.map(r => granularityLabel(r.key, filters.granularity)),
    datasets: [
      {
        label: 'Revenue 2026',
        data: revenueAgg.map(r => r.value.toFixed(2)),
        borderColor: CHART_COLORS.teal,
        backgroundColor: 'rgba(13,138,114,0.08)',
        fill: true, tension: 0.4, borderWidth: 2,
        pointRadius: 4, pointBackgroundColor: CHART_COLORS.teal, pointBorderColor: '#fff', pointBorderWidth: 1
      },
      ...(showComparison ? [{
        label: compLabel,
        data: revenueAgg.map(r => r.prev_value.toFixed(2)),
        borderColor: '#CBD5E1', borderDash: [5, 5],
        backgroundColor: 'transparent',
        fill: false, tension: 0.4, borderWidth: 2,
        pointRadius: 0, pointHoverRadius: 0
      }] : []),
    ],
  }

  const wrapLabel = (label, maxLen = 18) => {
    if (!label) return label
    if (label.length <= maxLen) return label
    const words = String(label).split(' ')
    const lines = []
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (candidate.length <= maxLen) { line = candidate }
      else { if (line) lines.push(line); line = word }
    }
    if (line) lines.push(line)
    return lines.length > 1 ? lines : label
  }

  const isPromoGroup = filters.groupBy === 'promotion_method'

  // Helper: aggregate affiliates by the active groupBy dimension
  const aggregateByGroup = (rows) => {
    if (!isPromoGroup) return rows
    const map = {}
    rows.forEach(a => {
      const key = a.promotionMethod || 'N/A'
      if (!map[key]) {
        map[key] = { groupLabel: key, revenue: 0, sessions: 0, bookings: 0 }
      }
      map[key].revenue  += a.revenue  || 0
      map[key].sessions += a.sessions || 0
      map[key].bookings += a.bookings || 0
    })
    return Object.values(map).map(g => ({
      ...g,
      // convRate as weighted average: totalBookings / totalSessions
      convRate: g.sessions > 0 ? g.bookings / g.sessions : 0,
      name: g.groupLabel,
      promotionMethod: g.groupLabel,
    }))
  }

  const allAffiliates = data?.affiliates ?? []
  const groupedAffiliates = aggregateByGroup(allAffiliates)

  // Bar chart: top by revenue — grouped when Promo Method active
  const topByRevenue = [...groupedAffiliates]
    .sort((a, b) => b.revenue - a.revenue)
    .filter(a => a.revenue > 0)
    .slice(0, 10)

  const revenueBarLabels = topByRevenue.map(a =>
    wrapLabel(isPromoGroup ? (a.promotionMethod || 'N/A') : getLabel(a))
  )

  const revenueBarData = {
    labels: revenueBarLabels,
    datasets: [{
      data: topByRevenue.map(a => a.revenue),
      backgroundColor: '#0D8A72',
      borderRadius: 4,
      barThickness: 16,
    }],
  }

  // Bar chart: top by conv rate — grouped when Promo Method active
  const topByConvGrouped = [...groupedAffiliates]
    .filter(a => a.convRate > 0)
    .sort((a, b) => b.convRate - a.convRate)
    .slice(0, 10)

  const convBarLabels = topByConvGrouped.map(a =>
    wrapLabel(isPromoGroup ? (a.promotionMethod || 'N/A') : getLabel(a))
  )

  const convBarData = {
    labels: convBarLabels,
    datasets: [{
      data: topByConvGrouped.map(a => (a.convRate * 100).toFixed(2)),
      backgroundColor: '#359C86',
      borderRadius: 4,
      barThickness: 16,
    }],
  }

  const barChartTitle = isPromoGroup
    ? { revenue: 'Revenue by Promo Method', conv: 'Conv. Rate by Promo Method' }
    : { revenue: 'Top 10 Affiliates by Revenue', conv: 'Top 10 Affiliates by Conv. Rate' }

  // Helpers for pill indicators that need trend history
  const sessionsTrend = getTrendDirection(sessionsAgg)
  const revenueTrend  = getTrendDirection(revenueAgg)
  const dateRangeLabel = getDateRangeLabel(filters)

  return (
    <>
      <div className="page-content fade-in">

        {/* Date range context */}
        <DateRangePill dateRanges={filters.dateRanges} comparison={filters.comparison} />

        {/* KPI row — suppress delta badge when comparison is off */}
        <div className="kpi-row kpi-row-5">
          <KPICard label="Total Sessions"     value={kpis.sessions.value}  prev={showComparison ? kpis.sessions.prev  : null} format="number"           primary={true} sub="Sessions from affiliate channels" />
          <KPICard label="Transactions"       value={kpis.bookings.value}  prev={showComparison ? kpis.bookings.prev  : null} format="number"            sub="Confirmed bookings" />
          <KPICard label="Purchase Revenue"   value={kpis.revenue.value}   prev={showComparison ? kpis.revenue.prev   : null} format="currency"          sub="Total booking value (TTV)" />
          <KPICard label="Session Conv. Rate" value={kpis.convRate.value}  prev={showComparison ? kpis.convRate.prev  : null} format="percent"           sub="Bookings ÷ Sessions" />
          <KPICard label="Avg Order Value"    value={kpis.aov?.value}      prev={showComparison ? kpis.aov?.prev     : null} format="currency-decimal" decimals={2} sub="Revenue ÷ Bookings" />
        </div>

        {/* Charts row 1 — trend charts with granularity switcher */}
        <div className="chart-row chart-row-2">
          <ChartCard
            title="Sessions Trend"
            subtitle={`${dateRangeLabel} · ${filters.granularity.charAt(0).toUpperCase() + filters.granularity.slice(1)} view`}
            tag="TRAFFIC"
            showGranularity={true}
          >
            <div style={{ height: 380 }}>
              <Line data={sessionsChartData} options={lineOpts('Sessions')} />
            </div>
          </ChartCard>

          <ChartCard
            title="Revenue Trend"
            subtitle={`${dateRangeLabel} · ${filters.granularity.charAt(0).toUpperCase() + filters.granularity.slice(1)} view`}
            tag="REVENUE"
            showGranularity={true}
          >
            <div style={{ height: 380 }}>
              <Line data={revenueChartData} options={revenueLineOpts} />
            </div>
          </ChartCard>
        </div>

        {/* Charts row 2 — bar charts */}
        <div className="chart-row chart-row-2">
          <ChartCard title={barChartTitle.revenue} subtitle="Ranked by total purchase revenue (£) in period" tag="REVENUE">
            <div style={{ height: 380 }}>
              <Bar data={revenueBarData} options={barOpts(topByRevenue.map(a => a.revenue), v => v >= 1000 ? `£${(v / 1000).toFixed(1)}K` : `£${v}`)} />
            </div>
          </ChartCard>
          <ChartCard title={barChartTitle.conv} subtitle="Sessions → Bookings conversion %" tag="QUALITY">
            <div style={{ height: 380 }}>
              <Bar data={convBarData} options={barOpts(topByConvGrouped.map(a => (a.convRate * 100).toFixed(2)), v => `${v}%`)} />
            </div>
          </ChartCard>
        </div>

      </div>
    </>
  )
}

function PageSkeleton() {
  return (
    <div className="page-content">
      <div className="kpi-row kpi-row-4">
        {[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ height: 110, borderRadius: 12 }} />)}
      </div>
      <div className="chart-row chart-row-2">
        {[...Array(2)].map((_, i) => <div key={i} className="skeleton" style={{ height: 240, borderRadius: 12 }} />)}
      </div>
      <div className="chart-row chart-row-2">
        {[...Array(2)].map((_, i) => <div key={i} className="skeleton" style={{ height: 320, borderRadius: 12 }} />)}
      </div>
    </div>
  )
}
