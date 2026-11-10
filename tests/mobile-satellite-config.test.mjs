import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { mobileApps } from '../apps/scripts/mobile-apps.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const satelliteMetadata = 'android.telephony.PROPERTY_SATELLITE_DATA_OPTIMIZED'
const satelliteCategory = 'com.apple.developer.networking.carrier-constrained.appcategory'

test('satellite plugin replaces stale entries without duplicates or unrelated manifest changes', async () => {
  const require = createRequire(import.meta.url)
  const withSatellite = require('../apps/mobile-core/plugins/withSatellite.cjs')
  const config = withSatellite({
    android: { package: mobileApps[0].packageName },
    _internal: { projectRoot: resolve(repoRoot, mobileApps[0].path) },
  })
  const unrelated = { $: { 'android:name': 'existing.setting', 'android:value': 'keep' } }
  const manifest = { manifest: { application: [{ $: { 'android:name': '.MainApplication' }, 'meta-data': [
    unrelated,
    { $: { 'android:name': satelliteMetadata, 'android:value': 'old.package' } },
    { $: { 'android:name': satelliteMetadata, 'android:resource': '@string/old_package' } },
  ] }] } }
  let result = { ...config, modRequest: {}, modResults: manifest }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    result = await config.mods.android.manifest(result)
    assert.deepEqual(result.modResults.manifest.application[0]['meta-data'], [
      unrelated,
      { $: { 'android:name': satelliteMetadata, 'android:value': mobileApps[0].packageName } },
    ])
  }

  await assert.rejects(config.mods.android.manifest({ ...result, android: {} }), /package name/)
})

for (const app of mobileApps) {
  test(`${app.name} generates satellite settings in its native manifest and entitlements`, () => {
    const projectRoot = resolve(repoRoot, app.path)
    const require = createRequire(resolve(projectRoot, 'package.json'))
    const expoCli = resolve(dirname(require.resolve('expo/package.json')), 'bin/cli')
    const output = execFileSync(process.execPath, [expoCli, 'config', '--type', 'introspect', '--json'], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 90000,
      env: { ...process.env, EXPO_NO_DOTENV: '1', MOBILE_EAS_REMOTE_BUILD: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const config = JSON.parse(output)
    const native = config._internal.modResults
    const application = native.android.manifest.manifest.application[0]
    const entries = application['meta-data'].filter((entry) => entry.$['android:name'] === satelliteMetadata)

    assert.equal(entries.length, 1)
    assert.equal(entries[0].$['android:value'], app.packageName)
    assert.deepEqual(native.ios.entitlements[satelliteCategory], ['sports-8019'])
    assert.equal(native.ios.entitlements['com.apple.developer.networking.carrier-constrained.app-optimized'], undefined)
    assert.equal(native.ios.entitlements['com.apple.developer.networking.satellite'], undefined)
    assert.equal(application['meta-data'].find((entry) => entry.$['android:name'] === 'com.google.firebase.messaging.default_notification_channel_id').$['android:value'], 'matchday')
    const permissions = native.android.manifest.manifest['uses-permission'].map((entry) => entry.$['android:name'])
    assert.ok(permissions.includes('android.permission.POST_NOTIFICATIONS'))
    assert.ok(permissions.includes('android.permission.USE_BIOMETRIC'))
    assert.equal(config.ios.bundleIdentifier, app.bundleIdentifier)
    assert.equal(native.ios.infoPlist.ITSAppUsesNonExemptEncryption, false)
    assert.ok(native.ios.infoPlist.NSFaceIDUsageDescription.includes('Face ID'))
  })
}
