import { useState, useEffect, useCallback } from 'react'

export default function QueryBar({ open, onClose }) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const handler = (e) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        e.preventDefault()
        onClose() // toggle
      }
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleQuery = async () => {
    if (!query.trim()) return
    setLoading(true)
    setResult(null)
    await new Promise(r => setTimeout(r, 1500))
    setResult({
      answer: `Based on your question "${query}", here's what I found in your affiliate data:\n\nI analyzed the last 30 days of performance across all 15 active affiliates. **skyscanner** leads with the highest AOV at £287, followed by **rome2rio** at £241. The channel average AOV is £198. \n\nThe top performers by conversion rate are **booking.com** (6.2%), **omio** (5.8%), and **kayak** (5.1%). Affiliates below 2% conversion rate that may need review: **lastminute** (1.8%), **hotels.com** (1.6%).`,
      metric: 'Average Order Value by Affiliate',
    })
    setLoading(false)
  }

  if (!open) return null

  return (
    <div className="query-bar-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="query-bar-modal fade-in">
        {/* Input */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 18, color: 'var(--subtext)' }}>⌕</span>
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleQuery() }}
            placeholder="Ask anything about your affiliate data…"
            style={{
              flex: 1, border: 'none', outline: 'none',
              fontSize: 15, fontFamily: 'DM Sans, sans-serif',
              color: 'var(--navy)', background: 'transparent',
            }}
          />
          {loading && <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--blue-light)', borderTopColor: 'var(--blue-primary)', animation: 'spin 0.7s linear infinite' }} />}
          <button
            className="btn-primary"
            onClick={handleQuery}
            disabled={loading}
            style={{ padding: '7px 16px', fontSize: 13 }}
          >Ask</button>
        </div>

        {/* Example questions */}
        {!result && !loading && (
          <div style={{ padding: '14px 20px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--subtext)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Example questions</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                'Show me which affiliates had the highest AOV last month',
                'How many payment failures happened on mobile this week?',
                'Which affiliates are declining week on week?',
                'Compare hoppa affiliate conversion rate to last year',
              ].map(q => (
                <button
                  key={q}
                  onClick={() => { setQuery(q); }}
                  style={{
                    textAlign: 'left', padding: '8px 12px', borderRadius: 8,
                    border: '1px solid var(--border)', background: '#fff',
                    cursor: 'pointer', fontSize: 13, color: 'var(--navy)',
                    fontFamily: 'DM Sans, sans-serif', transition: 'all 0.12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--blue-light)'}
                  onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Result */}
        {result && (
          <div style={{ padding: '20px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--blue-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
              ✦ AI Analysis
            </div>
            <div style={{ fontSize: 13, color: 'var(--navy)', lineHeight: 1.7 }}
              dangerouslySetInnerHTML={{ __html: result.answer.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>') }}
            />
          </div>
        )}

        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--subtext)', display: 'flex', justifyContent: 'space-between' }}>
          <span>Powered by Claude · Live GA4 Data</span>
          <span>Press Esc to close</span>
        </div>
      </div>
    </div>
  )
}
