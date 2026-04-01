import { useState } from 'react'

const SORT_KEYS = {
  affiliateId: (a, b) => a.affiliateId.localeCompare(b.affiliateId),
  sessions: (a, b) => b.sessions - a.sessions,
  bookings: (a, b) => b.bookings - a.bookings,
  revenue: (a, b) => b.revenue - a.revenue,
  convRate: (a, b) => b.convRate - a.convRate,
  aov: (a, b) => b.aov - a.aov,
  engagementRate: (a, b) => b.engagementRate - a.engagementRate,
  healthScore: (a, b) => b.healthScore - a.healthScore,
  revenuePerSession: (a, b) => b.revenuePerSession - a.revenuePerSession,
}

/**
 * Leaderboard table
 * Props:
 *   data     array of affiliate objects
 *   columns  array of { key, label, format, width }
 *   showHealth  bool — show health score column
 */
export default function Leaderboard({ data = [], columns = [], showHealth = false, showDeltas = false, totals = null, prevTotals = null, defaultSortKey = 'sessions', isPromo = false }) {
  const [sortKey, setSortKey] = useState(defaultSortKey)
  const [sortDir, setSortDir] = useState('desc')

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = [...data].sort((a, b) => {
    const fn = SORT_KEYS[sortKey]
    if (!fn) return 0
    return sortDir === 'asc' ? -fn(a, b) : fn(a, b)
  })

  const stickyTh = (side, style) => ({ ...style, position: 'sticky', [side]: 0, background: '#F8FAFC', zIndex: 10 })

  return (
    <div className="data-table-container">
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 44, textAlign: 'center', position: 'sticky', left: 0, background: '#F8FAFC', zIndex: 12 }}>#</th>
            <th
              style={stickyTh('left', { minWidth: 160, left: 44, zIndex: 12, cursor: 'pointer', color: sortKey === 'name' ? '#0F5FA6' : '#5A6A7A' })}
              onClick={() => handleSort('name')}
            >
              {isPromo ? 'PROMO METHOD' : 'AFFILIATE'}
              {sortKey === 'name' && (
                <span style={{ marginLeft: 4, fontSize: 10 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
              )}
            </th>
            {columns.map(col => (
              <th key={col.key} onClick={() => handleSort(col.key)} style={{ minWidth: col.width || 90, textAlign: 'right' }}>
                {col.label} {sortKey === col.key ? (sortDir === 'desc' ? '↓' : '↑') : ''}
              </th>
            ))}
            {showHealth && (
              <HealthHeader
                sorted={sortKey === 'healthScore'}
                sortDir={sortDir}
                onSort={() => handleSort('healthScore')}
              />
            )}
          </tr>
        </thead>
        <tbody>
          {totals && prevTotals && (
            <tr style={{ background: '#F0F9FF', borderBottom: '2px solid #E2E8F0' }}>
              <td style={{ textAlign: 'center' }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', background: '#0284C7', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, margin: '0 auto'
                }}>∑</div>
              </td>
              <td style={{ fontWeight: 700, fontFamily: 'DM.Sans, sans-serif', fontSize: 13, color: '#0369A1' }}>TOTAL</td>
              {columns.map(col => {
                const f = col.format || col.key
                if (f === 'wow') return <td key={col.key} />
                const mainVal = totals[col.key] ?? (totals[f] ?? 0)
                const prevVal = prevTotals[col.key] ?? (prevTotals[f] ?? 0)

                return (
                  <td key={col.key} style={{ textAlign: 'right' }}>
                    {showDeltas ? (
                      <DeltaCell value={mainVal} prevValue={prevVal} type={f} />
                    ) : (
                      <span style={{ fontWeight: 600, color: '#0369A1' }}>{formatCell(col.key, mainVal, col.format)}</span>
                    )}
                  </td>
                )
              })}
              {showHealth && <td />}
            </tr>
          )}

          {sorted.map((row, index) => (
            <tr key={row.affiliateId}>
              <td style={{ textAlign: 'center' }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, margin: '0 auto',
                  ...(index === 0 ? { background: '#FEF3C7', color: '#D97706' } :
                      index === 1 ? { background: '#F1F5F9', color: '#5A6A7A' } :
                      index === 2 ? { background: '#FFEDD5', color: '#C2410C' } :
                                    { background: '#EFF6FF', color: '#0F5FA6' })
                }}>
                  {index + 1}
                </div>
              </td>
              <td style={{ fontWeight: 600, fontFamily: 'DM.Sans, sans-serif', fontSize: 12, color: '#0A2540' }}>
                {row.name ?? row.affiliateId}
                {!isPromo && row.promotionMethod && (
                  <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 400, marginTop: 2 }}>
                    {row.promotionMethod}
                  </div>
                )}
              </td>
              {columns.map(col => {
                const f = col.format || col.key
                const mainVal = row[col.key]

                if (f === 'wow') {
                  return <td key={col.key} style={{ textAlign: 'right' }}><WowCell value={mainVal} /></td>
                }

                if (!showDeltas) {
                  return (
                    <td key={col.key} style={{ textAlign: 'right' }}>
                      {['engagementRate', 'bounceRate', 'convRate'].includes(f) ? (
                        <RateCell value={mainVal} type={f} />
                      ) : (
                        <span style={{ color: getCellColor(f, mainVal) }}>
                          {formatCell(col.key, mainVal, col.format)}
                        </span>
                      )}
                    </td>
                  )
                }

                const prevKey = 'prev' + col.key.charAt(0).toUpperCase() + col.key.slice(1)
                const prevVal = row[prevKey]

                return (
                  <td key={col.key} style={{ textAlign: 'right' }}>
                    <DeltaCell value={mainVal} prevValue={prevVal} type={f} />
                  </td>
                )
              })}
              {showHealth && (
                <td style={{ textAlign: 'center' }}>
                  <HealthBadge score={row.healthScore} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HealthHeader({ sorted, sortDir, onSort }) {
  const [tip, setTip] = useState(false)
  return (
    <th onClick={onSort} style={{ minWidth: 100, textAlign: 'center', position: 'relative' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        Health {sorted ? (sortDir === 'desc' ? '↓' : '↑') : ''}
        <span
          onMouseEnter={() => setTip(true)}
          onMouseLeave={() => setTip(false)}
          onClick={e => e.stopPropagation()}
          style={{ cursor: 'default', color: '#94A3B8', fontSize: 11, lineHeight: 1 }}
        >ⓘ</span>
      </span>
      {tip && (
        <div style={{
          position: 'absolute', top: '110%', left: '50%', transform: 'translateX(-50%)',
          background: '#0A2540', color: '#fff', borderRadius: 8,
          padding: '10px 13px', width: 240, zIndex: 999,
          fontSize: 11, lineHeight: 1.6, fontWeight: 400, textAlign: 'left',
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          pointerEvents: 'none',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: '#DBEAFE' }}>Health Score Formula</div>
          <div>Engagement Rate × 0.25</div>
          <div>Conversion Rate × 0.35</div>
          <div>WoW Sessions Δ × 0.20</div>
          <div>WoW Revenue Δ × 0.20</div>
          <div style={{ marginTop: 6, color: '#94A3B8' }}>
            ≥75 Healthy · 50–74 Watch · &lt;50 At Risk
          </div>
        </div>
      )}
    </th>
  )
}

function HealthBadge({ score }) {
  if (score == null) return <span style={{ color: 'var(--subtext)' }}>—</span>
  const cfg = score > 75
    ? { bg: '#D1FAE5', color: '#065F46', label: 'Healthy' }
    : score >= 50
    ? { bg: '#FEF3C7', color: '#92400E', label: 'Watch' }
    : { bg: '#FEE2E2', color: '#991B1B', label: 'At Risk' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: cfg.bg, color: cfg.color,
      borderRadius: 6, padding: '3px 9px',
      fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
    }}>
      <span style={{ fontSize: 12, fontWeight: 800 }}>{score}</span>
      <span style={{ fontWeight: 600, opacity: 0.8 }}>{cfg.label}</span>
    </span>
  )
}

function formatCell(key, value, fmt) {
  const f = fmt || key
  if (f === 'wow') return null // handled by WowCell
  if (value == null || (typeof value === 'number' && isNaN(value))) return '—'
  switch (f) {
    case 'revenue':
    case 'revenuePerSession':
      return `£${Number(value).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`
    case 'aov':
      return `£${Number(value).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    case 'convRate':
      return `${(value * 100).toFixed(2)}%`
    case 'engagementRate':
      return `${(value * 100).toFixed(1)}%`
    case 'bounceRate':
      return `${(value * 100).toFixed(1)}%`
    case 'checkoutRate':
      return `${(value * 100).toFixed(1)}%`
    case 'avgDuration':
      return `${Math.floor(value / 60)}m ${String(Math.floor(value % 60)).padStart(2, '0')}s`
    case 'pagesPerSession':
      return Number(value).toFixed(1)
    default:
      return Number(value).toLocaleString('en-GB')
  }
}

function WowCell({ value }) {
  if (value === 'NEW') return <span style={{ color: '#0F5FA6', fontWeight: 600, fontSize: 11 }}>NEW</span>
  if (value == null || isNaN(value)) return <span style={{ color: 'var(--subtext)' }}>—</span>
  const pct = (value * 100).toFixed(1)
  const pos = value >= 0
  return (
    <span style={{ color: pos ? '#0D8A72' : '#C0392B', fontWeight: 600 }}>
      {pos ? '+' : ''}{pct}%
    </span>
  )
}

function DeltaCell({ value, prevValue, type }) {
  const isRate = ['engagementRate', 'bounceRate', 'convRate'].includes(type)
  const isCurrency = ['revenue', 'aov', 'revenuePerSession'].includes(type)
  
  const primaryText = isRate ? `${(value * 100).toFixed(2)}%` : 
                      isCurrency ? `£${Number(value).toLocaleString('en-GB', { minimumFractionDigits: type === 'revenue' ? 0 : 2, maximumFractionDigits: type === 'revenue' ? 0 : 2})}` :
                      Number(value).toLocaleString('en-GB')
                      
  if (prevValue == null || value === prevValue || prevValue === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minHeight: 40, justifyContent: 'center' }}>
        <span style={{ fontWeight: 600, color: '#0A2540' }}>{primaryText}</span>
      </div>
    )
  }

  let deltaText = ''
  let color = ''
  let bg = ''
  let arrow = ''
  
  if (isRate) {
    const pp = (value * 100) - (prevValue * 100)
    deltaText = `${Math.abs(pp).toFixed(1)}pp`
    const good = type === 'bounceRate' ? pp <= 0 : pp >= 0
    color = good ? '#059669' : '#DC2626'
    bg = good ? '#ECFDF5' : '#FEF2F2'
    arrow = pp > 0 ? '↑' : pp < 0 ? '↓' : ''
  } else {
    // Math handle for % difference
    const pct = prevValue > 0 ? ((value - prevValue) / prevValue) * 100 : 100
    deltaText = `${Math.abs(pct).toFixed(1)}%`
    const good = pct >= 0
    color = good ? '#059669' : '#DC2626'
    bg = good ? '#ECFDF5' : '#FEF2F2'
    arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : ''
  }
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', minHeight: 40, gap: 4 }}>
      <span style={{ fontWeight: 600, color: '#0A2540' }}>{primaryText}</span>
      <span style={{ 
        display: 'inline-flex', alignItems: 'center', gap: 2,
        background: bg, color: color,
        padding: '2px 6px', borderRadius: 4,
        fontSize: 11, fontWeight: 600
      }}>
        {arrow} {deltaText}
      </span>
    </div>
  )
}

function getCellColor(key, value) {
  return 'var(--navy)'
}

function RateCell({ value, type }) {
  if (value == null || isNaN(value)) return <span style={{ color: 'var(--subtext)' }}>—</span>

  const pct = value * 100
  let color = ''
  let bg = ''
  
  if (type === 'engagementRate') {
    if (pct > 60)      { color = '#166534'; bg = '#DCFCE7' } // Green
    else if (pct >= 40){ color = '#92400E'; bg = '#FEF3C7' } // Amber
    else               { color = '#991B1B'; bg = '#FEE2E2' } // Red
  } else if (type === 'bounceRate') {
    if (pct > 60)      { color = '#991B1B'; bg = '#FEE2E2' } // Red (inverse)
    else if (pct >= 40){ color = '#92400E'; bg = '#FEF3C7' } // Amber
    else               { color = '#166534'; bg = '#DCFCE7' } // Green
  } else if (type === 'convRate') {
    if (pct > 3.5)     { color = '#166534'; bg = '#DCFCE7' } // Green
    else if (pct >= 1) { color = '#92400E'; bg = '#FEF3C7' } // Amber
    else               { color = '#991B1B'; bg = '#FEE2E2' } // Red
  }

  const formatted = type === 'convRate' ? `${pct.toFixed(2)}%` : `${pct.toFixed(1)}%`

  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '12px',
      fontSize: 11,
      fontWeight: 700,
      color,
      backgroundColor: bg
    }}>
      {formatted}
    </span>
  )
}
