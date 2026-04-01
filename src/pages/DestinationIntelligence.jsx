import { useState, useEffect, useMemo } from 'react'
import { useFilters } from '../context/FiltersContext'
import { useProperty } from '../context/PropertyContext'
import { getDestinationIntelligence } from '../services/data-service'

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = {
  currency: v => `£${Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  currencyK: v => v >= 1000 ? `£${(v / 1000).toFixed(1)}K` : `£${Number(v).toFixed(0)}`,
  int: v => Math.round(v).toLocaleString('en-GB'),
  pct: v => `${Number(v).toFixed(2)}%`,
  pct1: v => `${Number(v).toFixed(1)}%`,
}

function convRateColor(v) {
  if (v >= 3.5) return '#15803D'
  if (v >= 1)   return '#D97706'
  return '#DC2626'
}
function engColor(v) {
  if (v >= 60) return '#15803D'
  if (v >= 40) return '#D97706'
  return '#DC2626'
}

function Badge({ type }) {
  const styles = {
    Cashback:        { bg: '#DBEAFE', color: '#1D4ED8' },
    Loyalty:         { bg: '#EDE9FE', color: '#5B21B6' },
    Voucher:         { bg: '#FEF3C7', color: '#D97706' },
    Content:         { bg: '#DCFCE7', color: '#15803D' },
    'Sub Networks':  { bg: '#FEE2E2', color: '#DC2626' },
    'N/A':           { bg: '#F1F5F9', color: '#64748B' },
  }
  const s = styles[type] || styles['N/A']
  return (
    <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '2px 8px', background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>
      {type || 'N/A'}
    </span>
  )
}

function PageSkeleton() {
  return (
    <div className="page-content fade-in">
      <div style={{ height: 28, width: 260, background: '#E8EFF8', borderRadius: 6, marginBottom: 8 }} />
      <div style={{ height: 14, width: 380, background: '#F0F4F9', borderRadius: 4, marginBottom: 28 }} />
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {[...Array(5)].map((_, i) => (
          <div key={i} style={{ flex: 1, height: 90, background: '#F0F4F9', borderRadius: 10 }} />
        ))}
      </div>
      <div style={{ height: 320, background: '#F0F4F9', borderRadius: 10 }} />
    </div>
  )
}

function RevBar({ value, max }) {
  if (!max || !value) return null
  const pct = Math.min((value / max) * 100, 100)
  return (
    <div style={{ width: '100%', marginTop: 4 }}>
      <div style={{ height: 4, background: '#E2EAF0', borderRadius: 3 }}>
        <div style={{ height: 4, width: `${pct}%`, background: '#0D8A72', borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

function SortIcon({ col, sortKey, sortDir }) {
  if (sortKey !== col) return <span style={{ opacity: 0.25, marginLeft: 3 }}>↕</span>
  return <span style={{ marginLeft: 3, color: 'var(--blue)' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
}

const COLS = [
  { key: '#',              label: '#',           sortable: false },
  { key: 'destination',    label: 'Destination', sortable: true  },
  { key: 'country',        label: 'Country',     sortable: true  },
  { key: 'sessions',       label: 'Sessions',    sortable: true  },
  { key: 'bookings',       label: 'Bookings',    sortable: true  },
  { key: 'revenue',        label: 'TTV',         sortable: true  },
  { key: 'aov',            label: 'AOV',         sortable: true  },
  { key: 'revPerSession',  label: 'Rev/Session', sortable: true  },
  { key: 'convRate',       label: 'Conv Rate',   sortable: true  },
  { key: 'engagementRate', label: 'Eng Rate',    sortable: true  },
]

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DestinationIntelligence() {
  const { filters } = useFilters()
  const { selectedProperty } = useProperty()

  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [selectedIdx, setSelectedIdx]           = useState(0)
  const [sortKey, setSortKey]   = useState('revenue')
  const [sortDir, setSortDir]   = useState('desc')
  const [phase2Dismissed, setPhase2Dismissed]   = useState(false)
  const [hpBannerDismissed, setHpBannerDismissed] = useState(false)

  useEffect(() => { setSelectedIdx(0) }, [data])
  useEffect(() => { setHpBannerDismissed(false) }, [selectedIdx])

  useEffect(() => {
    if (!selectedProperty) return
    setLoading(true)
    setError(null)
    getDestinationIntelligence(selectedProperty?.ga4_property_id, filters)
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [selectedProperty, filters.dateRanges, filters.affiliateFilter, filters.countryFilter, filters.deviceFilter])

  // ── All derived values MUST be before any early returns (Rules of Hooks) ──────
  const affiliates = data?.affiliates || []
  const selectedAff = affiliates[selectedIdx] || affiliates[0] || {
    destinations: [], totalSessions: 0, totalBookings: 0, totalRevenue: 0, affiliateName: '',
  }

  const namedDests = (selectedAff.destinations || []).filter(d => !d.isHomepage)
  const hpDests    = (selectedAff.destinations || []).filter(d => d.isHomepage)

  const totalSessions = namedDests.reduce((s, d) => s + d.sessions, 0)
  const totalBookings = namedDests.reduce((s, d) => s + d.bookings, 0)
  const totalRevenue  = namedDests.reduce((s, d) => s + d.revenue, 0)
  const totalEngaged  = namedDests.reduce((s, d) => s + d.engagedSessions, 0)
  const totalConvRate = totalSessions > 0 ? (totalBookings / totalSessions) * 100 : 0
  const totalAov      = totalBookings > 0 ? totalRevenue / totalBookings : 0
  const totalRps      = totalSessions > 0 ? totalRevenue / totalSessions : 0
  const totalEngRate  = totalSessions > 0 ? (totalEngaged / totalSessions) * 100 : 0

  const hpSessions = hpDests.reduce((s, d) => s + d.sessions, 0)
  const hpPct = selectedAff.totalSessions > 0
    ? Math.round((hpSessions / selectedAff.totalSessions) * 100) : 0

  const maxRev = Math.max(...namedDests.map(d => d.revenue), 1)

  // useMemo is a hook — must be unconditional, before any return statements
  const allRows = useMemo(() => {
    const all = [...(selectedAff.destinations || [])]
    return all.sort((a, b) => {
      const va = a[sortKey] ?? 0
      const vb = b[sortKey] ?? 0
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
      return sortDir === 'asc' ? va - vb : vb - va
    })
  }, [selectedAff, sortKey, sortDir])

  const dateLabel = (() => {
    const dr = filters?.dateRanges
    if (!dr?.primary) return filters?.preset || ''
    return `${dr.primary.startDate} – ${dr.primary.endDate}`
  })()

  // ── Early returns (after ALL hooks) ──────────────────────────────────────────
  if (loading && !data) return <PageSkeleton />
  if (error) return (
    <div className="page-content">
      <div style={{ padding: 24, background: '#FEE2E2', borderRadius: 10, color: '#DC2626', fontSize: 13 }}>
        ⚠ Error loading destination data: {error}
      </div>
    </div>
  )
  if (!affiliates.length) return (
    <div className="page-content fade-in">
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy)' }}>Destination Intelligence</h1>
      <p style={{ color: 'var(--subtext)', fontSize: 13 }}>No destination data found for this period and filter selection.</p>
    </div>
  )

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="page-content fade-in">

      {/* Page Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy)', margin: 0, fontFamily: 'DM Sans, sans-serif' }}>
          Destination Intelligence
        </h1>
        <p style={{ fontSize: 13, color: 'var(--subtext)', marginTop: 4, marginBottom: 0 }}>
          Top destinations driven by each affiliate · based on landing page and booking data
        </p>
        <p style={{ fontSize: 12, color: 'var(--navy)', marginTop: 3, marginBottom: 0, fontWeight: 700 }}>
          {dateLabel}
        </p>
      </div>

      {/* Phase 2 Banner */}
      {!phase2Dismissed && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, justifyContent: 'space-between',
          background: '#EFF6FF', borderLeft: '4px solid #1A7FD4', borderRadius: 8,
          padding: '12px 16px', marginBottom: 16, fontSize: 12, color: '#1D4ED8', lineHeight: 1.6,
        }}>
          <span>
            <strong>📊 Phase 2:</strong> Margin, ATV (Average Transaction Value), and AMV (Average Margin Value) will be
            added when BigQuery booking data is connected. These metrics require backend booking system data not available in GA4.
          </span>
          <button onClick={() => setPhase2Dismissed(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#1A7FD4', flexShrink: 0, padding: 0, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* ── Section 1: Affiliate selector cards (scrollable) ── */}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 10, width: 'max-content', paddingBottom: 4 }}>
          {affiliates.map((aff, idx) => {
            const active = idx === selectedIdx
            return (
              <div
                key={aff.affiliateId}
                onClick={() => setSelectedIdx(idx)}
                style={{
                  width: 160, flexShrink: 0, cursor: 'pointer', borderRadius: 10,
                  border: active ? '2px solid var(--blue)' : '1px solid var(--border)',
                  background: active ? '#EFF6FF' : '#fff',
                  padding: '12px 14px', transition: 'all 0.15s',
                  boxShadow: active ? '0 2px 8px rgba(15,95,166,0.12)' : 'none',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.borderColor = '#93C5FD' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor = 'var(--border)' }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {aff.affiliateName}
                </div>
                <div style={{ marginBottom: 6 }}><Badge type={aff.affiliateType} /></div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--teal)', marginBottom: 2 }}>
                  {fmt.currencyK(aff.totalRevenue)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--subtext)' }}>
                  {fmt.int(aff.totalBookings)} bookings
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Section 2: Destination table ── */}
      <div className="chart-card" style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>

        {/* Homepage warning banner */}
        {hpPct > 0 && !hpBannerDismissed && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, justifyContent: 'space-between',
            margin: '0 0 0', background: '#FFFBEB',
            borderLeft: '3px solid #D97706',
            padding: '10px 24px', fontSize: 12, color: '#92400E', lineHeight: 1.6,
          }}>
            <span>
              ⚠ <strong>{hpPct}%</strong> of this affiliate's sessions landed on the hoppa.com homepage.
              Destination data is only available for sessions that deep-linked to a specific destination page.
              Encourage this partner to use destination-specific URLs to improve tracking.
            </span>
            <button onClick={() => setHpBannerDismissed(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#D97706', fontSize: 16, flexShrink: 0, padding: 0, lineHeight: 1 }}>×</button>
          </div>
        )}

        <div style={{ overflowX: 'auto', width: '100%' }}>
          <table style={{ width: '100%', minWidth: 860, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '2px solid var(--border)' }}>
                {COLS.map(col => (
                  <th
                    key={col.key}
                    onClick={() => col.sortable && handleSort(col.key)}
                    style={{
                      padding: '9px 12px', textAlign: col.key === '#' ? 'center' : 'left',
                      fontSize: 11, fontWeight: 700, color: '#5A6A7A',
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      cursor: col.sortable ? 'pointer' : 'default',
                      userSelect: 'none', whiteSpace: 'nowrap', width: col.width,
                    }}
                  >
                    {col.label}
                    {col.sortable && <SortIcon col={col.key} sortKey={sortKey} sortDir={sortDir} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Destination rows only — no TOTAL row */}
              {allRows.map((dest, i) => {
                const isHp = dest.isHomepage
                return (
                  <tr key={dest.destination + i} style={{ background: i % 2 === 0 ? '#fff' : '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--subtext)', fontSize: 12 }}>{i + 1}</td>
                    <td style={{ padding: '10px 12px', fontWeight: isHp ? 400 : 600, color: isHp ? 'var(--subtext)' : 'var(--navy)', fontStyle: isHp ? 'italic' : 'normal' }}>
                      {isHp ? '🏠 ' : '🌍 '}{dest.destination}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--subtext)', fontSize: 12 }}>{dest.country || '—'}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--navy)' }}>{fmt.int(dest.sessions)}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--navy)' }}>{dest.bookings}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ color: 'var(--navy)', fontWeight: isHp ? 400 : 600 }}>{fmt.currency(dest.revenue)}</span>
                      <RevBar value={dest.revenue} max={maxRev} />
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--subtext)' }}>{fmt.currency(dest.aov)}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--subtext)' }}>{fmt.currency(dest.revPerSession)}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: convRateColor(dest.convRate) }}>{fmt.pct(dest.convRate)}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: engColor(dest.engagementRate) }}>{fmt.pct1(dest.engagementRate)}</td>
                  </tr>
                )
              })}

              {allRows.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ padding: 32, textAlign: 'center', color: 'var(--subtext)', fontStyle: 'italic' }}>
                    No destination data for this affiliate in the selected period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Data limitation note */}
        <div style={{ padding: '10px 24px', fontSize: 11, color: 'var(--subtext)', fontStyle: 'italic', borderTop: '1px solid var(--border)' }}>
          Destination data is derived from the affiliate landing page URL. Sessions landing on /en (hoppa.com homepage) cannot be attributed
          to a specific destination. For complete destination booking data including margin and AMV, connect to BigQuery booking records.
        </div>
      </div>

    </div>
  )
}
