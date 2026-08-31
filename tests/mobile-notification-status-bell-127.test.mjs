import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  getMobileNotificationIndicator,
  MOBILE_SETTING_LOAD_STATES,
} from '../apps/mobile-core/src/deviceSettingsCore.js'
import { getMobileIconName } from '../apps/mobile-core/src/mobileIconSystem.js'

const readyState = {
  detailLevel: 'minimal',
  enabled: true,
  permissionGranted: true,
  registered: true,
}

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('notification bell is on only when preference, permission, and installation are ready', () => {
  const indicator = getMobileNotificationIndicator(readyState, MOBILE_SETTING_LOAD_STATES.READY)
  assert.equal(indicator.enabled, true)
  assert.equal(getMobileIconName(indicator.iconKey), 'notifications')

  for (const state of [
    { ...readyState, enabled: false },
    { ...readyState, permissionGranted: false },
    { ...readyState, registered: false },
    { ...readyState, detailLevel: 'off' },
    { ...readyState, preferenceEnabled: false },
  ]) {
    const unavailable = getMobileNotificationIndicator(state, MOBILE_SETTING_LOAD_STATES.READY)
    assert.equal(unavailable.enabled, false)
    assert.equal(getMobileIconName(unavailable.iconKey), 'notifications-off')
  }
})

test('notification bell exposes checking and last-confirmed states accessibly', () => {
  const checking = getMobileNotificationIndicator(null, MOBILE_SETTING_LOAD_STATES.LOADING)
  assert.equal(checking.enabled, false)
  assert.equal(getMobileIconName(checking.iconKey), 'notifications-none')
  assert.match(checking.accessibilityLabel, /Checking notification status/)

  const stale = getMobileNotificationIndicator(readyState, MOBILE_SETTING_LOAD_STATES.STALE)
  assert.equal(stale.enabled, false)
  assert.equal(getMobileIconName(stale.iconKey), 'notifications-off')
  assert.match(stale.accessibilityLabel, /last confirmed/)
})

test('Coach and Parent headers use the shared status bell and focus Notifications settings', async () => {
  const [coachApp, parentApp] = await Promise.all([
    readSource('../apps/coach-mobile/App.js'),
    readSource('../apps/parent-mobile/App.js'),
  ])

  for (const source of [coachApp, parentApp]) {
    assert.match(source, /function NotificationStatusButton/)
    assert.match(source, /getMobileNotificationIndicator\(notificationState, notificationStateStatus\)/)
    assert.match(source, /accessibilityHint="Opens the Notifications section in Settings"/)
    assert.match(source, /notificationStatusButton: \{ alignItems: 'center', height: 44, justifyContent: 'center', width: 44 \}/)
    assert.match(source, /onLayout=\{\(event\) => setNotificationSectionY\(event\.nativeEvent\.layout\.y\)\}/)
  }

  assert.match(coachApp, /if \(navigate\('settings'\)\)/)
  assert.match(coachApp, /onNotificationSettingsFocus\(notificationSectionY\)/)
  assert.match(parentApp, /setMoreSection\('settings'\)[\s\S]*setActiveTab\('more'\)/)
  assert.match(parentApp, /onNotificationSettingsFocus\(settingsRootY \+ notificationSectionY\)/)
})
