import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  MOBILE_SETTING_LOAD_STATES,
  preserveMobileNotificationState,
  shouldClearMobileDevicePreferences,
} from '../apps/mobile-core/src/deviceSettingsCore.js'

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

test('startup cleanup preserves existing preferences when only the ownership marker is missing', async () => {
  const [parentStartup, coachStartup] = await Promise.all([
    readSource('../apps/parent-mobile/src/startup.js'),
    readSource('../apps/coach-mobile/src/startup.js'),
  ])
  for (const source of [parentStartup, coachStartup]) {
    assert.match(source, /shouldClearMobileDevicePreferences\(ownership\.status\)/)
  }
})
