import { format } from 'date-fns'

/**
 * KPICard
 * Props:
 *   label       string  — KPI name
 *   value       number  — current value
 *   prev        number  — comparison value (optional)
 *   format      'number' | 'currency' | 'percent' | 'duration'
 *   prefix      string  — e.g. '£'
 *   suffix      string  — e.g. '%'
 *   primary     boolean — if true, uses solid blue background
 *   sub         string  — subtitle text (e.g. '26 Feb – 2 Mar 2026')
 */
export default function KPICard({ label, value, prev, format: fmt = 'number', decimals = 2, prefix = '', suffix = '', primary = false, sub = 'vs prior period', customBadgeLabel, customBadgeClass }) {
  const formatted = formatValue(value, fmt, decimals, prefix, suffix)

  let delta = null
  let deltaLabel = null
  let badgeClass = 'neutral'
  let arrow = '→'

  if (customBadgeLabel) {
    deltaLabel = customBadgeLabel
    badgeClass = customBadgeClass || 'neutral'
    delta = 1
  } else if (prev != null && prev !== 0 && value != null) {
    if (fmt === 'percent') {
      const pp = (value - prev) * 100
      delta = pp
      if (pp > 0) { badgeClass = 'up'; arrow = '▲'; deltaLabel = `${arrow} ${pp.toFixed(1)}pp WoW` }
      else if (pp < 0) { badgeClass = 'down'; arrow = '▼'; deltaLabel = `${arrow} ${Math.abs(pp).toFixed(1)}pp WoW` }
      else { badgeClass = 'neutral'; arrow = '→'; deltaLabel = `${arrow} 0.0pp WoW` }
    } else {
      const pct = ((value - prev) / Math.abs(prev)) * 100
      delta = pct
      const labelText = primary ? 'vs prev week' : 'WoW'
      if (pct > 0) { badgeClass = 'up'; arrow = '▲'; deltaLabel = `${arrow} ${pct.toFixed(1)}% ${labelText}` }
      else if (pct < 0) { badgeClass = 'down'; arrow = '▼'; deltaLabel = `${arrow} ${Math.abs(pct).toFixed(1)}% ${labelText}` }
      else { badgeClass = 'neutral'; arrow = '→'; deltaLabel = `${arrow} 0.0 ${labelText}` }
    }
  }

  return (
    <div className={`kpi-card ${primary ? 'primary' : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{formatted}</div>
      {delta != null && (
        <span className={`kpi-badge ${badgeClass}`}>{deltaLabel}</span>
      )}
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

function formatValue(value, fmt, decimals, prefix, suffix) {
  if (value == null || isNaN(value)) return '—'

  switch (fmt) {
    case 'currency-compact':
      if (value >= 1000) return `£${(value / 1000).toFixed(1)}K`
      return `£${Number(value).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`
    case 'currency':
      if (value >= 10000) return `£${Math.round(value / 1000)}K`
      return `£${Number(value).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`
    case 'currency-decimal':
      return `£${Number(value).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    case 'percent':
      return `${(value * 100).toFixed(decimals)}%`
    case 'duration': {
      const mins = Math.floor(value / 60)
      const secs = Math.floor(value % 60)
      return `${mins}m ${String(secs).padStart(2, '0')}s`
    }
    case 'number':
    default:
      if (decimals !== 2) {
        return `${prefix}${Number(value).toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`
      }
      return `${prefix}${Number(value).toLocaleString('en-GB', { maximumFractionDigits: 2 })}${suffix}`
  }
}
