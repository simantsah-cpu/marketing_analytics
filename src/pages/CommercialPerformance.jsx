import { useState, useEffect, useMemo } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler
} from 'chart.js'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import { Line, Bar, Doughnut } from 'react-chartjs-2'
import KPICard from '../components/KPICard'
import ChartCard from '../components/ChartCard'
import Leaderboard from '../components/Leaderboard'
import { getCommercialPerformance } from '../services/data-service'
import { useFilters } from '../context/FiltersContext'
import { useProperty } from '../context/PropertyContext'
import { aggregateTrend, granularityLabel } from '../utils/time-aggregation'
import DateRangePill from '../components/DateRangePill'


ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler, ChartDataLabels)


const baseLineOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: { 
    tooltip: { mode: 'index', intersect: false },
    legend: { display: false },
    datalabels: { display: false }
  },
  interaction: { mode: 'index', intersect: false },
  scales: {
    x: { grid: { display: false }, border: { display: false }, ticks: { font: { family: 'DM Sans', size: 11 }, color: '#5A6A7A', padding: 8 } },
    y: { 
      grid: { color: '#E2EAF0', drawBorder: false, borderDash: [4, 4] }, border: { display: false }, 
      ticks: { 
        font: { family: 'DM Sans', size: 9 }, color: '#5A6A7A', maxTicksLimit: 10, padding: 12,
        callback: v => `${parseFloat(Number(v).toFixed(2))}%`
      }
    },
  },
}



// Options for the Trend Charts (with rotated X labels & no datalabels)
const trendChartOpts = {
  ...baseLineOpts,
  layout: { padding: { bottom: 20 } },
  scales: {
    ...baseLineOpts.scales,
    x: { 
      grid: { display: false }, 
      border: { display: false }, 
      ticks: { 
        font: { family: 'DM Sans', size: 10 }, 
        color: '#5A6A7A', 
        padding: 8,
        maxRotation: 45,
        minRotation: 45,
        maxTicksLimit: 10
      } 
    }
  }
}

const revBookingOpts = {
  ...trendChartOpts,
  plugins: {
    ...trendChartOpts.plugins,
    legend: { display: true, position: 'bottom', align: 'start', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 6, font: { family: 'DM Sans', size: 11 }, padding: 20 } },
  },
  scales: {
    ...trendChartOpts.scales,
    y: {
      position: 'left',
      grid: { color: '#E2EAF0', borderDash: [4, 4] }, border: { display: false },
      ticks: { font: { family: 'DM Sans', size: 11 }, color: '#5A6A7A', maxTicksLimit: 6, padding: 12,
        callback: v => `£${parseFloat((Math.round(v / 100) * 100 / 1000).toFixed(1))}K` },
    },
    y1: {
      type: 'linear',
      display: true,
      position: 'right',
      min: 0,
      grid: { drawOnChartArea: false },
      border: { display: false },
      ticks: { font: { family: 'DM Sans', size: 11 }, color: '#1A7FD4', maxTicksLimit: 6 }
    }
  }
}

const hBarOpts = (dataArray, formatter = (v) => v) => ({
  responsive: true, maintainAspectRatio: false,
  indexAxis: 'y',
  layout: { padding: { right: 0 } },
  plugins: { 
    legend: { display: false },
    datalabels: { display: false },
    tooltip: { enabled: true, mode: 'index', intersect: false }
  },
  scales: {
    x: { display: false, grid: { display: false }, stacked: false, max: Math.max(...dataArray) * 1.15 },
    y: { 
      grid: { display: false }, border: { display: false }, stacked: false,
      ticks: { font: { family: 'DM Sans', size: 11 }, color: '#5A6A7A', mirror: false, padding: 8 },
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

export default function CommercialPerformance() {
  const { filters } = useFilters()
  const { selectedProperty } = useProperty()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getCommercialPerformance(selectedProperty?.ga4_property_id, filters).then(d => {
      setData(d)
      setLoading(false)
    })
  }, [selectedProperty, filters.dateRanges, filters.affiliateFilter, filters.countryFilter, filters.deviceFilter])

  const convTrend        = data?.convTrend
  const dailyRevenue     = data?.dailyRevenue
  const prevDailyRevenue = data?.prevDailyRevenue
  const dailyBookings    = data?.dailyBookings

  const aggConvTrend = useMemo(() => {
    return aggregateTrend(convTrend || [], filters.granularity).map(b => ({
      key: b.key,
      value: b.sessions > 0 ? parseFloat(((b.transactions / b.sessions) * 100).toFixed(2)) : 0,
      prevValue: b.prevSessions > 0 ? parseFloat(((b.prevTransactions / b.prevSessions) * 100).toFixed(2)) : 0
    }))
  }, [convTrend, filters.granularity])

  const aggDailyRevenue = useMemo(() => aggregateTrend(dailyRevenue || [], filters.granularity), [dailyRevenue, filters.granularity])
  const aggDailyBookings = useMemo(() => aggregateTrend(dailyBookings || [], filters.granularity), [dailyBookings, filters.granularity])
  const affiliates = data?.affiliates || []
  const isPromo = filters.groupBy === 'promotion_method'
  
  const displayAffiliates = useMemo(() => {
    let arr = [...affiliates]
    if (isPromo) {
      const groups = {}
      arr.forEach(a => {
        const key = a.promotionMethod || 'N/A'
        if (!groups[key]) {
          groups[key] = { 
            ...a, affiliateId: key, name: key, promotionMethod: key,
            sessions: 0, bookings: 0, revenue: 0,
            prevSessions: 0, prevBookings: 0, prevRevenue: 0,
          }
        }
        const g = groups[key]
        g.sessions += a.sessions || 0
        g.bookings += a.bookings || 0
        g.revenue += a.revenue || 0
        g.prevSessions += a.prevSessions || 0
        g.prevBookings += a.prevBookings || 0
        g.prevRevenue += a.prevRevenue || 0
      })
      arr = Object.values(groups).map(g => {
        g.convRate = g.sessions > 0 ? g.bookings / g.sessions : 0
        g.aov = g.bookings > 0 ? g.revenue / g.bookings : 0
        g.prevConvRate = g.prevSessions > 0 ? g.prevBookings / g.prevSessions : 0
        g.prevAov = g.prevBookings > 0 ? g.prevRevenue / g.prevBookings : 0
        g.wowRevenue = g.prevRevenue > 0 ? (g.revenue - g.prevRevenue) / g.prevRevenue : (g.revenue > 0 ? 1 : 0)
        return g
      })
    }
    return arr.map(a => ({
      ...a,
      name: isPromo ? (a.promotionMethod || 'N/A') : (a.name ?? a.affiliateId),
      revenuePerSession: a.sessions > 0 ? a.revenue / a.sessions : 0
    }))
  }, [affiliates, isPromo])

  if (loading && !data) return <PageSkeleton />

  const { kpis, byConvRate: rawConv, byAov: rawAov, totals, prevTotals } = data

  // Use 'MMM d' format for X-axis labels (e.g. "Feb 26")
  const formatXLabel = (dateStr) => {
    if (!dateStr) return ''
    const year = dateStr.slice(0, 4)
    const month = dateStr.slice(5, 7) - 1
    const day = dateStr.slice(8, 10)
    const d = new Date(year, month, day)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const convTrendData = {
    labels: aggConvTrend.map(d => formatXLabel(d.key)),
    datasets: [
      {
        label: 'Conv. Rate',
        data: aggConvTrend.map(d => d.value),
        borderColor: '#0D8A72',
        backgroundColor: 'transparent',
        fill: false, tension: 0.4, borderWidth: 2,
        pointRadius: 4, pointBackgroundColor: '#0D8A72', pointBorderColor: '#fff', pointBorderWidth: 2, pointHoverRadius: 6
      }
    ]
  }

  // Revenue & Bookings dual-axis line chart (solid lines only)
  const revBookingData = {
    labels: aggDailyRevenue.map(d => formatXLabel(d.key)),
    datasets: [
      {
        label: 'Revenue (£)',
        data: aggDailyRevenue.map(d => d.revenue),
        borderColor: '#0D8A72',
        backgroundColor: 'rgba(13,138,114,0.07)',
        fill: true, tension: 0.4, borderWidth: 2,
        yAxisID: 'y',
        pointRadius: 3, pointBackgroundColor: '#0D8A72', pointBorderColor: '#fff', pointBorderWidth: 1,
      },
      {
        label: 'Bookings',
        data: aggDailyBookings.map(d => d.bookings),
        borderColor: '#1A7FD4',
        backgroundColor: 'transparent',
        fill: false, tension: 0.4, borderWidth: 2,
        yAxisID: 'y1',
        pointRadius: 3, pointBackgroundColor: '#1A7FD4', pointBorderColor: '#fff', pointBorderWidth: 1,
      }
    ],
  }


  // If grouping by promo, use the aggregated array to find top 8, otherwise fall back to raw API results
  const arrForTop = isPromo ? displayAffiliates.filter(a => a.sessions >= 1) : rawConv || []
  const arrForAov = isPromo ? displayAffiliates.filter(a => a.bookings >= 1) : rawAov || []

  const top8ByConvDesc = [...arrForTop].sort((a, b) => (b.convRate || 0) - (a.convRate || 0)).slice(0, 8)
  const top8ByAovDesc = [...arrForAov].sort((a, b) => (b.aov || 0) - (a.aov || 0)).slice(0, 8)

  const convRateBarData = {
    labels: top8ByConvDesc.map(a => a.name),
    datasets: [{
      data: top8ByConvDesc.map(a => ((a.convRate || 0) * 100).toFixed(1)),
      backgroundColor: '#359C86',
      borderRadius: 4,
    }]
  }

  const aovBarData = {
    labels: top8ByAovDesc.map(a => a.name),
    datasets: [{
      data: top8ByAovDesc.map(a => (a.aov || 0).toFixed(2)),
      backgroundColor: '#D97706',
      borderRadius: 4,
    }]
  }

  const leaderboardCols = [
    { key: 'sessions', label: 'SESSIONS' },
    { key: 'bookings', label: 'BOOKINGS' },
    { key: 'revenue', label: 'REVENUE', format: 'revenue' },
    { key: 'convRate', label: 'CONV. RATE', format: 'convRate' },
    { key: 'aov', label: 'AOV', format: 'aov' },
    { key: 'revenuePerSession', label: 'REV/SESSION', format: 'aov' },
  ]

  const chartTitleConv = isPromo ? "Conversion Rate by Promo Method" : "Conversion Rate by Affiliate"
  const chartTitleAov = isPromo ? "AOV by Promo Method" : "AOV by Affiliate"
  const leaderLabel = isPromo ? "Sorted by Revenue · Full promo method breakdown" : "Sorted by Revenue · Full affiliate breakdown"

  return (
    <div className="page-content fade-in">
      {/* Date range context */}
      <DateRangePill dateRanges={filters.dateRanges} comparison={filters.comparison} />

      <div className="kpi-row kpi-row-4">
        <KPICard label="PURCHASE REVENUE (TTV)" value={kpis.revenue.value} prev={kpis.revenue.prev} format="currency-compact" primary={true} />
        <KPICard label="TRANSACTIONS" value={kpis.bookings.value} prev={kpis.bookings.prev} format="number" sub="Completed bookings" />
        <KPICard label="SESSION CONV. RATE" value={kpis.convRate.value} prev={kpis.convRate.prev} format="percent" sub="Bookings ÷ Sessions" decimals={2} />
        <KPICard label="AVG ORDER VALUE" value={kpis.aov.value} prev={kpis.aov.prev} format="currency-decimal" sub="Revenue ÷ Transactions" />
      </div>

      <div className="chart-row chart-row-2">
        <ChartCard title="Conversion Rate Trend" subtitle="Daily conv. rate progression" tag="CONVERSION" showGranularity={true}>
          <div style={{ height: 350, paddingTop: 10 }}>
            <Line data={convTrendData} options={trendChartOpts} />
          </div>
        </ChartCard>
        
        <ChartCard title="Revenue &amp; Bookings Trend" subtitle="Purchase revenue (£) and completed bookings" tag="REVENUE" showGranularity={true}>
          <div style={{ height: 350, paddingTop: 10 }}>
            <Line data={revBookingData} options={revBookingOpts} />
          </div>
        </ChartCard>
      </div>

      <div className="chart-row chart-row-2">
        <ChartCard title={chartTitleConv} subtitle="Quality ranking - best converters" tag="QUALITY">
          <div style={{ height: 300, paddingTop: 10 }}>
            <Bar data={convRateBarData} options={hBarOpts(convRateBarData.datasets[0].data, v => `${v}%`)} />
          </div>
        </ChartCard>

        <ChartCard title={chartTitleAov} subtitle="Average booking value (£)" tag="VALUE">
          <div style={{ height: 300, paddingTop: 10 }}>
            <Bar data={aovBarData} options={hBarOpts(aovBarData.datasets[0].data, v => `£${Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)} />
          </div>
        </ChartCard>
      </div>

      {/* Revenue by Affiliate / Promo Method donut + Concentration list */}
      {(() => {
        const COLORS = ['#0F5FA6','#0D8A72','#D97706','#7C3AED','#C0392B','#64748B']

        // Build revenue split from the already-grouped displayAffiliates
        // so it respects the affiliate / promo-method toggle automatically.
        const eligible = displayAffiliates.filter(a => a.revenue > 0)
        const sorted   = [...eligible].sort((a, b) => b.revenue - a.revenue)
        const top5     = sorted.slice(0, 5)
        const otherRev = sorted.slice(5).reduce((s, a) => s + a.revenue, 0)

        const revSplit = [
          ...top5.map(a => ({
            label: isPromo ? (a.promotionMethod || a.name || a.affiliateId) : (a.name || a.affiliateId),
            value: a.revenue,
          })),
          ...(otherRev > 0 ? [{ label: 'Other', value: otherRev }] : []),
        ]

        const totalRev = revSplit.reduce((s, d) => s + d.value, 0) || 1

        const donutData = {
          labels: revSplit.map(d => d.label),
          datasets: [{ data: revSplit.map(d => d.value), backgroundColor: COLORS, borderWidth: 2, borderColor: '#fff' }]
        }
        const donutOpts = {
          responsive: true, maintainAspectRatio: false, cutout: '68%',
          plugins: {
            legend: { display: true, position: 'right', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 7, font: { family: 'DM Sans', size: 11 }, padding: 12 } },
            datalabels: { display: false },
            tooltip: { callbacks: { label: ctx => ` £${Number(ctx.raw).toLocaleString('en-GB', { maximumFractionDigits: 0 })} (${((ctx.raw / totalRev)*100).toFixed(1)}%)` } }
          }
        }

        return (
          <div className="chart-row chart-row-2" style={{ marginTop: 20 }}>
            <ChartCard
              title={isPromo ? 'Revenue by Promo Method' : 'Revenue by Affiliate'}
              subtitle={isPromo ? 'Revenue share by promotion method in period' : 'Revenue share by affiliate in period'}
              tag="REVENUE"
            >
              <div style={{ height: 260, paddingTop: 10, position: 'relative' }}>
                <Doughnut data={donutData} options={donutOpts} />
                <div style={{ position: 'absolute', top: '50%', left: '39%', transform: 'translate(-50%,-50%)', textAlign: 'center', pointerEvents: 'none' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#0A2540' }}>£{Math.round(totalRev / 1000)}K</div>
                  <div style={{ fontSize: 10, color: '#64748B' }}>Total</div>
                </div>
              </div>
            </ChartCard>

            <ChartCard
              title={isPromo ? 'Revenue Concentration by Promo Method' : 'Revenue Concentration'}
              subtitle="Channel revenue distribution"
              tag="INSIGHT"
            >
              <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {revSplit.filter(d => d.value > 0).map((d, i) => (
                  <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS[i] || '#CBD5E1', flexShrink: 0 }} />
                    <div style={{ fontSize: 12, color: '#0A2540', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#0A2540' }}>£{Number(d.value).toLocaleString('en-GB', { maximumFractionDigits: 0 })}</div>
                    <div style={{ fontSize: 11, color: '#64748B', width: 42, textAlign: 'right' }}>{((d.value / totalRev) * 100).toFixed(1)}%</div>
                  </div>
                ))}
              </div>
            </ChartCard>
          </div>
        )
      })()}

      <div className="chart-row-1">
        <div className="chart-card">
          <div className="chart-header">
            <div>
              <div className="chart-title">Commercial Leaderboard</div>
              <div className="chart-sub">{leaderLabel}</div>
            </div>
            <span className="chart-tag">FULL TABLE</span>
          </div>

          <Leaderboard data={displayAffiliates.filter(a => (a.sessions ?? 0) > 0)} columns={leaderboardCols} showHealth={true} showDeltas={filters.comparison !== 'off'} totals={totals} prevTotals={prevTotals} defaultSortKey="revenue" isPromo={isPromo} />
          
          {(() => {
            const active = affiliates.filter(a => a.sessions > 0)
            const channelAvg = active.length > 0
              ? active.reduce((s, a) => s + a.convRate, 0) / active.length
              : 0
            const top2 = [...active]
              .sort((a, b) => b.convRate - a.convRate)
              .slice(0, 2)
            if (!top2.length) return null
            const label = a => a.name ?? a.affiliateId
            const avgPct = (channelAvg * 100).toFixed(2)
            const direction = top2[0].convRate > channelAvg ? 'above' : 'below'
            let insightText
            if (top2.length === 1) {
              insightText = `${label(top2[0])} is your highest-converting affiliate with a conv. rate of ${(top2[0].convRate * 100).toFixed(2)}% — ${direction} the channel average of ${avgPct}%.`
            } else {
              insightText = `${label(top2[0])} and ${label(top2[1])} are your highest-converting affiliates with conv. rates of ${(top2[0].convRate * 100).toFixed(2)}% and ${(top2[1].convRate * 100).toFixed(2)}% respectively — ${direction} the channel average of ${avgPct}%.`
            }
            return (
              <div style={{ marginTop: 24, padding: 16, background: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ fontSize: 16 }}>💡</div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#0F5FA6', marginBottom: 4 }}>Key Insight</div>
                  <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.5 }}>{insightText}</div>
                </div>
              </div>
            )
          })()}

        </div>
      </div>
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="page-content">
      <div className="kpi-row kpi-row-4">
        {[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ height: 110, borderRadius: 12 }} />)}
      </div>
      <div className="chart-row chart-row-2">
        {[...Array(2)].map((_, i) => <div key={i} className="skeleton" style={{ height: 350, borderRadius: 12 }} />)}
      </div>
      <div className="chart-row chart-row-2">
        {[...Array(2)].map((_, i) => <div key={i} className="skeleton" style={{ height: 300, borderRadius: 12 }} />)}
      </div>
      <div className="chart-row-1">
        <div className="skeleton" style={{ height: 400, borderRadius: 12 }} />
      </div>
    </div>
  )
}
