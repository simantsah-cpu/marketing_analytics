import React, { useState, useMemo } from 'react'

function parseLabel(path) {
  if (path === '/en') return 'Homepage'
  if (path === '/en/booking' || path.startsWith('/en/booking/')) return 'Booking Page'
  if (path.startsWith('/en/spain/')) return 'Destination Page'
  if (path.startsWith('/en/discover/')) return 'Content Page'
  if (path === '/en/user-dashboard' || path.startsWith('/en/user-dashboard/')) return 'Account Page'
  if (path === '/de' || path === '/fr' || path === '/es' || path === '/it') return 'Localised Homepage'
  return path
}

function getInsightTag(engRate, convRate, sessions) {
  // 1. High Intent    → engRate > 65% AND convRate > 3%
  if (engRate > 65 && convRate > 3) return { label: 'High Intent', bg: '#EFF6FF', color: '#1E3A8A' }
  // 2. Quality Traffic → engRate > 60% AND convRate > 1%
  if (engRate > 60 && convRate > 1) return { label: 'Quality Traffic', bg: '#DCFCE7', color: '#166534' }
  // 3. Browse Only    → engRate > 55% AND convRate < 0.5%
  if (engRate > 55 && convRate < 0.5) return { label: 'Browse Only', bg: '#FEF3C7', color: '#92400E' }
  // 4. Bounce Risk    → engRate < 40%
  if (engRate < 40) return { label: 'Bounce Risk', bg: '#FEE2E2', color: '#991B1B' }
  // 5. Low Volume     → sessions < 30
  if (sessions < 30) return { label: 'Low Volume', bg: '#F1F5F9', color: '#475569' }
  
  return null
}

function truncate(str, max) {
  return str.length > max ? str.substring(0, max) + '…' : str
}

export default function LandingPageTable({ data }) {
  const [sortKey, setSortKey] = useState('sessions')
  const [sortDir, setSortDir] = useState('desc')

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity
      const bv = b[sortKey] ?? -Infinity
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [data, sortKey, sortDir])

  const maxSessions = Math.max(...data.map(d => d.sessions || 0), 1)

  const thStyle = {
    padding: '10px 12px', fontSize: 12, fontWeight: 700, letterSpacing: '0.05em',
    background: '#0A2540', color: '#fff', textTransform: 'uppercase',
    cursor: 'pointer', userSelect: 'none', borderBottom: 'none',
  }

  const tdStyle = {
    padding: '10px 12px', fontSize: 13, color: '#0A2540',
    borderBottom: '1px solid #F1F5F9', verticalAlign: 'middle'
  }

  return (
    <div style={{ overflowX: 'auto', borderRadius: '8px 8px 0 0', border: '1px solid #E2E8F0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'DM Sans', sans-serif" }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, width: 40, textAlign: 'center' }}>#</th>
            <th style={{ ...thStyle, textAlign: 'left' }} onClick={() => handleSort('path')}>
              Landing Page {sortKey === 'path' && (sortDir === 'asc' ? '▲' : '▼')}
            </th>
            <th style={{ ...thStyle, textAlign: 'right', width: 140 }} onClick={() => handleSort('sessions')}>
              Sessions {sortKey === 'sessions' && (sortDir === 'asc' ? '▲' : '▼')}
            </th>
            <th style={{ ...thStyle, textAlign: 'right', width: 100 }} onClick={() => handleSort('engagementRate')}>
              Eng. Rate {sortKey === 'engagementRate' && (sortDir === 'asc' ? '▲' : '▼')}
            </th>
            <th style={{ ...thStyle, textAlign: 'right', width: 100 }} onClick={() => handleSort('convRate')}>
              Conv. Rate {sortKey === 'convRate' && (sortDir === 'asc' ? '▲' : '▼')}
            </th>
            <th style={{ ...thStyle, textAlign: 'right', width: 110 }} onClick={() => handleSort('averageSessionDuration')}>
              Avg Duration {sortKey === 'averageSessionDuration' && (sortDir === 'asc' ? '▲' : '▼')}
            </th>
            <th style={{ ...thStyle, textAlign: 'center', width: 120, cursor: 'default' }}>
              Insight Tag
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 10).map((row, idx) => {
            const bg = idx % 2 === 0 ? '#fff' : '#FAFBFC'
            
            // Format Eng Rate
            const er = row.engagementRate || 0
            let erColor = er > 60 ? '#166534' : er >= 40 ? '#92400E' : '#991B1B'

            // Format Conv Rate
            const cr = row.convRate || 0
            let crColor = cr === 0 ? '#94A3B8' : cr > 3.5 ? '#166534' : cr >= 1.0 ? '#92400E' : '#991B1B'

            // Format Duration
            const totalSeconds = Math.round(row.averageSessionDuration || 0)
            const minutes = Math.floor(totalSeconds / 60)
            const seconds = totalSeconds % 60
            const mmss = `${minutes}m ${String(seconds).padStart(2, '0')}s`

            // Insight Tag
            const tag = getInsightTag(row.engagementRate, row.convRate, row.sessions)
            const sessionPct = (row.sessions / maxSessions) * 100

            return (
              <tr key={row.path || idx} style={{ background: bg }}>
                <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 600, color: '#5A6A7A' }}>{idx + 1}</td>
                <td style={{ ...tdStyle }}>
                  <div style={{ fontWeight: 600, color: '#0F5FA6', wordBreak: 'break-all' }} title={row.path}>
                    {truncate(row.path, 45)}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                    {parseLabel(row.path)}
                  </div>
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {row.sessions.toLocaleString('en-GB')}
                  </div>
                  <div style={{ width: '100%', height: 4, background: '#F1F5F9', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${sessionPct}%`, height: '100%', background: '#BAE6FD', borderRadius: 2 }} />
                  </div>
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: erColor }}>
                  {er.toFixed(1)}%
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: crColor }}>
                  {cr.toFixed(2)}%
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {mmss}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  {tag && (
                    <span style={{
                      display: 'inline-block', padding: '3px 8px', borderRadius: 12,
                      background: tag.bg, color: tag.color, fontSize: 11, fontWeight: 700,
                      whiteSpace: 'nowrap'
                    }}>
                      {tag.label}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
