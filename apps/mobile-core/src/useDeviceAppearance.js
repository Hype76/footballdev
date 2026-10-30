import { useEffect, useState } from 'react'
import { useColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getDeviceThemeStorageKey, normalizeDeviceThemeMode, resolveDeviceThemeMode } from './deviceThemeCore'

export function useDeviceAppearance(appRole) {
  const [preference, setPreference] = useState('light')
  const systemMode = useColorScheme()
  useEffect(() => {
    let active = true
    const key = getDeviceThemeStorageKey(appRole)
    AsyncStorage.getItem(key).then(value => { if (active) setPreference(normalizeDeviceThemeMode(value)) }).catch(() => {})
    return () => { active = false }
  }, [appRole])
  return resolveDeviceThemeMode(preference, systemMode)
}
