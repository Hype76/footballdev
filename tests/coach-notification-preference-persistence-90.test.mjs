import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  resolveCoachMobileRegistrationIdentity,
  resolveCoachMobileRegistrationPreference,
} from '../netlify/functions/lib/_coach-mobile-notification-preference.js'
import { shouldRestoreCoachNotificationRegistration } from '../apps/mobile-core/src/coachNotificationsCore.js'

test('silent Coach registration preserves the database notification choice', () => {
  assert.deepEqual(resolveCoachMobileRegistrationPreference({
    existing: { detail_level: 'detailed', enabled: true, status: 'active' },
    mode: 'preserve',
    requestedDetailLevel: 'off',
  }), { detailLevel: 'detailed', enabled: true })

  assert.deepEqual(resolveCoachMobileRegistrationPreference({
    existing: { detail_level: 'off', enabled: false, status: 'active' },
    mode: 'preserve',
    requestedDetailLevel: 'minimal',
  }), { detailLevel: 'off', enabled: false })
})

test('only an explicit Coach enable changes an existing off preference', () => {
  assert.deepEqual(resolveCoachMobileRegistrationPreference({
    existing: { detail_level: 'off', enabled: false, status: 'active' },
    mode: 'enable',
    requestedDetailLevel: 'off',
  }), { detailLevel: 'minimal', enabled: true })
})

test('silent registration never opts in a device without an existing server preference', () => {
  assert.deepEqual(resolveCoachMobileRegistrationPreference({
    existing: null,
    mode: 'preserve',
    requestedDetailLevel: 'detailed',
  }), { detailLevel: 'detailed', enabled: false })
})

test('Coach registration reuses the same-account installation behind a stable push token', () => {
  const tokenInstallation = {
    auth_user_id: 'user-1',
    detail_level: 'detailed',
    enabled: true,
    installation_id: 'server-installation',
    status: 'active',
  }
  assert.deepEqual(resolveCoachMobileRegistrationIdentity({
    authUserId: 'user-1',
    existing: null,
    requestedInstallationId: 'new-local-installation',
    tokenInstallation,
  }), {
    installationId: 'server-installation',
    preferenceSource: tokenInstallation,
  })
  assert.deepEqual(resolveCoachMobileRegistrationIdentity({
    authUserId: 'user-2',
    existing: null,
    requestedInstallationId: 'new-local-installation',
    tokenInstallation,
  }), {
    installationId: 'new-local-installation',
    preferenceSource: null,
  })
})

test('Coach restores only an authorised notification choice that needs registration repair', () => {
  assert.equal(shouldRestoreCoachNotificationRegistration({
    detailLevel: 'detailed',
    permissionGranted: true,
    requiresRegistrationRefresh: true,
  }), true)
  assert.equal(shouldRestoreCoachNotificationRegistration({
    detailLevel: 'off',
    permissionGranted: true,
    requiresRegistrationRefresh: true,
  }), false)
  assert.equal(shouldRestoreCoachNotificationRegistration({
    detailLevel: 'detailed',
    permissionGranted: false,
    requiresRegistrationRefresh: true,
  }), false)
  assert.equal(shouldRestoreCoachNotificationRegistration({
    detailLevel: 'detailed',
    permissionGranted: true,
    requiresPreferenceRefresh: true,
  }), true)
  assert.equal(shouldRestoreCoachNotificationRegistration({
    detailLevel: 'off',
    permissionGranted: true,
    requiresPreferenceRefresh: true,
  }), false)
})

test('Coach app keeps context refresh separate from the saved notification choice', async () => {
  const [app, notifications, api] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/notifications.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/coach-mobile-push-installation.js', import.meta.url), 'utf8'),
  ])

  assert.match(app, /const preservePreference = options\?\.preservePreference === undefined \? silent : options\.preservePreference === true/)
  assert.match(app, /Restoring the saved notification setting for this device\./)
  assert.match(app, /shouldRestoreCoachNotificationRegistration\(next\)/)
  assert.match(app, /preservePreference: next\?\.requiresPreferenceRefresh !== true/)
  assert.match(notifications, /enabled: Boolean\(server\.enabled && permission\.permissionGranted\)/)
  assert.doesNotMatch(notifications, /server\.enabled && permission\.permissionGranted && !requiresContextRefresh/)
  assert.match(notifications, /server\.registered[\s\S]*server\.enabled !== true[\s\S]*permission\.permissionGranted[\s\S]*detailLevel !== 'off'/)
  assert.match(notifications, /preferenceMode: preservePreference \? 'preserve' : 'enable'/)
  assert.match(notifications, /isCoachInstallationId\(current\)/)
  assert.match(notifications, /setInstallationId\(apiBaseUrl, installation\.installationId\)/)
  assert.match(api, /resolveCoachMobileRegistrationPreference/)
  assert.match(api, /resolveCoachMobileRegistrationIdentity/)
  assert.match(api, /\.eq\('expo_push_token', expoPushToken\)/)
})
