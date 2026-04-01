import { useState, useEffect, useRef } from 'react'

/**
 * MultiSelectFilter
 * Supports both plain string[] options and { value, label }[] options.
 * When options are objects, selection stores/emits raw .value (for GA4), displays .label.
 *
 * Props:
 *   label       string  — button label when nothing selected, e.g. "All Affiliates"
 *   options     string[] | { value, label }[] — available options
 *   selected    string[] — currently selected raw values (empty = "all")
 *   onApply     (string[]) => void — called with new selection (empty = "all")
 *   minWidth    number — min width of the trigger button (default 130)
 */
export default function MultiSelectFilter({ label, options, selected = [], onApply, minWidth = 130 }) {
  const [open, setOpen]       = useState(false)
  const [draft, setDraft]     = useState(selected)
  const [search, setSearch]   = useState('')
  const ref = useRef(null)

  // Normalise options to { value, label } regardless of input shape
  const normOpts = options.map(o => typeof o === 'string' ? { value: o, label: o } : o)

  // Sync draft when external selection changes (e.g. Reset Filters)
  useEffect(() => { setDraft(selected) }, [selected])

  // Reset draft and close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false)
        setDraft(selected) // revert uncommitted changes
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, selected])

  const filtered = normOpts.filter(o =>
    o.label.toLowerCase().includes(search.toLowerCase())
  )

  const toggleOption = (val) => {
    setDraft(prev =>
      prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]
    )
  }

  const selectAll = () => setDraft([])
  const clear     = () => setDraft(options.slice()) // select all individual items ≡ "all"

  const handleApply = () => {
    onApply(draft)
    setOpen(false)
    setSearch('')
  }

  // Button display label
  const displayLabel = selected.length === 0
    ? label
    : selected.length === 1
      ? (normOpts.find(o => o.value === selected[0])?.label ?? selected[0])
      : `${selected.length} selected`

  const isActive = selected.length > 0

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => { setDraft(selected); setOpen(o => !o) }}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '5px 8px 5px 10px', border: '1px solid var(--border)', borderRadius: 6,
          background: isActive ? 'var(--blue-light)' : '#fff',
          color: isActive ? 'var(--blue)' : 'var(--navy)',
          fontSize: 12, fontWeight: isActive ? 700 : 500,
          fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
          minWidth, textAlign: 'left', justifyContent: 'space-between',
          transition: 'all 0.12s',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: minWidth - 30 }}>
          {displayLabel}
        </span>
        {isActive && (
          <span style={{
            fontSize: 10, fontWeight: 700, background: 'var(--blue)',
            color: '#fff', borderRadius: '50%', width: 16, height: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            {selected.length}
          </span>
        )}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
          <polyline points={open ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 5px)', left: 0, zIndex: 1000,
          width: Math.max(minWidth + 60, 220),
          background: '#fff', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 8px 28px rgba(10,37,64,0.13)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* Search */}
          {options.length > 6 && (
            <div style={{ padding: '10px 10px 6px' }}>
              <input
                autoFocus
                type="text"
                placeholder="Search…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '5px 8px', border: '1px solid var(--border)',
                  borderRadius: 6, fontSize: 12, fontFamily: 'inherit',
                  color: 'var(--navy)', outline: 'none',
                }}
              />
            </div>
          )}

          {/* All / Clear row */}
          <div style={{ display: 'flex', gap: 6, padding: '6px 10px 4px', borderBottom: '1px solid var(--border)' }}>
            <button onClick={selectAll}
              style={{
                flex: 1, padding: '3px 0', border: '1px solid var(--border)',
                borderRadius: 5, background: draft.length === 0 ? 'var(--blue-light)' : '#fff',
                color: draft.length === 0 ? 'var(--blue)' : 'var(--subtext)',
                fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
              }}>All</button>
            <button onClick={() => setDraft([])}
              style={{
                flex: 1, padding: '3px 0', border: '1px solid var(--border)',
                borderRadius: 5, background: '#fff', color: 'var(--subtext)',
                fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
              }}>Clear</button>
          </div>

          {/* Options list */}
          <div style={{ overflowY: 'auto', maxHeight: 240 }}>
            {filtered.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--subtext)' }}>No results</div>
            )}
            {filtered.map(opt => {
              const checked = draft.includes(opt.value)
              return (
                <label key={opt.value} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 12px', cursor: 'pointer',
                  fontSize: 12.5, color: 'var(--navy)',
                  background: checked ? 'var(--blue-light)' : 'transparent',
                  transition: 'background 0.1s',
                }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleOption(opt.value)}
                    style={{ accentColor: 'var(--blue)', width: 14, height: 14, flexShrink: 0 }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {opt.label}
                  </span>
                </label>
              )
            })}
          </div>

          {/* Apply button */}
          <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)' }}>
            <button
              onClick={handleApply}
              style={{
                width: '100%', padding: '7px 0',
                background: 'var(--blue)', color: '#fff', border: 'none',
                borderRadius: 7, fontSize: 12.5, fontWeight: 700,
                fontFamily: 'inherit', cursor: 'pointer',
              }}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
