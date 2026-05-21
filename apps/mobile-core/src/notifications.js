import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

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

export async function getNativeNotificationPermissionState() {
  if (!Device.isDevice) {
    return {
      canAsk: false,
      granted: false,
      message: 'Native push notifications need a real iOS or Android device.',
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
    throw new Error('The mobile API base URL is not configured.')
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
    throw new Error('Expo push token could not be created.')
  }

  const response = await fetch(`${apiBaseUrl}/.netlify/functions/register-mobile-push-device`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      appRole,
      deviceName: Device.deviceName || '',
      deviceToken,
      parentLinkId,
      platform: Platform.OS,
      teamId,
    }),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok || result.success === false) {
    throw new Error(result.message || 'Mobile notifications could not be enabled.')
  }

  return {
    deviceToken,
    success: true,
  }
}
