/**
 * OpsRevenueTab.jsx — Page 6: Operations & Revenue
 *
 * Brief rules enforced:
 *   D1: cancelled_origin/type unrecorded — no breakdown card shown
 *   D2: splits show mix/direction, totals come from KPI layer (MONTHLY_KPI)
 *   D3: live-table drift — as-of stamp shown in header
 *   R2: no month before 2504 on axis
 *   O3: inverted chip for cancellation rate (falling = green)
 *   No timeframe controls — fixed to latest complete month/quarter
 *   All purchase-type events referred to correctly per domain (ops = bookings)
 */

import { useState, useMemo } from 'react'
import { OPSX, MONTHLY_KPI, OPS_AS_OF } from '../data/opsData.js'

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  pine: '#0A2540', leaf: '#0D8A72', ink: '#1A2B3C', inkSoft: '#5A6A7A',
  paper: '#F8FAFC', card: '#FFFFFF', line: '#E2EAF0', prior: '#0F5FA6',
  amber: '#D97706', coral: '#C0392B', teal: '#2B8FA3',
  leafLight: '#E6F5F2', coralLight: '#FDEDEB', amberLight: '#FDF4E3',
  grey: '#E2EAF0',
}

// ─── Constants ────────────────────────────────────────────────────────────────
// Axis months: Apr 2025 – Jun 2026 (brief §5)
const AXIS_MONTHS = ['2504','2505','2506','2507','2508','2509','2510','2511','2512','2601','2602','2603','2604','2605','2606']
const MONTH_LABEL = {
  '2504':'Apr\'25','2505':'May\'25','2506':'Jun\'25','2507':'Jul\'25','2508':'Aug\'25',
  '2509':'Sep\'25','2510':'Oct\'25','2511':'Nov\'25','2512':'Dec\'25',
  '2601':'Jan\'26','2602':'Feb\'26','2603':'Mar\'26','2604':'Apr\'26','2605':'May\'26','2606':'Jun\'26',
}

// KPI anchors from brief §5 (dispatch tolerance D3)
const KPI = {
  jun26Net: 15830, jun26TTV: 1193695, jun26Gross: 16782, jun26Canc: 952,
  jun25Net: 16559, jun25TTV: 1199742, jun25Canc: 2308, jun25Gross: 18867,
  q2_26Net: 45551, q2_26TTV: 3423287,
  q2_25Net: 49646, q2_25TTV: 3562900,
}
// Derive from data (live)
const LIVE = MONTHLY_KPI

// ─── Fixed vehicle class display order (top 6 by June 2026 net + Other) ───────
function getTop6VC() {
  const vc26 = OPSX.VC?.['2606'] || {}
  return Object.entries(vc26)
    .map(([cls, v]) => ({ cls, net: v.b - v.c, b: v.b, c: v.c, tn: v.tn }))
    .sort((a,b) => b.net - a.net)
    .slice(0, 6)
    .map(e => e.cls)
}
const TOP6_VC = getTop6VC()

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtN(n, opts = {}) {
  if (n == null || isNaN(n)) return '–'
  const a = Math.abs(n), sg = n < 0 ? '-' : ''
  if (opts.gbp) {
    if (a >= 1e6) return sg + '£' + (a / 1e6).toFixed(2) + 'M'
    if (a >= 1e3) return sg + '£' + Math.round(a / 1e3).toLocaleString() + 'K'
    return sg + '£' + Math.round(a).toLocaleString()
  }
  if (a >= 1e6) return sg + (a / 1e6).toFixed(1) + 'M'
  if (a >= 1e4) return sg + Math.round(a / 1e3) + 'K'
  if (a >= 1e3) return sg + (a / 1e3).toFixed(1) + 'K'
  return sg + Math.round(a).toLocaleString()
}
function fmtPct(n, dp = 1) { return n == null || isNaN(n) ? '–' : n.toFixed(dp) + '%' }
function pctDelta(cur, prv) { return prv && prv > 0 ? (cur - prv) / prv * 100 : null }
function ppDelta(cur, prv) { return (cur != null && prv != null) ? cur - prv : null }

// ─── KPI card ─────────────────────────────────────────────────────────────────
function KPICard({ label, value, prior, chip, footnote, invertChip = false }) {
  // chip: { cur, prv, isPP } or raw text
  let chipEl = null
  if (chip) {
    const d = chip.isPP ? ppDelta(chip.cur, chip.prv) : pctDelta(chip.cur, chip.prv)
    if (d != null) {
      const up = d >= 0
      // invertChip: for cancellation rate, lower is better → falling = green
      const isGood = invertChip ? !up : up
      const text = chip.isPP
        ? (d >= 0 ? '+' : '') + d.toFixed(2) + 'pp'
        : (d >= 0 ? '+' : '') + d.toFixed(1) + '%'
      chipEl = (
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
          background: isGood ? T.leafLight : T.coralLight,
          color: isGood ? '#0A7A52' : T.coral, marginLeft: 6,
        }}>
          {isGood ? '▲' : '▼'} {text}
        </span>
      )
    }
  }

  return (
    <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: T.inkSoft, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: T.ink, letterSpacing: '-.5px', lineHeight: 1.1 }}>{value}</div>
      {prior && (
        <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 4 }}>
          {prior}{chipEl}
        </div>
      )}
      {footnote && <div style={{ fontSize: 10, color: T.inkSoft, marginTop: 6, borderTop: `1px solid ${T.line}`, paddingTop: 6 }}>{footnote}</div>}
    </div>
  )
}

// ─── (a) Six KPI cards ────────────────────────────────────────────────────────
function KPICards() {
  const jun26 = LIVE['2606'] || {}
  const jun25 = LIVE['2506'] || {}

  // AOV
  const aov26 = jun26.aov || 0
  const aov25 = jun25.aov || 0

  // Q2 net
  const q2net26 = (LIVE['2604']?.net||0) + (LIVE['2605']?.net||0) + (LIVE['2606']?.net||0)
  const q2net25 = (LIVE['2504']?.net||0) + (LIVE['2505']?.net||0) + (LIVE['2506']?.net||0)
  const q2ttv26 = (LIVE['2604']?.netTTV||0) + (LIVE['2605']?.netTTV||0) + (LIVE['2606']?.netTTV||0)
  const q2ttv25 = (LIVE['2504']?.netTTV||0) + (LIVE['2505']?.netTTV||0) + (LIVE['2506']?.netTTV||0)

  const cancRate26 = jun26.cancRate || 0
  const cancRate25 = jun25.cancRate || 0

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
      <KPICard
        label="June 2026 net bookings"
        value={fmtN(KPI.jun26Net)}
        prior={`Jun 2025: ${fmtN(KPI.jun25Net)}`}
        chip={{ cur: KPI.jun26Net, prv: KPI.jun25Net }}
        footnote={`gross ${fmtN(KPI.jun26Gross)} · cancelled ${fmtN(KPI.jun26Canc)} · ✓ valid YoY`}
      />
      <KPICard
        label="June 2026 net TTV"
        value={fmtN(KPI.jun26TTV, { gbp: true })}
        prior={`Jun 2025: ${fmtN(KPI.jun25TTV, { gbp: true })}`}
        chip={{ cur: KPI.jun26TTV, prv: KPI.jun25TTV }}
        footnote="FX-converted GBP · cancelled excluded"
      />
      <KPICard
        label="June 2026 AOV (net)"
        value={fmtN(Math.round(aov26), { gbp: true })}
        prior={`Jun 2025: ${fmtN(Math.round(aov25), { gbp: true })}`}
        chip={{ cur: aov26, prv: aov25 }}
        footnote="net TTV ÷ net bookings"
      />
      <KPICard
        label="Q2 2026 net bookings"
        value={fmtN(KPI.q2_26Net)}
        prior={`Q2 2025: ${fmtN(KPI.q2_25Net)}`}
        chip={{ cur: KPI.q2_26Net, prv: KPI.q2_25Net }}
        footnote={`Q2 net TTV ${fmtN(KPI.q2_26TTV, { gbp: true })} (${pctDelta(KPI.q2_26TTV, KPI.q2_25TTV)?.toFixed(1)}% YoY) · ✓ valid YoY`}
      />
      <KPICard
        label="June 2026 cancellation rate"
        value={fmtPct(cancRate26, 1)}
        prior={`Jun 2025: ${fmtPct(cancRate25, 1)}`}
        chip={{ cur: cancRate26, prv: cancRate25 }}
        invertChip={true}
        footnote="share of gross bookings cancelled · lower is better ↓"
      />
      <KPICard
        label="June 2026 avg party size"
        value={(jun26.avgPax || 0).toFixed(2)}
        prior={`Jun 2025: ${(jun25.avgPax || 0).toFixed(2)}`}
        chip={{ cur: jun26.avgPax || 0, prv: jun25.avgPax || 0 }}
        footnote="passengers per booking (gross)"
      />
    </div>
  )
}

// ─── (b) Vehicle mix ──────────────────────────────────────────────────────────
function VehicleNetBars() {
  const vc26 = OPSX.VC?.['2606'] || {}
  const vc25 = OPSX.VC?.['2506'] || {}

  // Build rows: top 6 + Other classes
  const top6Rows = TOP6_VC.map(cls => {
    const cur = vc26[cls] || { b: 0, c: 0, tn: 0 }
    const prv = vc25[cls] || { b: 0, c: 0, tn: 0 }
    return { label: cls, curNet: cur.b - cur.c, prvNet: prv.b - prv.c }
  })

  // Other = everything not in top 6
  let otherCur = 0, otherPrv = 0
  Object.entries(vc26).forEach(([cls, v]) => { if (!TOP6_VC.includes(cls)) otherCur += v.b - v.c })
  Object.entries(vc25).forEach(([cls, v]) => { if (!TOP6_VC.includes(cls)) otherPrv += v.b - v.c })
  const rows = [...top6Rows, { label: 'Other classes', curNet: otherCur, prvNet: otherPrv, isOther: true }]

  const maxV = Math.max(...rows.flatMap(r => [r.curNet, r.prvNet]), 1)

  return (
    <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 4 }}>Net bookings by vehicle class — June 2026 vs June 2025</div>
      <div style={{ fontSize: 10, color: T.inkSoft, marginBottom: 14 }}>Pale bar = June 2025 · current bar = June 2026</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map(({ label, curNet, prvNet, isOther }, i) => {
          const curW = Math.max(2, (curNet / maxV) * 100)
          const prvW = Math.max(2, (prvNet / maxV) * 100)
          const d = prvNet > 0 ? pctDelta(curNet, prvNet) : null
          return (
            <div key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: isOther ? T.inkSoft : T.ink }}>{label}</span>
                <span style={{ fontSize: 11, color: T.inkSoft }}>
                  {isOther ? '' : fmtN(prvNet) + ' → '}<strong style={{ color: T.ink }}>{fmtN(curNet)}</strong>
                  {d != null && <span style={{ marginLeft: 6, fontWeight: 700, color: d >= 0 ? '#0A7A52' : T.coral }}>{d >= 0 ? '+' : ''}{d.toFixed(1)}%</span>}
                </span>
              </div>
              {!isOther && (
                <div style={{ height: 6, background: T.grey, borderRadius: 3, marginBottom: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${prvW}%`, height: '100%', background: T.prior, borderRadius: 3 }} />
                </div>
              )}
              <div style={{ height: 9, background: T.grey, borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${curW}%`, height: '100%', background: isOther ? T.inkSoft : T.pine, borderRadius: 4 }} />
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ marginTop: 12, fontSize: 10, color: T.inkSoft, borderTop: `1px solid ${T.line}`, paddingTop: 8 }}>
        Splits carry ~0.02% multi-leg noise — totals defer to the KPIs above.
      </div>
    </div>
  )
}

function VehicleTTVShare() {
  const vc26 = OPSX.VC?.['2606'] || {}
  let totalTTV = 0
  Object.values(vc26).forEach(v => { totalTTV += v.tn })

  const rows = TOP6_VC.map(cls => {
    const v = vc26[cls] || { tn: 0 }
    return { label: cls, tn: v.tn, share: totalTTV > 0 ? v.tn / totalTTV * 100 : 0 }
  })
  let otherTTN = 0
  Object.entries(vc26).forEach(([cls, v]) => { if (!TOP6_VC.includes(cls)) otherTTN += v.tn })
  rows.push({ label: 'Other classes', tn: otherTTN, share: totalTTV > 0 ? otherTTN / totalTTV * 100 : 0, isOther: true })

  const maxShare = Math.max(...rows.map(r => r.share), 1)

  return (
    <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 4 }}>Net TTV share by class — June 2026</div>
      <div style={{ fontSize: 10, color: T.inkSoft, marginBottom: 14 }}>Share of total June 2026 net TTV</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map(({ label, tn, share, isOther }, i) => {
          const w = Math.max(2, (share / maxShare) * 100)
          return (
            <div key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: isOther ? T.inkSoft : T.ink }}>
                  {label} <span style={{ fontWeight: 400, color: T.inkSoft }}>({share.toFixed(1)}%)</span>
                </span>
                <span style={{ fontSize: 11, color: T.inkSoft }}>{fmtN(tn, { gbp: true })}</span>
              </div>
              <div style={{ height: 9, background: T.grey, borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${w}%`, height: '100%', background: isOther ? T.inkSoft : T.amber, borderRadius: 4 }} />
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ marginTop: 12, fontSize: 10, color: T.inkSoft, borderTop: `1px solid ${T.line}`, paddingTop: 8 }}>
        TTV = net of cancellations · FX→GBP at spot rates · ~0.02% multi-leg noise applies
      </div>
    </div>
  )
}

// ─── (c) Booking lead time ────────────────────────────────────────────────────
// Strip 'a. ' prefix for display
function stripBucketPrefix(b) { return b.replace(/^[a-f]\. /, '') }

function LeadTimeCard() {
  const lt26 = OPSX.LT?.['2606'] || {}
  const lt25 = OPSX.LT?.['2506'] || {}

  const total26 = Object.values(lt26).reduce((s, v) => s + v.b, 0) || 1
  const total25 = Object.values(lt25).reduce((s, v) => s + v.b, 0) || 1

  const buckets = ['a. 0-1 days', 'b. 2-7 days', 'c. 8-30 days', 'd. 31-90 days', 'e. 90+ days', 'f. Unknown']
    .filter(b => (lt26[b]?.b || 0) > 0 || (lt25[b]?.b || 0) > 0)

  const maxV = Math.max(...buckets.flatMap(b => [lt26[b]?.b || 0, lt25[b]?.b || 0]), 1)

  return (
    <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 4 }}>Booking lead time — June 2026 vs June 2025</div>
      <div style={{ fontSize: 10, color: T.inkSoft, marginBottom: 14 }}>Days between booking and pickup · pale bars = last June</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {buckets.map((b, i) => {
          const cur = lt26[b]?.b || 0
          const prv = lt25[b]?.b || 0
          const pct26 = (cur / total26 * 100).toFixed(0)
          const pct25 = (prv / total25 * 100).toFixed(0)
          const d = prv > 0 ? pctDelta(cur, prv) : null
          const curW = Math.max(2, (cur / maxV) * 100)
          const prvW = Math.max(2, (prv / maxV) * 100)
          return (
            <div key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: T.ink }}>
                  {stripBucketPrefix(b)} · {pct26}% <span style={{ fontWeight: 400, color: T.inkSoft }}>(LY {pct25}%)</span>
                </span>
                <span style={{ fontSize: 11, color: T.inkSoft }}>
                  {fmtN(prv)} → <strong style={{ color: T.ink }}>{fmtN(cur)}</strong>
                  {d != null && <span style={{ marginLeft: 6, fontWeight: 700, color: d >= 0 ? '#0A7A52' : T.coral }}>{d >= 0 ? '+' : ''}{d.toFixed(1)}%</span>}
                </span>
              </div>
              <div style={{ height: 6, background: T.grey, borderRadius: 3, marginBottom: 2, overflow: 'hidden' }}>
                <div style={{ width: `${prvW}%`, height: '100%', background: T.prior, borderRadius: 3 }} />
              </div>
              <div style={{ height: 9, background: T.grey, borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${curW}%`, height: '100%', background: T.teal, borderRadius: 4 }} />
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ marginTop: 10, fontSize: 10, color: T.inkSoft }}>
        Days between original booking date and first pickup leg · longer lead = more cancellation exposure
      </div>
    </div>
  )
}

// ─── (d) Cancellation rate by month — SVG bar chart ──────────────────────────
function CancRateChart() {
  const W = 560, H = 200
  const PAD = { l: 44, r: 12, t: 16, b: 38 }
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b
  const n = AXIS_MONTHS.length
  const gW = plotW / n
  const bW = Math.min(gW * 0.78, 28)

  const rates = AXIS_MONTHS.map(ym => ({
    ym,
    rate: LIVE[ym]?.cancRate || 0,
    c: LIVE[ym]?.canc || 0,
    b: LIVE[ym]?.gross || 0,
  }))

  const maxRate = Math.max(...rates.map(r => r.rate), 20)
  const yMax = Math.ceil(maxRate / 5) * 5

  const elems = []

  // Gridlines
  for (let i = 0; i <= 4; i++) {
    const y = PAD.t + plotH - (i / 4) * plotH
    const val = (yMax / 4 * i).toFixed(0)
    elems.push(<line key={'g' + i} x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke={T.line} strokeWidth={0.8} />)
    elems.push(<text key={'yl' + i} x={PAD.l - 4} y={y + 3} textAnchor="end" fontSize={8} fill={T.inkSoft}>{val}%</text>)
  }

  // 10% threshold line
  const y10 = PAD.t + plotH - (10 / yMax) * plotH
  elems.push(<line key="thresh" x1={PAD.l} y1={y10} x2={W - PAD.r} y2={y10} stroke={T.coral} strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />)
  elems.push(<text key="thresh-lbl" x={W - PAD.r - 2} y={y10 - 3} textAnchor="end" fontSize={7} fill={T.coral} opacity={0.8}>10%</text>)

  // Bars
  rates.forEach(({ ym, rate, c, b }, mi) => {
    const cx = PAD.l + mi * gW + gW / 2
    const bh = Math.max(2, (rate / yMax) * plotH)
    const y = PAD.t + plotH - bh
    const color = rate > 10 ? T.coral : '#0D8A72'
    const lbl = MONTH_LABEL[ym] || ym
    elems.push(
      <rect key={'bar' + mi} x={cx - bW / 2} y={y} width={bW} height={bh} fill={color} rx={2} opacity={0.85}>
        <title>{lbl}: {rate.toFixed(1)}% ({c} of {b})</title>
      </rect>
    )
    // X labels every 2nd
    if (mi % 2 === 0) {
      elems.push(<text key={'xl' + mi} x={cx} y={H - PAD.b + 14} textAnchor="middle" fontSize={8} fill={T.inkSoft}>{lbl}</text>)
    }
    // Rate label on bar if tall enough
    if (bh > 14) {
      elems.push(<text key={'vl' + mi} x={cx} y={y - 3} textAnchor="middle" fontSize={7} fill={T.inkSoft}>{rate.toFixed(1)}</text>)
    }
  })

  return (
    <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 4 }}>Cancellation rate by month</div>
      <div style={{ fontSize: 10, color: T.inkSoft, marginBottom: 12 }}>
        Gross bookings cancelled, % · green ≤10%, red &gt;10% · Apr 2025 – Jun 2026
      </div>
      <svg width={W} height={H} style={{ display: 'block', fontFamily: 'Inter,system-ui,sans-serif', maxWidth: '100%' }}>{elems}</svg>
      <div style={{ marginTop: 8, fontSize: 10, color: T.inkSoft }}>
        Migration months excluded from axis · Jan–Feb 2026 spike driven by post-migration cancellation clearing; Mar 2026 onward shows structural improvement.
      </div>
    </div>
  )
}

// ─── (e) Party size & AOV dual-line chart ─────────────────────────────────────
function PartyAOVChart() {
  const W = 560, H = 200
  const PAD = { l: 48, r: 52, t: 16, b: 38 }
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b
  const n = AXIS_MONTHS.length

  const data = AXIS_MONTHS.map(ym => ({
    ym,
    aov: LIVE[ym]?.aov || 0,
    avgPax: LIVE[ym]?.avgPax || 0,
  }))

  const maxAOV = Math.max(...data.map(d => d.aov), 80) * 1.1
  const maxPax = 4.0  // fixed right-hand scale
  const gW = plotW / (n - 1)

  const xOf = i => PAD.l + i * gW
  const yAOV = v => PAD.t + plotH - (v / maxAOV) * plotH
  const yPAX = v => PAD.t + plotH - (v / maxPax) * plotH

  const elems = []

  // Gridlines (left — AOV)
  for (let i = 0; i <= 4; i++) {
    const y = PAD.t + plotH - (i / 4) * plotH
    elems.push(<line key={'g' + i} x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke={T.line} strokeWidth={0.7} />)
    elems.push(<text key={'yl' + i} x={PAD.l - 4} y={y + 3} textAnchor="end" fontSize={8} fill={T.amber}>£{Math.round(maxAOV / 4 * i)}</text>)
  }
  // Right axis (pax)
  for (let i = 0; i <= 4; i++) {
    const y = PAD.t + plotH - (i / 4) * plotH
    elems.push(<text key={'yr' + i} x={W - PAD.r + 4} y={y + 3} textAnchor="start" fontSize={8} fill={T.pine}>{(maxPax / 4 * i).toFixed(1)}</text>)
  }
  // Axis labels
  elems.push(<text key="la" x={PAD.l - 34} y={PAD.t + plotH / 2} textAnchor="middle" fontSize={8} fill={T.amber} transform={`rotate(-90,${PAD.l - 34},${PAD.t + plotH / 2})`}>AOV (£)</text>)
  elems.push(<text key="ra" x={W - PAD.r + 40} y={PAD.t + plotH / 2} textAnchor="middle" fontSize={8} fill={T.pine} transform={`rotate(90,${W - PAD.r + 40},${PAD.t + plotH / 2})`}>Avg party size</text>)

  // AOV line (solid amber)
  const aovPath = 'M' + data.map((d, i) => `${xOf(i).toFixed(1)},${yAOV(d.aov).toFixed(1)}`).join('L')
  elems.push(<path key="aov-line" d={aovPath} fill="none" stroke={T.amber} strokeWidth={2.2} strokeLinejoin="round" />)
  data.forEach((d, i) => elems.push(
    <circle key={'a' + i} cx={xOf(i)} cy={yAOV(d.aov)} r={2.5} fill={T.amber}>
      <title>{MONTH_LABEL[d.ym]}: AOV £{d.aov.toFixed(0)}</title>
    </circle>
  ))

  // Party size line (dashed pine)
  const paxPath = 'M' + data.map((d, i) => `${xOf(i).toFixed(1)},${yPAX(d.avgPax).toFixed(1)}`).join('L')
  elems.push(<path key="pax-line" d={paxPath} fill="none" stroke={T.pine} strokeWidth={1.8} strokeDasharray="5 3" strokeLinejoin="round" />)
  data.forEach((d, i) => elems.push(
    <circle key={'p' + i} cx={xOf(i)} cy={yPAX(d.avgPax)} r={2} fill={T.pine}>
      <title>{MONTH_LABEL[d.ym]}: avg {d.avgPax.toFixed(2)} pax</title>
    </circle>
  ))

  // X labels every 2nd month
  data.forEach((d, i) => {
    if (i % 2 !== 0) return
    elems.push(<text key={'xl' + i} x={xOf(i)} y={H - PAD.b + 14} textAnchor="middle" fontSize={8} fill={T.inkSoft}>{MONTH_LABEL[d.ym]}</text>)
  })

  // In-chart labels (latest values)
  const last = data[data.length - 1]
  const lastI = data.length - 1

  return (
    <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 2 }}>Average party size & order value</div>
          <div style={{ fontSize: 10, color: T.inkSoft }}>Monthly · Apr 2025 – Jun 2026</div>
        </div>
        <div style={{ display: 'flex', gap: 14, fontSize: 10 }}>
          <span style={{ color: T.amber, fontWeight: 700 }}>── AOV (solid) — latest £{last.aov.toFixed(0)}</span>
          <span style={{ color: T.pine, fontWeight: 700 }}>- - avg party size (dashed) — latest {last.avgPax.toFixed(2)}</span>
        </div>
      </div>
      <svg width={W} height={H} style={{ display: 'block', fontFamily: 'Inter,system-ui,sans-serif', maxWidth: '100%' }}>{elems}</svg>
    </div>
  )
}

// ─── Main exported component ──────────────────────────────────────────────────
export default function OpsRevenueTab() {
  const [expanded, setExpanded] = useState(false)
  const asOf = new Date(OPS_AS_OF).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <div style={{ padding: '0 0 32px' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontFamily: 'Georgia,serif', fontSize: 20, fontWeight: 700, color: T.ink, margin: '0 0 6px' }}>
          Operations & revenue — all Hoppa channels
        </h2>
        <div style={{ fontSize: 11, color: T.inkSoft, lineHeight: 1.6 }}>
          Every sales channel · by booking date · TTV net of cancellations, FX→GBP · splits from Apr 2025 ·{' '}
          <span style={{ color: T.inkSoft }}>data as of {asOf}</span>{' '}
          <button onClick={() => setExpanded(e => !e)}
            style={{ background: 'none', border: 'none', color: T.leaf, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
            methodology {expanded ? '▴' : '▾'}
          </button>
        </div>
        {expanded && (
          <div style={{ marginTop: 8, padding: '10px 14px', background: T.paper, border: `1px solid ${T.line}`, borderRadius: 8, fontSize: 11, color: T.inkSoft, lineHeight: 1.7, maxWidth: 700 }}>
            <strong style={{ color: T.ink }}>KPI layer:</strong> June and Q2 anchors come from the site-wide daily dispatch dataset (same source as Network Pulse — one number, zero tolerance).<br />
            <strong style={{ color: T.ink }}>Split layer:</strong> Vehicle, lead-time, and party-size splits run a ride-level deduplication query. ANY_VALUE on multi-leg rides introduces ~0.02% noise (D2) — splits show mix and direction; totals always defer to KPIs.<br />
            <strong style={{ color: T.ink }}>Live-table drift (D3):</strong> Cancellations land on old bookings continuously. Numbers shown are as of the pull timestamp above; a re-pull hours later may differ by a few rides.<br />
            <strong style={{ color: T.ink }}>Cancellation origin/type:</strong> These fields are unrecorded for Hoppa rides (confirmed by probe — 100% null). No breakdown card is shown; the monthly rate trend tells the story.<br />
            <strong style={{ color: T.ink }}>Anchor periods:</strong> June 2026 vs June 2025 and Q2 2026 vs Q2 2025 — both post-migration, fully coded months. No timeframe controls on this page.
          </div>
        )}
      </div>

      {/* (a) KPI cards */}
      <KPICards />

      {/* (b) Vehicle mix */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <VehicleNetBars />
        <VehicleTTVShare />
      </div>

      {/* (c) Lead time */}
      <div style={{ marginBottom: 16 }}>
        <LeadTimeCard />
      </div>

      {/* (d) Cancellation rate trend */}
      <div style={{ marginBottom: 16 }}>
        <CancRateChart />
      </div>

      {/* (e) Party size & AOV */}
      <PartyAOVChart />
    </div>
  )
}
