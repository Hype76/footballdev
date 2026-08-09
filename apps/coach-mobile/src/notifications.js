import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import * as Crypto from 'expo-crypto'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import {
  getCoachNotificationStorageKeys,
  getCoachPushSetupFailureCode,
  normalizeCoachNotificationLevel,
  normalizeCoachNotificationState,
} from '../../mobile-core/src/coachNotificationsCore'
import { fetchJsonWithTimeout, joinApiPath } from '../../mobile-core/src/http'
import { getAccessToken } from '../../mobile-core/src/supabase'

const TEST_API_ORIGIN = 'https://footballplayer-mobile-test-api.netlify.app'
const PRODUCTION_API_ORIGIN = 'https://footballplayer.online'
const TEST_INSTALLATION_PATH = '/api/mobile-test/coach-push-installation'
const PRODUCTION_INSTALLATION_PATH = '/api/mobile/coach-push-installation'
const CHANNEL_ID = 'coach-updates'
const TOKEN_ATTEMPTS = 2
const TOKEN_RETRY_MS = 750

const normalize = (value) => String(value ?? '').trim()

function getNotificationEnvironment(apiBaseUrl) {
  let origin = ''
  try { origin = new URL(normalize(apiBaseUrl)).origin } catch { origin = '' }
  if (origin === TEST_API_ORIGIN) return 'test'
  if (origin === PRODUCTION_API_ORIGIN) return 'production'
  throw new Error('coach_notification_environment_boundary_required')
}

function getInstallationPath(apiBaseUrl) {
  return getNotificationEnvironment(apiBaseUrl) === 'production'
    ? PRODUCTION_INSTALLATION_PATH
    : TEST_INSTALLATION_PATH
}

function getStorageKeys(apiBaseUrl) {
  return getCoachNotificationStorageKeys(getNotificationEnvironment(apiBaseUrl))
}

export async function clearIncompatibleCoachNotificationState(apiBaseUrl) {
  const currentEnvironment = getNotificationEnvironment(apiBaseUrl)
  const previousEnvironment = currentEnvironment === 'production' ? 'test' : 'production'
  const keys = getCoachNotificationStorageKeys(previousEnvironment)
  await Promise.all([
    SecureStore.deleteItemAsync(keys.installationId),
    AsyncStorage.removeItem(keys.detailLevel),
  ])
  return { previousEnvironment, quarantined: true }
}

function safeError(error, stage) {
  const next = new Error(getCoachPushSetupFailureCode(error, stage).toLowerCase())
  next.code = getCoachPushSetupFailureCode(error, stage)
  return next
}

async function getInstallationId(apiBaseUrl) {
  const key = getStorageKeys(apiBaseUrl).installationId
  const current = normalize(await SecureStore.getItemAsync(key))
  if (current) return current
  const installationId = Crypto.randomUUID()
  await SecureStore.setItemAsync(key, installationId, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  })
  return installationId
}

async function getDetailLevel(apiBaseUrl) {
  return normalizeCoachNotificationLevel(await AsyncStorage.getItem(getStorageKeys(apiBaseUrl).detailLevel))
}

async function setDetailLevel(value, apiBaseUrl) {
  const detailLevel = normalizeCoachNotificationLevel(value)
  await AsyncStorage.setItem(getStorageKeys(apiBaseUrl).detailLevel, detailLevel)
  return detailLevel
}

async function getPermissionState() {
  if (!Device.isDevice) return { canAskAgain: false, permissionGranted: false, permissionStatus: 'unavailable' }
  const permission = await Notifications.getPermissionsAsync()
  return {
    canAskAgain: permission.canAskAgain !== false,
    permissionGranted: permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL,
    permissionStatus: normalize(permission.status).toLowerCase() || 'undetermined',
  }
}

async function request({ apiBaseUrl, body, method, path = getInstallationPath(apiBaseUrl) }) {
  getNotificationEnvironment(apiBaseUrl)
  const accessToken = await getAccessToken()
  if (!accessToken) throw Object.assign(new Error('sign_in_required'), { status: 401 })
  const { ok, response, result } = await fetchJsonWithTimeout(joinApiPath(apiBaseUrl, path), {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!ok || result.success === false) {
    throw Object.assign(new Error(normalize(result.error || result.message) || 'coach_notification_request_failed'), { status: response.status })
  }
  return result
}

async function getExpoPushToken(easProjectId) {
  let nativeToken
  try { nativeToken = await Notifications.getDevicePushTokenAsync() } catch (error) { throw safeError(error, 'device') }
  let lastError
  for (let attempt = 1; attempt <= TOKEN_ATTEMPTS; attempt += 1) {
    try {
      return await Notifications.getExpoPushTokenAsync({ devicePushToken: nativeToken, ...(easProjectId ? { projectId: easProjectId } : {}) })
    } catch (error) {
      lastError = error
      if (!getCoachPushSetupFailureCode(error, 'expo').endsWith('_NETWORK') || attempt === TOKEN_ATTEMPTS) break
      await new Promise((resolve) => setTimeout(resolve, TOKEN_RETRY_MS))
    }
  }
  throw safeError(lastError, 'expo')
}

export async function initializeCoachNotifications() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      description: 'Privacy-safe staff operational alerts.',
      importance: Notifications.AndroidImportance.HIGH,
      name: 'Coach updates',
      sound: 'default',
    })
  }
}

export function addCoachPushTokenListener(listener) {
  return Notifications.addPushTokenListener(() => listener())
}

export async function loadCoachNotificationState({ apiBaseUrl, contextId }) {
  const installationPath = getInstallationPath(apiBaseUrl)
  const [detailLevel, installationId, permission] = await Promise.all([getDetailLevel(apiBaseUrl), getInstallationId(apiBaseUrl), getPermissionState()])
  let server = { contextId: '', detailLevel, enabled: false, registered: false }
  try {
    const result = await request({ apiBaseUrl, method: 'GET', path: `${installationPath}?installationId=${encodeURIComponent(installationId)}` })
    server = result.installation || server
  } catch (error) {
    if (error.status !== 401) throw safeError(error, 'api')
  }
  const requiresContextRefresh = Boolean(server.registered && normalize(server.contextId) !== normalize(contextId))
  return normalizeCoachNotificationState({
    ...server,
    ...permission,
    detailLevel: server.detailLevel || detailLevel,
    enabled: Boolean(server.enabled && permission.permissionGranted && !requiresContextRefresh),
    message: requiresContextRefresh ? 'Refresh notifications for this staff context.' : '',
    requiresContextRefresh,
  })
}

export async function enableCoachNotifications({ apiBaseUrl, contextId, easProjectId }) {
  getNotificationEnvironment(apiBaseUrl)
  if (!Device.isDevice) throw safeError({ message: 'device unavailable' }, 'device')
  let permission
  try {
    const current = await Notifications.getPermissionsAsync()
    permission = current.granted ? current : await Notifications.requestPermissionsAsync()
  } catch (error) { throw safeError(error, 'permission') }
  const granted = permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  if (!granted) return normalizeCoachNotificationState({ canAskAgain: permission.canAskAgain !== false, detailLevel: await getDetailLevel(apiBaseUrl), message: 'Notification permission is off. The Coach app remains fully usable.', permissionGranted: false, permissionStatus: normalize(permission.status).toLowerCase() || 'denied' })
  const token = normalize((await getExpoPushToken(easProjectId)).data)
  if (!token) throw safeError({ message: 'token unavailable' }, 'expo')
  const [detailLevel, installationId] = await Promise.all([getDetailLevel(apiBaseUrl), getInstallationId(apiBaseUrl)])
  let result
  try {
    result = await request({
      apiBaseUrl,
      method: 'POST',
      body: {
        appVersion: normalize(Constants.expoConfig?.version).slice(0, 40),
        buildNumber: normalize(Constants.expoConfig?.ios?.buildNumber || Constants.expoConfig?.android?.versionCode).slice(0, 40),
        contextId,
        detailLevel,
        expoPushToken: token,
        installationId,
        platform: Platform.OS,
      },
    })
  } catch (error) { throw safeError(error, 'api') }
  return normalizeCoachNotificationState({ ...(result.installation || {}), canAskAgain: permission.canAskAgain !== false, permissionGranted: true, permissionStatus: normalize(permission.status).toLowerCase() || 'granted' })
}

export async function updateCoachNotificationPreference({ apiBaseUrl, contextId, detailLevel }) {
  const normalizedLevel = await setDetailLevel(detailLevel, apiBaseUrl)
  const installationId = await getInstallationId(apiBaseUrl)
  const permission = await getPermissionState()
  let server = { contextId, detailLevel: normalizedLevel, enabled: false, registered: false }
  try {
    const result = await request({ apiBaseUrl, method: 'PATCH', body: { contextId, detailLevel: normalizedLevel, enabled: normalizedLevel !== 'off', installationId } })
    server = result.installation || server
  } catch (error) {
    if (normalizedLevel !== 'off') throw safeError(error, 'api')
  }
  return normalizeCoachNotificationState({ ...server, ...permission, detailLevel: normalizedLevel })
}

export async function unbindCoachNotifications({ accessToken, apiBaseUrl }) {
  const installationPath = getInstallationPath(apiBaseUrl)
  const installationId = await getInstallationId(apiBaseUrl)
  let serverUnbound = false
  if (accessToken && apiBaseUrl) {
    try {
      const { ok, result } = await fetchJsonWithTimeout(joinApiPath(apiBaseUrl, installationPath), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ installationId }),
      })
      serverUnbound = Boolean(ok && result.success !== false)
    } catch { serverUnbound = false }
  }
  await Notifications.unregisterForNotificationsAsync().catch(() => {})
  return { serverUnbound, success: true }
}
