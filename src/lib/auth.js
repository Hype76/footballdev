import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react'
import { createClubAndManagerProfile, fetchUserProfile, supabase } from './supabase.js'

const AuthContext = createContext(null)

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

export function isManager(user) {
  return user?.role === 'manager'
}

export function isCoach(user) {
  return user?.role === 'coach'
}

export function canAccessApprovals(user) {
  return isManager(user)
}

export function canEditEvaluation(user, evaluation) {
  if (!user || !evaluation) {
    return false
  }

  if (isManager(user)) {
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

  if (isManager(user)) {
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

  useEffect(() => {
    let isMounted = true

    const syncSession = async (nextSession) => {
      if (!isMounted) {
        return
      }

      setIsLoading(true)

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
        setUser(null)
        setAuthError(error.message || 'Could not load user profile.')
      } finally {
        if (isMounted) {
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
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      window.setTimeout(() => {
        void syncSession(nextSession)
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
      const profile = await createClubAndManagerProfile({
        authUser: data.user,
        clubName,
      })

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

  const value = useMemo(
    () => ({
      session,
      user,
      isLoading,
      authError,
      signInWithPassword,
      signUpWithClub,
      signOut,
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
