import { useEffect, useState } from 'react'
import { useColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { normalizeDeviceThemeMode, resolveDeviceThemeMode } from './deviceThemeCore'

export function useDeviceAppearance(appRole) {
  const [preference, setPreference] = useState('system')
  const systemMode = useColorScheme()
  useEffect(() => {
    let active = true
    const key = appRole === 'coach' ? 'fp.mobile.local.v1.coach.theme' : 'fp.parent.display-theme.v1'
    AsyncStorage.getItem(key).then(value => { if (active) setPreference(normalizeDeviceThemeMode(value)) }).catch(() => {})
    return () => { active = false }
  }, [appRole])
  return resolveDeviceThemeMode(preference, systemMode)
}
