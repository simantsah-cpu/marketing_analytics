/**
 * AiOverviewKpis.jsx — Section A: 4 KPI Cards for AI Overview Intelligence.
 *
 * Uses the EXACT same kpi-card / kpi-row CSS classes as ExecutiveSummary/KPICard
 * so layout, zoom behaviour, and visual style are identical.
 *
 * Card 1: primary (dark navy background) — AI Overview Events
 * Cards 2-4: white cards with green/red delta badges
 */

// ─── Delta badge — matches KPICard badge style exactly ────────────────────────

function DeltaBadge({ current, previous, effectiveMode, isPrimary }) {
  if (!effectiveMode || effectiveMode === 'Off') return null
  if (previous == null || previous === 0 || current == null) return null

  const compLabel =
    effectiveMode === 'vs Prev Period' ? 'prev period' :
    effectiveMode === 'vs Last Year'   ? 'last year'   :
    'prev period'

  const pct   = ((current - previous) / Math.abs(previous)) * 100
  const isUp  = pct >= 0
  const abs   = Math.abs(pct).toFixed(1)
  const arrow = isUp ? '▲' : '▼'

  const badgeStyle = isPrimary
    ? { background: 'rgba(255,255,255,0.20)', color: '#fff' }
    : isUp
      ? { background: 'var(--green-light, #D1FAE5)', color: 'var(--green, #065F46)' }
      : { background: 'var(--red-light, #FEE2E2)',   color: 'var(--red,   #991B1B)' }

  return (
    <span className="kpi-badge" style={badgeStyle}>
      {arrow} {abs}% vs {compLabel}
    </span>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AiOverviewKpis({
  kpiData,
  trendData,       // accepted but not used — sparklines removed
  comparisonMode,
  // Legacy flat props (backward compat with current AiOverviewSection)
  totalEvents:         totalEventsProp,
  uniqueSnippets:      uniqueSnippetsProp,
  topSnippetEvents:    topSnippetEventsProp,
  topSnippetText:      topSnippetTextProp,
  avgEventsPerSnippet: avgEventsPerSnippetProp,
  prevTotalEvents,
}) {
  // Merge new and legacy props
  const totalEvents         = kpiData?.totalEvents         ?? totalEventsProp         ?? 0
  const uniqueSnippets      = kpiData?.uniqueSnippets      ?? uniqueSnippetsProp      ?? 0
  const topSnippetEvents    = kpiData?.topSnippetEvents    ?? topSnippetEventsProp    ?? 0
  const topSnippetText      = kpiData?.topSnippetText      ?? topSnippetTextProp      ?? ''
  const avgEventsPerSnippet = kpiData?.avgEventsPerSnippet ?? avgEventsPerSnippetProp ?? 0
  const compData            = kpiData?.comparisonData      ?? null

  // Effective comparison mode string
  const effectiveMode =
    comparisonMode != null
      ? comparisonMode
      : prevTotalEvents != null
        ? 'vs Prev Period'
        : 'Off'

  // Comparison values
  const prevTotal      = compData?.totalEvents         ?? prevTotalEvents ?? null
  const prevSnippets   = compData?.uniqueSnippets      ?? null
  const prevTopSnippet = compData?.topSnippetEvents    ?? null
  const prevAvg        = compData?.avgEventsPerSnippet ?? null

  // Card 3: word-boundary truncation
  const displaySnippet = (() => {
    if (!topSnippetText) return '—'
    if (topSnippetText.length <= 45) return `"${topSnippetText}"`
    return `"${topSnippetText.slice(0, 45).replace(/\s\S*$/, '')}…"`
  })()

  // Card 4: dynamic context based on distribution shape
  const avgSub =
    avgEventsPerSnippet > 7
      ? 'High concentration — few snippets driving most volume'
      : avgEventsPerSnippet > 4
        ? 'Moderate spread across snippets'
        : 'Broad spread — many snippets with low individual volume'

  return (
    <div className="kpi-row kpi-row-4">

      {/* ── Card 1: AI Overview Events — PRIMARY (dark navy) ── */}
      <div className="kpi-card primary">
        <div className="kpi-label">AI Overview Events</div>
        <div className="kpi-value">{totalEvents.toLocaleString()}</div>
        <DeltaBadge
          current={totalEvents}
          previous={prevTotal}
          effectiveMode={effectiveMode}
          isPrimary
        />
        <div className="kpi-sub">
          Google cited hoppa snippets {totalEvents.toLocaleString()} times
        </div>
      </div>

      {/* ── Card 2: Unique Snippets ── */}
      <div className="kpi-card">
        <div className="kpi-label">Unique Snippets</div>
        <div className="kpi-value">{uniqueSnippets.toLocaleString()}</div>
        <DeltaBadge
          current={uniqueSnippets}
          previous={prevSnippets}
          effectiveMode={effectiveMode}
        />
        <div className="kpi-sub">Distinct AI Overview texts driving clicks to hoppa.com</div>
      </div>

      {/* ── Card 3: Top Snippet Events ── */}
      <div className="kpi-card">
        <div className="kpi-label">Top Snippet Events</div>
        <div className="kpi-value">{topSnippetEvents.toLocaleString()}</div>
        <DeltaBadge
          current={topSnippetEvents}
          previous={prevTopSnippet}
          effectiveMode={effectiveMode}
        />
        <div className="kpi-sub" style={{
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {displaySnippet}
        </div>
      </div>

      {/* ── Card 4: Avg Events / Snippet ── */}
      <div className="kpi-card">
        <div className="kpi-label">Avg Events / Snippet</div>
        <div className="kpi-value">
          {parseFloat(avgEventsPerSnippet) > 0 ? Math.round(parseFloat(avgEventsPerSnippet)).toLocaleString() : '—'}
        </div>
        <DeltaBadge
          current={avgEventsPerSnippet}
          previous={prevAvg}
          effectiveMode={effectiveMode}
        />
        <div className="kpi-sub">{avgSub}</div>
      </div>

    </div>
  )
}
