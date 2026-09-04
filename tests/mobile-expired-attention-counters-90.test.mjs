import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildCoachHomeOperationalSnapshot, countPendingCoachAvailability } from '../apps/mobile-core/src/coachPhase31GCore.js'
import { getParentHomeModel } from '../apps/parent-mobile/src/parentExperience.js'
import { getParentInvitationSections } from '../apps/parent-mobile/src/parentPresentationCore.js'
import {
  isCurrentMatchNotificationReference,
  isCurrentParentPollReference,
  isCurrentTrainingNotificationReference,
} from '../netlify/functions/lib/_parent-notification-validity.js'

const now = new Date('2026-08-24T13:00:00Z')

test('Parent poll and invitation counters exclude expired and past items', () => {
  const home = getParentHomeModel({
    calendarEvents: [],
    matches: [],
    messages: [],
    now,
    polls: [
      { closesAt: '2026-08-24T12:59:59Z', currentOptionIds: [], id: 'expired', status: 'open' },
      { closesAt: '2026-08-24T14:00:00Z', currentOptionIds: [], id: 'active', status: 'open' },
      { closesAt: '', currentOptionIds: [], id: 'closed', status: 'closed' },
    ],
  })
  const invitations = getParentInvitationSections([
    { canRespond: true, childId: 'c1', eventDate: '2026-08-23', invitationId: 'past', invitationState: 'active', invitationType: 'match_attendance', isPending: true },
    { canRespond: true, childId: 'c1', eventDate: '2026-08-25', invitationId: 'expired', invitationState: 'expired', invitationType: 'match_attendance', isPending: true },
    { canRespond: true, childId: 'c1', eventDate: '2026-08-25', invitationId: 'active', invitationState: 'active', invitationType: 'match_attendance', isPending: true },
  ], now)

  assert.equal(home.unansweredPolls, 1)
  assert.equal(home.activePoll.id, 'active')
  assert.equal(invitations.needsResponse.length, 1)
  assert.equal(invitations.needsResponse[0].invitationId, 'active')
})

test('Coach attention counters exclude expired requests and polls', () => {
  const rows = [
    { eventDate: '2026-08-25', eventId: 'match-active', expiresAt: '2026-08-25T12:00:00Z', kind: 'match', playerId: 'p1', sentAt: '2026-08-23T10:00:00Z', status: 'pending' },
    { eventDate: '2026-08-23', eventId: 'match-past', expiresAt: '2026-08-25T12:00:00Z', kind: 'match', playerId: 'p2', sentAt: '2026-08-23T10:00:00Z', status: 'pending' },
    { eventAt: '2026-08-25T12:00:00Z', eventId: 'training-expired', expiresAt: '2026-08-24T12:00:00Z', kind: 'training', playerId: 'p3', sentAt: '2026-08-23T10:00:00Z', status: 'pending' },
  ]
  const snapshot = buildCoachHomeOperationalSnapshot({
    invites: { all: rows },
    now,
    polls: [
      { closesAt: '2026-08-24T12:00:00Z', status: 'open' },
      { closesAt: '2026-08-24T14:00:00Z', status: 'open' },
    ],
  })

  assert.equal(countPendingCoachAvailability(rows, now), 1)
  assert.equal(snapshot.pendingAvailability, 1)
  assert.equal(snapshot.activePolls, 1)
})

test('notification inbox validity requires actionable unexpired source records', () => {
  const nowTime = now.getTime()
  const currentMatch = {
    expires_at: '2026-08-25T13:00:00Z',
    match_days: { match_date: '2026-08-25', status: 'scheduled' },
    parent_link_id: 'link-1',
    status: 'pending',
  }
  const currentTraining = {
    parent_link_id: 'link-1',
    recipient_type: 'parent',
    response_deadline_at: '2026-08-24T14:00:00Z',
    status: 'sent',
    training_availability_requests: { occurrence_starts_at: '2026-08-24T19:00:00Z', status: 'sent' },
  }

  assert.equal(isCurrentMatchNotificationReference(currentMatch, 'link-1', nowTime, '2026-08-24'), true)
  assert.equal(isCurrentMatchNotificationReference({ ...currentMatch, expires_at: '2026-08-24T12:00:00Z' }, 'link-1', nowTime, '2026-08-24'), false)
  assert.equal(isCurrentTrainingNotificationReference(currentTraining, 'link-1', nowTime), true)
  assert.equal(isCurrentTrainingNotificationReference({ ...currentTraining, response_deadline_at: '2026-08-24T12:00:00Z' }, 'link-1', nowTime), false)
  assert.equal(isCurrentParentPollReference({ closes_at: '2026-08-24T14:00:00Z', status: 'open' }, nowTime), true)
  assert.equal(isCurrentParentPollReference({ closes_at: '2026-08-24T12:00:00Z', status: 'open' }, nowTime), false)
})

test('Parent shell uses actionable invitation sections for the More badge', async () => {
  const source = await readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8')
  const screens = await readFile(new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url), 'utf8')
  assert.match(source, /getParentInvitationCounts\(visibleInvitationsWithMatchTimes\)\.needsResponse/)
  assert.match(source, /unreadNotifications \+ homeModel\.unansweredPolls \+ unansweredInvites/)
  assert.match(source, /unreadNotifications=\{unreadNotifications\}/)
  assert.match(screens, /style=\{styles\.moreIconBadge\}/)
  assert.match(screens, /count > 99 \? '99\+' : count/)
  assert.doesNotMatch(source, /visibleInvitations\.filter\(\(invitation\) => invitation\.isPending\)\.length/)
})

test('new native Parent pushes are blocked when their source action has expired', async () => {
  const source = await readFile(new URL('../netlify/functions/send-parent-mobile-push.js', import.meta.url), 'utf8')
  assert.match(source, /isCurrentParentPollReference\(poll\)/)
  assert.match(source, /isCurrentMatchNotificationReference\(\{ \.\.\.request, match_days: match \}/)
  assert.match(source, /isCurrentTrainingNotificationReference\(\{ \.\.\.requestPlayer, training_availability_requests: request \}/)
})
