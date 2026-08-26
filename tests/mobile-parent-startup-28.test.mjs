import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  APPROVED_MOBILE_PRODUCTION_SUPABASE_REF,
  APPROVED_MOBILE_TEST_SUPABASE_REF,
  createSecureSessionStorage,
  deriveMobileSessionNamespace,
} from '../apps/mobile-core/src/secureSessionStorageCore.js'
import { deriveOfflineStorageNamespace } from '../apps/mobile-core/src/offlineStorageCore.js'
import {
  commitMobileRuntimeOwnership,
  inspectMobileRuntimeOwnership,
} from '../apps/mobile-core/src/runtimeState.js'
import {
  MOBILE_STARTUP_STATES,
  isConfirmedIrrecoverableSessionError,
  runMobileStartup,
} from '../apps/mobile-core/src/startupStateCore.js'

class MemoryStorage {
  constructor(values = new Map()) { this.values = values }
  async getItem(key) { return this.values.get(key) ?? null }
  async removeItem(key) { this.values.delete(key) }
  async setItem(key, value) { this.values.set(key, value) }
}

class MemorySecureStore {
  constructor(values = new Map()) { this.values = values }
  async deleteItemAsync(key) { this.values.delete(key) }
  async getItemAsync(key) { return this.values.get(key) ?? null }
  async setItemAsync(key, value) { this.values.set(key, value) }
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function makeSession(projectRef, changes = {}) {
  const accessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: `https://${projectRef}.supabase.co/auth/v1`, role: 'authenticated' })}.signature`
  return JSON.stringify({
    access_token: accessToken,
    expires_at: 4102444800,
    refresh_token: 'synthetic-refresh',
    token_type: 'bearer',
    user: { id: 'synthetic-parent' },
    ...changes,
  })
}

function secureHarness({ environment, projectRef, sharedLegacy, sharedSecure }) {
  const key = `sb-${projectRef}-auth-token`
  const storage = createSecureSessionStorage({
    appRole: 'parent',
    environment,
    legacyStorage: new MemoryStorage(sharedLegacy),
    secureStore: new MemorySecureStore(sharedSecure),
    sessionStorageKey: key,
    supabaseProjectRef: projectRef,
  })
  return { key, storage }
}

function productionConfig(changes = {}) {
  return {
    appRole: 'parent',
    apiBaseUrl: 'https://footballplayer.online',
    isProduction: true,
    isUsable: true,
    supabaseEnvironment: 'production',
    supabaseUrl: `https://${APPROVED_MOBILE_PRODUCTION_SUPABASE_REF}.supabase.co`,
    ...changes,
  }
}

function startupHarness(changes = {}) {
  const transitions = []
  return {
    args: {
      clearInvalidSession: async () => {},
      config: productionConfig(),
      getBiometricEnabled: async () => false,
      getSession: async () => ({ data: { session: null }, error: null }),
      loadProfile: async () => {},
      onLock: () => {},
      onSession: () => {},
      onTransition: (state) => transitions.push(state),
      prepare: async () => {},
      timeoutMs: 30,
      ...changes,
    },
    transitions,
  }
}

test('build 13 root cause is removed because production secure session storage can initialize', () => {
  const sharedLegacy = new Map()
  const sharedSecure = new Map()
  const production = secureHarness({
    environment: 'production',
    projectRef: APPROVED_MOBILE_PRODUCTION_SUPABASE_REF,
    sharedLegacy,
    sharedSecure,
  })
  assert.ok(production.storage)
  assert.match(
    deriveMobileSessionNamespace({ appRole: 'parent', environment: 'production', logicalKey: production.key }),
    /\.parent\.live\.sb-hvapkizujvsahvgspser-auth-token$/,
  )
})

test('same-bundle test and production sessions use separate keys and secure namespaces', async () => {
  const sharedLegacy = new Map()
  const sharedSecure = new Map()
  const testStorage = secureHarness({
    environment: 'test',
    projectRef: APPROVED_MOBILE_TEST_SUPABASE_REF,
    sharedLegacy,
    sharedSecure,
  })
  const productionStorage = secureHarness({
    environment: 'production',
    projectRef: APPROVED_MOBILE_PRODUCTION_SUPABASE_REF,
    sharedLegacy,
    sharedSecure,
  })
  const testSession = makeSession(APPROVED_MOBILE_TEST_SUPABASE_REF)
  await testStorage.storage.setItem(testStorage.key, testSession)
  assert.equal(await productionStorage.storage.getItem(productionStorage.key), null)
  await assert.rejects(
    () => productionStorage.storage.setItem(productionStorage.key, testSession),
    /secure_session_environment_mismatch/,
  )
  await testStorage.storage.clearSessionStorage()
  assert.equal(await productionStorage.storage.getItem(productionStorage.key), null)
})

test('valid production session round trips and rejects test, retired and unknown sessions', async () => {
  const production = secureHarness({
    environment: 'live',
    projectRef: APPROVED_MOBILE_PRODUCTION_SUPABASE_REF,
    sharedLegacy: new Map(),
    sharedSecure: new Map(),
  })
  const valid = makeSession(APPROVED_MOBILE_PRODUCTION_SUPABASE_REF)
  await production.storage.setItem(production.key, valid)
  assert.equal(await production.storage.getItem(production.key), valid)
  for (const ref of [APPROVED_MOBILE_TEST_SUPABASE_REF, 'llpufwzvgxyczxcjwupu', 'unknown']) {
    await assert.rejects(() => production.storage.setItem(production.key, makeSession(ref)), /secure_session_environment_mismatch/)
  }
})

test('runtime ownership marker identifies first boot and environment changes before commit', async () => {
  const storage = new MemoryStorage()
  const first = await inspectMobileRuntimeOwnership({ config: productionConfig(), storage })
  assert.equal(first.status, 'first_boot')
  await commitMobileRuntimeOwnership({ ownership: first, storage })
  assert.equal((await inspectMobileRuntimeOwnership({ config: productionConfig(), storage })).status, 'ready')
  const changed = await inspectMobileRuntimeOwnership({
    config: productionConfig({ supabaseEnvironment: 'test', supabaseUrl: `https://${APPROVED_MOBILE_TEST_SUPABASE_REF}.supabase.co` }),
    storage,
  })
  assert.equal(changed.status, 'incompatible')
})

test('test and production offline cache and journal namespaces are isolated', () => {
  const testNamespace = deriveOfflineStorageNamespace({
    appRole: 'parent', environment: 'test', projectRef: APPROVED_MOBILE_TEST_SUPABASE_REF,
  })
  const productionNamespace = deriveOfflineStorageNamespace({
    appRole: 'parent', environment: 'live', projectRef: APPROVED_MOBILE_PRODUCTION_SUPABASE_REF,
  })
  assert.notEqual(testNamespace, productionNamespace)
  assert.match(productionNamespace, /\.parent\.live\.hvapkizujvsahvgspser$/)
})

test('fresh production boot reaches visible signed-out state', async () => {
  const { args, transitions } = startupHarness()
  const result = await runMobileStartup(args)
  assert.equal(result.state, MOBILE_STARTUP_STATES.READY_SIGNED_OUT)
  assert.deepEqual(transitions, [MOBILE_STARTUP_STATES.BOOTING, MOBILE_STARTUP_STATES.RESTORING_SESSION])
})

test('signed-out startup does not wait for the independent biometric read', async () => {
  let resolveBiometric
  const biometricGate = new Promise((resolve) => { resolveBiometric = resolve })
  const { args } = startupHarness({
    getBiometricEnabled: () => biometricGate,
    timeoutMs: 1000,
  })
  const completion = runMobileStartup(args)
  const result = await Promise.race([
    completion,
    new Promise((resolve) => setTimeout(() => resolve('blocked'), 50)),
  ])
  resolveBiometric(false)
  assert.notEqual(result, 'blocked')
  assert.equal(result.state, MOBILE_STARTUP_STATES.READY_SIGNED_OUT)
})

test('valid production session restores profile and reaches signed-in state', async () => {
  const session = { user: { id: 'synthetic-parent' } }
  let loaded = false
  const order = []
  const { args } = startupHarness({
    getBiometricEnabled: async () => { order.push('biometric'); return true },
    getSession: async () => ({ data: { session }, error: null }),
    loadProfile: async (value) => { order.push('profile'); loaded = value === session },
    onLock: () => { order.push('lock') },
    onSession: () => { order.push('session') },
  })
  const result = await runMobileStartup(args)
  assert.equal(result.state, MOBILE_STARTUP_STATES.READY_SIGNED_IN)
  assert.equal(loaded, true)
  assert.deepEqual(order, ['biometric', 'lock', 'session', 'profile'])
})

test('expired or invalid refresh session clears locally and reaches signed-out state', async () => {
  let cleared = false
  const error = Object.assign(new Error('refresh token invalid'), { code: 'refresh_token_invalid' })
  const { args } = startupHarness({
    clearInvalidSession: async () => { cleared = true },
    getSession: async () => ({ data: null, error }),
  })
  const result = await runMobileStartup(args)
  assert.equal(result.state, MOBILE_STARTUP_STATES.READY_SIGNED_OUT)
  assert.equal(cleared, true)
})

test('expired access tokens and temporary refresh failures preserve the saved session', async () => {
  for (const error of [
    Object.assign(new Error('JWT expired'), { code: 'jwt_expired' }),
    Object.assign(new Error('Failed to fetch while refreshing the session'), { code: 'refresh_network_error' }),
    Object.assign(new Error('The request timed out'), { code: 'refresh_timeout' }),
  ]) {
    let cleared = false
    const { args } = startupHarness({
      clearInvalidSession: async () => { cleared = true },
      getSession: async () => ({ data: null, error }),
    })
    const result = await runMobileStartup(args)
    assert.equal(result.state, MOBILE_STARTUP_STATES.RECOVERABLE_ERROR)
    assert.equal(cleared, false)
  }
})

test('only explicit refresh revocation or account deletion is treated as irrecoverable', () => {
  assert.equal(isConfirmedIrrecoverableSessionError({ code: 'refresh_token_invalid' }), true)
  assert.equal(isConfirmedIrrecoverableSessionError({ message: 'Refresh token not found' }), true)
  assert.equal(isConfirmedIrrecoverableSessionError({ code: 'user_deleted' }), true)
  assert.equal(isConfirmedIrrecoverableSessionError({ code: 'jwt_expired' }), false)
  assert.equal(isConfirmedIrrecoverableSessionError({ code: 'refresh_network_error' }), false)
})

test('unknown environment fails closed to visible recoverable configuration error', async () => {
  const { args } = startupHarness({ config: productionConfig({ isUsable: false }) })
  const result = await runMobileStartup(args)
  assert.deepEqual(result, {
    diagnosticCode: 'PARENT_CONFIG_INVALID',
    state: MOBILE_STARTUP_STATES.RECOVERABLE_ERROR,
  })
})

test('hung preparation, session, biometric and profile operations time out instead of deadlocking', async () => {
  const never = () => new Promise(() => {})
  const session = { user: { id: 'synthetic-parent' } }
  const scenarios = [
    { prepare: never },
    { getSession: never },
    { getSession: async () => ({ data: { session }, error: null }), getBiometricEnabled: never },
    { getSession: async () => ({ data: { session }, error: null }), loadProfile: never },
  ]
  for (const scenario of scenarios) {
    const { args } = startupHarness({ timeoutMs: 10, ...scenario })
    const result = await runMobileStartup(args)
    assert.equal(result.state, MOBILE_STARTUP_STATES.RECOVERABLE_ERROR)
    assert.equal(result.diagnosticCode, 'PARENT_STARTUP_TIMEOUT')
  }
})

test('source wires a visible finite startup model and local-only recovery', async () => {
  const [app, auth, offline, sessionStorage, startup, notifications] = await Promise.all([
    readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/auth.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/offline.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/sessionStorage.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/startup.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/notifications.js', import.meta.url), 'utf8'),
  ])
  assert.match(app, /Something went wrong/)
  assert.match(app, /Reset local app data/)
  assert.match(app, /PARENT_ROOT_RENDER_FAILED/)
  assert.match(app, /prepareStartup=\{prepareParentMobileStartup\}/)
  for (const state of Object.values(MOBILE_STARTUP_STATES)) assert.match(`${app}\n${auth}`, new RegExp(state))
  assert.match(auth, /signOut\(\{ scope: 'local' \}\)/)
  assert.match(offline, /APPROVED_MOBILE_PRODUCTION/)
  assert.match(offline, /environment: config\.isProduction \? 'live' : 'test'/)
  assert.match(sessionStorage, /getMobileSupabaseAuthStorageKey/)
  assert.match(sessionStorage, /quarantineIncompatibleMobileSessionStorage/)
  assert.match(startup, /quarantineIncompatibleParentOfflineState/)
  assert.match(startup, /clearBiometricPreference/)
  assert.match(notifications, /clearIncompatibleParentNotificationState/)
  assert.doesNotMatch(startup, /fetch|supabase|POST|DELETE/)
})
