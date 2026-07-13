import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  getParentCalendarVisualState,
  getParentInvitationCategory,
  getParentInvitationStatus,
  getParentPlayerParticipationState,
  getParentVolunteerState,
  normalizeParentInvitation,
  PARENT_CALENDAR_VISUAL_STATES,
  PARENT_PLAYER_PARTICIPATION_STATES,
  PARENT_VOLUNTEER_STATES,
} from '../src/lib/domain/parent-invitations.js'

const futureStart = '2030-06-15T10:00:00.000Z'
const futureEnd = '2030-06-15T12:00:00.000Z'
const fixedNow = '2030-06-14T12:00:00.000Z'
const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const footballCalendarUrl = new URL('../src/components/sessions/FootballCalendar.jsx', import.meta.url)

function invitation(overrides = {}) {
  return normalizeParentInvitation({
    invitation_id: 'invite-1',
    invitation_type: 'match_attendance',
    invitation_state: 'active',
    response_state: 'not_required',
    selection_state: 'not_applicable',
    can_respond: false,
    can_change_response: false,
    child_id: 'child-1',
    child_name: 'Alex Player',
    ...overrides,
  })
}

function event(invitations = [], overrides = {}) {
  return {
    id: 'event-1',
    title: 'Home fixture',
    childName: 'Alex Player',
    date: '2030-06-15',
    startsAt: futureStart,
    endsAt: futureEnd,
    invitations,
    ...overrides,
  }
}

function resolve(invitations = [], overrides = {}, now = fixedNow) {
  return getParentCalendarVisualState(event(invitations, overrides), { now })
}

test('future accepted attendance resolves to the accepted semantic state', () => {
  const accepted = invitation({ response_state: 'available' })
  const result = resolve([accepted])

  assert.equal(result.state, PARENT_CALENDAR_VISUAL_STATES.accepted)
  assert.equal(result.label, 'Player available')
  assert.equal(result.playerState, PARENT_PLAYER_PARTICIPATION_STATES.available)
  assert.equal(getParentInvitationStatus(accepted).label, 'Accepted')
})

test('future player selection resolves Green while a declined volunteer role stays secondary', () => {
  const selectedPlayer = invitation({ selection_state: 'selected' })
  const declinedRole = invitation({
    invitation_id: 'role-1',
    invitation_type: 'match_role',
    role_type: 'linesman',
    response_state: 'no',
  })
  const result = resolve([selectedPlayer, declinedRole])

  assert.equal(result.state, PARENT_CALENDAR_VISUAL_STATES.accepted)
  assert.equal(result.label, 'Player selected')
  assert.equal(result.playerState, PARENT_PLAYER_PARTICIPATION_STATES.selected)
  assert.equal(result.volunteerState, PARENT_VOLUNTEER_STATES.declined)
  assert.deepEqual(result.volunteerDetails.map((detail) => detail.label), ['Linesman declined'])
})

test('future declined and unavailable responses resolve to the declined semantic state', () => {
  for (const responseState of ['declined', 'unavailable']) {
    const result = resolve([invitation({ response_state: responseState })])
    assert.equal(result.state, PARENT_CALENDAR_VISUAL_STATES.declined)
    assert.equal(result.label, 'Player unavailable')
    assert.equal(result.playerState, PARENT_PLAYER_PARTICIPATION_STATES.unavailable)
  }
})

test('only a future player response request resolves to action required', () => {
  const attendance = invitation({ response_state: 'awaiting_response', can_respond: true })
  const role = invitation({
    invitation_id: 'role-1',
    invitation_type: 'match_role',
    response_state: 'no_response',
    can_respond: true,
  })

  assert.equal(resolve([attendance]).state, PARENT_CALENDAR_VISUAL_STATES.actionRequired)
  assert.equal(resolve([attendance]).label, 'Player response needed')
  assert.equal(resolve([role]).state, PARENT_CALENDAR_VISUAL_STATES.informational)
  assert.equal(resolve([role]).volunteerState, PARENT_VOLUNTEER_STATES.responseRequired)
  assert.deepEqual(resolve([role]).volunteerDetails.map((detail) => detail.label), ['Volunteer role response needed'])
  assert.equal(getParentInvitationCategory(attendance), 'needs_response')
  assert.equal(getParentInvitationCategory(role), 'needs_response')
})

test('future information-only events stay informational and non-actionable', () => {
  const noResponseRequired = invitation({ response_state: 'not_required' })
  const responseRecorded = invitation({ response_state: 'recorded' })
  const withInvitation = resolve([noResponseRequired])
  const withRecordedResponse = resolve([responseRecorded])
  const withoutInvitation = resolve([])

  assert.equal(withInvitation.state, PARENT_CALENDAR_VISUAL_STATES.informational)
  assert.equal(withInvitation.label, 'Information only')
  assert.equal(withInvitation.isActionable, false)
  assert.equal(withRecordedResponse.state, PARENT_CALENDAR_VISUAL_STATES.informational)
  assert.equal(getParentInvitationStatus(responseRecorded).label, 'Response recorded')
  assert.equal(withoutInvitation.state, PARENT_CALENDAR_VISUAL_STATES.informational)
})

test('player state controls mixed attendance and volunteer combinations', () => {
  const pendingRole = invitation({
    invitation_id: 'role-pending',
    invitation_type: 'match_role',
    role_type: 'scorer',
    response_state: 'awaiting_response',
    can_respond: true,
  })
  const acceptedAttendance = invitation({ invitation_id: 'attendance', response_state: 'available' })
  const declinedAttendance = invitation({ invitation_id: 'declined', response_state: 'unavailable' })
  const acceptedRole = invitation({
    invitation_id: 'accepted-role',
    invitation_type: 'match_role',
    role_type: 'referee',
    response_state: 'yes',
  })
  const pendingAttendance = invitation({ invitation_id: 'pending-attendance', response_state: 'awaiting_response', can_respond: true })

  assert.equal(resolve([acceptedAttendance, pendingRole]).state, PARENT_CALENDAR_VISUAL_STATES.accepted)
  assert.equal(resolve([declinedAttendance, acceptedRole]).state, PARENT_CALENDAR_VISUAL_STATES.declined)
  assert.equal(resolve([pendingAttendance, acceptedRole]).state, PARENT_CALENDAR_VISUAL_STATES.actionRequired)
  assert.equal(resolve([acceptedAttendance, pendingRole]).volunteerState, PARENT_VOLUNTEER_STATES.responseRequired)
})

test('multiple unresolved role offers remain distinct without changing the informational colour', () => {
  const roles = ['scorer', 'linesman'].map((roleType, index) => invitation({
    invitation_id: `role-${index}`,
    invitation_type: 'match_role',
    role_type: roleType,
    response_state: 'awaiting_response',
    can_respond: true,
  }))
  const result = resolve(roles)

  assert.equal(result.state, PARENT_CALENDAR_VISUAL_STATES.informational)
  assert.equal(result.actionCount, 0)
  assert.equal(result.volunteerActionCount, 2)
  assert.deepEqual(result.volunteerDetails.map((detail) => detail.label), ['Scorer response needed', 'Linesman response needed'])
})

test('player accepted plus linesman declined stays Green with the decline visible', () => {
  const attendance = invitation({ response_state: 'available' })
  const linesman = invitation({
    invitation_id: 'linesman',
    invitation_type: 'match_role',
    role_type: 'linesman',
    response_state: 'no',
  })
  const result = resolve([attendance, linesman])

  assert.equal(result.state, PARENT_CALENDAR_VISUAL_STATES.accepted)
  assert.equal(result.label, 'Player available')
  assert.deepEqual(result.volunteerDetails.map((detail) => detail.label), ['Linesman declined'])
})

test('volunteer response changes never change an accepted player colour', () => {
  const attendance = invitation({ response_state: 'available' })
  const roleStates = [
    { response_state: 'yes', can_respond: true, expected: 'Scorer accepted' },
    { response_state: 'no', can_respond: true, expected: 'Scorer declined' },
    { response_state: 'awaiting_response', can_respond: true, expected: 'Scorer response needed' },
  ]

  for (const roleState of roleStates) {
    const role = invitation({
      invitation_id: `scorer-${roleState.response_state}`,
      invitation_type: 'match_role',
      role_type: 'scorer',
      ...roleState,
    })
    const result = resolve([attendance, role])
    assert.equal(result.state, PARENT_CALENDAR_VISUAL_STATES.accepted)
    assert.equal(result.label, 'Player available')
    assert.deepEqual(result.volunteerDetails.map((detail) => detail.label), [roleState.expected])
  }
})

test('volunteer-only accepted, declined, pending, and selected states remain informational', () => {
  const roleCases = [
    { response_state: 'yes', expectedState: PARENT_VOLUNTEER_STATES.accepted },
    { response_state: 'no', expectedState: PARENT_VOLUNTEER_STATES.declined },
    { response_state: 'awaiting_response', can_respond: true, expectedState: PARENT_VOLUNTEER_STATES.responseRequired },
    { response_state: 'yes', selection_state: 'selected', expectedState: PARENT_VOLUNTEER_STATES.selected },
  ]

  for (const roleCase of roleCases) {
    const role = invitation({
      invitation_id: `role-${roleCase.expectedState}`,
      invitation_type: 'match_role',
      role_type: 'referee',
      ...roleCase,
    })
    const result = resolve([role])
    assert.equal(result.state, PARENT_CALENDAR_VISUAL_STATES.informational)
    assert.equal(result.playerState, PARENT_PLAYER_PARTICIPATION_STATES.noResponseRequired)
    assert.equal(result.volunteerState, roleCase.expectedState)
  }
})

test('player availability changes update the primary colour without changing volunteer detail', () => {
  const role = invitation({
    invitation_id: 'scorer',
    invitation_type: 'match_role',
    role_type: 'scorer',
    response_state: 'yes',
  })
  const available = resolve([invitation({ response_state: 'available' }), role])
  const unavailable = resolve([invitation({ response_state: 'unavailable' }), role])
  const pending = resolve([invitation({ response_state: 'awaiting_response', can_respond: true }), role])

  assert.equal(available.state, PARENT_CALENDAR_VISUAL_STATES.accepted)
  assert.equal(unavailable.state, PARENT_CALENDAR_VISUAL_STATES.declined)
  assert.equal(pending.state, PARENT_CALENDAR_VISUAL_STATES.actionRequired)
  assert.deepEqual(available.volunteerDetails, unavailable.volunteerDetails)
  assert.deepEqual(unavailable.volunteerDetails, pending.volunteerDetails)
})

test('player and volunteer domain helpers return separate concepts', () => {
  const attendance = invitation({ response_state: 'unavailable' })
  const referee = invitation({
    invitation_id: 'referee',
    invitation_type: 'match_role',
    role_type: 'referee',
    response_state: 'yes',
  })

  assert.equal(getParentPlayerParticipationState([attendance, referee]).participationState, PARENT_PLAYER_PARTICIPATION_STATES.unavailable)
  assert.equal(getParentVolunteerState([attendance, referee]).state, PARENT_VOLUNTEER_STATES.accepted)
  assert.deepEqual(getParentVolunteerState([attendance, referee]).details.map((detail) => detail.label), ['Referee accepted'])
})

test('future player priority is response required, declined, selected, accepted, then information', () => {
  const pending = invitation({ invitation_id: 'pending', response_state: 'awaiting_response', can_respond: true })
  const declined = invitation({ invitation_id: 'declined', response_state: 'unavailable' })
  const selected = invitation({ invitation_id: 'selected', response_state: 'available', selection_state: 'selected' })
  const accepted = invitation({ invitation_id: 'accepted', response_state: 'available' })

  assert.equal(resolve([accepted, selected, declined, pending]).state, PARENT_CALENDAR_VISUAL_STATES.actionRequired)
  assert.equal(resolve([accepted, selected, declined]).state, PARENT_CALENDAR_VISUAL_STATES.declined)
  assert.equal(resolve([accepted, selected]).label, 'Player selected')
  assert.equal(resolve([accepted]).label, 'Player available')
  assert.equal(resolve([]).state, PARENT_CALENDAR_VISUAL_STATES.informational)
})

test('past events are muted while retaining accepted and declined history', () => {
  const pastOverrides = {
    date: '2029-01-10',
    startsAt: '2029-01-10T10:00:00.000Z',
    endsAt: '2029-01-10T12:00:00.000Z',
  }
  const accepted = resolve([invitation({ response_state: 'available' })], pastOverrides)
  const declined = resolve([invitation({ response_state: 'unavailable' })], pastOverrides)

  assert.equal(accepted.state, PARENT_CALENDAR_VISUAL_STATES.past)
  assert.equal(accepted.label, 'Past, Player available')
  assert.equal(accepted.historicalLabel, 'Player available')
  assert.equal(accepted.isActionable, false)
  assert.equal(declined.state, PARENT_CALENDAR_VISUAL_STATES.past)
  assert.equal(declined.label, 'Past, Player unavailable')
})

test('past calculation uses the explicit end and keeps current-day events active until day end', () => {
  const ended = resolve([], {
    date: '2030-06-14',
    startsAt: '2030-06-14T08:00:00.000Z',
    endsAt: '2030-06-14T09:00:00.000Z',
  })
  const currentDayNoEnd = resolve([], {
    date: '2030-06-14',
    startsAt: '2030-06-14T08:00:00',
    endsAt: '',
  }, '2030-06-14T12:00:00')

  assert.equal(ended.state, PARENT_CALENDAR_VISUAL_STATES.past)
  assert.equal(currentDayNoEnd.state, PARENT_CALENDAR_VISUAL_STATES.informational)
  assert.equal(currentDayNoEnd.isPast, false)
})

test('completed Match Day lifecycle states are muted even before the scheduled end', () => {
  for (const eventStatus of ['full_time', 'concluded']) {
    const result = resolve([invitation({ response_state: 'available' })], { eventStatus })
    assert.equal(result.state, PARENT_CALENDAR_VISUAL_STATES.past)
    assert.equal(result.label, 'Past, Player available')
    assert.equal(result.isActionable, false)
  }
})

test('cancelled and postponed events keep specific future labels but become muted after ending', () => {
  const cancelled = resolve([], { eventStatus: 'cancelled', cancelledAt: '2030-06-13T09:00:00.000Z' })
  const postponed = resolve([], { eventStatus: 'postponed' })
  const pastCancelled = resolve([], {
    date: '2029-01-10',
    startsAt: '2029-01-10T10:00:00.000Z',
    endsAt: '2029-01-10T12:00:00.000Z',
    eventStatus: 'cancelled',
  })

  assert.equal(cancelled.state, PARENT_CALENDAR_VISUAL_STATES.cancelledOrPostponed)
  assert.equal(cancelled.label, 'Cancelled')
  assert.equal(postponed.state, PARENT_CALENDAR_VISUAL_STATES.cancelledOrPostponed)
  assert.equal(postponed.label, 'Postponed')
  assert.equal(pastCancelled.state, PARENT_CALENDAR_VISUAL_STATES.past)
  assert.equal(pastCancelled.historicalLabel, 'Cancelled')
})

test('one cancelled role offer does not cancel an otherwise active event', () => {
  const cancelledRole = invitation({ invitation_id: 'cancelled-role', invitation_state: 'cancelled' })
  const acceptedAttendance = invitation({ invitation_id: 'attendance', response_state: 'available' })
  const result = resolve([cancelledRole, acceptedAttendance])

  assert.equal(result.state, PARENT_CALENDAR_VISUAL_STATES.accepted)
  assert.equal(result.label, 'Player available')
})

test('child-specific resolution recalculates and never inherits a sibling response', () => {
  const childOne = resolve([invitation({ child_id: 'child-1', response_state: 'available' })])
  const childTwo = resolve([invitation({ child_id: 'child-2', response_state: 'unavailable' })])
  const childWithoutInvitation = resolve([])

  assert.equal(childOne.state, PARENT_CALENDAR_VISUAL_STATES.accepted)
  assert.equal(childTwo.state, PARENT_CALENDAR_VISUAL_STATES.declined)
  assert.equal(childWithoutInvitation.state, PARENT_CALENDAR_VISUAL_STATES.informational)
})

test('selected child id filters sibling attendance and volunteer detail', () => {
  const childOne = invitation({ invitation_id: 'child-one', child_id: 'child-1', response_state: 'available' })
  const childTwo = invitation({ invitation_id: 'child-two', child_id: 'child-2', response_state: 'unavailable' })
  const role = invitation({
    invitation_id: 'role-one',
    invitation_type: 'match_role',
    role_type: 'linesman',
    child_id: 'child-1',
    response_state: 'awaiting_response',
    can_respond: true,
  })

  const childOneResult = resolve([childOne, childTwo, role], { childId: 'child-1' })
  const childTwoResult = resolve([childOne, childTwo, role], { childId: 'child-2' })

  assert.equal(childOneResult.state, PARENT_CALENDAR_VISUAL_STATES.accepted)
  assert.equal(childTwoResult.state, PARENT_CALENDAR_VISUAL_STATES.declined)
  assert.deepEqual(childOneResult.volunteerDetails.map((detail) => detail.label), ['Linesman response needed'])
  assert.equal(childTwoResult.volunteerState, PARENT_VOLUNTEER_STATES.noOffer)
  assert.deepEqual(childTwoResult.volunteerDetails, [])
})

test('calendar builder resolves status from each selected child event invitation group', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')
  const builderStart = source.indexOf('function buildParentCalendarEvents')
  const builderEnd = source.indexOf('function getMatchVolunteerRequestLabels', builderStart)
  const builder = source.slice(builderStart, builderEnd)

  assert.match(builder, /invitations: group\.invitations/)
  assert.match(builder, /childId: group\.childId \|\| ''/)
  assert.match(builder, /childId: invitationGroup\?\.childId \|\| ''/)
  assert.match(builder, /calendarVisualState: getParentCalendarVisualState\(event\)/)
  assert.doesNotMatch(builder, /event\.title.*accepted|event\.type.*declined/i)
})

test('calendar and Invites share the authoritative invitation domain and retain modal responses', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')
  const modalStart = source.indexOf('function ParentCalendarEventModal')
  const modalEnd = source.indexOf('const parentInvitationSections', modalStart)
  const modal = source.slice(modalStart, modalEnd)
  const responseBlockStart = source.indexOf('function ParentInvitationResponseBlock')
  const responseBlockEnd = source.indexOf('function ParentCalendarEventModal', responseBlockStart)
  const responseBlock = source.slice(responseBlockStart, responseBlockEnd)
  const invitesStart = source.indexOf('function ParentUpcomingEvents')
  const invitesEnd = source.indexOf('function ParentPortalSignOutButton', invitesStart)
  const invites = source.slice(invitesStart, invitesEnd)

  assert.match(modal, /<ParentInvitationResponseBlock/)
  assert.match(responseBlock, /getParentInvitationStatus\(invitation\)/)
  assert.match(responseBlock, /getParentInvitationResponseOptions\(invitation\)/)
  assert.match(invites, /getParentInvitationStatus\(invitation\)/)
  assert.match(source, /respondToParentPortalInvitation/)
  assert.match(source, /onOpenEvent=\{\(event\) => setSelectedCalendarEventId\(event\.id\)\}/)
})

test('calendar views use one semantic style map plus non-colour and screen-reader cues', async () => {
  const source = await readFile(footballCalendarUrl, 'utf8')

  assert.match(source, /const calendarVisualToneStyles = \{/)
  assert.match(source, /function CalendarEventStatusCue/)
  assert.match(source, /function CalendarVolunteerStatusCue/)
  assert.match(source, /function CalendarEventCues/)
  assert.match(source, /aria-label=\{getEventAccessibleName\(event\)\}/)
  assert.match(source, /Status: \$\{getEventStatusLabel\(event\)\}/)
  assert.match(source, /\.\.\.getEventVolunteerDetails\(event\)/)
  assert.match(source, /Volunteer requests appear as separate role badges and do not change the player availability colour\./)
  assert.match(source, /Player available or selected/)
  assert.match(source, /Player unavailable/)
  assert.match(source, /Player response needed/)
  assert.match(source, /Information only/)
  assert.match(source, /Past or closed/)
  assert.match(source, /aria-hidden="true"/)
  assert.match(source, /sr-only/)
  assert.match(source, /Month/)
  assert.match(source, /Week/)
  assert.match(source, /Agenda/)
  assert.match(source, /getEventTone\(event\)/)
  assert.doesNotMatch(source, /getEventTone\(event\.type\)/)
})

test('compact and mobile calendar cues constrain width and preserve touch targets', async () => {
  const source = await readFile(footballCalendarUrl, 'utf8')

  assert.match(source, /max-w-full/)
  assert.match(source, /overflow-hidden rounded-md/)
  assert.match(source, /min-h-11 w-full/)
  assert.match(source, /<CalendarEventCues compact event=\{event\} \/>/)
  assert.match(source, /flex max-w-full flex-wrap gap-1 overflow-hidden/)
  assert.match(source, /sm:hidden/)
})
