/**
 * BlogBannerFunnel.jsx — Blog Banner Dashboard
 * Route: /blog-banner-funnel
 *
 * Uses the app design system (index.css tokens + shared component classes).
 * All data pulled live from GA4 property 259261360 via ga4-raw-query edge function.
 * 17 reports in a single edge-function call.
 */

import { useEffect, useState, useCallback } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import ChartCard from '../components/ChartCard'
import { useFilters } from '../context/FiltersContext'

import ChartDataLabels from 'chartjs-plugin-datalabels'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend, ChartDataLabels)

// ─── Config ───────────────────────────────────────────────────────────────────

const PROP_ID   = '259261360'
const QUERY_URL = 'https://fpwgnceigulqonjdzfbo.supabase.co/functions/v1/ga4-raw-query'
const QUERY_SEC = 'qa_pull_2026_hoppa'

const KNOWN_BANNER_PAGES = [
  '/en/discover/transportation/how-to-get-from-alicante-to-benidorm',
  '/en/discover/top-picks/best-punta-cana-airport-transfers',
  '/en/discover/transportation/how-to-get-from-prague-airport-to-city-centre',
  '/en/discover/top-picks/best-airport-transfers-tenerife',
  '/en/discover/transportation/how-to-get-from-krakow-airport-to-city-centre',
  '/en/discover/transportation/how-to-get-from-barcelona-airport-to-city-centre',
  '/en/discover/transportation/how-to-get-to-metlife-stadium-from-nyc',
  '/en/discover/transportation/how-to-get-from-budapest-airport-to-city-centre',
]

const BANNER_PAGES_SET = new Set(KNOWN_BANNER_PAGES)

const PAGE_LABEL = {
  '/en/discover/transportation/how-to-get-from-alicante-to-benidorm': 'Alicante → Benidorm',
  '/en/discover/top-picks/best-punta-cana-airport-transfers':          'Punta Cana',
  '/en/discover/transportation/how-to-get-from-prague-airport-to-city-centre': 'Prague',
  '/en/discover/top-picks/best-airport-transfers-tenerife':            'Tenerife',
  '/en/discover/transportation/how-to-get-from-krakow-airport-to-city-centre': 'Kraków',
  '/en/discover/transportation/how-to-get-from-barcelona-airport-to-city-centre': 'Barcelona',
  '/en/discover/transportation/how-to-get-to-metlife-stadium-from-nyc': 'MetLife Stadium',
  '/en/discover/transportation/how-to-get-from-budapest-airport-to-city-centre': 'Budapest',
}

// Shorter /path for table display
const PAGE_SHORT = {
  '/en/discover/transportation/how-to-get-from-alicante-to-benidorm': '/alicante-to-benidorm',
  '/en/discover/top-picks/best-punta-cana-airport-transfers':          '/best-punta-cana-airport-transfers',
  '/en/discover/transportation/how-to-get-from-prague-airport-to-city-centre': '/prague-airport-to-city-centre',
  '/en/discover/top-picks/best-airport-transfers-tenerife':            '/best-airport-transfers-tenerife',
  '/en/discover/transportation/how-to-get-from-krakow-airport-to-city-centre': '/krakow-airport-to-city-centre',
  '/en/discover/transportation/how-to-get-from-barcelona-airport-to-city-centre': '/barcelona-airport-to-city-centre',
  '/en/discover/transportation/how-to-get-to-metlife-stadium-from-nyc': '/metlife-stadium-from-nyc',
  '/en/discover/transportation/how-to-get-from-budapest-airport-to-city-centre': '/budapest-airport-to-city-centre',
}


async function runGA4(requests) {
  const res = await fetch(QUERY_URL, {
    method: 'POST',
    headers: { 'x-query-secret': QUERY_SEC, 'Content-Type': 'application/json' },
    body: JSON.stringify({ propertyId: PROP_ID, requests }),
  })
  if (!res.ok) throw new Error(`GA4 HTTP ${res.status}`)
  const d = await res.json()
  if (d.error) throw new Error(d.error)
  return d.reports ?? []
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v, fallback = 0) { return v ?? fallback }
function fmt(v) {
  if (v == null) return '—'
  return v >= 1000 ? v.toLocaleString('en-GB') : String(v)
}
function pct(num, den) {
  if (!den) return '—'
  return (num / den * 100).toFixed(1) + '%'
}
function fmtDate(raw) {
  const y = raw.slice(0, 4), m = parseInt(raw.slice(4, 6)) - 1, d = parseInt(raw.slice(6, 8))
  return new Date(y, m, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
function pageBase(path) { return path.split('?')[0].split('#')[0] }
function extractPath(url) {
  try { return new URL(url).pathname } catch { return url }
}

// ─── Chart defaults ───────────────────────────────────────────────────────────

const BLUE = '#0F5FA6'
const TEAL = '#0D8A72'
const FONT = { family: 'DM Sans', size: 11 }

const baseBarOpts = (indexAxis = 'x') => ({
  responsive: true,
  maintainAspectRatio: false,
  indexAxis,
  plugins: {
    legend: { display: false },
    tooltip: { callbacks: { label: ctx => ` ${ctx.raw}` } },
    datalabels: false,
  },
  scales: {
    x: { grid: { color: indexAxis === 'y' ? 'transparent' : '#F1F5F9' }, ticks: { font: FONT, color: '#5A6A7A' }, border: { display: false } },
    y: { grid: { color: indexAxis === 'x' ? 'transparent' : '#F1F5F9' }, ticks: { font: FONT, color: '#5A6A7A' }, border: { display: false } },
  },
})

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function Skel({ h = 16, mb = 0 }) {
  return (
    <div style={{
      height: h, borderRadius: 6, marginBottom: mb,
      background: 'linear-gradient(90deg,#EBF2FA 25%,#F5F9FD 50%,#EBF2FA 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite linear',
    }} />
  )
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHead({ label, note }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginTop: 8, marginBottom: 14,
      borderBottom: '1px solid var(--border)', paddingBottom: 10,
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--subtext)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </span>
      {note && <span style={{ fontSize: 11, color: 'var(--subtext)' }}>{note}</span>}
    </div>
  )
}

// ─── Simple collapsible ───────────────────────────────────────────────────────

function Collapsible({ title, note, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="chart-card" style={{ marginBottom: 0 }}>
      <div className="chart-header" style={{ marginBottom: open ? 16 : 0, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <div>
          <div className="chart-title">{title}</div>
          {note && <div className="chart-sub">{note}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            style={{
              background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
              padding: '3px 10px', fontSize: 10, fontWeight: 600, color: 'var(--subtext)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
            onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
          >
            {open ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>
      {open && <div className="chart-wrap">{children}</div>}
    </div>
  )
}

// ─── Chart caption ───────────────────────────────────────────────────────────────

function Note({ children }) {
  return (
    <div style={{
      marginTop: 12, paddingTop: 10,
      borderTop: '1px solid var(--border)',
      fontSize: 11, color: 'var(--subtext)', lineHeight: 1.65,
    }}>
      {children}
    </div>
  )
}

// ─── Sortable table helpers ────────────────────────────────────────────────────

function useSortState(defaultCol, defaultDir = 'desc') {
  const [sortCol, setSortCol] = useState(defaultCol)
  const [sortDir, setSortDir] = useState(defaultDir)
  const toggle = col => {
    if (col === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }
  const sort = (rows, getters) => [...rows].sort((a, b) => {
    const va = getters[sortCol]?.(a) ?? 0
    const vb = getters[sortCol]?.(b) ?? 0
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb
    return sortDir === 'asc' ? cmp : -cmp
  })
  return { sortCol, sortDir, toggle, sort }
}

function STh({ col, label, sc, sd, onSort, style = {} }) {
  const active = sc === col
  return (
    <th
      onClick={() => onSort(col)}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', ...style }}
    >
      {label}
      <span style={{ marginLeft: 4, fontSize: 9, opacity: active ? 1 : 0.25, color: active ? 'var(--blue)' : 'inherit' }}>
        {active ? (sd === 'asc' ? '▲' : '▼') : '⬍'}
      </span>
    </th>
  )
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function BlogBannerFunnel() {
  const { filters } = useFilters()
  const [data, setData]              = useState(null)
  const [loading, setLoading]        = useState(true)
  const [error, setError]            = useState(null)
  const [refreshed, setRefreshed]    = useState(null)
  const [clickGranularity, setClickGranularity] = useState('day')

  // Per-table sort states
  const ctrSort     = useSortState('ctr',     'desc')
  const srcMedSort  = useSortState('sessions','desc')
  const geoSort     = useSortState('sessions','desc')
  const originSort  = useSortState('sessions','desc')
  const midSort     = useSortState('sessions','desc')

  const startDate = filters.dateRanges?.primary?.startDate ?? '2026-06-25'
  const endDate   = filters.dateRanges?.primary?.endDate   ?? 'today'

  // DR and EF are built fresh per render so they pick up the live date range
  const DR = [{ startDate, endDate }]
  const EF = { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'blog_banner_click' } } }

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // ── Single edge-function call — 17 GA4 reports ──
      // Index map:
      //  [0]  top-of-funnel totals
      //  [1]  pages live (with clicks)
      //  [2]  daily trend
      //  [3]  device split
      //  [4]  channel split
      //  [5]  total sessions per banner page (no event filter)
      //  [6]  source / medium raw
      //  [7]  new vs returning
      //  [8]  begin_checkout by internal_referrer × new/returning
      //  [9]  landing page
      // [10]  outliers (country × last_internal_page × device)
      // [11]  geography
      // [12]  funnel – blog_banner_click
      // [13]  funnel – view_search_results
      // [14]  funnel – begin_checkout
      // [15]  funnel – checkout
      // [16]  funnel – purchase

      const allReports = await runGA4([
        { dateRanges: DR, dimensions: [], metrics: [{ name: 'eventCount' }, { name: 'sessions' }, { name: 'totalUsers' }], dimensionFilter: EF },
        { dateRanges: DR, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'eventCount' }, { name: 'sessions' }, { name: 'totalUsers' }], dimensionFilter: EF, orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }], limit: 50 },
        { dateRanges: DR, dimensions: [{ name: 'date' }], metrics: [{ name: 'eventCount' }, { name: 'sessions' }], dimensionFilter: EF, orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 30 },
        { dateRanges: DR, dimensions: [{ name: 'deviceCategory' }], metrics: [{ name: 'eventCount' }, { name: 'sessions' }], dimensionFilter: EF },
        { dateRanges: DR, dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'eventCount' }, { name: 'sessions' }], dimensionFilter: EF, orderBys: [{ metric: { metricName: 'sessions' }, desc: true }] },
        { dateRanges: DR, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'sessions' }, { name: 'totalUsers' }], dimensionFilter: { filter: { fieldName: 'pagePath', inListFilter: { values: KNOWN_BANNER_PAGES } } }, limit: 50 },
        { dateRanges: DR, dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }], metrics: [{ name: 'eventCount' }, { name: 'sessions' }], dimensionFilter: EF, orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }], limit: 30 },
        { dateRanges: DR, dimensions: [{ name: 'newVsReturning' }], metrics: [{ name: 'eventCount' }, { name: 'sessions' }, { name: 'totalUsers' }], dimensionFilter: EF },
        { dateRanges: DR, dimensions: [{ name: 'customEvent:internal_referrer' }, { name: 'newVsReturning' }], metrics: [{ name: 'eventCount' }, { name: 'sessions' }], dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'begin_checkout' } } }, limit: 20 },
        { dateRanges: DR, dimensions: [{ name: 'landingPagePlusQueryString' }], metrics: [{ name: 'eventCount' }, { name: 'sessions' }], dimensionFilter: EF, orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }], limit: 30 },
        { dateRanges: DR, dimensions: [{ name: 'country' }, { name: 'customEvent:last_internal_page' }, { name: 'deviceCategory' }], metrics: [{ name: 'eventCount' }, { name: 'sessions' }], dimensionFilter: EF, orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }], limit: 50 },
        { dateRanges: DR, dimensions: [{ name: 'country' }], metrics: [{ name: 'eventCount' }, { name: 'sessions' }], dimensionFilter: EF, orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 30 },
        { dateRanges: DR, dimensions: [{ name: 'customEvent:internal_referrer' }], metrics: [{ name: 'eventCount' }, { name: 'sessions' }, { name: 'totalRevenue' }], dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'blog_banner_click' } } }, orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 50 },
        { dateRanges: DR, dimensions: [{ name: 'customEvent:internal_referrer' }], metrics: [{ name: 'eventCount' }, { name: 'sessions' }, { name: 'totalRevenue' }], dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'view_search_results' } } }, orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 50 },
        { dateRanges: DR, dimensions: [{ name: 'customEvent:internal_referrer' }], metrics: [{ name: 'eventCount' }, { name: 'sessions' }, { name: 'totalRevenue' }], dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'begin_checkout' } } }, orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 50 },
        { dateRanges: DR, dimensions: [{ name: 'customEvent:internal_referrer' }], metrics: [{ name: 'eventCount' }, { name: 'sessions' }, { name: 'totalRevenue' }], dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'checkout' } } }, orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 50 },
        { dateRanges: DR, dimensions: [{ name: 'customEvent:internal_referrer' }], metrics: [{ name: 'eventCount' }, { name: 'sessions' }, { name: 'totalRevenue' }], dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'purchase' } } }, orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 50 },
      ])

      setData({ allReports, pagesWithClicks: allReports[1] ?? [] })
      setRefreshed(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))
    } catch (err) {
      console.error('BlogBannerFunnel error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Derived data ──────────────────────────────────────────────────────────────

  const R = i => data?.allReports?.[i] ?? []
  const totals       = R(0)[0] ?? {}
  const pagesData    = data?.pagesWithClicks ?? []
  const totalSessionsData = R(5)
  const dailyData    = R(2)
  const deviceData   = R(3)
  const channelData  = R(4)
  const srcMedData   = R(6)
  const newRetData   = R(7)
  const bcNRData     = R(8)
  const landingData  = R(9)
  const outliersData = R(10)
  const geoData      = R(11)

  const funnelRow = (i, key) =>
    R(i).find(r => r['customEvent:internal_referrer'] === key) ?? {}

  const fBanner = funnelRow(12, 'transfers_banner')
  const fSearch = funnelRow(13, 'transfers_banner')
  const fBegin  = funnelRow(14, 'transfers_banner')
  const fCheck  = funnelRow(15, 'transfers_banner')
  const fPurch  = funnelRow(16, 'transfers_banner')

  // KPIs
  const bannerClicks   = n(totals.eventCount)
  const bannerSessions = n(totals.sessions)
  const bannerUsers    = n(totals.totalUsers)
  const pagesLive      = pagesData.length

  const sessionByPage = {}
  totalSessionsData.forEach(r => { sessionByPage[r.pagePath] = n(r.sessions) })

  const totalPageSessions = Object.values(sessionByPage).reduce((s, v) => s + v, 0)
  const overallCTR = totalPageSessions > 0 ? bannerSessions / totalPageSessions : 0

  // CTR table rows
  const ctrRows = pagesData.map(r => ({
    path:  r.pagePath,
    short: PAGE_SHORT[r.pagePath] ?? r.pagePath,
    label: PAGE_LABEL[r.pagePath] ?? r.pagePath,
    allSessions: sessionByPage[r.pagePath] ?? 0,
    clicked: n(r.sessions),
    ctr: sessionByPage[r.pagePath] ? n(r.sessions) / sessionByPage[r.pagePath] : 0,
  })).sort((a, b) => b.ctr - a.ctr)

  // Daily chart — aggregated by clickGranularity
  function aggregateDaily(rows, gran) {
    if (!rows.length) return { labels: [], values: [] }
    const buckets = {}
    rows.forEach(r => {
      const raw = String(r.date) // YYYYMMDD
      const y = parseInt(raw.slice(0, 4))
      const m = parseInt(raw.slice(4, 6)) - 1 // 0-based
      const d = parseInt(raw.slice(6, 8))
      const dt = new Date(y, m, d)
      let key
      if (gran === 'week') {
        // ISO week: Mon – Sun
        const day = dt.getDay() === 0 ? 6 : dt.getDay() - 1 // Mon=0
        const mon = new Date(dt); mon.setDate(dt.getDate() - day)
        key = mon.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      } else if (gran === 'month') {
        key = dt.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
      } else if (gran === 'quarter') {
        const q = Math.floor(m / 3) + 1
        key = `Q${q} ${y}`
      } else {
        key = fmtDate(raw)
      }
      buckets[key] = (buckets[key] ?? 0) + n(r.eventCount)
    })
    return { labels: Object.keys(buckets), values: Object.values(buckets) }
  }

  const { labels: dailyLabels, values: dailyEvents } = aggregateDaily(dailyData, clickGranularity)

  // Device doughnut
  const devFiltered = deviceData.filter(r => n(r.sessions) > 0)
  const devLabels   = devFiltered.map(r => r.deviceCategory[0].toUpperCase() + r.deviceCategory.slice(1))
  const devVals     = devFiltered.map(r => n(r.sessions))
  const devColors   = devFiltered.map(r => r.deviceCategory === 'mobile' ? BLUE : r.deviceCategory === 'desktop' ? '#64748B' : TEAL)

  // Channel chart
  const chanLabels  = channelData.map(r => r.sessionDefaultChannelGroup)
  const chanVals    = channelData.map(r => n(r.sessions))

  // New vs Returning
  const newRow = newRetData.find(r => r.newVsReturning === 'new') ?? {}
  const retRow = newRetData.find(r => r.newVsReturning === 'returning') ?? {}
  const bcNew  = bcNRData.find(r => r['customEvent:internal_referrer'] === 'transfers_banner' && r.newVsReturning === 'new') ?? {}
  const bcRet  = bcNRData.find(r => r['customEvent:internal_referrer'] === 'transfers_banner' && r.newVsReturning === 'returning') ?? {}

  // Landing page classification
  let directSess = 0, midSess = 0, notSetSess = 0
  const midPages = {}
  landingData.forEach(r => {
    const path = r.landingPagePlusQueryString ?? ''
    const sess = n(r.sessions)
    if (path === '(not set)' || path === '') {
      notSetSess += sess
    } else if (BANNER_PAGES_SET.has(pageBase(path))) {
      directSess += sess
    } else {
      midSess += sess
      const key = path.startsWith('/en?gtm_debug=') ? '/en (gtm_debug params)' : path
      midPages[key] = (midPages[key] ?? 0) + sess
    }
  })
  const landingTotal = directSess + midSess + notSetSess


  // Geography
  const geoTop    = geoData.slice(0, 6)
  const geoOther  = geoData.slice(6)
  const geoOtherSessions = geoOther.reduce((s, r) => s + n(r.sessions), 0)

  // Funnel
  const fBannerSess = n(fBanner.sessions)
  const fSearchSess = n(fSearch.sessions)
  const fBeginSess  = n(fBegin.sessions)
  const fCheckSess  = n(fCheck.sessions)
  const fPurchSess  = n(fPurch.sessions)
  const fMax        = fBannerSess || 1

  const today     = new Date()
  const daysSince = Math.round((today - new Date(startDate + 'T00:00:00')) / 86400000)

  // ── Skeleton ──────────────────────────────────────────────────────────────────

  if (loading && !data) {
    return (
      <div className="page-content">
        <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
        <div className="kpi-row kpi-row-5" style={{ marginBottom: 20 }}>
          {[0,1,2,3,4].map(i => (
            <div key={i} className="kpi-card" style={{ gap: 8 }}>
              <Skel h={12} mb={10} /><Skel h={36} mb={8} /><Skel h={10} />
            </div>
          ))}
        </div>
        <div className="chart-row chart-row-full">
          <div className="chart-card"><Skel h={260} /></div>
        </div>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────────

  if (error && !data) {
    return (
      <div className="page-content">
        <div className="insight-box warning">
          <div className="insight-title">⚠ Data load error</div>
          <div className="insight-text">{error}</div>
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="page-content fade-in">
      <style>{`
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        .bb-link{color:var(--blue);font-family:'DM Mono',monospace;font-size:11px;text-decoration:none;}
        .bb-link:hover{text-decoration:underline;}
        .bb-tag{display:inline-flex;align-items:center;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-left:4px;}
        .bb-tag.qa{background:var(--red-light);color:var(--red);}
        .bb-tag.ai{background:var(--blue-light);color:var(--blue);}
      `}</style>



      {/* ══════════════════════════════════════════════════
          SECTION 1 — TOP OF FUNNEL (KPI cards)
      ══════════════════════════════════════════════════ */}
      <SectionHead label="Top of funnel" />
      <div className="kpi-row kpi-row-5" style={{ marginBottom: 24 }}>
        <div className="kpi-card primary">
          <div className="kpi-label">Banner clicks</div>
          <div className="kpi-value">{fmt(bannerClicks)}</div>
          <div className="kpi-sub">{fmt(bannerSessions)} sessions</div>
          <div className="kpi-sub" style={{ marginTop: 6 }}>Total <em>blog_banner_click</em> events fired across all pages in the period</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Unique users</div>
          <div className="kpi-value">{fmt(bannerUsers)}</div>
          <div className="kpi-sub" style={{ marginTop: 6 }}>Distinct users (cookie-based) who clicked the banner at least once</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Pages with banner clicks</div>
          <div className="kpi-value">{pagesLive}</div>
          <div className="kpi-sub" style={{ marginTop: 6 }}>Blog pages where at least one user clicked the banner during the period</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Sessions on those pages</div>
          <div className="kpi-value">{fmt(totalPageSessions)}</div>
          <div className="kpi-sub" style={{ marginTop: 6 }}>Total sessions that visited any of the {pagesLive} banner pages (whether or not they clicked)</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Overall CTR</div>
          <div className="kpi-value">{(overallCTR * 100).toFixed(1)}%</div>
          <div className="kpi-sub">{fmt(bannerSessions)} / {fmt(totalPageSessions)} sessions</div>
          <div className="kpi-sub" style={{ marginTop: 6 }}>Banner-click sessions ÷ total sessions on banner pages — across all {pagesLive} pages combined</div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════
          SECTION 2 — CTR BY PAGE
      ══════════════════════════════════════════════════ */}
      <SectionHead label="Click-through rate by page" />
      <div className="chart-row chart-row-3-1" style={{ marginBottom: 24 }}>

        {/* Table */}
        <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="data-table-container" style={{ border: 'none', margin: 0, borderRadius: 0 }}>
            <table className="data-table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <STh col="short" label="Page"     sc={ctrSort.sortCol} sd={ctrSort.sortDir} onSort={ctrSort.toggle} />
                  <STh col="allSessions" label="Sessions" sc={ctrSort.sortCol} sd={ctrSort.sortDir} onSort={ctrSort.toggle} style={{ textAlign: 'right' }} />
                  <STh col="clicked"     label="Clicked"  sc={ctrSort.sortCol} sd={ctrSort.sortDir} onSort={ctrSort.toggle} style={{ textAlign: 'right' }} />
                  <STh col="ctr"         label="CTR"      sc={ctrSort.sortCol} sd={ctrSort.sortDir} onSort={ctrSort.toggle} style={{ textAlign: 'right' }} />
                </tr>
              </thead>
              <tbody>
                {ctrSort.sort(ctrRows, {
                  short:       r => r.short,
                  allSessions: r => r.allSessions,
                  clicked:     r => r.clicked,
                  ctr:         r => r.ctr,
                }).map(r => (
                  <tr key={r.path}>
                    <td>
                      <a href={`https://www.hoppa.com${r.path}`} target="_blank" rel="noreferrer" className="bb-link">
                        {r.short}
                      </a>
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.allSessions)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.clicked}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{(r.ctr*100).toFixed(1)}%</td>
                  </tr>
                ))}
                <tr style={{ background: 'var(--bg)', fontWeight: 700 }}>
                  <td style={{ fontWeight: 700 }}>Total</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(totalPageSessions)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(bannerSessions)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{(overallCTR*100).toFixed(1)}%</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ padding: '10px 20px 14px', fontSize: 11, color: 'var(--subtext)', lineHeight: 1.65 }}>
            Sessions = all visits to that page. Clicked = sessions where the banner was clicked. CTR = Clicked ÷ Sessions. Sorted by CTR descending.
          </div>
        </div>

        {/* Bar chart */}
        <ChartCard title="CTR by page" subtitle="Sorted by click-through rate" tag="CTR">
          <div style={{ height: 320 }}>
            <Bar
              data={{
                labels: [...ctrRows].sort((a,b) => b.ctr - a.ctr).map(r => r.label),
                datasets: [{
                  data: [...ctrRows].sort((a,b) => b.ctr - a.ctr).map(r => parseFloat((r.ctr*100).toFixed(1))),
                  backgroundColor: BLUE,
                  borderRadius: 4,
                  barThickness: 18,
                }],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                layout: { padding: { right: 52 } },
                plugins: {
                  legend: { display: false },
                  tooltip: { callbacks: { label: ctx => ` ${ctx.raw}%` } },
                  datalabels: {
                    anchor: 'end',
                    align: 'right',
                    offset: 4,
                    formatter: v => `${v}%`,
                    font: { family: 'DM Sans', size: 11, weight: 600 },
                    color: '#1A2B3C',
                    clamp: true,
                  },
                },
                scales: {
                  x: {
                    ticks: { callback: v => `${v}%`, font: FONT, color: '#5A6A7A' },
                    grid: { color: '#F1F5F9' },
                    border: { display: false },
                  },
                  y: {
                    ticks: { font: FONT, color: '#5A6A7A' },
                    grid: { display: false },
                    border: { display: false },
                  },
                },
              }}
            />
          </div>
          <Note>CTR = sessions that fired <em>blog_banner_click</em> on that page ÷ total sessions on that page. One session counts once even if multiple events fired.</Note>
        </ChartCard>
      </div>

      {/* ══════════════════════════════════════════════════
          SECTION 3 — VOLUME, DEVICE, CHANNEL
      ══════════════════════════════════════════════════ */}
      <SectionHead label="Volume, device, channel" />
      <div className="chart-row chart-row-3-1" style={{ marginBottom: 16 }}>
        <ChartCard
          title={`Banner clicks by ${clickGranularity}`}
          subtitle={`${startDate} – ${endDate}`}
          tag="CLICKS"
          switcher={['Day','Week','Month','Quarter'].map(g => ({
            label: g,
            active: clickGranularity === g.toLowerCase(),
            onClick: () => setClickGranularity(g.toLowerCase()),
          }))}>
          <div style={{ height: 300 }}>
            <Bar
              data={{
                labels: dailyLabels,
                datasets: [{ data: dailyEvents, backgroundColor: BLUE, borderRadius: 4, maxBarThickness: 48 }],
              }}
              options={{
                responsive: true, maintainAspectRatio: false,
                layout: { padding: { top: 20 } },
                plugins: {
                  legend: { display: false },
                  datalabels: {
                    anchor: 'end',
                    align: 'top',
                    offset: 2,
                    formatter: v => v,
                    font: { family: 'DM Sans', size: 11, weight: 600 },
                    color: '#1A2B3C',
                    clamp: true,
                  },
                },
                scales: {
                  x: { ticks: { font: FONT, color: '#5A6A7A', maxRotation: 40 }, grid: { display: false }, border: { display: false } },
                  y: { beginAtZero: true, ticks: { font: FONT, color: '#5A6A7A' }, grid: { color: '#F1F5F9' }, border: { display: false } },
                },
              }}
            />
          </div>
          <Note>Count of <em>blog_banner_click</em> events per day (GA4 date dimension, site timezone). One session that clicks twice contributes 2 events to the daily total.</Note>
        </ChartCard>

        <ChartCard title="Device (sessions)" tag="DEVICE">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, paddingTop: 12 }}>
            <div style={{ position: 'relative', width: '100%', height: 220 }}>
              <Doughnut
                data={{ labels: devLabels, datasets: [{ data: devVals, backgroundColor: devColors, borderWidth: 2, borderColor: '#fff' }] }}
                options={{
                  responsive: true, maintainAspectRatio: false,
                  cutout: '64%',
                  plugins: { legend: { display: false }, datalabels: false, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} sessions` } } },
                }}
              />
            </div>
            <div className="legend" style={{ justifyContent: 'center' }}>
              {devFiltered.map((r, i) => (
                <div key={i} className="legend-item">
                  <div className="legend-dot" style={{ background: devColors[i] }} />
                  {devLabels[i]} — {n(r.sessions)}
                </div>
              ))}
            </div>
            <Note>Sessions broken down by the device category of the user who clicked the banner (mobile / desktop / tablet).</Note>
          </div>
        </ChartCard>
      </div>

      <div className="chart-row chart-row-full" style={{ marginBottom: 24 }}>
        <ChartCard title="Channel split (sessions)" tag="CHANNEL">
          <div style={{ height: 280 }}>
            <Bar
              data={{
                labels: chanLabels,
                datasets: [{ data: chanVals, backgroundColor: TEAL, borderRadius: 4, barThickness: 18 }],
              }}
              options={{
                ...baseBarOpts('y'),
                layout: { padding: { right: 48 } },
                plugins: {
                  legend: { display: false },
                  tooltip: { callbacks: { label: ctx => ` ${ctx.raw} sessions` } },
                  datalabels: {
                    anchor: 'end',
                    align: 'right',
                    offset: 4,
                    formatter: v => v,
                    font: { family: 'DM Sans', size: 11, weight: 600 },
                    color: '#1A2B3C',
                    clamp: true,
                  },
                },
                scales: {
                  x: { ticks: { font: FONT, color: '#5A6A7A' }, grid: { color: '#F1F5F9' }, border: { display: false } },
                  y: { ticks: { font: FONT, color: '#5A6A7A' }, grid: { display: false }, border: { display: false } },
                },
              }}
            />
          </div>
          <Note>Sessions by GA4’s default channel grouping for the session containing the banner click. Reflects how users originally arrived at the site, not how they navigated to the banner page.</Note>
        </ChartCard>
      </div>

      {/* ══════════════════════════════════════════════════
          SECTION 4 — SOURCE / MEDIUM (RAW)
      ══════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 24 }}>
        <SectionHead label="Source / Medium (raw)" note="sessionSource + sessionMedium, unrolled from channel groups" />
        <Collapsible title="Source / Medium rows" note={`${srcMedData.length} combinations`} defaultOpen={true}>
          <div className="data-table-container" style={{ border: 'none', margin: 0 }}>
            <table className="data-table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <STh col="sessionSource" label="Source"  sc={srcMedSort.sortCol} sd={srcMedSort.sortDir} onSort={srcMedSort.toggle} />
                  <STh col="sessionMedium" label="Medium"  sc={srcMedSort.sortCol} sd={srcMedSort.sortDir} onSort={srcMedSort.toggle} />
                  <STh col="eventCount"    label="Events"  sc={srcMedSort.sortCol} sd={srcMedSort.sortDir} onSort={srcMedSort.toggle} style={{ textAlign: 'right' }} />
                  <STh col="sessions"      label="Sessions" sc={srcMedSort.sortCol} sd={srcMedSort.sortDir} onSort={srcMedSort.toggle} style={{ textAlign: 'right' }} />
                </tr>
              </thead>
              <tbody>
                {srcMedSort.sort(srcMedData, {
                  sessionSource: r => r.sessionSource ?? '',
                  sessionMedium: r => r.sessionMedium ?? '',
                  eventCount:    r => n(r.eventCount),
                  sessions:      r => n(r.sessions),
                }).map((r, i) => {
                  const isQA = r.sessionSource === 'tagassistant.google.com'
                  const isAI = r.sessionMedium === 'ai-assistant' || ['chatgpt','perplexity','gemini','copilot'].some(s => r.sessionSource?.includes(s))
                  return (
                    <tr key={i}>
                      <td>
                        {r.sessionSource}
                        {isQA && <span className="bb-tag qa">QA</span>}
                        {isAI && <span className="bb-tag ai">AI</span>}
                      </td>
                      <td>{r.sessionMedium}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.eventCount)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.sessions)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '10px 0 0', fontSize: 11, color: 'var(--subtext)', lineHeight: 1.6 }}>
            tagassistant.google.com = Google Tag Assistant (internal QA traffic, not real visitors).
            chatgpt.com tagged sessionMedium = ai-assistant.
          </div>
        </Collapsible>
      </div>

      {/* ══════════════════════════════════════════════════
          SECTION 5 — NEW VS. RETURNING
      ══════════════════════════════════════════════════ */}
      <SectionHead label="New vs. Returning users" />
      <div className="chart-row chart-row-2" style={{ marginBottom: 24 }}>

        {/* Events / sessions / users */}
        <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)' }}>
            <div className="chart-title">Clicks by new vs. returning users</div>
          </div>
          <div className="data-table-container" style={{ border: 'none', margin: 0, borderRadius: 0 }}>
            <table className="data-table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: 100 }}></th>
                  <th style={{ textAlign: 'right' }}>Events</th>
                  <th style={{ textAlign: 'right' }}>Sessions</th>
                  <th style={{ textAlign: 'right' }}>Users</th>
                  <th style={{ textAlign: 'right' }}>Events / user</th>
                </tr>
              </thead>
              <tbody>
                {newRow.sessions != null && (
                  <tr>
                    <td>New</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(newRow.eventCount)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(newRow.sessions)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(newRow.totalUsers)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{newRow.totalUsers ? (n(newRow.eventCount)/n(newRow.totalUsers)).toFixed(2) : '—'}</td>
                  </tr>
                )}
                {retRow.sessions != null && (
                  <tr>
                    <td>Returning</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(retRow.eventCount)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(retRow.sessions)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(retRow.totalUsers)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{retRow.totalUsers ? (n(retRow.eventCount)/n(retRow.totalUsers)).toFixed(2) : '—'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '10px 20px 14px', fontSize: 11, color: 'var(--subtext)', lineHeight: 1.65 }}>Counts banner click events (not unique users). A returning user who clicks twice adds 2 events. Events/user = average clicks per individual within this cohort.</div>
        </div>

        {/* begin_checkout conversion */}
        <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)' }}>
            <div className="chart-title">Checkout intent rate by user type</div>
          </div>
          <div className="data-table-container" style={{ border: 'none', margin: 0, borderRadius: 0 }}>
            <table className="data-table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: 90 }}></th>
                  <th style={{ textAlign: 'right' }}>Banner clicks</th>
                  <th style={{ textAlign: 'right' }}>Reached begin_checkout</th>
                  <th style={{ textAlign: 'right' }}>Rate</th>
                </tr>
              </thead>
              <tbody>
                {newRow.sessions != null && (
                  <tr>
                    <td>New</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(newRow.sessions)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n(bcNew.sessions)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct(n(bcNew.sessions), n(newRow.sessions))}</td>
                  </tr>
                )}
                {retRow.sessions != null && (
                  <tr>
                    <td>Returning</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(retRow.sessions)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n(bcRet.sessions)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct(n(bcRet.sessions), n(retRow.sessions))}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '10px 20px 14px', fontSize: 11, color: 'var(--subtext)', lineHeight: 1.65 }}>Of sessions that clicked the banner, what share also fired <em>begin_checkout</em> in the same session. Denominator = banner-click sessions only, not all site sessions.</div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════
          SECTION 6 — SESSION ORIGIN
      ══════════════════════════════════════════════════ */}
      <SectionHead label="Session origin — landing page vs. banner-click page" />
      <div className="chart-row chart-row-full" style={{ marginBottom: 24 }}>
        <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="data-table-container" style={{ border: 'none', margin: 0, borderRadius: 0 }}>
            <table className="data-table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <STh col="origin"  label="Origin"     sc={originSort.sortCol} sd={originSort.sortDir} onSort={originSort.toggle} />
                  <STh col="sessions" label="Sessions"  sc={originSort.sortCol} sd={originSort.sortDir} onSort={originSort.toggle} style={{ textAlign: 'right' }} />
                  <STh col="pct"     label="% of clicks" sc={originSort.sortCol} sd={originSort.sortDir} onSort={originSort.toggle} style={{ textAlign: 'right' }} />
                </tr>
              </thead>
              <tbody>
                {originSort.sort([
                  { origin: 'Landed directly on blog page with the banner',       sessions: directSess, pct: directSess / (landingTotal || 1) },
                  { origin: 'Landed elsewhere, navigated to blog page mid-session', sessions: midSess,    pct: midSess    / (landingTotal || 1) },
                  { origin: 'Landing page (not set)',                               sessions: notSetSess, pct: notSetSess  / (landingTotal || 1) },
                ], { origin: r => r.origin, sessions: r => r.sessions, pct: r => r.pct }).map(row => (
                  <tr key={row.origin}>
                    <td>{row.origin}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.sessions}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct(row.sessions, landingTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {Object.keys(midPages).length > 0 && (
            <>
              <div style={{ padding: '12px 20px 8px', fontSize: 12, fontWeight: 700, color: 'var(--navy)', borderTop: '1px solid var(--border)' }}>
                Non-blog landing pages (mid-session clicks)
              </div>
              <div className="data-table-container" style={{ border: 'none', margin: 0, borderRadius: 0 }}>
                <table className="data-table" style={{ minWidth: 0 }}>
                  <thead>
                    <tr>
                      <STh col="path"     label="Landing page" sc={midSort.sortCol} sd={midSort.sortDir} onSort={midSort.toggle} />
                      <STh col="sessions" label="Sessions"     sc={midSort.sortCol} sd={midSort.sortDir} onSort={midSort.toggle} style={{ textAlign: 'right' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {midSort.sort(Object.entries(midPages).map(([path,sess]) => ({ path, sessions: sess })), {
                      path:     r => r.path,
                      sessions: r => r.sessions,
                    }).map(({ path, sessions: sess }) => (
                      <tr key={path}>
                        <td>
                          {path.includes('gtm_debug')
                            ? <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'var(--subtext)' }}>{path}</span>
                            : <a href={`https://www.hoppa.com${path}`} target="_blank" rel="noreferrer" className="bb-link">{path}</a>
                          }
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{sess}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div style={{ padding: '10px 20px 14px', fontSize: 11, color: 'var(--subtext)', lineHeight: 1.65 }}>Based on the landing page dimension per session. “Landed directly” = session started on one of the 8 blog pages with the banner. “Mid-session” = session started elsewhere and the user navigated to the blog page later in the same session.</div>
        </div>
      </div>


      {/* ══════════════════════════════════════════════════
          SECTION 8 — GEOGRAPHY
      ══════════════════════════════════════════════════ */}
      <SectionHead label="Geography" />
      <div className="chart-row chart-row-3-1" style={{ marginBottom: 24 }}>
        <div className="chart-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="data-table-container" style={{ border: 'none', margin: 0, borderRadius: 0 }}>
            <table className="data-table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <STh col="country"  label="Country"  sc={geoSort.sortCol} sd={geoSort.sortDir} onSort={geoSort.toggle} />
                  <STh col="sessions" label="Sessions" sc={geoSort.sortCol} sd={geoSort.sortDir} onSort={geoSort.toggle} style={{ textAlign: 'right' }} />
                </tr>
              </thead>
              <tbody>
                {geoSort.sort(geoTop, {
                  country:  r => r.country,
                  sessions: r => n(r.sessions),
                }).map((r, i) => (
                  <tr key={i}>
                    <td>{r.country}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n(r.sessions)}</td>
                  </tr>
                ))}
                {geoOther.length > 0 && (
                  <tr style={{ background: 'var(--bg)' }}>
                    <td style={{ color: 'var(--subtext)' }}>All others ({geoOther.length} countries)</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--subtext)' }}>{geoOtherSessions}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '10px 20px 14px', fontSize: 11, color: 'var(--subtext)', lineHeight: 1.65 }}>
            Sessions filtered to those where GA4 recorded a banner click. Top 6 countries shown; remaining countries aggregated into “All others”.
          </div>
        </div>

        <ChartCard title="Sessions by country" tag="GEO">
          <div style={{ height: 220 }}>
            <Bar
              data={{
                labels: [...geoTop.map(r => r.country), geoOther.length > 0 ? `Others (${geoOther.length})` : null].filter(Boolean),
                datasets: [{
                  data: [...geoTop.map(r => n(r.sessions)), geoOther.length > 0 ? geoOtherSessions : null].filter(x => x != null),
                  backgroundColor: BLUE, borderRadius: 4, barThickness: 14,
                }],
              }}
              options={{
                ...baseBarOpts('y'),
                layout: { padding: { right: 48 } },
                plugins: {
                  legend: { display: false },
                  tooltip: { callbacks: { label: ctx => ` ${ctx.raw} sessions` } },
                  datalabels: {
                    anchor: 'end',
                    align: 'right',
                    offset: 4,
                    formatter: v => v,
                    font: { family: 'DM Sans', size: 11, weight: 600 },
                    color: '#1A2B3C',
                    clamp: true,
                  },
                },
                scales: {
                  x: { ticks: { font: FONT, color: '#5A6A7A' }, grid: { color: '#F1F5F9' }, border: { display: false } },
                  y: { ticks: { font: FONT, color: '#5A6A7A' }, grid: { display: false }, border: { display: false } },
                },
              }}
            />
          </div>
          <Note>Same country data as the table, visualised for quick comparison. Hover any bar for the session count.</Note>
        </ChartCard>
      </div>

      {/* ══════════════════════════════════════════════════
          SECTION 9 — FUNNEL
      ══════════════════════════════════════════════════ */}
      <SectionHead label="Banner → Purchase conversion funnel" />
      <div className="chart-row chart-row-full" style={{ marginBottom: 24 }}>
        <div className="chart-card">
          <div className="funnel-wrap">
            {[
              { name: 'Banner click',        sessions: fBannerSess, pct: null,                               sub: 'sessions',                       partial: false },
              { name: 'View search results', sessions: fSearchSess, pct: fSearchSess / fMax,                 sub: pct(fSearchSess, fBannerSess) + ' of clicks', partial: false },
              { name: 'Begin checkout',      sessions: fBeginSess,  pct: fBeginSess  / fMax,                 sub: pct(fBeginSess,  fSearchSess) + ' of search', partial: false },
              { name: 'Checkout',            sessions: fCheckSess,  pct: fCheckSess  / fMax,                 sub: pct(fCheckSess,  fBeginSess)  + ' of begin_checkout', partial: true },
              { name: 'Purchase',            sessions: fPurchSess,  pct: fPurchSess  / fMax,                 sub: fPurchSess ? pct(fPurchSess, fCheckSess) + ' of checkout' : 'tag not passing internal_referrer', partial: true },
            ].map((row, i) => (
              <div key={i} className="funnel-step">
                <div className="funnel-label">{row.name}</div>
                <div className="funnel-bar-wrap">
                  <div className="funnel-bar-bg">
                    <div
                      className="funnel-bar-fill"
                      style={{
                        width: `${Math.max((row.pct ?? 1) * 100, row.sessions > 0 ? 5 : 0)}%`,
                        background: row.partial ? '#94A3B8' : 'var(--blue)',
                        backgroundImage: row.partial ? 'repeating-linear-gradient(45deg,transparent,transparent 6px,rgba(255,255,255,0.25) 6px,rgba(255,255,255,0.25) 12px)' : 'none',
                      }}
                    >
                    </div>
                  </div>
                </div>
                <div className="funnel-value">{row.sessions}</div>
                <div className="funnel-pct">{row.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, fontSize: 11, color: 'var(--subtext)', lineHeight: 1.6 }}>
            Filtered to rows where customEvent:internal_referrer = "transfers_banner" at each event.
            Sessions where this parameter was absent or blank are excluded.
            {!fPurchSess && ' Purchase: no rows with transfers_banner returned — the purchase GTM tag does not pass this parameter.'}
          </div>
        </div>
      </div>

    </div>
  )
}
