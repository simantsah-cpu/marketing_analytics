/**
 * AIEngineeringTab.jsx — AI Code & Test weekly metrics
 *
 * Source: snap.kpi_weekly, page='ai_code_test', grain='company', dim='Total'
 * Data is manually entered into snap.manual_kpi_input — no live ads.* source.
 *
 * Rules enforced from spec:
 * 0:   no volatility banner, no queried_at stamp — values are frozen by snapshot
 * 1.1: values are on 0-100 scale — display as-is with % suffix, NEVER ×100
 * 1.2: no MTD / QTD / YTD — no denominator stored, cannot be computed correctly
 * 2:   label by week_key + week dates, never by recorded_on
 * 3.1: zero rows for current week → "No data recorded" — never render 0%
 * 3.2: QUALIFY in SQL collapses duplicates; frontend picks first (already deduplicated)
 * 4.0: hold metric list in frontend; don't drive UI purely from returned rows
 * 4.1: WoW delta in pts not % — write "−7.9 pts"
 * 5.14/5.19: WoW = — when either side is NULL — never NaN, never 0
 */

import { useMemo } from 'react'

// Design tokens
const T = {
  bg:'#ffffff', bg2:'#FAFBFC', bg3:'#F1F5F9', bg4:'#E2EAF0',
  text:'#1A2B3C', text2:'#374151', text3:'#64748B',
  border:'#E2EAF0',
  green:'#1D9E75', greenBg:'rgba(29,158,117,.08)',
  blue:'#185FA5', blueBg:'rgba(24,95,165,.08)',
  red:'#E24B4A', redBg:'rgba(226,75,74,.08)',
  lift:'0 1px 2px rgba(26,26,24,.05), 0 6px 16px -6px rgba(26,26,24,.10)',
}

// 4.0: canonical metric list — drives UI independently of row count
const METRICS = [
  {
    key: 'ai_lines_added_pct',
    label: 'AI Lines Added',
    description: 'Share of code lines added that were AI-generated',
    higherIsBetter: true,
  },
  {
    key: 'ai_test_lines_added_pct',
    label: 'AI Test Lines Added',
    description: 'Share of test code lines added that were AI-generated',
    higherIsBetter: true,
  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────
function num(v){ const x = Number(v); return isFinite(x) ? x : null }

// 1.1: values are already on 0-100 scale — display as-is, never ×100
function fmtPct(v){
  const x = num(v)
  if (x === null) return null
  return x.toFixed(1) + '%'
}

// 4.1: WoW delta in percentage POINTS, not %
function fmtPts(delta){
  if (delta === null || !isFinite(delta)) return null
  const sign = delta >= 0 ? '+' : ''
  return sign + delta.toFixed(1) + ' pts'
}

function fmtWeekRange(start, end){
  if (!start || !end) return ''
  const f = d => new Date(d + 'T00:00:00Z')
    .toLocaleString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${f(start)}–${f(end)}`
}

// ─── Parse rows from makeQAI ──────────────────────────────────────────────────
// Returns { cur, prev } each with { meta, metrics: { [key]: value|null } }
// 3.1: if cur rows all have NULL metric → no data recorded for that week
// 4.0: both metrics marked missing when the LEFT JOIN returns a NULL-metric row
function parseAI(rows){
  function periodRows(period){ return rows.filter(r => r.period === period) }

  function parsePeriod(period){
    const pr = periodRows(period)
    if (pr.length === 0) return null  // no prior snapshot at all (5.14)

    // Check for empty-week case (3.1 / 4.0): all rows have NULL metric
    const hasData = pr.some(r => r.metric !== null && r.metric !== undefined && r.metric !== '')
    const meta = {
      week_key:   pr[0]?.week_key   ?? null,
      week_start: pr[0]?.week_start ?? null,
      week_end:   pr[0]?.week_end   ?? null,
      hasData,
    }

    if (!hasData) return { meta, metrics: {} }

    const metrics = {}
    for (const row of pr){
      if (row.metric) metrics[row.metric] = num(row.value)
    }
    return { meta, metrics }
  }

  return { cur: parsePeriod('cur'), prev: parsePeriod('prev') }
}

// ─── Components ──────────────────────────────────────────────────────────────
const CARD = {
  background: T.bg, borderRadius: 14, boxShadow: T.lift,
  border: `1px solid ${T.border}`, padding: '22px 26px 20px',
  flex: 1, minWidth: 260,
}

function SL({ children }){
  return (
    <div style={{ fontSize: 9, fontWeight: 700, color: T.text3, textTransform: 'uppercase',
      letterSpacing: '0.07em', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
      <span>{children}</span>
      <div style={{ flex: 1, height: 1, background: T.border }}/>
    </div>
  )
}

// No-data card — 3.1: shown for both metrics when week has zero manual rows
function NoDataCard({ meta, spec }){
  const weekRange = fmtWeekRange(meta?.week_start, meta?.week_end)
  return (
    <div style={CARD}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: T.text3, marginBottom: 8,
        textTransform: 'uppercase', letterSpacing: '0.06em' }}>{spec.label}</div>
      <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 10,
        padding: '16px 18px', textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: T.text3, fontStyle: 'italic', lineHeight: 1.6 }}>
          No data recorded for{' '}
          <strong style={{ color: T.text2 }}>{meta?.week_key ?? 'this week'}</strong>
          {weekRange && <> · {weekRange}</>}
        </div>
        <div style={{ fontSize: 11, color: T.text3, marginTop: 6 }}>
          Manual entry expected by Monday — re-run snapshot after entry to populate.
        </div>
      </div>
    </div>
  )
}

// Main metric card
function MetricCard({ spec, curVal, prevVal, curMeta, prevMeta }){
  // 5.11/5.12: sanity guard — value must be in 0-100 range
  const safe = v => (v !== null && v >= 0 && v <= 100) ? v : null
  const cv = safe(curVal)
  const pv = safe(prevVal)

  // 4.1: delta in pts — 5.14/5.19: null if either side missing
  const delta = (cv !== null && pv !== null) ? cv - pv : null
  const deltaColor = delta === null ? T.text3
    : (spec.higherIsBetter ? (delta >= 0 ? T.green : T.red) : (delta <= 0 ? T.green : T.red))

  // Progress bar — cv is already 0-100
  const barPct = cv !== null ? Math.min(100, Math.max(0, cv)) : 0
  const barColor = cv === null ? T.border
    : (delta === null || delta >= 0 ? T.green : T.red)

  const curLabel  = curMeta?.week_key ? `${curMeta.week_key} · ${fmtWeekRange(curMeta.week_start, curMeta.week_end)}` : null
  const prevLabel = prevMeta?.week_key ? `${prevMeta.week_key} · ${fmtWeekRange(prevMeta.week_start, prevMeta.week_end)}` : null

  return (
    <div style={CARD}>
      {/* Label */}
      <div style={{ fontSize: 10.5, fontWeight: 600, color: T.text3, marginBottom: 6,
        textTransform: 'uppercase', letterSpacing: '0.06em' }}>{spec.label}</div>

      {/* Current value — 1.1: display as-is, never ×100 */}
      <div style={{ fontSize: 40, fontWeight: 700, color: T.text, lineHeight: 1, marginBottom: 4 }}>
        {cv !== null ? fmtPct(cv)
          : <span style={{ color: T.text3, fontSize: 18, fontStyle: 'italic' }}>n/a</span>}
      </div>

      {/* Week label — 2: show week dates, not recorded_on */}
      {curLabel && (
        <div style={{ fontSize: 11, color: T.text3, marginBottom: 12 }}>{curLabel}</div>
      )}

      {/* Progress bar */}
      <div style={{ height: 6, background: T.bg3, borderRadius: 3, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{
          width: `${barPct}%`, height: '100%',
          background: `linear-gradient(90deg, ${T.blue} 0%, ${barColor} 100%)`,
          borderRadius: 3, transition: 'width 0.5s ease',
        }}/>
      </div>

      {/* Description */}
      <div style={{ fontSize: 11.5, color: T.text3, marginBottom: 12, lineHeight: 1.5 }}>
        {spec.description}
      </div>

      {/* WoW — 4.1: pts not %, 5.14/5.19: — when null */}
      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: T.text3, textTransform: 'uppercase',
          letterSpacing: '0.05em', marginBottom: 4 }}>Week-on-Week</div>
        {delta !== null ? (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: deltaColor }}>
              {fmtPts(delta)}
            </span>
            <span style={{ fontSize: 11, color: T.text3 }}>
              vs prior {pv !== null ? fmtPct(pv) : 'n/a'}
              {prevLabel && <> ({prevLabel})</>}
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, color: T.text3, fontStyle: 'italic' }}>—</span>
            <span style={{ fontSize: 11, color: T.text3 }}>
              {prevMeta === null
                ? 'No prior snapshot available'
                : pv === null
                  ? `No data recorded for ${prevMeta?.week_key ?? 'prior week'}`
                  : cv === null
                    ? 'No data for current week'
                    : 'Not available'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// History table — cur + prev rows side-by-side
const TH = { padding:'7px 12px', fontSize:9.5, fontWeight:700, color:T.text3,
  textTransform:'uppercase', letterSpacing:'0.06em', background:T.bg2,
  borderBottom:`1px solid ${T.border}`, whiteSpace:'nowrap', textAlign:'right' }
const TD = { padding:'10px 12px', fontSize:13, verticalAlign:'middle',
  fontVariantNumeric:'tabular-nums', textAlign:'right' }
const ROW = { borderBottom:`1px solid ${T.border}` }

function HistoryTable({ cur, prev }){
  const weeks = []
  if (cur) weeks.push({ label: cur.meta?.week_key, range: fmtWeekRange(cur.meta?.week_start, cur.meta?.week_end), metrics: cur.metrics, isCur: true })
  if (prev) weeks.push({ label: prev.meta?.week_key, range: fmtWeekRange(prev.meta?.week_start, prev.meta?.week_end), metrics: prev.metrics, isCur: false })

  if (weeks.length === 0) return null

  return (
    <div style={{ background:T.bg, borderRadius:12, boxShadow:T.lift, border:`1px solid ${T.border}`, overflow:'hidden' }}>
      <div style={{ padding:'10px 16px 8px', borderBottom:`1px solid ${T.border}`, background:T.bg2 }}>
        <span style={{ fontWeight:700, fontSize:13, color:T.text }}>Week-on-Week History</span>
        <span style={{ fontSize:11, color:T.text3, marginLeft:10 }}>
          snapshot data · values on 0–100 scale
        </span>
      </div>
      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...TH, textAlign:'left', paddingLeft:16 }}>Week</th>
            <th style={TH}>AI Lines Added %</th>
            <th style={TH}>AI Test Lines Added %</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w, i) => {
            const ai   = w.metrics['ai_lines_added_pct']      ?? null
            const test = w.metrics['ai_test_lines_added_pct'] ?? null
            return (
              <tr key={i} style={{ ...ROW, background: w.isCur ? '#F8FAFF' : T.bg }}>
                <td style={{ ...TD, textAlign:'left', paddingLeft:16, fontWeight: w.isCur ? 700 : 400, color:T.text }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span>{w.label}</span>
                    {w.range && <span style={{ fontSize:10.5, color:T.text3 }}>{w.range}</span>}
                    {w.isCur && (
                      <span style={{ fontSize:10, fontWeight:700, background:T.blue, color:'#fff',
                        borderRadius:8, padding:'1px 7px' }}>Latest</span>
                    )}
                  </div>
                </td>
                <td style={{ ...TD, fontWeight: w.isCur ? 700 : 400,
                  color: ai === null ? T.text3 : T.text }}>
                  {ai !== null ? fmtPct(ai)
                    : <span style={{ fontStyle:'italic', color:T.text3 }}>No data</span>}
                </td>
                <td style={{ ...TD, fontWeight: w.isCur ? 700 : 400,
                  color: test === null ? T.text3 : T.text }}>
                  {test !== null ? fmtPct(test)
                    : <span style={{ fontStyle:'italic', color:T.text3 }}>No data</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AIEngineeringTab({ D }){
  const aiRows = D?.ai || []
  const asAt   = D?.asAt ?? null

  const { cur, prev } = useMemo(() => parseAI(aiRows), [aiRows])

  // No data at all — initial load or fetch error
  if (!cur && aiRows.length === 0){
    return (
      <div>
        <h1 style={{ fontSize:20, fontWeight:700, color:T.text, margin:'0 0 6px' }}>AI Code & Test</h1>
        <div style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:10,
          padding:'20px 24px', color:T.text3, fontSize:13 }}>
          <strong style={{ color:T.text }}>AI Code & Test data has not loaded yet.</strong>
          {' '}Press <strong>Refresh</strong> to reload.
        </div>
      </div>
    )
  }

  // Week labels for header
  const curWeekLabel = cur?.meta?.week_key
    ? `${cur.meta.week_key} · ${fmtWeekRange(cur.meta.week_start, cur.meta.week_end)}`
    : asAt

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom:18 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
          <h1 style={{ fontSize:20, fontWeight:700, color:T.text, margin:0 }}>AI Code & Test</h1>
          {cur?.meta?.week_key && (
            <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10,
              background:T.bg3, color:T.text3, letterSpacing:'0.04em' }}>
              {cur.meta.week_key}
            </span>
          )}
        </div>
        <div style={{ fontSize:13, color:T.text3, lineHeight:1.6 }}>
          {curWeekLabel
            ? <>Week <strong style={{ color:T.text2 }}>{curWeekLabel}</strong></>
            : null}
        </div>
      </div>

      {/* 1.1: scale enforced in code — no banner needed */}

      {/* 1.2 note: no MTD/QTD/YTD shown — this is by design */}

      {/* Metric cards */}
      <SL>Current Week — {cur?.meta?.week_key ?? asAt}</SL>
      <div style={{ display:'flex', gap:16, flexWrap:'wrap', marginBottom:24 }}>
        {METRICS.map(spec => {
          // 3.1: if cur is null or cur has no data, show no-data card for both
          if (!cur || !cur.meta) return (
            <NoDataCard key={spec.key} meta={null} spec={spec} />
          )
          if (!cur.meta.hasData) return (
            <NoDataCard key={spec.key} meta={cur.meta} spec={spec} />
          )
          return (
            <MetricCard
              key={spec.key}
              spec={spec}
              curVal={cur.metrics[spec.key] ?? null}
              prevVal={prev?.metrics?.[spec.key] ?? null}
              curMeta={cur.meta}
              prevMeta={prev?.meta ?? null}
            />
          )
        })}
      </div>

      {/* History table */}
      <SL>Week-on-Week History</SL>
      <HistoryTable cur={cur} prev={prev} />


    </div>
  )
}
