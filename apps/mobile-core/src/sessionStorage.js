import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { APPROVED_MOBILE_TEST } from './environmentBoundary'
import { createSecureSessionStorage } from './secureSessionStorageCore'

export const MOBILE_SUPABASE_AUTH_STORAGE_KEY = `sb-${APPROVED_MOBILE_TEST.supabaseRef}-auth-token`

function blockedStorage() {
  return {
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

  const projectRef = new URL(config.supabaseUrl).hostname.split('.')[0]
  return createSecureSessionStorage({
    appRole: config.appRole,
    environment: config.supabaseEnvironment,
    legacyStorage: AsyncStorage,
    secureStore: SecureStore,
    secureStoreOptions: {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      requireAuthentication: false,
    },
    sessionStorageKey: MOBILE_SUPABASE_AUTH_STORAGE_KEY,
    supabaseProjectRef: projectRef,
  })
}
