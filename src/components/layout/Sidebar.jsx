import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

const AFFILIATE_NAV_ITEMS = []

const LLM_NAV_ITEMS = [
  { to: '/llm', label: 'LLM Intelligence', icon: <svg className="nav-icon" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" opacity=".8"/><path d="M5.5 6.5 Q8 4 10.5 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".9"/><circle cx="6" cy="8" r="1" fill="currentColor" opacity=".8"/><circle cx="10" cy="8" r="1" fill="currentColor" opacity=".8"/><path d="M8 12 L8 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".6"/><path d="M6 14 L10 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".4"/></svg> },
  { to: '/llm-deep-dive', label: 'LLM Deep Dive', icon: <svg className="nav-icon" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="2" rx="1" fill="currentColor" opacity=".8"/><rect x="1" y="7" width="14" height="2" rx="1" fill="currentColor" opacity=".5"/><rect x="1" y="11" width="14" height="2" rx="1" fill="currentColor" opacity=".3"/><rect x="11" y="1" width="4" height="14" rx="1" fill="currentColor" opacity=".12"/></svg> },
  { to: '/ai-overview', label: 'AI Overview Click Events', icon: <svg className="nav-icon" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".6"/><path d="M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M11.1 4.9l1.4-1.4M3.5 12.5l1.4-1.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity=".4"/></svg> },
]

const REPORT109_NAV_ITEMS = [
  { to: '/report-109', label: 'B2C Performance', icon: <svg className="nav-icon" viewBox="0 0 16 16" fill="none"><rect x="1" y="10" width="3" height="4" rx="1" fill="currentColor" opacity=".4"/><rect x="5" y="7" width="3" height="7" rx="1" fill="currentColor" opacity=".6"/><rect x="9" y="4" width="3" height="10" rx="1" fill="currentColor" opacity=".8"/><rect x="13" y="1" width="2" height="13" rx="1" fill="currentColor"/><path d="M1 9 L4 6 L7 8 L10 4 L13 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity=".5"/></svg> },
]

const DEST_NAV_ITEMS = []

export default function Sidebar() {
  const { user, signOut } = useAuth()
  const location = useLocation()
  const isLLM         = location.pathname.startsWith('/llm') || location.pathname.startsWith('/ai-overview')
  const isReport109   = location.pathname.startsWith('/report-109')
  const isDestAnalysis = location.pathname.startsWith('/destination-analysis')
  const navItems = isReport109 ? REPORT109_NAV_ITEMS : isLLM ? LLM_NAV_ITEMS : isDestAnalysis ? DEST_NAV_ITEMS : AFFILIATE_NAV_ITEMS

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

      </div>

      <nav className="sidebar-nav">
        <div className="nav-label">{isReport109 ? 'Report — 109' : 'Dashboard'}</div>
        {navItems.map(item => (
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
