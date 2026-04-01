import { useLocation } from 'react-router-dom'
import { useProperty } from '../../context/PropertyContext'

const PAGE_INFO = {
  '/':           { title: 'Executive Summary',        sub: 'VP-level overview · Affiliate channel performance' },
  '/traffic':    { title: 'Traffic & Engagement',     sub: 'Session quality & user behaviour analysis' },
  '/commercial': { title: 'Commercial Performance',   sub: 'Bookings, revenue, conversion rate & AOV' },
  '/funnel':     { title: 'Funnel Analysis',          sub: 'Full booking funnel · drop-off investigation' },
}

export default function Topbar() {
  const location = useLocation()
  const info = PAGE_INFO[location.pathname] || PAGE_INFO['/']
  const { properties, selectedProperty, switchProperty } = useProperty()

  return (
    <header className="topbar">
      {/* Page title */}
      <div style={{ paddingRight: 24 }}>
        <div className="topbar-title">{info.title}</div>
        <div className="topbar-sub">{info.sub}</div>
      </div>

      {/* Property switcher — right side */}
      <div className="topbar-right">
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <svg
            style={{ position: 'absolute', left: 10, pointerEvents: 'none', color: 'var(--blue)' }}
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          <select
            value={selectedProperty?.id ?? ''}
            onChange={e => {
              const prop = properties.find(p => p.id === e.target.value)
              if (prop) switchProperty(prop)
            }}
            style={{
              paddingLeft: 30, paddingRight: 28, paddingTop: 7, paddingBottom: 7,
              border: '1px solid var(--border)', borderRadius: 8,
              background: 'var(--bg)', color: 'var(--navy)',
              fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
              cursor: 'pointer', outline: 'none', appearance: 'none',
              minWidth: 130,
            }}
          >
            {properties.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <svg
            style={{ position: 'absolute', right: 8, pointerEvents: 'none', color: 'var(--subtext)' }}
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </div>
    </header>
  )
}
