/**
 * CustomerAnalyticsGate.jsx
 * Password gate for the Customer Analytics tab — identical design to LeadershipGate.
 *
 * - Password stored as SHA-256 hash only (never plain-text in source).
 * - Unlock state kept in sessionStorage — resets when the browser tab is closed.
 */

import { useState, useCallback } from 'react'

const PWD_HASH    = 'c124d5e75c4650b60423b78116354e8d97ae08437eee0ba6ac78bef2d6e4cb0a'
const SESSION_KEY = 'ca_auth_v1'

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function isUnlocked() {
  return sessionStorage.getItem(SESSION_KEY) === '1'
}

export default function CustomerAnalyticsGate({ children }) {
  const [unlocked, setUnlocked] = useState(isUnlocked)
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState(false)
  const [checking, setChecking] = useState(false)
  const [shake,    setShake]    = useState(false)
  const [visible,  setVisible]  = useState(false)

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
      background: '#f5f5f7',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    }}>

      {/* Card */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e2e7',
        borderRadius: 12,
        padding: '44px 40px 40px',
        width: '100%', maxWidth: 400,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.06)',
        animation: shake ? 'ldShake 0.45s ease' : undefined,
      }}>

        {/* Logo */}
        <div style={{ marginBottom: 32 }}>
          <img src="/hoppa-logo.png" alt="hoppa" style={{ height: 28, objectFit: 'contain' }} />
        </div>

        <h1 style={{ fontSize: 18, fontWeight: 600, color: '#111', margin: '0 0 4px', letterSpacing: '-0.01em' }}>
          Sign in to Customer Analytics
        </h1>
        <p style={{ fontSize: 13.5, color: '#6b7280', margin: '0 0 28px', lineHeight: 1.5 }}>
          Enter the access password to view the dashboard.
        </p>

        <form onSubmit={handleSubmit}>
          {/* Label */}
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
            Password
          </label>

          {/* Password input */}
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <input
              type={visible ? 'text' : 'password'}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(false) }}
              placeholder="Enter password"
              autoFocus
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '10px 40px 10px 12px',
                background: '#fff',
                border: `1.5px solid ${error ? '#ef4444' : '#d1d5db'}`,
                borderRadius: 8, outline: 'none',
                color: '#111', fontSize: 14,
                fontFamily: 'inherit',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
              onFocus={e => {
                if (!error) {
                  e.target.style.borderColor = '#2563eb'
                  e.target.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.12)'
                }
              }}
              onBlur={e => {
                if (!error) {
                  e.target.style.borderColor = '#d1d5db'
                  e.target.style.boxShadow = 'none'
                }
              }}
            />
            {/* Show / hide toggle */}
            <button
              type="button"
              onClick={() => setVisible(v => !v)}
              tabIndex={-1}
              style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                color: '#9ca3af', display: 'flex', alignItems: 'center',
              }}
            >
              {visible ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              )}
            </button>
          </div>

          {/* Error message */}
          {error && (
            <div style={{
              fontSize: 12.5, color: '#ef4444',
              marginBottom: 12,
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
              width: '100%', padding: '10px 0', marginTop: 4,
              background: (!password || checking) ? '#f3f4f6' : '#111827',
              color: (!password || checking) ? '#9ca3af' : '#ffffff',
              border: '1px solid transparent',
              borderColor: (!password || checking) ? '#e5e7eb' : '#111827',
              borderRadius: 8,
              fontSize: 13.5, fontWeight: 600, fontFamily: 'inherit',
              cursor: (!password || checking) ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
              letterSpacing: '0.01em',
            }}
            onMouseEnter={e => { if (password && !checking) e.target.style.background = '#1f2937' }}
            onMouseLeave={e => { if (password && !checking) e.target.style.background = '#111827' }}
          >
            {checking ? 'Verifying…' : 'Continue'}
          </button>
        </form>
      </div>

      {/* Footer */}
      <p style={{ marginTop: 20, fontSize: 12, color: '#9ca3af' }}>
        Restricted access · hoppa Analytics
      </p>

      {/* Shake keyframes */}
      <style>{`
        @keyframes ldShake {
          0%, 100% { transform: translateX(0); }
          15%       { transform: translateX(-7px); }
          30%       { transform: translateX(7px); }
          45%       { transform: translateX(-5px); }
          60%       { transform: translateX(5px); }
          75%       { transform: translateX(-3px); }
          90%       { transform: translateX(3px); }
        }
      `}</style>
    </div>
  )
}
