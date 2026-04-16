import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react'
import { fetchOrCreateUserProfile, supabase } from './supabase.js'

const AuthContext = createContext(null)

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

export function isManager(user) {
  return user?.role === 'Manager'
}

export function isCoach(user) {
  return user?.role === 'Coach'
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

  const evaluationTeam = evaluation.team || ''
  return canEditEvaluation(user, evaluation) && normalizeName(evaluationTeam) === normalizeName(user.team)
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

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
        setIsLoading(false)
        return
      }

      try {
        const profile = await fetchOrCreateUserProfile(nextSession.user)

        if (!isMounted) {
          return
        }

        setSession(nextSession)
        setUser(profile)
      } catch (error) {
        console.error(error)

        if (!isMounted) {
          return
        }

        setSession(nextSession)
        setUser(null)
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
        }

        return syncSession(data?.session ?? null)
      })
      .catch((error) => {
        console.error(error)
        if (isMounted) {
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

  const signInWithMagicLink = async (email) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    })

    if (error) {
      console.error(error)
      throw error
    }
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()

    if (error) {
      console.error(error)
      throw error
    }
  }

  const value = useMemo(
    () => ({
      session,
      user,
      isLoading,
      signInWithMagicLink,
      signOut,
    }),
    [isLoading, session, user],
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
