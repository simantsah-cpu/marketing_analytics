/**
 * AiOverviewInsights.jsx — Section F: Claude-generated insight cards.
 * Fires one Claude API call via the existing ai-chat Supabase edge function.
 * Shows 6 pulsing skeleton cards while loading, 6 fallback cards on error.
 */
import { useEffect, useState } from 'react'

const PRIORITY_COLORS = {
  high:   { border: '#1D9E75', bg: '#F0FDF9' },
  medium: { border: '#378ADD', bg: '#EFF6FF' },
  low:    { border: '#E2E8F0', bg: '#F8FAFC' },
}

const FALLBACK_CARDS = Array(6).fill({
  icon: 'ti-alert-circle',
  title: 'Insights unavailable',
  body: "Couldn't generate insights right now. Check back after the data has loaded fully.",
  priority: 'low',
})

function SkeletonCard() {
  return (
    <div style={{
      background: '#F8FAFC',
      border: '1px solid #E2E8F0',
      borderLeft: '2px solid #E2E8F0',
      borderRadius: 10,
      padding: 16,
      animation: 'ai-overview-pulse 1.4s ease-in-out infinite',
    }}>
      <div style={{ width: '40%', height: 12, background: '#E2E8F0', borderRadius: 4, marginBottom: 8 }} />
      <div style={{ width: '85%', height: 10, background: '#E2E8F0', borderRadius: 4, marginBottom: 5 }} />
      <div style={{ width: '70%', height: 10, background: '#E2E8F0', borderRadius: 4 }} />
    </div>
  )
}

function InsightCard({ card }) {
  const prio = PRIORITY_COLORS[card.priority] ?? PRIORITY_COLORS.low
  return (
    <div style={{
      background: prio.bg,
      border: `1px solid ${prio.border}30`,
      borderLeft: `2px solid ${prio.border}`,
      borderRadius: 10,
      padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
        {card.icon && <i className={`ti ${card.icon}`} style={{ fontSize: 14, color: prio.border }} />}
        <span style={{ fontSize: 12, fontWeight: 700, color: '#0A2540', lineHeight: 1.3 }}>{card.title}</span>
        {card.priority === 'high' && (
          <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: '#DCFCE7', color: '#16A34A', whiteSpace: 'nowrap' }}>HIGH PRIORITY</span>
        )}
      </div>
      <p style={{ fontSize: 11.5, color: '#374151', lineHeight: 1.6, margin: 0 }}>{card.body}</p>
    </div>
  )
}

export default function AiOverviewInsights({
  dateRangeLabel,
  totalEvents,
  uniqueSnippets,
  topSnippetText,
  topSnippetEvents,
  avgEventsPerSnippet,
  top10Snippets,
  categoryBreakdown,
  recentWeeks,
  textMobilePct,
  tableMobilePct,
  priceMobilePct,
}) {
  const [cards, setCards] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!totalEvents) return
    setLoading(true)
    setError(null)

    const categoryLines = (categoryBreakdown || []).map(c => `${c.label}: ${c.events} events (${c.pct}%)`).join('\n')
    const weekLines = (recentWeeks || []).slice(-6).map(w => `${w.label}: ${w.events} events`).join('\n')
    const top10Lines = (top10Snippets || []).map((s, i) =>
      `${i + 1}. "${s.text}" — ${s.events} events, ${s.users} users, ${s.eventsPerUser}x events/user, trend: ${s.trend}`
    ).join('\n')

    const insightsPrompt = `You are an analytics assistant for hoppa.com, a UK airport transfer booking site.

You have just loaded fresh GA4 data for the AI Overview Intelligence dashboard.
Here is the live data summary:

PERIOD: ${dateRangeLabel || 'Selected period'}
TOTAL AI OVERVIEW EVENTS: ${totalEvents}
UNIQUE SNIPPETS: ${uniqueSnippets}
TOP SNIPPET: "${topSnippetText}" — ${topSnippetEvents} events
AVG EVENTS / SNIPPET: ${avgEventsPerSnippet}

TOP 10 SNIPPETS:
${top10Lines}

CONTENT CATEGORY BREAKDOWN:
${categoryLines}

WEEKLY TREND (most recent 6 weeks):
${weekLines}

DEVICE SPLIT:
Text snippets: ${textMobilePct}% mobile / ${100 - textMobilePct}% desktop
Table snippets: ${tableMobilePct}% mobile / ${100 - tableMobilePct}% desktop
Price snippets: ${priceMobilePct}% mobile / ${100 - priceMobilePct}% desktop

Generate exactly 6 insight cards as a JSON array. Each card must be derived from the actual data above — no generic advice. Format:

[
  {
    "icon": "<tabler icon name e.g. ti-table>",
    "title": "<max 8 words>",
    "body": "<2-3 sentences, specific to the data, actionable>",
    "priority": "high" | "medium" | "low"
  }
]

Cards with priority "high" will get a teal left border. Focus on:
- What is performing unexpectedly well or poorly RIGHT NOW
- Any snippets with anomalous events-per-user ratios (flag if > 3.0)
- Whether the trend is growing or declining overall
- What content type Google is favouring this period
- One specific action hoppa.com's content team should take this week

Return only the JSON array, no other text.`

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

    // Use ai-invoke (the correct function name on this project)
    // It expects: { mode, message, context, conversationHistory }
    // It returns:  { response: string }  (non-streaming for mode='query')
    const ctrl = new AbortController()
    const timeoutId = setTimeout(() => ctrl.abort(), 30000)

    fetch(`${supabaseUrl}/functions/v1/ai-invoke`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
      body: JSON.stringify({
        mode: 'query',
        message: insightsPrompt,
        context: {
          chartTitle: 'AI Overview Intelligence',
          dateRange: dateRangeLabel,
        },
        conversationHistory: [],
      }),
    })
      .then(async res => {
        clearTimeout(timeoutId)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        // ai-invoke returns { response: string }
        const text = json?.response ?? json?.content ?? json?.text ?? ''
        const match = text.match(/\[[\s\S]*\]/)
        if (!match) throw new Error('No JSON array in response')
        const parsed = JSON.parse(match[0])
        setCards(Array.isArray(parsed) ? parsed.slice(0, 6) : FALLBACK_CARDS)
      })
      .catch(err => {
        clearTimeout(timeoutId)
        console.warn('AiOverviewInsights: Claude call failed:', err.message)
        setCards(FALLBACK_CARDS)
        setError(err.message)
      })
      .finally(() => setLoading(false))
  }, [totalEvents, dateRangeLabel])

  const displayCards = cards ?? (loading ? null : FALLBACK_CARDS)

  return (
    <div style={{ marginBottom: 20 }}>
      <style>{`@keyframes ai-overview-pulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#0A2540' }}>AI-Generated Insights</div>
        <span style={{ fontSize: 9, fontWeight: 700, color: '#1A7FD4', background: '#DBEAFE', borderRadius: 4, padding: '1px 5px', letterSpacing: '0.04em' }}>CLAUDE</span>
        {loading && <span style={{ fontSize: 10, color: '#94A3B8' }}>Generating…</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {loading
          ? Array(6).fill(null).map((_, i) => <SkeletonCard key={i} />)
          : (displayCards || FALLBACK_CARDS).map((card, i) => <InsightCard key={i} card={card} />)
        }
      </div>
    </div>
  )
}
