import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  MOBILE_SETTING_LOAD_STATES,
  preserveMobileNotificationState,
  shouldClearMobileDevicePreferences,
} from '../apps/mobile-core/src/deviceSettingsCore.js'
import { isCoachInstallationOwnershipConflict } from '../apps/mobile-core/src/coachNotificationsCore.js'

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('transient notification errors preserve the last confirmed state', () => {
  const current = {
    detailLevel: 'detailed',
    enabled: true,
    permissionGranted: true,
    registered: true,
  }

  assert.deepEqual(preserveMobileNotificationState(current, 'Could not refresh.'), {
    ...current,
    message: 'Could not refresh.',
  })
  assert.equal(preserveMobileNotificationState(null, 'Could not refresh.'), null)
  assert.equal(MOBILE_SETTING_LOAD_STATES.STALE, 'stale')
})

test('first boot preserves device preferences while an environment mismatch clears them', () => {
  assert.equal(shouldClearMobileDevicePreferences('first_boot'), false)
  assert.equal(shouldClearMobileDevicePreferences('ready'), false)
  assert.equal(shouldClearMobileDevicePreferences('incompatible'), true)
})

test('shared Auth uses the supported React Native auto-refresh path without a second manual refresh', async () => {
  const source = await readSource('../apps/mobile-core/src/auth.js')
  assert.match(source, /supabase\.auth\.startAutoRefresh\(\)/)
  assert.match(source, /supabase\.auth\.stopAutoRefresh\(\)/)
  assert.doesNotMatch(source, /supabase\.auth\.refreshSession\(\)/)
})

test('Coach and Parent use the coordinated Supabase Auth release', async () => {
  const [coachPackage, parentPackage, coachLock, parentLock] = await Promise.all([
    readSource('../apps/coach-mobile/package.json').then(JSON.parse),
    readSource('../apps/parent-mobile/package.json').then(JSON.parse),
    readSource('../apps/coach-mobile/package-lock.json').then(JSON.parse),
    readSource('../apps/parent-mobile/package-lock.json').then(JSON.parse),
  ])
  for (const [manifest, lock] of [[coachPackage, coachLock], [parentPackage, parentLock]]) {
    assert.equal(manifest.dependencies['@supabase/supabase-js'], '2.110.8')
    assert.equal(lock.packages['node_modules/@supabase/supabase-js'].version, '2.110.8')
    assert.equal(lock.packages['node_modules/@supabase/auth-js'].version, '2.110.8')
  }
})

test('Parent settings do not display an unconfirmed off state', async () => {
  const source = await readSource('../apps/parent-mobile/App.js')
  assert.match(source, /preserveMobileNotificationState\(current, message\)/)
  assert.match(source, /The last confirmed setting is shown and has not been changed\./)
  assert.match(source, /Retry biometric check/)
  assert.match(source, /Retry notification check/)
  assert.doesNotMatch(source, /setNotificationState\(\(current\) => \(\{ \.\.\.current, enabled: false/)
  assert.match(source, /void initializeParentNotifications\(\)\.catch\(\(\) => \{\}\)/)
})

test('Coach settings preserve known values and expose explicit retry states', async () => {
  const source = await readSource('../apps/coach-mobile/App.js')
  const controls = await readSource('../apps/mobile-core/src/deviceControls.js')
  assert.match(source, /preserveMobileNotificationState\(current, getCoachPushSetupFailureMessage\(error\)\)/)
  assert.match(source, /Refresh notification status/)
  assert.match(source, /The last confirmed setting is shown and has not been changed\./)
  assert.doesNotMatch(source, /setNotificationState\(\(current\) => \(\{ \.\.\.\(current \|\| \{\}\), enabled: false/)
  assert.match(controls, /biometricStateStatus/)
  assert.match(controls, /refreshBiometricState/)
  assert.match(controls, /await refreshNotificationState\(\)/)
})

test('Coach notification recovery rotates only an installation owned by another account', async () => {
  assert.equal(isCoachInstallationOwnershipConflict({ code: 'COACH_MOBILE_INSTALLATION_OWNED' }), true)
  assert.equal(isCoachInstallationOwnershipConflict({ code: 'coach_mobile_installation_owned' }), true)
  assert.equal(isCoachInstallationOwnershipConflict({ code: 'COACH_MOBILE_CONTEXT_DENIED', status: 403 }), false)
  assert.equal(isCoachInstallationOwnershipConflict({ code: 'COACH_MOBILE_HTTP_403', status: 403 }), false)

  const source = await readSource('../apps/coach-mobile/src/notifications.js')
  assert.match(source, /result\.code \|\| result\.error \|\| `COACH_MOBILE_HTTP_\$\{response\.status\}`/)
  assert.match(source, /if \(!isCoachInstallationOwnershipConflict\(error\)\) throw safeError\(error, 'api'\)/)
  assert.match(source, /installationId = await rotateInstallationId\(apiBaseUrl\)[\s\S]*result = await register\(installationId\)/)
})

test('startup cleanup preserves existing preferences when only the ownership marker is missing', async () => {
  const [parentStartup, coachStartup] = await Promise.all([
    readSource('../apps/parent-mobile/src/startup.js'),
    readSource('../apps/coach-mobile/src/startup.js'),
  ])
  for (const source of [parentStartup, coachStartup]) {
    assert.match(source, /shouldClearMobileDevicePreferences\(ownership\.status\)/)
  }
})
