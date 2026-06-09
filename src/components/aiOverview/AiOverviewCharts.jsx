/**
 * AiOverviewCharts.jsx — Section B: AI Overview Events bar chart + Attribution view.
 *
 * VIEW 1 — "Click Volume": existing bar chart, completely unchanged.
 * VIEW 2 — "Attribution":  new grouped bar chart showing:
 *   Bar 1 (y1, right axis, grey)  — Total Organic Sessions
 *   Bar 2 (y,  left  axis, teal)  — AI Overview · Organic Search
 *   Bar 3 (y,  left  axis, amber) — AI Overview · Misattributed to Direct
 *
 * Props (unchanged from before):
 *   trendData          — raw kpis trend rows
 *   gran               — 'Week' | 'Month' | 'Quarter' | 'Year'
 *   onGranChange       — (gran) => void
 *   category           — string
 *   onCategoryChange   — (cat)  => void
 *   availableCategories — Set<string>
 *   propertyId         — GA4 property ID (new, for attribution queries)
 *   dateRange          — { startDate, endDate } (new)
 */
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { CATEGORY_COLORS, SNIPPET_KEY, categorise, weekLabel } from './aiOverviewUtils'
import { fetchOrganicSessionsByWeek, fetchAttributionSessions } from '../../services/data-service'

// ─── Safe chart create (React StrictMode safe) ────────────────────────────────
function safeCreateChart(canvas, config) {
  const ChartJS = window.Chart
  if (!ChartJS || !canvas) return null
  const existing = ChartJS.getChart(canvas)
  if (existing) existing.destroy()
  return new ChartJS(canvas, config)
}

// ─── ISO week → Date (Monday) ─────────────────────────────────────────────────
function isoWeekToDate(yearWeek) {
  if (!yearWeek || yearWeek.length < 6) return null
  const year = parseInt(yearWeek.slice(0, 4), 10)
  const week = parseInt(yearWeek.slice(4), 10)
  const jan4 = new Date(year, 0, 4)
  const dayOfWeek = jan4.getDay() || 7
  const week1Mon = new Date(jan4)
  week1Mon.setDate(jan4.getDate() - dayOfWeek + 1)
  const target = new Date(week1Mon)
  target.setDate(week1Mon.getDate() + (week - 1) * 7)
  return target
}

// ─── Granularity bucket key from a yearWeek string ───────────────────────────
function bucketKeyFromWeek(yearWeek, gran) {
  const date = isoWeekToDate(yearWeek)
  if (!date) return yearWeek
  const y = date.getFullYear()
  const m = date.getMonth()
  switch (gran) {
    case 'Week':    return yearWeek
    case 'Month':   return `${y}-${String(m + 1).padStart(2, '0')}`
    case 'Quarter': return `${y}-Q${Math.floor(m / 3) + 1}`
    case 'Year':    return `${y}`
    default:        return yearWeek
  }
}

function bucketLabel(key, gran) {
  if (!key) return ''
  switch (gran) {
    case 'Month': {
      const [y, m] = key.split('-')
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      return `${months[parseInt(m) - 1]} ${y}`
    }
    case 'Quarter': return key.replace('-', ' ')
    case 'Year':    return key
    default:        return weekLabel(key)
  }
}

// ─── Aggregate weekly data rows by granularity + optional category ────────────
function aggregateBars(trendRows, gran, selectedCategory) {
  if (!trendRows?.length) return { labels: [], data: [] }

  const buckets = {}

  trendRows.forEach(row => {
    const snippet  = row[SNIPPET_KEY] ?? ''
    const cat      = categorise(snippet)
    if (selectedCategory !== 'All' && cat !== selectedCategory) return

    const yearWeek = row.yearWeek ?? ''
    const key      = bucketKeyFromWeek(yearWeek, gran)
    if (!key) return
    buckets[key]   = (buckets[key] || 0) + (row.eventCount || 0)
  })

  const sortedKeys = Object.keys(buckets).sort()
  return {
    labels: sortedKeys.map(k => bucketLabel(k, gran)),
    data:   sortedKeys.map(k => buckets[k]),
  }
}

// ─── Aggregate attribution rows by week + channel ────────────────────────────
function aggregateAttribution(organicRows, attrRows, gran) {
  const organicBuckets = {}   // yearWeek key → total organic sessions (Bar 1)
  const aioOrgBuckets  = {}   // yearWeek key → AI Overview organic sessions (Bar 2)
  const aioDirBuckets  = {}   // yearWeek key → AI Overview direct sessions (Bar 3)

  // Bar 1: total organic
  ;(organicRows || []).forEach(row => {
    const key = bucketKeyFromWeek(row.yearWeek ?? '', gran)
    if (!key) return
    organicBuckets[key] = (organicBuckets[key] || 0) + (row.sessions || 0)
  })

  // Bar 2 + 3: split AI Overview attribution rows by channel — use eventCount (event-scoped)
  const SNIPPET_DIM = 'customEvent:ai_overview_click'
  ;(attrRows || []).forEach(row => {
    const snippet = row[SNIPPET_DIM] ?? ''
    if (!snippet || snippet === '(not set)' || snippet === '') return

    const key     = bucketKeyFromWeek(row.yearWeek ?? '', gran)
    if (!key) return
    const channel = row.sessionDefaultChannelGroup ?? ''
    const events  = row.eventCount || 0   // event-scoped — correct scope for this dimension

    if (channel === 'Organic Search') {
      aioOrgBuckets[key] = (aioOrgBuckets[key] || 0) + events
    } else if (channel === 'Direct') {
      aioDirBuckets[key] = (aioDirBuckets[key] || 0) + events
    }
  })

  // Merge all keys and sort
  const allKeys = [...new Set([
    ...Object.keys(organicBuckets),
    ...Object.keys(aioOrgBuckets),
    ...Object.keys(aioDirBuckets),
  ])].sort()

  // Share of organic: (aioOrg + aioDir) / organic × 100.
  // Return null (not 0) when aioTotal = 0 — these are pre-collection weeks where
  // organic sessions exist but no AI Overview events were tracked yet.
  // null values are skipped by spanGaps on the line chart and excluded from the avg.
  const shareData = allKeys.map(k => {
    const organic  = organicBuckets[k] || 0
    const aioTotal = (aioOrgBuckets[k] || 0) + (aioDirBuckets[k] || 0)
    if (organic === 0 || aioTotal === 0) return null
    return parseFloat(((aioTotal / organic) * 100).toFixed(2))
  })

  return {
    labels:      allKeys.map(k => bucketLabel(k, gran)),
    organicData: allKeys.map(k => organicBuckets[k] || 0),
    aioOrgData:  allKeys.map(k => aioOrgBuckets[k]  || 0),
    aioDirData:  allKeys.map(k => aioDirBuckets[k]  || 0),
    shareData,
  }
}

// ─── EXISTING: Click Volume bar chart (unchanged) ────────────────────────────
function BarChart({ labels, data, accentColor }) {
  const canvasRef = useRef(null)
  const chartRef  = useRef(null)

  useEffect(() => {
    if (!canvasRef.current || !window.Chart) return
    if (!labels?.length) return

    const barValuePlugin = {
      id: 'aio-barValues',
      afterDatasetsDraw(chart) {
        const { ctx } = chart
        const meta = chart.getDatasetMeta(0)
        if (!meta?.data?.length) return
        ctx.save()
        ctx.font = 'bold 10px DM Sans, sans-serif'
        ctx.fillStyle = '#0A2540'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        meta.data.forEach((bar, i) => {
          const value = data[i]
          if (value == null) return
          const label = value >= 1000 ? `${(value / 1000).toFixed(1)}K` : value.toLocaleString()
          ctx.fillText(label, bar.x, bar.y - 4)
        })
        ctx.restore()
      },
    }

    chartRef.current = safeCreateChart(canvasRef.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'AI Overview Events',
          data,
          backgroundColor: accentColor ?? '#1D9E75',
          borderRadius: 4,
          borderSkipped: false,
          hoverBackgroundColor: '#0A2540',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        clip: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 24 } },
        plugins: {
          datalabels: { display: false },
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0A2540',
            titleColor: '#94A3B8',
            bodyColor: '#fff',
            padding: 12,
            cornerRadius: 8,
            callbacks: {
              label: ctx => ` ${(ctx.raw ?? 0).toLocaleString()} events`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              font: { size: 10, family: 'DM Sans, sans-serif' },
              color: '#374151',
              maxRotation: 45,
              autoSkip: true,
              maxTicksLimit: 16,
            },
          },
          y: {
            grid: { color: '#F1F5F9' },
            border: { display: false },
            beginAtZero: true,
            ticks: {
              font: { size: 10, family: 'DM Sans, sans-serif' },
              color: '#374151',
              callback: v => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toLocaleString(),
            },
          },
        },
      },
      plugins: [barValuePlugin],
    })

    return () => {
      chartRef.current?.destroy()
      chartRef.current = null
    }
  }, [labels, data, accentColor])

  if (!labels?.length) {
    return (
      <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 12 }}>
        No data available for the selected filters.
      </div>
    )
  }

  return (
    <div style={{ height: 260, position: 'relative' }}>
      <canvas ref={canvasRef} role="img" aria-label="AI Overview events bar chart" />
    </div>
  )
}

// ─── NEW: Attribution grouped bar chart (dual Y-axes) ────────────────────────
function AttributionChart({ labels, organicData, aioOrgData, aioDirData }) {
  const canvasRef = useRef(null)
  const chartRef  = useRef(null)

  useEffect(() => {
    if (!canvasRef.current || !window.Chart) return
    if (!labels?.length) return

    chartRef.current = safeCreateChart(canvasRef.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Total Organic Sessions',
            data: organicData,
            backgroundColor: 'rgba(148, 163, 184, 0.55)',
            borderColor: '#94A3B8',
            borderWidth: 1,
            borderRadius: 3,
            borderSkipped: false,
            yAxisID: 'y1',
          },
          {
            label: 'AI Overview Events · Organic',
            data: aioOrgData,
            backgroundColor: '#1D9E75',
            borderRadius: 4,
            borderSkipped: false,
            yAxisID: 'y',
          },
          {
            label: 'AI Overview Events · Misattributed to Direct',
            data: aioDirData,
            backgroundColor: '#EF9F27',
            borderRadius: 4,
            borderSkipped: false,
            yAxisID: 'y',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 8 } },
        plugins: {
          datalabels: { display: false },
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              font: { size: 11, family: 'DM Sans, sans-serif' },
              color: '#374151',
              padding: 16,
              usePointStyle: true,
              pointStyleWidth: 10,
            },
          },
          tooltip: {
            backgroundColor: '#0A2540',
            titleColor: '#94A3B8',
            bodyColor: '#fff',
            padding: 14,
            cornerRadius: 8,
            callbacks: {
              label: ctx => {
                const v = ctx.raw ?? 0
                if (ctx.datasetIndex === 0) return `  Total Organic Sessions: ${v.toLocaleString()}`
                if (ctx.datasetIndex === 1) return `  AI Overview Events (Organic): ${v.toLocaleString()}`
                return `  AI Overview Events (Direct): ${v.toLocaleString()}`
              },
              afterBody: items => {
                const idx = items[0]?.dataIndex ?? 0
                const org = aioOrgData[idx] || 0
                const dir = aioDirData[idx] || 0
                const total = org + dir
                if (total === 0) return []
                const rate = ((dir / total) * 100).toFixed(1)
                return [`  Misattribution rate: ${rate}%`]
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              font: { size: 10, family: 'DM Sans, sans-serif' },
              color: '#374151',
              maxRotation: 45,
              autoSkip: true,
              maxTicksLimit: 16,
            },
          },
          y: {
            position: 'left',
            grid: { color: '#F1F5F9' },
            border: { display: false },
            beginAtZero: true,
            title: {
              display: true,
              text: 'AI Overview Events',
              font: { size: 10, family: 'DM Sans, sans-serif' },
              color: '#94A3B8',
            },
            ticks: {
              font: { size: 10, family: 'DM Sans, sans-serif' },
              color: '#374151',
              callback: v => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toLocaleString(),
            },
          },
          y1: {
            position: 'right',
            grid: { drawOnChartArea: false },   // no grid lines for right axis
            border: { display: false },
            beginAtZero: true,
            title: {
              display: true,
              text: 'Total Organic Sessions',
              font: { size: 10, family: 'DM Sans, sans-serif' },
              color: '#94A3B8',
            },
            ticks: {
              font: { size: 10, family: 'DM Sans, sans-serif' },
              color: '#94A3B8',
              callback: v => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toLocaleString(),
            },
          },
        },
      },
    })

    return () => {
      chartRef.current?.destroy()
      chartRef.current = null
    }
  }, [labels, organicData, aioOrgData, aioDirData])

  if (!labels?.length) {
    return (
      <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 12 }}>
        No attribution data available for this period.
      </div>
    )
  }

  return (
    <div style={{ height: 300, position: 'relative' }}>
      <canvas ref={canvasRef} role="img" aria-label="AI Overview attribution analysis chart" />
    </div>
  )
}

// ─── NEW: Share of Organic line chart ───────────────────────────────────────
function ShareOfOrganicChart({ labels, shareData }) {
  const canvasRef = useRef(null)
  const chartRef  = useRef(null)

  useEffect(() => {
    if (!canvasRef.current || !window.Chart) return
    if (!labels?.length) return

    chartRef.current = safeCreateChart(canvasRef.current, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'AI Overview share of organic sessions',
          data: shareData,
          borderColor: '#0F5FA6',
          backgroundColor: 'rgba(15, 95, 166, 0.08)',
          borderWidth: 2.5,
          pointRadius: 4,
          pointBackgroundColor: '#0F5FA6',
          pointHoverRadius: 6,
          fill: true,
          tension: 0.35,
          spanGaps: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 12 } },
        plugins: {
          datalabels: { display: false },
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0A2540',
            titleColor: '#94A3B8',
            bodyColor: '#fff',
            padding: 12,
            cornerRadius: 8,
            callbacks: {
              label: ctx => {
                const v = ctx.raw
                return v == null ? '  No data' : `  AI Overview share: ${v.toFixed(2)}%`
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              font: { size: 10, family: 'DM Sans, sans-serif' },
              color: '#374151',
              maxRotation: 45,
              autoSkip: true,
              maxTicksLimit: 16,
            },
          },
          y: {
            grid: { color: '#F1F5F9' },
            border: { display: false },
            beginAtZero: true,
            title: {
              display: true,
              text: '% of Organic Sessions',
              font: { size: 10, family: 'DM Sans, sans-serif' },
              color: '#94A3B8',
            },
            ticks: {
              font: { size: 10, family: 'DM Sans, sans-serif' },
              color: '#374151',
              callback: v => `${v}%`,
            },
          },
        },
      },
    })

    return () => {
      chartRef.current?.destroy()
      chartRef.current = null
    }
  }, [labels, shareData])

  if (!labels?.length) {
    return (
      <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 12 }}>
        No data available for this period.
      </div>
    )
  }

  return (
    <div style={{ height: 280, position: 'relative' }}>
      <canvas ref={canvasRef} role="img" aria-label="AI Overview share of organic sessions line chart" />
    </div>
  )
}

// ─── Share of Organic insight stat card ──────────────────────────────────────
function ShareOfOrganicInsights({ shareData, organicData, aioOrgData, aioDirData }) {
  // Average of non-null share values across the period
  const validPoints  = (shareData || []).filter(v => v != null)
  const avgShare     = validPoints.length > 0
    ? validPoints.reduce((s, v) => s + v, 0) / validPoints.length
    : 0

  const totalOrganic = (organicData || []).reduce((s, v) => s + v, 0)
  const totalAio     = (aioOrgData  || []).reduce((s, v) => s + v, 0)
                     + (aioDirData  || []).reduce((s, v) => s + v, 0)
  const overallShare = totalOrganic > 0 ? (totalAio / totalOrganic) * 100 : 0

  // Trend: compare first half vs second half of shareData
  const mid      = Math.floor(validPoints.length / 2)
  const firstH   = validPoints.slice(0, mid)
  const secondH  = validPoints.slice(mid)
  const avg1     = firstH.length  > 0 ? firstH.reduce((s, v)  => s + v, 0) / firstH.length  : null
  const avg2     = secondH.length > 0 ? secondH.reduce((s, v) => s + v, 0) / secondH.length : null
  const trendDir = avg1 != null && avg2 != null ? (avg2 > avg1 ? '↑' : avg2 < avg1 ? '↓' : '→') : ''
  const trendColor = trendDir === '↑' ? '#1D9E75' : trendDir === '↓' ? '#D97706' : '#64748B'

  const cardStyle = {
    background: '#F8FAFC',
    border: '1px solid #E2E8F0',
    borderRadius: 10,
    padding: '14px 18px',
    flex: 1,
  }

  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
      {/* Card 1 — Period average share */}
      <div style={cardStyle}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#0F5FA6', fontVariantNumeric: 'tabular-nums' }}>
          {avgShare.toFixed(2)}%
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#0A2540', marginTop: 2 }}>Avg AI Overview share of organic</div>
        <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 3, lineHeight: 1.4 }}>
          Average per {validPoints.length > 0 ? `${validPoints.length} ${validPoints.length === 1 ? 'period' : 'periods'}` : 'period'} in the selected date range
        </div>
      </div>

      {/* Card 2 — Overall (total-level) share */}
      <div style={cardStyle}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#0A2540', fontVariantNumeric: 'tabular-nums' }}>
          {overallShare.toFixed(2)}%
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#0A2540', marginTop: 2 }}>Overall share of organic</div>
        <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 3, lineHeight: 1.4 }}>
          Total AI Overview events ÷ total organic sessions for the full period
        </div>
      </div>

      {/* Card 3 — Trend direction */}
      <div style={cardStyle}>
        <div style={{ fontSize: 22, fontWeight: 700, color: trendColor, fontVariantNumeric: 'tabular-nums' }}>
          {trendDir || '—'}
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#0A2540', marginTop: 2 }}>Share trend</div>
        <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 3, lineHeight: 1.4 }}>
          {avg1 != null && avg2 != null
            ? `First half avg: ${avg1.toFixed(2)}% → second half avg: ${avg2.toFixed(2)}%`
            : 'Not enough data to compute trend'}
        </div>
      </div>
    </div>
  )
}

// ─── Attribution insight stat cards ──────────────────────────────────────────
function AttributionInsights({ organicData, aioOrgData, aioDirData }) {
  const totalOrg    = (aioOrgData  || []).reduce((s, v) => s + v, 0)
  const totalDir    = (aioDirData  || []).reduce((s, v) => s + v, 0)
  const trueTotal   = totalOrg + totalDir

  const misratePct  = trueTotal > 0 ? (totalDir / trueTotal) * 100 : 0
  const misrateColor = misratePct >= 20 ? '#D97706' : '#1D9E75'

  const cardStyle = {
    background: '#F8FAFC',
    border: '1px solid #E2E8F0',
    borderRadius: 10,
    padding: '14px 18px',
    flex: 1,
  }

  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
      {/* Stat 1 — Misattribution rate */}
      <div style={cardStyle}>
        <div style={{ fontSize: 22, fontWeight: 700, color: misrateColor, fontVariantNumeric: 'tabular-nums' }}>
          {misratePct.toFixed(1)}%
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#0A2540', marginTop: 2 }}>Misattribution rate</div>
        <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 3, lineHeight: 1.4 }}>
          of AI Overview events attributed to Direct instead of Organic Search
        </div>
      </div>

      {/* Stat 2 — True AI Overview events */}
      <div style={cardStyle}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#1D9E75', fontVariantNumeric: 'tabular-nums' }}>
          {trueTotal.toLocaleString()}
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#0A2540', marginTop: 2 }}>True AI Overview events</div>
        <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 3, lineHeight: 1.4 }}>
          Organic + misattributed Direct combined
        </div>
      </div>

      {/* Stat 3 — Organic Search AI Overview events (Bar 2 only) */}
      <div style={cardStyle}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#0A2540', fontVariantNumeric: 'tabular-nums' }}>
          {totalOrg.toLocaleString()}
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#0A2540', marginTop: 2 }}>Organic Search AI Overview events</div>
        <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 3, lineHeight: 1.4 }}>
          Events confirmed attributed to Organic Search by GA4 channel grouping
        </div>
      </div>
    </div>
  )
}

// ─── Chart skeleton placeholder ───────────────────────────────────────────────
function ChartSkeleton({ height = 300 }) {
  return (
    <>
      <style>{`@keyframes aio-pulse{0%,100%{opacity:1}50%{opacity:0.45}}`}</style>
      <div style={{
        height,
        borderRadius: 8,
        background: '#F1F5F9',
        animation: 'aio-pulse 1.4s ease-in-out infinite',
        marginTop: 8,
      }} />
    </>
  )
}

// ─── Granularity toggle — matches LLM Intelligence style ─────────────────────
const GRANS = ['Week', 'Month', 'Quarter', 'Year']

function GranToggle({ value, onChange }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      background: 'var(--bg, #F8FAFC)',
      border: '1px solid var(--border, #E2E8F0)',
      borderRadius: 6, padding: 2, gap: 1,
    }}>
      {GRANS.map(g => {
        const active = value === g
        return (
          <button
            key={g}
            onClick={() => onChange(g)}
            style={{
              padding: '4px 10px', border: 'none', borderRadius: 4,
              background: active ? '#0F5FA6' : 'transparent',
              color: active ? '#fff' : 'var(--subtext, #5A6A7A)',
              fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
              cursor: 'pointer', transition: 'all 0.12s', whiteSpace: 'nowrap',
            }}
          >
            {g}
          </button>
        )
      })}
    </div>
  )
}

// ─── View toggle: Click Volume | Attribution ──────────────────────────────────
function ViewToggle({ value, onChange }) {
  const VIEWS = ['Click Volume', 'Attribution', 'Share of Organic']
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center',
      background: '#F1F5F9',
      border: '1px solid #E2E8F0',
      borderRadius: 20, padding: 3, gap: 2,
    }}>
      {VIEWS.map(v => {
        const active = value === v
        return (
          <button
            key={v}
            onClick={() => onChange(v)}
            style={{
              padding: '4px 14px', border: 'none', borderRadius: 16,
              background: active ? '#fff' : 'transparent',
              color: active ? '#0A2540' : '#5A6A7A',
              fontSize: 11, fontWeight: active ? 700 : 500,
              fontFamily: 'inherit', cursor: 'pointer',
              transition: 'all 0.15s',
              boxShadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
            }}
          >
            {v}
          </button>
        )
      })}
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function AiOverviewCharts({
  trendData,
  gran,
  onGranChange,
  category,
  onCategoryChange,
  availableCategories,
  propertyId,
  dateRange,
}) {
  const [view, setView] = useState('Click Volume')

  // Attribution data state — lazy-fetched on first switch to Attribution view
  const [attrLoading, setAttrLoading]   = useState(false)
  const [attrError,   setAttrError]     = useState(null)
  const [attrFetched, setAttrFetched]   = useState(false)   // true once fetched for this dateRange
  const [organicRows, setOrganicRows]   = useState([])
  const [attrRows,    setAttrRows]      = useState([])

  // Re-fetch attribution when dateRange changes (reset cache)
  const prevDateRange = useRef(null)
  useEffect(() => {
    const key = `${dateRange?.startDate}|${dateRange?.endDate}`
    const prev = prevDateRange.current
    if (key !== prev) {
      prevDateRange.current = key
      setAttrFetched(false)
      setOrganicRows([])
      setAttrRows([])
      setAttrError(null)
    }
  }, [dateRange])

  const fetchAttribution = useCallback(async () => {
    if (!propertyId || !dateRange?.startDate) return
    setAttrLoading(true)
    setAttrError(null)
    try {
      const [organic, attr] = await Promise.all([
        fetchOrganicSessionsByWeek(propertyId, dateRange),
        fetchAttributionSessions(propertyId, dateRange),
      ])
      setOrganicRows(organic)
      setAttrRows(attr)
      setAttrFetched(true)
    } catch (err) {
      setAttrError(err?.message ?? 'Attribution data fetch failed')
    } finally {
      setAttrLoading(false)
    }
  }, [propertyId, dateRange])

  // Lazy-fetch when the user switches to Attribution or Share of Organic
  const handleViewChange = useCallback(v => {
    setView(v)
    if ((v === 'Attribution' || v === 'Share of Organic') && !attrFetched && !attrLoading) {
      fetchAttribution()
    }
  }, [attrFetched, attrLoading, fetchAttribution])

  // ── Click Volume derived data (unchanged) ──────────────────────────────────
  const { labels, data } = useMemo(
    () => aggregateBars(trendData ?? [], gran, category),
    [trendData, gran, category]
  )
  const accentColor = category === 'All' ? '#1D9E75' : (CATEGORY_COLORS[category] ?? '#1D9E75')
  const granLabel   = gran === 'Week' ? 'ISO week' : gran.toLowerCase()
  const cvSubtitle  = category === 'All'
    ? `All categories · per ${granLabel}`
    : `${category} · per ${granLabel}`

  // ── Attribution + Share of Organic derived data ────────────────────────────
  const { labels: attrLabels, organicData, aioOrgData, aioDirData, shareData } = useMemo(
    () => aggregateAttribution(organicRows, attrRows, gran),
    [organicRows, attrRows, gran]
  )

  const isAttribution   = view === 'Attribution'
  const isShareOfOrg    = view === 'Share of Organic'
  const needsAttrData   = isAttribution || isShareOfOrg

  const chartTitle = isAttribution
    ? 'AI Overview Attribution Analysis'
    : isShareOfOrg
      ? 'AI Overview Share of Organic Sessions'
      : 'AI Overview Events'

  const subtitle = isAttribution
    ? 'Organic traffic vs AI Overview events vs misattributed to Direct'
    : isShareOfOrg
      ? 'AI Overview events as a % of total organic sessions · by period'
      : cvSubtitle

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        background: '#fff',
        border: '1px solid #E2E8F0',
        borderRadius: 12,
        padding: '18px 22px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>

        {/* ── Row 1: title + subtitle ── */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0A2540', marginBottom: 2 }}>
            {chartTitle}
          </div>
          <div style={{ fontSize: 10, color: '#94A3B8' }}>{subtitle}</div>
        </div>

        {/* ── Row 2: view toggle (left) + granularity toggle (right) ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
          <ViewToggle value={view} onChange={handleViewChange} />
          <GranToggle value={gran} onChange={onGranChange} />
        </div>

        {/* ── Chart area ── */}
        {!isAttribution && !isShareOfOrg && (
          <BarChart labels={labels} data={data} accentColor={accentColor} />
        )}

        {/* Shared loading / error states for Attribution + Share of Organic */}
        {needsAttrData && attrLoading && (
          <ChartSkeleton height={300} />
        )}

        {needsAttrData && !attrLoading && attrError && (
          <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '14px 18px', color: '#92400E', marginTop: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 12 }}>⚠ Data error</div>
            <div style={{ fontSize: 11, marginBottom: 8 }}>{attrError}</div>
            <button
              onClick={fetchAttribution}
              style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #F97316', background: '#FFF7ED', color: '#C2410C', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
            >
              Retry
            </button>
          </div>
        )}

        {/* ── Attribution view ── */}
        {isAttribution && !attrLoading && !attrError && (
          <>
            <AttributionChart
              labels={attrLabels}
              organicData={organicData}
              aioOrgData={aioOrgData}
              aioDirData={aioDirData}
            />
            <AttributionInsights
              organicData={organicData}
              aioOrgData={aioOrgData}
              aioDirData={aioDirData}
            />

            {/* ── Methodology note ── */}
            <div style={{
              marginTop: 14,
              padding: '10px 14px',
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: 8,
              fontSize: 10.5,
              color: '#64748B',
              lineHeight: 1.6,
            }}>
              <span style={{ fontWeight: 700, color: '#475569' }}>ℹ️ Why this total is lower than the AI Overview Events KPI: </span>
              This chart only counts sessions GA4 attributed to <strong>Organic Search</strong> or <strong>Direct</strong> — the two expected channels for AI Overview traffic.
              The remaining events are distributed across other channels where GA4 overrode the attribution:
              {' '}<strong>Paid Search</strong> (when a paid ad touch exists in the same session),
              {' '}<strong>Email</strong>, <strong>Referral</strong>, <strong>Unassigned</strong>, and a small number of others.
              These are confirmed real AI Overview clicks — the <code style={{ background: '#E2E8F0', padding: '1px 4px', borderRadius: 3, fontSize: 10 }}>ai_overview_click</code> event fired — but GA4's session-level channel assignment took precedence.
            </div>
          </>
        )}

        {/* ── Share of Organic view ── */}
        {isShareOfOrg && !attrLoading && !attrError && (
          <>
            <ShareOfOrganicChart
              labels={attrLabels}
              shareData={shareData}
            />
            <ShareOfOrganicInsights
              shareData={shareData}
              organicData={organicData}
              aioOrgData={aioOrgData}
              aioDirData={aioDirData}
            />
          </>
        )}

      </div>
    </div>
  )
}
