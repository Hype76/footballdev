import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase-client.js'

const AuthContext = createContext(null)
let authDataModulePromise = null
const PRODUCTION_APP_ORIGIN = 'https://playerfeedback.online'

function loadAuthDataModule() {
  if (!authDataModulePromise) {
    authDataModulePromise = import('./supabase.js')
  }

  return authDataModulePromise
}

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

function getPasswordResetRedirectUrl() {
  const configuredOrigin = String(import.meta.env.VITE_APP_URL ?? import.meta.env.VITE_PUBLIC_APP_URL ?? '').trim()
  const currentOrigin = window.location.origin
  const resolvedOrigin = configuredOrigin || (window.location.hostname === 'localhost' ? PRODUCTION_APP_ORIGIN : currentOrigin)

  return `${resolvedOrigin.replace(/\/$/, '')}/reset-password`
}

function areUsersEquivalent(leftUser, rightUser) {
  if (!leftUser || !rightUser) {
    return false
  }

  return (
    String(leftUser.id ?? '') === String(rightUser.id ?? '') &&
    String(leftUser.email ?? '') === String(rightUser.email ?? '') &&
    String(leftUser.username ?? '') === String(rightUser.username ?? '') &&
    String(leftUser.name ?? '') === String(rightUser.name ?? '') &&
    String(leftUser.role ?? '') === String(rightUser.role ?? '') &&
    String(leftUser.roleLabel ?? '') === String(rightUser.roleLabel ?? '') &&
    Number(leftUser.roleRank ?? 0) === Number(rightUser.roleRank ?? 0) &&
    String(leftUser.clubId ?? '') === String(rightUser.clubId ?? '') &&
    String(leftUser.clubName ?? '') === String(rightUser.clubName ?? '') &&
    String(leftUser.team ?? '') === String(rightUser.team ?? '') &&
    String(leftUser.clubLogoUrl ?? '') === String(rightUser.clubLogoUrl ?? '') &&
    String(leftUser.clubContactEmail ?? '') === String(rightUser.clubContactEmail ?? '') &&
    String(leftUser.clubContactPhone ?? '') === String(rightUser.clubContactPhone ?? '') &&
    String(leftUser.clubStatus ?? '') === String(rightUser.clubStatus ?? '') &&
    String(leftUser.clubSuspendedAt ?? '') === String(rightUser.clubSuspendedAt ?? '') &&
    Boolean(leftUser.requireApproval) === Boolean(rightUser.requireApproval) &&
    Boolean(leftUser.forcePasswordChange) === Boolean(rightUser.forcePasswordChange)
  )
}

export function getRoleLabel(user) {
  if (!user) {
    return 'Unknown'
  }

  return user.roleLabel || user.role || 'Unknown'
}

export function isSuperAdmin(user) {
  return user?.role === 'super_admin'
}

export function canManageUsers(user) {
  if (!user) {
    return false
  }

  return isSuperAdmin(user) || Number(user.roleRank ?? 0) >= 50
}

export function canAssignRole(user, targetRole) {
  if (!user || !targetRole) {
    return false
  }

  if (isSuperAdmin(user)) {
    return targetRole.roleKey !== 'super_admin'
  }

  const currentRank = Number(user.roleRank ?? 0)
  const targetRank = Number(targetRole.roleRank ?? targetRole.rank ?? 0)

  return currentRank >= 50 && targetRank <= currentRank
}

export function canManageFormFields(user) {
  return isSuperAdmin(user) || Number(user?.roleRank ?? 0) >= 50
}

export function canManageClubSettings(user) {
  return isSuperAdmin(user) || Number(user?.roleRank ?? 0) >= 50
}

export function canDeletePlayer(user) {
  return isSuperAdmin(user) || Number(user?.roleRank ?? 0) >= 50
}

export function canShareEvaluation(user, evaluation) {
  if (!user || !evaluation) {
    return false
  }

  return canViewEvaluation(user, evaluation)
}

export function canCreateEvaluation(user) {
  if (!user) {
    return false
  }

  return !isSuperAdmin(user)
}

export function canEditEvaluation(user, evaluation) {
  if (!user || !evaluation) {
    return false
  }

  if (isSuperAdmin(user) || Number(user.roleRank ?? 0) >= 50) {
    return true
  }

  const evaluationCoachId = evaluation.coachId || evaluation.coach_id || ''
  if (evaluationCoachId) {
    return String(evaluationCoachId) === String(user.id)
  }

  const evaluationCoach = evaluation.coach || evaluation.coachName || ''
  return normalizeName(evaluationCoach) === normalizeName(user.name)
}

export function canViewEvaluation(user, evaluation) {
  if (!user || !evaluation) {
    return false
  }

  if (isSuperAdmin(user) || Number(user.roleRank ?? 0) >= 50) {
    return true
  }

  const evaluationClubId = evaluation.clubId || evaluation.club_id || ''

  if (evaluationClubId && user.clubId) {
    return canEditEvaluation(user, evaluation) && String(evaluationClubId) === String(user.clubId)
  }

  return canEditEvaluation(user, evaluation)
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [authUser, setAuthUser] = useState(null)
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isProfileLoading, setIsProfileLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const userRef = useRef(null)
  const hasBootstrappedRef = useRef(false)
  const activeSyncIdRef = useRef(0)

  useEffect(() => {
    userRef.current = user
  }, [user])

  useEffect(() => {
    let isMounted = true

    const finishBootstrap = () => {
      if (!isMounted || hasBootstrappedRef.current) {
        return
      }

      hasBootstrappedRef.current = true
      setIsLoading(false)
    }

    const applySignedOutState = () => {
      if (!isMounted) {
        return
      }

      activeSyncIdRef.current += 1
      setSession(null)
      setAuthUser(null)
      setUser(null)
      setIsProfileLoading(false)
      setAuthError('')
      finishBootstrap()
    }

    const syncAuthenticatedSession = async (nextSession, options = {}) => {
      if (!isMounted || !nextSession?.user) {
        return
      }

      const syncId = activeSyncIdRef.current + 1
      activeSyncIdRef.current = syncId
      const nextUserId = String(nextSession.user?.id ?? '')
      const currentUserId = String(userRef.current?.id ?? '')
      const isSameUser = Boolean(currentUserId) && Boolean(nextUserId) && currentUserId === nextUserId
      const shouldLoadProfile = !options.background || !isSameUser || !userRef.current

      try {
        setSession(nextSession)
        setAuthUser(nextSession.user)
        if (shouldLoadProfile) {
          setIsProfileLoading(true)
        }

        const { fetchUserProfile } = await loadAuthDataModule()
        const profile = await fetchUserProfile(nextSession.user)

        if (!isMounted || activeSyncIdRef.current !== syncId) {
          return
        }

        setUser((currentUser) => (areUsersEquivalent(currentUser, profile) ? currentUser : profile))
        setIsProfileLoading(false)
        setAuthError('')
      } catch (error) {
        console.error(error)

        if (!isMounted || activeSyncIdRef.current !== syncId) {
          return
        }

        if (!(options.background && isSameUser)) {
          setUser(null)
        }
        setIsProfileLoading(false)
        setAuthError(error.message || 'Could not load user profile.')
      } finally {
        finishBootstrap()
      }
    }

    const bootstrapAuth = async () => {
      try {
        const { data, error } = await supabase.auth.getSession()

        if (error) {
          console.error(error)

          if (isMounted) {
            setAuthError(error.message || 'Could not restore your session.')
          }

          applySignedOutState()
          return
        }

        if (!data?.session?.user) {
          applySignedOutState()
          return
        }

        await syncAuthenticatedSession(data.session)
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setAuthError(error.message || 'Could not restore your session.')
        }

        applySignedOutState()
      }
    }

    void bootstrapAuth()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'INITIAL_SESSION') {
        return
      }

      window.setTimeout(() => {
        if (!nextSession?.user) {
          applySignedOutState()
          return
        }

        const nextUserId = String(nextSession.user?.id ?? '')
        const currentUserId = String(userRef.current?.id ?? '')
        const isSameUser = Boolean(currentUserId) && Boolean(nextUserId) && currentUserId === nextUserId
        const isBackgroundEvent =
          // Supabase can emit SIGNED_IN again when a tab regains focus for the same user.
          event === 'TOKEN_REFRESHED' ||
          event === 'USER_UPDATED' ||
          (event === 'SIGNED_IN' && isSameUser)

        void syncAuthenticatedSession(nextSession, {
          background: isBackgroundEvent,
        })
      }, 0)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signInWithPassword = async ({ email, password }) => {
    setAuthError('')

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      console.error(error)
      setAuthError(error.message || 'Login failed.')
      throw error
    }
  }

  const signUpWithClub = async ({ email, password, clubName }) => {
    setAuthError('')

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    })

    if (error) {
      console.error(error)
      setAuthError(error.message || 'Sign up failed.')
      throw error
    }

    if (!data.user) {
      const signupError = new Error('Account creation did not return a user.')
      console.error(signupError)
      setAuthError(signupError.message)
      throw signupError
    }

    try {
      const { createClubAndManagerProfile, fetchUserProfile } = await loadAuthDataModule()
      const profile = String(clubName ?? '').trim()
        ? await createClubAndManagerProfile({
            authUser: data.user,
            clubName,
          })
        : await fetchUserProfile(data.user)

      setSession(data.session ?? null)
      setAuthUser(data.user)
      setUser(profile)
      setIsProfileLoading(false)
      setAuthError('')
    } catch (profileError) {
      console.error(profileError)
      setAuthError(profileError.message || 'Could not create your club.')
      throw profileError
    }
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()

    if (error) {
      console.error(error)
      setAuthError(error.message || 'Sign out failed.')
      throw error
    }
  }

  const resetPassword = async (email) => {
    const normalizedEmail = String(email ?? '').trim()

    if (!normalizedEmail) {
      throw new Error('Enter your email address first.')
    }

    setAuthError('')

    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: getPasswordResetRedirectUrl(),
    })

    if (error) {
      console.error(error)
      setAuthError(error.message || 'Password reset failed.')
      throw error
    }
  }

  const updateCurrentClubDetails = (clubDetails) => {
    setUser((current) => {
      if (!current) {
        return current
      }

      return {
        ...current,
        clubName: String(clubDetails.name ?? current.clubName ?? '').trim(),
        team: String(clubDetails.name ?? current.team ?? '').trim(),
        clubLogoUrl: String(clubDetails.logoUrl ?? current.clubLogoUrl ?? '').trim(),
        clubContactEmail: String(clubDetails.contactEmail ?? current.clubContactEmail ?? '').trim(),
        clubContactPhone: String(clubDetails.contactPhone ?? current.clubContactPhone ?? '').trim(),
        requireApproval: Boolean(clubDetails.requireApproval ?? current.requireApproval ?? true),
      }
    })
  }

  const updateCurrentUserDetails = (profile) => {
    setUser((current) => {
      if (!current) {
        return profile
      }

      return {
        ...current,
        ...profile,
      }
    })
  }

  const value = useMemo(
    () => ({
      session,
      authUser,
      user,
      isLoading,
      isProfileLoading,
      authError,
      signInWithPassword,
      signUpWithClub,
      resetPassword,
      signOut,
      updateCurrentClubDetails,
      updateCurrentUserDetails,
    }),
    [authError, authUser, isLoading, isProfileLoading, session, user],
  )

  return createElement(AuthContext.Provider, { value }, children)
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }

  return context
}
