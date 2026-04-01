import { startOfWeek, startOfMonth, startOfQuarter, format, parseISO, getYear } from 'date-fns'

export function granularityKey(dateStr, gran) {
  if (!dateStr) return ''
  const d = parseISO(dateStr)
  switch (gran?.toLowerCase()) {
    case 'week':    return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd')
    case 'month':   return format(startOfMonth(d), 'yyyy-MM-dd')
    case 'quarter': return format(startOfQuarter(d), 'yyyy-MM-dd')
    case 'year':    return String(getYear(d))
    default:        return dateStr // Day
  }
}

export function granularityLabel(key, gran) {
  if (!key) return ''
  if (gran?.toLowerCase() === 'year') return key
  const d = parseISO(key)
  switch (gran?.toLowerCase()) {
    case 'week':    return `w/c ${format(d, 'MMM d')}`
    case 'month':   return format(d, 'MMM yy')
    case 'quarter': return `Q${Math.ceil((d.getMonth() + 1) / 3)} ${format(d, 'yy')}`
    default:        return format(d, 'MMM d') // Day
  }
}

// aggregateTrend handles data arrays where objects have arbitrary numeric fields
export function aggregateTrend(trendData, gran) {
  if (!trendData || trendData.length === 0) return []

  const buckets = {}
  trendData.forEach(row => {
    const key = granularityKey(row.date, gran)
    if (!buckets[key]) {
      // Initialize a new bucket copying string/id properties, zeroing out numbers
      buckets[key] = { key }
      for (const [k, v] of Object.entries(row)) {
        if (typeof v === 'number') buckets[key][k] = 0
        else if (k !== 'date') buckets[key][k] = v // retain non-date strings
      }
    }
    // Sum numeric fields into the bucket
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'number') {
        buckets[key][k] += v
      }
    }
  })
  
  // Sort chronologically
  return Object.values(buckets).sort((a, b) => a.key.localeCompare(b.key))
}
