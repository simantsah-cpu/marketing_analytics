/**
 * LeadershipGate.jsx
 * Password gate for the Leadership dashboard.
 *
 * - The password is stored as a SHA-256 hash (never plain-text in source).
 * - Unlock state is kept in sessionStorage — it resets when the browser tab is closed.
 * - The gate wraps the entire /leadership route; correct password reveals the dashboard.
 */

import { useState, useCallback } from 'react'

// SHA-256 hash of the Leadership password
const PWD_HASH = 'c124d5e75c4650b60423b78116354e8d97ae08437eee0ba6ac78bef2d6e4cb0a'
const SESSION_KEY = 'leadership_unlocked'

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function isUnlocked() {
  return sessionStorage.getItem(SESSION_KEY) === '1'
}

export default function LeadershipGate({ children }) {
  const [unlocked, setUnlocked]   = useState(isUnlocked)
  const [password, setPassword]   = useState('')
  const [error,    setError]      = useState(false)
  const [checking, setChecking]   = useState(false)
  const [shake,    setShake]      = useState(false)
  const [visible,  setVisible]    = useState(false)

  const handleSubmit = useCallback(async e => {
    e.preventDefault()
    if (checking) return
    setChecking(true)
    setError(false)

    const hash = await sha256(password)
    if (hash === PWD_HASH) {
      sessionStorage.setItem(SESSION_KEY, '1')
      setUnlocked(true)
    } else {
      setError(true)
      setShake(true)
      setPassword('')
      setTimeout(() => setShake(false), 500)
    }
    setChecking(false)
  }, [password, checking])

  if (unlocked) return children

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'linear-gradient(135deg, #0a1628 0%, #0f2044 40%, #0a2a1e 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      {/* Animated background orbs */}
      <div style={{
        position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none',
      }}>
        <div style={{
          position: 'absolute', width: 400, height: 400,
          borderRadius: '50%', top: '-80px', left: '-80px',
          background: 'radial-gradient(circle, rgba(15,95,166,0.18) 0%, transparent 70%)',
        }} />
        <div style={{
          position: 'absolute', width: 500, height: 500,
          borderRadius: '50%', bottom: '-100px', right: '-100px',
          background: 'radial-gradient(circle, rgba(13,138,114,0.14) 0%, transparent 70%)',
        }} />
        <div style={{
          position: 'absolute', width: 300, height: 300,
          borderRadius: '50%', top: '30%', right: '10%',
          background: 'radial-gradient(circle, rgba(240,90,40,0.08) 0%, transparent 70%)',
        }} />
      </div>

      {/* Card */}
      <div style={{
        position: 'relative', zIndex: 1,
        background: 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: 20,
        padding: '48px 40px',
        width: '100%', maxWidth: 420,
        boxShadow: '0 24px 64px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
        animation: shake ? 'ldShake 0.45s ease' : undefined,
      }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src="/hoppa-logo.png" alt="hoppa" style={{ height: 36, objectFit: 'contain', filter: 'brightness(0) invert(1)', opacity: 0.9 }} />
        </div>

        {/* Lock icon */}
        <div style={{
          width: 56, height: 56, borderRadius: '50%', margin: '0 auto 20px',
          background: 'linear-gradient(135deg, rgba(15,95,166,0.35) 0%, rgba(13,138,114,0.35) 100%)',
          border: '1px solid rgba(255,255,255,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>

        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#fff', textAlign: 'center', margin: '0 0 6px' }}>
          Leadership Dashboard
        </h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', textAlign: 'center', margin: '0 0 28px' }}>
          Enter the access password to continue
        </p>

        <form onSubmit={handleSubmit}>
          {/* Password input */}
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <input
              type={visible ? 'text' : 'password'}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(false) }}
              placeholder="Password"
              autoFocus
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '13px 44px 13px 16px',
                background: 'rgba(255,255,255,0.07)',
                border: `1.5px solid ${error ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.14)'}`,
                borderRadius: 10, outline: 'none',
                color: '#fff', fontSize: 15,
                fontFamily: 'inherit',
                transition: 'border-color 0.2s',
              }}
              onFocus={e => { if (!error) e.target.style.borderColor = 'rgba(15,95,166,0.8)' }}
              onBlur={e => { if (!error) e.target.style.borderColor = 'rgba(255,255,255,0.14)' }}
            />
            {/* Show / hide toggle */}
            <button
              type="button"
              onClick={() => setVisible(v => !v)}
              tabIndex={-1}
              style={{
                position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                color: 'rgba(255,255,255,0.4)',
              }}
            >
              {visible ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              )}
            </button>
          </div>

          {/* Error message */}
          {error && (
            <div style={{
              fontSize: 12, color: 'rgba(239,68,68,0.9)',
              marginBottom: 10, paddingLeft: 4,
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Incorrect password. Please try again.
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={!password || checking}
            style={{
              width: '100%', padding: '13px 0',
              background: (!password || checking)
                ? 'rgba(255,255,255,0.08)'
                : 'linear-gradient(135deg, #0F5FA6 0%, #0D8A72 100%)',
              color: (!password || checking) ? 'rgba(255,255,255,0.3)' : '#fff',
              border: 'none', borderRadius: 10,
              fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
              cursor: (!password || checking) ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
              boxShadow: (!password || checking) ? 'none' : '0 4px 16px rgba(15,95,166,0.35)',
            }}
          >
            {checking ? 'Verifying…' : 'Unlock Dashboard'}
          </button>
        </form>
      </div>

      {/* Shake keyframes */}
      <style>{`
        @keyframes ldShake {
          0%, 100% { transform: translateX(0); }
          15%       { transform: translateX(-8px); }
          30%       { transform: translateX(8px); }
          45%       { transform: translateX(-6px); }
          60%       { transform: translateX(6px); }
          75%       { transform: translateX(-3px); }
          90%       { transform: translateX(3px); }
        }
      `}</style>
    </div>
  )
}
