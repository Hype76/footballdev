import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Application from 'expo-application'
import * as Crypto from 'expo-crypto'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { fetchJsonWithTimeout, joinApiPath } from '../../mobile-core/src/http'
import {
  normalizeParentNotificationDetail,
  normalizeParentNotificationState,
} from '../../mobile-core/src/parentNotificationsCore'
import { getAccessToken } from '../../mobile-core/src/supabase'

const INSTALLATION_KEY = 'football-player:parent:test:push-installation-id:v1'
const DETAIL_KEY = 'football-player:parent:test:push-detail:v1'
const CHANNEL_ID = 'parent-updates'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

function normalize(value) {
  return String(value ?? '').trim()
}

async function getInstallationId() {
  const current = normalize(await SecureStore.getItemAsync(INSTALLATION_KEY))
  if (current) return current

  const installationId = Crypto.randomUUID()
  await SecureStore.setItemAsync(INSTALLATION_KEY, installationId, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  })
  return installationId
}

async function getLocalDetailLevel() {
  return normalizeParentNotificationDetail(await AsyncStorage.getItem(DETAIL_KEY))
}

async function setLocalDetailLevel(value) {
  const detailLevel = normalizeParentNotificationDetail(value)
  await AsyncStorage.setItem(DETAIL_KEY, detailLevel)
  return detailLevel
}

async function getPermissionState() {
  if (!Device.isDevice) {
    return {
      canAskAgain: false,
      permissionGranted: false,
      permissionStatus: 'unavailable',
    }
  }

  const permission = await Notifications.getPermissionsAsync()
  return {
    canAskAgain: permission.canAskAgain !== false,
    permissionGranted: permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL,
    permissionStatus: normalize(permission.status).toLowerCase() || 'undetermined',
  }
}

async function request({ apiBaseUrl, body, method, path }) {
  const accessToken = await getAccessToken()
  if (!accessToken) throw new Error('Sign in before changing notifications.')
  if (!apiBaseUrl) throw new Error('Notifications are not ready for this build.')

  const { ok, result } = await fetchJsonWithTimeout(joinApiPath(apiBaseUrl, path), {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (!ok || result.success === false) {
    throw new Error(result.error || 'Notification settings could not be updated.')
  }

  return result
}

export async function initializeParentNotifications() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      description: 'Parent messages, polls, and Matchday updates.',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#d7ff2f',
      name: 'Parent updates',
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    })
  }
}

export function addParentPushTokenListener(listener) {
  return Notifications.addPushTokenListener(() => {
    listener()
  })
}

export async function loadParentNotificationState({ apiBaseUrl }) {
  const [detailLevel, installationId, permission] = await Promise.all([
    getLocalDetailLevel(),
    getInstallationId(),
    getPermissionState(),
  ])
  let serverState = { detailLevel, enabled: false, registered: false }

  try {
    const result = await request({
      apiBaseUrl,
      method: 'GET',
      path: `/api/mobile-test/parent-push-installation?installationId=${encodeURIComponent(installationId)}`,
    })
    serverState = result.installation || serverState
  } catch (error) {
    if (!normalize(error.message).toLowerCase().includes('sign in')) throw error
  }

  if (!permission.permissionGranted && serverState.enabled) {
    try {
      const result = await request({
        apiBaseUrl,
        method: 'PATCH',
        path: '/api/mobile-test/parent-push-installation',
        body: {
          detailLevel: serverState.detailLevel || detailLevel,
          enabled: false,
          installationId,
        },
      })
      serverState = result.installation || { ...serverState, enabled: false }
    } catch {
      serverState = { ...serverState, enabled: false }
    }
  }

  return normalizeParentNotificationState({
    ...serverState,
    ...permission,
    detailLevel: serverState.detailLevel || detailLevel,
    enabled: Boolean(serverState.enabled && permission.permissionGranted),
  })
}

export async function enableParentNotifications({ apiBaseUrl, easProjectId, parentLinkId }) {
  if (!Device.isDevice) throw new Error('Use a real device to enable notifications.')

  const currentPermission = await Notifications.getPermissionsAsync()
  const permission = currentPermission.granted
    ? currentPermission
    : await Notifications.requestPermissionsAsync()
  const permissionGranted = permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL

  if (!permissionGranted) {
    const installationId = await getInstallationId()
    await request({
      apiBaseUrl,
      method: 'PATCH',
      path: '/api/mobile-test/parent-push-installation',
      body: {
        detailLevel: await getLocalDetailLevel(),
        enabled: false,
        installationId,
      },
    }).catch(() => {})
    return normalizeParentNotificationState({
      canAskAgain: permission.canAskAgain !== false,
      detailLevel: await getLocalDetailLevel(),
      enabled: false,
      message: 'Notification permission is off. The app remains fully usable.',
      permissionGranted: false,
      permissionStatus: normalize(permission.status).toLowerCase() || 'denied',
      registered: false,
    })
  }

  const tokenResult = await Notifications.getExpoPushTokenAsync(
    easProjectId ? { projectId: easProjectId } : undefined,
  )
  const expoPushToken = normalize(tokenResult.data)
  if (!expoPushToken) throw new Error('A notification token could not be created on this device.')

  const installationId = await getInstallationId()
  const detailLevel = await getLocalDetailLevel()
  const result = await request({
    apiBaseUrl,
    method: 'POST',
    path: '/api/mobile-test/parent-push-installation',
    body: {
      appVersion: Application.nativeApplicationVersion || '',
      buildNumber: Application.nativeBuildVersion || '',
      detailLevel,
      expoPushToken,
      installationId,
      parentLinkId,
      platform: Platform.OS,
    },
  })

  return normalizeParentNotificationState({
    ...(result.installation || {}),
    canAskAgain: permission.canAskAgain !== false,
    permissionGranted: true,
    permissionStatus: normalize(permission.status).toLowerCase() || 'granted',
  })
}

export async function updateParentNotificationPreference({ apiBaseUrl, detailLevel, enabled }) {
  const normalizedDetail = await setLocalDetailLevel(detailLevel)
  const installationId = await getInstallationId()
  const permission = await getPermissionState()
  let serverState = { detailLevel: normalizedDetail, enabled: false, registered: false }

  try {
    const result = await request({
      apiBaseUrl,
      method: 'PATCH',
      path: '/api/mobile-test/parent-push-installation',
      body: {
        detailLevel: normalizedDetail,
        enabled: Boolean(enabled),
        installationId,
      },
    })
    serverState = result.installation || serverState
  } catch (error) {
    if (enabled) throw error
  }

  return normalizeParentNotificationState({
    ...serverState,
    ...permission,
    detailLevel: normalizedDetail,
    enabled: Boolean(serverState.enabled && permission.permissionGranted),
  })
}

export async function unbindParentNotifications({ accessToken, apiBaseUrl }) {
  const installationId = await getInstallationId()
  let serverUnbound = false

  if (accessToken && apiBaseUrl) {
    try {
      const { ok, result } = await fetchJsonWithTimeout(joinApiPath(apiBaseUrl, '/api/mobile-test/parent-push-installation'), {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ installationId }),
      })
      serverUnbound = Boolean(ok && result.success !== false)
    } catch {
      serverUnbound = false
    }
  }

  await Notifications.unregisterForNotificationsAsync()

  return { serverUnbound, success: true }
}

export async function sendParentTestNotification({ apiBaseUrl, intentType }) {
  const installationId = await getInstallationId()
  return request({
    apiBaseUrl,
    method: 'POST',
    path: '/api/mobile-test/parent-push-test',
    body: { installationId, intentType },
  })
}
