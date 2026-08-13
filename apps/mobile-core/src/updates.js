import * as Updates from 'expo-updates'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'

const MINIMUM_CHECK_INTERVAL_MS = 15 * 60 * 1000

export function useMobileAutomaticUpdates() {
  const [state, setState] = useState({ readyOnRestart: false, status: 'idle' })
  const checkingRef = useRef(false)
  const lastCheckedAtRef = useRef(0)

  const check = useCallback(async ({ force = false } = {}) => {
    if (process.env.NODE_ENV === 'development' || !Updates.isEnabled || checkingRef.current) return false
    if (!force && Date.now() - lastCheckedAtRef.current < MINIMUM_CHECK_INTERVAL_MS) return false
    checkingRef.current = true
    lastCheckedAtRef.current = Date.now()
    setState((current) => ({ ...current, status: 'checking' }))
    try {
      const update = await Updates.checkForUpdateAsync()
      if (!update.isAvailable) {
        setState({ readyOnRestart: false, status: 'current' })
        return false
      }
      await Updates.fetchUpdateAsync()
      setState({ readyOnRestart: true, status: 'ready' })
      return true
    } catch {
      setState((current) => ({ ...current, status: 'retry-later' }))
      return false
    } finally {
      checkingRef.current = false
    }
  }, [])

  useEffect(() => {
    void check({ force: true })
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void check()
    })
    return () => subscription.remove()
  }, [check])

  return state
}
