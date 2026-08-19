import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import {
  getMobileAppBadgeCount,
  getMobileAppBadgeStorageKey,
  normalizeMobileAppBadgeEnabled,
} from './appBadgeCore'

export async function readMobileAppBadgeEnabled(appRole) {
  const stored = await AsyncStorage.getItem(getMobileAppBadgeStorageKey(appRole))
  return normalizeMobileAppBadgeEnabled(stored)
}

export async function writeMobileAppBadgeEnabled(appRole, enabled) {
  const nextEnabled = normalizeMobileAppBadgeEnabled(enabled)
  await AsyncStorage.setItem(
    getMobileAppBadgeStorageKey(appRole),
    nextEnabled ? 'enabled' : 'disabled',
  )
  if (!nextEnabled) await Notifications.setBadgeCountAsync(0).catch(() => {})
  return nextEnabled
}

export async function syncMobileAppBadge({ appRole, count = 0 } = {}) {
  const enabled = await readMobileAppBadgeEnabled(appRole)
  const badgeCount = getMobileAppBadgeCount({ count, enabled })
  await Notifications.setBadgeCountAsync(badgeCount).catch(() => {})
  return { count: badgeCount, enabled }
}
