import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import test from 'node:test'
import { assertAndroidSigningFiles, assertEasIdentity, assertGeneratedPaths, assertNativeInputsUnchanged, assertPristineInputs, findArtifacts, nativeInventory, readTrustedReview } from '../scripts/security-eas-coach-test.mjs'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')
const config = JSON.parse(readFileSync('apps/coach-mobile/eas.json', 'utf8'))

test('remote gate accepts only the exact Coach cloud build identity and toolchain', () => {
  const env = { EAS_BUILD: 'true', EAS_BUILD_RUNNER: 'eas-build', EAS_BUILD_PROJECT_ID: '347965b1-f32f-47b1-8c86-7aa910fe2cb5', EAS_BUILD_PROFILE: 'store-live', FP_COACH_QA_SCOPE: 'FP-COACH-OFFLINE-15MB-20261102', EAS_BUILD_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', EAS_BUILD_GIT_COMMIT_HASH: 'a'.repeat(40), EAS_BUILD_PLATFORM: 'android' }
  assert.doesNotThrow(() => assertEasIdentity(env, '22.17.0'))
  for (const change of [{ EAS_BUILD: 'false' }, { EAS_BUILD_RUNNER: 'local-build-plugin' }, { EAS_BUILD_PROJECT_ID: 'other' }, { EAS_BUILD_PROFILE: 'development' }, { FP_COACH_QA_SCOPE: 'other' }, { EAS_BUILD_PLATFORM: 'web' }, { EAS_BUILD_GIT_COMMIT_HASH: 'bad' }]) assert.throws(() => assertEasIdentity({ ...env, ...change }, '22.17.0'))
  assert.throws(() => assertEasIdentity(env, '22.21.0'))
})

test('trusted receipt is bounded, canonical and checked against the independent pin', () => {
  const bytes = Buffer.from('{"head":"synthetic"}')
  const encoded = gzipSync(bytes).toString('base64')
  const env = { FP_COACH_QA_REVIEW_GZIP_1: encoded.slice(0, 8), FP_COACH_QA_REVIEW_GZIP_2: encoded.slice(8), FP_COACH_QA_REVIEW_SHA256: createHash('sha256').update(bytes).digest('hex') }
  assert.deepEqual(readTrustedReview(env), bytes)
  assert.throws(() => readTrustedReview({ ...env, FP_COACH_QA_REVIEW_SHA256: '0'.repeat(64) }))
  assert.throws(() => readTrustedReview({ ...env, FP_COACH_QA_REVIEW_GZIP_2: `${env.FP_COACH_QA_REVIEW_GZIP_2}!` }))
  assert.throws(() => readTrustedReview({ ...env, FP_COACH_QA_REVIEW_GZIP_1: 'a'.repeat(5001) }))
})

test('only generated files for the current Coach platform are accepted', () => {
  assert.doesNotThrow(() => assertGeneratedPaths(['apps/coach-mobile/android/app/build.gradle'], 'android'))
  for (const path of ['apps/coach-mobile/ios/Podfile', 'apps/parent-mobile/android/app/build.gradle', 'apps/coach-mobile/android/../../secrets', 'apps/coach-mobile/android/..\\secrets']) assert.throws(() => assertGeneratedPaths([path], 'android'))
})

test('Android signing files are accepted only after injection and only as regular files', () => {
  const key = 'keystore-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  assert.throws(() => assertGeneratedPaths(['credentials.json'], 'android'))
  assert.throws(() => assertGeneratedPaths(['credentials.json'], 'ios', true))
  assert.throws(() => assertGeneratedPaths(['keystore-not-a-uuid'], 'android', true))
  assert.doesNotThrow(() => assertGeneratedPaths(['credentials.json', key], 'android', true))
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'coach-signing-'))
  try {
    assert.throws(() => assertAndroidSigningFiles(fixture))
    writeFileSync(path.join(fixture, 'credentials.json'), 'synthetic')
    mkdirSync(path.join(fixture, key))
    assert.throws(() => assertAndroidSigningFiles(fixture))
    rmSync(path.join(fixture, key), { recursive: true })
    writeFileSync(path.join(fixture, key), 'synthetic')
    assert.doesNotThrow(() => assertAndroidSigningFiles(fixture))
    writeFileSync(path.join(fixture, 'keystore-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'synthetic')
    assert.throws(() => assertAndroidSigningFiles(fixture))
  } finally { rmSync(fixture, { recursive: true, force: true }) }
})

test('pre-existing native inputs are rejected and native files and artifacts have exact identities', () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'coach-eas-security-'))
  try {
    assert.doesNotThrow(() => assertPristineInputs(fixture))
    const native = path.join(fixture, 'apps/coach-mobile/android')
    mkdirSync(native, { recursive: true })
    assert.throws(() => assertPristineInputs(fixture), /pre-existing build input/)
    writeFileSync(path.join(native, 'build.gradle'), 'reviewed generated input')
    mkdirSync(path.join(native, 'app/build/outputs'), { recursive: true })
    writeFileSync(path.join(native, 'app/build/outputs/app.aab'), 'synthetic artifact')
    const inventory = nativeInventory(native, fixture)
    assert.equal(inventory.length, 2)
    assert.equal(inventory.find(item => item.path === 'build.gradle').sha256, createHash('sha256').update('reviewed generated input').digest('hex'))
    assert.equal(findArtifacts(path.join(native, 'app/build/outputs'), '.aab').length, 1)
    assert.doesNotThrow(() => assertNativeInputsUnchanged(native, fixture, inventory))
    writeFileSync(path.join(native, 'build.gradle'), 'unexpected modification')
    assert.throws(() => assertNativeInputsUnchanged(native, fixture, inventory), /Native input/)
  } finally { rmSync(fixture, { recursive: true, force: true }) }
})

for (const platform of ['android', 'ios']) test(`${platform} custom build verifies source and copies before and after each native consumer`, () => {
  assert.equal(config.cli.requireCommit, true)
  const name = config.build['store-live'][platform].config
  const workflow = yaml.load(readFileSync(`apps/coach-mobile/.eas/build/${name}`, 'utf8'))
  const steps = workflow.build.steps
  assert.equal(steps[0], 'eas/checkout')
  assert.ok(!steps.includes('eas/build') && !steps.includes('eas/install_node_modules') && !steps.includes('eas/prebuild'))
  const commands = steps.map(step => typeof step === 'string' ? step : typeof step.run === 'string' ? step.run : step.run?.command || Object.keys(step)[0])
  const setup = commands.findIndex(value => value.includes('security-eas-coach-test.mjs preflight'))
  const prebuild = commands.findIndex(value => value.includes('prebuild --no-install'))
  const nativeBuild = commands.findIndex(value => value === (platform === 'ios' ? 'eas/run_fastlane' : 'eas/run_gradle'))
  const final = commands.findIndex(value => value.includes('security-eas-coach-test.mjs finalize'))
  const upload = commands.findIndex(value => value === 'eas/find_and_upload_build_artifacts')
  assert.ok(setup > 0 && setup < prebuild && prebuild < nativeBuild && nativeBuild < final && final < upload)
  assert.match(commands[setup], /npm ci --ignore-scripts/)
  assert.match(commands[setup], /security-eas-coach-test\.mjs provision/)
  assert.ok(commands.slice(setup + 1, prebuild).some(value => value.includes('security-eas-coach-test.mjs verify')))
  assert.ok(commands.slice(prebuild + 1, nativeBuild).filter(value => value.includes('security-eas-coach-test.mjs verify')).length >= (platform === 'ios' ? 2 : 1))
  assert.ok(commands.slice(prebuild + 1, nativeBuild).some(value => value.includes('security-eas-coach-test.mjs capture')))
})
