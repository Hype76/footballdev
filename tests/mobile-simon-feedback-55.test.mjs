import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  canParentRegisterScorerInterest,
  getParentMatchCalendarUrl,
  getParentMatchDirectionsUrl,
  getParentMatchGroups,
  isParentDefinitelyOffline,
} from '../apps/parent-mobile/src/parentExperience.js'
import { withParentPushStepTimeout } from '../apps/mobile-core/src/parentNotificationsCore.js'
import { getParentInvitationSections } from '../apps/parent-mobile/src/parentPresentationCore.js'
import {
  buildCoachChatRoomSections,
  getCoachChatRoomDisplay,
  getCoachChatRoomSectionKey,
  hasCoachChatRoomActivity,
  normalizeCoachChatRoom,
} from '../apps/mobile-core/src/coachPhase31ECore.js'

const fixtureNow = new Date('2026-08-14T10:00:00Z')

test('Parent invitation categories are mutually exclusive after a response', () => {
  const responded = {
    canChangeResponse: true,
    canRespond: true,
    childId: 'child-1',
    eventStart: '2026-08-16T09:00:00Z',
    invitationState: 'active',
    invitationType: 'training_attendance',
    isPending: false,
    lastRespondedAt: '2026-08-13T21:30:00Z',
    responseState: 'available',
    sourceRecordId: 'session-1',
  }
  const sections = getParentInvitationSections([responded], fixtureNow)
  assert.deepEqual(sections.responded, [responded])
  assert.deepEqual(sections.upcoming, [])
  assert.deepEqual(sections.needsResponse, [])
})

test('Parent next match excludes an old fixture left in an in-progress state', () => {
  const oldMatch = { id: 'old', kickoffTime: '15:00:00', matchDate: '2026-07-24', status: 'second_half' }
  const nextMatch = { id: 'next', kickoffTime: '10:00:00', matchDate: '2026-08-16', status: 'scheduled' }
  const groups = getParentMatchGroups([oldMatch, nextMatch], fixtureNow)
  assert.deepEqual(groups.upcoming.map((match) => match.id), ['next'])
  assert.deepEqual(groups.recent.map((match) => match.id), ['old'])
})

test('Parent Match Day actions create safe Calendar and directions links', () => {
  const match = {
    kickoffTime: '10:30:00',
    matchDate: '2026-08-16',
    matchDurationMinutes: 90,
    opponent: 'St Ives',
    teamName: 'U17 Green',
    venueAddress: 'Back Lane, Cambourne',
    venueName: 'Football Player Stadium',
  }
  const calendarUrl = new URL(getParentMatchCalendarUrl(match))
  assert.equal(calendarUrl.protocol, 'https:')
  assert.equal(calendarUrl.searchParams.get('text'), 'U17 Green v St Ives')
  assert.equal(calendarUrl.searchParams.get('dates'), '20260816T103000/20260816T120000')
  assert.equal(calendarUrl.searchParams.get('ctz'), 'Europe/London')
  assert.match(getParentMatchDirectionsUrl(match, 'ios'), /^https:\/\/maps\.apple\.com\//)
  assert.match(getParentMatchDirectionsUrl(match, 'android'), /^https:\/\/www\.google\.com\/maps\/search\//)
})

test('Parent scorer interest is hidden until this parent has a current scorer invitation', () => {
  const match = { id: 'match-55', matchDate: '2026-08-16', requestScorer: true, status: 'scheduled' }
  const invitations = [{ eventId: match.id, invitationType: 'match_role', roleType: 'scorer', sourceRecordId: 'request-55', invitationState: 'offered', canRespond: true }]
  assert.equal(canParentRegisterScorerInterest(match, fixtureNow), false)
  assert.equal(canParentRegisterScorerInterest(match, fixtureNow, invitations), true)
  assert.equal(canParentRegisterScorerInterest({ ...match, matchDate: '2026-07-07', status: 'live' }, fixtureNow, invitations), false)
  assert.equal(canParentRegisterScorerInterest({ ...match, hasInterest: true }, fixtureNow, invitations), false)
})

test('Parent network state trusts an active connection while reachability is still being checked', () => {
  assert.equal(isParentDefinitelyOffline({ isConnected: true, isInternetReachable: false }), false)
  assert.equal(isParentDefinitelyOffline({ isConnected: false, isInternetReachable: true }), true)
})

test('Parent notification native work cannot leave the settings switch busy forever', async () => {
  assert.equal(
    await withParentPushStepTimeout(() => Promise.resolve('ready'), { stage: 'expo', timeoutMs: 25 }),
    'ready',
  )
  await assert.rejects(
    withParentPushStepTimeout(() => new Promise(() => {}), { stage: 'device', timeoutMs: 5 }),
    (error) => error.code === 'PARENT_PUSH_DEVICE_NETWORK',
  )
})

test('Coach Parent Chat labels include Player or fixture context', () => {
  const direct = normalizeCoachChatRoom({ player_name: 'Clyde Bates', room_type: 'parent_staff', team_name: 'U17 Green' }, 'parent')
  assert.deepEqual(getCoachChatRoomDisplay(direct), { context: 'U17 Green', title: 'Clyde Bates | Chat with Coaches' })

  const squad = normalizeCoachChatRoom({ kickoff_time: '10:00:00', match_date: '2026-08-16', opponent: 'St Ives', room_type: 'match_squad', team_name: 'U17 Green' }, 'parent')
  assert.deepEqual(getCoachChatRoomDisplay(squad), { context: '2026-08-16 at 10:00', title: 'U17 Green v St Ives' })
})

test('Coach Chat categories prioritise unread rooms and collapse inactive Parent and Match Day rooms', () => {
  const rooms = [
    normalizeCoachChatRoom({ id: 'team', room_type: 'team', team_name: 'U17 Green' }, 'parent'),
    normalizeCoachChatRoom({ id: 'staff', latest_message: 'Staff update', room_type: 'team_staff', team_name: 'U17 Green' }, 'staff'),
    normalizeCoachChatRoom({ id: 'parent-active', latest_message: 'Hello', player_name: 'Clyde', room_type: 'parent_staff', team_name: 'U17 Green', unread_count: 2 }, 'parent'),
    normalizeCoachChatRoom({ id: 'parent-empty', player_name: 'Jack', room_type: 'parent_staff', team_name: 'U17 Green' }, 'parent'),
    normalizeCoachChatRoom({ id: 'match-empty', opponent: 'St Ives', room_type: 'match_squad', team_name: 'U17 Green' }, 'parent'),
  ]
  assert.equal(getCoachChatRoomSectionKey(rooms[0]), 'team')
  assert.equal(getCoachChatRoomSectionKey(rooms[1]), 'staff')
  assert.equal(getCoachChatRoomSectionKey(rooms[2]), 'parents')
  assert.equal(getCoachChatRoomSectionKey(rooms[4]), 'match_day')
  assert.equal(hasCoachChatRoomActivity(rooms[2]), true)
  assert.equal(hasCoachChatRoomActivity(rooms[3]), false)

  const sections = buildCoachChatRoomSections(rooms)
  assert.deepEqual(sections.map((section) => section.title), ['Team Chat', 'Coaches', 'Parents', 'Match Day'])
  assert.deepEqual(sections.find((section) => section.key === 'parents').activeRooms.map((room) => room.id), ['parent-active'])
  assert.deepEqual(sections.find((section) => section.key === 'parents').emptyRooms.map((room) => room.id), ['parent-empty'])
  assert.deepEqual(sections.find((section) => section.key === 'match_day').emptyRooms.map((room) => room.id), ['match-empty'])
})

test('Parent notification, focused Chat, resource, poll and scorer regression guards are present', async () => {
  const [app, config, notifications, parentData, screens, coachScreens, migration] = await Promise.all([
    readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/app.config.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/notifications.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260814063000_mobile_simon_feedback_55.sql', import.meta.url), 'utf8'),
  ])

  assert.match(config, /easProjectId:\s*'7e0906f3-64f4-42d9-b45d-0ee68f599baa'/)
  assert.match(notifications, /withParentPushStepTimeout/)
  assert.match(notifications, /Platform\.OS === 'android'/)
  assert.match(notifications, /allowAlert:\s*true/)
  assert.match(notifications, /allowBadge:\s*true/)
  assert.match(notifications, /allowSound:\s*true/)
  assert.match(notifications, /listener\(devicePushToken\)/)
  assert.match(app, /devicePushToken,/)
  assert.match(app, /label=\{saved \? 'Saved' : 'Selected'\}/)
  assert.match(app, /Open device notification settings/)
  assert.match(app, /focusedChatRoom/)
  assert.match(app, /behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}/)
  assert.match(app, /enabled=\{Platform\.OS === 'ios' \|\| focusedChatRoom\}/)
  assert.match(parentData, /if \(config\.supabaseEnvironment === 'production'\)[\s\S]*return \{ externalUrl: accessUrl \}/)
  assert.match(screens, /Add to Google Calendar/)
  assert.match(screens, /Get directions/)

  const chatStart = coachScreens.indexOf('function ChatDomain')
  const chatEnd = coachScreens.indexOf('function MessagesDomain')
  const coachChat = coachScreens.slice(chatStart, chatEnd)
  assert.doesNotMatch(coachChat, /Team Calendar/)
  assert.doesNotMatch(coachChat, /label="Match Day"/)
  assert.match(coachChat, /Back to conversations/)

  assert.match(migration, /create or replace function public\.get_parent_portal_polls/)
  assert.match(migration, /create or replace function public\.submit_parent_portal_poll_vote/)
  assert.doesNotMatch(migration, /current_user_role|current_user_has_active_authority/)
  assert.match(migration, /parent_poll_vote_removed/)
  assert.match(migration, /poll_row\.allow_multiple is true[\s\S]*poll_row\.allow_vote_changes is true/)
  assert.match(migration, /match_day\.match_date >= timezone\('Europe\/London', now\(\)\)::date/)
})

test('Feedback 55 authorises only its explicit guarded mobile release reference', async () => {
  const [buildGuard, submitGuard] = await Promise.all([
    readFile(new URL('../apps/scripts/mobile-build-guard.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../apps/scripts/mobile-submit-guard.mjs', import.meta.url), 'utf8'),
  ])

  assert.match(buildGuard, /FP-MOBILE-SIMON-FEEDBACK-55/)
  assert.match(submitGuard, /FP-MOBILE-SIMON-FEEDBACK-55/)
  assert.match(buildGuard, /MOBILE_NATIVE_BUILD_CONFIRMED/)
  assert.match(submitGuard, /MOBILE_SUBMISSION_BUILD_ID/)
  assert.match(submitGuard, /MOBILE_SUBMISSION_CONFIRMED/)
})
