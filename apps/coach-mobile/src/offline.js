import AsyncStorage from '@react-native-async-storage/async-storage'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils.js'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { createCoachOfflineDocument, getCoachOfflineResources, setCoachOfflineResources } from '../../mobile-core/src/coachOfflineCore'
import { getMobileRuntimeConfig } from '../../mobile-core/src/config'
import { APPROVED_MOBILE_PRODUCTION, APPROVED_MOBILE_TEST } from '../../mobile-core/src/environmentBoundary'
import { createEncryptedOfflineStore } from '../../mobile-core/src/offlineStorageCore'

const config = getMobileRuntimeConfig('coach')
const projectRef = config.isUsable ? new URL(config.supabaseUrl).hostname.split('.')[0] : ''

const cryptoProvider = {
  async open({ aad, ciphertext, key, nonce }) {
    return bytesToUtf8(xchacha20poly1305(key, nonce, utf8ToBytes(aad)).decrypt(ciphertext))
  },
  async randomBytes(length) {
    return Crypto.getRandomBytesAsync(length)
  },
  async seal({ aad, key, nonce, plaintext }) {
    return xchacha20poly1305(key, nonce, utf8ToBytes(aad)).encrypt(utf8ToBytes(plaintext))
  },
}

function unavailableStore() {
  return {
    async clear() {},
    async read() { return { document: null, status: 'blocked' } },
    async write() { throw new Error('offline_storage_boundary_rejected') },
  }
}

function createStore(environment, ref) {
  return createEncryptedOfflineStore({
    appRole: 'coach',
    cryptoProvider,
    environment,
    keyStore: SecureStore,
    keyStoreOptions: {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      requireAuthentication: false,
    },
    projectRef: ref,
    storage: AsyncStorage,
  })
}

const expectedRef = config.isProduction ? APPROVED_MOBILE_PRODUCTION.supabaseRef : APPROVED_MOBILE_TEST.supabaseRef
const store = config.isUsable && projectRef === expectedRef
  ? createStore(config.isProduction ? 'live' : 'test', projectRef)
  : unavailableStore()
const incompatibleTestStore = config.isProduction
  ? createStore('test', APPROVED_MOBILE_TEST.supabaseRef)
  : null

export async function quarantineIncompatibleCoachOfflineState() {
  if (!incompatibleTestStore) return { quarantined: false }
  await incompatibleTestStore.clear()
  return { previousEnvironment: 'test', quarantined: true }
}

export async function clearCoachOfflineState() {
  await store.clear()
}

export async function readCoachOfflineResources(userId, contextId) {
  const result = await store.read(userId)
  return getCoachOfflineResources(result.document, contextId)
}

export async function saveCoachOfflineResources(userId, contextId, resources) {
  const current = (await store.read(userId)).document || createCoachOfflineDocument({ userScope: userId })
  const cached = getCoachOfflineResources(current, contextId)
  const next = setCoachOfflineResources(current, contextId, {
    ...(cached?.resources || {}),
    ...(resources || {}),
  })
  if (JSON.stringify(next.contexts) === JSON.stringify(current.contexts)) return cached
  await store.write(userId, next)
  return getCoachOfflineResources(next, contextId)
}
