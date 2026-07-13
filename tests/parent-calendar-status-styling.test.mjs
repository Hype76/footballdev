import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  getParentCalendarVisualState,
  getParentInvitationCategory,
  getParentInvitationStatus,
  normalizeParentInvitation,
  PARENT_CALENDAR_VISUAL_STATES,
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
  assert.equal(result.label, 'Accepted')
  assert.equal(getParentInvitationStatus(accepted).label, 'Accepted')
})

test('future staff-selected role resolves to confirmed accepted styling', () => {
  const selected = invitation({
    invitation_type: 'match_role',
    response_state: 'yes',
    selection_state: 'selected',
  })
  const result = resolve([selected])

  assert.equal(result.state, PARENT_CALENDAR_VISUAL_STATES.accepted)
  assert.equal(result.label, 'Confirmed')
  assert.equal(getParentInvitationStatus(selected).label, 'Selected by staff')
})

test('future declined and unavailable responses resolve to the declined semantic state', () => {
  for (const responseState of ['declined', 'unavailable', 'no']) {
    const result = resolve([invitation({ response_state: responseState })])
    assert.equal(result.state, PARENT_CALENDAR_VISUAL_STATES.declined)
    assert.equal(result.label, 'Declined')
  }
})

test('future attendance response and role offer requests resolve to action required', () => {
  const attendance = invitation({ response_state: 'awaiting_response', can_respond: true })
  const role = invitation({
    invitation_id: 'role-1',
    invitation_type: 'match_role',
    response_state: 'no_response',
    can_respond: true,
  })

  assert.equal(resolve([attendance]).state, PARENT_CALENDAR_VISUAL_STATES.actionRequired)
  assert.equal(resolve([role]).state, PARENT_CALENDAR_VISUAL_STATES.actionRequired)
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
  assert.equal(withInvitation.label, 'Information')
  assert.equal(withInvitation.isActionable, false)
  assert.equal(withRecordedResponse.state, PARENT_CALENDAR_VISUAL_STATES.informational)
  assert.equal(getParentInvitationStatus(responseRecorded).label, 'Response recorded')
  assert.equal(withoutInvitation.state, PARENT_CALENDAR_VISUAL_STATES.informational)
})

test('future action required outranks accepted, declined, and confirmed states', () => {
  const pendingRole = invitation({
    invitation_id: 'role-pending',
    invitation_type: 'match_role',
    response_state: 'awaiting_response',
    can_respond: true,
  })
  const acceptedAttendance = invitation({ invitation_id: 'attendance', response_state: 'available' })
  const declinedAttendance = invitation({ invitation_id: 'declined', response_state: 'unavailable' })
  const selectedRole = invitation({
    invitation_id: 'selected-role',
    invitation_type: 'match_role',
    response_state: 'yes',
    selection_state: 'selected',
  })

  for (const secondary of [acceptedAttendance, declinedAttendance, selectedRole]) {
    const result = resolve([secondary, pendingRole])
    assert.equal(result.state, PARENT_CALENDAR_VISUAL_STATES.actionRequired)
    assert.equal(result.actionCount, 1)
  }
})

test('multiple unresolved role offers remain represented in the calendar state', () => {
  const roles = ['scorer', 'linesman'].map((roleType, index) => invitation({
    invitation_id: `role-${index}`,
    invitation_type: 'match_role',
    role_type: roleType,
    response_state: 'awaiting_response',
    can_respond: true,
  }))
  const result = resolve(roles)

  assert.equal(result.state, PARENT_CALENDAR_VISUAL_STATES.actionRequired)
  assert.equal(result.actionCount, 2)
  assert.equal(result.label, '2 responses needed')
})

test('future priority after action required is declined, confirmed, accepted, then information', () => {
  const declined = invitation({ invitation_id: 'declined', response_state: 'unavailable' })
  const selected = invitation({ invitation_id: 'selected', response_state: 'yes', selection_state: 'selected' })
  const accepted = invitation({ invitation_id: 'accepted', response_state: 'available' })

  assert.equal(resolve([accepted, selected, declined]).state, PARENT_CALENDAR_VISUAL_STATES.declined)
  assert.equal(resolve([accepted, selected]).label, 'Confirmed')
  assert.equal(resolve([accepted]).label, 'Accepted')
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
  assert.equal(accepted.label, 'Past, Accepted')
  assert.equal(accepted.historicalLabel, 'Accepted')
  assert.equal(accepted.isActionable, false)
  assert.equal(declined.state, PARENT_CALENDAR_VISUAL_STATES.past)
  assert.equal(declined.label, 'Past, Declined')
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
    assert.equal(result.label, 'Past, Accepted')
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
  assert.equal(result.label, 'Accepted')
})

test('child-specific resolution recalculates and never inherits a sibling response', () => {
  const childOne = resolve([invitation({ child_id: 'child-1', response_state: 'available' })])
  const childTwo = resolve([invitation({ child_id: 'child-2', response_state: 'unavailable' })])
  const childWithoutInvitation = resolve([])

  assert.equal(childOne.state, PARENT_CALENDAR_VISUAL_STATES.accepted)
  assert.equal(childTwo.state, PARENT_CALENDAR_VISUAL_STATES.declined)
  assert.equal(childWithoutInvitation.state, PARENT_CALENDAR_VISUAL_STATES.informational)
})

test('calendar builder resolves status from each selected child event invitation group', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')
  const builderStart = source.indexOf('function buildParentCalendarEvents')
  const builderEnd = source.indexOf('function getMatchVolunteerRequestLabels', builderStart)
  const builder = source.slice(builderStart, builderEnd)

  assert.match(builder, /invitations: group\.invitations/)
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
  assert.match(source, /aria-label=\{getEventAccessibleName\(event\)\}/)
  assert.match(source, /Status: \$\{getEventStatusLabel\(event\)\}/)
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
  assert.match(source, /<CalendarEventStatusCue compact event=\{event\} \/>/)
  assert.match(source, /sm:hidden/)
})
