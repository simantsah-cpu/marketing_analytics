/**
 * RideHailingTab.jsx — Weekly, live sources via makeQRH
 * Global and Japan are disjoint scopes — never summed.
 * rh_sales_trips not rendered — broken since 2026-07-11.
 */

import { useMemo, useState } from 'react'

// Design tokens
const T = {
  bg:'#ffffff', bg2:'#FAFBFC', bg3:'#F1F5F9', bg4:'#E2EAF0',
  text:'#1A2B3C', text2:'#374151', text3:'#64748B',
  border:'#E2EAF0', border2:'#B8C4D0',
  green:'#1D9E75', blue:'#185FA5', red:'#E24B4A',
  amber:'#D85A30', amberBg:'rgba(216,90,48,.08)',
  lift:'0 1px 2px rgba(26,26,24,.05), 0 6px 16px -6px rgba(26,26,24,.10)',
}

const SCOPE_COLOR = { Global: T.blue, Japan: T.amber }

// Scope label pill
function ScopeTag({ scope, small }){
  const col = SCOPE_COLOR[scope]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: `${col}15`, border: `1px solid ${col}40`,
      borderRadius: 6, padding: small ? '1px 7px' : '2px 9px',
      fontSize: small ? 10 : 11, fontWeight: 700, color: col,
    }}>
      {scope}
    </span>
  )
}

// Helpers
function num(v){ const x = Number(v); return isFinite(x) ? x : 0 }

function safeDiv(a, b){
  if (b === null || b === undefined || !isFinite(b) || b === 0) return null
  const r = a / b
  return isFinite(r) ? r : null
}

function usd(v, d = 2){
  const x = num(v), a = Math.abs(x), s = x < 0 ? '-$' : '$'
  return s + a.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function usdK(v){
  if (v === null) return null
  const x = num(v), a = Math.abs(x), s = x < 0 ? '-$' : '$'
  if (a >= 1e6) return s + (a / 1e6).toFixed(2) + 'M'
  if (a >= 1e5) return s + (a / 1e3).toFixed(0) + 'k'
  if (a >= 1e3) return s + (a / 1e3).toFixed(1) + 'k'
  return '$' + x.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function fmt(v, d = 0){
  if (v === null) return null
  return num(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function safePct(ratio, d = 1){
  if (ratio === null || !isFinite(Number(ratio))) return null
  return (num(ratio) * 100).toFixed(d) + '%'
}

function Val({ v, tag }){
  if (v === null || v === undefined){
    return <span style={{ color:'#CBD5E1', fontSize: 11, fontStyle:'italic' }}>{tag || 'n/a'}</span>
  }
  return <>{v}</>
}

function wowStr(cur, prev, invert = false){
  if (prev === null || prev === undefined || prev === 0) return null
  const pct = (num(cur) - num(prev)) / Math.abs(num(prev))
  if (!isFinite(pct)) return null
  const sign = pct >= 0 ? '+' : ''
  const col = invert
    ? (pct < 0 ? T.green : pct > 0 ? T.red : T.text3)
    : (pct > 0 ? T.green : pct < 0 ? T.red : T.text3)
  return { str: sign + (pct * 100).toFixed(1) + '%', col }
}

function fmtQueried(iso){
  if (!iso) return null
  try {
    const d = new Date(iso)
    const dd = d.getUTCDate()
    const mo = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
    const hh = String(d.getUTCHours()).padStart(2, '0')
    const mm = String(d.getUTCMinutes()).padStart(2, '0')
    return `${dd} ${mo} ${d.getUTCFullYear()} · ${hh}:${mm} UTC`
  } catch { return null }
}

// Parse long-format rows
function parseRH(rows){
  function pick(period, grain, dim, metric){
    const r = rows.find(
      row => row.period === period && row.grain === grain &&
             row.dim === dim && row.metric === metric
    )
    return r ? num(r.value) : null
  }

  function scopeMetrics(period, dim){
    const sv = (m) => pick(period, 'scope', dim, m)
    const service   = sv('rh_service_trips')
    const completed = sv('rh_completed_trips')
    const cancelled = sv('rh_cancelled_trips')
    const revenue   = sv('rh_revenue_usd')
    const cost      = sv('rh_cost_usd')
    return {
      service_trips:   service,
      completed_trips: completed,
      cancelled_trips: cancelled,
      revenue_usd:     revenue,
      cost_usd:        cost,
      completion_rate: (completed !== null && completed > 0) ? safeDiv(completed, service) : null,
      cancel_rate:     safeDiv(cancelled, service),
      margin_usd:      (revenue !== null && cost !== null) ? revenue - cost : null,
      gross_margin:    (revenue !== null && revenue > 0) ? safeDiv(revenue - cost, revenue) : null,
      rev_per_completed: (completed !== null && completed > 0) ? safeDiv(revenue, completed) : null,
    }
  }

  function companyMetrics(period){
    const cv = (m) => pick(period, 'company', 'Ride Hailing', m)
    const requests = cv('rh_request_number')
    const quotes   = cv('rh_quote_number')
    const failed   = cv('rh_failed_quotes')
    return {
      requests,
      quotes,
      failed_quotes: failed,
      quote_rate: (requests !== null && requests > 0) ? safeDiv(quotes, requests) : null,
    }
  }

  function weekMeta(period){
    const r = rows.find(row => row.period === period)
    if (!r) return null
    return { week_key: r.week_key, week_start: r.week_start, week_end: r.week_end }
  }

  return {
    cur:  { meta: weekMeta('cur'),  global: scopeMetrics('cur','Global'),  japan: scopeMetrics('cur','Japan'),  company: companyMetrics('cur')  },
    prev: { meta: weekMeta('prev'), global: scopeMetrics('prev','Global'), japan: scopeMetrics('prev','Japan'), company: companyMetrics('prev') },
  }
}

// WoW label
function wowLabel(prevMeta, curMeta){
  if (!prevMeta || !curMeta) return null
  const ms = new Date(curMeta.week_start) - new Date(prevMeta.week_start)
  if (Math.abs(ms / 86400000 - 7) > 1) return null
  const f = d => new Date(d + 'T00:00:00Z').toLocaleString('en-US',
    { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `vs ${prevMeta.week_key} (${f(prevMeta.week_start)}–${f(prevMeta.week_end)})`
}

// Shared table styles
const TH = {
  padding: '7px 12px', fontSize: 9.5, fontWeight: 700, color: T.text3,
  textTransform: 'uppercase', letterSpacing: '0.06em', background: T.bg2,
  borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap', textAlign: 'right',
}
const TD = { padding: '10px 12px', fontSize: 13, verticalAlign: 'middle' }
const ROW = { borderBottom: `1px solid ${T.border}` }
const CARD = {
  background: T.bg, borderRadius: 12, boxShadow: T.lift,
  border: `1px solid ${T.border}`, overflow: 'hidden', marginBottom: 18,
}

function SL({ children }){
  return (
    <div style={{ fontSize: 9, fontWeight: 700, color: T.text3, textTransform: 'uppercase',
      letterSpacing: '0.07em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
      <span>{children}</span>
      <div style={{ flex: 1, height: 1, background: T.border }}/>
    </div>
  )
}

// Search tiles — company-level, not scope-filtered
function SearchTiles({ cur, prev, wowLbl }){
  const cc = cur.company
  const pc = prev.company

  function Tile({ label, val, priorVal, sub }){
    const w = (val !== null && priorVal !== null) ? wowStr(val, priorVal) : null
    const fmtd = fmt(val)
    return (
      <div style={{ flex: 1, minWidth: 180, background: T.bg, borderRadius: 12, boxShadow: T.lift,
        border: `1px solid ${T.border}`, padding: '14px 18px 12px' }}>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: T.text3, marginBottom: 6,
          textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 700, color: T.text, lineHeight: 1.1 }}>
          <Val v={fmtd} />
        </div>
        {priorVal !== null && fmtd !== null && (
          <div style={{ fontSize: 11, color: T.text3, marginTop: 3 }}>prior {fmt(priorVal)}</div>
        )}
        {w && wowLbl && (
          <div style={{ fontSize: 11, fontWeight: 600, color: w.col, marginTop: 2 }}>{w.str} {wowLbl}</div>
        )}
        {sub && <div style={{ fontSize: 10.5, color: T.text3, marginTop: 5 }}>{sub}</div>}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
      <Tile label="Requests" val={cc.requests} priorVal={pc.requests}
        sub="by pickup date — not search date" />
      <Tile label="Quotes" val={cc.quotes} priorVal={pc.quotes}
        sub={cc.quote_rate !== null ? `Quote rate ${safePct(cc.quote_rate)}` : null} />
      <Tile label="Failed Quotes" val={cc.failed_quotes} priorVal={pc.failed_quotes}
        sub="shown separately — not additive with quotes" />
    </div>
  )
}

// Trip KPI strip — scope-aware
function KpiStrip({ cur, prev, wowLbl, scope }){
  const g = cur.global, j = cur.japan
  const pg = prev?.global, pj = prev?.japan

  // Global+Japan are disjoint — 'All' shows both rows, never sums them
  const scopes = scope === 'All'
    ? [{ key:'Global', data:g, pData:pg }, { key:'Japan', data:j, pData:pj }]
    : scope === 'Global'
      ? [{ key:'Global', data:g, pData:pg }]
      : [{ key:'Japan', data:j, pData:pj }]

  function Tile({ label, metricKey, fmtFn, invert, subFn }){
    return (
      <div style={{ flex: 1, minWidth: 200, background: T.bg, borderRadius: 12, boxShadow: T.lift,
        border: `1px solid ${T.border}`, padding: '14px 18px 12px' }}>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: T.text3, marginBottom: 8,
          textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>

        {scopes.map(({ key, data, pData }, i) => {
          const v    = data[metricKey]
          const pv   = pData?.[metricKey] ?? null
          const w    = (wowLbl && pv !== null) ? wowStr(v, pv, invert) : null
          const vFmt = fmtFn(v)
          const sub  = subFn ? subFn(key, v) : null
          return (
            <div key={key} style={{
              ...(i > 0 ? { borderTop: `1px solid ${T.border}`, paddingTop: 8, marginTop: 8 } : {})
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                {scope === 'All' && <ScopeTag scope={key} small />}
                <span style={{ fontSize: scope === 'All' ? 20 : 26, fontWeight: 700, color: T.text }}>
                  <Val v={vFmt} />
                </span>
                {w && <span style={{ fontSize: 11, fontWeight: 600, color: w.col }}>{w.str}</span>}
              </div>
              {pv !== null && vFmt !== null && (
                <div style={{ fontSize: 10.5, color: T.text3 }}>prior {fmtFn(pv)}</div>
              )}
              {sub && <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>{sub}</div>}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
      <Tile label="Service Trips" metricKey="service_trips" fmtFn={fmt} invert={false} />
      <Tile label="Completed Trips" metricKey="completed_trips" fmtFn={fmt} invert={false}
        subFn={(s, v) => (s === 'Japan' && v === 0) ? '0 is genuine — every trip was cancelled' : null} />
      <Tile label="Cancelled" metricKey="cancelled_trips" fmtFn={fmt} invert={true} />
      <Tile label="Revenue (USD)" metricKey="revenue_usd" fmtFn={usdK} invert={false}
        subFn={(s) => s === 'Japan' ? '$0 — all trips cancelled' : null} />
    </div>
  )
}

// Economics strip — scope-aware
function EconStrip({ cur, prev, wowLbl, scope }){
  const g = cur.global, j = cur.japan
  const pg = prev?.global, pj = prev?.japan

  const scopes = scope === 'All'
    ? [{ key:'Global', data:g, pData:pg }, { key:'Japan', data:j, pData:pj }]
    : scope === 'Global'
      ? [{ key:'Global', data:g, pData:pg }]
      : [{ key:'Japan', data:j, pData:pj }]

  function Tile({ label, metricKey, fmtFn, invert, subFn }){
    return (
      <div style={{ flex: 1, minWidth: 155, background: T.bg, borderRadius: 12, boxShadow: T.lift,
        border: `1px solid ${T.border}`, padding: '14px 18px 12px' }}>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: T.text3, marginBottom: 8,
          textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>

        {scopes.map(({ key, data, pData }, i) => {
          const v    = data[metricKey]
          const pv   = pData?.[metricKey] ?? null
          const w    = (wowLbl && pv !== null) ? wowStr(v, pv, invert) : null
          const vFmt = fmtFn(v)
          const sub  = subFn ? subFn(key, v) : null
          return (
            <div key={key} style={{
              ...(i > 0 ? { borderTop: `1px solid ${T.border}`, paddingTop: 8, marginTop: 8 } : {})
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                {scope === 'All' && <ScopeTag scope={key} small />}
                <span style={{ fontSize: scope === 'All' ? 20 : 26, fontWeight: 700, color: T.text }}>
                  <Val v={vFmt} />
                </span>
                {w && <span style={{ fontSize: 11, fontWeight: 600, color: w.col }}>{w.str}</span>}
              </div>
              {pv !== null && vFmt !== null && (
                <div style={{ fontSize: 10.5, color: T.text3 }}>prior {fmtFn(pv)}</div>
              )}
              {sub && <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>{sub}</div>}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
      <Tile label="Completion Rate" metricKey="completion_rate" fmtFn={safePct} invert={false}
        subFn={(s, v) => (s === 'Japan' && v === null) ? 'n/a — completed = 0' : null} />
      <Tile label="Cancel Rate" metricKey="cancel_rate" fmtFn={safePct} invert={true}
        subFn={(s) => s === 'Japan' ? '100% genuine — all trips cancelled' : null} />
      <Tile label="Gross Margin" metricKey="gross_margin" fmtFn={safePct} invert={false}
        subFn={(s, v) => (s === 'Japan' && v === null) ? 'n/a — revenue = $0' : null} />
      <Tile label="Margin USD" metricKey="margin_usd" fmtFn={v => v !== null ? usd(v) : null} invert={false} />
      <Tile label="Rev / Completed" metricKey="rev_per_completed" fmtFn={v => v !== null ? usd(v) : null} invert={false}
        subFn={(s, v) => (s === 'Japan' && v === null) ? 'n/a — completed = 0' : null} />
    </div>
  )
}

// Dispatch detail table — always shows both rows (it's already a table layout)
function DispatchTable({ cur, prev, wowLbl }){
  const hasWow = !!wowLbl

  const COLS = [
    { key: 'service_trips',     label: 'Service Trips', fmtFn: fmt,  invert: false },
    { key: 'completed_trips',   label: 'Completed',     fmtFn: fmt,  invert: false },
    { key: 'cancelled_trips',   label: 'Cancelled',     fmtFn: fmt,  invert: true  },
    { key: 'completion_rate',   label: 'Compl. %',      fmtFn: safePct, invert: false },
    { key: 'cancel_rate',       label: 'Cancel %',      fmtFn: safePct, invert: true  },
    { key: 'revenue_usd',       label: 'Revenue',       fmtFn: v => v !== null ? usd(v) : null, invert: false },
    { key: 'cost_usd',          label: 'Cost',          fmtFn: v => v !== null ? usd(v) : null, invert: true  },
    { key: 'margin_usd',        label: 'Margin $',      fmtFn: v => v !== null ? usd(v) : null, invert: false },
    { key: 'gross_margin',      label: 'Margin %',      fmtFn: safePct, invert: false },
    { key: 'rev_per_completed', label: 'Rev/Trip',      fmtFn: v => v !== null ? usd(v) : null, invert: false },
  ]

  function ScopeRow({ scope, curData, prevData }){
    return (
      <tr style={ROW}>
        <td style={{ ...TD, paddingLeft: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <ScopeTag scope={scope} />
            {scope === 'Japan' && (
              <span style={{ fontSize: 10, color: T.amber, background: T.amberBg,
                borderRadius: 6, padding: '1px 7px', fontWeight: 600 }}>all cancelled</span>
            )}
          </div>
        </td>
        {COLS.map(col => {
          const cv = curData[col.key]
          const pv = prevData ? prevData[col.key] : null
          const fmtd = col.fmtFn(cv)
          const fmtdP = pv !== null ? col.fmtFn(pv) : null
          const w = (hasWow && pv !== null) ? wowStr(cv, pv, col.invert) : null
          return (
            <td key={col.key} style={{ ...TD, textAlign: 'right' }}>
              <div style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                <Val v={fmtd} tag="n/a" />
              </div>
              {fmtdP !== null && <div style={{ fontSize: 10.5, color: T.text3 }}>{fmtdP}</div>}
              {w && <div style={{ fontSize: 10.5, fontWeight: 600, color: w.col }}>{w.str}</div>}
            </td>
          )
        })}
      </tr>
    )
  }

  return (
    <div style={CARD}>
      <div style={{ padding: '8px 14px 7px', borderBottom: `1px solid ${T.border}`, background: T.bg2 }}>
        <span style={{ fontSize: 11, color: T.text3 }}>
          Global and Japan are disjoint subsets — never summed
          {hasWow && <> · {wowLbl}</>}
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto', minWidth: 1100 }}>
          <thead>
            <tr>
              <th style={{ ...TH, textAlign: 'left', paddingLeft: 16, width: 140 }}>Scope</th>
              {COLS.map(c => (
                <th key={c.key} style={TH}>
                  {c.label}
                  {hasWow && <><br/><span style={{ fontWeight: 400, opacity: 0.7 }}>prior · WoW</span></>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <ScopeRow scope="Global" curData={cur.global} prevData={prev?.global} />
            <ScopeRow scope="Japan"  curData={cur.japan}  prevData={prev?.japan}  />
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Main
export default function RideHailingTab({ D }){
  const rhRows = D?.rh || []
  const queriedAt = fmtQueried(D?.queried_at)

  const data = useMemo(() => parseRH(rhRows), [rhRows])
  const { cur, prev } = data

  // Scope toggle — 'All' shows both rows side-by-side, never sums Global+Japan
  const [scope, setScope] = useState('All')

  const hasData = rhRows.length > 0 && cur.meta !== null
  const wowLbl = wowLabel(prev.meta, cur.meta)

  if (!hasData){
    return (
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, margin: '0 0 6px' }}>Ride Hailing</h1>
        <div style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 10,
          padding: '20px 24px', color: T.text3, fontSize: 13 }}>
          <strong style={{ color: T.text }}>Ride hailing data has not loaded yet.</strong>
          {' '}Press <strong>Refresh</strong> to reload.
        </div>
      </div>
    )
  }

  const weekLabel = (() => {
    const f = d => new Date(d + 'T00:00:00Z').toLocaleString('en-US',
      { day: 'numeric', month: 'short', timeZone: 'UTC' })
    return cur.meta
      ? `${cur.meta.week_key} (${f(cur.meta.week_start)}–${f(cur.meta.week_end)})`
      : null
  })()

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: T.text, margin: '0 0 4px' }}>Ride Hailing</h1>
        <div style={{ fontSize: 13, color: T.text3, lineHeight: 1.6 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ background: '#dcfce7', color: '#166534', fontSize: 10, fontWeight: 700,
              padding: '2px 7px', borderRadius: 10, letterSpacing: '0.04em' }}>● LIVE</span>
            {weekLabel && <span>{weekLabel} · Hoppa Ride Hailing</span>}
          </span>
          {queriedAt && (
            <span style={{ display: 'block', fontSize: 11.5, color: T.text3, marginTop: 3 }}>
              Live data · read {queriedAt}. B2C and Ride Hailing read live sources; all other tabs are frozen at the snapshot.
            </span>
          )}
        </div>
      </div>

      {/* Scope toggle + legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 8,
        padding: '8px 14px', marginBottom: 16 }}>

        {/* Toggle pills */}
        <div style={{ display: 'flex', background: T.bg4, borderRadius: 8, padding: 3, gap: 2 }}>
          {['Global', 'Japan', 'All'].map(s => (
            <button
              key={s}
              onClick={() => setScope(s)}
              style={{
                padding: '4px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontSize: 11.5, fontWeight: 700, transition: 'all 0.15s ease',
                background: scope === s
                  ? (s === 'Global' ? T.blue : s === 'Japan' ? T.amber : T.text)
                  : 'transparent',
                color: scope === s ? '#fff' : T.text3,
                boxShadow: scope === s ? '0 1px 4px rgba(0,0,0,.2)' : 'none',
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: T.text3, flexWrap: 'wrap' }}>
          {(scope === 'Global' || scope === 'All') && <><ScopeTag scope="Global" /><span>all regions except Japan</span></>}
          {scope === 'All' && <span style={{ color: T.border2 }}>·</span>}
          {(scope === 'Japan'  || scope === 'All') && <><ScopeTag scope="Japan" /><span>Japan service areas only</span></>}
          {scope === 'All' && <><span style={{ color: T.border2 }}>·</span><span>disjoint — never summed</span></>}
        </div>
      </div>

      {/* Demand — company-level, not scope-filtered */}
      <SL>Demand — Search Metrics (pickup-date basis · company level)</SL>
      <SearchTiles cur={cur} prev={prev} wowLbl={wowLbl} />

      {/* Trip volume */}
      <SL>Trip Volume — Service, Completed, Cancelled, Revenue</SL>
      <KpiStrip cur={cur} prev={prev} wowLbl={wowLbl} scope={scope} />

      {/* Economics */}
      <SL>Economics — Rates and Margins</SL>
      <EconStrip cur={cur} prev={prev} wowLbl={wowLbl} scope={scope} />

      {/* Detail table — always shows both rows */}
      <SL>Dispatch Detail — All Metrics by Scope</SL>
      <DispatchTable cur={cur} prev={prev} wowLbl={wowLbl} />

      {/* Data note */}
      <div style={{ background: '#fffbeb', border: `1px solid #fde68a`, borderRadius: 8,
        padding: '8px 14px', fontSize: 11.5, color: T.text2 }}>
        <span style={{ marginRight: 6 }}>⚠</span>
        <code style={{ fontSize: 11, background: T.bg4, padding: '1px 4px', borderRadius: 3 }}>rh_sales_trips</code>{' '}
        is not displayed — source column unpopulated since 11 Jul 2026 (raised with BI). Search-side metrics (requests, quotes, failed quotes) are healthy.
      </div>
    </div>
  )
}
