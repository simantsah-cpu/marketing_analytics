/**
 * AiOverviewLifecycle.jsx — Section E: Snippet lifecycle heat-map matrix.
 *
 * Rows    : top 10 snippets by total events.
 * Columns : time buckets driven by the shared `gran` prop (Week / Month / Quarter / Year).
 * Cell bg : per-row normalised intensity (each snippet's peak = 100% opacity).
 * Labels  : dark, high-contrast text throughout.
 *
 * Props:
 *   kpisRows       — GA4 KPI rows sorted by eventCount desc
 *   snippetWeekMap — { snippetText: { yearWeek: eventCount } }
 *   allSortedWeeks — sorted yearWeek strings e.g. ['202609', '202610', …]
 *   trendData      — raw trend rows (unused directly; aggregation uses snippetWeekMap)
 *   gran           — 'Week' | 'Month' | 'Quarter' | 'Year'  (from shared toggle)
 */
import { useMemo } from 'react'
import { CATEGORY_COLORS, SNIPPET_KEY, categorise, weekLabel } from './aiOverviewUtils'

// ─── ISO week → Monday Date ───────────────────────────────────────────────────
function isoWeekToDate(yearWeek) {
  if (!yearWeek || yearWeek.length < 6) return null
  const year = parseInt(yearWeek.slice(0, 4), 10)
  const week = parseInt(yearWeek.slice(4), 10)
  const jan4 = new Date(year, 0, 4)
  const dow   = jan4.getDay() || 7
  const mon1  = new Date(jan4)
  mon1.setDate(jan4.getDate() - dow + 1)
  const target = new Date(mon1)
  target.setDate(mon1.getDate() + (week - 1) * 7)
  return target
}

// ─── yearWeek → bucket key by granularity ────────────────────────────────────
function toBucketKey(yearWeek, gran) {
  const d = isoWeekToDate(yearWeek)
  if (!d) return yearWeek
  const y = d.getFullYear()
  const m = d.getMonth()
  switch (gran) {
    case 'Month':   return `${y}-${String(m + 1).padStart(2, '0')}`
    case 'Quarter': return `${y}-Q${Math.floor(m / 3) + 1}`
    case 'Year':    return `${y}`
    default:        return yearWeek  // Week
  }
}

// ─── Bucket key → human-readable column header ───────────────────────────────
function bucketHeader(key, gran) {
  if (!key) return ''
  switch (gran) {
    case 'Month': {
      const [y, m] = key.split('-')
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      return `${months[parseInt(m) - 1]} ${y}`
    }
    case 'Quarter': return key.replace('-', ' ')
    case 'Year':    return key
    default:        return weekLabel(key)   // Week → 'W18 · Apr 28'
  }
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ buckets, keys }) {
  // Determine trend from first vs last populated bucket
  const populated = keys.filter(k => (buckets[k] || 0) > 0)
  if (populated.length === 0) return <span style={{ fontSize: 10, color: '#94A3B8' }}>—</span>

  const first = buckets[populated[0]] || 0
  const last  = buckets[populated[populated.length - 1]] || 0
  const latestTwo = new Set(keys.slice(-2))
  const isNew = populated.every(k => latestTwo.has(k))

  let status
  if (isNew)                    status = 'new'
  else if (last >= first)       status = 'growing'
  else if (last < first * 0.5)  status = 'declining'
  else                          status = 'stable'

  const map = {
    growing:  { bg: '#DCFCE7', color: '#14532D', label: '▲ Growing' },
    declining:{ bg: '#FEE2E2', color: '#7F1D1D', label: '▼ Declining' },
    stable:   { bg: '#F1F5F9', color: '#374151', label: '→ Stable' },
    new:      { bg: '#EDE9FE', color: '#4C1D95', label: '✦ New' },
  }
  const s = map[status]
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 8, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function AiOverviewLifecycle({ kpisRows, snippetWeekMap, allSortedWeeks, gran = 'Week' }) {
  if (!kpisRows?.length || !allSortedWeeks?.length) return null

  // Top 10 snippets
  const top10 = kpisRows.slice(0, 10)

  // Aggregate snippetWeekMap into buckets for the chosen granularity
  const { bucketKeys, perSnippet } = useMemo(() => {
    const keySet = new Set()

    // Build per-snippet bucketed maps
    const ps = {}
    top10.forEach(row => {
      const text   = row[SNIPPET_KEY] ?? ''
      const weekMap = snippetWeekMap[text] || {}
      const bucketed = {}
      allSortedWeeks.forEach(w => {
        const key = toBucketKey(w, gran)
        keySet.add(key)
        bucketed[key] = (bucketed[key] || 0) + (weekMap[w] || 0)
      })
      ps[text] = bucketed
    })

    // Sorted bucket keys (chronological)
    const bucketKeys = [...keySet].sort()
    return { bucketKeys, perSnippet: ps }
  }, [top10, snippetWeekMap, allSortedWeeks, gran])

  const headerLabel = gran === 'Week' ? `per ISO week` : `per ${gran.toLowerCase()}`

  const thStyle = {
    padding: '9px 8px',
    fontSize: 10,
    fontWeight: 700,
    background: '#F8FAFC',
    borderBottom: '2px solid #E2E8F0',
    color: '#111827',
    whiteSpace: 'nowrap',
    textAlign: 'center',
    letterSpacing: '0.03em',
  }
  const tdStyle = {
    padding: '7px 6px',
    fontSize: 11,
    borderBottom: '1px solid #F1F5F9',
    verticalAlign: 'middle',
    textAlign: 'center',
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #F1F5F9' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#0A2540', marginBottom: 2 }}>Snippet Lifecycle Matrix</div>
        <div style={{ fontSize: 10, color: '#5A6A7A' }}>Top 10 snippets · event intensity normalised per row · {headerLabel}</div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'DM Sans', sans-serif", minWidth: 600 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: 'left', padding: '9px 14px', minWidth: 230, fontSize: 11 }}>
                Snippet
              </th>
              {bucketKeys.map(key => (
                <th key={key} style={{ ...thStyle, minWidth: gran === 'Week' ? 68 : 80 }}>
                  {bucketHeader(key, gran)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {top10.map((row, rowIdx) => {
              const text     = row[SNIPPET_KEY] ?? ''
              const bucketed = perSnippet[text] || {}
              const vals     = bucketKeys.map(k => bucketed[k] || 0)
              const maxVal   = Math.max(...vals, 1)
              const cat      = categorise(text)
              const catColor = CATEGORY_COLORS[cat] || '#B4B2A9'

              return (
                <tr key={text} style={{ background: rowIdx % 2 === 0 ? '#fff' : '#FAFBFC' }}>
                  {/* Snippet label */}
                  <td style={{ ...tdStyle, textAlign: 'left', padding: '8px 14px', maxWidth: 240 }}>
                    <div
                      style={{ fontSize: 11, color: '#111827', fontWeight: 600, lineHeight: 1.35,
                               overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}
                      title={text}
                    >
                      {text}
                    </div>
                    <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 5, background: catColor + '20', color: catColor, border: `1px solid ${catColor}40`, fontWeight: 700, display: 'inline-block', marginTop: 3 }}>
                      {cat}
                    </span>
                  </td>

                  {/* Heat-map cells */}
                  {vals.map((val, ci) => {
                    const opacity = val > 0 ? 0.15 + (val / maxVal) * 0.65 : 0
                    const bg      = val > 0 ? `${catColor}${Math.round(opacity * 255).toString(16).padStart(2, '0')}` : 'transparent'
                    return (
                      <td key={bucketKeys[ci]} style={{
                        ...tdStyle,
                        background: bg,
                        color: val > 0 ? '#111827' : '#9CA3AF',
                        fontWeight: val > 0 ? 700 : 400,
                        fontSize: 11,
                      }}>
                        {val > 0 ? val.toLocaleString() : '—'}
                      </td>
                    )
                  })}

                  {/* Status badge */}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
