import { useState, useRef, useEffect } from 'react'
import { useFilters } from '../context/FiltersContext'

// ── Per-chart-type suggested questions ────────────────────────────────────────
const CHART_QUESTIONS = {
  sessions: [
    'Why did sessions drop on this date?',
    'Which affiliate drove the most growth?',
    'Is this trend normal for this period?',
  ],
  revenue: [
    'What drove the revenue increase?',
    'Which affiliate has the highest AOV?',
    'How does this compare to last year?',
  ],
  bar: [
    'Who are the top 3 performers and why?',
    'Which affiliates are underperforming?',
    "What's pulling the average down?",
  ],
  default: [
    'What does this trend tell us?',
    'Which affiliate is driving this metric?',
    'How does this compare to last period?',
  ],
}

function getSuggestedQuestions(chartType = '') {
  const t = chartType.toLowerCase()
  if (t.includes('session') || t.includes('traffic')) return CHART_QUESTIONS.sessions
  if (t.includes('revenue') || t.includes('aov') || t.includes('conv')) return CHART_QUESTIONS.revenue
  if (t.includes('bar') || t.includes('rank') || t.includes('affiliate') || t.includes('top')) return CHART_QUESTIONS.bar
  return CHART_QUESTIONS.default
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ChatPanel({ open, onClose, chartTitle, chartType, chartData }) {
  const { filters } = useFilters()
  const [messages, setMessages]   = useState([])
  const [input, setInput]         = useState('')
  const [streaming, setStreaming] = useState(false)
  const [unconfigured, setUnconfigured] = useState(false)
  const messagesEndRef = useRef(null)
  const abortRef       = useRef(null)
  const inputRef       = useRef(null)

  const dateRange = filters.preset

  // Reset when a new chart is opened
  useEffect(() => {
    if (open) {
      abortRef.current?.abort()
      setMessages([{
        role: 'ai',
        content: `I'm looking at your **${chartTitle}** data. What would you like to know?`,
      }])
      setInput('')
      setStreaming(false)
      setUnconfigured(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open, chartTitle])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  const sendMessage = async (text) => {
    const trimmed = text.trim()
    if (!trimmed || streaming) return
    setInput('')
    setUnconfigured(false)

    const history = messages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))
    const userMsg = { role: 'user', content: trimmed }
    setMessages(prev => [...prev, userMsg])
    setStreaming(true)

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/ai-chat`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          chartTitle,
          chartType,
          dateRange,
          chartData: chartData ?? null,
          message: trimmed,
          history,
        }),
      })

      if (res.status === 404 || res.status === 405) {
        setStreaming(false)
        setUnconfigured(true)
        return
      }

      if (!res.ok) {
        const msg = await res.text().catch(() => `HTTP ${res.status}`)
        if (msg.toLowerCase().includes('not found') || msg.includes('FunctionNotFound')) {
          setStreaming(false)
          setUnconfigured(true)
          return
        }
        throw new Error(msg)
      }

      const contentType = res.headers.get('content-type') ?? ''
      let accumulated = ''

      // Insert a streaming placeholder message
      setMessages(prev => [...prev, { role: 'ai', content: '', streaming: true }])

      if (contentType.includes('text/event-stream') || contentType.includes('text/plain')) {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data: ')) {
              const payload = line.slice(6).trim()
              if (payload === '[DONE]') continue
              try {
                const parsed = JSON.parse(payload)
                const delta = parsed?.choices?.[0]?.delta?.content
                  ?? parsed?.delta?.text
                  ?? parsed?.content ?? ''
                accumulated += delta
              } catch { accumulated += payload }
            } else if (line && !line.startsWith('event:') && !line.startsWith(':')) {
              accumulated += line
            }
          }
          const snap = accumulated
          setMessages(prev => prev.map((m, i) =>
            i === prev.length - 1 ? { role: 'ai', content: snap, streaming: true } : m
          ))
        }
      } else {
        const json = await res.json()
        accumulated = json?.content ?? json?.text ?? json?.reply ?? JSON.stringify(json)
      }

      // Finalise — remove streaming flag
      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1 ? { role: 'ai', content: accumulated, streaming: false } : m
      ))

    } catch (err) {
      if (err.name === 'AbortError') return
      if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
        setStreaming(false)
        setUnconfigured(true)
        return
      }
      setMessages(prev => prev.map((m, i) =>
        i === prev.length - 1
          ? { role: 'ai', content: `Error: ${err.message}`, streaming: false }
          : m
      ))
    } finally {
      setStreaming(false)
    }
  }

  const questions = getSuggestedQuestions(chartType || chartTitle)

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(10,37,64,0.25)',
            zIndex: 49,
          }}
        />
      )}

      {/* Slide-in panel */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 395, zIndex: 50,
          display: 'flex', flexDirection: 'column',
          background: '#fff',
          borderLeft: '1px solid #D1DCE8',
          boxShadow: '-8px 0 40px rgba(10,37,64,0.18)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          pointerEvents: open ? 'all' : 'none',
        }}
      >
        {/* ── Header ── */}
        <div style={{
          padding: '16px 18px 14px',
          borderBottom: '2px solid #E8F0FA',
          background: '#fff',
          borderLeft: '4px solid #0F5FA6',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#1A7FD4">
                  <path d="M12 2l2.4 7.2L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"/>
                </svg>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)', fontFamily: 'inherit' }}>AI Chart Assistant</span>
                <span style={{
                  fontSize: 9, fontWeight: 700, color: '#1A7FD4', background: '#DBEAFE',
                  borderRadius: 4, padding: '1px 5px', letterSpacing: '0.04em',
                }}>CLAUDE</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--subtext)', lineHeight: 1.4 }}>
                Viewing: <strong style={{ color: 'var(--navy)' }}>{chartTitle}</strong>
                {dateRange && <span> · {dateRange}</span>}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 18, color: 'var(--subtext)', lineHeight: 1,
                padding: 4, borderRadius: 4, flexShrink: 0,
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--navy)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--subtext)'}
            >×</button>
          </div>
        </div>

        {/* ── Suggested questions ── */}
        <div style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', flexWrap: 'wrap', gap: 6,
          flexShrink: 0,
        }}>
          {questions.map(q => (
            <button
              key={q}
              onClick={() => sendMessage(q)}
              disabled={streaming}
              style={{
                padding: '5px 10px', borderRadius: 100,
                border: '1px solid var(--border)',
                background: '#fff', cursor: streaming ? 'not-allowed' : 'pointer',
                fontSize: 11, color: 'var(--subtext)',
                fontFamily: 'inherit', lineHeight: 1.4,
                transition: 'all 0.12s', opacity: streaming ? 0.5 : 1,
              }}
              onMouseEnter={e => {
                if (!streaming) {
                  e.currentTarget.style.borderColor = '#1A7FD4'
                  e.currentTarget.style.color = '#1A7FD4'
                  e.currentTarget.style.background = '#EFF6FF'
                }
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border)'
                e.currentTarget.style.color = 'var(--subtext)'
                e.currentTarget.style.background = '#fff'
              }}
            >
              {q}
            </button>
          ))}
        </div>

        {/* ── Messages ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.map((msg, i) => (
            <div
              key={i}
              style={
                msg.role === 'user' ? {
                  alignSelf: 'flex-end',
                  background: '#0F5FA6', color: '#fff',
                  borderRadius: '12px 12px 2px 12px',
                  padding: '9px 13px', maxWidth: '85%',
                  fontSize: 12.5, lineHeight: 1.55, fontFamily: 'inherit',
                } : {
                  alignSelf: 'flex-start',
                  background: '#F0F7FF',
                  border: '1px solid #DBEAFE',
                  borderRadius: '2px 12px 12px 12px',
                  padding: '9px 13px', maxWidth: '92%',
                  fontSize: 12.5, lineHeight: 1.55, fontFamily: 'inherit',
                  color: 'var(--navy)',
                }
              }
            >
              <span
                dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
              />
              {msg.streaming && (
                <span style={{
                  display: 'inline-block', width: 2, height: 13,
                  background: '#1A7FD4', marginLeft: 2, verticalAlign: 'middle',
                  animation: 'ai-blink 1s step-end infinite',
                }}/>
              )}
            </div>
          ))}

          {/* Typing indicator (before first streaming char) */}
          {streaming && messages[messages.length - 1]?.content === '' && (
            <div style={{
              alignSelf: 'flex-start',
              background: '#F0F7FF', border: '1px solid #DBEAFE',
              borderRadius: '2px 12px 12px 12px',
              padding: '10px 14px',
              display: 'flex', gap: 4, alignItems: 'center',
            }}>
              {[0, 1, 2].map(i => (
                <span key={i} style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: '#1A7FD4', opacity: 0.7,
                  animation: `ai-dot-bounce 1.2s ease ${i * 0.2}s infinite`,
                  display: 'inline-block',
                }}/>
              ))}
            </div>
          )}

          {/* Unconfigured warning */}
          {unconfigured && (
            <div style={{
              alignSelf: 'stretch',
              background: '#FFF7ED', border: '1px solid #FED7AA',
              borderRadius: 8, padding: '12px 14px',
              fontSize: 12, color: '#92400E', lineHeight: 1.6,
              display: 'flex', gap: 9, alignItems: 'flex-start',
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>
                Chat requires the <code style={{ background: '#FEF3C7', padding: '1px 4px', borderRadius: 3, fontSize: 11 }}>ai-chat</code> Edge Function to be deployed to your Supabase project.
              </span>
            </div>
          )}

          <div ref={messagesEndRef}/>
        </div>

        {/* ── Input ── */}
        <div style={{
          padding: '12px 16px', borderTop: '1px solid var(--border)',
          background: 'var(--card)', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage(input)
                }
              }}
              placeholder="Ask about this chart…"
              disabled={streaming}
              style={{
                flex: 1, padding: '9px 12px', borderRadius: 8,
                border: '1px solid var(--border)', outline: 'none',
                fontSize: 12.5, fontFamily: 'inherit', color: 'var(--navy)',
                background: streaming ? '#F8FAFC' : '#fff',
                transition: 'border-color 0.12s',
              }}
              onFocus={e => e.currentTarget.style.borderColor = '#1A7FD4'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={streaming || !input.trim()}
              style={{
                width: 36, height: 36, borderRadius: 8, border: 'none',
                background: streaming || !input.trim() ? '#E2E8F0' : '#0F5FA6',
                color: streaming || !input.trim() ? '#94A3B8' : '#fff',
                cursor: streaming || !input.trim() ? 'not-allowed' : 'pointer',
                fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.12s', flexShrink: 0,
              }}
            >
              {streaming
                ? <span style={{ width: 14, height: 14, border: '2px solid #CBD5E1', borderTopColor: '#94A3B8', borderRadius: '50%', animation: 'ai-spin 0.8s linear infinite', display: 'inline-block' }}/>
                : '↑'
              }
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--subtext)', marginTop: 6 }}>
            Powered by Claude · context: {chartTitle}
          </div>
        </div>

        {/* Keyframe animations */}
        <style>{`
          @keyframes ai-blink { 0%,100%{opacity:1} 50%{opacity:0} }
          @keyframes ai-spin  { to{transform:rotate(360deg)} }
          @keyframes ai-dot-bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }
        `}</style>
      </div>
    </>
  )
}

function renderMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code style="background:#EFF6FF;padding:1px 4px;border-radius:3px;font-size:11px">$1</code>')
    .replace(/\n/g, '<br/>')
}
