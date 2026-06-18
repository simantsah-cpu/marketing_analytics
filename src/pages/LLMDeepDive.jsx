import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { format, parseISO } from 'date-fns'
import { useFilters } from '../context/FiltersContext'
import { useProperty } from '../context/PropertyContext'
import { getLLMData, getLLMPageData, LLM_COLORS, LLM_ORDER, LLM_SOURCE_MAP } from '../services/llm-data-service'

// ─── Formatters (mirrored from LLMIntelligence) ───────────────────────────────

function fmt(v, type) {
  if (v === null || v === undefined || isNaN(v)) return '—'
  switch (type) {
    case 'int':  return Math.round(v).toLocaleString()
    case 'pct1': return `${(v * 100).toFixed(1)}%`
    case 'pct2': return `${(v * 100).toFixed(2)}%`
    case 'gbp': { const a = Math.abs(v), s = v < 0 ? '-' : ''; if (a >= 1e6) return `${s}£${(a/1e6).toFixed(1)}M`; if (a >= 1e4) return `${s}£${Math.round(a/1e3)}K`; return `${s}£${Math.round(a).toLocaleString('en-GB')}` }
    case 'gbp2': return `£${v.toFixed(2)}`
    default: return String(v)
  }
}

function LLMDot({ name }) {
  return (
    <span style={{
      display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
      background: LLM_COLORS[name] ?? '#94A3B8', flexShrink: 0,
    }} />
  )
}

function computeLLMHealth(row) {
  const cvr = row.convRate ?? 0
  const ses = row.sessions ?? 0
  if (cvr >= 0.015 && ses >= 500) return 'Healthy'
  if (cvr >= 0.005 || ses >= 100)  return 'Watch'
  return 'At Risk'
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const DEVICE_OPTIONS = ['desktop', 'mobile', 'tablet']

export default function LLMDeepDive() {
  const { filters }          = useFilters()
  const { selectedProperty } = useProperty()

  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const [llmFilter, setLlmFilter]   = useState([])
  const [localDevice, setLocalDevice] = useState([])
  const [sortKey, setSortKey]       = useState('revenue')
  const [sortDir, setSortDir]       = useState('desc')
  const [pivotMetric, setPivotMetric] = useState('sessions')
  const [granularity, setGranularity] = useState('month')

  // ── Landing page drill-down ─────────────────────────────────────────────────
  const [expandedLLM, setExpandedLLM]     = useState(null)
  const [purchasePages, setPurchasePages] = useState([])   // pages with ≥1 purchase
  const [allPages, setAllPages]           = useState([])   // all pages by sessions
  const [pageLoading, setPageLoading]     = useState(false)
  const [pageError, setPageError]         = useState(null)
  // Per-section show-all toggles
  const [showAllPurchase, setShowAllPurchase] = useState(false)
  const [showAllSessions, setShowAllSessions] = useState(false)
  // Column sort directions (toggle desc↔asc on click)
  const [sortRevDir, setSortRevDir]   = useState('desc')   // Revenue col in purchase table
  const [sortSessDir, setSortSessDir] = useState('desc')   // Sessions col in all-pages table

  const hasComparison = filters.comparison !== 'off'

  // ── Data fetch ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedProperty?.ga4_property_id) return
    setLoading(true)
    setError(null)
    const effectiveFilters = {
      ...filters,
      deviceFilter: localDevice.length > 0 ? localDevice : filters.deviceFilter,
    }
    getLLMData(selectedProperty.ga4_property_id, effectiveFilters)
      .then(result => { setData(result); setLoading(false) })
      .catch(err => { setError(err.message); setLoading(false) })
  }, [selectedProperty, filters.dateRanges, filters.comparison, filters.countryFilter, localDevice])

  const handleSort = useCallback((key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }, [sortKey])

  // ── Row click: fetch landing page data for the clicked LLM ─────────────────
  const handleRowClick = useCallback(async (llmName) => {
    if (expandedLLM === llmName) {
      setExpandedLLM(null)
      setPurchasePages([])
      setAllPages([])
      return
    }
    setExpandedLLM(llmName)
    setPurchasePages([])
    setAllPages([])
    setPageLoading(true)
    setPageError(null)
    setShowAllPurchase(false)
    setShowAllSessions(false)
    setSortRevDir('desc')
    setSortSessDir('desc')
    try {
      const sourceKeys = Object.entries(LLM_SOURCE_MAP)
        .filter(([, name]) => name === llmName)
        .map(([key]) => key)
      const effectiveFilters = {
        ...filters,
        deviceFilter: localDevice.length > 0 ? localDevice : filters.deviceFilter,
      }
      const result = await getLLMPageData(
        selectedProperty?.ga4_property_id,
        sourceKeys,
        effectiveFilters
      )
      setPurchasePages(result.purchasePages)
      setAllPages(result.allPages)
    } catch (err) {
      setPageError(err.message)
    } finally {
      setPageLoading(false)
    }
  }, [expandedLLM, filters, localDevice, selectedProperty])

  // ── Table rows ──────────────────────────────────────────────────────────────

  const tableRows = useMemo(() => {
    if (!data?.current) return []
    let rows = data.current
    if (llmFilter.length > 0) rows = rows.filter(r => llmFilter.includes(r.llm))
    rows = rows.map(r => ({ ...r, health: computeLLMHealth(r) }))
    return [...rows].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity
      const bv = b[sortKey] ?? -Infinity
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [data, llmFilter, sortKey, sortDir])

  // ── Totals ──────────────────────────────────────────────────────────────────

  const totals = useMemo(() => {
    if (!tableRows.length) return null
    const ses = tableRows.reduce((s, r) => s + (r.sessions ?? 0), 0)
    const bk  = tableRows.reduce((s, r) => s + (r.bookings ?? 0), 0)
    const rev = tableRows.reduce((s, r) => s + (r.revenue  ?? 0), 0)
    return {
      sessions: ses, bookings: bk, revenue: rev,
      convRate: ses > 0 ? bk / ses : 0,
      revPerSession: ses > 0 ? rev / ses : 0,
    }
  }, [tableRows])

  // ── Granularity bucketing helpers ──────────────────────────────────────────

  function getBucketKey(dateStr, g) {
    const d = new Date(dateStr + 'T00:00:00')
    if (g === 'day')     return dateStr
    if (g === 'week') {
      // ISO week: find Monday of the week
      const day = d.getDay() // 0=Sun
      const diff = (day === 0 ? -6 : 1 - day)
      const mon = new Date(d)
      mon.setDate(d.getDate() + diff)
      return mon.toISOString().slice(0, 10)
    }
    if (g === 'month')   return dateStr.slice(0, 7)
    if (g === 'quarter') {
      const mo = d.getMonth() // 0-indexed
      return `${d.getFullYear()}-Q${Math.floor(mo / 3) + 1}`
    }
    if (g === 'year')    return String(d.getFullYear())
    return dateStr.slice(0, 7)
  }

  function fmtBucket(key, g) {
    if (g === 'day') {
      const d = new Date(key + 'T00:00:00')
      return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    }
    if (g === 'week') {
      const mon = new Date(key + 'T00:00:00')
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
      return `${mon.toLocaleString('en-GB', { day: 'numeric', month: 'short' })} – ${sun.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
    }
    if (g === 'month') {
      const [y, mo] = key.split('-')
      return new Date(Number(y), Number(mo) - 1, 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' })
    }
    if (g === 'quarter') return key.replace('-', ' ') // e.g. "2026 Q1"
    if (g === 'year')    return key
    return key
  }

  const GRANULARITY_LABEL = { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year' }

  // ── Pivot from dailySeries (granularity-aware) ──────────────────────────────

  const { months, pivotData } = useMemo(() => {
    if (!data?.dailySeries) return { months: [], pivotData: {} }
    const { currentDates, series } = data.dailySeries

    const bucketSet = new Set()
    currentDates.forEach(d => bucketSet.add(getBucketKey(d, granularity)))
    const months = [...bucketSet].sort()

    const pivotData = {}
    LLM_ORDER.forEach(name => {
      pivotData[name] = {}
      months.forEach(m => { pivotData[name][m] = { sessions: 0, bookings: 0, revenue: 0 } })
      const s = series[name]
      if (!s?.current) return
      currentDates.forEach((d, i) => {
        const m = getBucketKey(d, granularity)
        if (!pivotData[name][m]) return
        pivotData[name][m].sessions += s.current.sessions[i] || 0
        pivotData[name][m].bookings += s.current.bookings[i] || 0
        pivotData[name][m].revenue  += s.current.revenue[i]  || 0
      })
    })
    return { months, pivotData }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.dailySeries, granularity])

  const activeLLMs = LLM_ORDER

  function monthTotal(month, metric) {
    return activeLLMs.reduce((s, name) => s + (pivotData[name]?.[month]?.[metric] ?? 0), 0)
  }
  function llmTotal(name, metric) {
    return months.reduce((s, m) => s + (pivotData[name]?.[m]?.[metric] ?? 0), 0)
  }
  const grandTotal = months.reduce((s, m) => s + monthTotal(m, pivotMetric), 0)

  function fmtCell(v, metric) {
    if (!v) return '—'
    if (metric === 'revenue') { const a = Math.abs(v), s = v < 0 ? '-' : ''; return a >= 1e6 ? `${s}£${(a/1e6).toFixed(1)}M` : a >= 1e3 ? `${s}£${Math.round(a/1e3)}K` : `${s}£${Math.round(a)}` }
    return Math.round(v).toLocaleString()
  }

  // ── Date label ──────────────────────────────────────────────────────────────

  const dateLabel = useMemo(() => {
    if (!filters.dateRanges?.primary) return null
    const fmtR = r => r?.startDate && r?.endDate
      ? `${format(parseISO(r.startDate), 'MMM d, yyyy')} – ${format(parseISO(r.endDate), 'MMM d, yyyy')}`
      : null
    return { cur: fmtR(filters.dateRanges.primary), comp: fmtR(filters.dateRanges.comparison) }
  }, [filters.dateRanges])

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="page-content">
        <div style={{ marginBottom: 20 }}>
          <div className="skeleton" style={{ height: 24, width: 220, borderRadius: 6, marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 14, width: 340, borderRadius: 4 }} />
        </div>
        <div className="skeleton" style={{ height: 320, borderRadius: 12, marginBottom: 20 }} />
        <div className="skeleton" style={{ height: 420, borderRadius: 12 }} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-content">
        <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 12, padding: '24px 28px', color: '#92400E' }}>
          <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 14 }}>⚠ Data fetch error</div>
          <div style={{ fontSize: 13 }}>{error}</div>
        </div>
      </div>
    )
  }

  // ── Shared table styles ──────────────────────────────────────────────────────

  const thStyle = {
    padding: '10px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
    background: '#0A2540', color: '#CBD5E1', textAlign: 'right',
    whiteSpace: 'nowrap', borderBottom: 'none', borderRight: '1px solid #1E3A5F',
  }
  const thFirstStyle = { ...thStyle, textAlign: 'left', position: 'sticky', left: 0, zIndex: 5, minWidth: 110 }
  const tdStyle = (alt) => ({
    padding: '9px 12px', fontSize: 12.5, color: '#0A2540',
    background: alt ? '#F8FAFC' : '#fff',
    borderBottom: '1px solid #F1F5F9', borderRight: '1px solid #F1F5F9',
    textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
  })
  const tdFirstStyle = (alt) => ({ ...tdStyle(alt), textAlign: 'left', position: 'sticky', left: 0, zIndex: 2, fontWeight: 600 })
  const totRowStyle = {
    padding: '10px 12px', fontSize: 12, fontWeight: 700,
    background: '#EFF6FF', color: '#0A2540',
    borderTop: '2px solid #BFDBFE', borderRight: '1px solid #BFDBFE',
    textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
  }

  const noData = !data || tableRows.every(r => r.sessions === 0)

  return (
    <div className="page-content fade-in">
      <style>{`
        .dd-td{padding:9px 12px;font-size:12.5px;color:#0A2540;border-bottom:1px solid #F1F5F9;vertical-align:middle;}
        .dd-tr:hover .dd-td{background:#F8FAFC!important;}
        .llm-select{font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;padding:4px 8px;border:1px solid #E2E8F0;border-radius:6px;background:#F8FAFC;color:#0A2540;cursor:pointer;outline:none;}
        @keyframes dd-spin{to{transform:rotate(360deg)}}
        .dd-tr-clickable:hover td{background:#F0F9FF!important;}
      `}</style>

      {/* ── Local filter bar ── */}
      <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#5A6A7A' }}>LLMs</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button onClick={() => setLlmFilter([])} style={{ padding: '3px 9px', borderRadius: 6, border: '1px solid #E2E8F0', background: llmFilter.length === 0 ? '#0F5FA6' : '#F8FAFC', color: llmFilter.length === 0 ? '#fff' : '#5A6A7A', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>All</button>
          {LLM_ORDER.map(name => {
            const active = llmFilter.includes(name)
            return (
              <button key={name} onClick={() => setLlmFilter(prev => active ? prev.filter(n => n !== name) : [...prev, name])}
                style={{ padding: '3px 9px', borderRadius: 6, border: `1px solid ${active ? LLM_COLORS[name] : '#E2E8F0'}`, background: active ? LLM_COLORS[name] + '18' : '#F8FAFC', color: active ? LLM_COLORS[name] : '#5A6A7A', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}
              ><LLMDot name={name} />{name}</button>
            )
          })}
        </div>
        <div style={{ width: 1, height: 20, background: '#E2E8F0' }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: '#5A6A7A' }}>Device</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => setLocalDevice([])} style={{ padding: '3px 9px', borderRadius: 6, border: '1px solid #E2E8F0', background: localDevice.length === 0 ? '#0F5FA6' : '#F8FAFC', color: localDevice.length === 0 ? '#fff' : '#5A6A7A', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>All</button>
          {DEVICE_OPTIONS.map(d => {
            const active = localDevice.includes(d)
            return <button key={d} onClick={() => setLocalDevice(prev => active ? prev.filter(x => x !== d) : [...prev, d])} style={{ padding: '3px 9px', borderRadius: 6, border: '1px solid #E2E8F0', background: active ? '#0F5FA6' : '#F8FAFC', color: active ? '#fff' : '#5A6A7A', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>{d}</button>
          })}
        </div>
      </div>

      {/* ── No data ── */}
      {noData && (
        <div style={{ background: '#F8FAFC', border: '1px dashed #CBD5E1', borderRadius: 12, padding: '40px', textAlign: 'center', color: '#5A6A7A', marginBottom: 20 }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>🤖</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#0A2540', marginBottom: 4 }}>No LLM traffic found for this period</div>
          <div style={{ fontSize: 13 }}>Try extending your date range. LLM referral traffic typically requires the Last 30 days or longer.</div>
        </div>
      )}

      {!noData && (
        <>
          {/* ── Summary by Source ── */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: 20 }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0A2540' }}>Summary by Source</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 13 }}>👆</span> Click a source row to see landing pages
                </span>
                <span style={{ fontSize: 11, color: '#94A3B8' }}>Aggregated over selected date range</span>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'DM Sans',sans-serif" }}>
                <thead>
                  <tr>
                    {['Source', 'Sessions', 'Purchases', 'Revenue (£)', 'Conv. Rate', 'Rev / Session (£)'].map((h, i) => (
                      <th key={h} style={{
                        padding: '10px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
                        background: '#0A2540', color: '#CBD5E1',
                        textAlign: i === 0 ? 'left' : 'right',
                        whiteSpace: 'nowrap', borderRight: '1px solid #1E3A5F',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, idx) => {
                    const alt = idx % 2 !== 0
                    const bg = alt ? '#F8FAFC' : '#fff'
                    const isExpanded = expandedLLM === row.llm
                    const color = LLM_COLORS[row.llm] ?? '#94A3B8'
                    return (
                      <Fragment key={row.llm}>
                        <tr
                          className="dd-tr"
                          onClick={() => handleRowClick(row.llm)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td style={{ padding: '9px 12px', fontSize: 12.5, fontWeight: 600, color: '#0A2540', background: bg, borderBottom: isExpanded ? 'none' : '1px solid #F1F5F9', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                            <LLMDot name={row.llm} />{row.llm}
                            <span style={{
                              marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: 18, height: 18, borderRadius: '50%',
                              background: isExpanded ? color + '22' : '#F1F5F9',
                              color: isExpanded ? color : '#94A3B8',
                              fontSize: 10, fontWeight: 700,
                              transition: 'all 0.18s',
                              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                              flexShrink: 0,
                            }}>▾</span>
                          </td>
                          <td style={{ padding: '9px 12px', fontSize: 12.5, color: '#0A2540', background: bg, borderBottom: isExpanded ? 'none' : '1px solid #F1F5F9', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(row.sessions, 'int')}</td>
                          <td style={{ padding: '9px 12px', fontSize: 12.5, color: '#0A2540', background: bg, borderBottom: isExpanded ? 'none' : '1px solid #F1F5F9', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(row.bookings, 'int')}</td>
                          <td style={{ padding: '9px 12px', fontSize: 12.5, color: '#0A2540', background: bg, borderBottom: isExpanded ? 'none' : '1px solid #F1F5F9', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(row.revenue, 'gbp')}</td>
                          <td style={{ padding: '9px 12px', fontSize: 12.5, color: '#0A2540', background: bg, borderBottom: isExpanded ? 'none' : '1px solid #F1F5F9', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(row.convRate, 'pct2')}</td>
                          <td style={{ padding: '9px 12px', fontSize: 12.5, color: '#0A2540', background: bg, borderBottom: isExpanded ? 'none' : '1px solid #F1F5F9', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(row.revPerSession, 'gbp2')}</td>
                        </tr>

                        {/* ── Purchase Pages drill-down panel ── */}
                        {isExpanded && (
                          <tr key={`${row.llm}-pages`}>
                            <td colSpan={6} style={{ padding: 0, background: bg, borderBottom: '1px solid #E2E8F0' }}>
                              <div style={{
                                margin: '0 12px 12px 12px',
                                background: '#fff',
                                border: `1.5px solid ${color}33`,
                                borderRadius: 10,
                                overflow: 'hidden',
                                boxShadow: `0 2px 12px ${color}14`,
                              }}>
                                {/* Panel header */}
                                <div style={{
                                  padding: '10px 14px',
                                  background: `linear-gradient(90deg, ${color}0e 0%, transparent 100%)`,
                                  borderBottom: `1px solid ${color}22`,
                                  display: 'flex', alignItems: 'center', gap: 8,
                                }}>
                                  <LLMDot name={row.llm} />
                                  <span style={{ fontSize: 11, fontWeight: 700, color: '#0A2540', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                    {row.llm} — Landing Pages
                                  </span>
                                  <span style={{ fontSize: 10, color: '#94A3B8', marginLeft: 6 }}>landing pages from sessions that arrived via {row.llm}</span>
                                </div>

                                {/* Loading */}
                                {pageLoading && (
                                  <div style={{ padding: '20px 14px', display: 'flex', alignItems: 'center', gap: 10, color: '#94A3B8', fontSize: 12 }}>
                                    <span style={{ display: 'inline-block', width: 14, height: 14, border: `2px solid ${color}44`, borderTopColor: color, borderRadius: '50%', animation: 'dd-spin 0.7s linear infinite' }} />
                                    Loading landing pages…
                                  </div>
                                )}

                                {/* Error */}
                                {!pageLoading && pageError && (
                                  <div style={{ padding: '14px', fontSize: 12, color: '#B91C1C', background: '#FEF2F2', borderTop: '1px solid #FCA5A5' }}>
                                    ⚠ {pageError}
                                  </div>
                                )}

                                {/* ── Section 1: Pages with Purchases ── */}
                                {!pageLoading && !pageError && (() => {
                                  const sorted = sortRevDir === 'desc'
                                    ? [...purchasePages]
                                    : [...purchasePages].reverse()
                                  const visible = showAllPurchase ? sorted : sorted.slice(0, 15)
                                  const maxRev = purchasePages[0]?.revenue || 1
                                  return (
                                    <div style={{ borderBottom: allPages.length > 0 ? `1px solid ${color}22` : 'none' }}>
                                      {/* Section header */}
                                      <div style={{ padding: '8px 14px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <span style={{ fontSize: 10, fontWeight: 700, color: color, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                                          Pages with Purchases
                                        </span>
                                        <span style={{ fontSize: 10, color: '#94A3B8' }}>{purchasePages.length} pages</span>
                                      </div>
                                      {purchasePages.length === 0 ? (
                                        <div style={{ padding: '12px 14px', color: '#94A3B8', fontSize: 12 }}>No pages with purchases found.</div>
                                      ) : (
                                        <>
                                          {/* Column headers — Revenue is clickable to toggle sort */}
                                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px 110px', padding: '4px 14px 5px', borderBottom: '1px solid #F1F5F9', borderTop: '1px solid #F1F5F9' }}>
                                            <span style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Landing Page</span>
                                            <span style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: 'right' }}>Sessions</span>
                                            <span style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: 'right' }}>Purchases</span>
                                            <span
                                              onClick={(e) => { e.stopPropagation(); setSortRevDir(d => d === 'desc' ? 'asc' : 'desc') }}
                                              style={{ fontSize: 10, fontWeight: 700, color: color, letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: 'right', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3, userSelect: 'none' }}
                                            >
                                              Revenue (£) <span style={{ fontSize: 9 }}>{sortRevDir === 'desc' ? '↓' : '↑'}</span>
                                            </span>
                                          </div>
                                          {visible.map((p, pi) => (
                                            <div key={p.landingPage} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px 110px', padding: '7px 14px', background: pi % 2 === 0 ? '#fff' : '#FAFBFD', alignItems: 'center', borderBottom: '1px solid #F8FAFC' }}>
                                              <div style={{ overflow: 'hidden', paddingRight: 8 }}>
                                                <div style={{ fontSize: 12, color: '#0A2540', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }} title={p.landingPage}>{p.landingPage}</div>
                                                <div style={{ height: 2, borderRadius: 2, background: '#F1F5F9', overflow: 'hidden' }}>
                                                  <div style={{ height: '100%', width: `${Math.min(100, (p.revenue / maxRev) * 100)}%`, background: `linear-gradient(90deg, ${color}, ${color}88)`, borderRadius: 2, transition: 'width 0.4s ease' }} />
                                                </div>
                                              </div>
                                              <span style={{ fontSize: 12, color: '#64748B', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.sessions.toLocaleString()}</span>
                                              <span style={{ fontSize: 12.5, fontWeight: 700, color: '#0A2540', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.purchases.toLocaleString()}</span>
                                              <span style={{ fontSize: 12.5, fontWeight: 600, color: color, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>£{p.revenue.toFixed(2)}</span>
                                            </div>
                                          ))}
                                          {purchasePages.length > 15 && (
                                            <div style={{ padding: '7px 14px', display: 'flex', justifyContent: 'flex-end' }}>
                                              <button onClick={(e) => { e.stopPropagation(); setShowAllPurchase(v => !v) }}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: color, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 3 }}
                                                onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
                                                onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                                                {showAllPurchase ? '↑ Show less' : `↓ Show all ${purchasePages.length}`}
                                              </button>
                                            </div>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  )
                                })()}

                                {/* ── Section 2: All Pages by Sessions ── */}
                                {!pageLoading && !pageError && (() => {
                                  const sorted = sortSessDir === 'desc'
                                    ? [...allPages]
                                    : [...allPages].reverse()
                                  const visible = showAllSessions ? sorted : sorted.slice(0, 15)
                                  const maxSess = allPages[0]?.sessions || 1
                                  return (
                                    <div>
                                      {/* Section header */}
                                      <div style={{ padding: '8px 14px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <span style={{ fontSize: 10, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                                          All Landing Pages by Sessions
                                        </span>
                                        <span style={{ fontSize: 10, color: '#94A3B8' }}>{allPages.length} pages</span>
                                      </div>
                                      {allPages.length === 0 ? (
                                        <div style={{ padding: '12px 14px', color: '#94A3B8', fontSize: 12 }}>No session data found.</div>
                                      ) : (
                                        <>
                                          {/* Column headers — Sessions is clickable to toggle sort */}
                                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', padding: '4px 14px 5px', borderBottom: '1px solid #F1F5F9', borderTop: '1px solid #F1F5F9' }}>
                                            <span style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Landing Page</span>
                                            <span
                                              onClick={(e) => { e.stopPropagation(); setSortSessDir(d => d === 'desc' ? 'asc' : 'desc') }}
                                              style={{ fontSize: 10, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em', textTransform: 'uppercase', textAlign: 'right', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3, userSelect: 'none' }}
                                            >
                                              Sessions <span style={{ fontSize: 9 }}>{sortSessDir === 'desc' ? '↓' : '↑'}</span>
                                            </span>
                                          </div>
                                          {visible.map((p, pi) => (
                                            <div key={p.landingPage} style={{ display: 'grid', gridTemplateColumns: '1fr 100px', padding: '7px 14px', background: pi % 2 === 0 ? '#fff' : '#FAFBFD', alignItems: 'center', borderBottom: '1px solid #F8FAFC' }}>
                                              <div style={{ overflow: 'hidden', paddingRight: 8 }}>
                                                <div style={{ fontSize: 12, color: '#0A2540', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }} title={p.landingPage}>{p.landingPage}</div>
                                                <div style={{ height: 2, borderRadius: 2, background: '#F1F5F9', overflow: 'hidden' }}>
                                                  <div style={{ height: '100%', width: `${Math.min(100, (p.sessions / maxSess) * 100)}%`, background: 'linear-gradient(90deg, #64748B, #94A3B8)', borderRadius: 2, transition: 'width 0.4s ease' }} />
                                                </div>
                                              </div>
                                              <span style={{ fontSize: 12.5, fontWeight: 600, color: '#334155', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.sessions.toLocaleString()}</span>
                                            </div>
                                          ))}
                                          {allPages.length > 15 && (
                                            <div style={{ padding: '7px 14px', display: 'flex', justifyContent: 'flex-end' }}>
                                              <button onClick={(e) => { e.stopPropagation(); setShowAllSessions(v => !v) }}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#64748B', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 3 }}
                                                onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
                                                onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                                                {showAllSessions ? '↑ Show less' : `↓ Show all ${allPages.length}`}
                                              </button>
                                            </div>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  )
                                })()}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                  {totals && (
                    <tr>
                      <td style={{ padding: '10px 12px', fontSize: 12, fontWeight: 700, background: '#EFF6FF', color: '#3B82F6', borderTop: '2px solid #BFDBFE', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Total</td>
                      <td style={{ padding: '10px 12px', fontSize: 12, fontWeight: 700, background: '#EFF6FF', color: '#0A2540', borderTop: '2px solid #BFDBFE', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(totals.sessions, 'int')}</td>
                      <td style={{ padding: '10px 12px', fontSize: 12, fontWeight: 700, background: '#EFF6FF', color: '#0A2540', borderTop: '2px solid #BFDBFE', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(totals.bookings, 'int')}</td>
                      <td style={{ padding: '10px 12px', fontSize: 12, fontWeight: 700, background: '#EFF6FF', color: '#0A2540', borderTop: '2px solid #BFDBFE', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(totals.revenue, 'gbp')}</td>
                      <td style={{ padding: '10px 12px', fontSize: 12, fontWeight: 700, background: '#EFF6FF', color: '#0A2540', borderTop: '2px solid #BFDBFE', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(totals.convRate, 'pct2')}</td>
                      <td style={{ padding: '10px 12px', fontSize: 12, fontWeight: 700, background: '#EFF6FF', color: '#0A2540', borderTop: '2px solid #BFDBFE', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(totals.revPerSession, 'gbp2')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Monthly Breakdown ── */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: 20 }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0A2540' }}>Monthly Breakdown</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {/* Granularity toggle */}
                <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 7, padding: 2, gap: 1 }}>
                  {['day', 'week', 'month', 'quarter', 'year'].map(g => {
                    const active = granularity === g
                    return (
                      <button key={g} onClick={() => setGranularity(g)} style={{ padding: '4px 11px', border: 'none', borderRadius: 5, background: active ? '#334155' : 'transparent', color: active ? '#fff' : '#5A6A7A', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', transition: 'all 0.12s', whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
                        {GRANULARITY_LABEL[g]}
                      </button>
                    )
                  })}
                </div>
                {/* Metric toggle */}
                <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 7, padding: 2, gap: 1 }}>
                  {[{ value: 'sessions', label: 'Count' }, { value: 'bookings', label: 'Purchases' }, { value: 'revenue', label: 'Revenue' }].map(({ value, label }) => {
                    const active = pivotMetric === value
                    return (
                      <button key={value} onClick={() => setPivotMetric(value)} style={{ padding: '4px 14px', border: 'none', borderRadius: 5, background: active ? '#0F5FA6' : 'transparent', color: active ? '#fff' : '#5A6A7A', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', transition: 'all 0.12s', whiteSpace: 'nowrap' }}>
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {months.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>No data available for this period.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'DM Sans',sans-serif" }}>
                  <thead>
                    <tr>
                      <th style={{ ...thFirstStyle, background: '#0A2540' }}>{GRANULARITY_LABEL[granularity]}</th>
                      {activeLLMs.map(name => (
                        <th key={name} style={{ ...thStyle, textAlign: 'center' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: LLM_COLORS[name], display: 'inline-block' }} />
                            {name}
                          </div>
                        </th>
                      ))}
                      <th style={{ ...thStyle, textAlign: 'right', color: '#fff', background: '#0A2540' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((month, idx) => {
                      const alt = idx % 2 !== 0
                      const rowMonthTotal = monthTotal(month, pivotMetric)
                      return (
                        <tr key={month} className="dd-tr">
                          <td style={tdFirstStyle(alt)}>{fmtBucket(month, granularity)}</td>
                          {activeLLMs.map(name => {
                            const val = pivotData[name]?.[month]?.[pivotMetric] ?? 0
                            return (
                              <td key={name} style={tdStyle(alt)}>
                                {val === 0 ? '—' : fmtCell(val, pivotMetric)}
                              </td>
                            )
                          })}
                          <td style={{ ...tdStyle(alt), fontWeight: 700 }}>
                            {rowMonthTotal === 0 ? '—' : fmtCell(rowMonthTotal, pivotMetric)}
                          </td>
                        </tr>
                      )
                    })}
                    {/* Grand totals row */}
                    <tr>
                      <td style={{ ...totRowStyle, textAlign: 'left', position: 'sticky', left: 0, zIndex: 2, color: '#3B82F6', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11 }}>Total</td>
                      {activeLLMs.map(name => (
                        <td key={name} style={totRowStyle}>
                          {fmtCell(llmTotal(name, pivotMetric), pivotMetric)}
                        </td>
                      ))}
                      <td style={{ ...totRowStyle, color: '#0F5FA6' }}>
                        {fmtCell(grandTotal, pivotMetric)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
