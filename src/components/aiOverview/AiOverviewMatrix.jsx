/**
 * AiOverviewMatrix.jsx — Content Opportunity Matrix
 *
 * 2×2 strategic priority matrix. Each quadrant card now shows:
 *  - Opportunity label (editorial / strategic)
 *  - Category event-share bar (live GA4 data)
 *  - Top 3 actual snippets for that category with event count + trend indicator
 *    so content teams know exactly which pages to action
 */
import { useMemo } from 'react'
import { CATEGORY_COLORS, SNIPPET_KEY, categorise, computeTrendStatus } from './aiOverviewUtils'

// ─── Trend indicator ──────────────────────────────────────────────────────────
const TREND_CONFIG = {
  growing:  { icon: '↑', color: '#16A34A' },
  declining:{ icon: '↓', color: '#DC2626' },
  stable:   { icon: '→', color: '#6B7280' },
  new:      { icon: '✦', color: '#7C3AED' },
}

// ─── Editorial opportunity definitions ───────────────────────────────────────
const OPPORTUNITIES = [
  { label: 'Add more transport tables',        category: 'Transport tables', x: 20, y: 85 },
  { label: 'Refresh decaying snippets',        category: 'Transfer times',   x: 45, y: 72 },
  { label: 'Add price ranges to routes',       category: 'Pricing',          x: 28, y: 62 },
  { label: 'Expand city & destination guides', category: 'Destinations',     x: 52, y: 58 },
  { label: 'Add UGC sections to guides',       category: 'Destinations',     x: 60, y: 48 },
  { label: 'Non-English content preparation',  category: 'Other',            x: 75, y: 44 },
  { label: 'Monitor high-ratio snippets',      category: 'Other',            x: 15, y: 28 },
]

const QUADRANTS = [
  { id: 'quick-wins',   label: 'Quick Wins',    subtitle: 'High impact · Low content gap',       headerColor: '#16A34A', bgColor: '#F0FDF4', borderColor: '#BBF7D0' },
  { id: 'big-bets',    label: 'Big Bets',       subtitle: 'High impact · High content gap',      headerColor: '#1D4ED8', bgColor: '#EFF6FF', borderColor: '#BFDBFE' },
  { id: 'fill-ins',    label: 'Fill-ins',       subtitle: 'Lower priority · Low effort',         headerColor: '#64748B', bgColor: '#F8FAFC', borderColor: '#E2E8F0' },
  { id: 'future-plays',label: 'Future Plays',   subtitle: 'Long-term strategic · High gap',      headerColor: '#D97706', bgColor: '#FFFBEB', borderColor: '#FDE68A' },
]

function getQuadrant(x, y) {
  if (y >= 50 && x < 50)  return 'quick-wins'
  if (y >= 50 && x >= 50) return 'big-bets'
  if (y < 50  && x < 50)  return 'fill-ins'
  return 'future-plays'
}

// ─── Single snippet row inside a card ─────────────────────────────────────────
function SnippetRow({ text, events, trend }) {
  const cfg = TREND_CONFIG[trend] || TREND_CONFIG.stable
  const display = text.length > 60 ? text.slice(0, 58) + '…' : text
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      gap: 8, padding: '5px 0',
      borderBottom: '1px solid #F1F5F9',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: cfg.color, flexShrink: 0 }}>{cfg.icon}</span>
        <span
          style={{ fontSize: 10.5, color: '#374151', lineHeight: 1.35, wordBreak: 'break-word' }}
          title={text}
        >
          "{display}"
        </span>
      </div>
      <span style={{
        fontSize: 10, fontWeight: 700, color: '#0A2540',
        whiteSpace: 'nowrap', flexShrink: 0,
      }}>
        {events.toLocaleString()} ev
      </span>
    </div>
  )
}

// ─── Opportunity card ─────────────────────────────────────────────────────────
function OpportunityCard({ item, eventShare, topSnippets }) {
  const color = CATEGORY_COLORS[item.category] || '#B4B2A9'
  const barW  = Math.max(4, Math.round(eventShare * 100))

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      padding: '10px 12px',
      background: '#fff',
      border: '1px solid #E2E8F0',
      borderRadius: 8,
      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    }}>
      {/* Category tag */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
        <span style={{ fontSize: 9, fontWeight: 700, color, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {item.category}
        </span>
      </div>

      {/* Opportunity label */}
      <div style={{ fontSize: 12, fontWeight: 700, color: '#0A2540', lineHeight: 1.35 }}>
        {item.label}
      </div>

      {/* Event-volume bar */}
      {eventShare > 0 && (
        <div>
          <div style={{ fontSize: 9, color: '#94A3B8', marginBottom: 3 }}>Category event share</div>
          <div style={{ height: 4, background: '#F1F5F9', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${barW}%`, background: color, borderRadius: 2 }} />
          </div>
          <div style={{ fontSize: 9, color: '#374151', marginTop: 2, fontWeight: 600 }}>
            {Math.round(eventShare * 100)}% of all events
          </div>
        </div>
      )}

      {/* Top 3 actual snippets */}
      {topSnippets.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
            Top snippets · action these pages
          </div>
          <div>
            {topSnippets.map((s, i) => (
              <SnippetRow key={i} text={s.text} events={s.events} trend={s.trend} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Quadrant panel ───────────────────────────────────────────────────────────
function QuadrantPanel({ q, items, catEvents, totalEvents, kpisRows, snippetWeekMap, allSortedWeeks }) {
  return (
    <div style={{
      border: `1.5px solid ${q.borderColor}`, borderRadius: 10,
      background: q.bgColor, display: 'flex', flexDirection: 'column', minHeight: 180, overflow: 'hidden',
    }}>
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${q.borderColor}`, background: q.bgColor }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: q.headerColor, letterSpacing: '0.02em' }}>{q.label}</div>
        <div style={{ fontSize: 9.5, color: '#64748B', marginTop: 1 }}>{q.subtitle}</div>
      </div>

      <div style={{ padding: '10px 10px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        {items.length === 0 ? (
          <div style={{ fontSize: 11, color: '#CBD5E1', fontStyle: 'italic', margin: 'auto', textAlign: 'center' }}>
            No opportunities mapped here
          </div>
        ) : (
          [...items]
            .sort((a, b) => (catEvents[b.category] || 0) - (catEvents[a.category] || 0))
            .map(item => {
            // Top 3 snippets for this card's category, sorted by events desc
            const top3 = (kpisRows || [])
              .filter(row => categorise(row[SNIPPET_KEY] ?? '') === item.category)
              .slice(0, 3)
              .map(row => {
                const text  = row[SNIPPET_KEY] ?? ''
                const trend = computeTrendStatus(snippetWeekMap?.[text] || {}, allSortedWeeks || [])
                return { text, events: row.eventCount || 0, trend }
              })

            return (
              <OpportunityCard
                key={item.label}
                item={item}
                eventShare={totalEvents > 0 ? (catEvents[item.category] || 0) / totalEvents : 0}
                topSnippets={top3}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function AiOverviewMatrix({ categoryBreakdown, totalEvents, kpisRows, snippetWeekMap, allSortedWeeks }) {
  const catEvents = useMemo(() => {
    const m = {}
    ;(categoryBreakdown || []).forEach(c => { m[c.label] = c.events })
    return m
  }, [categoryBreakdown])

  const byQuadrant = useMemo(() => {
    const map = {}
    OPPORTUNITIES.forEach(item => {
      const qid = getQuadrant(item.x, item.y)
      if (!map[qid]) map[qid] = []
      map[qid].push(item)
    })
    return map
  }, [])

  return (
    <div style={{
      background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12,
      marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', padding: '18px 22px',
    }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0A2540', marginBottom: 4 }}>
          Content Opportunity Matrix
        </div>
        <div style={{
          fontSize: 11, color: '#5A6A7A', lineHeight: 1.6,
          background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 7, padding: '8px 12px',
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>💡</span>
          <span>
            <strong style={{ color: '#0A2540' }}>How to use:</strong> Quadrants show where to focus content investment.{' '}
            <strong>Quick Wins</strong> = high SEO/AI impact, small gap — action these first.{' '}
            <strong>Big Bets</strong> = high ceiling but more investment needed.{' '}
            Each card shows the top 3 live snippets for that category (↑ growing · ↓ declining · → stable) so you know exactly which pages to open and update.
          </span>
        </div>
      </div>

      {/* 2×2 grid */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
        <div style={{
          writingMode: 'vertical-rl', transform: 'rotate(180deg)',
          fontSize: 10, fontWeight: 700, color: '#64748B', letterSpacing: '0.08em', textTransform: 'uppercase',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          paddingRight: 8, userSelect: 'none', flexShrink: 0,
        }}>
          Strategic Impact ↑
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {QUADRANTS.map(q => (
              <QuadrantPanel
                key={q.id}
                q={q}
                items={byQuadrant[q.id] || []}
                catEvents={catEvents}
                totalEvents={totalEvents || 1}
                kpisRows={kpisRows}
                snippetWeekMap={snippetWeekMap}
                allSortedWeeks={allSortedWeeks}
              />
            ))}
          </div>

          <div style={{
            textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#64748B',
            letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 10, userSelect: 'none',
          }}>
            Content Gap →
          </div>
        </div>
      </div>
    </div>
  )
}
