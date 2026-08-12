import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  APPROVED_MOBILE_PRODUCTION,
  APPROVED_MOBILE_TEST,
  MOBILE_EAS_PROJECT_IDS,
  validateResolvedMobileEnvironment,
} from '../apps/mobile-core/src/environmentBoundary.js'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function makePublicClientKey(ref = APPROVED_MOBILE_TEST.supabaseRef) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ ref, role: 'anon' })}.test-signature`
}

function approvedProductionFixture(buildProfile = 'store-live') {
  return {
    allowLiveSupabase: 'true',
    apiBaseUrl: APPROVED_MOBILE_PRODUCTION.apiOrigin,
    appRole: 'parent',
    buildProfile,
    easProjectId: MOBILE_EAS_PROJECT_IDS.parent,
    supabaseEnvironment: 'production',
    supabasePublishableKey: makePublicClientKey(APPROVED_MOBILE_PRODUCTION.supabaseRef),
    supabaseUrl: APPROVED_MOBILE_PRODUCTION.supabaseOrigin,
  }
}

function approvedFixture(appRole, buildProfile) {
  return {
    allowLiveSupabase: 'false',
    apiBaseUrl: APPROVED_MOBILE_TEST.apiOrigin,
    appRole,
    buildProfile,
    easProjectId: MOBILE_EAS_PROJECT_IDS[appRole],
    supabaseEnvironment: 'test',
    supabasePublishableKey: makePublicClientKey(),
    supabaseUrl: APPROVED_MOBILE_TEST.supabaseOrigin,
  }
}

for (const appRole of ['coach', 'parent']) {
  for (const profile of ['development', 'internal', 'store-test']) {
    test(`${appRole} ${profile} resolves only to the approved test boundary`, () => {
      const result = validateResolvedMobileEnvironment(approvedFixture(appRole, profile))
      assert.equal(result.pass, true)
      assert.deepEqual(result.reasonCodes, [
        'approved_test_supabase',
        'approved_test_api',
        'approved_test_key_pair',
      ])
    })
  }
}

const hostileCases = [
  ['missing environment', { supabaseEnvironment: '' }, 'missing_required_variable'],
  ['missing Supabase URL', { supabaseUrl: '' }, 'missing_required_variable'],
  ['missing API URL', { apiBaseUrl: '' }, 'missing_required_variable'],
  ['missing public key', { supabasePublishableKey: '' }, 'missing_required_variable'],
  ['missing EAS project ID', { easProjectId: '' }, 'wrong_eas_project'],
  ['live classification', { supabaseEnvironment: 'live' }, 'invalid_environment_classification'],
  ['live access enabled', { allowLiveSupabase: 'true' }, 'live_access_enabled'],
  ['production Supabase', { supabaseUrl: 'https://hvapkizujvsahvgspser.supabase.co' }, 'forbidden_live_supabase'],
  ['retired Supabase', { supabaseUrl: 'https://llpufwzvgxyczxcjwupu.supabase.co' }, 'forbidden_retired_supabase'],
  ['unknown Supabase', { supabaseUrl: 'https://unknown-project.supabase.co' }, 'unknown_supabase'],
  ['production API', { apiBaseUrl: 'https://footballplayer.online' }, 'forbidden_live_api'],
  ['unknown API', { apiBaseUrl: 'https://mobile-test.example.invalid' }, 'unknown_api'],
  ['HTTP API', { apiBaseUrl: 'http://footballplayer-mobile-test-api.netlify.app' }, 'insecure_api'],
  ['mismatched public key', { supabasePublishableKey: makePublicClientKey('another-project-ref') }, 'mismatched_supabase_key'],
  ['unknown profile', { buildProfile: 'other' }, 'invalid_build_profile'],
]

for (const [name, changes, reason] of hostileCases) {
  test(`validator rejects ${name} without returning environment values`, () => {
    const fixture = { ...approvedFixture('coach', 'internal'), ...changes }
    const result = validateResolvedMobileEnvironment(fixture)
    assert.equal(result.pass, false)
    assert.ok(result.reasonCodes.includes(reason))
    const safeOutput = JSON.stringify(result)
    for (const value of [fixture.supabasePublishableKey, fixture.supabaseUrl, fixture.apiBaseUrl]) {
      if (value) assert.equal(safeOutput.includes(value), false)
    }
  })
}

test('Parent production profiles require exact production values while Coach stays blocked', () => {
  for (const profile of ['internal-live', 'store-live']) {
    const result = validateResolvedMobileEnvironment(approvedProductionFixture(profile))
    assert.equal(result.pass, true)
    assert.deepEqual(result.reasonCodes, [
      'approved_production_supabase',
      'approved_production_api',
      'approved_production_key_pair',
    ])
  }
  const coach = validateResolvedMobileEnvironment({ ...approvedProductionFixture(), appRole: 'coach', easProjectId: MOBILE_EAS_PROJECT_IDS.coach })
  assert.equal(coach.pass, false)
  assert.ok(coach.reasonCodes.includes('production_build_not_authorised'))
})

test('Coach and Parent EAS profiles preserve tester scopes and only Parent adds production profiles', async () => {
  for (const appRole of ['coach', 'parent']) {
    const eas = JSON.parse(await readFile(path.join(repositoryRoot, 'apps', `${appRole}-mobile`, 'eas.json'), 'utf8'))
    assert.equal(eas.build.development.environment, 'development')
    assert.equal(eas.build.internal.environment, 'preview')
    assert.equal(eas.build['store-test'].environment, 'preview')
    assert.equal(eas.build.development.env.EXPO_PUBLIC_BUILD_PROFILE, 'development')
    assert.equal(eas.build.internal.env.EXPO_PUBLIC_BUILD_PROFILE, 'internal')
    assert.equal(eas.build['store-test'].env.EXPO_PUBLIC_BUILD_PROFILE, 'store-test')
    if (appRole === 'parent') {
      assert.equal(eas.build['internal-live'].environment, 'production')
      assert.equal(eas.build['store-live'].environment, 'production')
      assert.equal(eas.build['internal-live'].env.EXPO_PUBLIC_BUILD_PROFILE, 'internal-live')
      assert.equal(eas.build['store-live'].env.EXPO_PUBLIC_BUILD_PROFILE, 'store-live')
      assert.equal(eas.submit['store-live'].ios.ascAppId, '6772061464')
    } else {
      assert.equal(eas.build['internal-live'], undefined)
      assert.equal(eas.build['store-live'], undefined)
      assert.equal(eas.submit['store-live'], undefined)
    }
  }
})

test('repository profile guard passes without resolving remote values', () => {
  const result = spawnSync(process.execPath, ['apps/scripts/mobile-eas-profile-check.mjs'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
})

test('production build guards require the named Parent promotion reference', () => {
  const buildGuard = readFileSync(path.join(repositoryRoot, 'apps/scripts/mobile-build-guard.mjs'), 'utf8')
  assert.match(buildGuard, /FP-MOBILE-PARENT-IOS-BLACK-SCREEN-AND-PLAY-CLOSED-TEST-28/)
  assert.match(buildGuard, /FP-MOBILE-PARENT-LIVE-ACCOUNT-QA-CORRECTIVE-29/)
  assert.match(buildGuard, /FP-MOBILE-LIVE-QA-CROSSPRODUCT-CORRECTIVE-MASTER-34/)
  assert.match(buildGuard, /FP-MOBILE-PARENT-ASSESSMENT-CALENDAR-CORRECTIVE-38/)
  assert.doesNotMatch(buildGuard, /FP-MOBILE-PARENT-PRODUCTION-PROMOTION-MASTER-26/)
  for (const [appRole, profile, platform] of [['coach', 'internal-live', 'android'], ['parent', 'internal-live', 'android'], ['parent', 'store-live', 'ios']]) {
    const result = spawnSync(process.execPath, ['apps/scripts/mobile-build-guard.mjs', appRole, profile, platform], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...process.env, MOBILE_NATIVE_BUILD_CONFIRMED: 'true' },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Production Parent mobile build not authorised for this reference\./)
    assert.match(result.stderr, /production_build_not_authorised/)
    assert.doesNotMatch(result.stderr, /EXPO_PUBLIC_|supabase\.co|netlify\.app/)
  }
})

test('Ref 47 permits the bounded Parent internal live iOS candidate', () => {
  const result = spawnSync(process.execPath, ['apps/scripts/mobile-build-guard.mjs', 'parent', 'internal-live', 'ios'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, MOBILE_PRODUCTION_PROMOTION_REFERENCE: 'FP-MOBILE-FORMATION-NOTIFICATIONS-47' },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Mobile native build is blocked until EAS setup/)
  assert.doesNotMatch(result.stderr, /production_build_not_authorised|Unknown mobile build profile/)
})

test('Ref 38 permits only the bounded Parent production build profiles', () => {
  const promotionReference = 'FP-MOBILE-PARENT-ASSESSMENT-CALENDAR-CORRECTIVE-38'
  for (const [profile, platform] of [['internal-live', 'android'], ['store-live', 'ios']]) {
    const result = spawnSync(process.execPath, ['apps/scripts/mobile-build-guard.mjs', 'parent', profile, platform], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...process.env, MOBILE_PRODUCTION_PROMOTION_REFERENCE: promotionReference },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Mobile native build is blocked until EAS setup/)
    assert.doesNotMatch(result.stderr, /production_build_not_authorised/)
  }

  for (const [appRole, profile, platform, expected] of [
    ['coach', 'internal-live', 'android', /production_build_not_authorised/],
    ['coach', 'store-live', 'ios', /production_build_not_authorised/],
    ['parent', 'internal-live', 'ios', /Unknown mobile build profile and platform combination/],
    ['parent', 'store-live', 'android', /Unknown mobile build profile and platform combination/],
  ]) {
    const result = spawnSync(process.execPath, ['apps/scripts/mobile-build-guard.mjs', appRole, profile, platform], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...process.env, MOBILE_PRODUCTION_PROMOTION_REFERENCE: promotionReference },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, expected)
  }
})

test('production submission guard permits only named Parent iOS promotion', () => {
  const submitGuard = readFileSync(path.join(repositoryRoot, 'apps/scripts/mobile-submit-guard.mjs'), 'utf8')
  assert.match(submitGuard, /FP-MOBILE-PARENT-IOS-BLACK-SCREEN-AND-PLAY-CLOSED-TEST-28/)
  assert.match(submitGuard, /FP-MOBILE-LIVE-QA-CROSSPRODUCT-CORRECTIVE-MASTER-34/)
  assert.doesNotMatch(submitGuard, /FP-MOBILE-PARENT-PRODUCTION-PROMOTION-MASTER-26/)
  for (const appRole of ['coach', 'parent']) {
    const result = spawnSync(process.execPath, ['apps/scripts/mobile-submit-guard.mjs', appRole, 'ios', 'store-live'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...process.env, MOBILE_SUBMISSION_CONFIRMED: 'true' },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Production Parent iOS submission not authorised for this reference\./)
    assert.match(result.stderr, /production_build_not_authorised/)
  }
})

test('mobile source contains no runtime backend selector', async () => {
  const files = [
    'apps/mobile-core/src/config.js',
    'apps/mobile-core/src/environmentBoundary.js',
    'apps/coach-mobile/App.js',
    'apps/parent-mobile/App.js',
  ]
  const source = (await Promise.all(files.map((file) => readFile(path.join(repositoryRoot, file), 'utf8')))).join('\n')
  assert.doesNotMatch(source, /setBackend|selectBackend|backendSelector|userEnteredUrl|AsyncStorage[^\n]*(?:supabase|apiBase)/i)
})
