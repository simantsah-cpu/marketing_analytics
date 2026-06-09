import { useState, useEffect, useCallback } from 'react'
import { useFilters } from '../context/FiltersContext'
import { useProperty } from '../context/PropertyContext'
import { supabase } from '../services/supabase'
import KPICard from '../components/KPICard'
import ChartCard from '../components/ChartCard'
import DateRangePill from '../components/DateRangePill'
import { granularityKey, granularityLabel } from '../utils/time-aggregation'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  PointElement, LineElement, BarElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import { Line, Bar } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale, LinearScale,
  PointElement, LineElement, BarElement,
  Title, Tooltip, Legend, Filler, ChartDataLabels,
)

// ─── Colour palette (matches Orbit) ──────────────────────────────────────────
const COLORS = {
  teal:    '#0D8A72',
  tealL:   '#E6F7F3',
  tealD:   '#0A6657',
  blue:    '#0F5FA6',
  blueL:   '#DBEAFE',
  red:     '#C0392B',
  redL:    '#FEE2E2',
  amber:   '#D97706',
  amberL:  '#FEF3C7',
  navy:    '#0A2540',
  muted:   '#5A6A7A',
  border:  '#E2E8F0',
  grid:    '#F1F5F9',
}

// ─── Chart option helpers ─────────────────────────────────────────────────────
function lineOpts(formatY = (v) => v) {
  return {
    responsive: true, maintainAspectRatio: false, spanGaps: false,
    plugins: {
      legend: { display: true, position: 'bottom', align: 'start', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 6, font: { family: 'DM Sans', size: 11 }, padding: 20 } },
      tooltip: { mode: 'index', intersect: false },
      datalabels: { display: false },
    },
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { grid: { display: false }, ticks: { font: { family: 'DM Sans', size: 11 }, color: COLORS.muted, maxTicksLimit: 10 } },
      y: { grid: { color: COLORS.grid }, border: { display: false }, ticks: { font: { family: 'DM Sans', size: 11 }, color: COLORS.muted, callback: formatY } },
    },
  }
}

// Variant for charts with mixed positive/negative values — draws a solid zero baseline
function lineOptsWithZero(formatY = (v) => v) {
  return {
    responsive: true, maintainAspectRatio: false,
    spanGaps: true,  // connect across nulls; also lets a single point render
    plugins: {
      legend: { display: true, position: 'bottom', align: 'start', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 6, font: { family: 'DM Sans', size: 11 }, padding: 20 } },
      tooltip: { mode: 'index', intersect: false },
      datalabels: { display: false },
    },
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { grid: { display: false }, offset: true, ticks: { font: { family: 'DM Sans', size: 11 }, color: COLORS.muted, maxTicksLimit: 10 } },
      y: {
        grid: { color: COLORS.grid },
        border: { display: false },
        ticks: {
          font: { family: 'DM Sans', size: 11 },
          color: COLORS.muted,
          callback: formatY,
          maxTicksLimit: 6,   // prevents label pile-up on small date ranges
        },
        beginAtZero: false,
        afterBuildTicks(axis) {
          if (axis.min > 0) axis.min = 0
        },
      },
    },
  }
}

function barOpts(data, formatLabel = (v) => v) {
  return {
    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
    plugins: {
      legend: { display: false },
      datalabels: { display: false },
      tooltip: { enabled: true, mode: 'index', intersect: false },
    },
    scales: {
      x: { display: false, grid: { display: false }, max: Math.max(...data) * 1.08 },
      y: {
        grid: { display: false }, border: { display: false },
        ticks: { font: { family: 'DM Sans', size: 11 }, color: COLORS.muted, padding: 8, autoSkip: false },
      },
      y2: {
        position: 'right', grid: { display: false }, border: { display: false },
        ticks: { font: { family: 'DM Sans', size: 11, weight: 700 }, color: COLORS.navy, padding: 8, callback: (_, i) => formatLabel(data[i]) },
      },
    },
  }
}

function roiColor(roi) {
  if (roi == null || isNaN(roi)) return COLORS.muted
  return roi >= 3 ? COLORS.teal : roi >= 1 ? COLORS.blue : roi >= 0 ? COLORS.amber : COLORS.red
}
function roiBg(roi) {
  if (roi == null || isNaN(roi)) return 'transparent'
  return roi >= 3 ? COLORS.tealL : roi >= 1 ? COLORS.blueL : roi >= 0 ? COLORS.amberL : COLORS.redL
}

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmt = {
  currency: (n) => {
    if (n == null || isNaN(n)) return '—'
    const a = Math.abs(n), sign = n < 0 ? '-' : ''
    if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`
    if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`
    return `${sign}$${a.toFixed(0)}`
  },
  number: (n) => {
    if (n == null || isNaN(n)) return '—'
    const a = Math.abs(n), sign = n < 0 ? '-' : ''
    if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1)}M`
    if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`
    return Math.round(n).toLocaleString()
  },
  // Show a number with exactly 2 decimal places (no K/M abbreviation) — used for bookings
  decimal2: (n) => {
    if (n == null || isNaN(n)) return '—'
    return (+n).toFixed(2)
  },
  percent: (n) => n == null || isNaN(n) ? '—' : `${(+n).toFixed(2)}%`,
  roi:     (n) => n == null || isNaN(n) ? '—' : Math.abs(+n) > 100 ? `${n < 0 ? '-' : ''}99x+` : `${(+n).toFixed(2)}x`,
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────
function PageSkeleton() {
  return (
    <div className="page-content">
      <div className="kpi-row kpi-row-5">
        {[...Array(5)].map((_, i) => <div key={i} className="skeleton" style={{ height: 110, borderRadius: 12 }} />)}
      </div>
      <div className="kpi-row kpi-row-5">
        {[...Array(5)].map((_, i) => <div key={i} className="skeleton" style={{ height: 110, borderRadius: 12 }} />)}
      </div>
      <div className="chart-row chart-row-2">
        {[...Array(2)].map((_, i) => <div key={i} className="skeleton" style={{ height: 260, borderRadius: 12 }} />)}
      </div>
      <div className="skeleton" style={{ height: 360, borderRadius: 12, marginTop: 16 }} />
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ onRefetch }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 420, gap: 18 }}>
      <div style={{ fontSize: 48 }}>📊</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: COLORS.navy }}>Report — 109</div>
      <div style={{ fontSize: 13, color: COLORS.muted, maxWidth: 420, textAlign: 'center', lineHeight: 1.75 }}>
        B2C Marketing Performance dashboard.<br/>
        Connect the <strong>BigQuery MCP server</strong> and click&nbsp;<em>Load Data</em>&nbsp;to populate KPIs, trend charts, and the channel breakdown table.
      </div>
      <button
        onClick={onRefetch}
        style={{
          marginTop: 8, background: COLORS.teal, color: '#fff', border: 'none',
          borderRadius: 10, padding: '12px 28px', fontFamily: 'inherit',
          fontSize: 14, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.01em',
          boxShadow: '0 4px 14px rgba(13,138,114,0.28)',
          transition: 'transform 0.15s, box-shadow 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(13,138,114,0.36)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(13,138,114,0.28)' }}
      >
        ↻ Load Data
      </button>
      <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>
        Edge function: <code style={{ background: '#f1f5f9', padding: '2px 7px', borderRadius: 5 }}>bigquery-report-109</code>
      </div>
    </div>
  )
}

// ─── Channel table ────────────────────────────────────────────────────────────
function ChannelTable({ channels, loading }) {
  const [sortCol, setSortCol] = useState('ttv')
  const [sortDir, setSortDir] = useState('desc')

  const sorted = [...(channels || [])].sort((a, b) => {
    const av = +a[sortCol], bv = +b[sortCol]
    if (isNaN(av) && isNaN(bv)) return 0
    if (isNaN(av)) return 1
    if (isNaN(bv)) return -1
    return sortDir === 'asc' ? av - bv : bv - av
  })

  const toggle = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  // Shared padding — must be identical on th and td so columns line up
  const PX = '10px 16px'

  const Th = ({ col, label, right, width }) => {
    const active = sortCol === col
    return (
      <th
        onClick={() => toggle(col)}
        style={{
          padding: PX,
          width,
          minWidth: width,
          fontSize: 11, fontWeight: 600,
          color: active ? COLORS.teal : COLORS.muted,
          background: '#f8f9fc', cursor: 'pointer',
          borderBottom: `2px solid ${active ? COLORS.teal : COLORS.border}`,
          borderTop: `1px solid ${COLORS.border}`,
          textTransform: 'uppercase', letterSpacing: '0.05em',
          whiteSpace: 'nowrap',
          textAlign: right ? 'right' : 'left',
          userSelect: 'none',
          position: 'relative',
        }}
      >
        {/* Sort arrow floated so it never shifts label text */}
        {right ? (
          <span style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}>
            <span>{label}</span>
            <span style={{ width: 10, display: 'inline-block', color: active ? COLORS.teal : 'transparent' }}>
              {active ? (sortDir === 'asc' ? '↑' : '↓') : '↓'}
            </span>
          </span>
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>{label}</span>
            <span style={{ width: 10, display: 'inline-block', color: active ? COLORS.teal : 'transparent' }}>
              {active ? (sortDir === 'asc' ? '↑' : '↓') : '↓'}
            </span>
          </span>
        )}
      </th>
    )
  }

  // Totals row — using new field names from updated query
  const tot = (channels || []).reduce(
    (a, r) => ({
      s:   a.s   + (+r.sessions         || 0),
      b:   a.b   + (+r.bookings         || 0),
      ttv: a.ttv + (+r.ttv              || 0),
      nc:  a.nc  + (+r.net_contribution || 0),
      sp:  a.sp  + (+r.spend_usd        || 0),
    }),
    { s: 0, b: 0, ttv: 0, nc: 0, sp: 0 }
  )
  const totRoi  = tot.sp > 0 ? +(tot.nc / tot.sp).toFixed(4) : null
  const totConv = tot.s  > 0 ? +(tot.b  / tot.s * 100).toFixed(4) : null

  if (loading) {
    return (
      <div style={{ padding: '24px 22px' }}>
        {[...Array(8)].map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 36, borderRadius: 8, marginBottom: 8 }} />
        ))}
      </div>
    )
  }

  if (!channels?.length) {
    return (
      <div style={{ padding: '40px 22px', textAlign: 'center', color: COLORS.muted, fontSize: 13 }}>
        No channel data available. Connect BigQuery to load.
      </div>
    )
  }

  // td helper — padding & fontSize must match th exactly
  const td = (content, opts = {}) => (
    <td style={{
      padding: PX,
      fontSize: 12,
      textAlign: opts.right ? 'right' : 'left',
      color: opts.color ?? COLORS.muted,
      fontWeight: opts.bold ? 600 : opts.bolder ? 700 : 400,
      whiteSpace: 'nowrap',
      ...opts.extra,
    }}>
      {content}
    </td>
  )

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 155 }} />  {/* Channel */}
          <col style={{ width: 90  }} />  {/* Sessions */}
          <col style={{ width: 88  }} />  {/* Bookings */}
          <col style={{ width: 76  }} />  {/* Conv % */}
          <col style={{ width: 95  }} />  {/* TTV */}
          <col style={{ width: 85  }} />  {/* ATV */}
          <col style={{ width: 95  }} />  {/* Spend USD */}
          <col style={{ width: 105 }} />  {/* Net Contribution */}
          <col style={{ width: 80  }} />  {/* ROI */}
        </colgroup>
        <thead>
          <tr>
            <Th col="channel"          label="Channel"         width={155} />
            <Th col="sessions"         label="Sessions"        width={90}  right />
            <Th col="bookings"         label="Bookings"        width={88}  right />
            <Th col="conv_pct"         label="Conv %"          width={76}  right />
            <Th col="ttv"              label="TTV"             width={95}  right />
            <Th col="atv"              label="ATV"             width={85}  right />
            <Th col="spend_usd"        label="Spend (USD)"     width={95}  right />
            <Th col="net_contribution" label="Net Contribution" width={105} right />
            <Th col="roi"              label="ROI"             width={80}  right />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${COLORS.grid}`, background: i % 2 === 0 ? '#fff' : '#fafbfd' }}>
              <td style={{ padding: PX, fontSize: 13, fontWeight: 500, color: COLORS.navy, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.channel}</td>
              {td(r.sessions != null ? fmt.number(r.sessions) : '—', { right: true })}
              {td(r.bookings != null ? fmt.decimal2(r.bookings) : '—', { right: true, bold: true, color: COLORS.navy })}
              <td style={{ padding: PX, fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {r.conv_pct != null
                  ? <span style={{ color: +r.conv_pct >= 5 ? COLORS.teal : +r.conv_pct >= 2 ? COLORS.navy : COLORS.muted, fontWeight: +r.conv_pct >= 5 ? 600 : 400 }}>{(+r.conv_pct).toFixed(2)}%</span>
                  : <span style={{ color: COLORS.muted }}>—</span>}
              </td>
              {td(r.ttv ? fmt.currency(r.ttv) : '—', { right: true, bold: true, color: COLORS.navy })}
              {td(r.atv ? fmt.currency(r.atv) : '—', { right: true })}
              {td(r.spend_usd != null ? (+r.spend_usd > 0 ? fmt.currency(r.spend_usd) : '$0') : '—', { right: true, color: +r.spend_usd > 0 ? COLORS.navy : COLORS.muted })}
              {td(r.net_contribution != null ? fmt.currency(r.net_contribution) : '—', { right: true, bold: true, color: +r.net_contribution < 0 ? COLORS.red : COLORS.navy })}
              <td style={{ padding: PX, textAlign: 'right', whiteSpace: 'nowrap' }}>
                {r.roi != null
                  ? <span style={{ fontSize: 11, fontWeight: 700, color: roiColor(r.roi), background: roiBg(r.roi), padding: '3px 8px', borderRadius: 12 }}>{fmt.roi(r.roi)}</span>
                  : <span style={{ fontSize: 11, color: COLORS.muted }}>—</span>}
              </td>
            </tr>
          ))}

          {/* Totals row */}
          <tr style={{ background: '#EFF9F6', borderTop: `2px solid ${COLORS.teal}` }}>
            <td style={{ padding: PX, fontSize: 12, fontWeight: 700, color: COLORS.teal }}>TOTAL</td>
            {td(fmt.number(tot.s),    { right: true, bold: true, color: COLORS.navy })}
            {td(fmt.decimal2(tot.b),  { right: true, bold: true, color: COLORS.navy })}
            {td(totConv != null ? `${totConv.toFixed(2)}%` : '—', { right: true, bold: true })}
            {td(fmt.currency(tot.ttv), { right: true, bold: true, color: COLORS.navy })}
            {td('—',                  { right: true })}
            {td(fmt.currency(tot.sp), { right: true, bold: true, color: COLORS.navy })}
            {td(fmt.currency(tot.nc), { right: true, bolder: true, color: tot.nc < 0 ? COLORS.red : COLORS.teal })}
            <td style={{ padding: PX, textAlign: 'right' }}>
              {totRoi != null
                ? <span style={{ fontSize: 11, fontWeight: 700, color: roiColor(totRoi), background: roiBg(totRoi), padding: '3px 8px', borderRadius: 12 }}>{fmt.roi(totRoi)}</span>
                : <span style={{ color: COLORS.muted }}>—</span>}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}


// ─── Main page component ──────────────────────────────────────────────────────
export default function Report109() {
  const { filters }            = useFilters()
  const { selectedProperty }   = useProperty()

  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  // ── Comparison mode ──────────────────────────────────────────────────────
  const [compMode, setCompMode] = useState('prev') // 'prev' | 'yoy'

  // ── Active trend metric & granularity ─────────────────────────────────────
  const [activeMetric, setActiveMetric] = useState('ttv')
  const [granularity, setGranularity]   = useState('day')

  // ── BigQuery filter values (from global FilterBar) ───────────────────────
  const r109Platform     = filters.r109Platform     ?? ['APP', 'WEB']
  const r109Channel      = filters.r109Channel      ?? []
  const r109ExchangeRate = filters.r109ExchangeRate ?? 0.744

  // ── Fetch from edge function ──────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!selectedProperty) return
    setLoading(true)
    setError(null)
    try {
      const { primary, comparison: compRange } = filters.dateRanges ?? {}
      const dateRangesArray = [primary, compRange].filter(Boolean)

      const { data: result, error: fnError } = await supabase.functions.invoke('bigquery-report-109', {
        body: {
          propertyId:     selectedProperty?.ga4_property_id,
          dateRanges:     dateRangesArray,
          compMode,
          platformFilter: r109Platform,
          channelFilter:  r109Channel,
          exchangeRate:   r109ExchangeRate,  // GBP → USD conversion rate
        },
      })
      if (fnError) throw new Error(fnError.message)
      setData(result)
    } catch (err) {
      setError(err.message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [selectedProperty, filters.dateRanges, compMode, r109Platform, r109Channel, r109ExchangeRate])

  useEffect(() => {
    // Auto-fetch when property/filters change (will no-op if edge fn not deployed)
    fetchData()
  }, [fetchData])

  // ── Derived comparison values ─────────────────────────────────────────────
  const curr    = data?.curr    ?? null
  const comp    = compMode === 'yoy' ? data?.yoy : data?.prev
  const trend   = data?.trend   ?? []
  const channels = data?.channels ?? []
  const meta    = data?.meta    ?? {}

  // ── Trend chart metric mapping ────────────────────────────────────────────
  const METRIC_OPTIONS = [
    { key: 'ttv',  label: 'Revenue',          field: 'ttv',  formatY: v => v >= 1000 ? `$${(v/1000).toFixed(0)}K` : `$${v}` },
    { key: 's',    label: 'Sessions',          field: 's',    formatY: v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v) },
    { key: 'b',    label: 'Bookings',          field: 'b',    formatY: v => String(v) },
    { key: 'np',   label: 'Net Contribution',  field: 'np',   formatY: v => { const a=Math.abs(v); const s=v<0?'-':''; return a>=1000?`${s}$${(a/1000).toFixed(0)}K`:`${s}$${v}` } },
    { key: 'conv', label: 'Conv %',            field: 'conv', formatY: v => `${v}%` },
    { key: 'sp',   label: 'Spend (USD)',        field: 'sp',   formatY: v => v >= 1000 ? `$${(v/1000).toFixed(0)}K` : `$${v}` },
  ]
  const activeMet = METRIC_OPTIONS.find(m => m.key === activeMetric) ?? METRIC_OPTIONS[0]

  // ── Aggregate trend by granularity ───────────────────────────────────────
  const aggregatedTrend = (() => {
    if (!trend.length) return []
    const normalised = trend.map(r => ({ ...r, date: r.d ?? r.date ?? '' }))
    const buckets = {}
    normalised.forEach(row => {
      const key = granularityKey(row.date, granularity)
      if (!buckets[key]) buckets[key] = { key, s: 0, b: 0, ttv: 0, sp: 0, np: 0, conv_sum: 0, conv_count: 0 }
      buckets[key].s    += row.s    ?? 0
      buckets[key].b    += row.b    ?? 0
      buckets[key].ttv  += row.ttv  ?? 0
      buckets[key].sp   += row.sp   ?? 0
      buckets[key].np   += row.np   ?? 0
      buckets[key].conv_sum   += row.conv ?? 0
      buckets[key].conv_count += 1
    })
    return Object.values(buckets)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(r => ({ ...r, conv: r.conv_count > 0 ? +(r.conv_sum / r.conv_count).toFixed(3) : 0 }))
  })()

  // ── Pad sparse trends so the x-axis always spans the full chart width ─────
  // When there are very few data points (e.g. single-day view), the chart
  // looks squashed with the point(s) bunched at one edge. Padding with null
  // entries before and after gives the axis enough ticks to fill the full width.
  const PAD_THRESHOLD = 5   // pad when fewer than this many real data points
  const PAD_SIZE      = 4   // null entries added on each side
  const displayTrend = (() => {
    if (aggregatedTrend.length === 0 || aggregatedTrend.length >= PAD_THRESHOLD) return aggregatedTrend
    const nullEntry = { key: '', s: null, b: null, ttv: null, sp: null, np: null, conv: null }
    const before = Array.from({ length: PAD_SIZE }, (_, i) => ({ ...nullEntry, key: `__pre${i}` }))
    const after  = Array.from({ length: PAD_SIZE }, (_, i) => ({ ...nullEntry, key: `__post${i}` }))
    return [...before, ...aggregatedTrend, ...after]
  })()

  // Labels: padding entries get an empty string so the tick is invisible on the axis
  const trendLabels = displayTrend.map(r =>
    r.key.startsWith('__') ? '' : granularityLabel(r.key, granularity)
  )


  // ── Trend line chart data ─────────────────────────────────────────────────
  const trendChartData = {
    labels: trendLabels,
    datasets: [{
      label: meta.curr_range ?? 'Current Period',
      data: displayTrend.map(r => r[activeMet.field] ?? null),
      borderColor: COLORS.teal,
      backgroundColor: 'transparent',
      fill: false, tension: 0.4, borderWidth: 2.5,
      pointRadius: 3, pointBackgroundColor: COLORS.teal, pointBorderColor: '#fff', pointBorderWidth: 1,
    }],
  }

  // ── Spend vs Net Contribution chart ──────────────────────────────────────
  const spendVsNpData = {
    labels: trendLabels,
    datasets: [
      {
        label: 'Net Contribution',
        data: displayTrend.map(r => r.np ?? null),
        borderColor: COLORS.teal, backgroundColor: 'transparent',
        fill: false, tension: 0.4, borderWidth: 2.5,
        // pointRadius > 0 ensures a single data point renders as a visible dot
        pointRadius: 4, pointBackgroundColor: COLORS.teal, pointBorderColor: '#fff', pointBorderWidth: 1.5,
      },
      {
        label: 'Spend (USD)',
        data: displayTrend.map(r => r.sp ?? null),
        borderColor: COLORS.red, backgroundColor: 'transparent',
        fill: false, tension: 0.4, borderWidth: 1.8, borderDash: [5, 4],
        pointRadius: 4, pointBackgroundColor: COLORS.red, pointBorderColor: '#fff', pointBorderWidth: 1.5,
      },
    ],
  }

  // ── Channel bar chart (top 8 by TTV) ─────────────────────────────────────
  const topChannels = [...channels]
    .filter(c => c.ttv > 0)
    .sort((a, b) => b.ttv - a.ttv)
    .slice(0, 8)

  const channelBarData = {
    labels: topChannels.map(c => c.channel),
    datasets: [{
      data: topChannels.map(c => c.ttv),
      backgroundColor: COLORS.teal,
      borderRadius: 4,
      barThickness: 16,
    }],
  }

  // ── KPI rows ──────────────────────────────────────────────────────────────
  const paidSearch = channels.find(c => c.channel === 'Paid Search')

  const kpiRow1 = [
    { label: 'Total Sessions',   value: curr?.sessions,         prev: comp?.sessions,         format: 'number',   sub: 'overall_sessions' },
    { label: 'Bookings',         value: curr?.bookings,         prev: comp?.bookings,         format: 'number',   sub: 'keyEvents' },
    { label: 'Purchase Revenue', value: curr?.ttv,              prev: comp?.ttv,              format: 'currency', sub: 'Total TTV', primary: true },
    { label: 'Net Contribution', value: curr?.net_contribution, prev: comp?.net_contribution, format: 'currency', sub: 'actual_profit' },
    { label: 'Conv. Rate',       value: curr?.conv_pct,         prev: comp?.conv_pct,         format: 'percent',  sub: 'Bookings ÷ Sessions' },
  ]

  const kpiRow2 = [
    { label: 'Avg Ticket Value',  value: curr?.atv,       prev: comp?.atv,       format: 'currency-decimal', decimals: 2, sub: 'TTV ÷ Bookings' },
    { label: 'Spend (USD)',       value: curr?.spend_usd, prev: comp?.spend_usd, format: 'currency', sub: `Spend ÷ ${r109ExchangeRate} GBP→USD` },
    { label: 'Overall ROI',       value: curr?.roi,       prev: comp?.roi,       format: 'number',  decimals: 2, sub: 'Net Contribution ÷ Spend' },
    { label: 'Paid Search ROI',   value: paidSearch?.roi, prev: null, format: 'number', decimals: 2,
      sub: paidSearch?.spend_usd ? `$${paidSearch.spend_usd >= 1000 ? Math.round(paidSearch.spend_usd/1000)+'K' : paidSearch.spend_usd} spend` : 'Paid Search channel' },
  ]

  // ── Show loading skeleton on first mount ──────────────────────────────────
  if (loading && !data) return <PageSkeleton />

  // ── Show empty state if no data yet ──────────────────────────────────────
  if (!data && !loading) return (
    <div className="page-content fade-in">
      <EmptyState onRefetch={fetchData} />
    </div>
  )

  return (
    <div className="page-content fade-in">

      {/* Error banner */}
      {error && (
        <div style={{ background: COLORS.redL, border: `1px solid ${COLORS.red}`, borderRadius: 10, padding: '12px 18px', marginBottom: 16, fontSize: 13, color: COLORS.red, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>⚠</span>
          <span>{error}</span>
          <button onClick={fetchData} style={{ marginLeft: 'auto', background: COLORS.red, color: '#fff', border: 'none', borderRadius: 7, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Retry</button>
        </div>
      )}

      {/* Date range + comparison toggle header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <DateRangePill dateRanges={filters.dateRanges} comparison={filters.comparison} />

        {/* Comparison toggle */}
        <div style={{ display: 'flex', background: '#f0f2f5', borderRadius: 8, padding: 2, gap: 2, marginLeft: 'auto' }}>
          {[['prev', 'vs Prev Period'], ['yoy', 'vs Last Year']].map(([k, l]) => (
            <button
              key={k}
              onClick={() => setCompMode(k)}
              style={{
                padding: '6px 13px', fontSize: 11, fontWeight: compMode === k ? 700 : 500,
                borderRadius: 6, border: 'none',
                background: compMode === k ? '#fff' : 'transparent',
                color: compMode === k ? COLORS.navy : COLORS.muted,
                cursor: 'pointer', fontFamily: 'inherit',
                boxShadow: compMode === k ? '0 1px 3px rgba(0,0,0,0.07)' : 'none',
                transition: 'all 0.15s',
              }}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Refresh button */}
        <button
          onClick={fetchData}
          disabled={loading}
          style={{ background: loading ? COLORS.tealL : COLORS.teal, color: loading ? COLORS.teal : '#fff', border: 'none', borderRadius: 8, padding: '7px 16px', fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' }}
        >
          {loading ? '…' : '↻ Refresh'}
        </button>
      </div>

      {/* KPI ROW 1 */}
      <div className="kpi-row kpi-row-5" style={{ marginBottom: 12 }}>
        {kpiRow1.map(({ label, value, prev, format, sub, primary }) => (
          <KPICard
            key={label}
            label={label}
            value={value}
            prev={prev}
            format={format}
            sub={sub}
            primary={primary}
          />
        ))}
      </div>

      {/* KPI ROW 2 */}
      <div className="kpi-row kpi-row-5" style={{ marginBottom: 24 }}>
        {kpiRow2.map(({ label, value, prev, format, decimals, sub }) => (
          <KPICard
            key={label}
            label={label}
            value={value}
            prev={prev}
            format={format}
            decimals={decimals}
            sub={sub}
          />
        ))}
      </div>

      {/* ── Metric pill row + granularity toggle (shared across both charts) ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        {/* Metric pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {METRIC_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveMetric(key)}
              style={{
                padding: '5px 13px', fontSize: 12,
                fontWeight: activeMetric === key ? 700 : 500,
                borderRadius: 20,
                border: `1.5px solid ${activeMetric === key ? COLORS.teal : COLORS.border}`,
                background: activeMetric === key ? COLORS.teal : '#fff',
                color: activeMetric === key ? '#fff' : COLORS.muted,
                cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.14s',
                boxShadow: activeMetric === key ? '0 2px 8px rgba(13,138,114,0.2)' : 'none',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Granularity toggle */}
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: `1px solid ${COLORS.border}`, background: '#fff' }}>
          {['Day', 'Week', 'Month', 'Quarter', 'Year'].map((g, i, arr) => (
            <button
              key={g}
              onClick={() => setGranularity(g.toLowerCase())}
              style={{
                padding: '5px 12px', border: 'none',
                borderRight: i < arr.length - 1 ? `1px solid ${COLORS.border}` : 'none',
                background: granularity === g.toLowerCase() ? COLORS.navy : 'transparent',
                color: granularity === g.toLowerCase() ? '#fff' : COLORS.muted,
                fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
                cursor: 'pointer', transition: 'all 0.12s', lineHeight: 1.6,
              }}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Performance Trend — full width */}
      <div className="chart-card" style={{ marginBottom: 16 }}>
        <div className="chart-header">
          <div>
            <div className="chart-title">Performance Trend</div>
            {meta.curr_range && <div className="chart-sub">{meta.curr_range} · {granularity.charAt(0).toUpperCase() + granularity.slice(1)} view</div>}
          </div>
          <span className="chart-tag">TREND</span>
        </div>
        <div className="chart-wrap">
          <div style={{ height: 280 }}>
            <Line data={trendChartData} options={lineOpts(activeMet.formatY)} />
          </div>
        </div>
      </div>

      {/* Spend vs Net Profit — full width, below */}
      <ChartCard
        title="Spend vs Net Profit"
        subtitle={`${granularity.charAt(0).toUpperCase() + granularity.slice(1)} view · ${meta.curr_range ?? ''}`}
        tag="PROFIT"
        style={{ marginBottom: 16 }}
      >
        <div style={{ height: 280 }}>
          <Line data={spendVsNpData} options={lineOptsWithZero(v => { const a = Math.abs(v); const s = v < 0 ? '-' : ''; return a >= 1000 ? `${s}$${(a/1000).toFixed(0)}K` : `${s}$${v}` })} />
        </div>
      </ChartCard>

      {/* CHANNEL BREAKDOWN TABLE */}
      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.07)', border: `1px solid ${COLORS.border}`, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.navy }}>Channel Breakdown</div>
            <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>
              {meta.curr_range ? `${meta.curr_range} · ` : ''}Live from BigQuery
            </div>
          </div>
          <span style={{ fontSize: 11, color: COLORS.muted, background: '#f1f5f9', padding: '4px 10px', borderRadius: 6 }}>
            {channels.length} channels
          </span>
        </div>
        <ChannelTable channels={channels} loading={loading && !!data} />
      </div>


    </div>
  )
}
