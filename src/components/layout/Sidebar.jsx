import { NavLink } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

const NAV_ITEMS = [
  { to: '/scorecard', label: 'Affiliate Scorecard', icon: <svg className="nav-icon" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="3" rx="1" fill="currentColor" opacity=".8"/><rect x="1" y="6" width="14" height="2.5" rx="1" fill="currentColor" opacity=".5"/><rect x="1" y="10.5" width="14" height="2.5" rx="1" fill="currentColor" opacity=".3"/><rect x="1" y="15" width="0" height="0" rx="0" fill="currentColor" opacity="0"/></svg> },
  { to: '/', label: 'Executive Summary', icon: <svg className="nav-icon" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity=".8"/><rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity=".4"/><rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity=".4"/><rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity=".4"/></svg>, exact: true },
  { to: '/traffic', label: 'Traffic & Engagement', icon: <svg className="nav-icon" viewBox="0 0 16 16" fill="none"><path d="M2 12 L5 8 L8 10 L11 5 L14 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><circle cx="14" cy="7" r="1.5" fill="currentColor"/></svg> },
  { to: '/commercial', label: 'Commercial', icon: <svg className="nav-icon" viewBox="0 0 16 16" fill="none"><rect x="2" y="9" width="3" height="5" rx="1" fill="currentColor" opacity=".4"/><rect x="6.5" y="6" width="3" height="8" rx="1" fill="currentColor" opacity=".6"/><rect x="11" y="3" width="3" height="11" rx="1" fill="currentColor"/></svg> },
  { to: '/funnel', label: 'Funnel Analysis', icon: <svg className="nav-icon" viewBox="0 0 16 16" fill="none"><path d="M8 2 L8 14 M2 5 L14 5 M3 9 L13 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><polygon points="8,2 5,6 11,6" fill="currentColor" opacity=".6"/></svg> },
  { to: '/destinations', label: 'Destination Intelligence', icon: <svg className="nav-icon" viewBox="0 0 16 16" fill="none"><path d="M8 1.5C5.515 1.5 3.5 3.515 3.5 6c0 3.5 4.5 8.5 4.5 8.5s4.5-5 4.5-8.5c0-2.485-2.015-4.5-4.5-4.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><circle cx="8" cy="6" r="1.5" fill="currentColor" opacity=".7"/></svg> },
]

export default function Sidebar() {
  const { user, signOut } = useAuth()

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-logo" style={{ justifyContent: 'center' }}>
          <img
            src="/hoppa-logo.png"
            alt="hoppa"
            style={{ width: 110, height: 'auto', objectFit: 'contain' }}
          />
        </div>
        <div className="brand-sub">Affiliate Intelligence</div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-label">Dashboard</div>
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.exact}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}

        <div className="nav-label">Report</div>
        <div className="nav-item" onClick={() => window.print()}>
          <svg className="nav-icon" viewBox="0 0 16 16" fill="none"><rect x="3" y="1" width="10" height="8" rx="1" stroke="currentColor" strokeWidth="1.5"/><rect x="2" y="5" width="12" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="5" y="10" width="6" height="4" rx=".5" fill="currentColor" opacity=".4"/></svg>
          Export / Print
        </div>
        <NavLink
          to="/glossary"
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <svg className="nav-icon" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="1" width="10" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.5" opacity=".7"/>
            <path d="M12 3h1.5a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5H4" stroke="currentColor" strokeWidth="1.2" opacity=".4"/>
            <line x1="5" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            <line x1="5" y1="8" x2="10" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            <line x1="5" y1="11" x2="8" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          Metric Glossary
        </NavLink>
      </nav>


      {/* Logout / User section */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--border)',
        marginTop: 'auto',
      }}>
        <div style={{ fontSize: 11, color: 'var(--subtext)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user?.email || 'Signed in'}
        </div>
        <button
          onClick={signOut}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            color: 'var(--subtext)',
            fontSize: 13,
            fontWeight: 500,
            fontFamily: 'inherit',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#FEE2E2'; e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.borderColor = '#FCA5A5' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg)'; e.currentTarget.style.color = 'var(--subtext)'; e.currentTarget.style.borderColor = 'var(--border)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Sign out
        </button>
      </div>
    </aside>
  )
}
