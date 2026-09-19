import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useRef, useState } from 'react'

const storageKey = 'fp.coach.quick-actions.visible.v1'

export function useQuickActionVisibility() {
  const [enabled, setEnabled] = useState(true)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)

  useEffect(() => {
    let active = true
    AsyncStorage.getItem(storageKey).then(value => {
      if (active) setEnabled(value !== 'false')
    }).catch(() => {}).finally(() => { if (active) setReady(true) })
    return () => { active = false }
  }, [])

  const toggle = async (value) => {
    if (!ready || pending.current) return
    pending.current = true
    setSaving(true)
    setError('')
    try {
      await AsyncStorage.setItem(storageKey, String(Boolean(value)))
      setEnabled(Boolean(value))
    } catch {
      setError('Could not save this setting. Please try again.')
    } finally {
      pending.current = false
      setSaving(false)
    }
  }

  return { enabled, ready, saving, error, toggle }
}
