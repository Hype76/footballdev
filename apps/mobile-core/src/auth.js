import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { AppState } from 'react-native'
import { authenticateWithBiometrics, getBiometricEnabled, setBiometricEnabled } from './biometrics'
import { getMobileRuntimeConfig } from './config'
import { revokeNativePushDevice } from './notifications'
import { fetchMobileProfile } from './profile'
import { clearMobileSessionStorage, getAccessToken, isSupabaseConfigured, mobileConfigError, supabase } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ appRole, children, offlineProfileStore = null }) {
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

    let cachedProfile = null

    if (appRole === 'parent' && offlineProfileStore?.read) {
      try {
        cachedProfile = await offlineProfileStore.read(nextSession.user.id)
        if (cachedProfile) setUser({ ...cachedProfile, isOfflineProfile: true })
      } catch (error) {
        console.warn(error)
      }
    }

    try {
      const profile = await fetchMobileProfile(nextSession.user, appRole)
      setUser(profile)
      if (appRole === 'parent' && offlineProfileStore?.write) {
        try {
          await offlineProfileStore.write(profile)
        } catch (error) {
          console.warn(error)
        }
      }
    } catch (error) {
      console.error(error)
      if (!cachedProfile) {
        setUser(null)
        setAuthError(error.message || 'Account details could not be loaded.')
      }
    } finally {
      setIsProfileLoading(false)
    }
  }, [appRole, offlineProfileStore])

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

        const nextSession = data?.session || null
        const biometricEnabled = Boolean(nextSession?.user && await getBiometricEnabled())

        if (!isMounted) {
          return
        }

        setIsLocked(biometricEnabled)
        setSession(nextSession)
        await loadProfile(nextSession)
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

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'INITIAL_SESSION') {
        return
      }

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

  const signIn = useCallback(async (email, password) => {
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
  }, [])

  const signOut = useCallback(async () => {
    setIsLocked(false)
    setUser(null)

    try {
      const accessToken = await getAccessToken()
      const config = getMobileRuntimeConfig(appRole)

      if (accessToken && config.apiBaseUrl) {
        await revokeNativePushDevice({
          accessToken,
          apiBaseUrl: config.apiBaseUrl,
        })
      }
    } catch (error) {
      console.warn(error)
    }

    try {
      await setBiometricEnabled(false)
    } catch (error) {
      console.warn(error)
    }

    if (appRole === 'parent' && offlineProfileStore?.clear) {
      try {
        await offlineProfileStore.clear()
      } catch (error) {
        console.warn(error)
      }
    }

    let signOutError = null

    try {
      const { error } = await supabase.auth.signOut()
      signOutError = error
    } finally {
      try {
        await clearMobileSessionStorage()
      } finally {
        setSession(null)
        setUser(null)
      }
    }

    if (signOutError) {
      setAuthError(signOutError.message || 'Sign out failed.')
      throw signOutError
    }
  }, [appRole, offlineProfileStore])

  const unlockWithBiometrics = useCallback(async () => {
    setAuthError('')
    await authenticateWithBiometrics()
    setIsLocked(false)
  }, [])

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
  }), [appRole, authError, isLoading, isLocked, isProfileLoading, session, signIn, signOut, unlockWithBiometrics, user])

  return createElement(AuthContext.Provider, { value }, children)
}

export function useMobileAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useMobileAuth must be used inside AuthProvider.')
  }

  return context
}
