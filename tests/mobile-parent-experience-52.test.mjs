import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  getParentCalendarEventBucket,
  getParentCalendarMonthGrid,
  getParentCalendarWindow,
} from '../apps/mobile-core/src/parentCalendarCore.js'
import {
  getParentChatRoomContext,
  getParentAnnouncementMessages,
  getParentInvitationSections,
  prepareParentChatMessages,
  prepareParentChatRooms,
} from '../apps/parent-mobile/src/parentPresentationCore.js'

test('Parent Calendar separates actions, future dates, history and month markers', () => {
  const now = new Date('2026-08-13T10:00:00Z')
  const events = [
    { calendarDate: '2026-07-10', id: 'past', responseState: 'available', status: 'scheduled' },
    { calendarDate: '2026-08-14', id: 'needs', requiresResponse: true, status: 'scheduled' },
    { calendarDate: '2026-08-20', id: 'future', responseState: 'available', status: 'scheduled' },
    { calendarDate: '', id: 'tbc', status: 'scheduled' },
  ]
  assert.equal(getParentCalendarEventBucket(events[0], now), 'history')
  assert.equal(getParentCalendarEventBucket(events[1], now), 'needs-response')
  assert.deepEqual(getParentCalendarWindow(events, 'upcoming', now).map((item) => item.id), ['needs', 'future'])
  assert.deepEqual(getParentCalendarWindow(events, 'history', now).map((item) => item.id), ['past'])
  assert.deepEqual(getParentCalendarWindow(events, 'date-tbc', now).map((item) => item.id), ['tbc'])
  const grid = getParentCalendarMonthGrid(events, new Date(2026, 7, 1), now)
  assert.equal(grid.length, 42)
  assert.equal(grid.find((day) => day.date === '2026-08-14').needsResponse, true)
})

test('Parent requests are deduplicated, action-first and ordered nearest first', () => {
  const base = {
    canRespond: true,
    childId: 'child-1',
    invitationState: 'active',
    invitationType: 'training_attendance',
    roleType: '',
    sourceRecordId: 'training-1',
  }
  const sections = getParentInvitationSections([
    { ...base, eventDate: '2026-08-14', eventStart: '2026-08-14T18:00:00Z', invitationId: 'old', isPending: true, responseState: 'awaiting_response' },
    { ...base, eventDate: '2026-08-14', eventStart: '2026-08-14T18:00:00Z', invitationId: 'current', isPending: false, lastRespondedAt: '2026-08-13T09:00:00Z', responseState: 'available' },
    { ...base, eventDate: '2026-08-15', eventStart: '2026-08-15T18:00:00Z', invitationId: 'needs', isPending: true, sourceRecordId: 'training-2', responseState: 'awaiting_response' },
    { ...base, eventDate: '2026-07-01', eventStart: '2026-07-01T18:00:00Z', invitationId: 'past', isPending: false, sourceRecordId: 'training-3', responseState: 'available' },
  ], new Date('2026-08-13T10:00:00Z'))
  assert.deepEqual(sections.needsResponse.map((item) => item.invitationId), ['needs'])
  assert.deepEqual(sections.responded.map((item) => item.invitationId), ['current'])
  assert.deepEqual(sections.history.map((item) => item.invitationId), ['past'])
  assert.equal(sections.upcoming.filter((item) => item.sourceRecordId === 'training-1').length, 0)
})

test('Parent Chat uses newest room activity first and oldest-to-newest conversation data', () => {
  const rooms = prepareParentChatRooms([
    { id: 'older', latestMessageAt: '2026-08-10T10:00:00Z', title: 'Older room' },
    { id: 'newer', latestMessageAt: '2026-08-13T10:00:00Z', matchDate: '2026-08-20', kickoffTime: '18:30', opponent: 'United', teamName: 'U17', title: 'Match squad' },
  ], [{ authorType: 'club_staff', body: 'Club update', createdAt: '2026-08-12T10:00:00Z', id: 'announcement-1', readAt: '', senderName: 'Demo FC', source: 'club_announcement' }])
  assert.deepEqual(rooms.map((room) => room.id), ['newer', 'club-announcements', 'older'])
  assert.equal(rooms.find((room) => room.id === 'club-announcements').canPost, false)
  assert.match(getParentChatRoomContext(rooms[0]), /U17 v United/)
  const messages = prepareParentChatMessages([
    { body: 'Second', createdAt: '2026-08-13T10:01:00Z', id: '2' },
    { body: 'First', createdAt: '2026-08-13T10:00:00Z', id: '1' },
  ])
  assert.deepEqual(messages.map((message) => message.id), ['1', '2'])
})

test('Club Announcements keep the useful heading and remove delivery boilerplate', () => {
  const [message] = getParentAnnouncementMessages([{
    authorType: 'club_staff',
    body: [
      'New event added',
      'What is this event',
      'Hi Simon and Steve, the latest details for Jack Hughes are available in the Parent Portal.',
      'Team: U17 Green',
      'Type: other',
      'Starts: Sat 01 Aug 2026 at 15:00',
      'Ends: Sat 01 Aug 2026 at 16:00',
      'Venue: Football Player Stadium',
      'Notes: Where does this appear',
      'Response: No response is required. This event is informational.',
      'View event details (https://parent.footballplayer.online/parent-portal?section=calendar)',
    ].join('\n'),
    id: 'announcement-1',
    source: 'club_announcement',
    subject: 'New event added',
  }])

  assert.equal(message.body, 'New event added\nWhat is this event')
  assert.doesNotMatch(message.body, /https?:|Team:|Response:|Hi Simon/)
})

test('mobile UX wiring preserves sessions, updates automatically, deep-links responses and removes legacy Messages navigation', async () => {
  const [parentApp, screens, auth, updates, parentPackage, parentEas, notifications] = await Promise.all([
    readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/auth.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/updates.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/package.json', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/eas.json', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/notifications.js', import.meta.url), 'utf8'),
  ])
  assert.match(parentApp, /communicationPreference/)
  assert.match(parentApp, /selectedRoomId === 'club-announcements'/)
  assert.match(parentApp, /parent_accept/)
  assert.match(parentApp, /targetInvitationId/)
  assert.match(parentApp, /handleRestoreDismissedItems/)
  for (const kind of ['development', 'invitations', 'matches', 'messages', 'polls', 'resources']) {
    assert.match(parentApp, new RegExp(`handleDismissParentItem\\('${kind}'`))
  }
  assert.match(screens, /Club Announcements|prepareParentChatRooms/)
  assert.match(screens, /View or share PDF/)
  assert.doesNotMatch(screens, /\['messages', 'Messages'/)
  assert.match(auth, /\['SIGNED_OUT', 'USER_DELETED'\]\.includes\(event\)/)
  assert.match(updates, /checkForUpdateAsync/)
  assert.match(updates, /fetchUpdateAsync/)
  assert.match(parentPackage, /expo-updates/)
  assert.match(parentEas, /"channel": "production"/)
  assert.match(notifications, /setNotificationCategoryAsync\('parent-response'/)
})

test('notification fan-out retries failed app delivery without duplicating accepted email and Coach saves Formation drafts before networking', async () => {
  const [scheduled, parentPush, formation, navigation] = await Promise.all([
    readFile(new URL('../netlify/functions/process-scheduled-emails.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/send-parent-mobile-push.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachFormationBoard.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/coachNavigationCore.js', import.meta.url), 'utf8'),
  ])
  assert.match(scheduled, /markParentAppNotificationRetry/)
  assert.match(scheduled, /parent_app_notification_pending/)
  assert.match(scheduled, /markScheduledAppNotificationSent/)
  assert.match(scheduled, /type: 'training_availability'/)
  assert.match(scheduled, /metadata->>scheduledQueueId/)
  assert.match(parentPush, /This email record has no in-app destination/)
  assert.match(parentPush, /roomId: 'club-announcements'/)
  assert.match(parentPush, /getTrainingAvailabilityPayload/)
  assert.match(parentPush, /invitationId: `training_attendance:\$\{requestPlayer\.id\}`/)
  assert.match(formation, /pendingSave/)
  assert.match(formation, /saveOfflineFormation\(\{ pendingSave \}\)/)
  assert.match(formation, /const \[savedPreference, savedOffline\]/)
  assert.match(formation, /const \[nextPresets, nextBoards\]/)
  assert.match(formation, /pendingSave\?\.draft/)
  assert.match(formation, /pendingSave: unresolvedPendingSave/)
  assert.match(formation, /reconcilePendingBoard/)
  assert.match(formation, /Retry save/)
  assert.match(navigation, /label: 'Formation Boards'/)
  assert.match(navigation, /Create and manage team plans/)
})
