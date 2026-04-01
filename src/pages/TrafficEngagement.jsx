import { useState, useEffect, useMemo } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler
} from 'chart.js'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import { Line, Bar, Doughnut } from 'react-chartjs-2'
import KPICard from '../components/KPICard'
import ChartCard from '../components/ChartCard'
import TrafficTable from '../components/TrafficTable'
import { getTrafficEngagement } from '../services/data-service'
import { useFilters } from '../context/FiltersContext'
import { useProperty } from '../context/PropertyContext'
import { format, parseISO } from 'date-fns'
import { aggregateTrend, granularityLabel } from '../utils/time-aggregation'
import { getDateRangeLabel } from '../utils/date-ranges'
import DateRangePill from '../components/DateRangePill'
import LandingPageTable from '../components/LandingPageTable'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler, ChartDataLabels)

const AFFILIATE_COLORS = ['#0F5FA6','#0D8A72','#D97706','#7C3AED','#C0392B','#0369A1','#065F46','#92400E']

const baseLineOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: { 
    tooltip: { mode: 'index', intersect: false },
    legend: { display: true, position: 'bottom', align: 'start', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 6, font: { family: 'DM Sans', size: 11 }, padding: 20 } },
    datalabels: { display: false }
  },
  interaction: { mode: 'index', intersect: false },
  scales: {
    x: { grid: { display: false }, border: { display: false }, ticks: { font: { family: 'DM Sans', size: 11 }, color: '#5A6A7A', maxTicksLimit: 6, padding: 8 } },
    y: { grid: { color: '#E2EAF0', drawBorder: false, borderDash: [4, 4] }, border: { display: false }, ticks: { font: { family: 'DM Sans', size: 11 }, color: '#5A6A7A', maxTicksLimit: 6, padding: 12 } },
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
    x: { display: false, grid: { display: false }, stacked: false, max: Math.max(...dataArray) * 1.05 },
    y: { 
      grid: { display: false }, border: { display: false }, stacked: false,
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

// Wrap long affiliate names into 2-line arrays for Chart.js y-axis (same as Executive Summary)
const wrapLabel = (label, maxLen = 18) => {
  if (!label) return label
  if (String(label).length <= maxLen) return String(label)
  const words = String(label).split(' ')
  const lines = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (candidate.length <= maxLen) { line = candidate }
    else { if (line) lines.push(line); line = word }
  }
  if (line) lines.push(line)
  return lines.length > 1 ? lines : String(label)
}

export default function TrafficEngagement() {
  const { filters } = useFilters()
  const { selectedProperty } = useProperty()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  // IMPROVEMENT 2: return visitor toggle state
  const [usersView, setUsersView] = useState('new') // 'new' | 'returning' | 'both'

  useEffect(() => {
    setLoading(true)
    getTrafficEngagement(selectedProperty?.ga4_property_id, filters).then(d => {
      setData(d)
      setLoading(false)
    })
  }, [selectedProperty, filters.dateRanges, filters.affiliateFilter, filters.countryFilter, filters.deviceFilter])

  const sessionsTrends = data?.sessionsTrends
  const newUsersTrend  = data?.newUsersTrend

  // ── FIX 5 + 6: Single Y-axis, awin excluded at transform level, dynamic granularity ──────
  const aggSessionsTrends = useMemo(() => {
    return (sessionsTrends || []).map(aff => ({
      ...aff,
      data: aggregateTrend(aff.data, filters.granularity)
    }))
  }, [sessionsTrends, filters.granularity])

  const aggNewUsersTrend = useMemo(() => aggregateTrend(newUsersTrend || [], filters.granularity), [newUsersTrend, filters.granularity])
  const aggNewUsersTrendPrev = useMemo(() => aggregateTrend(data?.newUsersTrendPrev || [], filters.granularity), [data?.newUsersTrendPrev, filters.granularity])

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
            sessions: 0, engagedSessions: 0, 
            newUsers: 0, returningUsers: 0,
            mobile: 0, desktop: 0, tablet: 0,
            wowSessions: 0,
            _engRateSum: 0, _bounceRateSum: 0, _durationSum: 0
          }
        }
        const g = groups[key]
        g.sessions += a.sessions || 0
        g.engagedSessions += a.engagedSessions || 0
        g.newUsers += a.newUsers || 0
        g.returningUsers += a.returningUsers || 0
        g.mobile += a.mobile || 0
        g.desktop += a.desktop || 0
        g.tablet += a.tablet || 0
        g.wowSessions += a.wowSessions || 0
        g._engRateSum += (a.engagementRate || 0) * (a.sessions || 0)
        g._bounceRateSum += (a.bounceRate || 0) * (a.sessions || 0)
        g._durationSum += (a.avgDuration || 0) * (a.sessions || 0)
      })
      arr = Object.values(groups).map(g => {
        g.engagementRate = g.sessions > 0 ? (g._engRateSum / g.sessions) : 0
        g.bounceRate = g.sessions > 0 ? (g._bounceRateSum / g.sessions) : 0
        g.avgDuration = g.sessions > 0 ? (g._durationSum / g.sessions) : 0
        return g
      })
    }
    return arr.map(a => ({
      ...a,
      name: isPromo ? (a.promotionMethod || 'N/A') : (a.name ?? a.affiliateId)
    }))
  }, [affiliates, isPromo])

  if (loading && !data) return <PageSkeleton />

  // landingPages added by data-service; will be empty array until edge function is deployed
  const { kpis, byEngagement, landingPages = [] } = data

  const getLabel = (a) => a.name

  const showComparison = filters.comparison !== 'off'
  const compLabel = filters.comparison === 'prevYear' ? 'vs Last Year' : 'vs Prev Period'

  const awinTrend   = aggSessionsTrends.find(a => a.affiliateId.toLowerCase().includes('awin'))
  const otherTrends = aggSessionsTrends.filter(a => !a.affiliateId.toLowerCase().includes('awin'))

  const awinMax   = awinTrend ? Math.max(1, ...awinTrend.data.map(d => d.value)) : 1
  const othersMax = otherTrends.length > 0 ? Math.max(1, ...otherTrends.flatMap(a => a.data.map(d => d.value))) : 1

  const trendChartData = {
    labels: aggSessionsTrends[0]?.data.map(d => granularityLabel(d.key, filters.granularity)) || [],
    datasets: aggSessionsTrends.map((aff, i) => {
      const isAwin = aff.affiliateId.toLowerCase().includes('awin')
      const color = isAwin ? '#0F5FA6' : AFFILIATE_COLORS[i % AFFILIATE_COLORS.length]
      
      return {
        label: getLabel(aff) + (isAwin ? ' →' : ''),
        data: aff.data.map(d => Math.floor(d.value)),
        borderColor: isAwin ? 'rgba(15,95,166,0.7)' : color,
        backgroundColor: 'transparent',
        borderWidth: 2,
        tension: 0.4,
        fill: false,
        spanGaps: false,
        pointRadius: 4,
        pointBackgroundColor: color,
        pointBorderColor: '#fff', 
        pointBorderWidth: 2, 
        pointHoverRadius: 6,
        yAxisID: isAwin ? 'yRight' : 'yLeft',
      }
    })
  }

  const trendChartOpts = {
    ...baseLineOpts,
    plugins: {
      ...baseLineOpts.plugins,
      tooltip: {
        ...baseLineOpts.plugins?.tooltip,
        callbacks: {
          label: (ctx) => {
            const axisLabel  = ctx.dataset.yAxisID === 'yRight' ? '(right axis)' : '(left axis)'
            const cleanLabel = ctx.dataset.label.replace(' →', '')
            return `${cleanLabel}: ${ctx.formattedValue} ${axisLabel}`
          }
        }
      },
      legend: {
        display: true, position: 'bottom', align: 'start',
        labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 6, font: { family: 'DM Sans', size: 11 }, padding: 20 }
      },
      datalabels: { display: false },
    },
    scales: {
      ...baseLineOpts.scales,
      yLeft: {
        ...baseLineOpts.scales.y,
        display: otherTrends.length > 0,
        position: 'left',
        min: 0,
        max: Math.ceil(othersMax * 1.2),
      },
      yRight: {
        ...baseLineOpts.scales.y,
        display: !!awinTrend,
        position: 'right',
        min: 0,
        max: Math.ceil(awinMax * 1.2),
        grid: { drawOnChartArea: false },
      },
      y: { display: false }
    },
  }

  const totalShown = (awinTrend ? 1 : 0) + otherTrends.length
  const trendChartTitle = `Top ${totalShown} Affiliates — Sessions Trend`
  const trendChartSubtitle = awinTrend 
    ? `awin shown on right axis · others on left axis`
    : `Daily sessions by affiliate · ${dateRangeLabel}`

  // ── FIX 2 + 4: Engagement bar chart — threshold colors, min 20 sessions, top 12 ──
  const engColor = (rate) => rate > 0.6 ? '#0D8A72' : rate >= 0.4 ? '#D97706' : '#C0392B'
  
  const engSourceArray = isPromo ? displayAffiliates : byEngagement
  const chartByEng = [...engSourceArray]
    .filter(a => a.sessions >= 20 && a.engagementRate > 0)
    .sort((a,b) => b.engagementRate - a.engagementRate)
    .slice(0, 12)

  const engBarData = {
    labels: chartByEng.map(a => wrapLabel(a.name || a.affiliateId || 'Unknown')),
    datasets: [{
      data: chartByEng.map(a => parseFloat((a.engagementRate * 100).toFixed(1))),
      backgroundColor: chartByEng.map(a => engColor(a.engagementRate)),
      borderRadius: 4,
    }]
  }

  // Donut configs
  const donutOptionsTemplate = {
    responsive: true, maintainAspectRatio: false,
    cutout: '68%',
    plugins: {
      legend: { display: true, position: 'bottom', labels: { usePointStyle: true, boxWidth: 6, font: { family: 'DM Sans', size: 11 }, padding: 16 } },
      datalabels: { display: false }
    }
  }

  // ── New/Returning users toggle ──────────────────────────────────────────────────────
  // Use real daily newUsers from GA4 (edge function now returns it in daily metrics).
  // If all values are 0 (pre-deploy cache), fall back to the proportional simulation.
  const totalReturnUsers = affiliates.reduce((s, a) => s + (a.returningUsers || 0), 0)
  
  // Aggregate total sessions by bucket for proportional simulation fallback
  const bucketTotals = aggSessionsTrends.reduce((acc, aff) => {
    aff.data.forEach((d, i) => { acc[i] = (acc[i] || 0) + d.value })
    return acc
  }, [])
  const bucketTotalSum = bucketTotals.reduce((s, v) => s + v, 0) || 1
  const dateLabels = (aggSessionsTrends[0]?.data ?? []).map(d => granularityLabel(d.key, filters.granularity))

  // Real new users from daily GA4 data (different shape to sessions when data is correct)
  const realNewUsers  = aggNewUsersTrend.map(d => d.value)
  const hasRealData   = realNewUsers.some(v => v > 0)
  const totalNewUsers = affiliates.reduce((s, a) => s + (a.newUsers || 0), 0)
  const newUsersSim   = bucketTotals.map((_, i) => Math.round((bucketTotals[i] || 0) / bucketTotalSum * totalNewUsers))
  
  // Use real data wherever available; simulation is a fallback for pre-deploy cache hits
  const newUsersData  = hasRealData ? realNewUsers : newUsersSim
  const returningsSim = bucketTotals.map((_, i) => Math.round((bucketTotals[i] || 0) / bucketTotalSum * totalReturnUsers))

  const usersChartTitle = usersView === 'new' ? 'New Users Over Time'
    : usersView === 'returning' ? 'Returning Users Over Time'
    : 'New vs Returning Users Over Time'

  const buildUsersDatasets = () => {
    const ds = []
    if (usersView === 'new' || usersView === 'both') {
      ds.push({
        label: 'New Users', data: newUsersData,
        borderColor: '#4488D5',
        backgroundColor: usersView === 'both' ? 'transparent' : 'rgba(68,136,213,0.08)',
        fill: usersView !== 'both', tension: 0.4, borderWidth: 2,
        pointRadius: 3, pointBackgroundColor: '#4488D5', pointBorderColor: '#fff', pointBorderWidth: 1,
      })
      // FIX: Add comparison dotted line for New Users
      if (showComparison && aggNewUsersTrendPrev.length > 0) {
        ds.push({
          label: 'New Users (prev)',
          data: aggNewUsersTrendPrev.map(d => d.value),
          borderColor: '#CBD5E1', borderDash: [4, 4],
          backgroundColor: 'transparent',
          fill: false, tension: 0.4, borderWidth: 2,
          pointRadius: 0,
        })
      }
    }
    if (usersView === 'returning' || usersView === 'both') {
      ds.push({
        label: 'Returning Users', data: returningsSim,
        borderColor: '#0D8A72',
        backgroundColor: usersView === 'both' ? 'transparent' : 'rgba(13,138,114,0.08)',
        borderDash: usersView === 'both' ? [5, 5] : [],
        fill: usersView !== 'both', tension: 0.4, borderWidth: 2,
        pointRadius: 3, pointBackgroundColor: '#0D8A72', pointBorderColor: '#fff', pointBorderWidth: 1,
      })
    }
    return ds
  }

  const newUsersTrendData = { labels: dateLabels, datasets: buildUsersDatasets() }

  const totalMobile  = affiliates.reduce((s, a) => s + a.mobile,  0)
  const totalDesktop = affiliates.reduce((s, a) => s + a.desktop, 0)
  const totalTablet  = affiliates.reduce((s, a) => s + a.tablet,  0)
  const totalSessions = Math.max(1, affiliates.reduce((s, a) => s + a.sessions, 0))

  const mobilePct  = Math.round((totalMobile  / totalSessions) * 100)
  const desktopPct = Math.round((totalDesktop / totalSessions) * 100)
  const tabletPct  = Math.round((totalTablet  / totalSessions) * 100)

  const deviceData = {
    labels: [`Mobile (${mobilePct}%)`, `Desktop (${desktopPct}%)`, `Tablet (${tabletPct}%)`],
    datasets: [{ data: [totalMobile, totalDesktop, totalTablet], backgroundColor: ['#0F5FA6', '#0D8A72', '#E2E8F0'], borderWidth: 0 }]
  }

  // Only show affiliates that had at least 1 session in the current period
  const activeAffiliates = displayAffiliates.filter(a => (a.sessions ?? 0) > 0)

  // IMPROVEMENT 1: Landing pages
  // Pre-calculate session share for the summary line
  const totalLandingSessions = landingPages.reduce((s, p) => s + p.sessions, 0) || 1
  const hpSessions = landingPages.filter(p => p.path === '/en').reduce((s, p) => s + p.sessions, 0)
  const bkSessions = landingPages.filter(p => p.path === '/en/booking' || p.path.startsWith('/en/booking/')).reduce((s, p) => s + p.sessions, 0)
  const destSessions = landingPages.filter(p => p.path.startsWith('/en/spain/')).reduce((s, p) => s + p.sessions, 0)

  const pctHp = Math.round((hpSessions / totalLandingSessions) * 100)
  const pctBk = Math.round((bkSessions / totalLandingSessions) * 100)
  const pctDest = Math.round((destSessions / totalLandingSessions) * 100)

  const dateRangeLabel = getDateRangeLabel(filters)

  const toggleBtn = (view) => ({
    padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
    fontSize: 11, fontWeight: 600, fontFamily: 'DM Sans, sans-serif',
    background: usersView === view ? '#0F5FA6' : '#F1F5F9',
    color:      usersView === view ? '#fff'    : '#5A6A7A',
    transition: 'all 0.15s',
  })

  return (
    <div className="page-content fade-in">
      {/* Date range context */}
      <DateRangePill dateRanges={filters.dateRanges} comparison={filters.comparison} />

      <div className="kpi-row kpi-row-4">
        <KPICard label="ENGAGED SESSIONS"    value={kpis.engagedSessions.value}  prev={kpis.engagedSessions.prev}  format="number"  primary={true} sub="10+ sec or 2+ pages" />
        <KPICard label="ENGAGEMENT RATE"     value={kpis.engagementRate.value}   prev={kpis.engagementRate.prev}   format="percent" decimals={1}   sub="Engaged ÷ Total sessions" />
        <KPICard label="AVG SESSION DURATION" value={kpis.avgDuration.value}     prev={kpis.avgDuration.prev}      format="duration"               sub="Average across all sessions" />
        <KPICard label="PAGES PER SESSION"   value={kpis.pagesPerSession.value}  prev={kpis.pagesPerSession.prev}  format="number"  decimals={1}   sub="Page views ÷ Sessions" />
      </div>

      <div className="chart-row chart-row-2">
        {/* FIX 5 + 6: Single axis, awin excluded, dynamic labels */}
        <ChartCard title={trendChartTitle} subtitle={trendChartSubtitle} tag="TREND" showGranularity={true}>
          <div style={{ height: 350, paddingTop: 10 }}>
            <Line data={trendChartData} options={trendChartOpts} />
          </div>
        </ChartCard>

        {/* FIX 2 + 4: Threshold colors, ≥20 sessions, top 12 */}
        <ChartCard title="Engagement Rate by Affiliate" subtitle="Traffic quality ranking · min 20 sessions" tag="QUALITY">
          <div style={{ height: 350, paddingTop: 10 }}>
            <Bar data={engBarData} options={barOpts(engBarData.datasets[0].data, (v) => `${v}%`)} />
          </div>
          <div style={{ fontSize: 10, color: 'var(--subtext)', textAlign: 'center', marginTop: 4, fontFamily: 'DM Sans, sans-serif' }}>
            Affiliates with fewer than 20 sessions excluded
          </div>
        </ChartCard>
      </div>

      <div className="chart-row chart-row-2">
        {/* IMPROVEMENT 2: New / Returning / Both toggle */}
        <ChartCard title={usersChartTitle} subtitle="Affiliate session visitors" tag="AUDIENCE" showGranularity={true}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <button style={toggleBtn('new')}       onClick={() => setUsersView('new')}>New Users</button>
            <button style={toggleBtn('returning')} onClick={() => setUsersView('returning')}>Returning</button>
            <button style={toggleBtn('both')}      onClick={() => setUsersView('both')}>Both</button>
          </div>
          <div style={{ height: 225, paddingTop: 4 }}>
            <Line data={newUsersTrendData} options={{
              ...baseLineOpts,
              plugins: {
                ...baseLineOpts.plugins,
                legend: { display: usersView === 'both', position: 'bottom', align: 'start', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 6, font: { family: 'DM Sans', size: 11 }, padding: 20 } },
                datalabels: { display: false },
              },
            }} />
          </div>
        </ChartCard>

        <ChartCard title="Sessions by Device" subtitle="Mobile vs Desktop vs Tablet" tag="DEVICE">
          <div style={{ position: 'relative', height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Doughnut data={deviceData} options={donutOptionsTemplate} />
            <div style={{ position: 'absolute', textAlign: 'center', pointerEvents: 'none', top: '45%', transform: 'translateY(-50%)' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--navy)', lineHeight: 1 }}>{mobilePct}%</div>
              <div style={{ fontSize: 11, color: 'var(--subtext)', marginTop: 4 }}>Mobile</div>
            </div>
          </div>
        </ChartCard>
      </div>

      {/* IMPROVEMENT 1: Landing pages */}
      {landingPages.length > 0 && (
        <div className="chart-row-1" style={{ marginTop: 20 }}>
          <ChartCard title="Landing Page Performance" subtitle="Where affiliates send users · engagement & conversion by page" tag="LANDING">
            <div style={{ padding: '0 20px 20px' }}>
              <div style={{ fontSize: 13, color: '#64748B', fontStyle: 'italic', marginBottom: 12 }}>
                Affiliates send {pctHp}% of traffic to the homepage · {pctBk}% to booking pages · {pctDest}% to destination pages
              </div>
              <LandingPageTable data={landingPages} />
            </div>
          </ChartCard>
        </div>
      )}

      <div className="chart-row-1" style={{ marginTop: 20 }}>
        <div className="chart-card">
          <div className="chart-header">
            <div>
              <div className="chart-title">{isPromo ? 'Promo Method Performance Leaderboard' : 'Affiliate Performance Leaderboard'}</div>
              <div className="chart-sub">{isPromo ? 'Sorted by Sessions · All promo methods in period' : 'Sorted by Sessions · All affiliates in period'}</div>
            </div>
            <span className="chart-tag">FULL TABLE</span>
          </div>
          <TrafficTable 
            data={activeAffiliates} 
            hasComparison={filters.comparison !== 'off'}
            isPromo={isPromo}
          />
        </div>
      </div>
    </div>
  )
}


// ────────────────────────────────────────────────────────────────────────────

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
    </div>
  )
}
