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

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
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

  // ── Sign in with email/password — domain-checked before any Supabase call ───
  const signIn = async (email, password) => {
    if (!isAllowedEmail(email)) {
      return { data: null, error: { message: DOMAIN_ERROR } }
    }
    return supabase.auth.signInWithPassword({ email, password })
  }

  // ── Google OAuth — domain enforcement happens in onAuthStateChange above ─────
  const signInWithGoogle = async () => {
    return supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/` }
    })
  }

  const signOut = async () => {
    return supabase.auth.signOut()
  }

  // ── Create user — domain-checked before any Supabase call ───────────────────
  const createUser = async (email, password) => {
    if (!isAllowedEmail(email)) {
      return { data: null, error: { message: DOMAIN_ERROR } }
    }
    return supabase.auth.signUp({ email, password })
  }

  const resetPassword = async (email) => {
    return supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
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
