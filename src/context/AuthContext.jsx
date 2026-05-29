import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../services/supabase'

// DEV BYPASS: set to false to use real Supabase auth
const DEV_BYPASS = false
const DEV_USER = { id: 'dev-user', email: 'dev@hoppa.com', user_metadata: { full_name: 'Dev User' } }

// ─── Domain restriction ────────────────────────────────────────────────────────
const ALLOWED_DOMAIN = 'elifetransfer.com'
export const DOMAIN_ERROR = 'Access is restricted to @elifetransfer.com accounts only.'

export function isAllowedEmail(email) {
  if (!email) return false
  return email.toLowerCase().trim().endsWith(`@${ALLOWED_DOMAIN}`)
}

// ─── Production URL — NEVER use window.location.origin here because admins ─────
// create users from their local machine (localhost). The confirmation link must
// always point to the live production app, not wherever the admin is running.
const PRODUCTION_URL = import.meta.env.VITE_APP_URL || 'https://orbit.elifetransfer.com'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [domainError, setDomainError] = useState(null)

  useEffect(() => {
    if (DEV_BYPASS) {
      setUser(DEV_USER)
      setSession({ user: DEV_USER })
      setLoading(false)
      return
    }

    // getSession may return an error if the stored refresh token is stale/invalid.
    // When that happens ("Refresh Token Not Found"), clear the corrupted session
    // from localStorage so the user sees the login screen instead of a broken app.
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error?.message?.includes('Refresh Token')) {
        // Token is stale — wipe it and force re-login
        supabase.auth.signOut().catch(() => {})
        setSession(null)
        setUser(null)
        setLoading(false)
        return
      }
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Handle token refresh failure — clears corrupted tokens and forces re-login
      if (event === 'TOKEN_REFRESHED' && !session) {
        await supabase.auth.signOut().catch(() => {})
        setSession(null)
        setUser(null)
        setLoading(false)
        return
      }

      // SIGNED_OUT — always clear state (handles manual signout + forced signout from refresh failure)
      if (event === 'SIGNED_OUT') {
        setDomainError(null)
        setSession(null)
        setUser(null)
        setLoading(false)
        return
      }

      // Post-OAuth domain check — fires after Google redirect completes.
      // If the signed-in email isn't @elifetransfer.com, sign them out immediately.
      if (session?.user && !isAllowedEmail(session.user.email)) {
        await supabase.auth.signOut()
        setDomainError(DOMAIN_ERROR)
        setSession(null)
        setUser(null)
        setLoading(false)
        return
      }
      setDomainError(null)
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  // ── Sign in with email/password ───────────────────────────────────────────────
  // Layer 1: domain check (blocks non-elifetransfer.com before hitting Supabase)
  // Layer 2: email confirmation check (blocks users who haven't clicked their
  //          verification link — Supabase itself enforces this when
  //          "Confirm email" is enabled in the Dashboard, but we double-check
  //          here as a defence-in-depth measure)
  const signIn = async (email, password) => {
    if (!isAllowedEmail(email)) {
      return { data: null, error: { message: DOMAIN_ERROR } }
    }
    const result = await supabase.auth.signInWithPassword({ email, password })
    if (result.data?.user && !result.data.user.email_confirmed_at) {
      // User exists but hasn't confirmed — force sign-out and surface clear message
      await supabase.auth.signOut()
      return {
        data: null,
        error: { message: 'Please verify your email before signing in. Check your inbox for a confirmation link.' },
      }
    }
    return result
  }

  // ── Google OAuth — domain enforcement happens in onAuthStateChange above ──────
  const signInWithGoogle = async () => {
    return supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: PRODUCTION_URL }
    })
  }

  const signOut = async () => {
    return supabase.auth.signOut()
  }

  // ── Create user — domain-checked, emailRedirectTo always uses PRODUCTION_URL ─
  // CRITICAL: Do NOT use window.location.origin here. When an admin creates a user
  // from their local machine, window.location.origin = http://localhost:5173, which
  // makes the confirmation link in the email point to localhost — unclickable for
  // the new user. PRODUCTION_URL (from VITE_APP_URL env var) is always correct.
  const createUser = async (email, password) => {
    if (!isAllowedEmail(email)) {
      return { data: null, error: { message: DOMAIN_ERROR } }
    }
    return supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: PRODUCTION_URL },
    })
  }

  const resetPassword = async (email) => {
    return supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${PRODUCTION_URL}/reset-password`,
    })
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, domainError, signIn, signInWithGoogle, signOut, resetPassword, createUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
