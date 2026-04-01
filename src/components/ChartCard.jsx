import { useChat } from '../context/ChatContext'
import { useFilters } from '../context/FiltersContext'

/**
 * ChartCard
 * A wrapper card for the dashboard charts matching the HTML reference structure.
 * Optional `switcher` prop: array of { label, active, onClick } renders a pill group.
 * Optional `chartType` prop: 'sessions' | 'revenue' | 'bar' — determines chat suggestions.
 */
export default function ChartCard({ title, subtitle, tag, switcher, showGranularity, children, chartType, style = {} }) {
  const { openChat } = useChat()
  const { filters: { granularity }, actions: { setGranularity } } = useFilters()

  const activeSwitcher = showGranularity 
    ? ['Day', 'Week', 'Month', 'Quarter', 'Year'].map(opt => ({
        label: opt,
        active: granularity === opt.toLowerCase(),
        onClick: () => setGranularity(opt.toLowerCase())
      }))
    : switcher

  return (
    <div className="chart-card" style={style}>
      <div className="chart-header">
        <div>
          <div className="chart-title">{title}</div>
          {subtitle && <div className="chart-sub">{subtitle}</div>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Granularity switcher (global or custom) */}
          {activeSwitcher && (
            <div style={{
              display: 'flex', borderRadius: 6, overflow: 'hidden',
              border: '1px solid var(--border)', background: 'var(--bg)',
            }}>
              {activeSwitcher.map(({ label, active, onClick }, i) => (
                <button
                  key={label}
                  onClick={onClick}
                  style={{
                    padding: '3px 8px',
                    border: 'none',
                    borderRight: i < activeSwitcher.length - 1 ? '1px solid var(--border)' : 'none',
                    background: active ? 'var(--blue)' : 'transparent',
                    color: active ? '#fff' : 'var(--subtext)',
                    fontSize: 10, fontWeight: 600,
                    fontFamily: 'inherit', cursor: 'pointer',
                    transition: 'all 0.12s',
                    lineHeight: 1.6,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {tag && <span className="chart-tag">{tag}</span>}

          {/* Chat bubble icon — opens the AI chat panel for this chart */}
          <ChatIcon
            onClick={() => openChat({ title, chartType: chartType || tag || title })}
          />
        </div>
      </div>

      <div className="chart-wrap">
        {children}
      </div>
    </div>
  )
}

function ChatIcon({ onClick }) {
  return (
    <button
      onClick={onClick}
      title="Ask AI about this chart"
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        padding: '3px 5px', borderRadius: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--subtext)',
        transition: 'color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.color = '#1A7FD4'
        e.currentTarget.style.background = '#EFF6FF'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.color = 'var(--subtext)'
        e.currentTarget.style.background = 'none'
      }}
    >
      {/* Chat bubble SVG */}
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </button>
  )
}
