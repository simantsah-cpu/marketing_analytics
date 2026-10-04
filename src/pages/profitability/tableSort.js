// Table filtering and ordering shared by every Profitability table.

/**
 * Sorts rows by `value(row)` in `dir` (1 ascending, -1 descending). Nulls sort last in either
 * direction, and rows for which `pinLast(row)` is truthy always stay at the bottom; a number
 * is a tier (e.g. 1 = "(no service area)", 2 = a roll-up row below it).
 * @param {any[]} rows
 * @param {(row: any) => any} value
 * @param {number} dir
 * @param {(row: any) => boolean | number} [pinLast]
 */
export function sortRows(rows, value, dir, pinLast = () => false) {
  return rows.slice().sort((a, b) => {
    const pa = +pinLast(a) || 0, pb = +pinLast(b) || 0
    if (pa !== pb) return pa - pb
    const x = value(a), y = value(b)
    if (x == null && y == null) return 0
    if (x == null) return 1
    if (y == null) return -1
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir
  })
}

/** Case-insensitive substring match on any of the given fields. */
export function filterRows(rows, query, fields) {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((r) => fields.some((f) => String(f(r) ?? '').toLowerCase().includes(q)))
}

/** First sort direction for a column: text ascending, numbers descending. */
export const defaultDir = (sample) => (typeof sample === 'string' ? 1 : -1)
