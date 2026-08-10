import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  APPROVED_MOBILE_PRODUCTION,
  APPROVED_MOBILE_TEST,
  MOBILE_EAS_PROJECT_IDS,
  validateResolvedMobileEnvironment,
} from '../apps/mobile-core/src/environmentBoundary.js'

function makePublicClientKey(ref) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ ref, role: 'anon' })}.test-signature`
}

function productionFixture(changes = {}) {
  return {
    allowLiveSupabase: 'true',
    apiBaseUrl: APPROVED_MOBILE_PRODUCTION.apiOrigin,
    appRole: 'parent',
    buildProfile: 'store-live',
    easProjectId: MOBILE_EAS_PROJECT_IDS.parent,
    supabaseEnvironment: 'production',
    supabasePublishableKey: makePublicClientKey(APPROVED_MOBILE_PRODUCTION.supabaseRef),
    supabaseUrl: APPROVED_MOBILE_PRODUCTION.supabaseOrigin,
    ...changes,
  }
}

test('Parent internal-live and store-live accept only the exact production boundary', () => {
  for (const profile of ['internal-live', 'store-live']) {
    const result = validateResolvedMobileEnvironment(productionFixture({ buildProfile: profile }))
    assert.equal(result.pass, true)
    assert.equal(result.category, 'approved_production_environment')
  }
})

const rejectedProductionCases = [
  ['test Supabase', { supabaseUrl: APPROVED_MOBILE_TEST.supabaseOrigin }, 'forbidden_test_supabase'],
  ['retired Supabase', { supabaseUrl: 'https://llpufwzvgxyczxcjwupu.supabase.co' }, 'forbidden_retired_supabase'],
  ['test API', { apiBaseUrl: APPROVED_MOBILE_TEST.apiOrigin }, 'forbidden_test_api'],
  ['localhost API', { apiBaseUrl: 'http://localhost:8888' }, 'insecure_api'],
  ['unknown API', { apiBaseUrl: 'https://api.example.invalid' }, 'unknown_api'],
  ['HTTP production API', { apiBaseUrl: 'http://footballplayer.online' }, 'insecure_api'],
  ['test key', { supabasePublishableKey: makePublicClientKey(APPROVED_MOBILE_TEST.supabaseRef) }, 'mismatched_supabase_key'],
  ['test classification', { supabaseEnvironment: 'test' }, 'invalid_environment_classification'],
  ['live access disabled', { allowLiveSupabase: 'false' }, 'live_access_disabled'],
  ['unknown profile', { buildProfile: 'production' }, 'invalid_build_profile'],
]

for (const [name, changes, reason] of rejectedProductionCases) {
  test(`production boundary rejects ${name}`, () => {
    const result = validateResolvedMobileEnvironment(productionFixture(changes))
    assert.equal(result.pass, false)
    assert.ok(result.reasonCodes.includes(reason))
  })
}

test('Parent production profiles keep build-time environment separation and app identity', async () => {
  const eas = JSON.parse(await readFile(new URL('../apps/parent-mobile/eas.json', import.meta.url), 'utf8'))
  for (const profile of ['development', 'internal', 'store-test']) {
    assert.equal(eas.build[profile].env.EXPO_PUBLIC_SUPABASE_ENV, 'test')
    assert.equal(eas.build[profile].env.EXPO_PUBLIC_ALLOW_LIVE_SUPABASE, 'false')
  }
  assert.equal(eas.build['internal-live'].environment, 'production')
  assert.equal(eas.build['internal-live'].distribution, 'internal')
  assert.equal(eas.build['internal-live'].android.buildType, 'apk')
  assert.equal(eas.build['store-live'].environment, 'production')
  assert.equal(eas.build['store-live'].distribution, 'store')
  assert.equal(eas.submit['store-live'].ios.ascAppId, '6772061464')
})

test('Parent runtime reuses production file authority and private installation API without a backend selector', async () => {
  const [dataSource, notificationSource, appSource] = await Promise.all([
    readFile(new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/notifications.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
  ])
  assert.match(dataSource, /\/api\/parent-development\/history/)
  assert.match(dataSource, /\/api\/parent-resources\/access/)
  assert.match(dataSource, /result\.accessUrl/)
  assert.match(notificationSource, /\.netlify\/functions\/parent-mobile-push-installation/)
  assert.match(notificationSource, /Test notifications are unavailable in production builds\./)
  assert.match(appSource, /notificationState\.enabled && !config\.isProduction/)
  assert.doesNotMatch(`${dataSource}\n${notificationSource}\n${appSource}`, /setBackend|selectBackend|backendSelector|userEnteredUrl/i)
})
