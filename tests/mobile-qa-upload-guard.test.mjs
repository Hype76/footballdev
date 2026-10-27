import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { assertQaUploadBuild, assertQaUploadProfile } from '../apps/scripts/mobile-qa-upload-core.mjs'

const expected = { appRole: 'parent', projectId: 'parent-project', head: 'a'.repeat(40), version: '1.1.0', platform: 'ios' }
const valid = () => ({ status: 'FINISHED', platform: 'IOS', app: { id: 'parent-project' }, appIdentifier: 'com.footballplayer.parents',
  distribution: 'STORE', buildProfile: 'store-live', updateChannel: { name: 'production' }, gitCommitHash: expected.head,
  appVersion: '1.1.0', runtime: { version: '1.1.0' }, isForIosSimulator: false })

test('internal QA requires the exact completed app, source, native version and production environment artifact', () => {
  assert.doesNotThrow(() => assertQaUploadBuild(valid(), expected))
  for (const values of [{ status: 'IN_PROGRESS' }, { platform: 'ANDROID' }, { app: { id: 'other-project' } },
    { appIdentifier: 'com.footballplayer.coach' }, { distribution: 'INTERNAL' }, { buildProfile: 'store-test' },
    { updateChannel: { name: 'preview' } }, { gitCommitHash: 'b'.repeat(40) }, { appVersion: '1.0.22' },
    { runtime: { version: '1.0.22' } }, { isForIosSimulator: true }]) {
    assert.throws(() => assertQaUploadBuild({ ...valid(), ...values }, expected))
  }
})

test('QA profile cannot target public production or another Apple app', () => {
  const profile = { android: { track: 'internal', releaseStatus: 'completed', changesNotSentForReview: false }, ios: { ascAppId: '6772061464' } }
  assert.doesNotThrow(() => assertQaUploadProfile(profile, 'parent'))
  assert.throws(() => assertQaUploadProfile({ ...profile, android: { ...profile.android, track: 'production' } }, 'parent'))
  assert.throws(() => assertQaUploadProfile({ ...profile, ios: { ascAppId: '6772059305' } }, 'parent'))
})

test('QA upload flag cannot unlock public release or skip explicit internal-upload confirmation', () => {
  for (const [profile, expectedMessage] of [['store-live', 'final external QA'], ['store-qa', 'MOBILE_QA_UPLOAD_CONFIRMED=true']]) {
    const result = spawnSync(process.execPath, ['apps/scripts/mobile-submit-guard.mjs', 'parent', 'ios', profile], {
      encoding: 'utf8', env: { ...process.env, MOBILE_SUBMISSION_CONFIRMED: 'false', MOBILE_QA_UPLOAD_CONFIRMED: profile === 'store-live' ? 'true' : 'false',
        MOBILE_PRODUCTION_PROMOTION_REFERENCE: 'FP-MOBILE-CALENDAR-BACKGROUND-ACTIONS-271026',
        MOBILE_SUBMISSION_BUILD_ID: '11111111-1111-4111-8111-111111111111' },
    })
    assert.equal(result.status, 1)
    assert.ok(`${result.stdout}${result.stderr}`.includes(expectedMessage))
  }
})
