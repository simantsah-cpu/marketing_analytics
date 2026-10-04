// Profitability building blocks — reused by every Profitability page.
import { useMemo, useState } from 'react'
import { sortRows, filterRows, defaultDir } from './tableSort.js'

/** Page title, "Data as of" badge (tooltip: pinned time + warehouse load) and subtitle. */
export function PageHeader({ title, h, loading }) {
  return (
    <div className="pf-head">
      <h1>
        <span>{title}</span>
        {(loading || h) && (
          <span className="pf-badge" title={loading ? '' : h.badgeTooltip}>{loading ? 'Loading…' : h.badge}</span>
        )}
      </h1>
      <p>{h?.subtitle ?? '\u00a0'}</p>
    </div>
  )
}

export function Delta({ d }) {
  if (!d) return null
  return <span className={`pf-dl ${d.tone}`}>{d.text}</span>
}

/**
 * KPI card. `delta` (with its suffix) or `noComparison` fills the second line; `sub2` is a plain
 * muted second line instead. `subTitle` truncates the first sub-line to one line with a tooltip.
 */
export function KpiCard({ label, value, sub, delta, noComparison, tone, sub2, subTitle }) {
  return (
    <div className="pf-kcard">
      <div className="pf-kl">{label}</div>
      <div className={`pf-kv${tone ? ` ${tone}` : ''}`}>{value}</div>
      <div className={`pf-ks${subTitle ? ' pf-one-line' : ''}`} title={subTitle || undefined}>{sub}</div>
      {delta !== undefined && (
        <div className="pf-kd">
          {delta ? <><Delta d={delta} /> {delta.suffix}</> : noComparison}
        </div>
      )}
      {sub2 && <div className="pf-kd">{sub2}</div>}
    </div>
  )
}

export function Panel({ span = 12, title, action, subtitle, children }) {
  return (
    <figure className={`pf-panel s${span}`}>
      <h3>{title}{action}</h3>
      {subtitle ? <p className="pf-sub">{subtitle}</p> : <p className="pf-sub">&nbsp;</p>}
      {children}
    </figure>
  )
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <span className="pf-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  )
}

export function Swatch({ color }) {
  return <span className="pf-sw" style={{ background: color }} aria-hidden="true" />
}

/**
 * Sortable table. columns: [{ key, label, num, value(row) → sortable, render(row), foot, sortable }]
 * Clicking a header sorts by it (text ascending first, numbers descending); clicking again
 * flips direction. Options:
 *   pinLast(row)  rows that always stay at the bottom (e.g. Unmapped)
 *   search        { placeholder, fields: [row → text] } — filter box above the table
 *   limit         show this many rows, with a "Show all {N}" toggle
 *   step          with limit: "Show {step} more" + "Show all {N}" instead of the toggle
 *   onRowClick    row → void; selectedKey marks the selected row
 *   defaultDir    first direction for defaultSort (-1 descending, 1 ascending)
 */
export function SortableTable({
  columns, rows, defaultSort, footer = true, rowKey = (r) => r.name,
  pinLast, search, limit, step, onRowClick, selectedKey, rowClass, defaultDir: firstDir = -1,
}) {
  const [sort, setSort] = useState({ key: defaultSort, dir: firstDir })
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(limit ?? Infinity)
  const col = columns.find((c) => c.key === sort.key) ?? columns[0]
  const sorted = useMemo(() => {
    const filtered = search ? filterRows(rows, q, search.fields) : rows
    return sortRows(filtered, col.value, sort.dir, pinLast)
  }, [rows, col, sort.dir, pinLast, search, q])
  const visible = sorted.slice(0, shown)
  const click = (c) => setSort((s) => (s.key === c.key
    ? { key: c.key, dir: -s.dir }
    : { key: c.key, dir: defaultDir(c.value(rows[0] ?? {})) }))
  const activate = (r) => onRowClick && onRowClick(r)
  return (
    <>
      {search && (
        <div className="pf-tsearch">
          <label>
            <span className="pf-vh">{search.placeholder}</span>
            <input type="search" placeholder={search.placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
      )}
      <div className="pf-twrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={c.num ? 'num' : ''}
                  aria-sort={c.sortable === false ? undefined : sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
                  {c.sortable === false ? c.label : (
                    <button type="button" onClick={() => click(c)}>
                      {c.label}{sort.key === c.key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const k = rowKey(r)
              const cls = [onRowClick ? 'pf-clickable' : '', k === selectedKey ? 'pf-selected' : '', pinLast?.(r) ? 'pf-pinned' : '', rowClass?.(r) ?? '']
                .filter(Boolean).join(' ')
              return (
                <tr key={k} className={cls || undefined}
                  onClick={onRowClick ? () => activate(r) : undefined}
                  onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(r) } } : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-selected={onRowClick ? k === selectedKey : undefined}>
                  {columns.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render(r)}</td>)}
                </tr>
              )
            })}
          </tbody>
          {footer && (
            <tfoot>
              <tr>{columns.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.foot ?? ''}</td>)}</tr>
            </tfoot>
          )}
        </table>
        {!sorted.length && <p className="pf-empty">Nothing matches.</p>}
      </div>
      {limit && sorted.length > limit && (
        <div className="pf-more-row">
          {shown < sorted.length && step && (
            <button type="button" className="pf-more" onClick={() => setShown((n) => n + step)}>Show {step} more</button>
          )}
          {shown < sorted.length ? (
            <button type="button" className={step ? 'pf-more-link' : 'pf-more'} onClick={() => setShown(Infinity)}>Show all {sorted.length}</button>
          ) : (
            <button type="button" className="pf-more" onClick={() => setShown(limit)}>Show top {limit}</button>
          )}
        </div>
      )}
    </>
  )
}

/** 84×22 monthly-profit sparkline from sparkline() geometry; decorative (numbers are in the row). */
export function Sparkline({ s }) {
  if (!s) return null
  return (
    <svg className="pf-spark" width="84" height="22" viewBox="0 0 84 22" aria-hidden="true">
      <line x1="0" x2="84" y1={s.zeroY} y2={s.zeroY} stroke="#C7D0DC" strokeWidth="1" />
      <polyline points={s.points} fill="none" stroke={s.negative ? '#D64545' : '#2D5BA6'} strokeWidth="1.6"
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function Skeleton({ h, w = '100%', style }) {
  return <div className="pf-skel" style={{ height: h, width: w, ...style }} />
}

export function KpiSkeleton() {
  return (
    <div className="pf-kcard" aria-hidden="true">
      <Skeleton h={18} w="55%" />
      <Skeleton h={38} w="70%" style={{ margin: '12px 0 10px' }} />
      <Skeleton h={16} w="80%" />
      <Skeleton h={16} w="65%" style={{ marginTop: 10 }} />
    </div>
  )
}

export function PanelSkeleton({ span, height }) {
  return (
    <figure className={`pf-panel s${span}`} aria-hidden="true">
      <Skeleton h={24} w="45%" />
      <Skeleton h={18} w="35%" style={{ margin: '8px 0 18px' }} />
      <Skeleton h={height} />
    </figure>
  )
}
