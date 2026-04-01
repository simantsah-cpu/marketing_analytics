import { useState, useEffect, useRef } from 'react'
import { format } from 'date-fns'
import { DATE_PRESETS, getDateRangeLabel } from '../../utils/date-ranges'

// Group presets by their group label
const GROUPS = []
DATE_PRESETS.filter(p => p.value !== 'custom').forEach(p => {
  const g = GROUPS.find(g => g.label === p.group)
  if (g) g.items.push(p)
  else GROUPS.push({ label: p.group, items: [p] })
})

const today = () => new Date().toISOString().slice(0, 10)

export default function DateRangePicker({ filters, actions }) {
  const [open, setOpen]     = useState(false)
  const [fromVal, setFrom]  = useState('')
  const [toVal, setTo]      = useState('')
  const [error, setError]   = useState('')
  const ref = useRef(null)

  // Sync custom inputs when custom is already selected
  useEffect(() => {
    if (filters.preset === 'custom' && filters.dateRanges?.primary) {
      setFrom(filters.dateRanges.primary.startDate)
      setTo(filters.dateRanges.primary.endDate)
    }
  }, [filters.preset, filters.dateRanges])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selectPreset = (value) => {
    actions.setPreset(value)
    setOpen(false)
    setError('')
  }

  const applyCustom = () => {
    if (!fromVal || !toVal) { setError('Please select both dates.'); return }
    const f = new Date(fromVal + 'T00:00:00')
    const t = new Date(toVal  + 'T00:00:00')
    const now = new Date(); now.setHours(23, 59, 59)
    if (f > t) { setError('"From" must be before "To".'); return }
    if (t > now) { setError('"To" date cannot be in the future.'); return }
    setError('')
    actions.setCustomRange({ start: f, end: t })
    actions.setPreset('custom')
    setOpen(false)
  }

  const label = getDateRangeLabel(filters)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', border: '1px solid var(--border)',
          borderRadius: 6, background: open ? 'var(--blue-light)' : '#fff',
          color: open ? 'var(--blue)' : 'var(--navy)',
          fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
          cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.12s',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        {label}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points={open ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 1000,
          width: 520, background: '#fff', border: '1px solid var(--border)',
          borderRadius: 12, boxShadow: '0 8px 32px rgba(10,37,64,0.14)',
          display: 'flex', overflow: 'hidden',
        }}>

          {/* LEFT — Preset list */}
          <div style={{
            width: 220, borderRight: '1px solid var(--border)',
            overflowY: 'auto', maxHeight: 420, padding: '8px 0',
          }}>
            {GROUPS.map(group => (
              <div key={group.label}>
                {group.label && (
                  <div style={{
                    padding: '10px 14px 4px', fontSize: 10, fontWeight: 700,
                    letterSpacing: '0.07em', color: 'var(--subtext)',
                    textTransform: 'uppercase',
                  }}>
                    {group.label}
                  </div>
                )}
                {group.items.map(p => {
                  const active = filters.preset === p.value
                  return (
                    <button
                      key={p.value}
                      onClick={() => selectPreset(p.value)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        width: '100%', textAlign: 'left',
                        padding: '6px 14px', border: 'none',
                        background: active ? 'var(--blue-light)' : 'transparent',
                        color: active ? 'var(--blue)' : 'var(--navy)',
                        fontSize: 12.5, fontWeight: active ? 600 : 400,
                        fontFamily: 'inherit', cursor: 'pointer',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg)' }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                    >
                      {p.label}
                      {active && <span style={{ fontSize: 13 }}>✓</span>}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {/* RIGHT — Custom date range */}
          <div style={{ flex: 1, padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)', marginBottom: 2 }}>
              Custom date range
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--subtext)' }}>From</label>
              <input
                type="date"
                value={fromVal}
                max={today()}
                onChange={e => { setFrom(e.target.value); setError('') }}
                style={{
                  padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 7,
                  fontSize: 13, fontFamily: 'inherit', color: 'var(--navy)',
                  outline: 'none', cursor: 'pointer', width: '100%', boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--subtext)' }}>To</label>
              <input
                type="date"
                value={toVal}
                max={today()}
                onChange={e => { setTo(e.target.value); setError('') }}
                style={{
                  padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 7,
                  fontSize: 13, fontFamily: 'inherit', color: 'var(--navy)',
                  outline: 'none', cursor: 'pointer', width: '100%', boxSizing: 'border-box',
                }}
              />
            </div>

            {error && (
              <div style={{ fontSize: 11, color: '#DC2626', marginTop: -8 }}>{error}</div>
            )}

            <button
              onClick={applyCustom}
              style={{
                marginTop: 'auto', padding: '8px 0',
                background: 'var(--blue)', color: '#fff', border: 'none',
                borderRadius: 7, fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                cursor: 'pointer', transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              Apply
            </button>

            {filters.preset === 'custom' && filters.dateRanges?.primary && (
              <div style={{ fontSize: 11, color: 'var(--subtext)', textAlign: 'center', marginTop: -8 }}>
                {getDateRangeLabel(filters)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
