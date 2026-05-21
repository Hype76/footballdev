import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mobileApps } from './mobile-apps.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const failures = []

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    failures.push(`${label} expected ${expected} but got ${actual}`)
  }
}

function assertIncludes(values, expected, label) {
  if (!Array.isArray(values) || !values.includes(expected)) {
    failures.push(`${label} must include ${expected}`)
  }
}

for (const app of mobileApps) {
  const config = require(join(repoRoot, app.appConfig))
  const expo = config?.expo

  if (!expo) {
    failures.push(`${app.name} app config did not resolve an expo object`)
    continue
  }

  const appPackage = require(join(repoRoot, app.packageJson))

  assertEqual(expo.name, app.expectedName, `${app.name} resolved app name`)
  assertEqual(expo.slug, app.slug, `${app.name} resolved app slug`)
  assertEqual(expo.scheme, app.scheme, `${app.name} resolved app scheme`)
  assertEqual(expo.version, appPackage.version, `${app.name} resolved app version`)
  assertEqual(expo.runtimeVersion?.policy, 'appVersion', `${app.name} runtime version policy`)
  assertEqual(expo.ios?.bundleIdentifier, app.bundleIdentifier, `${app.name} resolved iOS bundle identifier`)
  assertEqual(expo.ios?.buildNumber, '1', `${app.name} resolved iOS build number`)
  assertEqual(expo.ios?.supportsTablet, false, `${app.name} resolved iOS tablet setting`)
  assertEqual(expo.ios?.infoPlist?.ITSAppUsesNonExemptEncryption, false, `${app.name} resolved encryption setting`)
  assertEqual(expo.android?.package, app.packageName, `${app.name} resolved Android package`)
  assertEqual(expo.android?.versionCode, 1, `${app.name} resolved Android version code`)
  assertEqual(expo.extra?.appRole, app.appRole, `${app.name} resolved app role`)
  assertEqual(expo.extra?.supabaseEnvironment, 'test', `${app.name} resolved Supabase environment`)
  assertEqual(expo.extra?.allowLiveSupabase, 'false', `${app.name} resolved live Supabase gate`)
  assertEqual(expo.plugins?.[0]?.[0], 'expo-notifications', `${app.name} notification plugin`)
  assertEqual(expo.plugins?.[0]?.[1]?.defaultChannel, 'matchday', `${app.name} notification channel`)
  assertEqual(expo.plugins?.[0]?.[1]?.icon, './assets/notification-icon.png', `${app.name} notification icon`)
  assertIncludes(expo.android?.permissions, 'POST_NOTIFICATIONS', `${app.name} Android permissions`)
  assertIncludes(expo.android?.permissions, 'USE_BIOMETRIC', `${app.name} Android permissions`)
  assertIncludes(expo.android?.permissions, 'USE_FINGERPRINT', `${app.name} Android permissions`)
  assertIncludes(expo.android?.blockedPermissions, 'android.permission.CAMERA', `${app.name} Android blocked permissions`)
  assertIncludes(expo.android?.blockedPermissions, 'android.permission.RECORD_AUDIO', `${app.name} Android blocked permissions`)
  assertIncludes(expo.android?.blockedPermissions, 'android.permission.ACCESS_FINE_LOCATION', `${app.name} Android blocked permissions`)
}

if (failures.length > 0) {
  console.error('Mobile config check failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('Mobile config check passed.')
