import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildCoachPollClosesAt, hasUsableCoachPhase31ECache, sanitizeCoachChatOfflineValue } from '../apps/mobile-core/src/coachPhase31ECore.js'
import { getNamedParentFormationPlayers, getParentFormationPitchPercent } from '../apps/mobile-core/src/parentFormationBoardCore.js'
import { countUnreadNonChatNotifications, prepareParentNotificationInbox } from '../apps/mobile-core/src/parentNotificationInboxCore.js'
import { getParentAppBadgeUpdate, mergeParentNotificationPermission } from '../apps/mobile-core/src/parentNotificationsCore.js'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('Parent Home shows one unread Chat card per exact room', () => {
  const notifications = prepareParentNotificationInbox([
    { id: 'new-parent', intentType: 'parent_chat', data: { route: 'chat', roomId: 'parent-1' }, title: 'Parent Chat' },
    { id: 'old-parent', intentType: 'parent_chat', data: { route: 'chat', roomId: 'parent-1' }, title: 'Parent Chat' },
    { id: 'team', intentType: 'parent_chat', data: { route: 'chat', roomId: 'team-1' }, title: 'Team Chat' },
    { id: 'poll', intentType: 'parent_poll', data: { route: 'polls' }, title: 'Poll' },
  ])

  assert.deepEqual(notifications.map((item) => item.id), ['new-parent', 'team', 'poll'])
  assert.deepEqual(notifications[0].notificationIds, ['new-parent', 'old-parent'])
  assert.equal(notifications[0].groupedCount, 2)
})

test('Parent badge counts Chat once through the canonical room unread count', () => {
  const notifications = [
    { id: 'chat-1', intentType: 'parent_chat', isRead: false, data: { route: 'chat', roomId: 'room-1' } },
    { id: 'chat-2', intentType: 'parent_chat', isRead: false, data: { route: 'chat', roomId: 'room-1' } },
    { id: 'poll-1', intentType: 'parent_poll', isRead: false, data: { route: 'polls' } },
  ]
  assert.equal(countUnreadNonChatNotifications(notifications), 1)
})

test('a transient device permission read cannot turn off the saved Parent notification preference', () => {
  const state = mergeParentNotificationPermission(
    { detailLevel: 'detailed', enabled: true, registered: true },
    { permissionGranted: false, permissionStatus: 'denied' },
  )
  assert.equal(state.enabled, true)
  assert.equal(state.detailLevel, 'detailed')
})

test('the Parent app does not clear its icon badge before authentication and resource hydration', () => {
  assert.equal(getParentAppBadgeUpdate({ authenticated: false, resourcesLoaded: false, count: 3 }), null)
  assert.equal(getParentAppBadgeUpdate({ authenticated: true, resourcesLoaded: false, count: 3 }), null)
  assert.equal(getParentAppBadgeUpdate({ authenticated: true, resourcesLoaded: true, count: 3 }), 3)
  assert.equal(getParentAppBadgeUpdate({ authenticated: true, resourcesLoaded: true, count: 130 }), 99)
})

test('opening a grouped Chat card marks every child-scoped event in that room read', async () => {
  const [app, endpoint, offline] = await Promise.all([
    read('../apps/parent-mobile/App.js'),
    read('../netlify/functions/parent-mobile-notifications.js'),
    read('../apps/parent-mobile/src/offline.js'),
  ])
  assert.match(app, /notificationIds = Array\.isArray\(notification\?\.notificationIds\)/)
  assert.match(app, /markParentNotificationRead\(selectedMobileUser, notificationIds\)/)
  assert.match(endpoint, /\.eq\('auth_user_id', authUser\.id\)/)
  assert.match(endpoint, /\.eq\('parent_link_id', link\.id\)/)
  assert.match(endpoint, /serverNotificationIds = notificationIds\.filter/)
  assert.match(endpoint, /query = query\.in\('id', serverNotificationIds\)/)
  assert.match(offline, /normalizedNotificationIds\.has\(normalize\(notification\.id\)\)/)
})

test('Calendar cards open the exact invitation response screen', async () => {
  const [app, screen] = await Promise.all([
    read('../apps/parent-mobile/App.js'),
    read('../apps/parent-mobile/src/ParentPortalScreens.js'),
  ])
  assert.match(screen, /accessibilityHint=\{invitation \? 'Opens this request so you can respond'/)
  assert.match(screen, /onPress=\{\(\) => invitation && onOpenInvitation\?\.\(invitation\)\}/)
  assert.match(app, /setSelectedInvitationId\(invitation\.invitationId\)/)
  assert.match(app, /setMoreSection\('invites'\)/)
})

test('Parent Formation Board uses published display names and ratio coordinates', () => {
  const named = getNamedParentFormationPlayers([
    { playerId: 'one', displayName: 'Clyde Bates', x: 0.5, y: 0.25 },
    { playerId: 'unknown', displayName: 'Player', x: 0, y: 0 },
  ])
  assert.equal(named.length, 1)
  assert.equal(named[0].parentDisplayName, 'Clyde Bates')
  assert.equal(getParentFormationPitchPercent(named[0].x), 50)
  assert.equal(getParentFormationPitchPercent(named[0].y), 25)
  assert.equal(getParentFormationPitchPercent(78), 78)
})

test('Coach Chat never treats a missing or empty privacy cache as authoritative membership', () => {
  assert.equal(hasUsableCoachPhase31ECache('chat', undefined, sanitizeCoachChatOfflineValue(undefined)), false)
  assert.equal(hasUsableCoachPhase31ECache('chat', { parent: [], staff: [] }, sanitizeCoachChatOfflineValue({ parent: [], staff: [] })), false)
  assert.equal(hasUsableCoachPhase31ECache('chat', { staff: [{ id: 'staff-room' }] }, sanitizeCoachChatOfflineValue({ staff: [{ id: 'staff-room' }] })), true)
  assert.equal(hasUsableCoachPhase31ECache('resources', { items: [] }, { items: [] }), true)
})

test('Coach Poll deadlines require a complete local date and time', () => {
  assert.equal(buildCoachPollClosesAt('', ''), '')
  assert.equal(buildCoachPollClosesAt('20-08-2026', ''), null)
  assert.match(buildCoachPollClosesAt('20-08-2026', '18:30'), /^2026-08-20T/)
})

test('Parent notification responses are consumed after the first verified handling', async () => {
  const app = await read('../apps/parent-mobile/App.js')
  assert.match(app, /Notifications\.clearLastNotificationResponseAsync\(\)/)
  assert.match(app, /consumeLastNotificationResponse\(responseId\)/)
})

test('Coach Polls expose deadlines, archive visibility, and safe deletion', async () => {
  const [screens, data] = await Promise.all([
    read('../apps/coach-mobile/src/CoachPhase31EScreens.js'),
    read('../apps/mobile-core/src/coachPhase31EData.js'),
  ])
  assert.match(screens, /label="Closing date"/)
  assert.match(screens, /Show archive/)
  assert.match(screens, /Delete Poll/)
  assert.match(data, /configure_poll_result_delivery/)
  assert.match(data, /delete_team_poll/)
})

test('Parent Poll result deep links retain closed results in a separate view', async () => {
  const [app, data, migration] = await Promise.all([
    read('../apps/parent-mobile/App.js'),
    read('../apps/mobile-core/src/data.js'),
    read('../supabase/migrations/20260818143000_parent_poll_results_history.sql'),
  ])
  assert.match(app, /label={`Results \(\$\{resultPolls\.length\}\)`}/)
  assert.match(app, /rankedResults/)
  assert.match(data, /votes: \(Array\.isArray\(row\.votes\)/)
  assert.doesNotMatch(migration, /where poll\.audience = 'parents'\s+and poll\.status/)
  assert.match(migration, /Returns child-scoped open Parent Polls and retained closed results/)
})

test('corrective 68 is authorised for both production builds and Internal Tester submissions', async () => {
  const [buildGuard, submitGuard] = await Promise.all([
    read('../apps/scripts/mobile-build-guard.mjs'),
    read('../apps/scripts/mobile-submit-guard.mjs'),
  ])
  assert.match(buildGuard, /authorisedParentProductionReferences[\s\S]*FP-PARENT-NOTIFICATION-CALENDAR-FORMATION-68/)
  assert.match(buildGuard, /authorisedCoachProductionReferences[\s\S]*FP-PARENT-NOTIFICATION-CALENDAR-FORMATION-68/)
  assert.match(submitGuard, /promotionReference === 'FP-PARENT-NOTIFICATION-CALENDAR-FORMATION-68'/)
  assert.match(submitGuard, /--groups', 'Internal Testers'/)
})
