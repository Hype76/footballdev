import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  authenticateWithBiometrics,
  getBiometricAvailability,
  getBiometricPreference,
  setBiometricPreference,
} from './biometrics'
import { fetchMobileUserProfile } from './profile'
import { isSupabaseConfigured, supabase } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const isMountedRef = useRef(true)
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isProfileLoading, setIsProfileLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const [isLocked, setIsLocked] = useState(false)
  const [biometrics, setBiometrics] = useState({
    available: false,
    enabled: false,
    hasHardware: false,
    isEnrolled: false,
  })

  const loadProfile = async (nextSession) => {
    if (!nextSession?.user) {
      setUser(null)
      return
    }

    setIsProfileLoading(true)
    setAuthError('')

    try {
      const profile = await fetchMobileUserProfile(nextSession.user)
      if (isMountedRef.current) {
        setUser(profile)
      }
    } catch (error) {
      console.error(error)
      if (isMountedRef.current) {
        setUser(null)
        setAuthError(error.message || 'Could not load your profile.')
      }
    } finally {
      if (isMountedRef.current) {
        setIsProfileLoading(false)
      }
    }
  }

  const refreshBiometricState = async () => {
    const [availability, enabled] = await Promise.all([getBiometricAvailability(), getBiometricPreference()])
    if (isMountedRef.current) {
      setBiometrics({ ...availability, enabled: Boolean(enabled && availability.available) })
    }
    return { ...availability, enabled: Boolean(enabled && availability.available) }
  }

  useEffect(() => {
    isMountedRef.current = true

    const bootstrap = async () => {
      try {
        const biometricState = await refreshBiometricState()
        const { data, error } = await supabase.auth.getSession()

        if (error) {
          throw error
        }

        if (!data?.session) {
          setSession(null)
          setUser(null)
          return
        }

        setSession(data.session)
        if (biometricState.enabled) {
          setIsLocked(true)
        }
        await loadProfile(data.session)
      } catch (error) {
        console.error(error)
        setAuthError(error.message || 'Could not restore your session.')
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false)
        }
      }
    }

    void bootstrap()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession?.user) {
        setUser(null)
        setIsLocked(false)
        return
      }

      void loadProfile(nextSession)
    })

    return () => {
      isMountedRef.current = false
      subscription.unsubscribe()
    }
  }, [])

  const signInWithPassword = async ({ email, password }) => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase mobile environment variables are missing.')
    }

    setAuthError('')
    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(email || '').trim(),
      password,
    })

    if (error) {
      setAuthError(error.message || 'Login failed.')
      throw error
    }

    setSession(data.session)
    await loadProfile(data.session)
    await refreshBiometricState()
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) {
      setAuthError(error.message || 'Sign out failed.')
      throw error
    }

    setSession(null)
    setUser(null)
    setIsLocked(false)
  }

  const unlockWithBiometrics = async () => {
    const result = await authenticateWithBiometrics()
    if (result.success) {
      setIsLocked(false)
    }
    return result
  }

  const setBiometricLoginEnabled = async (enabled) => {
    const availability = await getBiometricAvailability()
    if (enabled && !availability.available) {
      throw new Error('Biometric login is not available on this device.')
    }

    if (enabled) {
      const result = await authenticateWithBiometrics()
      if (!result.success) {
        throw new Error('Biometric confirmation was cancelled.')
      }
    }

    await setBiometricPreference(enabled)
    await refreshBiometricState()
  }

  const value = useMemo(
    () => ({
      authError,
      biometrics,
      isLoading,
      isLocked,
      isProfileLoading,
      session,
      setBiometricLoginEnabled,
      signInWithPassword,
      signOut,
      unlockWithBiometrics,
      user,
    }),
    [authError, biometrics, isLoading, isLocked, isProfileLoading, session, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.')
  }
  return context
}
