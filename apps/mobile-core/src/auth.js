import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { AppState } from 'react-native'
import { authenticateWithBiometrics, getBiometricEnabled, setBiometricEnabled } from './biometrics'
import { getMobileRuntimeConfig } from './config'
import { revokeNativePushDevice } from './notifications'
import { fetchMobileProfile } from './profile'
import {
  DEFAULT_MOBILE_STARTUP_TIMEOUT_MS,
  getMobileStartupDiagnosticPrefix,
  MOBILE_STARTUP_STATES,
  runMobileStartup,
  withStartupTimeout,
} from './startupStateCore'
import {
  clearMobileSessionStorage,
  getAccessToken,
  isSupabaseConfigured,
  mobileConfigError,
  mobileSessionStorageError,
  supabase,
} from './supabase'

const AuthContext = createContext(null)

function isAuthoritativeProfileFailure(error) {
  const code = String(error?.code || '').trim().toLowerCase()
  const message = String(error?.message || error || '').trim().toLowerCase()
  const status = Number(error?.status || error?.statusCode || 0)
  return status === 401
    || status === 403
    || code === '42501'
    || message.includes('not linked to a coach account')
    || message.includes('not authorised')
    || message.includes('not authorized')
    || message.includes('permission denied')
}

async function disableBiometricsForApp(appRole) {
  if (appRole === 'parent') {
    await setBiometricEnabled(false)
    return
  }
  await setBiometricEnabled(false, appRole)
}

export function AuthProvider({
  appRole,
  children,
  offlineProfileStore = null,
  onBeforeSignOut = null,
  onResetLocalData = null,
  prepareStartup = null,
  preserveNativePushOnSignOut = false,
}) {
  const [authError, setAuthError] = useState('')
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0)
  const [isLocked, setIsLocked] = useState(false)
  const [isProfileLoading, setIsProfileLoading] = useState(false)
  const [session, setSession] = useState(null)
  const [startupDiagnosticCode, setStartupDiagnosticCode] = useState('')
  const [startupState, setStartupState] = useState(MOBILE_STARTUP_STATES.BOOTING)
  const [user, setUser] = useState(null)

  useEffect(() => {
    const updateAutoRefresh = (state) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh()
      } else {
        supabase.auth.stopAutoRefresh()
      }
    }

    updateAutoRefresh(AppState.currentState)
    const subscription = AppState.addEventListener('change', updateAutoRefresh)

    return () => {
      subscription.remove()
      supabase.auth.stopAutoRefresh()
    }
  }, [])

  const loadProfile = useCallback(async (nextSession) => {
    if (!nextSession?.user) {
      setUser(null)
      return
    }

    setIsProfileLoading(true)
    setAuthError('')

    let cachedProfile = null

    if (offlineProfileStore?.read) {
      try {
        cachedProfile = await offlineProfileStore.read(nextSession.user.id)
        if (cachedProfile) setUser({ ...cachedProfile, isOfflineProfile: true })
      } catch (error) {
        console.warn(error)
      }
    }

    const refreshProfile = async () => {
      try {
        const profile = await fetchMobileProfile(nextSession.user, appRole)
        let persistedProfile = profile
        if (offlineProfileStore?.write) {
          try {
            persistedProfile = await offlineProfileStore.write(profile) || profile
          } catch (error) {
            console.warn(error)
          }
        }
        setUser(persistedProfile)
        return persistedProfile
      } catch (error) {
        if (cachedProfile && !isAuthoritativeProfileFailure(error)) {
          console.warn(error)
          return cachedProfile
        }
        if (cachedProfile && offlineProfileStore?.clear) {
          try {
            await offlineProfileStore.clear()
          } catch (clearError) {
            console.warn(clearError)
          }
        }
        setUser(null)
        setAuthError(error.message || 'Account details could not be loaded.')
        throw error
      }
    }

    if (cachedProfile) {
      const diagnosticPrefix = getMobileStartupDiagnosticPrefix(appRole)
      void withStartupTimeout(
        refreshProfile,
        DEFAULT_MOBILE_STARTUP_TIMEOUT_MS,
        `${diagnosticPrefix}_PROFILE_REFRESH_TIMEOUT`,
      ).catch((error) => {
        if (error?.code !== `${diagnosticPrefix}_PROFILE_REFRESH_TIMEOUT`) console.warn(error)
      }).finally(() => setIsProfileLoading(false))
      return cachedProfile
    }

    try {
      return await refreshProfile()
    } finally {
      setIsProfileLoading(false)
    }
  }, [appRole, offlineProfileStore])

  useEffect(() => {
    let isMounted = true

    async function bootstrap() {
      setAuthError('')
      setStartupDiagnosticCode('')

      const config = getMobileRuntimeConfig(appRole)
      const result = await runMobileStartup({
        appRole,
        clearInvalidSession: async () => {
          await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
          await clearMobileSessionStorage()
          setUser(null)
        },
        config: {
          ...config,
          isUsable: isSupabaseConfigured && !mobileSessionStorageError,
        },
        getBiometricEnabled: () => getBiometricEnabled(appRole),
        getSession: () => supabase.auth.getSession(),
        loadProfile,
        onLock: (locked) => {
          if (isMounted) setIsLocked(locked)
        },
        onSession: (nextSession) => {
          if (isMounted) setSession(nextSession)
        },
        onTransition: (nextState) => {
          if (isMounted) setStartupState(nextState)
        },
        prepare: () => prepareStartup?.(config),
        resolvingProfileState: appRole === 'coach'
          ? MOBILE_STARTUP_STATES.RESOLVING_STAFF_CONTEXT
          : MOBILE_STARTUP_STATES.RESTORING_SESSION,
      })

      if (!isMounted) return
      setStartupState(result.state)
      setStartupDiagnosticCode(result.diagnosticCode || '')
      if (result.state === MOBILE_STARTUP_STATES.RECOVERABLE_ERROR) {
        const message = !isSupabaseConfigured
          ? mobileConfigError || 'This app build is missing its connection setup.'
          : mobileSessionStorageError
            ? 'Secure session storage could not be prepared.'
            : 'Login session could not be restored.'
        setAuthError(message)
      }
    }

    void bootstrap()

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'INITIAL_SESSION') {
        return
      }

      if (!nextSession?.user) {
        if (!['SIGNED_OUT', 'USER_DELETED'].includes(event)) return
        setSession(null)
        setUser(null)
        setIsLocked(false)
        setStartupState(MOBILE_STARTUP_STATES.READY_SIGNED_OUT)
        return
      }

      setSession(nextSession)

      setStartupState(appRole === 'coach'
        ? MOBILE_STARTUP_STATES.RESOLVING_STAFF_CONTEXT
        : MOBILE_STARTUP_STATES.RESTORING_SESSION)
      void loadProfile(nextSession).then(() => {
        if (isMounted) setStartupState(MOBILE_STARTUP_STATES.READY_SIGNED_IN)
      }).catch((error) => {
        if (!isMounted) return
        setStartupDiagnosticCode(error?.code || `${getMobileStartupDiagnosticPrefix(appRole)}_PROFILE_LOAD_FAILED`)
        setStartupState(MOBILE_STARTUP_STATES.RECOVERABLE_ERROR)
      })
    })

    return () => {
      isMounted = false
      data.subscription.unsubscribe()
    }
  }, [appRole, bootstrapAttempt, loadProfile, prepareStartup])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'background') {
        return
      }

      void getBiometricEnabled(appRole).then((biometricEnabled) => {
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
  }, [appRole, session?.user])

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

  const retryStartup = useCallback(() => {
    setStartupState(MOBILE_STARTUP_STATES.BOOTING)
    setBootstrapAttempt((attempt) => attempt + 1)
  }, [])

  const resetLocalAppData = useCallback(async () => {
    setStartupState(MOBILE_STARTUP_STATES.BOOTING)
    setStartupDiagnosticCode('')
    setAuthError('')
    setIsLocked(false)
    setUser(null)

    try {
      await withStartupTimeout(async () => {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
        await clearMobileSessionStorage()
        if (offlineProfileStore?.clear) await offlineProfileStore.clear()
        await onResetLocalData?.()
        await disableBiometricsForApp(appRole)
      })

      setSession(null)
      setStartupState(MOBILE_STARTUP_STATES.READY_SIGNED_OUT)
    } catch (error) {
      setAuthError('Saved app information could not be reset safely.')
      setStartupDiagnosticCode(error?.code || `${getMobileStartupDiagnosticPrefix(appRole)}_LOCAL_RESET_FAILED`)
      setStartupState(MOBILE_STARTUP_STATES.RECOVERABLE_ERROR)
    }
  }, [appRole, offlineProfileStore, onResetLocalData])

  const signOut = useCallback(async () => {
    setIsLocked(false)
    setUser(null)

    try {
      const accessToken = await getAccessToken()
      const config = getMobileRuntimeConfig(appRole)

      if (accessToken && config.apiBaseUrl && onBeforeSignOut) {
        await onBeforeSignOut({
          accessToken,
          apiBaseUrl: config.apiBaseUrl,
        })
      } else if (!preserveNativePushOnSignOut && accessToken && config.apiBaseUrl) {
        await revokeNativePushDevice({
          accessToken,
          apiBaseUrl: config.apiBaseUrl,
          appRole,
        })
      }
    } catch (error) {
      console.warn(error)
    }

    try {
      await disableBiometricsForApp(appRole)
    } catch (error) {
      console.warn(error)
    }

    if (offlineProfileStore?.clear) {
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
  }, [appRole, offlineProfileStore, onBeforeSignOut, preserveNativePushOnSignOut])

  const requestPasswordReset = useCallback(async (email) => {
    setAuthError('')

    const normalizedEmail = String(email || '').trim().toLowerCase()
    const config = getMobileRuntimeConfig(appRole)

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      const error = new Error('Enter the email address linked to your account.')
      setAuthError(error.message)
      throw error
    }

    if (!config.apiBaseUrl) {
      const error = new Error('Password recovery is temporarily unavailable. Please try again.')
      setAuthError(error.message)
      throw error
    }

    try {
      const response = await fetch(`${config.apiBaseUrl}/.netlify/functions/send-password-reset`, {
        body: JSON.stringify({ email: normalizedEmail }),
        headers: {
          'Content-Type': 'application/json',
          Origin: config.apiBaseUrl,
        },
        method: 'POST',
      })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(payload?.message || 'Password recovery could not be started. Please try again.')
      }

      return payload?.message || 'If that account exists, password recovery instructions will be sent.'
    } catch (error) {
      const message = error?.message || 'Password recovery could not be started. Please try again.'
      setAuthError(message)
      throw new Error(message)
    }
  }, [appRole])

  const unlockWithBiometrics = useCallback(async () => {
    setAuthError('')
    await authenticateWithBiometrics()
    setIsLocked(false)
  }, [])

  const refreshUserProfile = useCallback(async (nextAuthUser = null) => {
    const currentSession = session
    if (!currentSession?.user) return null
    return loadProfile({
      ...currentSession,
      user: nextAuthUser || currentSession.user,
    })
  }, [loadProfile, session])

  const value = useMemo(() => ({
    appRole,
    authError,
    isLoading: [
      MOBILE_STARTUP_STATES.BOOTING,
      MOBILE_STARTUP_STATES.RESTORING_SESSION,
      MOBILE_STARTUP_STATES.RESOLVING_STAFF_CONTEXT,
    ].includes(startupState),
    isLocked,
    isProfileLoading,
    refreshUserProfile,
    requestPasswordReset,
    resetLocalAppData,
    retryStartup,
    session,
    signIn,
    signOut,
    startupDiagnosticCode,
    startupState,
    unlockWithBiometrics,
    user,
  }), [
    appRole,
    authError,
    isLocked,
    isProfileLoading,
    refreshUserProfile,
    requestPasswordReset,
    resetLocalAppData,
    retryStartup,
    session,
    signIn,
    signOut,
    startupDiagnosticCode,
    startupState,
    unlockWithBiometrics,
    user,
  ])

  return createElement(AuthContext.Provider, { value }, children)
}

export function useMobileAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useMobileAuth must be used inside AuthProvider.')
  }

  return context
}
