import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { resolveCoachMobileRegistrationPreference } from '../netlify/functions/lib/_coach-mobile-notification-preference.js'

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

test('Coach app keeps context refresh separate from the saved notification choice', async () => {
  const [app, notifications, api] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/notifications.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/coach-mobile-push-installation.js', import.meta.url), 'utf8'),
  ])

  assert.match(app, /preservePreference: silent/)
  assert.match(notifications, /enabled: Boolean\(server\.enabled && permission\.permissionGranted\)/)
  assert.doesNotMatch(notifications, /server\.enabled && permission\.permissionGranted && !requiresContextRefresh/)
  assert.match(notifications, /preferenceMode: preservePreference \? 'preserve' : 'enable'/)
  assert.match(api, /resolveCoachMobileRegistrationPreference/)
  assert.match(api, /select\('auth_user_id, detail_level, enabled, status'\)/)
})
