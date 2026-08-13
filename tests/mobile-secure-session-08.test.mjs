import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  APPROVED_MOBILE_PRODUCTION_SUPABASE_REF,
  APPROVED_MOBILE_TEST_SUPABASE_REF,
  createSecureSessionStorage,
  deriveMobileSessionNamespace,
  getUtf8ByteLength,
  MOBILE_SESSION_CHUNK_BYTES,
  MOBILE_SESSION_MAX_BYTES,
  MOBILE_SESSION_STORAGE_SCHEMA_VERSION,
  splitUtf8Chunks,
} from '../apps/mobile-core/src/secureSessionStorageCore.js'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sessionKey = `sb-${APPROVED_MOBILE_TEST_SUPABASE_REF}-auth-token`

class MockSecureStore {
  constructor(values = new Map()) {
    this.values = values
    this.events = []
    this.failSet = null
  }

  async deleteItemAsync(key, options) {
    this.events.push({ key, operation: 'delete', options })
    this.values.delete(key)
  }

  async getItemAsync(key, options) {
    this.events.push({ key, operation: 'get', options })
    return this.values.get(key) ?? null
  }

  async setItemAsync(key, value, options) {
    this.events.push({ key, operation: 'set', options })
    if (this.failSet?.({ key, value })) throw new Error('synthetic_secure_store_failure')
    this.values.set(key, value)
  }
}

class MockLegacyStorage {
  constructor(values = new Map(), events = []) {
    this.values = values
    this.events = events
    this.failRemove = false
  }

  async getItem(key) {
    this.events.push({ key, operation: 'legacy_get' })
    return this.values.get(key) ?? null
  }

  async removeItem(key) {
    this.events.push({ key, operation: 'legacy_remove' })
    if (this.failRemove) throw new Error('synthetic_legacy_remove_failure')
    this.values.delete(key)
  }
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function makeSession({
  access = 'synthetic-access',
  expiresAt = 4102444800,
  padding = '',
  projectRef = APPROVED_MOBILE_TEST_SUPABASE_REF,
  refresh = 'synthetic-refresh',
} = {}) {
  const accessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: `https://${projectRef}.supabase.co/auth/v1`, role: 'authenticated' })}.${access}`
  return JSON.stringify({
    access_token: accessToken,
    expires_at: expiresAt,
    refresh_token: refresh,
    token_type: 'bearer',
    user: {
      app_metadata: { provider: 'email' },
      id: 'synthetic-user',
      user_metadata: { padding },
    },
  })
}

function createHarness({ appRole = 'coach', environment = 'test', legacyValues, secureValues } = {}) {
  const diagnostics = []
  const secureStore = new MockSecureStore(secureValues)
  const legacyStorage = new MockLegacyStorage(legacyValues, secureStore.events)
  const storage = createSecureSessionStorage({
    appRole,
    environment,
    legacyStorage,
    onDiagnostic: (category) => diagnostics.push(category),
    secureStore,
    secureStoreOptions: { keychainAccessible: 'after_first_unlock_this_device_only', requireAuthentication: false },
    sessionStorageKey: sessionKey,
    supabaseProjectRef: APPROVED_MOBILE_TEST_SUPABASE_REF,
  })
  return { diagnostics, legacyStorage, secureStore, storage }
}

test('storage constants use a conservative SecureStore-compatible chunk boundary', () => {
  assert.equal(MOBILE_SESSION_STORAGE_SCHEMA_VERSION, 1)
  assert.equal(MOBILE_SESSION_CHUNK_BYTES, 1500)
  assert.ok(MOBILE_SESSION_CHUNK_BYTES < 2048)
  assert.equal(MOBILE_SESSION_MAX_BYTES, 64 * 1024)
})

test('UTF-8 chunking stays within the byte boundary and reconstructs Unicode exactly', () => {
  const value = `session-${'⚽'.repeat(900)}-${'x'.repeat(2200)}`
  const chunks = splitUtf8Chunks(value)
  assert.ok(chunks.length > 1)
  assert.ok(chunks.every((chunk) => getUtf8ByteLength(chunk) <= MOBILE_SESSION_CHUNK_BYTES))
  assert.equal(chunks.join('') === value, true)
})

test('missing secure and legacy state returns null safely', async () => {
  const { storage } = createHarness()
  assert.equal(await storage.getItem(sessionKey), null)
})

test('small session write stores chunks before manifest, verifies before activation, and avoids biometric gating', async () => {
  const { legacyStorage, secureStore, storage } = createHarness()
  const value = makeSession()
  legacyStorage.values.set(sessionKey, value)

  await storage.setItem(sessionKey, value)
  assert.equal((await storage.getItem(sessionKey)) === value, true)
  assert.equal(legacyStorage.values.has(sessionKey), false)

  const chunkSet = secureStore.events.findIndex((event) => event.operation === 'set' && event.key.includes('.c.00'))
  const manifestSet = secureStore.events.findIndex((event) => event.operation === 'set' && event.key.endsWith('.manifest'))
  const manifestReadback = secureStore.events.findIndex((event, index) => index > manifestSet && event.operation === 'get' && event.key.endsWith('.manifest'))
  const pointerSet = secureStore.events.findIndex((event) => event.operation === 'set' && event.key.endsWith('.active'))
  const legacyRemoval = secureStore.events.findIndex((event) => event.operation === 'legacy_remove' && event.key === sessionKey)

  assert.ok(chunkSet >= 0 && chunkSet < manifestSet)
  assert.ok(manifestSet < manifestReadback && manifestReadback < pointerSet)
  assert.ok(pointerSet < legacyRemoval)
  assert.ok(secureStore.events.every((event) => event.options?.requireAuthentication !== true))
})

test('realistically large and multi-chunk sessions round trip without plaintext persistence', async () => {
  for (const padding of ['x'.repeat(6000), '⚽'.repeat(5000), 'z'.repeat(30000)]) {
    const { legacyStorage, storage } = createHarness()
    const value = makeSession({ padding })
    await storage.setItem(sessionKey, value)
    assert.equal((await storage.getItem(sessionKey)) === value, true)
    assert.equal(legacyStorage.values.has(sessionKey), false)
  }
})

test('boundary-size session succeeds and oversized replacement preserves the previous session', async () => {
  const { storage } = createHarness()
  const previous = makeSession({ padding: 'a'.repeat(4000) })
  const boundary = makeSession({ access: 'boundary', padding: 'b'.repeat(60000) })
  const oversized = makeSession({ access: 'oversized', padding: 'c'.repeat(MOBILE_SESSION_MAX_BYTES + 1000) })

  await storage.setItem(sessionKey, previous)
  await storage.setItem(sessionKey, boundary)
  assert.equal((await storage.getItem(sessionKey)) === boundary, true)
  await assert.rejects(() => storage.setItem(sessionKey, oversized), /secure_session_oversized/)
  assert.equal((await storage.getItem(sessionKey)) === boundary, true)
})

test('generation swap prunes the old generation only after successful activation', async () => {
  const { secureStore, storage } = createHarness()
  await storage.setItem(sessionKey, makeSession({ access: 'first' }))
  await storage.setItem(sessionKey, makeSession({ access: 'second' }))
  const storedKeys = [...secureStore.values.keys()]
  assert.equal(storedKeys.some((key) => key.includes('.g.a.')), false)
  assert.equal(storedKeys.some((key) => key.includes('.g.b.')), true)
})

test('failed replacement write retains the previous valid generation', async () => {
  const { secureStore, storage } = createHarness()
  const previous = makeSession({ access: 'previous', padding: 'p'.repeat(3000) })
  const replacement = makeSession({ access: 'replacement', padding: 'r'.repeat(7000) })
  await storage.setItem(sessionKey, previous)
  secureStore.failSet = ({ key }) => key.includes('.g.b.c.01')
  await assert.rejects(() => storage.setItem(sessionKey, replacement), /synthetic_secure_store_failure/)
  secureStore.failSet = null
  assert.equal((await storage.getItem(sessionKey)) === previous, true)
})

test('interrupted finalisation can recover the valid previous generation', async () => {
  const { secureStore, storage } = createHarness()
  const previous = makeSession({ access: 'previous' })
  const replacement = makeSession({ access: 'replacement', padding: 'r'.repeat(4000) })
  await storage.setItem(sessionKey, previous)

  let pointerWrites = 0
  secureStore.failSet = ({ key }) => {
    if (!key.endsWith('.active')) return false
    pointerWrites += 1
    return pointerWrites === 2
  }
  await assert.rejects(() => storage.setItem(sessionKey, replacement), /synthetic_secure_store_failure/)
  secureStore.failSet = null

  const activeChunk = [...secureStore.values.keys()].find((key) => key.includes('.g.b.c.00'))
  secureStore.values.set(activeChunk, 'corrupt')
  assert.equal((await storage.getItem(sessionKey)) === previous, true)
  assert.equal([...secureStore.values.keys()].some((key) => key.includes('.g.b.')), false)
})

test('corrupt active storage fails closed, clears invalid local state, and does not authenticate', async () => {
  const { diagnostics, secureStore, storage } = createHarness()
  await storage.setItem(sessionKey, makeSession())
  const activeChunk = [...secureStore.values.keys()].find((key) => key.includes('.c.00'))
  secureStore.values.set(activeChunk, 'corrupt')
  assert.equal(await storage.getItem(sessionKey), null)
  assert.ok(diagnostics.includes('secure_session_corrupt'))
  assert.equal([...secureStore.values.keys()].some((key) => key.includes('.g.')), false)
})

test('concurrent refresh-style writes are serialized and leave one complete final session', async () => {
  const { storage } = createHarness()
  const values = [
    makeSession({ access: 'refresh-1', expiresAt: 4102444801 }),
    makeSession({ access: 'refresh-2', expiresAt: 4102444802 }),
    makeSession({ access: 'refresh-3', expiresAt: 4102444803 }),
  ]
  await Promise.all(values.map((value) => storage.setItem(sessionKey, value)))
  assert.equal((await storage.getItem(sessionKey)) === values.at(-1), true)
})

test('Coach, Parent, environment, schema and logical key namespaces are isolated', () => {
  const coach = deriveMobileSessionNamespace({ appRole: 'coach', environment: 'test', logicalKey: sessionKey })
  const parent = deriveMobileSessionNamespace({ appRole: 'parent', environment: 'test', logicalKey: sessionKey })
  const futureLive = deriveMobileSessionNamespace({ appRole: 'coach', environment: 'live', logicalKey: sessionKey })
  const userKey = deriveMobileSessionNamespace({ appRole: 'coach', environment: 'test', logicalKey: `${sessionKey}-user` })
  assert.equal(new Set([coach, parent, futureLive, userKey]).size, 4)
  assert.match(coach, /\.v1\.coach\.test\./)
})

test('Coach cannot restore Parent and Parent cannot restore Coach', async () => {
  const secureValues = new Map()
  const legacyValues = new Map()
  const coach = createHarness({ appRole: 'coach', legacyValues, secureValues })
  const parent = createHarness({ appRole: 'parent', legacyValues, secureValues })
  const value = makeSession()
  await coach.storage.setItem(sessionKey, value)
  assert.equal(await parent.storage.getItem(sessionKey), null)
  await parent.storage.setItem(sessionKey, makeSession({ access: 'parent' }))
  assert.equal((await coach.storage.getItem(sessionKey)) === value, true)
})

test('unknown app, unknown environment and wrong project fail closed while approved Coach and Parent production storage is supported', () => {
  const base = {
    legacyStorage: new MockLegacyStorage(),
    secureStore: new MockSecureStore(),
    sessionStorageKey: sessionKey,
    supabaseProjectRef: APPROVED_MOBILE_TEST_SUPABASE_REF,
  }
  assert.throws(() => createSecureSessionStorage({ ...base, appRole: 'unknown', environment: 'test' }), /secure_session_app_mismatch/)
  assert.throws(() => createSecureSessionStorage({ ...base, appRole: 'coach', environment: 'unknown' }), /secure_session_environment_mismatch/)
  assert.throws(() => createSecureSessionStorage({ ...base, appRole: 'coach', environment: 'test', supabaseProjectRef: 'unknown' }), /secure_session_environment_mismatch/)
  assert.doesNotThrow(() => createSecureSessionStorage({
    ...base,
    appRole: 'coach',
    environment: 'production',
    sessionStorageKey: `sb-${APPROVED_MOBILE_PRODUCTION_SUPABASE_REF}-auth-token`,
    supabaseProjectRef: APPROVED_MOBILE_PRODUCTION_SUPABASE_REF,
  }))
  assert.doesNotThrow(() => createSecureSessionStorage({
    ...base,
    appRole: 'parent',
    environment: 'production',
    sessionStorageKey: `sb-${APPROVED_MOBILE_PRODUCTION_SUPABASE_REF}-auth-token`,
    supabaseProjectRef: APPROVED_MOBILE_PRODUCTION_SUPABASE_REF,
  }))
})

test('valid plaintext session migrates once and is deleted only after secure readback', async () => {
  const value = makeSession({ padding: 'm'.repeat(5000) })
  const legacyValues = new Map([[sessionKey, value]])
  const { diagnostics, legacyStorage, secureStore, storage } = createHarness({ legacyValues })
  const restored = await storage.getItem(sessionKey)
  assert.equal(restored === value, true)
  assert.equal(legacyStorage.values.has(sessionKey), false)
  assert.ok(diagnostics.includes('legacy_session_migrated'))

  const legacyRemoveIndex = secureStore.events.findIndex((event) => event.operation === 'legacy_remove')
  const activePointerIndex = secureStore.events.findIndex((event) => event.operation === 'set' && event.key.endsWith('.active'))
  assert.ok(activePointerIndex >= 0 && activePointerIndex < legacyRemoveIndex)
  assert.equal((await storage.migrateLegacySession()).migrated, false)
})

test('existing valid secure session wins over stale plaintext', async () => {
  const { legacyStorage, storage } = createHarness()
  const secureValue = makeSession({ access: 'secure' })
  await storage.setItem(sessionKey, secureValue)
  legacyStorage.values.set(sessionKey, makeSession({ access: 'legacy' }))
  assert.equal((await storage.getItem(sessionKey)) === secureValue, true)
  assert.equal(legacyStorage.values.has(sessionKey), false)
})

test('interrupted migration keeps valid legacy plaintext for a later safe retry', async () => {
  const value = makeSession({ padding: 'm'.repeat(4000) })
  const legacyValues = new Map([[sessionKey, value]])
  const { legacyStorage, secureStore, storage } = createHarness({ legacyValues })
  secureStore.failSet = ({ key }) => key.includes('.c.01')
  await assert.rejects(() => storage.getItem(sessionKey), /synthetic_secure_store_failure/)
  assert.equal(legacyStorage.values.has(sessionKey), true)
  secureStore.failSet = null
  assert.equal((await storage.getItem(sessionKey)) === value, true)
  assert.equal(legacyStorage.values.has(sessionKey), false)
})

test('corrupt plaintext fails closed and is not deleted without a verified secure replacement', async () => {
  const legacyValues = new Map([[sessionKey, '{not-json']])
  const { diagnostics, legacyStorage, storage } = createHarness({ legacyValues })
  assert.equal(await storage.getItem(sessionKey), null)
  assert.ok(diagnostics.includes('legacy_session_rejected'))
  assert.equal(legacyStorage.values.has(sessionKey), true)
})

test('production, retired and unknown legacy sessions are rejected without deletion', async () => {
  for (const projectRef of ['hvapkizujvsahvgspser', 'llpufwzvgxyczxcjwupu', 'unknown-project']) {
    const legacyValues = new Map([[sessionKey, makeSession({ projectRef })]])
    const { legacyStorage, storage } = createHarness({ legacyValues })
    assert.equal(await storage.getItem(sessionKey), null)
    assert.equal(legacyStorage.values.has(sessionKey), true)
  }
})

test('migration marker cannot override missing secure data', async () => {
  const { secureStore, storage } = createHarness()
  const namespace = deriveMobileSessionNamespace({ appRole: 'coach', environment: 'test', logicalKey: sessionKey })
  secureStore.values.set(`${namespace}.migration`, JSON.stringify({ schemaVersion: 1, status: 'complete' }))
  assert.equal(await storage.getItem(sessionKey), null)
})

test('refresh replacement changes access token and expiry while preserving refresh compatibility', async () => {
  const { storage } = createHarness()
  const initial = makeSession({ access: 'access-1', expiresAt: 4102444801, refresh: 'refresh-stable' })
  const refreshed = makeSession({ access: 'access-2', expiresAt: 4102445801, refresh: 'refresh-stable' })
  await storage.setItem(sessionKey, initial)
  await storage.setItem(sessionKey, refreshed)
  assert.equal((await storage.getItem(sessionKey)) === refreshed, true)
})

test('failed refresh-style write retains the previous valid session', async () => {
  const { secureStore, storage } = createHarness()
  const initial = makeSession({ access: 'access-1' })
  await storage.setItem(sessionKey, initial)
  secureStore.failSet = ({ key }) => key.endsWith('.manifest')
  await assert.rejects(() => storage.setItem(sessionKey, makeSession({ access: 'access-2' })), /synthetic_secure_store_failure/)
  secureStore.failSet = null
  assert.equal((await storage.getItem(sessionKey)) === initial, true)
})

test('cold-start and warm-start adapter instances restore the same secure session', async () => {
  const secureValues = new Map()
  const legacyValues = new Map()
  const warm = createHarness({ secureValues, legacyValues })
  const value = makeSession()
  await warm.storage.setItem(sessionKey, value)
  assert.equal((await warm.storage.getItem(sessionKey)) === value, true)
  const cold = createHarness({ secureValues, legacyValues })
  assert.equal((await cold.storage.getItem(sessionKey)) === value, true)
})

test('logout cleanup removes session generations, legacy state and markers but preserves unrelated preferences', async () => {
  const { legacyStorage, secureStore, storage } = createHarness()
  const biometricKey = 'football-player-biometric-enabled'
  secureStore.values.set(biometricKey, 'true')
  await storage.setItem(sessionKey, makeSession({ padding: 'l'.repeat(4000) }))
  legacyStorage.values.set(sessionKey, makeSession({ access: 'legacy' }))

  await storage.clearSessionStorage()
  await storage.clearSessionStorage()
  assert.equal(await storage.getItem(sessionKey), null)
  assert.equal(legacyStorage.values.has(sessionKey), false)
  assert.equal(secureStore.values.get(biometricKey), 'true')
  assert.equal([...secureStore.values.keys()].some((key) => key.startsWith('fp.mobile.auth.')), false)
})

test('Supabase removeItem is idempotent and clears the active session without unrelated preferences', async () => {
  const { secureStore, storage } = createHarness()
  secureStore.values.set('football-player-biometric-enabled', 'true')
  await storage.setItem(sessionKey, makeSession())
  await storage.removeItem(sessionKey)
  await storage.removeItem(sessionKey)
  assert.equal(await storage.getItem(sessionKey), null)
  assert.equal(secureStore.values.get('football-player-biometric-enabled'), 'true')
})

test('legacy deletion failure does not report migration success or remove the verified secure copy', async () => {
  const value = makeSession()
  const legacyValues = new Map([[sessionKey, value]])
  const { legacyStorage, storage } = createHarness({ legacyValues })
  legacyStorage.failRemove = true
  await assert.rejects(() => storage.getItem(sessionKey), /synthetic_legacy_remove_failure/)
  assert.equal(legacyStorage.values.has(sessionKey), true)
  legacyStorage.failRemove = false
  assert.equal((await storage.getItem(sessionKey)) === value, true)
  assert.equal(legacyStorage.values.has(sessionKey), false)
})

test('safe inspection and diagnostics expose categories only', async () => {
  const { diagnostics, storage } = createHarness()
  await storage.getItem(sessionKey)
  const state = await storage.inspectSafeStorageState()
  assert.deepEqual(Object.keys(state).sort(), [
    'appRole',
    'category',
    'environment',
    'hasActiveGeneration',
    'hasPreviousGeneration',
    'schemaVersion',
  ])
  assert.equal(JSON.stringify({ diagnostics, state }).includes('synthetic-access'), false)
})

test('shared Supabase and Auth integration use secure storage and canonical logout cleanup', async () => {
  const [supabaseSource, sessionStorageSource, authSource, coachSource, parentSource] = await Promise.all([
    readFile(path.join(repositoryRoot, 'apps/mobile-core/src/supabase.js'), 'utf8'),
    readFile(path.join(repositoryRoot, 'apps/mobile-core/src/sessionStorage.js'), 'utf8'),
    readFile(path.join(repositoryRoot, 'apps/mobile-core/src/auth.js'), 'utf8'),
    readFile(path.join(repositoryRoot, 'apps/coach-mobile/App.js'), 'utf8'),
    readFile(path.join(repositoryRoot, 'apps/parent-mobile/App.js'), 'utf8'),
  ])

  assert.match(supabaseSource, /storage: mobileSessionStorage/)
  assert.match(supabaseSource, /storageKey: mobileSupabaseAuthStorageKey/)
  assert.match(supabaseSource, /autoRefreshToken: true/)
  assert.match(supabaseSource, /persistSession: true/)
  assert.match(supabaseSource, /detectSessionInUrl: false/)
  assert.doesNotMatch(supabaseSource, /storage: AsyncStorage/)
  assert.match(sessionStorageSource, /AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY/)
  assert.match(sessionStorageSource, /requireAuthentication: false/)
  assert.doesNotMatch(sessionStorageSource, /AsyncStorage\.setItem/)
  assert.match(authSource, /await clearMobileSessionStorage\(\)/)
  assert.match(authSource, /setSession\(null\)/)
  assert.match(authSource, /await setBiometricEnabled\(false\)/)
  assert.match(coachSource, /<AuthProvider appRole="coach">/)
  assert.match(parentSource, /<AuthProvider[\s\S]{0,200}appRole="parent"[\s\S]{0,200}offlineProfileStore=\{parentOfflineProfileStore\}[\s\S]{0,200}onBeforeSignOut=\{unbindParentNotifications\}/)
})
