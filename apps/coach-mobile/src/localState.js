import AsyncStorage from '@react-native-async-storage/async-storage'
import { createCoachContextMarker, parseCoachContextMarker } from '../../mobile-core/src/coachContextCore'
import { clearNativeNotificationLocalState } from '../../mobile-core/src/notifications'
import { getCoachLocalStateKeys } from './coachLocalStateCore'
import { clearCoachOfflineState } from './offline'
import { createCoachThemePreference } from './coachThemePreferenceCore'

const themePreference = createCoachThemePreference({
  read: () => AsyncStorage.getItem(getCoachLocalStateKeys().theme),
  write: value => AsyncStorage.setItem(getCoachLocalStateKeys().theme, value),
})

export const peekCoachThemeMode = themePreference.peek

export async function readCoachThemeMode() {
  return themePreference.read()
}

export async function writeCoachThemeMode(mode) {
  return themePreference.write(mode)
}

export async function readCoachContextMarker(userId) {
  const value = await AsyncStorage.getItem(getCoachLocalStateKeys(userId).context)
  return parseCoachContextMarker(value)
}

export async function writeCoachContextMarker(userId, context) {
  const marker = createCoachContextMarker(context)
  await AsyncStorage.setItem(getCoachLocalStateKeys(userId).context, JSON.stringify(marker))
  return marker
}

export async function clearCoachUserLocalState(userId) {
  const keys = getCoachLocalStateKeys(userId)
  await AsyncStorage.multiRemove([keys.context, keys.deepLink, keys.offline, keys.notification])
}

export async function clearCoachAllLocalState(userId = '') {
  themePreference.reset()
  if (String(userId || '').trim()) {
    const keys = getCoachLocalStateKeys(userId)
    await Promise.all([
      AsyncStorage.multiRemove(Object.values(keys)),
      clearNativeNotificationLocalState('coach'),
      clearCoachOfflineState(),
    ])
    return
  }
  const keys = await AsyncStorage.getAllKeys()
  await Promise.all([
    AsyncStorage.multiRemove(keys.filter((key) => key.startsWith('fp.mobile.local.v1.coach.'))),
    clearNativeNotificationLocalState('coach'),
    clearCoachOfflineState(),
  ])
}
