import { useEffect, useRef } from 'react'
import { Alert } from 'react-native'

// Preserve entries and acknowledge immediately. Only unresolved failures produce
// a native notice after one minute; adding a status row must never move content.
export function MobileFailureNotice({ message, scopeKey = '', onRetry, actionLabel = 'Retry', title = 'Needs attention' }) {
  const retry = useRef(onRetry)
  useEffect(() => { retry.current = onRetry }, [onRetry])
  const announced = useRef('')
  useEffect(() => {
    if (!message) { announced.current = ''; return undefined }
    const identity = scopeKey + ':' + message
    if (announced.current === identity) return undefined
    let current = true
    const timer = setTimeout(() => {
      if (!current) return
      announced.current = identity
      Alert.alert(title, message, [
        { text: 'OK', style: 'cancel' },
        ...(retry.current ? [{ text: actionLabel, onPress: () => { if (current) void retry.current() } }] : []),
      ])
    }, 60000)
    return () => { current = false; clearTimeout(timer) }
  }, [actionLabel, message, scopeKey, title])
  return null
}
