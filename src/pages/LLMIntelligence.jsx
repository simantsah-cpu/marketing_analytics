import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { format, parseISO } from 'date-fns'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { useFilters } from '../context/FiltersContext'
import { useProperty } from '../context/PropertyContext'
import { getLLMData, LLM_COLORS, LLM_ORDER, mergeLLMRows } from '../services/llm-data-service'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmt(v, type) {
  if (v === null || v === undefined || isNaN(v)) return '—'
  switch (type) {
    case 'int':  return Math.round(v).toLocaleString()
    case 'pct1': return `${(v * 100).toFixed(1)}%`
    case 'pct2': return `${(v * 100).toFixed(2)}%`
    case 'gbp': { const a = Math.abs(v), s = v < 0 ? '-' : ''; if (a >= 1e6) return `${s}£${(a/1e6).toFixed(1)}M`; if (a >= 1e4) return `${s}£${Math.round(a/1e3)}K`; return `${s}£${Math.round(a).toLocaleString('en-GB')}` }
    case 'gbp2': return `£${v.toFixed(2)}`
    case 'dur': {
      const m = Math.floor(v / 60); const s = Math.round(v % 60)
      return `${m}:${String(s).padStart(2, '0')}`
    }
    default: return String(v)
  }
}

// Minimum comparison-period sessions required to show a meaningful delta.
// Below this the % swing is statistically noise (e.g. 3 sessions last year vs 989 now).
const MIN_BASELINE_SESSIONS = 10

function makeBadge(curr, prev, type, prevSessions) {
  if (prev === null || prev === undefined || prev === 0) return null
  // Suppress volume-metric deltas when the comparison baseline is too small to be meaningful
  const isVolume = type !== 'pct1' && type !== 'pct2'
  if (isVolume && prevSessions !== undefined && prevSessions < MIN_BASELINE_SESSIONS) return null
  const isPct = type === 'pct1' || type === 'pct2'
  const delta = curr - prev
  const deltaPct = ((curr - prev) / Math.abs(prev)) * 100
  const neutral = Math.abs(deltaPct) < 2
  const good = isPct ? delta > 0 : deltaPct > 0
  const color = neutral ? '#94A3B8' : good ? '#16A34A' : '#DC2626'
  const bg = neutral ? '#F1F5F9' : good ? '#DCFCE7' : '#FEE2E2'
  const sign = delta >= 0 ? '+' : ''
  const label = isPct ? `${sign}${(delta * 100).toFixed(1)}pp` : `${sign}${deltaPct.toFixed(1)}%`
  return { label, color, bg, delta, deltaPct }
}

// ─── LLM Health (simple 3-tier based on CVR + sessions) ──────────────────────

function computeLLMHealth(row) {
  const cvr = row.convRate ?? 0
  const ses = row.sessions ?? 0
  if (cvr >= 0.015 && ses >= 500) return 'Healthy'
  if (cvr >= 0.005 || ses >= 100)  return 'Watch'
  return 'At Risk'
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LLMDot({ name }) {
  return (
    <span style={{
      display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
      background: LLM_COLORS[name] ?? '#94A3B8', flexShrink: 0, marginRight: 6,
    }} />
  )
}

function DeltaCell({ curr, prev, fmtType, hasComp, prevSessions }) {
  const [tip, setTip] = useState(null)
  const badge = hasComp && prev != null ? makeBadge(curr, prev, fmtType, prevSessions) : null
  return (
    <td className="sc-td" style={{ textAlign: 'right' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(curr, fmtType)}</span>
        {badge && (
          <span
            style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 10, background: badge.bg, color: badge.color, whiteSpace: 'nowrap', cursor: 'default' }}
            onMouseEnter={e => setTip({ x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setTip(null)}
          >{badge.label}</span>
        )}
      </div>
      {tip && badge && (
        <div style={{ position: 'fixed', zIndex: 9999, top: tip.y - 80, left: tip.x - 60, background: '#0A2540', color: '#fff', padding: '8px 12px', borderRadius: 8, fontSize: 11, lineHeight: 1.9, whiteSpace: 'nowrap', boxShadow: '0 4px 20px rgba(0,0,0,0.25)', pointerEvents: 'none' }}>
          <div>Current: <strong>{fmt(curr, fmtType)}</strong></div>
          <div>Previous: <strong>{fmt(prev, fmtType)}</strong></div>
          <div>Change: <strong style={{ color: badge.color }}>{badge.label}</strong></div>
        </div>
      )}
    </td>
  )
}

function HealthPill({ label }) {
  const color = label === 'Healthy' ? '#16A34A' : label === 'Watch' ? '#D97706' : '#DC2626'
  const bg    = label === 'Healthy' ? '#DCFCE7' : label === 'Watch' ? '#FEF3C7' : '#FEE2E2'
  return (
    <td className="sc-td" style={{ textAlign: 'center' }}>
      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 10, background: bg, color }}>{label}</span>
    </td>
  )
}

function SortTh({ col, label, sortKey, sortDir, onSort, style = {}, noSort }) {
  const active = sortKey === col
  return (
    <th
      style={{ cursor: noSort ? 'default' : 'pointer', userSelect: 'none', whiteSpace: 'nowrap', padding: '10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', background: '#F8FAFC', borderBottom: '2px solid #E2E8F0', color: active ? '#0F5FA6' : '#5A6A7A', ...style }}
      onClick={() => !noSort && onSort(col)}
    >
      {label}{active && !noSort && <span style={{ marginLeft: 4, fontSize: 10 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  )
}

// ─── Inline AI Chat ───────────────────────────────────────────────────────────

const LLM_SYSTEM_PROMPT = `You are an analytics assistant for hoppa.com. The user is looking at LLM referral traffic data — sessions and bookings driven by AI tools like ChatGPT, Gemini, Copilot, Perplexity, Claude and Grok. Answer questions about the data concisely. Flag anything unusual. CVR benchmarks: ChatGPT airport pages 1.36%, homepage 0.76%. The main issue to watch is the homepage loop rate — 76% of LLM users arriving at the homepage loop back without searching.`

function LLMChat({ tableData, filters }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [unconfigured, setUnconfigured] = useState(false)
  const [open, setOpen] = useState(false)
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)
  const abortRef  = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streaming])

  const sendMessage = async (text) => {
    const trimmed = text.trim()
    if (!trimmed || streaming) return
    setInput('')
    setUnconfigured(false)
    setOpen(true)
    const history = messages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))
    setMessages(prev => [...prev, { role: 'user', content: trimmed }])
    setStreaming(true)
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/ai-invoke`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
        body: JSON.stringify({
          mode: 'chat',
          message: trimmed,
          context: {
            chartTitle: 'LLM Intelligence',
            chartType: 'llm',
            dateRange: filters.preset,
            data: tableData,
          },
          conversationHistory: history.slice(-12),
          systemPrompt: LLM_SYSTEM_PROMPT,
        }),
      })
      if (res.status === 404 || res.status === 405) { setStreaming(false); setUnconfigured(true); return }
      if (!res.ok) { const msg = await res.text().catch(() => `HTTP ${res.status}`); if (msg.includes('FunctionNotFound') || msg.toLowerCase().includes('not found')) { setStreaming(false); setUnconfigured(true); return }; throw new Error(msg) }
      let accumulated = ''
      setMessages(prev => [...prev, { role: 'ai', content: '', streaming: true }])
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('text/event-stream') || contentType.includes('text/plain')) {
        const reader = res.body.getReader(); const decoder = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read(); if (done) break
          const chunk = decoder.decode(value, { stream: true })
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data: ')) {
              const payload = line.slice(6).trim(); if (payload === '[DONE]') continue
              try { const parsed = JSON.parse(payload); accumulated += parsed?.choices?.[0]?.delta?.content ?? parsed?.delta?.text ?? parsed?.content ?? '' } catch { accumulated += payload }
            } else if (line && !line.startsWith('event:') && !line.startsWith(':')) { accumulated += line }
          }
          const snap = accumulated
          setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { role: 'ai', content: snap, streaming: true } : m))
        }
      } else { const json = await res.json(); accumulated = json?.content ?? json?.text ?? json?.reply ?? JSON.stringify(json) }
      setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { role: 'ai', content: accumulated, streaming: false } : m))
    } catch (err) {
      if (err.name === 'AbortError') return
      if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) { setStreaming(false); setUnconfigured(true); return }
      setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { role: 'ai', content: `Error: ${err.message}`, streaming: false } : m))
    } finally { setStreaming(false) }
  }

  const renderMd = text => text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>').replace(/`(.*?)`/g, '<code style="background:#EFF6FF;padding:1px 4px;border-radius:3px;font-size:11px">$1</code>').replace(/\n/g, '<br/>')

  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginTop: 20 }}>
      <div style={{ padding: '14px 18px', background: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)', borderBottom: '1px solid #DBEAFE', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }} onClick={() => setOpen(o => !o)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="#1A7FD4"><path d="M12 2l2.4 7.2L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"/></svg>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#0A2540' }}>AI Assistant — LLM Intelligence</span>
        <span style={{ fontSize: 9, fontWeight: 700, color: '#1A7FD4', background: '#DBEAFE', borderRadius: 4, padding: '1px 5px', letterSpacing: '0.04em' }}>CLAUDE</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#5A6A7A' }}>{open ? '▲ collapse' : '▼ expand'}</span>
      </div>
      {open && (
        <>
          {messages.length > 0 && (
            <div style={{ maxHeight: 320, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {messages.map((msg, i) => (
                <div key={i} style={msg.role === 'user' ? { alignSelf: 'flex-end', background: '#0F5FA6', color: '#fff', borderRadius: '12px 12px 2px 12px', padding: '8px 12px', maxWidth: '80%', fontSize: 12.5, lineHeight: 1.55 } : { alignSelf: 'flex-start', background: '#F0F7FF', border: '1px solid #DBEAFE', borderRadius: '2px 12px 12px 12px', padding: '8px 12px', maxWidth: '90%', fontSize: 12.5, lineHeight: 1.55, color: '#0A2540' }}>
                  <span dangerouslySetInnerHTML={{ __html: renderMd(msg.content) }} />
                  {msg.streaming && <span style={{ display: 'inline-block', width: 2, height: 13, background: '#1A7FD4', marginLeft: 2, verticalAlign: 'middle', animation: 'llm-blink 1s step-end infinite' }} />}
                </div>
              ))}
              {unconfigured && (
                <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#92400E' }}>
                  Chat requires the <code style={{ background: '#FEF3C7', padding: '1px 4px', borderRadius: 3 }}>ai-chat</code> Edge Function to be deployed.
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
          <div style={{ padding: '12px 16px', borderTop: messages.length > 0 ? '1px solid #E2E8F0' : 'none', background: '#FAFBFC' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
                placeholder="Ask about your LLM traffic — e.g. Which LLM drove the most revenue last month? Why is Copilot CVR dropping?"
                disabled={streaming}
                style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid #E2E8F0', outline: 'none', fontSize: 12.5, fontFamily: 'inherit', color: '#0A2540', background: streaming ? '#F8FAFC' : '#fff' }}
                onFocus={e => e.currentTarget.style.borderColor = '#1A7FD4'}
                onBlur={e => e.currentTarget.style.borderColor = '#E2E8F0'}
              />
              <button onClick={() => sendMessage(input)} disabled={streaming || !input.trim()} style={{ width: 36, height: 36, borderRadius: 8, border: 'none', background: streaming || !input.trim() ? '#E2E8F0' : '#0F5FA6', color: streaming || !input.trim() ? '#94A3B8' : '#fff', cursor: streaming || !input.trim() ? 'not-allowed' : 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {streaming ? <span style={{ width: 14, height: 14, border: '2px solid #CBD5E1', borderTopColor: '#94A3B8', borderRadius: '50%', animation: 'llm-spin 0.8s linear infinite', display: 'inline-block' }} /> : '↑'}
              </button>
            </div>
            <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 5 }}>Powered by Claude · analysing LLM referral traffic for hoppa.com</div>
          </div>
        </>
      )}
      <style>{`@keyframes llm-blink{0%,100%{opacity:1}50%{opacity:0}} @keyframes llm-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ─── Granularity aggregation ─────────────────────────────────────────────────

const GRANULARITIES = [
  { value: 'day',     label: 'Day' },
  { value: 'week',    label: 'Week' },
  { value: 'month',   label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year',    label: 'Year' },
]

function getBucket(dateStr, granularity) {
  const d = new Date(dateStr + 'T00:00:00')
  switch (granularity) {
    case 'week': {
      const dow = d.getDay() || 7
      const monday = new Date(d)
      monday.setDate(d.getDate() - dow + 1)
      return monday.toISOString().slice(0, 10)
    }
    case 'month':   return dateStr.slice(0, 7)
    case 'quarter': return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`
    case 'year':    return String(d.getFullYear())
    default:        return dateStr
  }
}

function aggregateByGranularity(dailySeries, granularity) {
  if (!dailySeries || granularity === 'day') return dailySeries
  const { currentDates, series } = dailySeries

  const seen = new Set(); const buckets = []
  currentDates.forEach(d => { const b = getBucket(d, granularity); if (!seen.has(b)) { seen.add(b); buckets.push(b) } })

  const newSeries = {}
  Object.entries(series).forEach(([name, llmData]) => {
    const cur = llmData.current
    if (!cur) { newSeries[name] = llmData; return }
    const bmap = {}
    buckets.forEach(b => { bmap[b] = { ses: 0, bk: 0, rev: 0, engWt: 0, bounceWt: 0 } })
    currentDates.forEach((d, i) => {
      const b = getBucket(d, granularity); if (!bmap[b]) return
      const m = bmap[b]; const ses = cur.sessions[i] || 0
      m.ses += ses; m.bk += cur.bookings[i] || 0; m.rev += cur.revenue[i] || 0
      m.engWt += (cur.engagementRate[i] || 0) * ses
      m.bounceWt += (cur.bounceRate[i] || 0) * ses
    })
    newSeries[name] = {
      current: {
        sessions:       buckets.map(b => bmap[b].ses),
        bookings:       buckets.map(b => bmap[b].bk),
        revenue:        buckets.map(b => parseFloat(bmap[b].rev.toFixed(2))),
        cvr:            buckets.map(b => bmap[b].ses > 0 ? bmap[b].bk / bmap[b].ses : 0),
        aov:            buckets.map(b => bmap[b].bk > 0 ? bmap[b].rev / bmap[b].bk : 0),
        engagementRate: buckets.map(b => bmap[b].ses > 0 ? bmap[b].engWt / bmap[b].ses : 0),
        bounceRate:     buckets.map(b => bmap[b].ses > 0 ? bmap[b].bounceWt / bmap[b].ses : 0),
        avgDuration:    buckets.map(() => cur.avgDuration?.[0] ?? 0),
      },
      comparison: null,
    }
  })
  return { currentDates: buckets, comparisonDates: [], series: newSeries }
}

// ─── Trend Chart ──────────────────────────────────────────────────────────────

const METRIC_OPTIONS = [
  { value: 'sessions',     label: 'Sessions' },
  { value: 'bookings',     label: 'Bookings' },
  { value: 'revenue',      label: 'Revenue' },
  { value: 'cvr',          label: 'CVR' },
  { value: 'aov',          label: 'AOV' },
  { value: 'engagementRate', label: 'Eng. Rate' },
  { value: 'bounceRate',   label: 'Bounce Rate' },
  { value: 'avgDuration',  label: 'Avg Session Duration' },
]

const METRIC_FMT = {
  sessions: v => Math.round(v).toLocaleString(),
  bookings: v => v.toFixed(1),
  revenue:  v => { const a = Math.abs(v), s = v < 0 ? '-' : ''; return a >= 1e6 ? `${s}£${(a/1e6).toFixed(1)}M` : a >= 1e3 ? `${s}£${Math.round(a/1e3)}K` : `${s}£${Math.round(a)}` },
  cvr:      v => `${(v * 100).toFixed(2)}%`,
  aov:      v => `£${v.toFixed(0)}`,
  engagementRate: v => `${(v * 100).toFixed(1)}%`,
  bounceRate:     v => `${(v * 100).toFixed(1)}%`,
  avgDuration:    v => { const m = Math.floor(v/60); const s = Math.round(v%60); return `${m}:${String(s).padStart(2,'0')}` },
}

function LLMTrendChart({ dailySeries, selectedMetric, visibleLLMs }) {
  if (!dailySeries) return (
    <div style={{ height: 270, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 13 }}>
      No trend data available for this period.
    </div>
  )

  const { currentDates, series } = dailySeries
  const datasets = []

  LLM_ORDER.forEach(name => {
    if (visibleLLMs[name] === false) return
    const s = series[name]
    if (!s) return
    const color = LLM_COLORS[name]
    const curData = s.current[selectedMetric] ?? []

    datasets.push({
      label: name,
      data: curData,
      borderColor: color,
      backgroundColor: color + '15',
      borderWidth: 2,
      pointRadius: curData.length > 60 ? 0 : 2,
      pointHoverRadius: 4,
      tension: 0.3,
      fill: false,
    })
  })

  const chartData = { labels: currentDates, datasets }

  const mf = METRIC_FMT[selectedMetric] ?? (v => String(v))

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: ctx => ` ${ctx.dataset.label}: ${mf(ctx.raw ?? 0)}`,
        },
        backgroundColor: '#0A2540',
        titleColor: '#94A3B8',
        bodyColor: '#fff',
        padding: 12,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 11 }, color: '#94A3B8', maxRotation: 0, autoSkip: true, maxTicksLimit: 10 },
      },
      y: {
        grid: { color: '#F1F5F9' },
        ticks: { font: { size: 11 }, color: '#94A3B8', callback: v => mf(v) },
        beginAtZero: true,
      },
    },
  }

  return <div style={{ height: 270 }}><Line data={chartData} options={options} /></div>
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const DEVICE_OPTIONS = ['desktop', 'mobile', 'tablet']

export default function LLMIntelligence() {
  const { filters }          = useFilters()
  const { selectedProperty } = useProperty()

  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  // Local filter state (LLM-specific, not in global FiltersContext)
  const [llmFilter, setLlmFilter]           = useState([])       // [] = all
  const [localDevice, setLocalDevice]       = useState([])       // [] = all
  const [selectedMetric, setSelectedMetric] = useState('sessions')
  const [sortKey, setSortKey]               = useState('revenue')
  const [sortDir, setSortDir]               = useState('desc')
  const [visibleLLMs, setVisibleLLMs]       = useState({})       // legend toggles
  const [granularity, setGranularity]       = useState('day')    // chart x-axis granularity

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

  // ── Sort handler ────────────────────────────────────────────────────────────

  const handleSort = useCallback((key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }, [sortKey])

  // ── Table rows (apply local LLM filter + sort) ──────────────────────────────

  const tableRows = useMemo(() => {
    if (!data?.current) return []
    let rows = data.current
    if (llmFilter.length > 0) rows = rows.filter(r => llmFilter.includes(r.llm))

    // Build comparison lookup
    const compMap = {}
    if (data.comparison && hasComparison) {
      data.comparison.forEach(r => { compMap[r.llm] = r })
    }

    rows = rows.map(r => ({
      ...r,
      health:          computeLLMHealth(r),
      // Null out comparison values when the baseline sessions are below the minimum
      // threshold — prevents misleading deltas like +163% from 3 sessions last year.
      prevSessions:    compMap[r.llm]?.sessions    ?? null,
      prevBookings:    compMap[r.llm]?.sessions >= MIN_BASELINE_SESSIONS ? (compMap[r.llm]?.bookings ?? null) : null,
      prevRevenue:     compMap[r.llm]?.sessions >= MIN_BASELINE_SESSIONS ? (compMap[r.llm]?.revenue  ?? null) : null,
      prevEngRate:     compMap[r.llm]?.sessions >= MIN_BASELINE_SESSIONS ? (compMap[r.llm]?.engagementRate ?? null) : null,
      prevConvRate:    compMap[r.llm]?.sessions >= MIN_BASELINE_SESSIONS ? (compMap[r.llm]?.convRate  ?? null) : null,
      prevAov:         compMap[r.llm]?.sessions >= MIN_BASELINE_SESSIONS ? (compMap[r.llm]?.aov       ?? null) : null,
      prevRevPerSes:   compMap[r.llm]?.sessions >= MIN_BASELINE_SESSIONS ? (compMap[r.llm]?.revPerSession ?? null) : null,
    }))

    return [...rows].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity
      const bv = b[sortKey] ?? -Infinity
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [data, llmFilter, hasComparison, sortKey, sortDir])

  // ── Totals row ──────────────────────────────────────────────────────────────

  const totals = useMemo(() => {
    if (!tableRows.length) return null
    const ses = tableRows.reduce((s, r) => s + (r.sessions ?? 0), 0)
    const bk  = tableRows.reduce((s, r) => s + (r.bookings ?? 0), 0)
    const rev = tableRows.reduce((s, r) => s + (r.revenue  ?? 0), 0)
    const eng = tableRows.reduce((s, r) => s + (r.engagementRate ?? 0) * (r.sessions ?? 0), 0)

    const pSes = hasComparison ? tableRows.reduce((s, r) => s + (r.prevSessions ?? 0), 0) : null
    const pBk  = hasComparison ? tableRows.reduce((s, r) => s + (r.prevBookings ?? 0), 0) : null
    const pRev = hasComparison ? tableRows.reduce((s, r) => s + (r.prevRevenue  ?? 0), 0) : null
    const pEng = hasComparison && pSes > 0 ? tableRows.reduce((s, r) => s + (r.prevEngRate ?? 0) * (r.prevSessions ?? 0), 0) / pSes : null

    return {
      sessions: ses, bookings: bk, revenue: rev,
      engagementRate: ses > 0 ? eng / ses : 0,
      convRate: ses > 0 ? bk / ses : 0,
      aov: bk > 0 ? rev / bk : 0,
      revPerSession: ses > 0 ? rev / ses : 0,
      prevSessions: pSes, prevBookings: pBk, prevRevenue: pRev,
      prevEngRate: pEng,
      prevConvRate: pSes > 0 ? pBk / pSes : null,
      prevAov: pBk > 0 ? pRev / pBk : null,
      prevRevPerSes: pSes > 0 ? pRev / pSes : null,
    }
  }, [tableRows, hasComparison])

  // ─── Date range label ───────────────────────────────────────────────────────

  const dateLabel = useMemo(() => {
    if (!filters.dateRanges?.primary) return null
    const fmtR = r => r?.startDate && r?.endDate
      ? `${format(parseISO(r.startDate), 'MMM d, yyyy')} – ${format(parseISO(r.endDate), 'MMM d, yyyy')}`
      : null
    return { cur: fmtR(filters.dateRanges.primary), comp: fmtR(filters.dateRanges.comparison) }
  }, [filters.dateRanges])

  // ── Loading skeleton ────────────────────────────────────────────────────────

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

  // ── Error state ─────────────────────────────────────────────────────────────

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

  const noData = !data || tableRows.every(r => r.sessions === 0)

  // ── Render ──────────────────────────────────────────────────────────────────

  const thBase = { padding: '10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', background: '#F8FAFC', borderBottom: '2px solid #E2E8F0', color: '#5A6A7A', userSelect: 'none', whiteSpace: 'nowrap' }

  return (
    <div className="page-content fade-in">
      <style>{`
        .sc-td{padding:9px 10px;font-size:12.5px;color:#0A2540;border-bottom:1px solid #F1F5F9;vertical-align:middle;}
        .sc-tr:hover .sc-td{background:#F8FAFC!important;}
        .llm-name-cell{position:sticky;left:44px;z-index:1;font-weight:600;}
        .llm-rank-cell{position:sticky;left:0;z-index:1;}
        .llm-select{font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;padding:4px 8px;border:1px solid #E2E8F0;border-radius:6px;background:#F8FAFC;color:#0A2540;cursor:pointer;outline:none;}
        .llm-select:focus{border-color:#1A7FD4;}
      `}</style>

      {/* ── Local filter bar ── */}
      <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        {/* LLM chips */}
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
        {/* Device filter */}
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
          <div style={{ fontSize: 13 }}>Try extending your date range. LLM referral traffic typically requires the Last 30 days or longer to show meaningful data.</div>
        </div>
      )}

      {/* ── Trend chart ── */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', padding: '20px 24px', marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0A2540' }}>Performance by LLM</div>
            <div style={{ fontSize: 11, color: '#5A6A7A', marginTop: 2 }}>
              {GRANULARITIES.find(g => g.value === granularity)?.label} view · proportional per LLM
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Granularity toggle — matches reference screenshot */}
            <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 7, padding: 2, gap: 1 }}>
              {GRANULARITIES.map(({ value, label }) => {
                const active = granularity === value
                return (
                  <button key={value} onClick={() => setGranularity(value)} style={{ padding: '4px 11px', border: 'none', borderRadius: 5, background: active ? '#0F5FA6' : 'transparent', color: active ? '#fff' : '#5A6A7A', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', transition: 'all 0.12s', whiteSpace: 'nowrap' }}>
                    {label}
                  </button>
                )
              })}
            </div>
            <span style={{ width: 1, height: 20, background: '#E2E8F0', display: 'inline-block' }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: '#5A6A7A' }}>Metric</span>
            <select className="llm-select" value={selectedMetric} onChange={e => setSelectedMetric(e.target.value)}>
              {METRIC_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </div>
        {/* Clickable legend */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {LLM_ORDER.map(name => {
            const hidden = visibleLLMs[name] === false
            const llmRow = data?.current?.find(r => r.llm === name)
            const hasAnyData = (llmRow?.sessions ?? 0) > 0
            return (
              <button key={name} onClick={() => setVisibleLLMs(prev => ({ ...prev, [name]: prev[name] === false ? true : false }))}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 20, border: `1px solid ${hidden || !hasAnyData ? '#E2E8F0' : LLM_COLORS[name] + '50'}`, background: hidden || !hasAnyData ? '#F8FAFC' : LLM_COLORS[name] + '12', cursor: 'pointer', fontFamily: 'inherit', opacity: !hasAnyData ? 0.4 : 1 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: hidden ? '#CBD5E1' : LLM_COLORS[name], display: 'inline-block' }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: hidden ? '#94A3B8' : '#0A2540' }}>{name}</span>
                {!hasAnyData && <span style={{ fontSize: 9, color: '#94A3B8' }}>0 ses</span>}
              </button>
            )
          })}
        </div>
        <LLMTrendChart
          dailySeries={aggregateByGranularity(data?.dailySeries, granularity)}
          selectedMetric={selectedMetric}
          visibleLLMs={visibleLLMs}
        />
      </div>

      {/* ── Scorecard table ── */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0A2540' }}>LLM Scorecard</div>
          <div style={{ fontSize: 11, color: '#94A3B8' }}>{tableRows.length} LLM{tableRows.length !== 1 ? 's' : ''} · {hasComparison ? `vs ${filters.comparison === 'prevYear' ? 'last year' : 'prev period'} · hover badges` : 'no comparison active'}</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'DM Sans',sans-serif" }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 4 }}>
              <tr>
                <th style={{ ...thBase, position: 'sticky', left: 0, zIndex: 5, width: 44, textAlign: 'center' }}>#</th>
                <th style={{ ...thBase, position: 'sticky', left: 44, zIndex: 5, minWidth: 140, textAlign: 'left' }}>LLM</th>
                <SortTh col="sessions"       label="Sessions"    sortKey={sortKey} sortDir={sortDir} onSort={handleSort} style={{ minWidth: 90, textAlign: 'right' }} />
                <SortTh col="engagementRate" label="Eng. Rate"   sortKey={sortKey} sortDir={sortDir} onSort={handleSort} style={{ minWidth: 90, textAlign: 'right' }} />
                <SortTh col="convRate"       label="Conv. Rate"  sortKey={sortKey} sortDir={sortDir} onSort={handleSort} style={{ minWidth: 90, textAlign: 'right' }} />
                <SortTh col="bookings"       label="Bookings"    sortKey={sortKey} sortDir={sortDir} onSort={handleSort} style={{ minWidth: 90, textAlign: 'right' }} />
                <SortTh col="revenue"        label="Revenue"     sortKey={sortKey} sortDir={sortDir} onSort={handleSort} style={{ minWidth: 100, textAlign: 'right' }} />
                <SortTh col="aov"            label="AOV"         sortKey={sortKey} sortDir={sortDir} onSort={handleSort} style={{ minWidth: 80, textAlign: 'right' }} />
                <SortTh col="revPerSession"  label="Rev/Session" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} style={{ minWidth: 100, textAlign: 'right' }} />
                <th style={{ ...thBase, minWidth: 90, textAlign: 'center' }}>Health</th>
              </tr>
            </thead>
            <tbody>
              {/* Totals row */}
              {totals && tableRows.length > 0 && (() => {
                const tdS = { padding: '10px', fontSize: 12, fontWeight: 700, background: '#EFF6FF', borderBottom: '2px solid #BFDBFE', color: '#0A2540', textAlign: 'right', whiteSpace: 'nowrap' }
                return (
                  <tr key="totals">
                    <td style={{ ...tdS, textAlign: 'center', position: 'sticky', left: 0, zIndex: 1 }}>Σ</td>
                    <td style={{ ...tdS, textAlign: 'left', position: 'sticky', left: 44, zIndex: 1 }}>
                      <span style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#3B82F6' }}>Total</span>
                    </td>
                    <DeltaCell curr={totals.sessions}      prev={totals.prevSessions}  fmtType="int"  hasComp={hasComparison} prevSessions={totals.prevSessions} />
                    <DeltaCell curr={totals.engagementRate} prev={totals.prevEngRate}  fmtType="pct1" hasComp={hasComparison} prevSessions={totals.prevSessions} />
                    <DeltaCell curr={totals.convRate}      prev={totals.prevConvRate}  fmtType="pct2" hasComp={hasComparison} prevSessions={totals.prevSessions} />
                    <DeltaCell curr={totals.bookings}      prev={totals.prevBookings}  fmtType="int"  hasComp={hasComparison} prevSessions={totals.prevSessions} />
                    <DeltaCell curr={totals.revenue}       prev={totals.prevRevenue}   fmtType="gbp"  hasComp={hasComparison} prevSessions={totals.prevSessions} />
                    <DeltaCell curr={totals.aov}           prev={totals.prevAov}       fmtType="gbp2" hasComp={hasComparison} prevSessions={totals.prevSessions} />
                    <DeltaCell curr={totals.revPerSession} prev={totals.prevRevPerSes} fmtType="gbp2" hasComp={hasComparison} prevSessions={totals.prevSessions} />
                    <td style={{ ...tdS, textAlign: 'center' }} />
                  </tr>
                )
              })()}

              {/* Data rows */}
              {tableRows.map((row, idx) => {
                const rank   = idx + 1
                const rowBg  = idx % 2 === 0 ? '#fff' : '#FAFBFC'
                const medals = { 1: '🥇', 2: '🥈', 3: '🥉' }
                return (
                  <tr key={row.llm} className="sc-tr">
                    <td className="sc-td llm-rank-cell" style={{ textAlign: 'center', width: 44, background: rowBg }}>
                      {medals[rank] ? <span style={{ fontSize: 16 }}>{medals[rank]}</span> : <span style={{ fontSize: 12, color: '#5A6A7A', fontWeight: 600 }}>{rank}</span>}
                    </td>
                    <td className="sc-td llm-name-cell" style={{ background: rowBg }}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <LLMDot name={row.llm} />
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{row.llm}</span>
                      </div>
                    </td>
                    <DeltaCell curr={row.sessions}      prev={row.prevSessions}  fmtType="int"  hasComp={hasComparison} prevSessions={row.prevSessions} />
                    <DeltaCell curr={row.engagementRate} prev={row.prevEngRate}  fmtType="pct1" hasComp={hasComparison} prevSessions={row.prevSessions} />
                    <DeltaCell curr={row.convRate}       prev={row.prevConvRate} fmtType="pct2" hasComp={hasComparison} prevSessions={row.prevSessions} />
                    <DeltaCell curr={row.bookings}       prev={row.prevBookings} fmtType="int"  hasComp={hasComparison} prevSessions={row.prevSessions} />
                    <DeltaCell curr={row.revenue}        prev={row.prevRevenue}  fmtType="gbp"  hasComp={hasComparison} prevSessions={row.prevSessions} />
                    <DeltaCell curr={row.aov}            prev={row.prevAov}      fmtType="gbp2" hasComp={hasComparison} prevSessions={row.prevSessions} />
                    <DeltaCell curr={row.revPerSession}  prev={row.prevRevPerSes} fmtType="gbp2" hasComp={hasComparison} prevSessions={row.prevSessions} />
                    <HealthPill label={row.health} />
                  </tr>
                )
              })}

              {tableRows.length === 0 && (
                <tr><td colSpan={10} style={{ padding: 40, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
                  No LLM traffic found for this period. Try extending your date range.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── AI Chat ── */}
      <LLMChat tableData={tableRows} filters={filters} />
    </div>
  )
}
