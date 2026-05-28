/**
 * AiOverviewSnippetTable.jsx — Section D: Sortable snippet table with sparklines.
 * Sparklines are lazy-inited via IntersectionObserver.
 * High events/user ratio rows get an amber warning indicator.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { categorise, computeTrendStatus, CATEGORY_COLORS, SNIPPET_KEY } from './aiOverviewUtils'

const DEFAULT_ROWS = 15

// ─── Trend status badge ──────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const map = {
    growing:  { bg: '#DCFCE7', color: '#16A34A', label: '▲ Growing' },
    declining:{ bg: '#FEE2E2', color: '#DC2626', label: '▼ Declining' },
    stable:   { bg: '#F1F5F9', color: '#64748B', label: '→ Stable' },
    new:      { bg: '#EDE9FE', color: '#6D28D9', label: '✦ New' },
  }
  const s = map[status] ?? map.stable
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

// ─── Category pill ───────────────────────────────────────────────────────────

function CategoryPill({ text }) {
  const cat = categorise(text)
  const color = CATEGORY_COLORS[cat] || '#B4B2A9'
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 8, background: color + '20', color, whiteSpace: 'nowrap', border: `1px solid ${color}40` }}>
      {cat}
    </span>
  )
}

// ─── Sparkline canvas ────────────────────────────────────────────────────────

function SparklineCanvas({ snippetText, snippetWeekMap, allSortedWeeks, status }) {
  const canvasRef = useRef(null)
  const observerRef = useRef(null)
  const initializedRef = useRef(false)

  const renderSparkline = useCallback(() => {
    if (initializedRef.current || !canvasRef.current) return
    initializedRef.current = true

    const last6 = allSortedWeeks.slice(-6)
    const weekMap = snippetWeekMap[snippetText] || {}
    const vals = last6.map(w => weekMap[w] || 0)
    const max = Math.max(...vals, 1)

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const W = canvas.width
    const H = canvas.height

    ctx.clearRect(0, 0, W, H)
    if (vals.every(v => v === 0)) return

    const isDecline = status === 'declining'
    const lineColor = isDecline ? '#DC2626' : '#1D9E75'

    ctx.beginPath()
    ctx.strokeStyle = lineColor
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'

    vals.forEach((v, i) => {
      const x = (i / Math.max(vals.length - 1, 1)) * W
      const y = H - (v / max) * (H - 2) - 1
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()

    // Fill area under line
    ctx.lineTo(W, H)
    ctx.lineTo(0, H)
    ctx.closePath()
    ctx.fillStyle = lineColor + '18'
    ctx.fill()
  }, [snippetText, snippetWeekMap, allSortedWeeks, status])

  useEffect(() => {
    if (!canvasRef.current) return

    observerRef.current = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) renderSparkline() },
      { threshold: 0 }
    )
    observerRef.current.observe(canvasRef.current)

    return () => observerRef.current?.disconnect()
  }, [renderSparkline])

  return (
    <canvas
      ref={canvasRef}
      width={60}
      height={20}
      role="img"
      aria-label={`Trend sparkline for snippet`}
      style={{ display: 'block' }}
    />
  )
}

// ─── Sortable header ─────────────────────────────────────────────────────────

function SortTh({ col, label, sortKey, sortDir, onSort, style = {}, noSort }) {
  const active = sortKey === col
  return (
    <th
      onClick={() => !noSort && onSort(col)}
      style={{
        cursor: noSort ? 'default' : 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        padding: '9px 10px',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.05em',
        background: '#F8FAFC',
        borderBottom: '2px solid #E2E8F0',
        color: active ? '#0F5FA6' : '#5A6A7A',
        textAlign: 'left',
        ...style,
      }}
    >
      {label}
      {active && !noSort && <span style={{ marginLeft: 4, fontSize: 10 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  )
}

// ─── Tooltip wrapper ─────────────────────────────────────────────────────────

function Tooltip({ text, children }) {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  return (
    <span
      style={{ position: 'relative', cursor: 'help' }}
      onMouseEnter={e => { setShow(true); setPos({ x: e.clientX, y: e.clientY }) }}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div style={{
          position: 'fixed',
          zIndex: 9999,
          top: pos.y - 44,
          left: pos.x - 80,
          background: '#0A2540',
          color: '#fff',
          padding: '6px 10px',
          borderRadius: 7,
          fontSize: 11,
          lineHeight: 1.5,
          maxWidth: 220,
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          pointerEvents: 'none',
        }}>
          {text}
        </div>
      )}
    </span>
  )
}

// ─── Main table ──────────────────────────────────────────────────────────────

export default function AiOverviewSnippetTable({
  kpisRows,
  snippetWeekMap,
  allSortedWeeks,
  totalEvents,
  totalUsers,
}) {
  const [sortKey, setSortKey]   = useState('events')
  const [sortDir, setSortDir]   = useState('desc')
  const [expanded, setExpanded] = useState(false)

  const handleSort = useCallback(col => {
    if (sortKey === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(col); setSortDir('desc') }
  }, [sortKey])

  // Build enriched rows
  const enrichedRows = kpisRows.map(row => {
    const text        = row[SNIPPET_KEY] ?? ''
    const events      = row.eventCount  || 0
    const activeUsers = row.activeUsers || 0
    return { text, events, activeUsers }
  })

  // Apply sort
  const sorted = [...enrichedRows].sort((a, b) => {
    const av = a[sortKey] ?? 0
    const bv = b[sortKey] ?? 0
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    return sortDir === 'asc' ? av - bv : bv - av
  })

  const displayRows = expanded ? sorted : sorted.slice(0, DEFAULT_ROWS)
  const thBase = { padding: '9px 10px', fontSize: 11, fontWeight: 700, background: '#F8FAFC', borderBottom: '2px solid #E2E8F0', color: '#5A6A7A', letterSpacing: '0.05em', whiteSpace: 'nowrap' }
  const tdBase = { padding: '8px 10px', fontSize: 12, color: '#0A2540', borderBottom: '1px solid #F1F5F9', verticalAlign: 'middle' }

  return (
    <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#0A2540' }}>AI Overview Snippets</div>
          <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 1 }}>Top {enrichedRows.length} snippets by events · click headers to sort</div>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'DM Sans', sans-serif", minWidth: 800 }}>
          <thead>
            <tr>
              <th style={{ ...thBase, width: 36, textAlign: 'center' }}>#</th>
              <th style={{ ...thBase }}>Snippet</th>
              <th style={{ ...thBase, textAlign: 'left' }}>Category</th>
              <SortTh col="events"      label="Events"       sortKey={sortKey} sortDir={sortDir} onSort={handleSort} style={{ textAlign: 'right' }} />
              {/* Active Users: GA4's compatible user-level metric for event-scoped dimensions.
                  'sessions' and 'newUsers' return 0 with event-scoped custom dimension filters (GA4 API limitation). */}
              <th style={{ ...thBase, textAlign: 'right' }}>
                <div>Active Users</div>
                <div style={{ fontSize: 9, fontWeight: 400, color: '#94A3B8', marginTop: 1 }}>engaged sessions</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {/* Totals row */}
            <tr style={{ background: '#EFF6FF' }}>
              <td style={{ ...tdBase, textAlign: 'center', fontWeight: 700, color: '#3B82F6' }}>Σ</td>
              <td style={{ ...tdBase, fontWeight: 700, color: '#3B82F6', fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase' }}>ALL SNIPPETS</td>
              <td style={{ ...tdBase }} />
              <td style={{ ...tdBase, textAlign: 'right', fontWeight: 700 }}>{totalEvents.toLocaleString()}</td>
              <td style={{ ...tdBase, textAlign: 'right', fontWeight: 700 }}>{totalUsers.toLocaleString()}</td>
            </tr>

            {/* Data rows */}
            {displayRows.map((row, idx) => (
              <tr key={row.text} style={{ background: idx % 2 === 0 ? '#fff' : '#FAFBFC' }}>
                <td style={{ ...tdBase, textAlign: 'center', color: '#94A3B8', fontWeight: 600 }}>{idx + 1}</td>
                <td style={{ ...tdBase }}>
                  <span style={{ fontSize: 11.5, lineHeight: 1.5, display: 'block', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                    {row.text}
                  </span>
                </td>
                <td style={{ ...tdBase, textAlign: 'left' }}><CategoryPill text={row.text} /></td>
                <td style={{ ...tdBase, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {row.events.toLocaleString()}
                </td>
                <td style={{ ...tdBase, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#374151' }}>
                  {row.activeUsers.toLocaleString()}
                </td>
              </tr>
            ))}

            {displayRows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
                  No snippet data for this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Expand/collapse */}
      {enrichedRows.length > DEFAULT_ROWS && (
        <div style={{ padding: '10px 18px', borderTop: '1px solid #F1F5F9', textAlign: 'center' }}>
          <button
            onClick={() => setExpanded(e => !e)}
            style={{ background: 'none', border: '1px solid #E2E8F0', borderRadius: 7, padding: '6px 16px', fontSize: 11, fontWeight: 600, color: '#0F5FA6', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {expanded ? '▲ Show fewer' : `▼ Show all ${enrichedRows.length} snippets`}
          </button>
        </div>
      )}
    </div>
  )
}
