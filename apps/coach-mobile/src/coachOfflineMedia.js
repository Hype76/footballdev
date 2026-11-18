import { requireOptionalNativeModule } from 'expo'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { AppState, Platform } from 'react-native'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { utf8ToBytes } from '@noble/ciphers/utils.js'
import { createCoachOfflineMediaAdapter, requireCoachMediaFileSize } from '../../mobile-core/src/coachOfflineMediaAdapterCore'
import { getMobileRuntimeConfig } from '../../mobile-core/src/config'
import { APPROVED_MOBILE_PRODUCTION, APPROVED_MOBILE_TEST } from '../../mobile-core/src/environmentBoundary'
import { withCoachOfflineStorageLock } from './coachOfflineStorageBudget'

// Factory is intentionally injected with current authority and budget owners.
export function createCoachOfflineMedia({ remainingBudget, fetchAuthorized, fetchImpl = fetch }) {
  const fileSystem = requireOptionalNativeModule('ExponentFileSystem')
  const sharing = requireOptionalNativeModule('ExpoSharing')
  const methods = ['getInfoAsync', 'makeDirectoryAsync', 'readDirectoryAsync', 'readAsStringAsync', 'writeAsStringAsync', 'moveAsync', 'deleteAsync']
  if (Platform.OS === 'web' || !fileSystem?.documentDirectory || !fileSystem?.cacheDirectory
    || !methods.every(method => typeof fileSystem[method] === 'function')) throw new Error('offline_media_native_unavailable')
  if (typeof remainingBudget !== 'function' || typeof fetchAuthorized !== 'function') throw new Error('offline_media_authority_unavailable')
  const config = getMobileRuntimeConfig('coach')
  const environment = config.isProduction ? 'live' : 'test'
  const expectedRef = config.isProduction ? APPROVED_MOBILE_PRODUCTION.supabaseRef : APPROVED_MOBILE_TEST.supabaseRef
  if (!config.isUsable || new URL(config.supabaseUrl).hostname.split('.')[0] !== expectedRef) throw new Error('offline_media_authority_unavailable')
  const persistent = `${fileSystem.documentDirectory.replace(/\/*$/, '')}/fp-coach-media-v1/`
  const temporary = `${fileSystem.cacheDirectory.replace(/\/*$/, '')}/fp-coach-media-open-v1/`
  const filename = name => {
    if (!/^coach-media-[a-f0-9]{64}\.[a-f0-9]{64}$/.test(name)) throw new Error('offline_media_identity_invalid')
    return `${persistent}${name}.json`
  }
  const list = async () => {
    const info = await fileSystem.getInfoAsync(persistent, {})
    if (!info.exists) return []
    if (info.isDirectory !== true) throw new Error('offline_media_storage_invalid')
    return fileSystem.readDirectoryAsync(persistent)
  }
  const storage = {
    async getStat(name) {
      const info = await fileSystem.getInfoAsync(filename(name), {})
      return { exists: info.exists === true && !info.isDirectory,
        size: Number.isFinite(info.size) ? info.size : undefined,
        modifiedAt: Number.isFinite(info.modificationTime) ? info.modificationTime : undefined }
    },
    async getItem(name) {
      const path = filename(name), info = await fileSystem.getInfoAsync(path, {})
      if (!info.exists) return null
      if (info.isDirectory) throw new Error('offline_media_storage_invalid')
      return fileSystem.readAsStringAsync(path, { encoding: 'utf8' })
    },
    async setItem(name, value) {
      const path = filename(name), pending = `${path}.pending`
      await fileSystem.makeDirectoryAsync(persistent, { intermediates: true })
      await fileSystem.deleteAsync(pending, { idempotent: true })
      try {
        await fileSystem.writeAsStringAsync(pending, value, { encoding: 'utf8' })
        const info = await fileSystem.getInfoAsync(pending, {})
        if (!info.exists || info.isDirectory || info.size !== value.length) throw new Error('offline_media_write_failed')
        if ((await fileSystem.getInfoAsync(path, {})).exists) throw new Error('offline_media_write_conflict')
        await fileSystem.moveAsync({ from: pending, to: path })
      } finally { await fileSystem.deleteAsync(pending, { idempotent: true }) }
    },
    async hasPrefix(prefix) { return (await list()).some(name => name.startsWith(`${prefix}.`)) },
    async removePrefix(prefix) {
      if (!/^coach-media-[a-f0-9]{64}$/.test(prefix)) throw new Error('offline_media_identity_invalid')
      for (const name of await list()) if (name.startsWith(`${prefix}.`)) await fileSystem.deleteAsync(`${persistent}${name}`, { idempotent: true })
    },
    async measureBytes() {
      let total = 0
      for (const name of await list()) {
        const info = await fileSystem.getInfoAsync(`${persistent}${name}`, { size: true })
        total += requireCoachMediaFileSize(info)
      }
      return total
    },
    async clearPending() {
      for (const name of await list()) if (/^coach-media-[a-f0-9]{64}\.[a-f0-9]{64}\.json\.pending$/.test(name)) {
        await fileSystem.deleteAsync(`${persistent}${name}`, { idempotent: true })
      }
    },
  }
  const keyOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, requireAuthentication: false }
  const keyStore = {
    getItem: name => SecureStore.getItemAsync(name, keyOptions),
    setItem: (name, value) => SecureStore.setItemAsync(name, value, keyOptions),
    removeItem: name => SecureStore.deleteItemAsync(name, keyOptions),
  }
  const cipher = {
    randomBytes: length => Crypto.getRandomBytesAsync(length),
    async seal({ key, nonce, aad, plaintext }) { return xchacha20poly1305(key, nonce, utf8ToBytes(aad)).encrypt(plaintext) },
    async open({ key, nonce, aad, ciphertext }) { return xchacha20poly1305(key, nonce, utf8ToBytes(aad)).decrypt(ciphertext) },
  }
  const tempFiles = {
    async clear() { await fileSystem.deleteAsync(temporary, { idempotent: true }) },
    async write(name, base64) {
      if (!/^resource\.[a-z0-9]+$/.test(name)) throw new Error('offline_media_identity_invalid')
      await fileSystem.makeDirectoryAsync(temporary, { intermediates: true })
      const uri = `${temporary}${name}`
      await fileSystem.writeAsStringAsync(uri, base64, { encoding: 'base64' })
      return uri
    },
  }
  const nativeSharing = {
    async isAvailableAsync() { return Boolean(sharing && typeof sharing.shareAsync === 'function'
      && (!sharing.isAvailableAsync || await sharing.isAvailableAsync())) },
    shareAsync: (uri, options) => sharing.shareAsync(uri, options),
  }
  const adapter = createCoachOfflineMediaAdapter({ storage, keyStore, crypto: cipher,
    fingerprint: value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
    remainingBudget, fetchAuthorized, fetchImpl, tempFiles, sharing: nativeSharing, appState: AppState,
    allowedOrigin: config.supabaseUrl })
  const checkScope = scope => {
    if (scope?.environment !== environment || scope?.projectRef !== expectedRef) throw new Error('offline_media_scope_invalidated')
  }
  return { ...adapter, activate: scope => { checkScope(scope); return adapter.activate(scope) },
    clearAccountScope: scope => { checkScope(scope); return adapter.clearAccountScope(scope) },
    save: input => withCoachOfflineStorageLock(() => adapter.save(input)),
    startup: () => withCoachOfflineStorageLock(async () => { await adapter.clearTransient(); await storage.clearPending() }) }
}
