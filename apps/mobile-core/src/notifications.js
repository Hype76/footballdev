import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { fetchJsonWithTimeout, joinApiPath } from './http'

const MOBILE_PUSH_TOKEN_KEY = 'football-player:mobile-push-token'
const MOBILE_PUSH_CONTEXT_KEY = 'football-player:mobile-push-context'
const MATCHDAY_CHANNEL_ID = 'matchday'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

function normalize(value) {
  return String(value ?? '').trim()
}

export async function initializeMobileNotifications() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(MATCHDAY_CHANNEL_ID, {
      description: 'Matchday, message, and poll alerts.',
      importance: Notifications.AndroidImportance.MAX,
      lightColor: '#d7ff2f',
      name: 'Matchday alerts',
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    })
  }

  await Notifications.setBadgeCountAsync(0).catch(() => {})
}

async function getStoredDeviceToken() {
  return normalize(await AsyncStorage.getItem(MOBILE_PUSH_TOKEN_KEY))
}

async function setStoredDeviceToken(deviceToken) {
  const normalizedToken = normalize(deviceToken)

  if (!normalizedToken) {
    await AsyncStorage.removeItem(MOBILE_PUSH_TOKEN_KEY)
    await AsyncStorage.removeItem(MOBILE_PUSH_CONTEXT_KEY)
    return ''
  }

  await AsyncStorage.setItem(MOBILE_PUSH_TOKEN_KEY, normalizedToken)
  return normalizedToken
}

async function getStoredDeviceContext() {
  const rawValue = await AsyncStorage.getItem(MOBILE_PUSH_CONTEXT_KEY)

  if (!rawValue) {
    return null
  }

  try {
    const parsedValue = JSON.parse(rawValue)

    return parsedValue && typeof parsedValue === 'object' ? parsedValue : null
  } catch {
    return null
  }
}

async function setStoredDeviceContext({ appRole, parentLinkId = '', teamId = '' }) {
  const context = {
    appRole: normalize(appRole),
    parentLinkId: normalize(parentLinkId),
    teamId: normalize(teamId),
  }

  await AsyncStorage.setItem(MOBILE_PUSH_CONTEXT_KEY, JSON.stringify(context))
  return context
}

function isSameDeviceContext(currentContext, expectedContext) {
  if (!currentContext) {
    return false
  }

  return normalize(currentContext.appRole) === normalize(expectedContext.appRole)
    && normalize(currentContext.parentLinkId) === normalize(expectedContext.parentLinkId)
    && normalize(currentContext.teamId) === normalize(expectedContext.teamId)
}

export async function getNativeNotificationPermissionState() {
  if (!Device.isDevice) {
    return {
      canAsk: false,
      granted: false,
      message: 'Push notifications need a real iOS or Android device.',
    }
  }

  const permission = await Notifications.getPermissionsAsync()

  return {
    canAsk: permission.canAskAgain,
    granted: permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL,
    message: permission.granted ? 'Notifications are enabled.' : 'Notifications are not enabled yet.',
    status: permission.status,
  }
}

export async function getNativeNotificationDeviceState({ appRole = '', parentLinkId = '', teamId = '' } = {}) {
  const permission = await getNativeNotificationPermissionState()
  const deviceToken = await getStoredDeviceToken()
  const deviceContext = await getStoredDeviceContext()
  const expectedContext = {
    appRole,
    parentLinkId,
    teamId,
  }
  const hasContext = Boolean(normalize(appRole) || normalize(parentLinkId) || normalize(teamId))
  const contextMatches = hasContext ? isSameDeviceContext(deviceContext, expectedContext) : true
  const requiresContextRefresh = Boolean(deviceToken && hasContext && !contextMatches)

  return {
    ...permission,
    context: deviceContext,
    deviceToken,
    isRegistered: Boolean(deviceToken && contextMatches),
    message: requiresContextRefresh
      ? 'Refresh notifications for the selected context.'
      : permission.message,
    requiresContextRefresh,
  }
}

export async function registerNativePushDevice({
  accessToken,
  apiBaseUrl,
  appRole,
  easProjectId,
  parentLinkId = '',
  teamId = '',
}) {
  if (!Device.isDevice) {
    throw new Error('Use a real device to register push notifications.')
  }

  if (!accessToken) {
    throw new Error('Login is required before enabling notifications.')
  }

  if (!apiBaseUrl) {
    throw new Error('Notifications are not ready for this build.')
  }

  const existingPermission = await Notifications.getPermissionsAsync()
  const finalPermission = existingPermission.granted ? existingPermission : await Notifications.requestPermissionsAsync()

  if (!finalPermission.granted) {
    throw new Error('Notification permission was not granted.')
  }

  const tokenResult = await Notifications.getExpoPushTokenAsync(
    easProjectId ? { projectId: easProjectId } : undefined,
  )
  const deviceToken = normalize(tokenResult.data)

  if (!deviceToken) {
    throw new Error('Notifications could not be prepared on this device.')
  }

  const { ok, result } = await fetchJsonWithTimeout(joinApiPath(apiBaseUrl, '.netlify/functions/register-mobile-push-device'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      appRole,
      channelId: MATCHDAY_CHANNEL_ID,
      deviceName: Device.deviceName || '',
      deviceToken,
      parentLinkId,
      platform: Platform.OS,
      teamId,
    }),
  })

  if (!ok || result.success === false) {
    throw new Error(result.message || 'Notifications could not be enabled.')
  }

  await setStoredDeviceToken(deviceToken)
  await setStoredDeviceContext({
    appRole,
    parentLinkId,
    teamId,
  })

  return {
    deviceToken,
    success: true,
  }
}

export async function revokeNativePushDevice({ accessToken, apiBaseUrl }) {
  if (!accessToken) {
    throw new Error('Login is required before changing notifications.')
  }

  if (!apiBaseUrl) {
    throw new Error('Notifications are not ready for this build.')
  }

  const deviceToken = await getStoredDeviceToken()

  if (!deviceToken) {
    return {
      skipped: true,
      success: true,
    }
  }

  const { ok, result } = await fetchJsonWithTimeout(joinApiPath(apiBaseUrl, '.netlify/functions/register-mobile-push-device'), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ deviceToken }),
  })

  if (!ok || result.success === false) {
    throw new Error(result.message || 'Notifications could not be disabled.')
  }

  await setStoredDeviceToken('')

  return {
    success: true,
  }
}
