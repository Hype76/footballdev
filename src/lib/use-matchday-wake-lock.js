import { useEffect, useState } from 'react'

const MATCH_DAY_WAKE_LOCK_SESSION_KEY = 'footballplayer.matchday.wake-lock-enabled'

function getStoredWakeLockPreference() {
  if (typeof window === 'undefined') return false
  return window.sessionStorage.getItem(MATCH_DAY_WAKE_LOCK_SESSION_KEY) === 'true'
}

export function useMatchDayWakeLock({ active = true } = {}) {
  const [enabled, setEnabled] = useState(getStoredWakeLockPreference)
  const [isActive, setIsActive] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const isSupported = typeof navigator !== 'undefined' && Boolean(navigator.wakeLock?.request)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(MATCH_DAY_WAKE_LOCK_SESSION_KEY, enabled ? 'true' : 'false')
    }
  }, [enabled])

  useEffect(() => {
    let wakeLock = null
    let disposed = false

    const releaseWakeLock = async () => {
      const currentWakeLock = wakeLock
      wakeLock = null
      if (currentWakeLock) {
        await currentWakeLock.release().catch(() => {})
      }
      if (!disposed) setIsActive(false)
    }

    const requestWakeLock = async () => {
      if (!active || !enabled || !isSupported || document.visibilityState !== 'visible') return

      try {
        wakeLock = await navigator.wakeLock.request('screen')
        if (disposed) {
          await wakeLock.release().catch(() => {})
          return
        }
        setIsActive(true)
        setErrorMessage('')
        wakeLock.addEventListener('release', () => {
          if (!disposed) setIsActive(false)
        }, { once: true })
      } catch {
        if (!disposed) {
          setIsActive(false)
          setErrorMessage('Screen awake is unavailable. Match Day remains fully usable.')
        }
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void requestWakeLock()
      } else {
        void releaseWakeLock()
      }
    }

    if (active && enabled && isSupported) {
      void requestWakeLock()
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      void releaseWakeLock()
    }
  }, [active, enabled, isSupported])

  const updateEnabled = (nextEnabled) => {
    const normalizedEnabled = Boolean(nextEnabled)
    setErrorMessage('')
    if (!normalizedEnabled) setIsActive(false)
    setEnabled(normalizedEnabled)
  }

  return {
    enabled,
    errorMessage: enabled && !active
      ? 'Screen awake was released because this match is concluded.'
      : enabled && !isSupported
      ? 'Screen awake is not supported in this browser. Match Day remains fully usable.'
      : errorMessage,
    isActive,
    isSupported,
    setEnabled: updateEnabled,
  }
}
