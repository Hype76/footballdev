import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import vm from 'node:vm'
import test from 'node:test'

const require = createRequire(import.meta.url)
const file = 'apps/mobile-core/appConfig.cjs'
const source = readFileSync(file, 'utf8')
const baseline = execFileSync('git', ['show', `origin/main:${file}`], { encoding: 'utf8' })
function config(text, env = {}) {
  const context = { require, module: { exports: {} }, process: { env, cwd: () => process.cwd() } }
  vm.runInNewContext(text, context)
  return JSON.parse(JSON.stringify(context.module.exports.createMobileExpoConfig({ appRole: 'coach', name: 'Coach', version: '1.1.0' })))
}

test('native build defaults remain identical and OTA runtime requires explicit production confirmation', () => {
  assert.deepEqual(config(source), config(baseline))
  const approved = { MOBILE_OTA_RUNTIME_VERSION: '1.1.1', MOBILE_OTA_UPDATE_CONFIRMED: 'true', EXPO_PUBLIC_BUILD_PROFILE: 'store-live' }
  assert.equal(config(source, approved).expo.runtimeVersion, '1.1.1')
  for (const env of [
    { ...approved, MOBILE_OTA_UPDATE_CONFIRMED: '' },
    { ...approved, EXPO_PUBLIC_BUILD_PROFILE: 'internal' },
    { ...approved, MOBILE_EAS_REMOTE_BUILD: 'true' },
    { ...approved, MOBILE_OTA_RUNTIME_VERSION: 'unknown' },
  ]) assert.deepEqual(config(source, env).expo.runtimeVersion, { policy: 'appVersion' })
})

test('OTA guard rejects unsupported runtime and platform combinations before any external action', () => {
  for (const args of [['coach', 'android', '1.1.1'], ['parent', 'ios', '9.9.9']]) {
    const result = spawnSync(process.execPath, ['apps/scripts/mobile-update-guard.mjs', ...args], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /restricted to iOS 1\.1\.1/)
  }
})
