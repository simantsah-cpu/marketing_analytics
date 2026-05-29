/**
 * AiOverviewSection.jsx — Orchestrator for the AI Overview Intelligence section.
 * Fires all 3 GA4 queries in parallel, manages loading/error/empty states,
 * computes derived data client-side, then renders all sub-sections A–G.
 *
 * RULES OF HOOKS: All useState/useEffect/useCallback/useMemo calls are at the
 * TOP of the component body, before any conditional returns.
 *
 * Props:
 *   dateRange           — { startDate, endDate }
 *   comparisonMode      — boolean
 *   comparisonDateRange — { startDate, endDate } | null
 *   deviceFilter        — string | null
 *   propertyId          — GA4 property ID string
 *   onDataLoaded        — optional callback(summaryObj) for parent context
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  fetchAiOverviewKpis,
  fetchAiOverviewTrend,
  fetchAiOverviewDeviceSplit,
  fetchAiOverviewPages,
} from '../../services/data-service'
import {
  processKpisData,
  processTrendData,
  processDeviceData,
  buildCategoryBreakdown,
  SNIPPET_KEY,
  categorise,
  CATEGORY_COLORS,
} from './aiOverviewUtils'
import AiOverviewKpis         from './AiOverviewKpis'
import AiOverviewCharts       from './AiOverviewCharts'
import AiOverviewSnippetTable from './AiOverviewSnippetTable'
import AiOverviewLifecycle    from './AiOverviewLifecycle'
import AiOverviewMatrix       from './AiOverviewMatrix'

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function AiOverviewSkeleton() {
  return (
    <div>
      <style>{`@keyframes aio-pulse{0%,100%{opacity:1}50%{opacity:0.45}}`}</style>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{ height: 100, borderRadius: 12, background: '#F1F5F9', animation: 'aio-pulse 1.4s ease-in-out infinite' }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 14, marginBottom: 20 }}>
        <div style={{ height: 300, borderRadius: 12, background: '#F1F5F9', animation: 'aio-pulse 1.4s ease-in-out infinite' }} />
        <div style={{ height: 300, borderRadius: 12, background: '#F1F5F9', animation: 'aio-pulse 1.4s ease-in-out infinite' }} />
      </div>
    </div>
  )
}

// ─── Error banner ─────────────────────────────────────────────────────────────

function OrbitErrorBanner({ message, onRetry }) {
  return (
    <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 10, padding: '18px 22px', color: '#92400E', marginBottom: 20 }}>
      <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 13 }}>⚠ AI Overview data fetch error</div>
      <div style={{ fontSize: 12, marginBottom: 10 }}>{message}</div>
      <button
        onClick={onRetry}
        style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #F97316', background: '#FFF7ED', color: '#C2410C', fontFamily: 'inherit', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
      >
        Retry
      </button>
    </div>
  )
}

// ─── Main section ─────────────────────────────────────────────────────────────

export default function AiOverviewSection({
  dateRange,
  comparisonMode,
  comparisonDateRange,
  deviceFilter,
  propertyId,
  onDataLoaded,
}) {
  // ── All hooks first — NO conditional returns before this block ──────────────

  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [kpisData, setKpisData]       = useState(null)
  const [trendData, setTrendData]     = useState(null)
  const [deviceData, setDeviceData]   = useState(null)
  const [rawPageRows, setRawPageRows] = useState([])   // snippet × landingPage (unfiltered)
  const [gran, setGran]               = useState('Week')
  const [category, setCategory]       = useState('All')

  const fetchAll = useCallback(async () => {
    if (!dateRange?.startDate || !propertyId) return
    setLoading(true)
    setError(null)
    try {
      const [kpis, trend, device] = await Promise.all([
        fetchAiOverviewKpis(
          propertyId,
          dateRange,
          comparisonMode && comparisonDateRange ? comparisonDateRange : null,
          deviceFilter || null,
        ),
        fetchAiOverviewTrend(propertyId, dateRange, deviceFilter || null),
        fetchAiOverviewDeviceSplit(propertyId, dateRange),
      ])
      setKpisData(kpis)
      setTrendData(trend)
      setDeviceData(device)

      // Pages query is isolated — a failure here must NOT crash kpis/trend/device.
      // If it errors (e.g. edge function not yet deployed), page column shows "—"
      // but all KPI numbers remain intact.
      fetchAiOverviewPages(propertyId, dateRange)
        .then(pages => setRawPageRows(pages ?? []))
        .catch(() => setRawPageRows([]))

    } catch (err) {
      setError(err?.message ?? 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [propertyId, dateRange, comparisonMode, comparisonDateRange, deviceFilter])

  // Trigger fetch on mount and whenever filters change
  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Derive all computed values unconditionally (safe with empty fallbacks) ──

  const currentRows = kpisData?.current ?? []
  const compRows    = kpisData?.comparison ?? null

  const {
    totalEvents,
    uniqueSnippets,
    topSnippetEvents,
    topSnippetText,
    avgEventsPerSnippet,
    rows: kpisRows,
  } = useMemo(() => processKpisData(currentRows), [currentRows])

  const prevTotalEvents = useMemo(
    () => compRows?.length ? compRows.reduce((s, r) => s + (r.eventCount || 0), 0) : null,
    [compRows]
  )

  const { weeklyTotals, snippetWeekMap, allSortedWeeks } = useMemo(
    () => processTrendData(trendData ?? []),
    [trendData]
  )

  const deviceSplitData = useMemo(() => processDeviceData(deviceData ?? []), [deviceData])

  const categoryBreakdown = useMemo(() => buildCategoryBreakdown(currentRows), [currentRows])

  const top10Snippets = useMemo(() => {
    return kpisRows.slice(0, 10).map(row => {
      const text   = row[SNIPPET_KEY] ?? ''
      const events = row.eventCount || 0
      const users  = row.activeUsers || 0
      const weekMap = snippetWeekMap[text] || {}
      const last6   = allSortedWeeks.slice(-6)
      const firstCount = last6.map(w => weekMap[w] || 0).find(v => v > 0) ?? 0
      const lastCount  = [...last6].reverse().map(w => weekMap[w] || 0).find(v => v > 0) ?? 0
      const trend = lastCount >= firstCount ? 'growing' : lastCount < firstCount * 0.5 ? 'declining' : 'stable'
      return {
        text,
        events,
        users,
        eventsPerUser: users > 0 ? parseFloat((events / users).toFixed(1)) : 0,
        trend,
      }
    })
  }, [kpisRows, snippetWeekMap, allSortedWeeks])

  // ── Category filter ────────────────────────────────────────────────────────
  // availableCategories: derived from full (unfiltered) kpisRows
  const availableCategories = useMemo(() => {
    const s = new Set()
    kpisRows.forEach(row => { s.add(categorise(row[SNIPPET_KEY] ?? '')) })
    return s
  }, [kpisRows])

  // filteredKpisRows: the rows powering SnippetTable + Lifecycle + KPI re-derivation
  const filteredKpisRows = useMemo(() => {
    if (category === 'All') return kpisRows
    return kpisRows.filter(row => categorise(row[SNIPPET_KEY] ?? '') === category)
  }, [kpisRows, category])

  // Re-derive KPI summary from filtered rows
  const filteredTotalEvents   = useMemo(() => filteredKpisRows.reduce((s, r) => s + (r.eventCount  || 0), 0), [filteredKpisRows])
  const filteredTotalUsers    = useMemo(() => filteredKpisRows.reduce((s, r) => s + (r.activeUsers || 0), 0), [filteredKpisRows])
  const filteredUniqueSnippets = filteredKpisRows.length
  const filteredTopRow        = filteredKpisRows[0]
  const filteredTopEvents     = filteredTopRow?.eventCount || 0
  const filteredTopText       = (filteredTopRow?.[SNIPPET_KEY] ?? '').slice(0, 40)
  const filteredAvgEvents     = filteredUniqueSnippets > 0
    ? (filteredTotalEvents / filteredUniqueSnippets).toFixed(1)
    : '0.0'

  // Filter comparison rows too for the KPI comparison badge
  const filteredPrevTotalEvents = useMemo(() => {
    if (!compRows?.length) return null
    const rows = category === 'All'
      ? compRows
      : compRows.filter(row => categorise(row[SNIPPET_KEY] ?? '') === category)
    return rows.length ? rows.reduce((s, r) => s + (r.eventCount || 0), 0) : null
  }, [compRows, category])

  const recentWeeks  = useMemo(() => weeklyTotals.slice(-6), [weeklyTotals])
  const totalUsers   = useMemo(() => currentRows.reduce((s, r) => s + (r.activeUsers || 0), 0), [currentRows])
  const topCategory  = useMemo(() => categoryBreakdown[0]?.label ?? 'Transfer times', [categoryBreakdown])
  const mobilePct    = useMemo(() => {
    const allMobile = (deviceSplitData.text?.mobile || 0) + (deviceSplitData.table?.mobile || 0) + (deviceSplitData.price?.mobile || 0)
    const allTotal  = (deviceSplitData.text?.total  || 0) + (deviceSplitData.table?.total  || 0) + (deviceSplitData.price?.total  || 0)
    return allTotal > 0 ? Math.round((allMobile / allTotal) * 100) : 0
  }, [deviceSplitData])
  const overallTrend = useMemo(() => {
    if (weeklyTotals.length < 2) return 'stable'
    return weeklyTotals[weeklyTotals.length - 1].events >= weeklyTotals[0].events ? 'growing' : 'declining'
  }, [weeklyTotals])

  // Filter out any residual garbage (belt-and-suspenders — the filter in the
  // edge function already handles this, but guard client-side too).
  const cleanPageRows = useMemo(() => {
    const garbage = new Set(['', '(not set)', '(not provided)'])
    return rawPageRows.filter(row => !garbage.has(row[SNIPPET_KEY] ?? ''))
  }, [rawPageRows])

  // Notify parent — use a ref to avoid stale closure issues
  const onDataLoadedRef = useRef(onDataLoaded)
  useEffect(() => { onDataLoadedRef.current = onDataLoaded }, [onDataLoaded])

  useEffect(() => {
    if (onDataLoadedRef.current && totalEvents > 0) {
      onDataLoadedRef.current({ totalEvents, topSnippetText, overallTrend, mobilePct, topCategory })
    }
  }, [totalEvents, topSnippetText, overallTrend, mobilePct, topCategory])

  // ── NOW it is safe to do conditional rendering ─────────────────────────────

  if (loading) return <AiOverviewSkeleton />
  if (error)   return <OrbitErrorBanner message={error} onRetry={fetchAll} />

  if (totalEvents === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 0', fontSize: 13, color: '#94A3B8', lineHeight: 1.7 }}>
        No AI Overview click data found for this period.
        <br />
        The <code style={{ background: '#F1F5F9', padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>ai_overview_click</code>{' '}
        custom dimension has been active since 30 Sept 2025 — try a date range that includes this window.
      </div>
    )
  }

  // ── Render sections A–G ────────────────────────────────────────────────────

  return (
    <div>

      {/* ── Category filter pills — above KPIs, filters entire dashboard ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
        marginBottom: 14,
      }}>
        {['All', ...Object.keys(CATEGORY_COLORS)]
          .filter(c => c === 'All' || availableCategories.has(c))
          .map(cat => {
            const active = category === cat
            const color  = cat === 'All' ? '#0F5FA6' : CATEGORY_COLORS[cat]
            return (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '5px 12px',
                  border: `1px solid ${active ? color : '#E2E8F0'}`,
                  borderRadius: 20,
                  background: active ? color : '#fff',
                  color: active ? '#fff' : '#5A6A7A',
                  fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
                  cursor: 'pointer', transition: 'all 0.12s',
                  boxShadow: active ? `0 2px 6px ${color}40` : 'none',
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
          })
        }
      </div>

      {/* A: KPI Cards */}
      <AiOverviewKpis
        totalEvents={filteredTotalEvents}
        uniqueSnippets={filteredUniqueSnippets}
        topSnippetEvents={filteredTopEvents}
        topSnippetText={filteredTopText}
        avgEventsPerSnippet={filteredAvgEvents}
        prevTotalEvents={filteredPrevTotalEvents}
        trendData={trendData ?? []}
        comparisonMode={comparisonMode}
      />

      {/* B: Charts row — bar chart; category + gran controlled from Section */}
      <AiOverviewCharts
        trendData={trendData ?? []}
        gran={gran}
        onGranChange={setGran}
        category={category}
        onCategoryChange={setCategory}
        availableCategories={availableCategories}
      />

      {/* D: Snippets table — receives category-filtered rows + landing page data */}
      <AiOverviewSnippetTable
        kpisRows={filteredKpisRows}
        snippetWeekMap={snippetWeekMap}
        allSortedWeeks={allSortedWeeks}
        totalEvents={filteredTotalEvents}
        totalUsers={filteredTotalUsers}
        pageRows={cleanPageRows}
      />

      {/* E: Lifecycle matrix — top 10 of filtered snippets */}
      <AiOverviewLifecycle
        kpisRows={filteredKpisRows}
        snippetWeekMap={snippetWeekMap}
        allSortedWeeks={allSortedWeeks}
        trendData={trendData ?? []}
        gran={gran}
      />

      {/* G: Opportunity matrix */}
      <AiOverviewMatrix
        categoryBreakdown={categoryBreakdown}
        totalEvents={totalEvents}
        kpisRows={kpisRows}
        snippetWeekMap={snippetWeekMap}
        allSortedWeeks={allSortedWeeks}
      />
    </div>
  )
}
