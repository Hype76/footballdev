import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useMemo, useState } from 'react'
import { createParentHomePreferences, normalizeParentHomeSections } from './parentHomePreferencesCore'

const preferences = new Map()

export function useParentHomeSections(userId) {
  const preference = useMemo(() => {
    if (!userId) return null
    const key = `fp.parent.home-sections.v1.${userId}`
    if (!preferences.has(key)) preferences.set(key, createParentHomePreferences({
      read: () => AsyncStorage.getItem(key),
      write: value => AsyncStorage.setItem(key, value),
    }))
    return preferences.get(key)
  }, [userId])
  const [state, setState] = useState({ preference: null, ready: false, sections: normalizeParentHomeSections(), error: '' })
  useEffect(() => {
    let active = true
    if (preference) void preference.read().then(sections => {
      if (active) setState({ preference, ready: true, sections, error: '' })
    })
    return () => { active = false }
  }, [preference])
  const ready = state.preference === preference && state.ready
  const toggle = section => {
    if (!ready || !preference) return
    const writing = preference.toggle(section)
    setState({ preference, ready: true, sections: preference.peek(), error: '' })
    void writing.catch(() => setState(current => current.preference === preference
      ? { ...current, error: 'Your Home layout could not be saved on this device.' } : current))
  }
  return { sections: ready ? state.sections : normalizeParentHomeSections(), ready, toggle, error: ready ? state.error : '' }
}
