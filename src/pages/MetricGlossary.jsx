import { useState, useMemo } from 'react'

// ── Data ──────────────────────────────────────────────────────────────────────

const METRICS = [
  // TRAFFIC
  {
    name: 'Sessions',
    category: 'Traffic',
    definition: 'Total visits to hoppa.com driven by affiliate links. One user can generate multiple sessions in a period.',
    formula: 'Raw count from GA4',
    ga4: 'sessions',
    notes: 'Base volume metric. Starting point for all affiliate performance analysis.',
  },
  {
    name: 'Total Users',
    category: 'Traffic',
    definition: 'Unique users who arrived via an affiliate link. One user is counted once regardless of how many sessions they had.',
    formula: 'Raw count from GA4',
    ga4: 'totalUsers',
    notes: 'Measures reach. Compare to Sessions to understand revisit behaviour.',
  },
  {
    name: 'New Users',
    category: 'Traffic',
    definition: 'First-time visitors to hoppa.com who arrived via an affiliate link.',
    formula: 'Raw count from GA4',
    ga4: 'newUsers',
    notes: 'Key acquisition signal. Cashback affiliates typically send more returning users than content affiliates.',
  },
  {
    name: 'New User Rate',
    category: 'Traffic',
    definition: 'Percentage of affiliate-referred users who are completely new to hoppa.com.',
    formula: 'New Users ÷ Total Users × 100',
    ga4: 'newUsers ÷ totalUsers',
    notes: 'High rate = affiliate is growing the customer base. Low rate = recycling existing customers.',
  },
  {
    name: 'Sessions per User',
    category: 'Traffic',
    definition: 'Average number of sessions generated per unique affiliate-referred user.',
    formula: 'Sessions ÷ Total Users',
    ga4: 'sessionsPerUser',
    notes: 'High values with low conversion suggests window shopping behaviour.',
  },
  // ENGAGEMENT
  {
    name: 'Engaged Sessions',
    category: 'Engagement',
    definition: "Sessions where the user was active for 10+ seconds, visited 2+ pages, or triggered a conversion event. GA4's built-in quality filter.",
    formula: 'Raw count from GA4',
    ga4: 'engagedSessions',
    notes: 'Compare to total Sessions to assess traffic quality. Always check both together.',
  },
  {
    name: 'Engagement Rate',
    category: 'Engagement',
    definition: "Percentage of affiliate sessions with genuine user activity. The primary traffic quality metric for GA4.",
    formula: 'SUM(Engaged Sessions) ÷ SUM(Sessions) × 100',
    ga4: 'engagedSessions ÷ sessions (calculated manually)',
    notes: 'Calculated from aggregated totals — NOT averaged from per-row rates which would give incorrect results for affiliates with very different volumes.',
  },
  {
    name: 'Bounce Rate',
    category: 'Engagement',
    definition: 'Percentage of sessions with zero meaningful engagement. The inverse of Engagement Rate.',
    formula: '(1 − Engagement Rate) × 100',
    ga4: 'Derived from engagedSessions ÷ sessions',
    notes: 'High bounce rate on a specific affiliate signals audience mismatch or landing page problem.',
  },
  {
    name: 'Avg Session Duration',
    category: 'Engagement',
    definition: 'Average time in seconds that affiliate-referred users spend per session on hoppa.com.',
    formula: 'SUM(averageSessionDuration × sessions) ÷ SUM(sessions)',
    ga4: 'averageSessionDuration',
    notes: 'Weighted average by session count. Simple averaging would give incorrect results when affiliate volumes differ significantly.',
  },
  {
    name: 'Pages per Session',
    category: 'Engagement',
    definition: 'Average number of pages viewed per affiliate session. Measures depth of engagement.',
    formula: 'SUM(Screen Page Views) ÷ SUM(Sessions)',
    ga4: 'screenPageViews ÷ sessions (calculated manually)',
    notes: "GA4's native screenPageViewsPerSession returns 0 at filtered dimension levels. Calculated manually from aggregated totals for accuracy.",
  },
  {
    name: 'Screen Page Views',
    category: 'Engagement',
    definition: 'Total number of pages viewed across all affiliate sessions in the period.',
    formula: 'Raw count from GA4',
    ga4: 'screenPageViews',
    notes: 'Volume measure. High views with low conversion can indicate a UX or funnel problem.',
  },
  // COMMERCIAL
  {
    name: 'Transactions (Bookings)',
    category: 'Commercial',
    definition: 'Completed purchase events attributed to affiliate sessions. Each transaction = one completed booking.',
    formula: 'Raw count from GA4 purchase events',
    ga4: 'transactions',
    notes: 'Confirmed firing on hoppa GA4 property 259261360. Verified at 1,099 bookings in last 90 days as of March 2026.',
  },
  {
    name: 'Purchase Revenue (TTV)',
    category: 'Commercial',
    definition: 'Total booking value in GBP attributed to affiliate-sourced sessions. TTV = Total Transaction Value.',
    formula: 'Raw sum from GA4',
    ga4: 'purchaseRevenue',
    notes: 'Does not net commission costs paid to affiliates. ROAS calculation requires Awin commission data (Phase 3).',
  },
  {
    name: 'Session Conversion Rate',
    category: 'Commercial',
    definition: 'Percentage of affiliate sessions that result in a completed booking. The single most important efficiency metric.',
    formula: 'Transactions ÷ Sessions × 100',
    ga4: 'transactions ÷ sessions (calculated manually)',
    notes: "IMPORTANT — calculated manually. GA4's sessionConversionRate counts all conversion events including micro-conversions and significantly overstates booking conversion rates.",
  },
  {
    name: 'Average Order Value (AOV)',
    category: 'Commercial',
    definition: 'Average booking value per completed transaction.',
    formula: 'Purchase Revenue ÷ Transactions',
    ga4: 'purchaseRevenue ÷ transactions',
    notes: 'Higher AOV affiliates deliver disproportionate revenue per booking. Cashback affiliates typically have lower AOV than content or loyalty affiliates.',
  },
  {
    name: 'Revenue per Session',
    category: 'Commercial',
    definition: 'Average revenue generated per affiliate session. Combines traffic volume and commercial quality into a single efficiency metric.',
    formula: 'Purchase Revenue ÷ Sessions',
    ga4: 'purchaseRevenue ÷ sessions',
    notes: 'The most useful single metric for comparing affiliate efficiency regardless of volume. Sort the Affiliate Scorecard by this column to find your most valuable partners.',
  },
  {
    name: 'Revenue Share',
    category: 'Commercial',
    definition: "This affiliate's revenue as a percentage of total affiliate channel revenue in the period.",
    formula: 'Affiliate Revenue ÷ Total Affiliate Revenue × 100',
    ga4: 'Derived from purchaseRevenue per affiliate',
    notes: 'Concentration risk indicator. If one affiliate exceeds 40% revenue share the channel has a dependency risk.',
  },
  // FUNNEL
  {
    name: 'view_search_results (Searches Performed)',
    category: 'Funnel',
    definition: 'Number of affiliate-referred sessions that performed a search and saw results on hoppa.com. The first strong purchase intent signal.',
    formula: 'Sum of event counts from GA4',
    ga4: "eventCount where eventName = 'view_search_results'",
    notes: 'Confirmed firing in GA4. Users who search have significantly higher purchase intent than users who do not.',
  },
  {
    name: 'form_start',
    category: 'Funnel',
    definition: 'Number of times affiliate-referred users began filling in the booking or search form.',
    formula: 'Sum of event counts from GA4',
    ga4: "eventCount where eventName = 'form_start'",
    notes: 'Early intent signal. High form_start with low form_submit indicates form friction or abandonment.',
  },
  {
    name: 'form_submit',
    category: 'Funnel',
    definition: 'Number of completed form submissions from affiliate-referred sessions.',
    formula: 'Sum of event counts from GA4',
    ga4: "eventCount where eventName = 'form_submit'",
    notes: 'Stronger intent signal than form_start. Gap between form_submit and begin_checkout shows search-to-booking conversion.',
  },
  {
    name: 'begin_checkout (Checkout Started)',
    category: 'Funnel',
    definition: 'Number of times affiliate-referred users clicked to start the checkout process.',
    formula: 'Sum of event counts from GA4',
    ga4: "eventCount where eventName = 'begin_checkout'",
    notes: 'Mid-funnel KPI. The gap between begin_checkout and completed purchases is the most actionable drop-off point.',
  },
  {
    name: 'checkout (Checkout Page)',
    category: 'Funnel',
    definition: 'Number of times affiliate-referred users reached the checkout page — one step deeper than begin_checkout.',
    formula: 'Sum of event counts from GA4',
    ga4: "eventCount where eventName = 'checkout'",
    notes: 'Large gap between begin_checkout and checkout indicates a form or page load issue at the checkout transition step.',
  },
  {
    name: 'Checkout-to-Purchase Rate',
    category: 'Funnel',
    definition: 'Percentage of users who started checkout and completed a booking. A low rate signals checkout friction.',
    formula: 'Transactions ÷ begin_checkout events × 100',
    ga4: "transactions ÷ eventCount('begin_checkout')",
    notes: "Capped at 100%. Values above 100% indicate a data anomaly — likely begin_checkout undercounting due to session attribution.",
  },
  {
    name: 'Checkout Drop-off Rate',
    category: 'Funnel',
    definition: 'Percentage of users who started checkout but did NOT complete a booking.',
    formula: '(begin_checkout − Transactions) ÷ begin_checkout × 100',
    ga4: "Derived from eventCount('begin_checkout') and transactions",
    notes: 'Complement of Checkout-to-Purchase Rate. These two always sum to 100%.',
  },
  {
    name: 'payment_failure (Payment Failures)',
    category: 'Funnel',
    definition: 'Number of payment failures during checkout for affiliate-referred sessions.',
    formula: 'Sum of event counts from GA4',
    ga4: "eventCount where eventName = 'payment_failure'",
    notes: 'Operational flag. Persistent failures on iOS app indicate a platform-specific payment issue. Alert fires when count increases >50% WoW.',
  },
  // HEALTH
  {
    name: 'Health Score',
    category: 'Health',
    definition: 'A composite score (0–100) summarising overall affiliate partner health across traffic quality and commercial performance.',
    formula: '(Engagement Rate × 0.25) + (Conv Rate × 0.35) + (WoW Session Trend × 0.20) + (WoW Revenue Trend × 0.20)',
    ga4: 'Derived from engagedSessions, sessions, transactions, purchaseRevenue',
    notes: 'Green = Healthy (>75). Amber = Watch (50–75). Red = At Risk (<50). Requires comparison period data to calculate trend components. Shows — if prior period unavailable.',
  },
  {
    name: 'WoW Delta (Week over Week)',
    category: 'Health',
    definition: 'Percentage change in a metric compared to the equivalent prior period.',
    formula: '(Current Value − Previous Value) ÷ Previous Value × 100',
    ga4: 'Derived — requires two separate date range queries',
    notes: 'For rate metrics (Engagement Rate, Conv Rate) shown in percentage points (pp) not percent. For volume metrics (Sessions, Revenue) shown as %.',
  },
  {
    name: 'Affiliate Health Trend',
    category: 'Health',
    definition: '3-week directional indicator showing whether an affiliate is improving, stable, or declining.',
    formula: 'Direction of WoW change across last 3 data points',
    ga4: 'Derived from session and revenue data',
    notes: '↑ = positive WoW for 2 of last 3 periods. ↓ = negative WoW for 2 of last 3. ↔ = mixed or flat.',
  },
]

const CATEGORIES = ['All', 'Traffic', 'Engagement', 'Commercial', 'Funnel', 'Health']

const CAT_STYLE = {
  Traffic:    { bg: '#DBEAFE', color: '#1D4ED8' },
  Engagement: { bg: '#EDE9FE', color: '#5B21B6' },
  Commercial: { bg: '#CCFBF1', color: '#0D8A72' },
  Funnel:     { bg: '#FEF3C7', color: '#D97706' },
  Health:     { bg: '#DCFCE7', color: '#15803D' },
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MetricGlossary() {
  const [search, setSearch]           = useState('')
  const [activeCategory, setCategory] = useState('All')
  const [sortKey, setSortKey]         = useState('name')
  const [sortDir, setSortDir]         = useState('asc')

  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return METRICS
      .filter(m => activeCategory === 'All' || m.category === activeCategory)
      .filter(m => !q || [m.name, m.category, m.definition, m.formula, m.ga4, m.notes].some(f => f.toLowerCase().includes(q)))
      .sort((a, b) => {
        const va = (a[sortKey] || '').toString().toLowerCase()
        const vb = (b[sortKey] || '').toString().toLowerCase()
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
      })
  }, [search, activeCategory, sortKey, sortDir])

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>
    return <span style={{ marginLeft: 4, color: 'var(--blue)' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div className="page-content fade-in" style={{ maxWidth: '100%' }}>

      {/* Page Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy)', margin: 0, fontFamily: 'DM Sans, sans-serif' }}>
          Metric Glossary
        </h1>
        <p style={{ fontSize: 13, color: 'var(--subtext)', marginTop: 4, marginBottom: 0 }}>
          Definitions, formulas, and data sources for every metric in the Affiliate Intelligence dashboard
        </p>
      </div>

      {/* ── Section 1: Searchable Metrics Table ── */}
      <div className="chart-card" style={{ marginBottom: 24 }}>
        <div className="chart-header">
          <div>
            <div className="chart-title">All Metrics</div>
            <div className="chart-sub">{filtered.length} of {METRICS.length} metrics shown</div>
          </div>
        </div>

        {/* Controls row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '0 20px 16px', flexWrap: 'wrap' }}>
          {/* Search */}
          <div style={{ position: 'relative', flex: '0 0 280px' }}>
            <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="6.5" cy="6.5" r="5" stroke="#0A2540" strokeWidth="1.5"/>
              <path d="M10.5 10.5L14 14" stroke="#0A2540" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              type="text"
              placeholder="Search metrics…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', paddingLeft: 32, paddingRight: 12, height: 36,
                border: '1px solid var(--border)', borderRadius: 8,
                fontSize: 13, color: 'var(--navy)', fontFamily: 'DM Sans, sans-serif',
                background: 'var(--bg)', outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Category pills */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CATEGORIES.map(cat => {
              const active = activeCategory === cat
              return (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  style={{
                    padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                    border: active ? 'none' : '1px solid var(--border)',
                    background: active ? 'var(--blue)' : '#fff',
                    color: active ? '#fff' : 'var(--subtext)',
                    cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                    transition: 'all 0.15s',
                  }}
                >
                  {cat}
                </button>
              )
            })}
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '2px solid var(--border)', position: 'sticky', top: 0, zIndex: 2 }}>
                {[
                  { key: 'name',       label: 'Metric Name',           width: 200 },
                  { key: 'category',   label: 'Category',              width: 130 },
                  { key: 'definition', label: 'Plain English Definition', width: 300 },
                  { key: 'formula',    label: 'Formula',               width: 220 },
                  { key: 'ga4',        label: 'GA4 Field(s)',          width: 200 },
                  { key: 'notes',      label: 'Notes',                 width: undefined },
                ].map(col => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    style={{
                      padding: '10px 14px', textAlign: 'left', fontWeight: 700,
                      color: '#5A6A7A', fontSize: 11, letterSpacing: '0.05em',
                      textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none',
                      width: col.width, whiteSpace: 'nowrap',
                    }}
                  >
                    {col.label}<SortIcon col={col.key} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--subtext)', fontStyle: 'italic' }}>
                    No metrics match your search.
                  </td>
                </tr>
              ) : filtered.map((m, i) => {
                const catStyle = CAT_STYLE[m.category] || {}
                return (
                  <tr key={m.name} style={{ background: i % 2 === 0 ? '#fff' : '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
                    {/* Metric Name */}
                    <td style={{ padding: '12px 14px', fontWeight: 700, color: 'var(--navy)', verticalAlign: 'top' }}>
                      {m.name}
                    </td>
                    {/* Category */}
                    <td style={{ padding: '12px 14px', verticalAlign: 'top' }}>
                      <span style={{
                        display: 'inline-block',
                        background: catStyle.bg, color: catStyle.color,
                        borderRadius: 20, padding: '3px 10px',
                        fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                      }}>
                        {m.category}
                      </span>
                    </td>
                    {/* Definition */}
                    <td style={{ padding: '12px 14px', color: 'var(--navy)', lineHeight: 1.6, verticalAlign: 'top' }}>
                      {m.definition}
                    </td>
                    {/* Formula */}
                    <td style={{ padding: '12px 14px', verticalAlign: 'top' }}>
                      <code style={{ fontFamily: "'DM Mono', 'Courier New', monospace", fontSize: 12, color: '#0A2540', background: '#F1F5F9', padding: '2px 6px', borderRadius: 4, lineHeight: 1.8, display: 'inline-block', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {m.formula}
                      </code>
                    </td>
                    {/* GA4 Fields */}
                    <td style={{ padding: '12px 14px', verticalAlign: 'top' }}>
                      <code style={{ fontFamily: "'DM Mono', 'Courier New', monospace", fontSize: 12, color: '#64748B', lineHeight: 1.8, display: 'inline-block', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {m.ga4}
                      </code>
                    </td>
                    {/* Notes */}
                    <td style={{ padding: '12px 14px', color: 'var(--subtext)', fontStyle: 'italic', lineHeight: 1.6, verticalAlign: 'top' }}>
                      {m.notes}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 2: Data Sources ── */}
      <div className="chart-card" style={{ marginBottom: 24 }}>
        <div className="chart-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <ellipse cx="8" cy="4" rx="6" ry="2.5" stroke="#0F5FA6" strokeWidth="1.5"/>
              <path d="M2 4v4c0 1.38 2.69 2.5 6 2.5S14 9.38 14 8V4" stroke="#0F5FA6" strokeWidth="1.5"/>
              <path d="M2 8v4c0 1.38 2.69 2.5 6 2.5S14 13.38 14 12V8" stroke="#0F5FA6" strokeWidth="1.5"/>
            </svg>
            <div>
              <div className="chart-title">Data Sources</div>
              <div className="chart-sub">How this dashboard connects to your data</div>
            </div>
          </div>
        </div>
        <div style={{ padding: '4px 24px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
          {[
            {
              title: 'GA4 Property',
              body: 'All metrics are sourced from Google Analytics 4 property 259261360 (www.hoppa.com). The dashboard connects via the GA4 Data API v1beta using a service account with read-only access.',
            },
            {
              title: 'Affiliate Filter',
              body: "All data is filtered to sessions where sessionMedium = 'affiliates' (case-insensitive). This captures traffic arriving via Awin affiliate partner links only. Other channels (Paid Search, Organic, Email, Direct) are excluded from all metrics shown in this dashboard.",
            },
            {
              title: 'Affiliate Names',
              body: "Numeric Awin publisher IDs (e.g. 63136) are mapped to affiliate names and promotion method types using a live Google Sheets mapping file. The mapping refreshes every 30 minutes. Click 'Refresh names' on the Affiliate Scorecard to force an immediate update.",
            },
            {
              title: 'Comparison Periods',
              body: 'vs Previous Period: the equivalent prior date range (e.g. Last 30 days → the 30 days before)\nvs Same Period Last Year: same start and end dates shifted back 365 days.',
            },
            {
              title: 'Data Freshness',
              body: "GA4 data is typically available with a 24–48 hour lag. Today's sessions will appear tomorrow. Historical data from January 2025 onwards is available.",
            },
          ].map(item => (
            <div key={item.title} style={{ borderLeft: '3px solid var(--blue)', paddingLeft: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>{item.title}</div>
              <div style={{ fontSize: 12, color: 'var(--subtext)', lineHeight: 1.7, whiteSpace: 'pre-line' }}>{item.body}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Section 3: Calculation Notes ── */}
      <div className="chart-row chart-row-3" style={{ marginBottom: 24, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {[
          {
            accent: '#0F5FA6',
            bg: '#EFF6FF',
            title: 'Why Conv Rate differs from GA4',
            body: "GA4's native sessionConversionRate metric counts all conversion events — including micro-conversions like form submissions, search result views, and page scroll events. This can show conversion rates of 40%+ which is not meaningful for tracking bookings. This dashboard calculates Session Conversion Rate as Transactions ÷ Sessions which reflects actual completed bookings only. The difference is intentional and correct.",
          },
          {
            accent: '#D97706',
            bg: '#FFFBEB',
            title: 'Why some metrics are calculated manually',
            body: 'Three GA4 native metrics return incorrect values when filtered to a specific sessionMedium: screenPageViewsPerSession (returns 0), sessionConversionRate (includes micro-conversions), and engagementRate (incorrect when averaged across rows). This dashboard recalculates all three manually from raw event counts to ensure accuracy. The GA4 field names are shown in the table above for reference but the values displayed are always the manually calculated versions.',
          },
          {
            accent: '#0D8A72',
            bg: '#F0FDF9',
            title: 'Why session counts vary slightly between pages',
            body: 'GA4 applies statistical sampling to queries that involve many dimension combinations. When the same period is queried with different dimension sets (e.g. date only vs date + country + device), GA4 may return slightly different session totals due to sampling. Variances of less than 1% are normal and expected. This dashboard uses a canonical set of dimensions and metrics across all pages to minimise this variance.',
          },
        ].map(card => (
          <div key={card.title} style={{
            background: card.bg,
            borderLeft: `4px solid ${card.accent}`,
            borderRadius: 10,
            padding: '18px 20px',
            boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)', marginBottom: 10 }}>{card.title}</div>
            <div style={{ fontSize: 12, color: 'var(--subtext)', lineHeight: 1.75 }}>{card.body}</div>
          </div>
        ))}
      </div>

      {/* ── Footer ── */}
      <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--subtext)', fontStyle: 'italic', paddingBottom: 32 }}>
        Last updated: {today} · GA4 Property 259261360 · hoppa.com Affiliates · Questions? Contact the Analytics team
      </div>

    </div>
  )
}
