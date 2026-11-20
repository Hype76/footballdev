import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { DEFAULT_MOBILE_STARTUP_TIMEOUT_MS, withStartupTimeout } from '../../mobile-core/src/startupStateCore'
import { supabase } from '../../mobile-core/src/supabase'
import { getAdultPlayerAccess } from './adultPlayerAccess.js'

export function useAdultPlayerAccess(userId) {
  const [access, setAccess] = useState({ status: 'checking' })
  const request = useRef(0)
  const mounted = useRef(false)
  const linkedThisSession = useRef(false)

  const refresh = useCallback(async () => {
    if (!mounted.current) return null
    const requestId = ++request.current
    setAccess(previous => ({
      status: 'checking',
      userId,
      link: previous.userId === userId ? previous.link : null,
      previouslyUnlinked: previous.userId === userId && (previous.status === 'unlinked' || previous.previouslyUnlinked),
    }))
    try {
      const result = await withStartupTimeout(() => getAdultPlayerAccess(supabase, userId), DEFAULT_MOBILE_STARTUP_TIMEOUT_MS, 'ADULT_PLAYER_ACCESS_TIMEOUT')
      if (mounted.current && request.current === requestId) {
        linkedThisSession.current = result.status === 'linked'
        setAccess({ ...result, userId })
      }
      return result
    } catch (error) {
      const result = { status: 'error', previouslyLinked: linkedThisSession.current, message: error.code === 'ADULT_PLAYER_ACCESS_TIMEOUT' ? 'Player access is taking too long to check. Check your connection and try again.' : error.message }
      if (mounted.current && request.current === requestId) setAccess({ ...result, userId })
      return result
    }
  }, [userId])

  useEffect(() => {
    mounted.current = true
    const initialCheck = setTimeout(refresh, 0)
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh()
    })
    return () => {
      mounted.current = false
      clearTimeout(initialCheck)
      subscription.remove()
    }
  }, [refresh])

  return { access: access.userId === userId ? access : { status: 'checking' }, refresh }
}
