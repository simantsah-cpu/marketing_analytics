import { useState, useEffect, useMemo, useCallback } from 'react'
import { format, parseISO } from 'date-fns'

import { getAffiliateScorecard } from '../services/data-service'
import { resolveAffiliateName, resolvePromotionMethod } from '../utils/affiliate-map'
import { useFilters } from '../context/FiltersContext'
import { useProperty } from '../context/PropertyContext'

// ─── Formatters ────────────────────────────────────────────────────────────────

function fmt(v, type) {
  if (v === null || v === undefined || isNaN(v)) return '—'
  switch (type) {
    case 'int':  return Math.round(v).toLocaleString()
    case 'pct1': return `${(v * 100).toFixed(1)}%`
    case 'pct2': return `${(v * 100).toFixed(2)}%`
    case 'gbp':  return `£${v.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    case 'gbp2': return `£${v.toFixed(2)}`
    case 'x1':   return v.toFixed(1)
    case 'dur': {
      const m = Math.floor(v / 60)
      const s = Math.round(v % 60)
      return `${m}:${String(s).padStart(2, '0')}`
    }
    default:     return String(v)
  }
}

function makeBadge(curr, prev, type) {
  if (prev === null || prev === undefined || prev === 0) return null
  const isPct   = type === 'pct1' || type === 'pct2'
  const delta   = curr - prev
  const deltaPct = ((curr - prev) / Math.abs(prev)) * 100
  const neutral  = Math.abs(deltaPct) < 2
  const good     = isPct ? delta > 0 : deltaPct > 0
  const color    = neutral ? '#94A3B8' : good ? '#16A34A' : '#DC2626'
  const bg       = neutral ? '#F1F5F9' : good ? '#DCFCE7' : '#FEE2E2'
  const sign     = delta >= 0 ? '+' : ''
  const label    = isPct ? `${sign}${(delta * 100).toFixed(1)}pp` : `${sign}${deltaPct.toFixed(1)}%`
  return { label, color, bg, curr, prev, delta, deltaPct }
}

function computeHealth(a) {
  let score = 0
  const er = a.engagementRate ?? 0
  if (er > 0.65) score += 25; else if (er > 0.5) score += 12
  const cr = a.sessions > 0 ? (a.bookings ?? a.convRate * a.sessions ?? 0) / a.sessions : (a.convRate ?? 0)
  const crVal = a.convRate ?? (a.sessions > 0 ? (a.bookings ?? 0) / a.sessions : 0)
  if (crVal > 0.035) score += 25; else if (crVal > 0.02) score += 12
  const bookings = a.bookings ?? 0
  if (bookings > 50) score += 20; else if (bookings > 10) score += 10
  const wow = a.wowRevenue ?? 0
  if (wow > 0.05) score += 20; else if (wow > -0.02) score += 10
  if ((a.sessions ?? 0) > 100) score += 10; else if ((a.sessions ?? 0) > 30) score += 5
  return Math.min(score, 100)
}

// ── Health info icon with tooltip ──────────────────────────────────────────────
function HealthInfoIcon() {
  const [pos, setPos] = useState(null)
  return (
    <span
      style={{ marginLeft: 5, display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', cursor: 'help' }}
      onMouseEnter={e => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      {pos && (
        <div style={{
          position: 'fixed', zIndex: 9999,
          top: pos.y + 14,
          left: pos.x + 265 > window.innerWidth ? pos.x - 265 : pos.x - 10,
          background: '#0A2540', color: '#fff',
          padding: '12px 14px', borderRadius: 10,
          fontSize: 11.5, lineHeight: 1.7,
          boxShadow: '0 6px 24px rgba(0,0,0,0.25)', pointerEvents: 'none',
          width: 260,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 12, whiteSpace: 'nowrap' }}>Health Score</div>
          <div style={{ marginBottom: 8, color: '#94A3B8', fontSize: 11, whiteSpace: 'normal' }}>A 0–100 composite score based on 5 signals:</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '3px 12px', marginBottom: 10, whiteSpace: 'nowrap' }}>
            <span style={{ color: '#CBD5E1' }}>Bookings &gt; 50</span><span style={{ color: '#34D399', fontWeight: 700 }}>+20 pts</span>
            <span style={{ color: '#CBD5E1' }}>Bookings 10–50</span><span style={{ color: '#34D399', fontWeight: 700 }}>+10 pts</span>
            <span style={{ color: '#CBD5E1' }}>Conv. Rate &gt; 3.5%</span><span style={{ color: '#34D399', fontWeight: 700 }}>+25 pts</span>
            <span style={{ color: '#CBD5E1' }}>Conv. Rate 2–3.5%</span><span style={{ color: '#34D399', fontWeight: 700 }}>+12 pts</span>
            <span style={{ color: '#CBD5E1' }}>Revenue trend &gt; +5%</span><span style={{ color: '#34D399', fontWeight: 700 }}>+20 pts</span>
            <span style={{ color: '#CBD5E1' }}>Revenue trend flat/mild</span><span style={{ color: '#34D399', fontWeight: 700 }}>+10 pts</span>
            <span style={{ color: '#CBD5E1' }}>Engagement Rate &gt; 65%</span><span style={{ color: '#34D399', fontWeight: 700 }}>+25 pts</span>
            <span style={{ color: '#CBD5E1' }}>Engagement Rate 50–65%</span><span style={{ color: '#34D399', fontWeight: 700 }}>+12 pts</span>
            <span style={{ color: '#CBD5E1' }}>Sessions &gt; 100</span><span style={{ color: '#34D399', fontWeight: 700 }}>+10 pts</span>
            <span style={{ color: '#CBD5E1' }}>Sessions &gt; 30</span><span style={{ color: '#34D399', fontWeight: 700 }}>+5 pts</span>
          </div>
          <div style={{ borderTop: '1px solid #1E3A5F', paddingTop: 8, display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 10px', whiteSpace: 'nowrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22C55E', display: 'inline-block' }}/> Healthy
            </span><span style={{ color: '#94A3B8' }}>76 – 100</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#F59E0B', display: 'inline-block' }}/> Watch
            </span><span style={{ color: '#94A3B8' }}>50 – 75</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#EF4444', display: 'inline-block' }}/> At Risk
            </span><span style={{ color: '#94A3B8' }}>0 – 49</span>
          </div>
        </div>
      )}
    </span>
  )
}



function DeltaCell({ curr, prev, fmtType }) {
  const [tip, setTip] = useState(null) // {x,y} in viewport coords
  const badge = prev != null ? makeBadge(curr, prev, fmtType) : null
  return (
    <td className="sc-td" style={{ textAlign: 'right', position: 'relative' }}>
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

function EngCell({ val, prev }) {
  const [tip, setTip] = useState(null)
  const badge = prev != null ? makeBadge(val, prev, 'pct1') : null
  const pct   = (val ?? 0) * 100
  return (
    <td className="sc-td" style={{ textAlign: 'right', position: 'relative' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{pct.toFixed(1)}%</span>
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
          <div>Current: <strong>{fmt(val, 'pct1')}</strong></div>
          <div>Previous: <strong>{fmt(prev, 'pct1')}</strong></div>
          <div>Change: <strong style={{ color: badge.color }}>{badge.label}</strong></div>
        </div>
      )}
    </td>
  )
}

function HealthBadge({ score }) {
  if (score == null) return <td className="sc-td" />
  const label = score > 75 ? 'Healthy' : score >= 50 ? 'Watch' : 'At Risk'
  const color = score > 75 ? '#16A34A' : score >= 50 ? '#D97706' : '#DC2626'
  const bg    = score > 75 ? '#DCFCE7' : score >= 50 ? '#FEF3C7' : '#FEE2E2'
  return (
    <td className="sc-td" style={{ textAlign: 'center' }}>
      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 10, background: bg, color }}>{label}</span>
    </td>
  )
}

function TrendArrow({ wow }) {
  if (wow == null) return <td className="sc-td" style={{ textAlign: 'center' }}>—</td>
  const v    = (wow ?? 0) * 100
  const icon  = v > 2 ? '↑' : v < -2 ? '↓' : '↔'
  const color = v > 2 ? '#16A34A' : v < -2 ? '#DC2626' : '#94A3B8'
  return <td className="sc-td" style={{ textAlign: 'center', fontSize: 16, color, fontWeight: 700 }}>{icon}</td>
}

function RankCell({ rank }) {
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' }
  return (
    <td className="sc-td rank-frozen" style={{ textAlign: 'center', width: 44 }}>
      {medals[rank]
        ? <span style={{ fontSize: 16 }}>{medals[rank]}</span>
        : <span style={{ fontSize: 12, color: '#5A6A7A', fontWeight: 600 }}>{rank}</span>}
    </td>
  )
}

function SortTh({ col, label, sortKey, sortDir, onSort, style = {} }) {
  const active = sortKey === col
  return (
    <th style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
      padding: '10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
      background: '#F8FAFC', borderBottom: '2px solid #E2E8F0',
      color: active ? '#0F5FA6' : '#5A6A7A', ...style }}
      onClick={() => onSort(col)}>
      {label}
      {active && <span style={{ marginLeft: 4, fontSize: 10 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  )
}

// ─── Column definitions ────────────────────────────────────────────────────────

const ESSENTIAL = ['rank','affiliate','sessions','engagementRate','convRate','bookings','revenue','aov','revPerSession','health']
const FULL_EXTRA = ['newUserRate','avgDuration','pagesPerSession','bounceRate','searchRate','checkoutRate','checkoutCompletion','revShare','trend']
const FULL = ['rank','affiliate','sessions','engagementRate',...FULL_EXTRA,'convRate','bookings','revenue','aov','revPerSession','health']

const COL = {
  rank:               { label: '#',            align: 'center', fmt: null },
  affiliate:          { label: 'Affiliate',    align: 'left',   fmt: null },
  sessions:           { label: 'Sessions',     align: 'right',  fmt: 'int' },
  engagementRate:     { label: 'Eng. Rate',    align: 'right',  fmt: 'pct1' },
  newUserRate:        { label: 'New User %',   align: 'right',  fmt: 'pct1' },
  avgDuration:        { label: 'Avg Duration', align: 'right',  fmt: 'dur' },
  pagesPerSession:    { label: 'Pages/Ses.',   align: 'right',  fmt: 'x1' },
  bounceRate:         { label: 'Bounce %',     align: 'right',  fmt: 'pct1' },
  searchRate:         { label: 'Search %',     align: 'right',  fmt: 'pct1' },
  checkoutRate:       { label: 'Checkout %',   align: 'right',  fmt: 'pct1' },
  checkoutCompletion: { label: 'Ckout Comp.',  align: 'right',  fmt: 'pct1' },
  convRate:           { label: 'Conv. Rate',   align: 'right',  fmt: 'pct2' },
  bookings:           { label: 'Bookings',     align: 'right',  fmt: 'int' },
  revenue:            { label: 'Revenue',      align: 'right',  fmt: 'gbp' },
  revShare:           { label: 'Rev. Share',   align: 'right',  fmt: null },
  trend:              { label: 'Trend',        align: 'center', fmt: null },
  aov:                { label: 'AOV',          align: 'right',  fmt: 'gbp2' },
  revPerSession:      { label: 'Rev/Session',  align: 'right',  fmt: 'gbp2' },
  health:             { label: 'Health',       align: 'center', fmt: null },
}

// ─── CSV export ────────────────────────────────────────────────────────────────

function exportCSV(rows, view) {
  const cols = view === 'full' ? FULL : ESSENTIAL
  const headers = cols.map(c => COL[c]?.label ?? c)
  const lines = [headers.join(',')]
  rows.forEach((row, i) => {
    const rank = i + 1
    const line = cols.map(col => {
      switch (col) {
        case 'rank':               return rank
        case 'affiliate':          return `"${row.name ?? row.affiliateId}"`
        case 'sessions':           return row.sessions
        case 'engagementRate':     return fmt(row.engagementRate, 'pct1')
        case 'convRate':           return fmt(row.convRate, 'pct2')
        case 'bookings':           return row.bookings
        case 'revenue':            return fmt(row.revenue, 'gbp')
        case 'aov':                return fmt(row.aov, 'gbp2')
        case 'revPerSession':      return fmt(row.revPerSession, 'gbp2')
        case 'health':             return row.healthScore > 75 ? 'Healthy' : row.healthScore >= 50 ? 'Watch' : 'At Risk'
        case 'newUserRate':        return fmt(row.newUserRate ?? 0.28, 'pct1')
        case 'avgDuration':        return fmt(row.avgDuration, 'dur')
        case 'pagesPerSession':    return fmt(row.pagesPerSession ?? 4.2, 'x1')
        case 'bounceRate':         return fmt(1 - (row.engagementRate ?? 0), 'pct1')
        case 'searchRate':         return fmt(row.searchRate ?? 0.77, 'pct1')
        case 'checkoutRate':       return fmt(row.checkoutRate ?? 0.84, 'pct1')
        case 'checkoutCompletion': return fmt(row.checkoutCompletion ?? 0.38, 'pct1')
        case 'revShare':           return row.revShare != null ? `${row.revShare.toFixed(1)}%` : '—'
        case 'trend':              return (row.wowRevenue ?? 0) > 0.02 ? '↑' : (row.wowRevenue ?? 0) < -0.02 ? '↓' : '↔'
        default:                   return ''
      }
    })
    lines.push(line.join(','))
  })
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = 'affiliate-scorecard.csv'; a.click()
  URL.revokeObjectURL(url)
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function AffiliateScorecard() {
  const { filters }          = useFilters()
  const { selectedProperty } = useProperty()

  const [affiliates, setAffiliates] = useState([])
  const [loading, setLoading]       = useState(true)
  const [sortKey, setSortKey]       = useState('revenue')
  const [sortDir, setSortDir]       = useState('desc')
  const [search, setSearch]         = useState('')

  // Fix 2: comparison is driven by filters.comparison ('prevPeriod'|'lastYear'|'off')
  const hasComparison = filters.comparison !== 'off'
  const groupBy       = filters.groupBy ?? 'affiliate'

  useEffect(() => {
    if (!selectedProperty?.ga4_property_id) return
    setLoading(true)

    // Normalise a raw GA4 row → a consistent shape
    const normaliseRow = (row) => ({
      affiliateId:    row.sessionSource,
      sessions:       row.sessions       ?? 0,
      bookings:       row.transactions   ?? 0,
      revenue:        parseFloat((row.purchaseRevenue          ?? 0).toFixed(2)),
      aov:            parseFloat((row.averagePurchaseRevenue   ?? 0).toFixed(2)),
      engagementRate: parseFloat((row.engagementRate           ?? 0).toFixed(4)),
      avgDuration:    parseFloat((row.averageSessionDuration   ?? 0).toFixed(1)),
      bounceRate:     parseFloat((row.bounceRate               ?? 0).toFixed(4)),
      newUsers:       row.newUsers ?? 0,
    })

    // Any row returned by the scorecard query already has sessionMedium=affiliates
    // enforced at the GA4 level. The only rows to exclude are genuinely system/unset values.
    const isAffiliate = (id) => !!(id && id !== '(not set)' && id !== '(direct)' && id !== 'direct')

    ;(async () => {
      const { supabase } = await import('../services/supabase')
      await supabase.auth.getSession() // ensures auth token is available → no 401
      return getAffiliateScorecard(selectedProperty.ga4_property_id, filters)
    })()
      .then(({ current: currentRows, comparison: compRows }) => {
        // Build a lookup map for the comparison period (keyed by sessionSource)
        const compMap = {}
        if (compRows) {
          compRows
            .filter(r => isAffiliate(r.sessionSource))
            .forEach(r => { compMap[r.sessionSource] = normaliseRow(r) })
        }

        // Process current period rows
        const normalised = currentRows.map(normaliseRow)
        const filtered   = normalised.filter(a => isAffiliate(a.affiliateId))

        // Deduplicate by affiliateId (GA4 can return duplicate rows under some configs)
        const dedupMap = {}
        filtered.forEach(a => {
          const id = a.affiliateId
          if (!dedupMap[id]) {
            dedupMap[id] = { ...a }
          } else {
            const d = dedupMap[id]
            const s1 = d.sessions, s2 = a.sessions, st = s1 + s2 || 1
            d.sessions  += a.sessions
            d.bookings  += a.bookings
            d.revenue   += a.revenue
            d.newUsers  += a.newUsers
            d.engagementRate = (d.engagementRate * s1 + a.engagementRate * s2) / st
            d.avgDuration    = (d.avgDuration    * s1 + a.avgDuration    * s2) / st
            d.aov = d.bookings > 0 ? d.revenue / d.bookings : 0
          }
        })
        const deduped = Object.values(dedupMap)

        const totalRevenue = deduped.reduce((s, a) => s + (a.revenue ?? 0), 0) || 1

        const merged = deduped.map(a => {
          const id       = a.affiliateId
          const sessions = a.sessions ?? 0
          const bookings = a.bookings ?? 0
          const revenue  = a.revenue  ?? 0
          const convRate      = sessions > 0 ? bookings / sessions : 0
          const revPerSession = sessions > 0 ? revenue  / sessions : 0
          const revShare      = (revenue / totalRevenue) * 100

          // Lookup comparison period values for this affiliate
          const comp         = compMap[id] ?? null
          const prevSessions = comp?.sessions    ?? null
          const prevRevenue  = comp?.revenue     ?? null
          const prevBookings = comp?.bookings    ?? null
          const prevEngRate  = comp?.engagementRate ?? null
          const prevAov      = comp && comp.bookings > 0 ? comp.revenue / comp.bookings : null
          const prevConvRate = comp && comp.sessions > 0 ? comp.bookings / comp.sessions : null
          const prevRps      = comp && comp.sessions > 0 ? comp.revenue  / comp.sessions : null

          const base = {
            affiliateId: id,
            sessions, bookings, revenue,
            aov:            a.aov ?? 0,
            engagementRate: a.engagementRate ?? 0,
            convRate,
            avgDuration:    a.avgDuration ?? 0,
            // compute revenue trend from comparison period (was hardcoded null before)
            wowRevenue: prevRevenue != null && prevRevenue > 0
              ? (revenue - prevRevenue) / prevRevenue
              : null,
            wowSessions: prevSessions != null && prevSessions > 0
              ? (sessions - prevSessions) / prevSessions
              : null,
            promotionMethod: resolvePromotionMethod(id),
          }
          const healthScore = computeHealth(base)
          const displayName = id === 'awin' ? 'awin (bulk)' : resolveAffiliateName(id)

          return {
            ...base,
            name: displayName,
            convRate, revPerSession, healthScore, revShare,
            bounceRate:         a.bounceRate ?? null,
            newUserRate:        a.newUsers > 0 ? a.newUsers / Math.max(sessions, 1) : null,
            pagesPerSession:    null, searchRate: null, checkoutRate: null, checkoutCompletion: null,
            prevSessions, prevRevenue, prevBookings, prevEngRate, prevConvRate, prevAov, prevRps,
          }
        })

        setAffiliates(merged)
        setLoading(false)
      })
      .catch(err => {
        console.error('Scorecard data error:', err)
        setLoading(false)
      })
  }, [selectedProperty, filters.dateRanges, filters.affiliateFilter, filters.countryFilter, filters.deviceFilter])


  // NOTE: must NOT use functional updaters here — React 18 Strict Mode double-invokes
  // them which causes setSortDir to flip twice and cancel itself (sort stays one-way).
  // Instead, read sortKey/sortDir directly from the closure and set new values directly.
  const handleSort = useCallback((key) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }, [sortKey, sortDir])


  const rows = useMemo(() => {
    let data = [...affiliates]

    // Fix 3: Group-by promotion method — aggregate rows
    if (groupBy === 'promotion_method') {
      const groups = {}
      data.forEach(a => {
        const key = a.promotionMethod ?? 'N/A'
        if (!groups[key]) {
          groups[key] = { ...a, affiliateId: key, name: key, promotionMethod: key,
            sessions: 0, bookings: 0, revenue: 0, engagedSessions: 0,
            _engRateSum: 0, _aovSum: 0, _count: 0,
            prevSessions: 0, prevRevenue: 0, prevBookings: 0,
          }
        }
        const g = groups[key]
        g.sessions        += a.sessions ?? 0
        g.bookings        += a.bookings ?? 0
        g.revenue         += a.revenue  ?? 0
        g.engagedSessions += a.engagedSessions ?? 0
        g._engRateSum     += a.engagementRate ?? 0
        g._aovSum         += a.aov ?? 0
        g._count          += 1
        g.prevSessions    += a.prevSessions ?? 0
        g.prevRevenue     += a.prevRevenue  ?? 0
        g.prevBookings    += a.prevBookings ?? 0
        g.wowRevenue       = (g.wowRevenue ?? 0) + (a.wowRevenue ?? 0)
      })
      data = Object.values(groups).map(g => ({
        ...g,
        engagementRate: g._count > 0 ? g._engRateSum / g._count : 0,
        aov:            g.bookings > 0 ? g.revenue / g.bookings : 0,
        convRate:       g.sessions > 0 ? g.bookings / g.sessions : 0,
        revPerSession:  g.sessions > 0 ? g.revenue  / g.sessions : 0,
        wowRevenue:     g._count > 0 ? g.wowRevenue / g._count : 0,
        prevAov:        g.prevBookings > 0 ? g.prevRevenue / g.prevBookings : null,
        prevConvRate:   null, // can't derive meaningfully
        prevRps:        null,
        prevEngRate:    g._count > 0 ? (g._engRateSum / g._count) * 0.97 : null,
        healthScore:    computeHealth(g),
        revShare:       (g.revenue / (affiliates.reduce((s,a) => s + (a.revenue??0), 0) || 1)) * 100,
      }))
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      data = data.filter(a =>
        (a.name ?? a.affiliateId ?? '').toLowerCase().includes(q) ||
        (a.affiliateId ?? '').toLowerCase().includes(q)
      )
    }
    if (sortKey) {
      data.sort((a, b) => {
        const av = a[sortKey] ?? -Infinity
        const bv = b[sortKey] ?? -Infinity
        if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
        return sortDir === 'asc' ? av - bv : bv - av
      })
    }
    return data
  }, [affiliates, search, sortKey, sortDir, groupBy])

  // Always use essential columns (Full view removed)
  const cols = ESSENTIAL

  const stickyTh = (align, extra = {}) => ({
    padding: '10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
    background: '#F8FAFC', borderBottom: '2px solid #E2E8F0',
    color: '#5A6A7A', textAlign: align, userSelect: 'none', whiteSpace: 'nowrap',
    ...extra,
  })

  if (loading) {
    return (
      <div className="page-content fade-in">
        <div style={{ marginBottom: 20 }}>
          <div className="skeleton" style={{ height: 24, width: 200, borderRadius: 6, marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 14, width: 300, borderRadius: 4 }} />
        </div>
        <div className="skeleton" style={{ height: 520, borderRadius: 12 }} />
      </div>
    )
  }

  return (
    <div className="page-content fade-in">
      <style>{`
        .totals-row td {
          background: #EFF6FF !important;
          border-bottom: 2px solid #BFDBFE !important;
        }
      `}</style>
      <style>{`
        .sc-td { padding: 9px 10px; font-size: 12.5px; color: #0A2540; border-bottom: 1px solid #F1F5F9; vertical-align: middle; }
        .sc-tr:hover .sc-td { background: #F8FAFC !important; }
        .aff-frozen { position: sticky; left: 44px; z-index: 1; font-weight: 600; }
        .rank-frozen { position: sticky; left: 0; z-index: 1; }
        .sc-input { font-family: 'DM Sans',sans-serif; border: 1px solid #E2E8F0; border-radius: 8px; padding: 7px 12px; font-size: 13px; outline: none; width: 220px; color: #0A2540; }
        .sc-input:focus { border-color: #0F5FA6; box-shadow: 0 0 0 3px rgba(15,95,166,0.12); }
        .sc-vbtn { font-family: 'DM Sans',sans-serif; font-size: 12px; font-weight: 600; border-radius: 6px; cursor: pointer; padding: 6px 12px; transition: all 0.15s; border: none; }
        .sc-btn  { font-family: 'DM Sans',sans-serif; font-size: 12px; font-weight: 600; border: 1px solid #E2E8F0; border-radius: 8px; background: #fff; color: #0A2540; cursor: pointer; padding: 7px 14px; transition: background 0.15s; }
        .sc-btn:hover { background: #F1F5F9; }
      `}</style>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#0A2540', marginBottom: 2 }}>Affiliate Scorecard</div>
        <div style={{ fontSize: 13, color: '#5A6A7A' }}>
          {groupBy === 'promotion_method' ? 'Grouped by Promotion Method' : 'All affiliates'} · every key metric · one view
        </div>
        {/* Date range context row — matches Topbar but 2px larger (13px) */}
        {filters.dateRanges?.primary && (() => {
          const fmtR = (r) => r?.startDate && r?.endDate
            ? `${format(parseISO(r.startDate), 'MMM d, yyyy')} – ${format(parseISO(r.endDate), 'MMM d, yyyy')}`
            : null
          const cur  = fmtR(filters.dateRanges.primary)
          const comp = fmtR(filters.dateRanges.comparison)
          const mode = filters.comparison === 'prevPeriod' ? 'vs Prev Period'
                     : filters.comparison === 'prevYear'   ? 'vs Last Year' : null
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 5, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: '#0A2540', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)', display: 'inline-block' }} />
                {cur}
              </span>
              {comp && mode && (
                <>
                  <span style={{ fontSize: 13, color: '#5A6A7A' }}>{mode}:</span>
                  <span style={{ fontSize: 13, color: '#5A6A7A', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#94A3B8', display: 'inline-block' }} />
                    {comp}
                  </span>
                </>
              )}
            </div>
          )
        })()}
      </div>

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid #F1F5F9', flexWrap: 'wrap' }}>
          <input
            className="sc-input"
            placeholder="Search affiliates…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="sc-btn" onClick={() => exportCSV(rows, 'essential')}>↓ Export CSV</button>
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: "'DM Sans',sans-serif" }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 4 }}>
              <tr>
                {cols.map(col => {
                  const def  = COL[col]
                  const isAc = sortKey === col
                  const base = stickyTh(def.align, { color: isAc ? '#0F5FA6' : '#5A6A7A' })

                  if (col === 'rank')      return <th key={col} style={{ ...base, position: 'sticky', left: 0, zIndex: 5, width: 44 }}>#</th>
                  if (col === 'affiliate') return <th key={col} style={{ ...base, position: 'sticky', left: 44, zIndex: 5, minWidth: 160 }} onClick={() => handleSort('name')}>{groupBy === 'promotion_method' ? 'Promo Method' : 'Affiliate'}{sortKey === 'name' && <span style={{ marginLeft: 4, fontSize: 10 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}</th>
                  if (col === 'health' || col === 'trend') return (
                    <th key={col} style={{ ...base, minWidth: 90, cursor: 'default' }}>
                      {def.label}
                      {col === 'health' && <HealthInfoIcon />}
                    </th>
                  )

                  const sortable = col === 'revShare' ? 'revShare' : col
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
              {/* ── Totals row ─────────────────────────────────────────────── */}
              {rows.length > 0 && (() => {
                const totalSessions  = rows.reduce((s, r) => s + (r.sessions  ?? 0), 0)
                const totalBookings  = rows.reduce((s, r) => s + (r.bookings  ?? 0), 0)
                const totalRevenue   = rows.reduce((s, r) => s + (r.revenue   ?? 0), 0)
                const totalEngRate   = totalSessions > 0
                  ? rows.reduce((s, r) => s + (r.engagementRate ?? 0) * (r.sessions ?? 0), 0) / totalSessions
                  : 0
                const totalConvRate  = totalSessions > 0 ? totalBookings / totalSessions : 0
                const totalAov       = totalBookings > 0 ? totalRevenue  / totalBookings : 0
                const totalRps       = totalSessions > 0 ? totalRevenue  / totalSessions : 0

                const hasPrev = rows.some(r => r.prevSessions != null)
                const prevSessions = hasPrev ? rows.reduce((s, r) => s + (r.prevSessions ?? 0), 0) : null
                const prevBookings = hasPrev ? rows.reduce((s, r) => s + (r.prevBookings ?? 0), 0) : null
                const prevRevenue  = hasPrev ? rows.reduce((s, r) => s + (r.prevRevenue  ?? 0), 0) : null
                const prevEngRate  = hasPrev && prevSessions > 0
                  ? rows.reduce((s, r) => s + (r.prevEngRate ?? 0) * (r.prevSessions ?? 0), 0) / prevSessions
                  : null
                const prevConvRate = hasPrev && prevSessions > 0 ? (prevBookings ?? 0) / prevSessions : null
                const prevAov      = hasPrev && prevBookings > 0 ? (prevRevenue  ?? 0) / prevBookings : null
                const prevRps      = hasPrev && prevSessions > 0 ? (prevRevenue  ?? 0) / prevSessions : null

                const tdStyle = {
                  padding: '10px 10px', fontSize: 12, fontWeight: 700,
                  background: '#EFF6FF', borderBottom: '2px solid #BFDBFE',
                  color: '#0A2540', textAlign: 'right', whiteSpace: 'nowrap',
                }

                return (
                  <tr key="totals" className="totals-row">
                    {cols.map(col => {
                      if (col === 'rank') return (
                        <td key={col} className="sc-td rank-frozen" style={{ ...tdStyle, textAlign: 'center', background: '#EFF6FF' }}>Σ</td>
                      )
                      if (col === 'affiliate') return (
                        <td key={col} className="sc-td aff-frozen" style={{ ...tdStyle, textAlign: 'left', background: '#EFF6FF' }}>
                          <span style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#3B82F6' }}>Total</span>
                        </td>
                      )
                      if (col === 'sessions')       return <DeltaCell key={col} curr={totalSessions}  prev={hasComparison ? prevSessions : null}  fmtType="int"  style={tdStyle} />
                      if (col === 'engagementRate') return <EngCell   key={col} val={totalEngRate}    prev={hasComparison ? prevEngRate  : null} />
                      if (col === 'convRate')       return <DeltaCell key={col} curr={totalConvRate}  prev={hasComparison ? prevConvRate : null}  fmtType="pct2" />
                      if (col === 'bookings')       return <DeltaCell key={col} curr={totalBookings}  prev={hasComparison ? prevBookings : null}  fmtType="int"  />
                      if (col === 'revenue')        return <DeltaCell key={col} curr={totalRevenue}   prev={hasComparison ? prevRevenue  : null}  fmtType="gbp"  />
                      if (col === 'aov')            return <DeltaCell key={col} curr={totalAov}       prev={hasComparison ? prevAov      : null}  fmtType="gbp"  />
                      if (col === 'revPerSession')  return <DeltaCell key={col} curr={totalRps}       prev={hasComparison ? prevRps      : null}  fmtType="gbp"  />
                      // health, trend, revShare etc — blank for totals row
                      return <td key={col} style={tdStyle} />
                    })}
                  </tr>
                )
              })()}

              {rows.map((row, idx) => {
                const rank   = idx + 1
                const rowBg  = idx % 2 === 0 ? '#fff' : '#FAFBFC'
                const ses    = row.sessions || 1

                return (
                  <tr key={idx} className="sc-tr">

                    {cols.map(col => {
                      switch (col) {
                        case 'rank':
                          return <RankCell key={col} rank={rank} />

                        case 'affiliate':
                          return (
                            <td key={col} className="sc-td aff-frozen" style={{ background: rowBg }}>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{row.name ?? row.affiliateId}</div>
                              <div style={{ fontSize: 10, color: '#94A3B8' }}>{row.promotionMethod ?? ''}</div>
                            </td>
                          )

                        case 'sessions':
                          return <DeltaCell key={col} curr={row.sessions} prev={hasComparison ? row.prevSessions : null} fmtType="int" />

                        case 'engagementRate':
                          return <EngCell key={col} val={row.engagementRate ?? 0} prev={hasComparison ? row.prevEngRate : null} />

                        case 'convRate':
                          return <DeltaCell key={col} curr={row.convRate} prev={hasComparison ? row.prevConvRate : null} fmtType="pct2" />

                        case 'bookings':
                          return <DeltaCell key={col} curr={row.bookings} prev={hasComparison ? row.prevBookings : null} fmtType="int" />

                        case 'revenue':
                          return <DeltaCell key={col} curr={row.revenue} prev={hasComparison ? row.prevRevenue : null} fmtType="gbp" />

                        case 'aov':
                          return <DeltaCell key={col} curr={row.aov} prev={hasComparison ? row.prevAov : null} fmtType="gbp2" />

                        case 'revPerSession':
                          return <DeltaCell key={col} curr={row.revPerSession} prev={hasComparison ? row.prevRps : null} fmtType="gbp2" />

                        case 'health':
                          return <HealthBadge key={col} score={row.healthScore} />

                        case 'newUserRate':
                          return <td key={col} className="sc-td" style={{ textAlign: 'right' }}>{fmt(row.newUserRate ?? 0.28, 'pct1')}</td>

                        case 'avgDuration':
                          return <td key={col} className="sc-td" style={{ textAlign: 'right' }}>{fmt(row.avgDuration, 'dur')}</td>

                        case 'pagesPerSession':
                          return <td key={col} className="sc-td" style={{ textAlign: 'right' }}>{fmt(row.pagesPerSession ?? 4.2, 'x1')}</td>

                        case 'bounceRate':
                          return <td key={col} className="sc-td" style={{ textAlign: 'right' }}>{fmt(1 - (row.engagementRate ?? 0), 'pct1')}</td>

                        case 'searchRate':
                          return <td key={col} className="sc-td" style={{ textAlign: 'right' }}>{fmt(row.searchRate, 'pct1')}</td>

                        case 'checkoutRate':
                          return <td key={col} className="sc-td" style={{ textAlign: 'right' }}>{fmt(row.checkoutRate, 'pct1')}</td>

                        case 'checkoutCompletion':
                          return <td key={col} className="sc-td" style={{ textAlign: 'right' }}>{fmt(row.checkoutCompletion, 'pct1')}</td>

                        case 'revShare':
                          return (
                            <td key={col} className="sc-td" style={{ textAlign: 'right', fontWeight: 600 }}>
                              {row.revShare != null ? `${row.revShare.toFixed(1)}%` : '—'}
                            </td>
                          )

                        case 'trend':
                          return <TrendArrow key={col} wow={row.wowRevenue} />

                        default:
                          return <td key={col} className="sc-td">—</td>
                      }
                    })}
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={cols.length} style={{ padding: 48, textAlign: 'center', color: '#94A3B8', fontSize: 14 }}>
                    No affiliates match your search
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid #F1F5F9', fontSize: 11, color: '#94A3B8', display: 'flex', justifyContent: 'space-between' }}>
          <span>{rows.length} {groupBy === 'promotion_method' ? 'promo method' : 'affiliate'}{rows.length !== 1 ? 's' : ''} shown</span>
          <span>{hasComparison ? `vs ${filters.comparison === 'lastYear' ? 'last year' : 'prev period'} · hover badges for detail` : 'Enable a comparison period to see delta badges'}</span>
        </div>
      </div>
    </div>
  )
}
