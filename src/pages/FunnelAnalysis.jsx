import { useState, useEffect, useMemo } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler
} from 'chart.js'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import { Line, Bar } from 'react-chartjs-2'
import KPICard from '../components/KPICard'
import ChartCard from '../components/ChartCard'
import { getFunnelAnalysis, getSiteWideFunnel, getAffiliateScorecard } from '../services/data-service'
import { useFilters } from '../context/FiltersContext'
import { useProperty } from '../context/PropertyContext'
import { format, parseISO } from 'date-fns'
import { aggregateTrend, granularityLabel } from '../utils/time-aggregation'
import { resolveAffiliateName, resolvePromotionMethod } from '../utils/affiliate-map'
import DateRangePill from '../components/DateRangePill'


ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler, ChartDataLabels)

const LINE_COLORS = ['#1E88E5', '#0D8A72', '#D97706']

const indexedLineOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: { 
    tooltip: {
      mode: 'index', intersect: false,
      callbacks: {
        label: (ctx) => ` ${ctx.dataset.label}: ${Number(ctx.raw).toFixed(1)} (index)`,
      }
    },
    legend: { display: true, position: 'bottom', align: 'start', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 6, font: { family: 'DM Sans', size: 11 }, padding: 20 } },
    datalabels: { display: false }
  },
  scales: {
    x: { grid: { display: false }, ticks: { font: { family: 'DM Sans', size: 11 }, color: '#5A6A7A', maxTicksLimit: 6 } },
    y: {
      grid: { color: '#F1F5F9' }, border: { display: false },
      min: 0,
      ticks: { font: { family: 'DM Sans', size: 11 }, color: '#5A6A7A', callback: v => `${parseFloat(Number(v).toFixed(1))}` },
      title: { display: true, text: 'Index (Day 1 = 100)', font: { family: 'DM Sans', size: 11 }, color: '#5A6A7A', padding: { bottom: 6 } },
    },
  },
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

function FunnelVisualization({ steps, comparison, comparisonMode }) {
  if (!steps?.length) return null
  const max = steps[0].value || 1
  const stepColors = ['#1E88E5', '#29B6F6', '#26A69A', '#0D8A72', '#0A6A5A', '#0F2232']
  const hasComp = comparison?.length > 0
  const compMax = hasComp ? comparison[0].value : 1
  const isComparingOverTime = comparisonMode && comparisonMode !== 'off'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 320, justifyContent: 'space-between', padding: '8px 0' }}>
      {steps.map((step, i) => {
        const width = Math.min((step.value / max) * 100, 100)
        const comp  = hasComp ? comparison.find(s => s.label === step.label) : null
        const compWidth = comp ? Math.min((comp.value / compMax) * 100, 100) : 0
        const prevWidth = isComparingOverTime && step.prevValue != null
          ? Math.min((step.prevValue / (steps[0].prevValue || 1)) * 100, 100)
          : 0

        return (
          <div key={step.label} style={{ display: 'flex', alignItems: 'center' }}>
            {/* Row label */}
            <div style={{ width: 140, fontSize: 12, color: '#0A2540', fontWeight: 600, textAlign: 'right', paddingRight: 16, flexShrink: 0 }}>
              {step.label}
            </div>

            {/* Bar area — grows to fill remaining width */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 0 }}>
              {/* Constrained bar container */}
              <div style={{ flex: 1, position: 'relative', height: 32, minWidth: 0 }}>
                {/* Prev-period background */}
                {isComparingOverTime && (
                  <div style={{
                    position: 'absolute', top: 0, left: 0, height: '100%',
                    width: `${Math.max(prevWidth, 5)}%`, background: '#E2EAF0', borderRadius: 4,
                  }} />
                )}
                {/* Coloured bar */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, height: '100%',
                  width: `${Math.max(width, 3)}%`,
                  background: stepColors[i % stepColors.length], borderRadius: 4,
                }} />
              </div>

              {/* Value + pct — outside the bar container, always visible */}
              <div style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#0A2540' }}>
                  {step.value.toLocaleString()}
                </span>
                <span style={{ fontSize: 11, color: '#5A6A7A' }}>
                  {step.pct.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function FunnelAnalysis() {
  const { filters } = useFilters()
  const { selectedProperty } = useProperty()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  // Local device toggle
  const [funnelDevice, setFunnelDevice] = useState('all')
  const [funnelStepsOverride, setFunnelStepsOverride] = useState(null)
  const [funnelLoading, setFunnelLoading] = useState(false)
  // Comparison toggle
  const [compareMode, setCompareMode] = useState('affiliate')
  const [siteSteps, setSiteSteps] = useState(null)
  const [siteLoading, setSiteLoading] = useState(false)

  // Scorecard data strictly for the sessions > 50 threshold constraint
  const [scorecard, setScorecard] = useState(null)

  // Main page fetch
  useEffect(() => {
    setLoading(true)
    getFunnelAnalysis(selectedProperty?.ga4_property_id, filters).then(d => {
      setData(d)
      setFunnelStepsOverride(null) // reset device filter on global filter change
      setFunnelDevice('all')
      setLoading(false)
    })
    
    // Fetch parallel session logic for the proxy sub-network table
    getAffiliateScorecard(selectedProperty?.ga4_property_id, filters)
      .then(res => setScorecard(res.current))
      .catch(() => setScorecard([]))
  }, [selectedProperty, filters.dateRanges, filters.affiliateFilter, filters.countryFilter, filters.deviceFilter])

  // Device-filtered funnel re-fetch
  useEffect(() => {
    if (!data) return
    if (funnelDevice === 'all') { setFunnelStepsOverride(null); return }
    setFunnelLoading(true)
    // Pass as deviceFilter — that's what the edge function reads
    getFunnelAnalysis(selectedProperty?.ga4_property_id, {
      ...filters,
      deviceFilter: funnelDevice,
    }).then(d => {
      setFunnelStepsOverride(d.funnelSteps)
      setFunnelLoading(false)
    })
  }, [funnelDevice]) // eslint-disable-line

  // Comparison mode fetch
  useEffect(() => {
    if (!data) return
    if (compareMode === 'affiliate') { setSiteSteps(null); return }
    setSiteLoading(true)
    getSiteWideFunnel(selectedProperty?.ga4_property_id, filters).then(steps => {
      setSiteSteps(steps)
      setSiteLoading(false)
    })
  }, [compareMode]) // eslint-disable-line

  const funnelTrend = data?.funnelTrend

  const aggFunnelTrend = useMemo(() => {
    return (funnelTrend || []).map(s => ({
      ...s,
      data: aggregateTrend(s.data, filters.granularity)
    }))
  }, [funnelTrend, filters.granularity])

  const affiliateTypeTableData = useMemo(() => {
    const affSessionMap = data?.affiliateSessionMap  // { affiliateId: { beginCheckout, purchases, ... events } }
    const affiliateSessions = data?.affiliateSessions ?? []   // canonical per-affiliate sessions from report[4]
    if (!affSessionMap) return []

    // Build a sessions lookup from the canonical affiliate sessions report (report[4], currentOnlyParams).
    // This is the same source used by Traffic & Commercial dashboards, so totals match across all pages.
    // Fallback to scorecard if data.affiliateSessions is unexpectedly empty.
    const sessionSource = affiliateSessions.length > 0 ? affiliateSessions : (scorecard ?? [])
    const sessionMap = {}
    sessionSource.forEach(row => {
      const id = String(row.sessionSource || '').trim()
      if (!id) return
      sessionMap[id] = {
        sessions: (sessionMap[id]?.sessions || 0) + (row.sessions || 0),
        prevSessions: (sessionMap[id]?.prevSessions || 0) + (row.prevSessions || row.prev_sessions || 0)
      }
    })

    // Build the combined set of affiliates: those with funnel EVENTS from affSessionMap
    // PLUS any session-only affiliates from the canonical sessions report (ensures all sessions counted)
    const allAffiliateIds = new Set([
      ...Object.keys(affSessionMap),
      ...Object.keys(sessionMap),
    ])

    // Group affiliates dynamically based on the global Group By toggle
    const byGroup = {}
    const isPromo = filters.groupBy === 'promotion_method'

    allAffiliateIds.forEach(id => {
      const a = affSessionMap[id] || { affiliateId: id, viewSearchResults: 0, formSubmit: 0, beginCheckout: 0, purchases: 0, paymentFailure: 0, prevBeginCheckout: 0, prevPurchases: 0 }
      
      let groupKey = 'Unknown'
      if (id === 'awin') {
        groupKey = 'Unattributed (awin bulk)'
      } else {
        groupKey = isPromo ? (resolvePromotionMethod(id) || 'Unknown') : resolveAffiliateName(id)
      }

      const type = groupKey
      if (!byGroup[type]) {
        byGroup[type] = {
           type,
           rawId: id,
           sessions: 0, beginCheckout: 0, purchases: 0,
           prevSessions: 0, prevBeginCheckout: 0, prevPurchases: 0
        }
      }
      
      byGroup[type].beginCheckout     += a.beginCheckout || 0
      byGroup[type].purchases         += a.purchases || 0
      byGroup[type].sessions          += (sessionMap[id]?.sessions || 0)

      byGroup[type].prevBeginCheckout += (a.prevBeginCheckout || 0)
      byGroup[type].prevPurchases     += (a.prevPurchases || 0)
      byGroup[type].prevSessions      += (sessionMap[id]?.prevSessions || 0)
    })

    return Object.values(byGroup)
      .map(t => {
        // Current rates
        const dropOffRate    = t.beginCheckout > 0 ? Math.min(Math.max(((t.beginCheckout - t.purchases) / t.beginCheckout) * 100, 0), 100) : 0
        const completionRate = t.beginCheckout > 0 ? Math.min((t.purchases / t.beginCheckout) * 100, 100) : 0

        // Previous rates
        const prevDropOffRate    = t.prevBeginCheckout > 0 ? Math.min(Math.max(((t.prevBeginCheckout - t.prevPurchases) / t.prevBeginCheckout) * 100, 0), 100) : 0
        const prevCompletionRate = t.prevBeginCheckout > 0 ? Math.min((t.prevPurchases / t.prevBeginCheckout) * 100, 100) : 0

        return { ...t, dropOffRate, completionRate, prevDropOffRate, prevCompletionRate }
      })
      .sort((a, b) => b.sessions - a.sessions)
  }, [data?.affiliateSessionMap, data?.affiliateSessions, scorecard, filters.groupBy])

  if (loading && !data) return <PageSkeleton />

  const { kpis, funnelSteps: rawFunnelSteps, affiliateCheckoutDrop, paymentFailTrend } = data
  const funnelSteps = funnelStepsOverride ?? rawFunnelSteps

  const funnelTrendData = {
    labels: aggFunnelTrend[0]?.data.map(d => granularityLabel(d.key, filters.granularity)) || [],
    datasets: aggFunnelTrend.map((s, i) => {
      const base = s.data[0]?.value || 1
      return {
        label: s.stage,
        data: s.data.map(d => parseFloat(((d.value / base) * 100).toFixed(1))),
        borderColor: LINE_COLORS[i],
        backgroundColor: 'transparent',
        borderWidth: 2, tension: 0.4,
        pointRadius: 4, pointBackgroundColor: LINE_COLORS[i], pointBorderColor: '#fff', pointBorderWidth: 2, pointHoverRadius: 6
      }
    })
  }

  // Chart data runs off the dynamic table data (which respects the Group By toggle)
  const chartEligibleData = affiliateTypeTableData.filter(a => a.beginCheckout >= 3)
  
  // Sort ascending by dropOffRate for the first chart
  const sortedDropOff = [...chartEligibleData]
    .sort((a, b) => a.dropOffRate - b.dropOffRate)
    
  // Sort ascending by completionRate for the second chart
  const sortedByCompletion = [...chartEligibleData]
    .sort((a, b) => a.completionRate - b.completionRate)

  const dropOffBarData = {
    labels: sortedDropOff.map(a => a.type),
    datasets: [{
      data: sortedDropOff.map(a => parseFloat(a.dropOffRate.toFixed(1))),
      backgroundColor: '#C0392B',
      borderRadius: 4,
    }]
  }

  const checkoutRateData = {
    labels: sortedByCompletion.map(a => a.type),
    datasets: [{
      data: sortedByCompletion.map(a => parseFloat(a.completionRate.toFixed(1))),
      backgroundColor: '#359C86',
      borderRadius: 4,
    }]
  }

  return (
    <div className="page-content fade-in">
      {/* Date range context */}
      <DateRangePill dateRanges={filters.dateRanges} comparison={filters.comparison} />

      <div className="kpi-row kpi-row-4">
        <KPICard label="CHECKOUT STARTED"         value={kpis.evtBeginCheckout.value}   prev={kpis.evtBeginCheckout.prev}   format="number"  primary={true} sub="Mid-funnel entry events" />
        <KPICard label="CHECKOUT COMPLETION RATE" value={kpis.checkoutToPurchase.value} prev={kpis.checkoutToPurchase.prev} format="percent" decimals={1}   sub="Transactions ÷ checkouts started" />
        <KPICard label="SEARCHES PERFORMED"       value={kpis.evtViewSearch.value}       prev={kpis.evtViewSearch.prev}      format="number"  sub="High-intent search views" />
        <KPICard label="PAYMENT FAILURES"         value={kpis.evtPaymentFail.value}      prev={kpis.evtPaymentFail.prev}     format="number"  sub={<span style={{ color: '#B45F06', fontWeight: 600 }}>⚠️ iOS app - investigate</span>} />
      </div>

      <div className="chart-row chart-row-2">
        <ChartCard
          title="Booking Funnel"
          subtitle={compareMode === 'vsAll' ? 'Affiliate channel vs site-wide funnel' : 'Sessions → Purchase · affiliate channel'}
          tag="FUNNEL"
        >
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 420 }}>

            {/* Funnel bars with optional loading overlay */}
            <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                  background: '#0D8A72', color: '#fff',
                }}>
                  Affiliate Only
                </span>
              </div>
              
              <div style={{ position: 'relative' }}>
                {(funnelLoading || siteLoading) && (
                  <div style={{
                    position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 10, borderRadius: 8,
                  }}>
                    <span style={{ fontSize: 12, color: '#5A6A7A', fontFamily: 'inherit' }}>Loading…</span>
                  </div>
                )}
                <FunnelVisualization steps={funnelSteps} comparison={compareMode === 'vsAll' ? siteSteps : null} comparisonMode={filters.comparison} />
              </div>
            </div>

            {/* Drop-off alert — auto-computed from live funnelSteps */}

          </div>
        </ChartCard>
        <ChartCard title="Funnel Stage Trend (Weekly)" subtitle="Indexed to day 1 — shows funnel stage trends relative to baseline" tag="TREND" showGranularity={true}>
          <div style={{ height: 420, paddingTop: 10 }}>
            <Line data={funnelTrendData} options={indexedLineOpts} />
          </div>
        </ChartCard>
      </div>

      <div className="chart-row chart-row-2">
        <ChartCard title={filters.groupBy === 'promotion_method' ? "Checkout Drop-off Rate by Promotion" : "Checkout Drop-off Rate by Affiliate"} subtitle="% of checkout starters who did not complete booking" tag="DROP-OFF">
          <div style={{ height: 300, paddingTop: 10 }}>
            <Bar data={dropOffBarData} options={hBarOpts(dropOffBarData.datasets[0].data, v => `${v}%`)} />
          </div>
        </ChartCard>
        <ChartCard title={filters.groupBy === 'promotion_method' ? "Checkout-to-Purchase Rate by Promotion" : "Checkout-to-Purchase Rate by Affiliate"} subtitle="% of checkout starters who completed booking" tag="EFFICIENCY">
          <div style={{ height: 300, paddingTop: 10 }}>
            <Bar data={checkoutRateData} options={hBarOpts(checkoutRateData.datasets[0].data, v => `${v}%`)} />
          </div>
        </ChartCard>
      </div>

      {/* Payment Failure Trend */}
      {(() => {
        const pft = data?.paymentFailTrend
        if (!pft) return null
        const labels = (pft.mobile || pft.desktop || []).map(d => d.date.slice(5))
        const mobileData = (pft.mobile || []).map(d => d.value)
        const desktopData = (pft.desktop || []).map(d => d.value)
        const totalFails = [...mobileData, ...desktopData].reduce((s, v) => s + v, 0)
        const payFailChartData = {
          labels,
          datasets: [
            { label: 'Mobile', data: mobileData, borderColor: '#C0392B', backgroundColor: 'rgba(192,57,43,0.08)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 3 },
            { label: 'Desktop', data: desktopData, borderColor: '#0F5FA6', backgroundColor: 'rgba(15,95,166,0.08)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 3 },
          ]
        }
        const payFailOpts = {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: true, position: 'bottom', align: 'start', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 6, font: { family: 'DM Sans', size: 11 }, padding: 20 } },
            datalabels: { display: false },
            tooltip: { mode: 'index', intersect: false }
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { family: 'DM Sans', size: 10 }, color: '#5A6A7A', maxTicksLimit: 8 } },
            y: { grid: { color: '#F1F5F9' }, border: { display: false }, min: 0, ticks: { stepSize: 1, font: { family: 'DM Sans', size: 11 }, color: '#5A6A7A' } }
          }
        }
        return (
          <div className="chart-row-1" style={{ marginTop: 20 }}>
            <ChartCard title="Payment Failure Trend" subtitle={`Daily payment failures by device · ${totalFails} total failures in period`} tag="FAILURES">
              <div style={{ height: 280, paddingTop: 10 }}>
                {totalFails === 0
                  ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#0D8A72', fontWeight: 600, fontSize: 13 }}>✅ No payment failures recorded in this period</div>
                  : <Line data={payFailChartData} options={payFailOpts} />
                }
              </div>
            </ChartCard>
          </div>
        )
      })()}

      {/* Affiliate Type Performance Table */}
      <div className="chart-row chart-row-1" style={{ marginTop: 24 }}>
        <ChartCard
          title={filters.groupBy === 'promotion_method' ? 'Funnel Performance by Promotion' : 'Funnel Performance by Affiliate'}
          subtitle={filters.groupBy === 'promotion_method' ? 'Funnel metrics aggregated by sub-network tier' : 'Funnel metrics by individual affiliate partner'}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E2EAF0' }}>
                  <th style={{ padding: '12px 8px', color: '#5A6A7A', fontWeight: 600, width: 40, textAlign: 'center' }}>#</th>
                  <th style={{ padding: '12px 8px', color: '#5A6A7A', fontWeight: 600 }}>
                    {filters.groupBy === 'promotion_method' ? 'Promotion' : 'Affiliate Name'}
                  </th>
                  <th style={{ padding: '12px 8px', color: '#5A6A7A', fontWeight: 600, textAlign: 'right' }}>Sessions</th>
                  <th style={{ padding: '12px 8px', color: '#5A6A7A', fontWeight: 600, textAlign: 'right' }}>Checkouts Started</th>
                  <th style={{ padding: '12px 8px', color: '#5A6A7A', fontWeight: 600, textAlign: 'right' }}>Checkout Drop-off</th>
                  <th style={{ padding: '12px 8px', color: '#5A6A7A', fontWeight: 600, textAlign: 'right' }}>Completion Rate</th>
                </tr>
              </thead>
              <tbody>
                {/* 1) Summation Row */}
                {affiliateTypeTableData.length > 0 && (() => {
                  const sTotal            = affiliateTypeTableData.reduce((s, r) => s + r.sessions, 0)
                  const prevSTotal        = affiliateTypeTableData.reduce((s, r) => s + r.prevSessions, 0)
                  const chkTotal          = affiliateTypeTableData.reduce((s, r) => s + r.beginCheckout, 0)
                  const prevChkTotal      = affiliateTypeTableData.reduce((s, r) => s + r.prevBeginCheckout, 0)
                  const purTotal          = affiliateTypeTableData.reduce((s, r) => s + r.purchases, 0)
                  const prevPurTotal      = affiliateTypeTableData.reduce((s, r) => s + r.prevPurchases, 0)

                  const dropTotal         = chkTotal > 0 ? ((chkTotal - purTotal) / chkTotal) * 100 : 0
                  const compTotal         = chkTotal > 0 ? (purTotal / chkTotal) * 100 : 0
                  
                  const prevDropTotal     = prevChkTotal > 0 ? ((prevChkTotal - prevPurTotal) / prevChkTotal) * 100 : 0
                  const prevCompTotal     = prevChkTotal > 0 ? (prevPurTotal / prevChkTotal) * 100 : 0

                  return (
                    <tr style={{ position: 'sticky', top: 0, background: '#F8FAFC', zIndex: 10, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                        <div style={{ background: '#0F5FA6', color: '#fff', width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, margin: '0 auto' }}>
                          Σ
                        </div>
                      </td>
                      <td style={{ padding: '12px 8px', fontWeight: 700, color: '#0F5FA6', textTransform: 'uppercase', letterSpacing: '0.05em' }}>TOTAL</td>
                      <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 700, color: '#0F5FA6' }}>
                        <FunnelDeltaCell value={sTotal} prevValue={prevSTotal} type="number" />
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 700, color: '#0F5FA6' }}>
                        <FunnelDeltaCell value={chkTotal} prevValue={prevChkTotal} type="number" />
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 700, color: '#0F5FA6' }}>
                        <FunnelDeltaCell value={dropTotal / 100} prevValue={prevDropTotal / 100} type="bounceRate" />
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 700, color: '#0F5FA6' }}>
                        <FunnelDeltaCell value={compTotal / 100} prevValue={prevCompTotal / 100} type="engagementRate" />
                      </td>
                    </tr>
                  )
                })()}

                {/* 2) Individual Rows */}
                {affiliateTypeTableData.map((row, index) => {
                  let subLabel = 'N/A'
                  if (filters.groupBy === 'promotion_method') {
                    // We don't have distinct affiliate counts available in this simple grouping layer, so hide the sublabel or use default
                    subLabel = null
                  } else {
                    subLabel = resolvePromotionMethod(row.rawId) || 'N/A'
                  }

                  return (
                    <tr key={row.type} style={{ borderBottom: '1px solid #F1F5F9', background: '#fff' }}>
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                        <div style={{ background: index < 3 ? '#FEF3C7' : '#F8FAFC', color: index < 3 ? '#92400E' : '#64748B', width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, margin: '0 auto' }}>
                          {index + 1}
                        </div>
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        <div style={{ fontWeight: 600, color: '#0A2540' }}>{row.type}</div>
                        {subLabel && <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{subLabel}</div>}
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                        <FunnelDeltaCell value={row.sessions} prevValue={row.prevSessions} type="number" />
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                        <FunnelDeltaCell value={row.beginCheckout} prevValue={row.prevBeginCheckout} type="number" />
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                        <FunnelDeltaCell value={row.dropOffRate / 100} prevValue={row.prevDropOffRate / 100} type="bounceRate" />
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                        <FunnelDeltaCell value={row.completionRate / 100} prevValue={row.prevCompletionRate / 100} type="engagementRate" />
                      </td>
                    </tr>
                  )
                })}

                {affiliateTypeTableData.length === 0 && (
                  <tr>
                    <td colSpan="6" style={{ padding: '24px', textAlign: 'center', color: '#5A6A7A' }}>
                      {scorecard ? 'No affiliate data available.' : 'Loading session data...'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>
    </div>
  )
}

function FunnelDeltaCell({ value, prevValue, type }) {
  const isRate = ['engagementRate', 'bounceRate', 'convRate'].includes(type)
  const isCurrency = ['revenue', 'aov', 'revenuePerSession'].includes(type)
  
  const primaryText = isRate ? `${(value * 100).toFixed(1)}%` : 
                      isCurrency ? `£${Number(value).toLocaleString('en-GB')}` :
                      Number(value).toLocaleString('en-GB')
                      
  if (prevValue == null || value === prevValue || prevValue === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minHeight: 40, justifyContent: 'center' }}>
        <span style={{ fontWeight: 600 }}>{primaryText}</span>
      </div>
    )
  }

  let deltaText = ''
  let color = ''
  let bg = ''
  let arrow = ''
  
  if (isRate) {
    const pp = (value * 100) - (prevValue * 100)
    deltaText = `${Math.abs(pp).toFixed(1)}pp`
    const good = type === 'bounceRate' ? pp <= 0 : pp >= 0
    color = good ? '#059669' : '#DC2626'
    bg = good ? '#ECFDF5' : '#FEF2F2'
    arrow = pp > 0 ? '↑' : pp < 0 ? '↓' : ''
  } else {
    // Math handle for % difference
    // Check if both value and prevValue equal 0
    if (value === 0 && prevValue === 0) return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minHeight: 40, justifyContent: 'center' }}><span style={{ fontWeight: 600 }}>{primaryText}</span></div>
    
    const pct = prevValue > 0 ? ((value - prevValue) / prevValue) * 100 : 100
    deltaText = `${Math.abs(pct).toFixed(1)}%`
    const good = pct >= 0
    color = good ? '#059669' : '#DC2626'
    bg = good ? '#ECFDF5' : '#FEF2F2'
    arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : ''
  }
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', minHeight: 40, gap: 4 }}>
      <span style={{ fontWeight: 600 }}>{primaryText}</span>
      <span style={{ 
        display: 'inline-flex', alignItems: 'center', gap: 2,
        background: bg, color: color,
        padding: '2px 6px', borderRadius: 4,
        fontSize: 11, fontWeight: 600
      }}>
        {arrow} {deltaText}
      </span>
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
        {[...Array(2)].map((_, i) => <div key={i} className="skeleton" style={{ height: 480, borderRadius: 12 }} />)}
      </div>
      <div className="chart-row chart-row-2">
        {[...Array(2)].map((_, i) => <div key={i} className="skeleton" style={{ height: 300, borderRadius: 12 }} />)}
      </div>
    </div>
  )
}
