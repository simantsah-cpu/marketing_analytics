/**
 * RankingsTab.jsx — Page 7: Airport Rankings
 *
 * 100% client-side computation — NO new queries.
 * Uses the exact same functions and data as OverviewTab:
 *   sumGA4, sumOps, hasOpsData, AP_ROSTER, GA4_S, GA4_E, OPS_S, OPS_E, MIG_S, MIG_E
 *
 * Brief rules enforced:
 *   - Seven metrics in fixed order (§2)
 *   - Scaled volume floors per window length (§3) — FLOORS ARE THE POINT
 *   - Per-source validity: ga4 metrics need cf>=GA4_S; ops metrics need cf>=OPS_S and no migration (§4)
 *   - Asymmetric validity: Q2+YoY gives valid movement for ops but "no basis" for ga4 (K3)
 *   - rankMap: NO tie-sharing, stable sort (§5)
 *   - Climbers/fallers: top-150 filter in at least one window (§5)
 *   - Cancellation rate: ascending, inverted movement coloring (§2)
 *   - "new" = below floor or zero in comparison window (§5, §8)
 *   - Global time bar only — no local timeframe control (§8 rule 1)
 *   - Cross-metric consistency with Overview: same functions, same data (§8 last rule)
 *   - R4: Web bookings, never "transactions"
 */

import { useState, useMemo, memo } from 'react'
import { AP_ROSTER } from '../data/overviewRoster.js'
import { AP_GA4 } from '../data/overviewGa4.js'
import { AP_OPS } from '../data/overviewOps.js'

// ─── Constants (identical to OverviewTab — one truth) ─────────────────────────
const BASE = new Date('2024-06-01T00:00:00Z')
const GA4_S = 382   // 2025-06-16
const GA4_E = 767   // 2026-07-08
const OPS_S = 304   // 2025-04-01
const OPS_E = 768   // 2026-07-09
const MIG_S = 245   // 2025-02-01
const MIG_E = 303   // 2025-03-31

// ─── Parse caches (shared with OverviewTab via module scope) ──────────────────
// We re-declare to be self-contained, but the browser will share the same
// AP_GA4/AP_OPS objects from the same imported modules.
const _ga4Cache = {}
const _opsCache = {}

function getGA4(cd) {
  if (_ga4Cache[cd] !== undefined) return _ga4Cache[cd]
  const raw = AP_GA4[cd]
  if (!raw) { _ga4Cache[cd] = {}; return {} }
  const m = {}
  raw.split('|').forEach(seg => {
    const p = seg.split(':')
    const o = +p[0]
    m[o] = [+p[1]||0, p[2]!=null?+p[2]:0, p[3]!=null?+p[3]:0]
  })
  _ga4Cache[cd] = m; return m
}

function getOps(cd) {
  if (_opsCache[cd] !== undefined) return _opsCache[cd]
  const raw = AP_OPS[cd]
  if (!raw) { _opsCache[cd] = {}; return {} }
  const m = {}
  raw.split('|').forEach(seg => {
    const p = seg.split(':')
    m[+p[0]] = [+p[1]||0, +p[2]||0, +p[3]||0]
  })
  _opsCache[cd] = m; return m
}

function sumGA4(cd, f, t) {
  const lo = Math.max(f, GA4_S), hi = Math.min(t, GA4_E)
  let s=0, p=0, r=0
  if (lo > hi) return { s:0, p:0, r:0 }
  const m = getGA4(cd)
  for (let o=lo; o<=hi; o++) { const d=m[o]; if(!d) continue; s+=d[0]; p+=d[1]; r+=d[2] }
  return { s, p, r }
}

function sumOps(cd, f, t) {
  const lo = Math.max(f, OPS_S), hi = Math.min(t, OPS_E)
  let b=0, c=0, tn=0
  if (lo > hi) return { b:0, c:0, tn:0 }
  const m = getOps(cd)
  for (let o=lo; o<=hi; o++) { const d=m[o]; if(!d) continue; b+=d[0]; c+=d[1]; tn+=d[2] }
  return { b, c, tn }
}

function hasOpsData(cd, f, t) {
  const lo=Math.max(f,OPS_S), hi=Math.min(t,OPS_E)
  if (lo>hi) return false
  const m=getOps(cd)
  for(let o=lo;o<=hi;o++) { if(m[o]) return true }
  return false
}

function dayOffset(dateStr) {
  return Math.round((new Date(dateStr + 'T00:00:00Z') - BASE) / 86400000)
}

function overlaps(a1,a2,b1,b2){ return a1<=b2 && a2>=b1 }

// ─── Per-metric validity for the comparison window ───────────────────────────
// Returns { ga4Valid, opsValid }
function cmpValidity(cf, ct) {
  const ga4Valid = cf >= GA4_S && ct <= GA4_E + 400 // future-proof
  const opsValid = cf >= OPS_S && !overlaps(cf, ct, MIG_S, MIG_E)
  return { ga4Valid, opsValid }
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  pine: '#0A2540', leaf: '#0D8A72', ink: '#1A2B3C', inkSoft: '#5A6A7A',
  paper: '#F8FAFC', card: '#FFFFFF', line: '#E2EAF0', prior: '#0F5FA6',
  amber: '#D97706', coral: '#C0392B',
  leafLight: '#E6F5F2', coralLight: '#FDEDEB', grey: '#E2EAF0',
  amberLight: '#FDF4E3',
}

// ─── Seven metrics (§2 fixed order) ──────────────────────────────────────────
const METRICS = [
  { id: 'b',   name: 'Ops net bookings', source: 'ops', asc: false },
  { id: 'tn',  name: 'Ops net TTV',      source: 'ops', asc: false },
  { id: 's',   name: 'Searches',         source: 'ga4', asc: false },
  { id: 'p',   name: 'Web bookings',     source: 'ga4', asc: false },  // R4: never "transactions"
  { id: 'r',   name: 'Web revenue',      source: 'ga4', asc: false },
  { id: 's2b', name: 'S→B conversion',   source: 'ga4', asc: false },
  { id: 'cr',  name: 'Cancellation rate',source: 'ops', asc: true  },  // lower = better
]

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtN(n) {
  if (n==null||isNaN(n)) return '–'
  const a=Math.abs(n), sg=n<0?'-':''
  if(a>=1e6) return sg+(a/1e6).toFixed(1)+'M'
  if(a>=1e4) return sg+Math.round(a/1e3)+'K'
  if(a>=1e3) return sg+(a/1e3).toFixed(1)+'K'
  return sg+Math.round(n).toLocaleString('en-GB')
}
function fmtGBP(n) {
  if(n==null||isNaN(n)) return '–'
  const a=Math.abs(n), sg=n<0?'-':''
  if(a>=1e6) return sg+'£'+(a/1e6).toFixed(2)+'M'
  if(a>=1e3) return sg+'£'+Math.round(a/1e3)+'K'
  return sg+'£'+Math.round(n).toLocaleString()
}
function fmtPct(n, dp=1) { return n==null||!isFinite(n) ? '–' : n.toFixed(dp)+'%' }

function fmtVal(metricId, v) {
  if (v==null) return '–'
  switch(metricId) {
    case 'b':   return fmtN(v)
    case 'tn':  return fmtGBP(v)
    case 's':   return fmtN(v)
    case 'p':   return fmtN(v)
    case 'r':   return fmtGBP(v)
    case 's2b': return fmtPct(v, 2)
    case 'cr':  return fmtPct(v, 1)
    default:    return String(v)
  }
}

// ─── Compute value for one airport, one window, one metric ───────────────────
// dayCount = t - f + 1
function computeValue(metricId, cd, f, t, dayCount) {
  const sMin = Math.max(50, dayCount * 12)          // S→B floor, scaled
  const bMin = Math.max(5, Math.round(dayCount * 1.2))  // cr floor, scaled

  switch(metricId) {
    case 'b': {
      if (!hasOpsData(cd, f, t)) return null
      const o = sumOps(cd, f, t)
      const net = o.b - o.c
      return net > 0 ? net : null
    }
    case 'tn': {
      if (!hasOpsData(cd, f, t)) return null
      const o = sumOps(cd, f, t)
      return o.tn > 0 ? o.tn : null
    }
    case 's': {
      const g = sumGA4(cd, f, t)
      return g.s > 0 ? g.s : null
    }
    case 'p': {
      const g = sumGA4(cd, f, t)
      return g.p > 0 ? g.p : null
    }
    case 'r': {
      const g = sumGA4(cd, f, t)
      return g.r > 0 ? g.r : null
    }
    case 's2b': {
      const g = sumGA4(cd, f, t)
      if (g.s < sMin) return null   // floor not cleared → UNRANKED
      return g.s > 0 ? g.p / g.s * 100 : null
    }
    case 'cr': {
      if (!hasOpsData(cd, f, t)) return null
      const o = sumOps(cd, f, t)
      if (o.b < bMin) return null   // floor not cleared → UNRANKED
      // 0% is a legitimate best value — do NOT filter to > 0
      return o.b > 0 ? o.c / o.b * 100 : null
    }
    default: return null
  }
}

// ─── rankMap: stable sort, no tie-sharing (§5) ───────────────────────────────
function rankMap(metricId, codes, f, t, dayCount) {
  const metric = METRICS.find(m => m.id === metricId)
  const list = []
  for (const cd of codes) {
    const v = computeValue(metricId, cd, f, t, dayCount)
    if (v == null) continue
    list.push({ cd, v })
  }
  // Sort: asc for cr, desc for all others
  list.sort((a, b) => metric.asc ? a.v - b.v : b.v - a.v)
  // Build rank map: cd -> { rank, v }
  const map = {}
  list.forEach((item, i) => { map[item.cd] = { rank: i + 1, v: item.v } })
  return map
}

// ─── Movement cell ────────────────────────────────────────────────────────────
function MoveCell({ delta, isNew, cmpValid }) {
  if (!cmpValid) return <span style={{color:T.inkSoft,fontSize:11}}>–</span>
  if (isNew) return <span style={{color:T.inkSoft,fontSize:11,fontWeight:600}}>new</span>
  if (delta == null) return <span style={{color:T.inkSoft,fontSize:11}}>–</span>
  if (delta === 0) return <span style={{color:T.inkSoft,fontSize:11,fontWeight:600}}>→ 0</span>
  const up = delta > 0  // delta = rp - rc; positive = climbed
  return (
    <span style={{
      fontSize:11, fontWeight:700,
      color: up ? '#0A7A52' : T.coral,
    }}>
      {up ? '▲' : '▼'} {Math.abs(delta)}
    </span>
  )
}

// ─── ValidChip ────────────────────────────────────────────────────────────────
function ValidChip({ ok, label }) {
  return (
    <span style={{
      fontSize:9, fontWeight:700, padding:'2px 8px', borderRadius:10,
      background: ok ? T.leafLight : T.grey,
      color: ok ? '#0A7A52' : T.inkSoft,
      border: ok ? `1px solid rgba(20,160,107,.4)` : `1px solid ${T.line}`,
      marginLeft: 6, verticalAlign: 'middle',
    }}>
      {label}
    </span>
  )
}

// ─── CC flag ─────────────────────────────────────────────────────────────────
const FLAGS = {ES:'🇪🇸',GB:'🇬🇧',UK:'🇬🇧',DE:'🇩🇪',FR:'🇫🇷',IT:'🇮🇹',PT:'🇵🇹',GR:'🇬🇷',TR:'🇹🇷',NL:'🇳🇱',BE:'🇧🇪',CH:'🇨🇭',AT:'🇦🇹',PL:'🇵🇱',HU:'🇭🇺',HR:'🇭🇷',TN:'🇹🇳',MA:'🇲🇦',EG:'🇪🇬',AE:'🇦🇪',QA:'🇶🇦',OM:'🇴🇲',SA:'🇸🇦',IN:'🇮🇳',TH:'🇹🇭',SG:'🇸🇬',JP:'🇯🇵',AU:'🇦🇺',US:'🇺🇸',CA:'🇨🇦',MX:'🇲🇽',BR:'🇧🇷',MU:'🇲🇺',MV:'🇲🇻',JM:'🇯🇲',KE:'🇰🇪',ZA:'🇿🇦',LK:'🇱🇰',IE:'🇮🇪',MT:'🇲🇹',CY:'🇨🇾',IS:'🇮🇸',NO:'🇳🇴',SE:'🇸🇪',FI:'🇫🇮',DK:'🇩🇰',RU:'🇷🇺',CN:'🇨🇳',ID:'🇮🇩',MY:'🇲🇾',PH:'🇵🇭',HK:'🇭🇰',LB:'🇱🇧',JO:'🇯🇴',KW:'🇰🇼',BH:'🇧🇭',VN:'🇻🇳',RS:'🇷🇸',BA:'🇧🇦',BG:'🇧🇬',RO:'🇷🇴',SK:'🇸🇰',SI:'🇸🇮',LV:'🇱🇻',LT:'🇱🇹',EE:'🇪🇪',GE:'🇬🇪',AM:'🇦🇲',AZ:'🇦🇿',GI:'🇬🇮',FO:'🇫🇴',CV:'🇨🇻',SC:'🇸🇨',NZ:'🇳🇿',TW:'🇹🇼',BB:'🇧🇧',LC:'🇱🇨',DO:'🇩🇴',TC:'🇹🇨',KR:'🇰🇷',NC:'🇳🇨',PF:'🇵🇫',ME:'🇲🇪',MK:'🇲🇰',AL:'🇦🇱',CZ:'🇨🇿',CW:'🇨🇼',}
const flag = cc => FLAGS[cc] || ''

// ─── Main exported component ──────────────────────────────────────────────────
export default function RankingsTab({ timeRange, cmpRange, durDays, tfLabel }) {
  const [metricId, setMetricId] = useState('b') // default: Ops net bookings

  const { s, e } = timeRange || { s: '2026-06-29', e: '2026-07-05' }
  const fo = dayOffset(s), to = dayOffset(e)
  const cf = cmpRange ? dayOffset(cmpRange.s) : null
  const ct = cmpRange ? dayOffset(cmpRange.e) : null
  const hasCmp = cf != null && ct != null
  const dayCount = to - fo + 1
  const cmpDayCount = hasCmp ? (ct - cf + 1) : dayCount

  // Per-metric comparison validity (§4 asymmetric logic)
  const { ga4Valid, opsValid } = hasCmp
    ? cmpValidity(cf, ct)
    : { ga4Valid: false, opsValid: false }

  const metric = METRICS.find(m => m.id === metricId)
  const cmpValid = hasCmp && (metric.source === 'ga4' ? ga4Valid : opsValid)

  // All airport codes
  const codes = useMemo(() => Object.keys(AP_ROSTER), [])

  // Compute current and comparison rank maps
  const curRank = useMemo(
    () => rankMap(metricId, codes, fo, to, dayCount),
    [metricId, codes, fo, to, dayCount]
  )

  const prvRank = useMemo(
    () => hasCmp && cmpValid
      ? rankMap(metricId, codes, cf, ct, cmpDayCount)
      : null,
    [metricId, codes, cf, ct, cmpDayCount, hasCmp, cmpValid]
  )

  // Full ranked list (sorted by current rank)
  const rankedList = useMemo(() => {
    return Object.entries(curRank)
      .map(([cd, { rank, v }]) => {
        const prv = prvRank?.[cd]
        const delta = (cmpValid && prv != null) ? prv.rank - rank : null  // positive = climbed
        const isNew = cmpValid && prv == null
        return {
          cd,
          nm: AP_ROSTER[cd]?.nm || cd,
          cc: AP_ROSTER[cd]?.cc || '',
          rank, v,
          prvRank: prv?.rank ?? null,
          prvV: prv?.v ?? null,
          delta,
          isNew,
        }
      })
      .sort((a, b) => a.rank - b.rank)
  }, [curRank, prvRank, cmpValid])

  // Climbers and fallers (§5 rules)
  // Only airports ranked in BOTH windows AND in top 150 in at least one
  const { climbers, fallers } = useMemo(() => {
    if (!cmpValid || !prvRank) return { climbers: [], fallers: [] }
    const both = rankedList.filter(r =>
      r.delta != null &&
      !r.isNew &&
      (r.rank <= 150 || (r.prvRank != null && r.prvRank <= 150))
    )
    const climbers = [...both].sort((a, b) => b.delta - a.delta).slice(0, 8)
    const fallers  = [...both].sort((a, b) => a.delta - b.delta).slice(0, 8)
    return { climbers, fallers }
  }, [rankedList, cmpValid, prvRank])

  const cmpLabel = cmpRange?.label || 'comparison'

  // Metric-specific note line (§6)
  const metricNote = metricId === 'cr'
    ? 'Lower is better · volume floor applies. "new" = unranked in the comparison window.'
    : metricId === 's2b'
      ? 'Search floor applies. "new" = unranked in the comparison window.'
      : '"new" = below floor or zero in the comparison window.'

  const noBasisMsg = 'Pick a comparison the data can honestly support (chips in the green bar).'

  return (
    <div style={{ padding: '0 0 32px' }}>
      {/* Header */}
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontFamily: 'Georgia,serif', fontSize: 20, fontWeight: 700, color: T.ink, margin: '0 0 4px' }}>
          Airport rankings
        </h2>
        <div style={{ fontSize: 11, color: T.inkSoft }}>
          Any metric × the timeframe above · ▲▼ = rank movement vs your comparison · #1 = best (cancellation ranks lowest-first).
        </div>
      </div>

      {/* Metric selector (§6 toolbar) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', background: T.grey, borderRadius: 10, padding: 3, flexWrap: 'wrap', gap: 0 }}>
          {METRICS.map(m => (
            <button key={m.id} onClick={() => setMetricId(m.id)}
              style={{
                padding: '6px 13px', borderRadius: 8, border: 'none', fontSize: 11,
                fontWeight: metricId === m.id ? 700 : 500, cursor: 'pointer',
                transition: 'all .15s',
                background: metricId === m.id ? T.card : 'transparent',
                color: metricId === m.id ? T.pine : T.inkSoft,
                boxShadow: metricId === m.id ? '0 1px 4px rgba(0,0,0,.12)' : 'none',
              }}>
              {m.name}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: T.inkSoft, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <span><strong style={{ color: T.ink }}>{metric.name}</strong> in {tfLabel}</span>
          {hasCmp && (
            <span>· movement vs {cmpLabel}
              <ValidChip ok={cmpValid} label={cmpValid ? 'valid' : 'no basis'} />
            </span>
          )}
        </div>
      </div>

      {/* (a) Climbers / Fallers — §5 §6 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <ClimbCard
          title="Biggest climbers"
          subtitle={cmpValid
            ? `Rank gained vs ${cmpLabel} (within top 150)`
            : noBasisMsg}
          rows={climbers}
          metricId={metricId}
          isValid={cmpValid}
        />
        <ClimbCard
          title="Biggest fallers"
          subtitle={cmpValid
            ? `Rank lost vs ${cmpLabel} (within top 150)`
            : noBasisMsg}
          rows={fallers}
          metricId={metricId}
          isValid={cmpValid}
          isFallers
        />
      </div>

      {/* (b) Full ranking table — §6 */}
      <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.line}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>
            Full ranking — {metric.name}, {tfLabel}
            <span style={{ fontSize: 11, fontWeight: 400, color: T.inkSoft, marginLeft: 8 }}>
              ({rankedList.length} airports qualify)
            </span>
          </div>
          <div style={{ fontSize: 10, color: T.inkSoft, marginTop: 4 }}>{metricNote}</div>
        </div>

        <div style={{ maxHeight: 620, overflowY: 'auto', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr style={{ background: T.paper }}>
                <th style={thSt('center')}>Rank</th>
                <th style={thSt('left')}>Airport</th>
                <th style={thSt('center')}>Cc</th>
                <th style={thSt('right')}>{metric.name}</th>
                <th style={thSt('right')}>Comparison</th>
                <th style={thSt('center')}>Δ rank</th>
              </tr>
            </thead>
            <tbody>
              {rankedList.map((r, i) => (
                <RankRow
                  key={r.cd}
                  r={r}
                  idx={i}
                  metricId={metricId}
                  cmpValid={cmpValid}
                />
              ))}
            </tbody>
          </table>
        </div>

        {rankedList.length === 0 && (
          <div style={{ padding: '24px', textAlign: 'center', color: T.inkSoft, fontSize: 12 }}>
            No airports qualify for this metric in the selected timeframe.
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Climbers/Fallers card ────────────────────────────────────────────────────
function ClimbCard({ title, subtitle, rows, metricId, isValid, isFallers }) {
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.line}`, borderRadius: 12,
      padding: '14px 16px',
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '.07em', color: T.inkSoft, marginBottom: 4,
      }}>
        {title}
      </div>
      <div style={{ fontSize: 10, color: T.inkSoft, marginBottom: 12 }}>{subtitle}</div>

      {!isValid && (
        <div style={{
          padding: '10px 12px', background: T.grey, borderRadius: 8,
          fontSize: 11, color: T.inkSoft, lineHeight: 1.5,
        }}>
          {subtitle}
        </div>
      )}

      {isValid && rows.length === 0 && (
        <div style={{ fontSize: 12, color: T.inkSoft }}>No airports qualify (min 2 ranked in both windows, within top 150).</div>
      )}

      {isValid && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(r => {
            const nm = AP_ROSTER[r.cd]?.nm?.replace(/\(.*?\)/g,'').trim() || r.cd
            const shortNm = nm.length > 20 ? nm.slice(0,18)+'…' : nm
            const isUp = r.delta > 0
            const chipColor = isFallers ? T.coral : (isUp ? '#0A7A52' : T.coral)
            const chipBg = isFallers ? T.coralLight : (isUp ? T.leafLight : T.coralLight)
            const chevron = isFallers ? '▼' : (isUp ? '▲' : '▼')
            return (
              <div key={r.cd} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 0', borderBottom: `1px solid ${T.line}`,
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.ink, flex: 1, minWidth: 0 }}>
                  {shortNm}{' '}
                  <span style={{ fontSize: 10, color: T.inkSoft, fontWeight: 400 }}>{r.cd}</span>
                </div>
                <div style={{ fontSize: 10, color: T.inkSoft, whiteSpace: 'nowrap' }}>
                  #{r.prvRank} → <strong style={{ color: T.ink }}>#{r.rank}</strong>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                  background: chipBg, color: chipColor, whiteSpace: 'nowrap', minWidth: 36, textAlign: 'center',
                }}>
                  {chevron} {Math.abs(r.delta)}
                </span>
                <div style={{ fontSize: 10, color: T.inkSoft, whiteSpace: 'nowrap' }}>
                  {fmtVal(r.metricId || r.cd, r.v)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Table row (memoised) ─────────────────────────────────────────────────────
const RankRow = memo(function RankRow({ r, idx, metricId, cmpValid }) {
  const isTop3 = r.rank <= 3
  const bg = idx % 2 === 0 ? T.card : T.paper
  const rankColor = r.rank === 1 ? T.pine : r.rank === 2 ? T.amber : r.rank === 3 ? T.inkSoft : T.ink

  return (
    <tr style={{ background: bg, borderBottom: `1px solid ${T.line}` }}
      onMouseEnter={e => e.currentTarget.style.background = '#EEF7F3'}
      onMouseLeave={e => e.currentTarget.style.background = bg}>

      {/* Rank */}
      <td style={{ padding: '7px 10px', textAlign: 'center', fontWeight: 700, fontSize: isTop3 ? 14 : 12, color: rankColor, whiteSpace: 'nowrap' }}>
        #{r.rank}
      </td>

      {/* Airport name + code */}
      <td style={{ padding: '7px 10px', textAlign: 'left', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span style={{ fontWeight: 600, color: T.ink }}>{r.nm}</span>{' '}
        <span style={{ fontSize: 9, color: T.inkSoft }}>{r.cd}</span>
      </td>

      {/* Country */}
      <td style={{ padding: '7px 6px', textAlign: 'center', fontSize: 13 }}>
        {flag(r.cc)}{' '}<span style={{ fontSize: 9, color: T.inkSoft }}>{r.cc}</span>
      </td>

      {/* Current value */}
      <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: T.ink, whiteSpace: 'nowrap' }}>
        {fmtVal(metricId, r.v)}
      </td>

      {/* Comparison value */}
      <td style={{ padding: '7px 10px', textAlign: 'right', color: T.inkSoft, whiteSpace: 'nowrap' }}>
        {!cmpValid ? '–' : r.prvV != null ? fmtVal(metricId, r.prvV) : '–'}
      </td>

      {/* Δ rank */}
      <td style={{ padding: '7px 10px', textAlign: 'center', whiteSpace: 'nowrap' }}>
        <MoveCell delta={r.delta} isNew={r.isNew} cmpValid={cmpValid} />
      </td>
    </tr>
  )
})

// ─── Table header style helper ────────────────────────────────────────────────
function thSt(align) {
  return {
    padding: '9px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '.06em', color: T.inkSoft, background: T.paper,
    position: 'sticky', top: 0, zIndex: 2,
    textAlign: align, borderBottom: `2px solid ${T.line}`,
    whiteSpace: 'nowrap', userSelect: 'none',
  }
}
