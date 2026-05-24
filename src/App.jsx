import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { FiltersProvider } from './context/FiltersContext'
import { PropertyProvider, useProperty } from './context/PropertyContext'
import { ChatProvider, useChat } from './context/ChatContext'
import Sidebar from './components/layout/Sidebar'
import Topbar from './components/layout/Topbar'
import FilterBar from './components/layout/FilterBar'
import QueryBar from './components/QueryBar'
import ChatPanel from './components/ChatPanel'
import Login from './pages/Login'
import ExecutiveSummary from './pages/ExecutiveSummary'
import TrafficEngagement from './pages/TrafficEngagement'
import CommercialPerformance from './pages/CommercialPerformance'
import FunnelAnalysis from './pages/FunnelAnalysis'
import AffiliateScorecard from './pages/AffiliateScorecard'
import MetricGlossary from './pages/MetricGlossary'
import DestinationIntelligence from './pages/DestinationIntelligence'
import LLMIntelligence from './pages/LLMIntelligence'
import LLMDeepDive from './pages/LLMDeepDive'

function ProtectedLayout() {
  const { user, loading } = useAuth()
  const [queryOpen, setQueryOpen] = useState(false)

  useEffect(() => {
    const handler = (e) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        e.preventDefault()
        setQueryOpen(q => !q)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 16 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12,
          background: 'linear-gradient(135deg, #0F5FA6 0%, #0D8A72 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, fontWeight: 800, color: '#fff',
        }}>O</div>
        <div style={{ fontSize: 13, color: 'var(--subtext)' }}>Loading Orbit…</div>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  return (
    <FiltersProvider>
      <PropertyProvider>
        <ChatProvider>
          <DashboardShell onQueryOpen={() => setQueryOpen(true)} />
          <QueryBar open={queryOpen} onClose={() => setQueryOpen(false)} />
        </ChatProvider>
      </PropertyProvider>
    </FiltersProvider>
  )
}

// Section toggle — sits at the top of the main content area
function SectionToggle() {
  const location = useLocation()
  const navigate = useNavigate()
  const isLLM = location.pathname.startsWith('/llm')
  const { properties, selectedProperty, switchProperty } = useProperty()

  const activeStyle = {
    padding: '10px 28px',
    borderRadius: 10,
    border: '1.5px solid transparent',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 700,
    fontFamily: 'inherit',
    letterSpacing: '0.01em',
    transition: 'all 0.18s ease',
    background: '#1e293b',
    color: '#fff',
    boxShadow: '0 2px 8px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.07)',
  }

  const inactiveStyle = {
    padding: '10px 28px',
    borderRadius: 10,
    border: '1.5px solid var(--border)',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    fontFamily: 'inherit',
    letterSpacing: '0.01em',
    transition: 'all 0.18s ease',
    background: 'transparent',
    color: 'var(--subtext)',
    boxShadow: 'none',
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '10px 20px 0',
    }}>
      <button
        onClick={() => !isLLM || navigate('/scorecard')}
        style={!isLLM ? activeStyle : inactiveStyle}
        onMouseEnter={e => { if (isLLM) { e.currentTarget.style.background = 'var(--hover, rgba(0,0,0,0.05))'; e.currentTarget.style.color = 'var(--text)' } }}
        onMouseLeave={e => { if (isLLM) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--subtext)' } }}
      >
        Affiliates
      </button>
      <button
        onClick={() => isLLM || navigate('/llm')}
        style={isLLM ? activeStyle : inactiveStyle}
        onMouseEnter={e => { if (!isLLM) { e.currentTarget.style.background = 'var(--hover, rgba(0,0,0,0.05))'; e.currentTarget.style.color = 'var(--text)' } }}
        onMouseLeave={e => { if (!isLLM) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--subtext)' } }}
      >
        LLM Intelligence
      </button>

      {/* Property switcher — right corner of same bar */}
      <div style={{ marginLeft: 'auto', position: 'relative', display: 'flex', alignItems: 'center' }}>
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
  )
}

// Separate shell component so useChat() works inside ChatProvider
function DashboardShell({ onQueryOpen }) {
  const { chat, closeChat } = useChat()

  return (
    <>
      <div className="app-shell">
        <Sidebar />
        <div className="main-area">
          <SectionToggle />
          <FilterBar />
          <Routes>
            <Route path="/" element={<ExecutiveSummary />} />
              <Route path="/scorecard" element={<AffiliateScorecard />} />

            <Route path="/traffic" element={<TrafficEngagement />} />
            <Route path="/commercial" element={<CommercialPerformance />} />
            <Route path="/funnel" element={<FunnelAnalysis />} />
            <Route path="/destinations" element={<DestinationIntelligence />} />
            <Route path="/glossary" element={<MetricGlossary />} />
            <Route path="/llm" element={<LLMIntelligence />} />
            <Route path="/llm-deep-dive" element={<LLMDeepDive />} />
          </Routes>
        </div>
      </div>
      {/* Global chat panel — one instance, driven by ChatContext */}
      <ChatPanel
        open={!!chat}
        onClose={closeChat}
        chartTitle={chat?.title ?? ''}
        chartType={chat?.chartType ?? ''}
        chartData={chat?.chartData ?? null}
      />
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginGuard />} />
          <Route path="/*" element={<ProtectedLayout />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

function LoginGuard() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (user) return <Navigate to="/" replace />
  return <Login />
}
