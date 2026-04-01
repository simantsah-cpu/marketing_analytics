import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function Login() {
  const { signIn, signInWithGoogle, createUser, resetPassword } = useAuth()
  const navigate = useNavigate()

  // Tabs: 'login' | 'adduser'
  const [tab, setTab] = useState('login')

  // Login state
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [forgotSent, setForgotSent] = useState(false)

  // Add user state
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState(null)
  const [addSuccess, setAddSuccess] = useState(null)

  const handleSignIn = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await signIn(email, password)
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      navigate('/')
    }
  }

  const handleGoogle = async () => {
    await signInWithGoogle()
  }

  const handleAddUser = async (e) => {
    e.preventDefault()
    setAddError(null)
    setAddSuccess(null)
    if (newPassword !== confirmPassword) {
      setAddError('Passwords do not match.')
      return
    }
    if (newPassword.length < 6) {
      setAddError('Password must be at least 6 characters.')
      return
    }
    setAddLoading(true)
    const { data, error } = await createUser(newEmail, newPassword)
    setAddLoading(false)
    if (error) {
      setAddError(error.message)
    } else {
      setAddSuccess(`User ${newEmail} created successfully! They will receive a confirmation email.`)
      setNewEmail('')
      setNewPassword('')
      setConfirmPassword('')
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'DM Sans, sans-serif' }}>
      {/* Left brand panel */}
      <div className="login-left" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '48px 56px' }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, zIndex: 1 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12,
            background: 'rgba(255,255,255,0.15)',
            backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, fontWeight: 800, color: '#fff', border: '1px solid rgba(255,255,255,0.2)'
          }}>O</div>
          <div style={{ color: '#fff' }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>Orbit Analytics</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Channel Intelligence Platform</div>
          </div>
        </div>

        {/* Center content */}
        <div style={{ zIndex: 1 }}>
          <div style={{ fontSize: 36, fontWeight: 700, color: '#fff', lineHeight: 1.2, marginBottom: 16 }}>
            Your channel data.<br />
            <span style={{ color: 'rgba(13,138,114,0.9)' }}>Finally intelligent.</span>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 15, lineHeight: 1.7, maxWidth: 380 }}>
            Stop waiting for weekly reports. Ask any question about your channel performance across all marketing sources and get an answer in seconds — with live GA4 data behind it.
          </p>

          {/* Feature pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 28 }}>
            {['Live GA4 Data', 'AI Chat on Every Chart', 'Anomaly Detection', 'Multi-Property'].map(feat => (
              <span key={feat} style={{
                padding: '6px 14px', borderRadius: 100,
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: 'rgba(255,255,255,0.8)',
                fontSize: 12, fontWeight: 500
              }}>{feat}</span>
            ))}
          </div>
        </div>

        {/* Bottom badge */}
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', zIndex: 1 }}>
          hoppa.com · elife transfer · Channel Intelligence v1.0
        </div>
      </div>

      {/* Right panel */}
      <div style={{
        width: 480, display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '48px 56px', background: '#fff'
      }}>

        {/* Tab switcher */}
        <div style={{
          display: 'flex', gap: 0, marginBottom: 32,
          background: 'var(--bg)', borderRadius: 10, padding: 4,
          border: '1px solid var(--border)'
        }}>
          {[
            { id: 'login', label: 'Sign In' },
            { id: 'adduser', label: 'Add User' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setError(null); setAddError(null); setAddSuccess(null) }}
              style={{
                flex: 1, padding: '8px 0',
                borderRadius: 7, border: 'none',
                fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s',
                background: tab === t.id ? '#fff' : 'transparent',
                color: tab === t.id ? 'var(--navy)' : 'var(--subtext)',
                boxShadow: tab === t.id ? '0 1px 4px rgba(10,37,64,0.1)' : 'none',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── SIGN IN TAB ── */}
        {tab === 'login' && (
          <>
            <div style={{ marginBottom: 28 }}>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>Welcome back</h1>
              <p style={{ fontSize: 14, color: 'var(--subtext)' }}>Sign in to your Orbit workspace</p>
            </div>

            {/* Google OAuth */}
            <button className="google-btn" onClick={handleGoogle} style={{ marginBottom: 20 }}>
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
                <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"/>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/>
              </svg>
              Continue with Google
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontSize: 12, color: 'var(--subtext)' }}>or</span>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>

            <form onSubmit={handleSignIn}>
              <div style={{ marginBottom: 16 }}>
                <label className="form-label">Work email</label>
                <input
                  id="email"
                  className="form-input"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  autoComplete="email"
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label className="form-label">Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="password"
                    className="form-input"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                    style={{ paddingRight: 44 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    style={{
                      position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', color: 'var(--subtext)', fontSize: 13
                    }}
                  >
                    {showPassword ? '🙈' : '👁'}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: 'var(--navy)' }}>
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                    style={{ accentColor: 'var(--blue-primary)' }}
                  />
                  Remember me
                </label>
                <button
                  type="button"
                  onClick={async () => {
                    if (!email) { setError('Enter your email first'); return }
                    await resetPassword(email)
                    setForgotSent(true)
                  }}
                  style={{ background: 'none', border: 'none', fontSize: 13, color: 'var(--blue-primary)', cursor: 'pointer' }}
                >
                  Forgot password?
                </button>
              </div>

              {error && (
                <div style={{ marginBottom: 16, padding: '10px 14px', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 8, fontSize: 13, color: 'var(--red)' }}>
                  {error}
                </div>
              )}

              {forgotSent && (
                <div style={{ marginBottom: 16, padding: '10px 14px', background: '#D1FAE5', border: '1px solid #6EE7B7', borderRadius: 8, fontSize: 13, color: '#065F46' }}>
                  Password reset email sent — check your inbox.
                </div>
              )}

              <button
                type="submit"
                className="btn-primary"
                disabled={loading}
                style={{ width: '100%', padding: '12px', fontSize: 15 }}
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            <p style={{ marginTop: 24, fontSize: 12, color: 'var(--subtext)', textAlign: 'center' }}>
              Internal tool — access by invitation only
            </p>
          </>
        )}

        {/* ── ADD USER TAB ── */}
        {tab === 'adduser' && (
          <>
            <div style={{ marginBottom: 28 }}>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>Add a user</h1>
              <p style={{ fontSize: 14, color: 'var(--subtext)' }}>Create a new account for a team member</p>
            </div>

            <form onSubmit={handleAddUser}>
              <div style={{ marginBottom: 16 }}>
                <label className="form-label">Email address</label>
                <input
                  id="new-email"
                  className="form-input"
                  type="email"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  required
                  autoComplete="off"
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label className="form-label">Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="new-password"
                    className="form-input"
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Min. 6 characters"
                    required
                    autoComplete="new-password"
                    style={{ paddingRight: 44 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(v => !v)}
                    style={{
                      position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', color: 'var(--subtext)', fontSize: 13
                    }}
                  >
                    {showNewPassword ? '🙈' : '👁'}
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <label className="form-label">Confirm password</label>
                <input
                  id="confirm-password"
                  className="form-input"
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  required
                  autoComplete="new-password"
                />
              </div>

              {addError && (
                <div style={{ marginBottom: 16, padding: '10px 14px', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 8, fontSize: 13, color: 'var(--red)' }}>
                  {addError}
                </div>
              )}

              {addSuccess && (
                <div style={{ marginBottom: 16, padding: '10px 14px', background: '#D1FAE5', border: '1px solid #6EE7B7', borderRadius: 8, fontSize: 13, color: '#065F46' }}>
                  ✅ {addSuccess}
                </div>
              )}

              <button
                type="submit"
                className="btn-primary"
                disabled={addLoading}
                style={{ width: '100%', padding: '12px', fontSize: 15 }}
              >
                {addLoading ? 'Creating user…' : 'Create user'}
              </button>
            </form>

            <div style={{ marginTop: 20, padding: '12px 16px', background: 'var(--blue-pale)', border: '1px solid var(--blue-light)', borderRadius: 8, fontSize: 12, color: 'var(--subtext)', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--blue)' }}>ℹ️ Note:</strong> The new user will receive a confirmation email from Supabase before they can log in. Make sure email confirmations are enabled in Supabase settings, or disable them for direct access.
            </div>
          </>
        )}

      </div>

      {/* Mobile warning */}
      <div className="desktop-only-warning">
        <div style={{ fontSize: 48, marginBottom: 8 }}>🖥️</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Desktop Required</div>
        <p style={{ fontSize: 14, opacity: 0.7, maxWidth: 280 }}>Orbit Analytics is designed for desktop use (min 1280px). Please open on a larger screen.</p>
      </div>
    </div>
  )
}
