import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  allowsParentAppNotifications,
  allowsParentEmail,
  normalizeParentCommunicationChannel,
} from '../netlify/functions/lib/_parent-communication-preferences.js'

test('Parent communication choices default to both and route each channel safely', () => {
  assert.equal(normalizeParentCommunicationChannel('unknown'), 'both')
  assert.equal(allowsParentAppNotifications('app'), true)
  assert.equal(allowsParentAppNotifications('email'), false)
  assert.equal(allowsParentEmail('email'), true)
  assert.equal(allowsParentEmail('app'), false)
  assert.equal(allowsParentEmail('both'), true)
})

test('Parent web Settings, scheduled email and push delivery use the shared preference', async () => {
  const [portal, endpoint, scheduled, parentPush, matchPush, migration] = await Promise.all([
    readFile(new URL('../src/pages/ParentPortalPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/parent-communication-preferences.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/process-scheduled-emails.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/send-parent-mobile-push.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/send-match-day-push.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260812103411_matchday_parent_notification_repair.sql', import.meta.url), 'utf8'),
  ])
  assert.match(portal, /Communication choice/)
  assert.match(portal, /App notifications/)
  assert.match(portal, /Email/)
  assert.match(portal, /Both/)
  assert.match(endpoint, /An active Parent link is required/)
  assert.match(scheduled, /resolveScheduledParentCommunicationChannel/)
  assert.match(parentPush, /filterParentLinksForAppNotifications/)
  assert.match(matchPush, /filterParentLinksForAppNotifications/)
  assert.match(migration, /create table if not exists public\.parent_communication_preferences/)
  assert.doesNotMatch(migration, /grant .*parent_communication_preferences.*authenticated/i)
})
