/**
 * AiOverviewCharts.jsx — Section B: AI Overview Events bar chart.
 *
 * Features:
 *  - Bar chart (matching Executive Summary / LLM Intelligence style)
 *  - Day | Week | Month | Quarter | Year granularity toggle
 *  - Category filter pills (All + Transfer times, Travel timing, etc.)
 *  - Canvas lifecycle safe for React StrictMode (safeCreateChart helper)
 *
 * Props:
 *   weeklyTotals    — [{ week: '202618', label: 'W18 · Apr 28', events: 1024 }]
 *   trendData       — raw rows: [{ yearWeek, 'customEvent:ai_overview_click', eventCount }]
 *   categoryBreakdown — [{ label, events, pct }] from buildCategoryBreakdown
 */
import { useEffect, useRef, useState, useMemo } from 'react'
import { CATEGORY_COLORS, SNIPPET_KEY, categorise, weekLabel } from './aiOverviewUtils'

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

// ─── Granularity bucket key from a Date ───────────────────────────────────────
function bucketKey(date, gran) {
  if (!date) return ''
  const y = date.getFullYear()
  const m = date.getMonth() // 0-based
  const d = date.getDate()
  switch (gran) {
    case 'Month':   return `${y}-${String(m + 1).padStart(2, '0')}`
    case 'Quarter': return `${y}-Q${Math.floor(m / 3) + 1}`
    case 'Year':    return `${y}`
    default:        return `${y}-W${String(parseInt(String(date).slice(0, 4) === String(y) ? 1 : 1)).padStart(2, '0')}` // fallback Week
  }
}

function bucketKeyFromWeek(yearWeek, gran) {
  const date = isoWeekToDate(yearWeek)
  if (!date) return yearWeek
  const y = date.getFullYear()
  const m = date.getMonth()
  switch (gran) {
    case 'Week':    return yearWeek  // keep as-is
    case 'Month':   return `${y}-${String(m + 1).padStart(2, '0')}`
    case 'Quarter': return `${y}-Q${Math.floor(m / 3) + 1}`
    case 'Year':    return `${y}`
    default:        return yearWeek  // Day not possible with weekly data → show as weekly
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
    default:        return weekLabel(key) // Week
  }
}

// ─── Aggregate weekly data rows by granularity + optional category ────────────
function aggregateBars(trendRows, gran, selectedCategory) {
  if (!trendRows?.length) return { labels: [], data: [] }

  const buckets = {}  // key → total events

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

// ─── Bar chart canvas component ───────────────────────────────────────────────
function BarChart({ labels, data, accentColor }) {
  const canvasRef = useRef(null)
  const chartRef  = useRef(null)

  useEffect(() => {
    if (!canvasRef.current || !window.Chart) return
    if (!labels?.length) return

    // ── Custom plugin: draw value on top of each bar ──────────────────────────
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
        clip: false,                          // allow labels to draw above chart area
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 24 } },    // room for bar-top labels
        plugins: {
          datalabels: { display: false },   // suppress global chartjs-plugin-datalabels
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
      // top-level plugins array — this is how Chart.js v4 accepts inline plugins
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

// ─── Category pills — All + each known category ───────────────────────────────
const ALL_CATEGORIES = ['All', ...Object.keys(CATEGORY_COLORS)]

function CategoryPills({ value, onChange, available }) {
  // Only show categories that have data
  const visible = ALL_CATEGORIES.filter(c => c === 'All' || available.has(c))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {visible.map(cat => {
        const active = value === cat
        const color  = cat === 'All' ? '#0F5FA6' : CATEGORY_COLORS[cat]
        return (
          <button
            key={cat}
            onClick={() => onChange(cat)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', border: `1px solid ${active ? color : 'var(--border, #E2E8F0)'}`,
              borderRadius: 20,
              background: active ? color : '#fff',
              color: active ? '#fff' : 'var(--subtext, #5A6A7A)',
              fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
              cursor: 'pointer', transition: 'all 0.12s',
            }}
          >
            {cat !== 'All' && (
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: active ? 'rgba(255,255,255,0.8)' : color,
                flexShrink: 0, display: 'inline-block',
              }} />
            )}
            {cat}
          </button>
        )
      })}
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function AiOverviewCharts({ trendData, gran, onGranChange, category, onCategoryChange, availableCategories }) {
  // category is now controlled from AiOverviewSection (shared across all sub-components)

  // Compute bar chart labels + data
  const { labels, data } = useMemo(
    () => aggregateBars(trendData ?? [], gran, category),
    [trendData, gran, category]
  )

  // Pick accent colour based on selected category
  const accentColor = category === 'All' ? '#1D9E75' : (CATEGORY_COLORS[category] ?? '#1D9E75')

  // Subtitle text
  const granLabel = gran === 'Week' ? 'ISO week' : gran.toLowerCase()
  const subtitle  = category === 'All'
    ? `All categories · per ${granLabel}`
    : `${category} · per ${granLabel}`

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        background: '#fff',
        border: '1px solid #E2E8F0',
        borderRadius: 12,
        padding: '18px 22px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>

        {/* ── Header row: title + granularity toggle ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0A2540', marginBottom: 2 }}>
              AI Overview Events
            </div>
            <div style={{ fontSize: 10, color: '#94A3B8' }}>{subtitle}</div>
          </div>
          <GranToggle value={gran} onChange={onGranChange} />
        </div>

        {/* ── Bar chart ── */}
        <BarChart labels={labels} data={data} accentColor={accentColor} />

      </div>
    </div>
  )
}
