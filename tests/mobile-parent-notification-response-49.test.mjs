import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  getParentNotificationResponseValue,
  parentNotificationActionIds,
  parentNotificationResponseCategoryId,
  resolveParentNotificationOpen,
} from '../apps/mobile-core/src/parentNotificationsCore.js'

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('availability notification resolves to one exact Parent invitation', () => {
  const invitationId = 'match:00000000-0000-4000-8000-000000000049'
  const destination = resolveParentNotificationOpen({
    app: 'parent',
    invitationId,
    route: 'invites',
  }, { invites: [invitationId] })

  assert.deepEqual(destination, { tab: 'invites', targetId: invitationId })
  assert.equal(parentNotificationResponseCategoryId, 'parent-response')
})

test('notification action buttons map to server invitation response values', () => {
  assert.equal(getParentNotificationResponseValue(parentNotificationActionIds.available, 'match_attendance'), 'available')
  assert.equal(getParentNotificationResponseValue(parentNotificationActionIds.unavailable, 'match_attendance'), 'unavailable')
  assert.equal(getParentNotificationResponseValue(parentNotificationActionIds.maybe, 'match_attendance'), 'maybe')
  assert.equal(getParentNotificationResponseValue(parentNotificationActionIds.available, 'match_role'), 'yes')
  assert.equal(getParentNotificationResponseValue(parentNotificationActionIds.unavailable, 'match_role'), 'no')
  assert.equal(getParentNotificationResponseValue(parentNotificationActionIds.maybe, 'match_role'), '')
})

test('Parent app registers actions, focuses requests and revalidates before saving', async () => {
  const [app, notifications, screens] = await Promise.all([
    readSource('apps/parent-mobile/App.js'),
    readSource('apps/parent-mobile/src/notifications.js'),
    readSource('apps/parent-mobile/src/ParentPortalScreens.js'),
  ])

  assert.match(notifications, /setNotificationCategoryAsync\(parentNotificationResponseCategoryId/)
  assert.match(notifications, /opensAppToForeground: true/)
  assert.match(app, /resolveParentNotificationLinkId/)
  assert.match(app, /resolveParentNotificationOpen/)
  assert.match(app, /getParentNotificationResponseValue\(actionIdentifier, targetInvitation\.invitationType\)/)
  assert.match(app, /respondToParentInvitation\(selectedMobileUser, targetInvitation, directResponseValue\)/)
  assert.match(app, /setFocusedInvitationId\(destination\.tab === 'invites'/)
  assert.match(app, /setSelectedPollId\(destination\.tab === 'polls'/)
  assert.match(screens, /focusedInvitationId \? 'Reply to this request' : 'Invites'/)
  assert.match(app, /focusedPoll \? \[focusedPoll\] : \[\]/)
})

test('Parent push payloads contain precise link and target identifiers', async () => {
  const [matchPush, parentPush] = await Promise.all([
    readSource('netlify/functions/send-match-day-push.js'),
    readSource('netlify/functions/send-parent-mobile-push.js'),
  ])

  assert.match(parentPush, /messageId: log\.id/)
  assert.match(parentPush, /invitationId: `match:\$\{request\.id\}`/)
  assert.match(parentPush, /route: 'invites'/)
  assert.match(parentPush, /categoryId: 'parent-response'/)
  assert.match(parentPush, /parentLinkId: payload\.data\.parentLinkId \|\| device\.parent_link_id/)
  assert.match(matchPush, /parentLinkId: device\.parent_link_id/)
})

test('sessions auto refresh only while active and updates use a guarded production channel', async () => {
  const [auth, config, eas, packageJson] = await Promise.all([
    readSource('apps/mobile-core/src/auth.js'),
    readSource('apps/mobile-core/appConfig.cjs'),
    readSource('apps/parent-mobile/eas.json').then(JSON.parse),
    readSource('apps/parent-mobile/package.json').then(JSON.parse),
  ])

  assert.match(auth, /supabase\.auth\.startAutoRefresh\(\)/)
  assert.match(auth, /supabase\.auth\.stopAutoRefresh\(\)/)
  assert.match(config, /https:\/\/u\.expo\.dev\/\$\{environment\.easProjectId\}/)
  assert.equal(packageJson.dependencies['expo-updates'], '~29.0.18')
  assert.equal(eas.build['store-live'].channel, 'production')
  assert.equal(eas.build['internal-live'].channel, 'production')
})

test('Ref 49 allows only the bounded Parent store build and submit paths', async () => {
  const [buildGuard, submitGuard] = await Promise.all([
    readSource('apps/scripts/mobile-build-guard.mjs'),
    readSource('apps/scripts/mobile-submit-guard.mjs'),
  ])

  assert.match(buildGuard, /FP-MOBILE-PARENT-NOTIFICATION-RESPONSE-49/)
  assert.match(buildGuard, /currentStoreAndroid/)
  assert.match(submitGuard, /FP-MOBILE-PARENT-NOTIFICATION-RESPONSE-49/)
  assert.doesNotMatch(buildGuard, /appRole === 'coach'[\s\S]*FP-MOBILE-PARENT-NOTIFICATION-RESPONSE-49/)
})
