import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createClubAndManagerProfile, fetchUserProfile, supabase } from './supabase.js'

const AuthContext = createContext(null)

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
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

export function canAccessApprovals(user) {
  return isSuperAdmin(user) || Number(user?.roleRank ?? 0) >= 50
}

export function canManageFormFields(user) {
  return canAccessApprovals(user)
}

export function canManageClubSettings(user) {
  return canAccessApprovals(user)
}

export function canDeletePlayer(user) {
  return canAccessApprovals(user)
}

export function canShareEvaluation(user, evaluation) {
  if (!user || !evaluation) {
    return false
  }

  if (isSuperAdmin(user) || Number(user.roleRank ?? 0) >= 50) {
    return true
  }

  if (!user.requireApproval) {
    return true
  }

  return evaluation.status === 'Approved'
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
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const userRef = useRef(null)

  useEffect(() => {
    userRef.current = user
  }, [user])

  useEffect(() => {
    let isMounted = true

    const syncSession = async (nextSession, options = {}) => {
      if (!isMounted) {
        return
      }

      const nextUserId = String(nextSession?.user?.id ?? '')
      const currentUserId = String(userRef.current?.id ?? '')
      const shouldKeepCurrentView =
        options.background === true &&
        Boolean(currentUserId) &&
        Boolean(nextUserId) &&
        currentUserId === nextUserId

      if (!shouldKeepCurrentView) {
        setIsLoading(true)
      }

      if (!nextSession?.user) {
        setSession(null)
        setUser(null)
        setAuthError('')
        setIsLoading(false)
        return
      }

      try {
        const profile = await fetchUserProfile(nextSession.user)

        if (!isMounted) {
          return
        }

        setSession(nextSession)
        setUser(profile)
        setAuthError('')
      } catch (error) {
        console.error(error)

        if (!isMounted) {
          return
        }

        setSession(nextSession)
        if (!shouldKeepCurrentView) {
          setUser(null)
        }
        setAuthError(error.message || 'Could not load user profile.')
      } finally {
        if (isMounted && !shouldKeepCurrentView) {
          setIsLoading(false)
        }
      }
    }

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) {
          console.error(error)
          if (isMounted) {
            setAuthError(error.message || 'Could not restore your session.')
          }
        }

        return syncSession(data?.session ?? null)
      })
      .catch((error) => {
        console.error(error)
        if (isMounted) {
          setAuthError(error.message || 'Could not restore your session.')
          setIsLoading(false)
        }
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      window.setTimeout(() => {
        void syncSession(nextSession, {
          background: event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED',
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
      const profile = String(clubName ?? '').trim()
        ? await createClubAndManagerProfile({
            authUser: data.user,
            clubName,
          })
        : await fetchUserProfile(data.user)

      setSession(data.session ?? null)
      setUser(profile)
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

  const value = useMemo(
    () => ({
      session,
      user,
      isLoading,
      authError,
      signInWithPassword,
      signUpWithClub,
      signOut,
      updateCurrentClubDetails,
    }),
    [authError, isLoading, session, user],
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
