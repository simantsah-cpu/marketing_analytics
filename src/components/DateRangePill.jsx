import { format, parseISO } from 'date-fns'

/**
 * Shared date-range context row.
 * Shows: ● Feb 25, 2026 – Mar 26, 2026  vs Prev Period:  ● Jan 26, 2026 – Feb 24, 2026
 *
 * Props:
 *   dateRanges  — filters.dateRanges  ({ primary, comparison })
 *   comparison  — filters.comparison  ('off' | 'prevPeriod' | 'prevYear')
 */
export default function DateRangePill({ dateRanges, comparison }) {
  if (!dateRanges?.primary) return null

  const fmtR = (r) =>
    r?.startDate && r?.endDate
      ? `${format(parseISO(r.startDate), 'MMM d, yyyy')} – ${format(parseISO(r.endDate), 'MMM d, yyyy')}`
      : null

  const cur  = fmtR(dateRanges.primary)
  const comp = fmtR(dateRanges.comparison)
  const mode =
    comparison === 'prevPeriod' ? 'vs Prev Period' :
    comparison === 'prevYear'   ? 'vs Last Year'   : null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 5, marginBottom: 16, flexWrap: 'wrap' }}>
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
}
