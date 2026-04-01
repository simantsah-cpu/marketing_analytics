import React, { useState, useMemo, useCallback } from 'react'

function fmt(value, type) {
  if (value == null || isNaN(value)) return '—'
  switch (type) {
    case 'int': return Math.round(value).toLocaleString('en-GB')
    case 'pct1': return `${(value * 100).toFixed(1)}%`
    case 'pct2': return `${(value * 100).toFixed(2)}%`
    case 'dur': return `${Math.floor(value / 60)}m ${String(Math.floor(value % 60)).padStart(2, '0')}s`
    case 'x1': return Number(value).toFixed(1)
    default: return value
  }
}

function makeBadge(curr, prev, type) {
  if (curr == null || prev == null || prev === 0) return null
  const diff = curr - prev
  const pct  = (diff / Math.abs(prev)) * 100
  let label, color, bg
  
  if (type === 'pct1' || type === 'pct2' || type === 'bounce') {
    const pp = diff * 100
    if (Math.abs(pp) < 0.05) return null
    label = `${pp > 0 ? '+' : ''}${pp.toFixed(1)}pp`
    const isGood = type === 'bounce' ? pp < 0 : pp > 0
    color = isGood ? '#16A34A' : '#DC2626'
    bg    = isGood ? '#DCFCE7' : '#FEE2E2'
  } else {
    if (Math.abs(pct) < 0.5) return null
    label = `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
    color = pct > 0 ? '#16A34A' : '#DC2626'
    bg    = pct > 0 ? '#DCFCE7' : '#FEE2E2'
  }
  return { label, color, bg }
}

function DeltaCell({ curr, prev, fmtType, badgeType, style = {} }) {
  const [tip, setTip] = useState(null)
  const badge = prev != null ? makeBadge(curr, prev, badgeType || fmtType) : null
  
  return (
    <td className="sc-td" style={{ textAlign: 'right', position: 'relative', ...style }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(curr, fmtType)}</span>
        {badge && (
          <span
            style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 10,
              background: badge.bg, color: badge.color, whiteSpace: 'nowrap', cursor: 'default' }}
            onMouseEnter={e => setTip({ x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setTip(null)}
          >
            {badge.label}
          </span>
        )}
      </div>
      {tip && badge && (
        <div style={{ position: 'fixed', zIndex: 9999,
          top: tip.y - 90, left: tip.x - 60,
          background: '#0A2540', color: '#fff', padding: '8px 12px', borderRadius: 8,
          fontSize: 11, lineHeight: 1.9, whiteSpace: 'nowrap',
          boxShadow: '0 4px 20px rgba(0,0,0,0.25)', pointerEvents: 'none' }}>
          <div>Current: <strong>{fmt(curr, fmtType)}</strong></div>
          <div>Previous: <strong>{fmt(prev, fmtType)}</strong></div>
          <div>Change: <strong style={{ color: badge.color }}>{badge.label}</strong></div>
        </div>
      )}
    </td>
  )
}

const COL = {
  rank:               { label: '#',            align: 'center' },
  affiliate:          { label: 'Affiliate',    align: 'left'   },
  sessions:           { label: 'Sessions',     align: 'right'  },
  engagedSessions:    { label: 'Engaged',      align: 'right'  },
  engagementRate:     { label: 'Eng. Rate',    align: 'right'  },
  bounceRate:         { label: 'Bounce Rate',  align: 'right'  },
  convRate:           { label: 'Conv. Rate',   align: 'right'  },
  avgDuration:        { label: 'Avg Duration', align: 'right'  },
  pagesPerSession:    { label: 'Pages/Session',align: 'right'  },
}
const COLS = ['rank','affiliate','sessions','engagedSessions','engagementRate','bounceRate','convRate','avgDuration','pagesPerSession']

export default function TrafficTable({ data, hasComparison, isPromo }) {
  const [sortKey, setSortKey] = useState('sessions')
  const [sortDir, setSortDir] = useState('desc')

  const handleSort = useCallback((key) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }, [sortKey, sortDir])

  const sorted = useMemo(() => {
    let arr = [...data]
    arr.sort((a, b) => {
      let av = a[sortKey] ?? -Infinity
      let bv = b[sortKey] ?? -Infinity
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortDir === 'asc' ? av - bv : bv - av
    })
    return arr
  }, [data, sortKey, sortDir])

  const stickyTh = (align, extra = {}) => ({
    padding: '10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
    background: '#F8FAFC', borderBottom: '2px solid #E2E8F0',
    color: '#5A6A7A', textAlign: align, userSelect: 'none', whiteSpace: 'nowrap',
    ...extra,
  })

  // Calculate Totals
  const totalSessions = data.reduce((s, r) => s + (r.sessions ?? 0), 0)
  const totalEngaged = data.reduce((s, r) => s + (r.engagedSessions ?? 0), 0)
  const totalEngRate = totalSessions > 0 ? totalEngaged / totalSessions : 0
  const totalBounceRate = totalSessions > 0 ? 1 - totalEngRate : 0
  const totalConvRate = totalSessions > 0 ? data.reduce((s, r) => s + ((r.sessions ?? 0) * (r.convRate ?? 0)), 0) / totalSessions : 0
  
  // Weights for avg calculations
  const totalDurationWt = data.reduce((s, r) => s + ((r.avgDuration ?? 0) * (r.sessions ?? 0)), 0)
  const totalAvgDuration = totalSessions > 0 ? totalDurationWt / totalSessions : 0
  
  const totalPagesWt = data.reduce((s, r) => s + ((r.pagesPerSession ?? 0) * (r.sessions ?? 0)), 0)
  const totalPagesPerSession = totalSessions > 0 ? totalPagesWt / totalSessions : 0

  const hasPrev = data.some(r => r.prevSessions != null)
  const prevSessions = hasPrev ? data.reduce((s, r) => s + (r.prevSessions ?? 0), 0) : null
  const prevEngaged = hasPrev ? data.reduce((s, r) => s + (r.prevEngRate != null ? (r.prevEngRate * r.prevSessions) : 0), 0) : null
  const prevEngRate = hasPrev && prevSessions > 0 ? prevEngaged / prevSessions : null
  const prevBounceRate = prevEngRate !== null ? 1 - prevEngRate : null
  
  const prevConvWt = hasPrev ? data.reduce((s, r) => s + (r.prevConvRate != null ? (r.prevConvRate * r.prevSessions) : 0), 0) : null
  const prevConvRate = hasPrev && prevSessions > 0 ? prevConvWt / prevSessions : null

  const prevDurationWt = hasPrev ? data.reduce((s, r) => s + (r.prevAvgDuration != null ? (r.prevAvgDuration * r.prevSessions) : 0), 0) : null
  const prevAvgDuration = hasPrev && prevSessions > 0 ? prevDurationWt / prevSessions : null

  const prevPagesWt = hasPrev ? data.reduce((s, r) => s + (r.prevPagesPerSession != null ? (r.prevPagesPerSession * r.prevSessions) : 0), 0) : null
  const prevPagesPerSession = hasPrev && prevSessions > 0 ? prevPagesWt / prevSessions : null

  const tdStyle = {
    padding: '10px 10px', fontSize: 12, fontWeight: 700,
    background: '#EFF6FF', borderBottom: '2px solid #BFDBFE',
    color: '#0A2540', textAlign: 'right', whiteSpace: 'nowrap',
  }

  return (
    <div style={{ overflowX: 'auto', background: '#fff', borderTop: '1px solid #E2E8F0' }}>
      <style>{`
        .totals-row td {
          background: #EFF6FF !important;
          border-bottom: 2px solid #BFDBFE !important;
        }
        .sc-td { padding: 9px 10px; font-size: 12.5px; color: #0A2540; border-bottom: 1px solid #F1F5F9; vertical-align: middle; }
        .sc-tr:hover .sc-td { background: #F8FAFC !important; }
        .aff-frozen { position: sticky; left: 44px; z-index: 1; font-weight: 600; }
        .rank-frozen { position: sticky; left: 0; z-index: 1; }
      `}</style>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'DM Sans',sans-serif" }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 4 }}>
          <tr>
            {COLS.map(col => {
              const def = COL[col]
              const isAc = sortKey === col
              const base = stickyTh(def.align, { color: isAc ? '#0F5FA6' : '#5A6A7A' })

              if (col === 'rank') return <th key={col} style={{ ...base, position: 'sticky', left: 0, zIndex: 5, width: 44 }}>#</th>
              if (col === 'affiliate') return <th key={col} style={{ ...base, position: 'sticky', left: 44, zIndex: 5, minWidth: 160, cursor: 'pointer' }} onClick={() => handleSort('name')}>{isPromo ? 'Promo Method' : 'Affiliate'}{sortKey === 'name' && <span style={{ marginLeft: 4, fontSize: 10 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}</th>

              const sortable = col
              return (
                <th key={col} style={{ ...base, minWidth: 90, cursor: 'pointer' }} onClick={() => handleSort(sortable)}>
                  {def.label}
                  {isAc && <span style={{ marginLeft: 4, fontSize: 10 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {/* Totals row */}
          {data.length > 0 && (
            <tr key="totals" className="totals-row">
              <td className="sc-td rank-frozen" style={{ ...tdStyle, textAlign: 'center', background: '#EFF6FF' }}>Σ</td>
              <td className="sc-td aff-frozen" style={{ ...tdStyle, textAlign: 'left', background: '#EFF6FF' }}>
                <span style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#3B82F6' }}>Total</span>
              </td>
              <DeltaCell curr={totalSessions} prev={hasComparison ? prevSessions : null} fmtType="int" style={tdStyle} />
              <DeltaCell curr={totalEngaged} prev={hasComparison ? prevEngaged : null} fmtType="int" style={tdStyle} />
              <DeltaCell curr={totalEngRate} prev={hasComparison ? prevEngRate : null} fmtType="pct1" style={tdStyle} />
              <DeltaCell curr={totalBounceRate} prev={hasComparison ? prevBounceRate : null} fmtType="pct1" badgeType="bounce" style={tdStyle} />
              <DeltaCell curr={totalConvRate} prev={hasComparison ? prevConvRate : null} fmtType="pct2" style={tdStyle} />
              <DeltaCell curr={totalAvgDuration} prev={hasComparison ? prevAvgDuration : null} fmtType="dur" style={tdStyle} />
              <DeltaCell curr={totalPagesPerSession} prev={hasComparison ? prevPagesPerSession : null} fmtType="x1" style={tdStyle} />
            </tr>
          )}

          {sorted.map((row, idx) => {
            let rankHtml = null
            const medals = { 0: '🥇', 1: '🥈', 2: '🥉' }
            if (medals[idx]) {
              rankHtml = <span style={{ fontSize: 16 }}>{medals[idx]}</span>
            } else {
              rankHtml = <span style={{ fontSize: 12, color: '#5A6A7A', fontWeight: 600 }}>{idx + 1}</span>
            }

            const rowBg = idx % 2 === 0 ? '#fff' : '#FAFBFC'

            return (
              <tr key={row.affiliateId || idx} className="sc-tr">
                <td className="sc-td rank-frozen" style={{ textAlign: 'center', width: 44, background: rowBg }}>
                  {rankHtml}
                </td>
                <td className="sc-td aff-frozen" style={{ background: rowBg }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{row.name ?? row.affiliateId}</div>
                  {!isPromo && <div style={{ fontSize: 10, color: '#94A3B8' }}>{row.promotionMethod ?? ''}</div>}
                </td>
                <DeltaCell curr={row.sessions} prev={hasComparison ? row.prevSessions : null} fmtType="int" />
                <DeltaCell curr={row.engagedSessions} prev={hasComparison ? (row.prevEngRate != null && row.prevSessions ? row.prevEngRate * row.prevSessions : null) : null} fmtType="int" />
                <DeltaCell curr={row.engagementRate} prev={hasComparison ? row.prevEngRate : null} fmtType="pct1" />
                <DeltaCell curr={row.bounceRate} prev={hasComparison ? row.prevBounceRate : null} fmtType="pct1" badgeType="bounce" />
                <DeltaCell curr={row.convRate} prev={hasComparison ? row.prevConvRate : null} fmtType="pct2" />
                <DeltaCell curr={row.avgDuration} prev={hasComparison ? row.prevAvgDuration : null} fmtType="dur" />
                <DeltaCell curr={row.pagesPerSession} prev={hasComparison ? row.prevPagesPerSession : null} fmtType="x1" />
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
