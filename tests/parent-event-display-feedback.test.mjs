import assert from 'node:assert/strict'
import test from 'node:test'
import { buildParentCalendarEvents } from '../apps/mobile-core/src/parentCalendarCore.js'
import { getParentNotificationPresentation } from '../apps/mobile-core/src/parentNotificationInboxCore.js'
import { enrichParentMatchInvitations, getParentGoogleCalendarUrl } from '../apps/parent-mobile/src/parentExperience.js'
import { getParentChatRoomContext, getParentInvitationCounts, prepareParentChatRooms } from '../apps/parent-mobile/src/parentPresentationCore.js'
import { getParentEventDateTimeLabel, getParentEventPresentation } from '../apps/parent-mobile/src/parentEventPresentation.js'
import { buildParentMatchDayNotificationCopy } from '../netlify/functions/lib/_match-day-notification-copy.js'
import { normalizeOwnTeamFixturePreferences } from '../src/lib/team-fixture-preferences.js'

const match = { id: 'match', homeAway: 'away', matchDate: '2026-09-06', teamName: 'U14 EJA', opponent: 'AFC Sudbury', kickoffTimeTbc: true }

test('away fixtures show the home opponent first in calendar, invites, exports, chat and notifications', () => {
  const expected = 'AFC Sudbury v U14 EJA'
  const invitation = { eventId: match.id, invitationId: 'attendance', invitationType: 'match_attendance', eventTitle: 'Old team-first title' }
  const enriched = enrichParentMatchInvitations([invitation], [match])
  const [event] = buildParentCalendarEvents({ matches: [match], invitations: enriched })
  assert.equal(event.title, expected)
  assert.equal(enriched[0].eventTitle, expected)
  assert.equal(new URL(getParentGoogleCalendarUrl(event)).searchParams.get('text'), expected)
  const room = prepareParentChatRooms([{ id: 'room', matchDayId: match.id, type: 'match_day', title: 'Old title' }], [], [match]).find(item => item.id === 'room')
  assert.equal(room.title, expected)
  assert.ok(getParentChatRoomContext(room).startsWith(expected))
  assert.equal(getParentNotificationPresentation({ data: { route: 'invites', matchDayId: match.id } }, [match]).displayTitle, expected)
  assert.equal(buildParentMatchDayNotificationCopy({ match, type: 'match_started' }).matchTitle, expected)
})

test('home fixtures and existing neutral fixtures retain their order', () => {
  for (const homeAway of ['home', 'neutral']) {
    assert.equal(buildParentCalendarEvents({ matches: [{ ...match, homeAway }] })[0].title, 'U14 EJA v AFC Sudbury')
  }
})

test('training requests and matches have distinct labels, icons and colours', () => {
  const training = getParentEventPresentation({ eventType: 'training_availability' })
  const fixture = getParentEventPresentation({ eventType: 'match_day' })
  assert.equal(training.label, 'Training')
  assert.equal(fixture.iconKey, 'football')
  assert.notEqual(training.iconKey, fixture.iconKey)
  assert.notEqual(training.tone, fixture.tone)
  assert.equal(getParentEventPresentation({ invitationType: 'training_attendance' }).label, 'Training')
  assert.equal(getParentEventPresentation({ eventType: 'match_day', status: 'cancelled' }).label, 'Cancelled')
})

test('TBC fixtures hide sorting placeholder time while confirmed late times stay visible', () => {
  const [event] = buildParentCalendarEvents({ matches: [match] })
  assert.equal(getParentEventDateTimeLabel(event), 'Sun 6 Sept · Time TBC')
  assert.doesNotMatch(getParentEventDateTimeLabel(event), /23:59/)
  assert.equal(getParentEventDateTimeLabel({ ...event, kickoffTimeTbc: false, calendarTime: '23:59' }), 'Sun 6 Sept at 23:59')
  assert.equal(getParentEventDateTimeLabel({ eventType: 'training', startsAt: '2026-09-07T09:00:00Z' }), 'Mon 7 Sept at 10:00')
})

test('Invites count includes training and groups all requests for one match', () => {
  const base = { childId: 'child', eventDate: '2099-09-06', invitationState: 'active', canRespond: true, isPending: true, responseState: 'awaiting_response' }
  const rows = [
    { ...base, eventId: 'match', invitationType: 'match_attendance' },
    { ...base, eventId: 'match', invitationType: 'match_role', roleType: 'scorer' },
    { ...base, eventId: 'training', invitationType: 'training_attendance' },
  ]
  assert.equal(getParentInvitationCounts(rows, new Date('2026-09-02T12:00:00Z')).needsResponse, 2)
})

test('short matches keep their saved fixture defaults', () => {
  assert.equal(normalizeOwnTeamFixturePreferences({ duration: 2, found: true }).duration, 2)
  assert.equal(normalizeOwnTeamFixturePreferences({ duration: 10, found: true }).duration, 10)
  assert.equal(normalizeOwnTeamFixturePreferences({ duration: 0, found: true }).duration, 90)
})
