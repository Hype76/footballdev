import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  APPROVED_MOBILE_PRODUCTION,
  APPROVED_MOBILE_TEST,
  MOBILE_EAS_PROJECT_IDS,
  validateResolvedMobileEnvironment,
} from '../apps/mobile-core/src/environmentBoundary.js'
import {
  APPROVED_MOBILE_PRODUCTION_SUPABASE_REF,
  createSecureSessionStorage,
  deriveMobileSessionNamespace,
} from '../apps/mobile-core/src/secureSessionStorageCore.js'
import {
  commitMobileRuntimeOwnership,
  inspectMobileRuntimeOwnership,
} from '../apps/mobile-core/src/runtimeState.js'
import {
  MOBILE_STARTUP_STATES,
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

function makePublicClientKey(ref) {
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ ref, role: 'anon' })}.synthetic-signature`
}

function makeSession(projectRef) {
  return JSON.stringify({
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: `https://${projectRef}.supabase.co/auth/v1`, role: 'authenticated' })}.synthetic-signature`,
    expires_at: 4102444800,
    refresh_token: 'synthetic-refresh',
    token_type: 'bearer',
    user: { id: 'synthetic-coach' },
  })
}

function coachProductionConfig(changes = {}) {
  return {
    allowLiveSupabase: 'true',
    apiBaseUrl: APPROVED_MOBILE_PRODUCTION.apiOrigin,
    appRole: 'coach',
    buildProfile: 'internal-live',
    easProjectId: MOBILE_EAS_PROJECT_IDS.coach,
    isProduction: true,
    isUsable: true,
    supabaseEnvironment: 'production',
    supabasePublishableKey: makePublicClientKey(APPROVED_MOBILE_PRODUCTION.supabaseRef),
    supabaseUrl: APPROVED_MOBILE_PRODUCTION.supabaseOrigin,
    ...changes,
  }
}

test('Coach live profiles accept only the exact production project, API, key, and EAS identity', () => {
  for (const buildProfile of ['internal-live', 'store-live']) {
    const result = validateResolvedMobileEnvironment(coachProductionConfig({ buildProfile }))
    assert.equal(result.pass, true)
    assert.deepEqual(result.reasonCodes, [
      'approved_production_supabase',
      'approved_production_api',
      'approved_production_key_pair',
    ])
  }

  const hostile = [
    [{ supabaseUrl: APPROVED_MOBILE_TEST.supabaseOrigin }, 'forbidden_test_supabase'],
    [{ supabaseUrl: 'https://llpufwzvgxyczxcjwupu.supabase.co' }, 'forbidden_retired_supabase'],
    [{ apiBaseUrl: APPROVED_MOBILE_TEST.apiOrigin }, 'forbidden_test_api'],
    [{ apiBaseUrl: 'http://footballplayer.online' }, 'insecure_api'],
    [{ supabaseEnvironment: 'test' }, 'invalid_environment_classification'],
    [{ allowLiveSupabase: 'false' }, 'live_access_disabled'],
    [{ supabasePublishableKey: makePublicClientKey(APPROVED_MOBILE_TEST.supabaseRef) }, 'mismatched_supabase_key'],
    [{ easProjectId: MOBILE_EAS_PROJECT_IDS.parent }, 'wrong_eas_project'],
    [{ buildProfile: 'unknown' }, 'invalid_build_profile'],
  ]
  for (const [changes, reason] of hostile) {
    const result = validateResolvedMobileEnvironment(coachProductionConfig(changes))
    assert.equal(result.pass, false)
    assert.ok(result.reasonCodes.includes(reason))
  }
})

test('Coach production sessions use a live namespace and reject TEST session material', async () => {
  const secureStore = new MemorySecureStore()
  const legacyStorage = new MemoryStorage()
  const sessionStorageKey = `sb-${APPROVED_MOBILE_PRODUCTION_SUPABASE_REF}-auth-token`
  const storage = createSecureSessionStorage({
    appRole: 'coach',
    environment: 'production',
    legacyStorage,
    secureStore,
    sessionStorageKey,
    supabaseProjectRef: APPROVED_MOBILE_PRODUCTION_SUPABASE_REF,
  })
  assert.match(deriveMobileSessionNamespace({ appRole: 'coach', environment: 'production', logicalKey: sessionStorageKey }), /\.coach\.live\.sb-hvapkizujvsahvgspser-auth-token$/)
  const productionSession = makeSession(APPROVED_MOBILE_PRODUCTION_SUPABASE_REF)
  await storage.setItem(sessionStorageKey, productionSession)
  assert.equal(await storage.getItem(sessionStorageKey), productionSession)
  await assert.rejects(() => storage.setItem(sessionStorageKey, makeSession(APPROVED_MOBILE_TEST.supabaseRef)), /secure_session_environment_mismatch/)
})

test('Coach runtime ownership detects TEST to production upgrades before committing production ownership', async () => {
  const storage = new MemoryStorage()
  const testConfig = coachProductionConfig({
    apiBaseUrl: APPROVED_MOBILE_TEST.apiOrigin,
    isProduction: false,
    supabaseEnvironment: 'test',
    supabaseUrl: APPROVED_MOBILE_TEST.supabaseOrigin,
  })
  const testOwnership = await inspectMobileRuntimeOwnership({ config: testConfig, storage })
  await commitMobileRuntimeOwnership({ ownership: testOwnership, storage })
  const productionOwnership = await inspectMobileRuntimeOwnership({ config: coachProductionConfig(), storage })
  assert.equal(productionOwnership.status, 'incompatible')
  assert.equal(productionOwnership.previous.environment, 'test')
  assert.equal(productionOwnership.expected.environment, 'production')
})

test('fresh, valid, expired, corrupt, and failed-bootstrap startup paths always reach a visible state', async () => {
  const base = {
    clearInvalidSession: async () => {},
    config: coachProductionConfig(),
    getBiometricEnabled: async () => false,
    getSession: async () => ({ data: { session: null }, error: null }),
    loadProfile: async () => {},
    onLock: () => {},
    onSession: () => {},
    onTransition: () => {},
    prepare: async () => {},
    resolvingProfileState: MOBILE_STARTUP_STATES.RESOLVING_STAFF_CONTEXT,
    timeoutMs: 25,
  }
  assert.equal((await runMobileStartup(base)).state, MOBILE_STARTUP_STATES.READY_SIGNED_OUT)
  assert.equal((await runMobileStartup({ ...base, getSession: async () => ({ data: { session: { user: { id: 'synthetic-coach' } } }, error: null }) })).state, MOBILE_STARTUP_STATES.READY_SIGNED_IN)
  assert.equal((await runMobileStartup({ ...base, getSession: async () => ({ data: null, error: Object.assign(new Error('refresh token invalid'), { code: 'refresh_token_invalid' }) }) })).state, MOBILE_STARTUP_STATES.READY_SIGNED_OUT)
  assert.equal((await runMobileStartup({ ...base, getSession: async () => { throw new Error('corrupt local state') } })).state, MOBILE_STARTUP_STATES.RECOVERABLE_ERROR)
  assert.equal((await runMobileStartup({ ...base, prepare: async () => { throw new Error('notification bootstrap unavailable') } })).state, MOBILE_STARTUP_STATES.RECOVERABLE_ERROR)
})

test('production promotion source owns state locally, routes notifications privately, and keeps TEST profiles intact', async () => {
  const [startup, notifications, app, eas, buildGuard, submitGuard, resolvedEnvironmentGuard] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/src/startup.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/notifications.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/eas.json', import.meta.url), 'utf8'),
    readFile(new URL('../apps/scripts/mobile-build-guard.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../apps/scripts/mobile-submit-guard.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../apps/scripts/mobile-resolved-environment-check.mjs', import.meta.url), 'utf8'),
  ])
  assert.match(startup, /quarantineIncompatibleMobileSessionStorage/)
  assert.match(startup, /quarantineIncompatibleCoachOfflineState/)
  assert.match(startup, /clearIncompatibleCoachNotificationState/)
  assert.match(startup, /clearBiometricPreference\('coach'\)/)
  assert.doesNotMatch(startup, /fetch|POST|DELETE/)
  assert.match(notifications, /\/api\/mobile\/coach-push-installation/)
  assert.match(notifications, /\/api\/mobile-test\/coach-push-installation/)
  assert.match(notifications, /getCoachNotificationStorageKeys\(previousEnvironment\)/)
  assert.doesNotMatch(notifications, /service[_-]?role|SUPABASE_SERVICE/i)
  assert.match(app, /config\.isProduction \? 'LIVE' : 'TEST'/)
  assert.match(app, /initializeCoachNotifications\(\)\.catch\(\(\) => \{\}\)/)
  assert.match(submitGuard, /MOBILE_SUBMISSION_BUILD_ID/)
  assert.match(submitGuard, /--groups', 'Internal Testers'/)
  const profiles = JSON.parse(eas)
  for (const profile of ['development', 'internal', 'store-test']) {
    assert.equal(profiles.build[profile].env.EXPO_PUBLIC_SUPABASE_ENV, 'test')
    assert.equal(profiles.build[profile].env.EXPO_PUBLIC_ALLOW_LIVE_SUPABASE, 'false')
  }
  for (const profile of ['internal-live', 'store-live']) {
    assert.equal(profiles.build[profile].env.EXPO_PUBLIC_SUPABASE_ENV, 'production')
    assert.equal(profiles.build[profile].env.EXPO_PUBLIC_ALLOW_LIVE_SUPABASE, 'true')
  }
  assert.equal(profiles.submit['store-live'].ios.ascAppId, '6772059305')
  assert.match(buildGuard, /FP-MOBILE-COACH-PRODUCTION-PROMOTION-MASTER-32/)
  assert.match(submitGuard, /FP-MOBILE-COACH-PRODUCTION-PROMOTION-MASTER-32/)
  assert.match(buildGuard, /mobile-resolved-environment-check\.mjs/)
  assert.match(submitGuard, /mobile-resolved-environment-check\.mjs/)
  assert.doesNotMatch(resolvedEnvironmentGuard, /console\.(?:log|error)\([^\n]*(?:SUPABASE_URL|API_BASE_URL|PUBLISHABLE_KEY)/)
})

test('Parent and Coach application source remain independently scoped', async () => {
  const [coachApp, parentApp] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
  ])
  assert.doesNotMatch(coachApp, /apps\/parent-mobile|parent-mobile\/src/)
  assert.doesNotMatch(parentApp, /apps\/coach-mobile|coach-mobile\/src/)
})
