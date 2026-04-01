import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../services/supabase'

// DEV BYPASS: set to false to use real Supabase auth
const DEV_BYPASS = false
const DEV_USER = { id: 'dev-user', email: 'dev@hoppa.com', user_metadata: { full_name: 'Dev User' } }

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email, password) => {
    return supabase.auth.signInWithPassword({ email, password })
  }

  const signInWithGoogle = async () => {
    return supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/` }
    })
  }

  const signOut = async () => {
    return supabase.auth.signOut()
  }

  const createUser = async (email, password) => {
    return supabase.auth.signUp({ email, password })
  }

  const resetPassword = async (email) => {
    return supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
    })
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signInWithGoogle, signOut, resetPassword, createUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
