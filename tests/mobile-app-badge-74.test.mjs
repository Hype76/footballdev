import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  getMobileAppBadgeCount,
  getMobileAppBadgeStorageKey,
  normalizeMobileAppBadgeEnabled,
} from '../apps/mobile-core/src/appBadgeCore.js'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('app icon badge preference defaults on and remains isolated by app role', () => {
  assert.equal(normalizeMobileAppBadgeEnabled(null), true)
  assert.equal(normalizeMobileAppBadgeEnabled('enabled'), true)
  assert.equal(normalizeMobileAppBadgeEnabled('disabled'), false)
  assert.equal(normalizeMobileAppBadgeEnabled(false), false)
  assert.equal(getMobileAppBadgeStorageKey('parent'), 'fp.mobile.app-badge.v1.parent.enabled')
  assert.equal(getMobileAppBadgeStorageKey('coach'), 'fp.mobile.app-badge.v1.coach.enabled')
  assert.throws(() => getMobileAppBadgeStorageKey('unknown'), /app_badge_role_invalid/)
})

test('app icon badge count is cleared when disabled and clamped when enabled', () => {
  assert.equal(getMobileAppBadgeCount({ count: 17, enabled: false }), 0)
  assert.equal(getMobileAppBadgeCount({ count: -2, enabled: true }), 0)
  assert.equal(getMobileAppBadgeCount({ count: 42.9, enabled: true }), 42)
  assert.equal(getMobileAppBadgeCount({ count: 140, enabled: true }), 99)
  assert.equal(getMobileAppBadgeCount({ count: 'unknown', enabled: true }), 0)
})

test('Parent and Coach use the saved badge preference for foreground notifications and settings', async () => {
  const [parentApp, coachApp, parentNotifications, coachNotifications, badgeRuntime] = await Promise.all([
    read('../apps/parent-mobile/App.js'),
    read('../apps/coach-mobile/App.js'),
    read('../apps/parent-mobile/src/notifications.js'),
    read('../apps/coach-mobile/src/notifications.js'),
    read('../apps/mobile-core/src/appBadge.js'),
  ])

  assert.match(parentApp, /App icon badge/)
  assert.match(parentApp, /syncMobileAppBadge\(\{ appRole: 'parent'/)
  assert.match(coachApp, /App icon badge/)
  assert.match(coachApp, /syncMobileAppBadge\(\{ appRole: 'coach'/)
  assert.match(parentNotifications, /shouldSetBadge: await readMobileAppBadgeEnabled\('parent'\)/)
  assert.match(coachNotifications, /shouldSetBadge: await readMobileAppBadgeEnabled\('coach'\)/)
  assert.match(badgeRuntime, /setBadgeCountAsync\(0\)/)
})
