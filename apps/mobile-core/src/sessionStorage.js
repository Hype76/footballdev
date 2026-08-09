import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { APPROVED_MOBILE_PRODUCTION, APPROVED_MOBILE_TEST } from './environmentBoundary'
import { createSecureSessionStorage } from './secureSessionStorageCore'

const secureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  requireAuthentication: false,
}

export function getMobileSupabaseAuthStorageKey(config) {
  try {
    const projectRef = new URL(config?.supabaseUrl || '').hostname.split('.')[0]
    return projectRef ? `sb-${projectRef}-auth-token` : ''
  } catch {
    return ''
  }
}

function blockedStorage(initializationError = '') {
  return {
    initializationError,
    async clearSessionStorage() {},
    async getItem() {
      return null
    },
    async removeItem() {},
    async setItem() {
      throw new Error('mobile_session_storage_boundary_rejected')
    },
  }
}

export function createMobileSessionStorage(config) {
  if (!config?.isUsable) return blockedStorage()

  try {
    const projectRef = new URL(config.supabaseUrl).hostname.split('.')[0]
    return createSecureSessionStorage({
      appRole: config.appRole,
      environment: config.supabaseEnvironment,
      legacyStorage: AsyncStorage,
      secureStore: SecureStore,
      secureStoreOptions,
      sessionStorageKey: getMobileSupabaseAuthStorageKey(config),
      supabaseProjectRef: projectRef,
    })
  } catch (error) {
    return blockedStorage(error?.code || 'secure_storage_unavailable')
  }
}

function createKnownEnvironmentStorage({ appRole, environment, projectRef }) {
  return createSecureSessionStorage({
    appRole,
    environment,
    legacyStorage: AsyncStorage,
    secureStore: SecureStore,
    secureStoreOptions,
    sessionStorageKey: `sb-${projectRef}-auth-token`,
    supabaseProjectRef: projectRef,
  })
}

export async function quarantineIncompatibleMobileSessionStorage(config) {
  if (!config?.isProduction) return { quarantined: false }

  const testStorage = createKnownEnvironmentStorage({
    appRole: config.appRole,
    environment: 'test',
    projectRef: APPROVED_MOBILE_TEST.supabaseRef,
  })
  const state = await testStorage.inspectSafeStorageState()
  const legacyKey = `sb-${APPROVED_MOBILE_TEST.supabaseRef}-auth-token`
  const hasLegacyState = Boolean(await AsyncStorage.getItem(legacyKey))
  const quarantined = hasLegacyState || state.category !== 'secure_session_missing'

  if (quarantined) await testStorage.clearSessionStorage()
  return { quarantined, previousEnvironment: 'test' }
}

export const MOBILE_PRODUCTION_AUTH_STORAGE_KEY = `sb-${APPROVED_MOBILE_PRODUCTION.supabaseRef}-auth-token`
