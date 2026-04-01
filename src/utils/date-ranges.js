import {
  subDays,
  subWeeks,
  subMonths,
  subYears,
  subQuarters,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  startOfYear,
  endOfYear,
  startOfISOWeek,
  endOfISOWeek,
  format,
  differenceInDays,
} from 'date-fns'

const fmt = (d) => format(d, 'yyyy-MM-dd')
const today = () => new Date()

/**
 * Returns { primary: {startDate, endDate}, comparison: {startDate, endDate} | null }
 */
export function computeDateRanges(preset, comparison, customRange = null) {
  const now = today()
  let start, end

  switch (preset) {
    case 'today':
      start = now; end = now; break
    case 'yesterday':
      start = subDays(now, 1); end = subDays(now, 1); break
    case 'last7d':
      start = subDays(now, 7); end = subDays(now, 1); break
    case 'last14d':
      start = subDays(now, 14); end = subDays(now, 1); break
    case 'last28d':
      start = subDays(now, 28); end = subDays(now, 1); break
    case 'last30d':
      start = subDays(now, 30); end = subDays(now, 1); break
    case 'last60d':
      start = subDays(now, 60); end = subDays(now, 1); break
    case 'last90d':
      start = subDays(now, 90); end = subDays(now, 1); break
    case 'thisWeek':
      start = startOfISOWeek(now); end = now; break
    case 'lastWeek': {
      const lw = subWeeks(now, 1)
      start = startOfISOWeek(lw); end = endOfISOWeek(lw); break
    }
    case 'last2weeks':
      start = startOfISOWeek(subWeeks(now, 2)); end = endOfISOWeek(subWeeks(now, 1)); break
    case 'last4weeks':
      start = startOfISOWeek(subWeeks(now, 4)); end = endOfISOWeek(subWeeks(now, 1)); break
    case 'thisMonth':
      start = startOfMonth(now); end = now; break
    case 'lastMonth': {
      const lm = subDays(startOfMonth(now), 1)
      start = startOfMonth(lm); end = endOfMonth(lm); break
    }
    case 'last3months':
      start = startOfMonth(subMonths(now, 3)); end = endOfMonth(subMonths(now, 1)); break
    case 'last6months':
      start = startOfMonth(subMonths(now, 6)); end = endOfMonth(subMonths(now, 1)); break
    case 'last12months':
      start = startOfMonth(subMonths(now, 12)); end = endOfMonth(subMonths(now, 1)); break
    case 'quarter':
      start = startOfQuarter(now); end = now; break
    case 'lastQuarter': {
      const lq = subQuarters(now, 1)
      start = startOfQuarter(lq); end = endOfQuarter(lq); break
    }
    case 'last2quarters': {
      const lq2 = subQuarters(now, 2)
      start = startOfQuarter(lq2); end = endOfQuarter(subQuarters(now, 1)); break
    }
    case 'ytd':
      start = startOfYear(now); end = now; break
    case 'lastYear': {
      const ly = subYears(now, 1)
      start = startOfYear(ly); end = endOfYear(ly); break
    }
    case 'custom':
      start = customRange?.start ?? subDays(now, 30)
      end   = customRange?.end   ?? now
      break
    default:
      start = subDays(now, 30); end = subDays(now, 1)
  }

  const primary = { startDate: fmt(start), endDate: fmt(end) }

  if (!comparison || comparison === 'off') {
    return { primary, comparison: null }
  }

  let cStart, cEnd
  const rangeDays = differenceInDays(end, start)

  if (comparison === 'prevPeriod') {
    cEnd   = subDays(start, 1)
    cStart = subDays(cEnd, rangeDays)
  } else if (comparison === 'prevYear') {
    cStart = subYears(start, 1)
    cEnd   = subYears(end, 1)
  }

  return {
    primary,
    comparison: cStart && cEnd ? { startDate: fmt(cStart), endDate: fmt(cEnd) } : null,
  }
}

export const DATE_PRESETS = [
  // Days
  { group: 'Days',     value: 'today',        label: 'Today' },
  { group: 'Days',     value: 'yesterday',    label: 'Yesterday' },
  { group: 'Days',     value: 'last7d',       label: 'Last 7 days' },
  { group: 'Days',     value: 'last14d',      label: 'Last 14 days' },
  { group: 'Days',     value: 'last28d',      label: 'Last 28 days' },
  { group: 'Days',     value: 'last30d',      label: 'Last 30 days' },
  { group: 'Days',     value: 'last60d',      label: 'Last 60 days' },
  { group: 'Days',     value: 'last90d',      label: 'Last 90 days' },
  // Weeks
  { group: 'Weeks',    value: 'thisWeek',     label: 'This week' },
  { group: 'Weeks',    value: 'lastWeek',     label: 'Last week' },
  { group: 'Weeks',    value: 'last2weeks',   label: 'Last 2 weeks' },
  { group: 'Weeks',    value: 'last4weeks',   label: 'Last 4 weeks' },
  // Months
  { group: 'Months',   value: 'thisMonth',    label: 'This month' },
  { group: 'Months',   value: 'lastMonth',    label: 'Last month' },
  { group: 'Months',   value: 'last3months',  label: 'Last 3 months' },
  { group: 'Months',   value: 'last6months',  label: 'Last 6 months' },
  { group: 'Months',   value: 'last12months', label: 'Last 12 months' },
  // Quarters
  { group: 'Quarters', value: 'quarter',      label: 'This quarter' },
  { group: 'Quarters', value: 'lastQuarter',  label: 'Last quarter' },
  { group: 'Quarters', value: 'last2quarters',label: 'Last 2 quarters' },
  // Year
  { group: 'Year',     value: 'ytd',          label: 'Year to date' },
  { group: 'Year',     value: 'lastYear',     label: 'Last year' },
  { group: 'Year',     value: 'thisYear',     label: 'This year (Jan–today)' },
  // Custom
  { group: '',         value: 'custom',       label: 'Custom Range' },
]

export const COMPARISON_OPTIONS = [
  { value: 'off', label: 'No comparison' },
  { value: 'prevPeriod', label: 'vs Previous Period' },
  { value: 'prevYear', label: 'vs Same Period Last Year' },
]

/**
 * Returns a human-readable date range label from the current filters.
 * Named presets → "Last 30 days"
 * Custom range  → "Mar 1 – Mar 26 2026"
 */
export function getDateRangeLabel(filters) {
  if (!filters) return ''
  if (filters.preset !== 'custom') {
    const found = DATE_PRESETS.find(p => p.value === filters.preset)
    return found ? found.label : filters.preset
  }
  // Custom range — format from primary date range
  const primary = filters.dateRanges?.primary
  if (!primary) return 'Custom Range'
  const s = new Date(primary.startDate + 'T00:00:00')
  const e = new Date(primary.endDate   + 'T00:00:00')
  const fmtDate = (d) => format(d, 'MMM d')
  const fmtYear = (d) => format(d, 'yyyy')
  if (fmtYear(s) === fmtYear(e)) {
    return `${fmtDate(s)} – ${format(e, 'MMM d yyyy')}`
  }
  return `${format(s, 'MMM d yyyy')} – ${format(e, 'MMM d yyyy')}`
}
