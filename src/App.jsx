import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { FiltersProvider } from './context/FiltersContext'
import { PropertyProvider } from './context/PropertyContext'
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

// Separate shell component so useChat() works inside ChatProvider
function DashboardShell({ onQueryOpen }) {
  const { chat, closeChat } = useChat()

  return (
    <>
      <div className="app-shell">
        <Sidebar />
        <div className="main-area">
          <Topbar onQueryOpen={onQueryOpen} />
          <FilterBar />
          <Routes>
            <Route path="/" element={<ExecutiveSummary />} />
              <Route path="/scorecard" element={<AffiliateScorecard />} />

            <Route path="/traffic" element={<TrafficEngagement />} />
            <Route path="/commercial" element={<CommercialPerformance />} />
            <Route path="/funnel" element={<FunnelAnalysis />} />
            <Route path="/destinations" element={<DestinationIntelligence />} />
            <Route path="/glossary" element={<MetricGlossary />} />
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
