import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Application from 'expo-application'
import * as Crypto from 'expo-crypto'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { fetchJsonWithTimeout, joinApiPath } from '../../mobile-core/src/http'
import {
  getParentPushSetupFailureCode,
  getParentNotificationStorageKeys,
  mergeParentNotificationPermission,
  normalizeParentNotificationDetail,
  normalizeParentNotificationState,
  withParentPushStepTimeout,
} from '../../mobile-core/src/parentNotificationsCore'
import { getAccessToken } from '../../mobile-core/src/supabase'

const PRODUCTION_API_ORIGIN = 'https://footballplayer.online'
const INSTALLATION_KEY_PREFIX = 'football-player.parent.push-installation-id.v2'
const CHANNEL_ID = 'parent-updates'
const PUSH_TOKEN_ATTEMPTS = 2
const PUSH_TOKEN_RETRY_DELAY_MS = 750
const PERMISSION_PROMPT_TIMEOUT_MS = 20000
const PUSH_NATIVE_STEP_TIMEOUT_MS = 12000

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

function isProductionApi(apiBaseUrl) {
  try {
    return new URL(normalize(apiBaseUrl)).origin === PRODUCTION_API_ORIGIN
  } catch {
    return false
  }
}

function getStorageKeys(apiBaseUrl) {
  return {
    ...getParentNotificationStorageKeys(isProductionApi(apiBaseUrl) ? 'production' : 'test'),
    installationId: getEnvironmentStorageKey(INSTALLATION_KEY_PREFIX, apiBaseUrl),
  }
}

function getEnvironmentStorageKey(prefix, apiBaseUrl) {
  return `${prefix}.${isProductionApi(apiBaseUrl) ? 'production' : 'test'}`
}

export async function clearIncompatibleParentNotificationState(apiBaseUrl) {
  const incompatibleEnvironment = isProductionApi(apiBaseUrl) ? 'test' : 'production'
  const keys = getParentNotificationStorageKeys(incompatibleEnvironment)
  await Promise.all([
    SecureStore.deleteItemAsync(keys.installationId),
    AsyncStorage.removeItem(keys.detailLevel),
  ])
  return { previousEnvironment: incompatibleEnvironment, quarantined: true }
}

function getInstallationPath(apiBaseUrl) {
  return isProductionApi(apiBaseUrl)
    ? '/.netlify/functions/parent-mobile-push-installation'
    : '/api/mobile-test/parent-push-installation'
}

function createSafePushSetupError(error, stage) {
  const code = getParentPushSetupFailureCode(error, stage)
  const safeError = new Error(code.toLowerCase())
  safeError.code = code
  return safeError
}

function waitForPushRetry() {
  return new Promise((resolve) => setTimeout(resolve, PUSH_TOKEN_RETRY_DELAY_MS))
}

async function getParentExpoPushToken(easProjectId, suppliedDevicePushToken) {
  let devicePushToken = suppliedDevicePushToken

  if (!devicePushToken && Platform.OS === 'android') {
    try {
      devicePushToken = await withParentPushStepTimeout(
        () => Notifications.getDevicePushTokenAsync(),
        { stage: 'device', timeoutMs: PUSH_NATIVE_STEP_TIMEOUT_MS },
      )
    } catch (error) {
      throw createSafePushSetupError(error, 'device')
    }
  }

  let lastError

  for (let attempt = 1; attempt <= PUSH_TOKEN_ATTEMPTS; attempt += 1) {
    try {
      return await withParentPushStepTimeout(
        () => Notifications.getExpoPushTokenAsync({
          ...(devicePushToken ? { devicePushToken } : {}),
          ...(easProjectId ? { projectId: easProjectId } : {}),
        }),
        { stage: 'expo', timeoutMs: PUSH_NATIVE_STEP_TIMEOUT_MS },
      )
    } catch (error) {
      lastError = error
      const safeCode = getParentPushSetupFailureCode(error, 'expo')
      const shouldRetry = safeCode.endsWith('_NETWORK')
        && !normalize(error?.message).toLowerCase().includes('timed out')
        && attempt < PUSH_TOKEN_ATTEMPTS
      if (!shouldRetry) break
      await waitForPushRetry()
    }
  }

  throw createSafePushSetupError(lastError, 'expo')
}

async function getInstallationId(apiBaseUrl) {
  const storageKey = getStorageKeys(apiBaseUrl).installationId
  const current = normalize(await SecureStore.getItemAsync(storageKey))
  if (current) return current

  const installationId = Crypto.randomUUID()
  await SecureStore.setItemAsync(storageKey, installationId, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  })
  return installationId
}

async function rotateInstallationId(apiBaseUrl) {
  const installationId = Crypto.randomUUID()
  await SecureStore.setItemAsync(getStorageKeys(apiBaseUrl).installationId, installationId, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  })
  return installationId
}

async function getLocalDetailLevel(apiBaseUrl) {
  return normalizeParentNotificationDetail(await AsyncStorage.getItem(getStorageKeys(apiBaseUrl).detailLevel))
}

async function setLocalDetailLevel(value, apiBaseUrl) {
  const detailLevel = normalizeParentNotificationDetail(value)
  await AsyncStorage.setItem(getStorageKeys(apiBaseUrl).detailLevel, detailLevel)
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

  const permission = await withParentPushStepTimeout(
    () => Notifications.getPermissionsAsync(),
    { stage: 'permission', timeoutMs: PUSH_NATIVE_STEP_TIMEOUT_MS },
  )
  return {
    canAskAgain: permission.canAskAgain !== false,
    permissionGranted: isPermissionGranted(permission),
    permissionStatus: normalize(permission.status).toLowerCase() || 'undetermined',
  }
}

function isPermissionGranted(permission) {
  if (permission?.granted) return true
  if (Platform.OS !== 'ios') return false
  return [
    Notifications.IosAuthorizationStatus.AUTHORIZED,
    Notifications.IosAuthorizationStatus.PROVISIONAL,
    Notifications.IosAuthorizationStatus.EPHEMERAL,
  ].includes(permission?.ios?.status)
}

async function request({ apiBaseUrl, body, method, path }) {
  const accessToken = await getAccessToken()
  if (!accessToken) throw new Error('Sign in before changing notifications.')
  if (!apiBaseUrl) throw new Error('Notifications are not ready for this build.')

  const { ok, response, result } = await fetchJsonWithTimeout(joinApiPath(apiBaseUrl, path), {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  if (!ok || result.success === false) {
    const error = new Error(result.message || result.error || 'Notification settings could not be updated.')
    error.code = normalize(result.code || result.error || `PARENT_MOBILE_HTTP_${response.status}`)
    error.status = response.status
    throw error
  }

  return result
}

export async function initializeParentNotifications() {
  await Notifications.setNotificationCategoryAsync('parent-response', [
    { buttonTitle: 'Accept', identifier: 'parent_accept', options: { opensAppToForeground: true } },
    { buttonTitle: 'Decline', identifier: 'parent_decline', options: { isDestructive: true, opensAppToForeground: true } },
  ])
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
  return Notifications.addPushTokenListener((devicePushToken) => {
    listener(devicePushToken)
  })
}

export async function loadParentNotificationState({ apiBaseUrl }) {
  const [detailLevel, installationId, permission] = await Promise.all([
    getLocalDetailLevel(apiBaseUrl),
    getInstallationId(apiBaseUrl),
    getPermissionState(),
  ])
  let serverState = { detailLevel, enabled: false, registered: false }

  try {
    const result = await request({
      apiBaseUrl,
      method: 'GET',
      path: `${getInstallationPath(apiBaseUrl)}?installationId=${encodeURIComponent(installationId)}`,
    })
    serverState = result.installation || serverState
  } catch (error) {
    if (!normalize(error.message).toLowerCase().includes('sign in')) throw error
  }

  return mergeParentNotificationPermission(serverState, permission, detailLevel)
}

export async function enableParentNotifications({ apiBaseUrl, devicePushToken, easProjectId, parentLinkId }) {
  if (!Device.isDevice) {
    throw createSafePushSetupError({ message: 'device unavailable' }, 'device')
  }

  let permission
  try {
    const currentPermission = await withParentPushStepTimeout(
      () => Notifications.getPermissionsAsync(),
      { stage: 'permission', timeoutMs: PUSH_NATIVE_STEP_TIMEOUT_MS },
    )
    permission = isPermissionGranted(currentPermission)
      ? currentPermission
      : await withParentPushStepTimeout(
          () => Notifications.requestPermissionsAsync({
            ios: {
              allowAlert: true,
              allowBadge: true,
              allowSound: true,
            },
          }),
          { stage: 'permission', timeoutMs: PERMISSION_PROMPT_TIMEOUT_MS },
        )
  } catch (error) {
    throw createSafePushSetupError(error, 'permission')
  }
  const permissionGranted = isPermissionGranted(permission)

  if (!permissionGranted) {
    const installationId = await getInstallationId(apiBaseUrl)
    await request({
      apiBaseUrl,
      method: 'PATCH',
      path: getInstallationPath(apiBaseUrl),
      body: {
        detailLevel: await getLocalDetailLevel(apiBaseUrl),
        enabled: false,
        installationId,
      },
    }).catch(() => {})
    return normalizeParentNotificationState({
      canAskAgain: permission.canAskAgain !== false,
      detailLevel: await getLocalDetailLevel(apiBaseUrl),
      enabled: false,
      message: 'Notification permission is off. The app remains fully usable.',
      permissionGranted: false,
      permissionStatus: normalize(permission.status).toLowerCase() || 'denied',
      registered: false,
    })
  }

  const tokenResult = await getParentExpoPushToken(easProjectId, devicePushToken)
  const expoPushToken = normalize(tokenResult.data)
  if (!expoPushToken) {
    throw createSafePushSetupError({ message: 'token unavailable' }, 'expo')
  }

  let installationId
  let detailLevel
  try {
    installationId = await getInstallationId(apiBaseUrl)
    detailLevel = await getLocalDetailLevel(apiBaseUrl)
  } catch (error) {
    throw createSafePushSetupError(error, 'local')
  }

  const register = (targetInstallationId) => request({
    apiBaseUrl,
    method: 'POST',
    path: getInstallationPath(apiBaseUrl),
    body: {
      appVersion: Application.nativeApplicationVersion || '',
      buildNumber: Application.nativeBuildVersion || '',
      detailLevel,
      expoPushToken,
      installationId: targetInstallationId,
      parentLinkId,
      platform: Platform.OS,
    },
  })

  let result
  try {
    result = await register(installationId)
  } catch (error) {
    if (normalize(error?.code).toUpperCase() === 'PARENT_MOBILE_INSTALLATION_OWNED') {
      try {
        installationId = await rotateInstallationId(apiBaseUrl)
        result = await register(installationId)
      } catch (retryError) {
        throw createSafePushSetupError(retryError, 'api')
      }
    } else {
      throw createSafePushSetupError(error, 'api')
    }
  }

  return normalizeParentNotificationState({
    ...(result.installation || {}),
    canAskAgain: permission.canAskAgain !== false,
    permissionGranted: true,
    permissionStatus: normalize(permission.status).toLowerCase() || 'granted',
  })
}

export async function updateParentNotificationPreference({ apiBaseUrl, detailLevel, enabled }) {
  const normalizedDetail = await setLocalDetailLevel(detailLevel, apiBaseUrl)
  const installationId = await getInstallationId(apiBaseUrl)
  const permission = await getPermissionState()
  let serverState = { detailLevel: normalizedDetail, enabled: false, registered: false }

  try {
    const result = await request({
      apiBaseUrl,
      method: 'PATCH',
      path: getInstallationPath(apiBaseUrl),
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

  return mergeParentNotificationPermission(serverState, permission, normalizedDetail)
}

export async function unbindParentNotifications({ accessToken, apiBaseUrl }) {
  const installationId = await getInstallationId(apiBaseUrl)
  let serverUnbound = false

  if (accessToken && apiBaseUrl) {
    try {
      const { ok, result } = await fetchJsonWithTimeout(joinApiPath(apiBaseUrl, getInstallationPath(apiBaseUrl)), {
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
  await Notifications.setBadgeCountAsync(0).catch(() => {})

  return { serverUnbound, success: true }
}

export async function sendParentTestNotification({ apiBaseUrl, intentType }) {
  if (isProductionApi(apiBaseUrl)) throw new Error('Test notifications are unavailable in production builds.')
  const installationId = await getInstallationId(apiBaseUrl)
  return request({
    apiBaseUrl,
    method: 'POST',
    path: '/api/mobile-test/parent-push-test',
    body: { installationId, intentType },
  })
}
