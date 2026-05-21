import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { AppState } from 'react-native'
import { authenticateWithBiometrics, getBiometricEnabled } from './biometrics'
import { fetchMobileProfile } from './profile'
import { isSupabaseConfigured, mobileConfigError, supabase } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ appRole, children }) {
  const [authError, setAuthError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isLocked, setIsLocked] = useState(false)
  const [isProfileLoading, setIsProfileLoading] = useState(false)
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)

  const loadProfile = useCallback(async (nextSession) => {
    if (!nextSession?.user) {
      setUser(null)
      return
    }

    setIsProfileLoading(true)
    setAuthError('')

    try {
      const profile = await fetchMobileProfile(nextSession.user, appRole)
      setUser(profile)
    } catch (error) {
      console.error(error)
      setUser(null)
      setAuthError(error.message || 'Account details could not be loaded.')
    } finally {
      setIsProfileLoading(false)
    }
  }, [appRole])

  useEffect(() => {
    let isMounted = true

    async function bootstrap() {
      if (!isSupabaseConfigured) {
        setAuthError(mobileConfigError || 'This app build is missing its connection setup.')
        setIsLoading(false)
        return
      }

      try {
        const { data, error } = await supabase.auth.getSession()

        if (error) {
          throw error
        }

        if (!isMounted) {
          return
        }

        setSession(data?.session || null)
        if (data?.session?.user && await getBiometricEnabled()) {
          setIsLocked(true)
        }
        await loadProfile(data?.session)
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setAuthError(error.message || 'Login session could not be restored.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void bootstrap()

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      void loadProfile(nextSession)
    })

    return () => {
      isMounted = false
      data.subscription.unsubscribe()
    }
  }, [appRole, loadProfile])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'background') {
        return
      }

      void getBiometricEnabled().then((biometricEnabled) => {
        if (biometricEnabled && session?.user) {
          setIsLocked(true)
        }
      }).catch((error) => {
        console.error(error)
      })
    })

    return () => {
      subscription.remove()
    }
  }, [session?.user])

  async function signIn(email, password) {
    setAuthError('')
    setIsLocked(false)
    const { error } = await supabase.auth.signInWithPassword({
      email: String(email || '').trim(),
      password,
    })

    if (error) {
      setAuthError(error.message || 'Login failed.')
      throw error
    }
  }

  async function signOut() {
    setIsLocked(false)
    setUser(null)
    const { error } = await supabase.auth.signOut()

    if (error) {
      setAuthError(error.message || 'Sign out failed.')
      throw error
    }
  }

  async function unlockWithBiometrics() {
    setAuthError('')
    await authenticateWithBiometrics()
    setIsLocked(false)
  }

  const value = useMemo(() => ({
    appRole,
    authError,
    isLoading,
    isLocked,
    isProfileLoading,
    session,
    signIn,
    signOut,
    unlockWithBiometrics,
    user,
  }), [appRole, authError, isLoading, isLocked, isProfileLoading, session, user])

  return createElement(AuthContext.Provider, { value }, children)
}

export function useMobileAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useMobileAuth must be used inside AuthProvider.')
  }

  return context
}
