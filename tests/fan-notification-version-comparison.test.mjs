import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeParentNotificationPermission } from '../apps/mobile-core/src/parentNotificationsCore.js'
import { shouldRestoreCoachNotificationRegistration } from '../apps/mobile-core/src/coachNotificationsCore.js'
import { resolveCoachMobileRegistrationPreference } from '../netlify/functions/lib/_coach-mobile-notification-preference.js'

test('Parent server revocation remains off despite OS permission and the retained detail level', () => {
  const state = mergeParentNotificationPermission({ registered: false, enabled: false }, { permissionGranted: true, permissionStatus: 'granted' }, 'detailed')
  assert.equal(state.enabled, false)
  assert.equal(state.detailLevel, 'detailed')
  assert.equal(state.permissionGranted, true)
})

test('Coach healthy server registration does not request startup registration repair', () => {
  assert.equal(shouldRestoreCoachNotificationRegistration({ registered: true, enabled: true, detailLevel: 'detailed', permissionGranted: true }), false)
  assert.equal(shouldRestoreCoachNotificationRegistration({ registered: false, detailLevel: 'detailed', permissionGranted: true, requiresRegistrationRefresh: true }), true)
})

test('Coach silent preserve excludes a revoked registration from preserved opt-in', () => {
  assert.deepEqual(resolveCoachMobileRegistrationPreference({ existing: { status: 'revoked', enabled: false, detail_level: 'detailed' }, mode: 'preserve', requestedDetailLevel: 'detailed' }), { detailLevel: 'detailed', enabled: false })
})
