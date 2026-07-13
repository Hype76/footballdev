import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  getMatchDayAvailabilityLabel,
  getMatchDaySquadDecisionLabel,
  getSquadDecisionChangeBlockReason,
  MATCH_DAY_SQUAD_DECISIONS,
  normalizeMatchDaySquadDecision,
} from '../src/lib/matchday-squad-selection.js'
import {
  getParentCalendarVisualState,
  getParentInvitationStatus,
  getParentSquadDecisionStatus,
  normalizeParentInvitation,
  PARENT_CALENDAR_VISUAL_STATES,
} from '../src/lib/domain/parent-invitations.js'

const migrationUrl = new URL('../supabase/migrations/20260713192928_match_day_player_squad_decisions.sql', import.meta.url)
const matchDayPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const parentPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const parentDomainUrl = new URL('../src/lib/domain/parent-invitations.js', import.meta.url)
const responseFunctionUrl = new URL('../netlify/functions/match-day-availability-confirm.js', import.meta.url)
const sendFunctionUrl = new URL('../netlify/functions/send-match-day-availability-requests.js', import.meta.url)

const [migration, matchDayPage, parentPage, parentDomain, responseFunction, sendFunction] = await Promise.all([
  readFile(migrationUrl, 'utf8'),
  readFile(matchDayPageUrl, 'utf8'),
  readFile(parentPageUrl, 'utf8'),
  readFile(parentDomainUrl, 'utf8'),
  readFile(responseFunctionUrl, 'utf8'),
  readFile(sendFunctionUrl, 'utf8'),
])

function invitation({ responseState = 'awaiting_response', selectionState = 'undecided', childId = 'child-1' } = {}) {
  return normalizeParentInvitation({
    invitation_id: `invite-${childId}`,
    invitation_type: 'match_attendance',
    source_event_type: 'match_day',
    event_id: 'fixture-1',
    child_id: childId,
    response_state: responseState,
    selection_state: selectionState,
    can_respond: responseState === 'awaiting_response',
    can_change_response: true,
  })
}

function calendarState(responseState, selectionState = 'undecided', childId = 'child-1') {
  return getParentCalendarVisualState({
    eventEnd: '2030-07-20T12:00:00.000Z',
    invitations: [invitation({ responseState, selectionState, childId })],
  }, { childId, now: '2030-07-19T12:00:00.000Z' })
}

test('1 Parent Available response remains availability and does not create Selected', () => {
  const item = invitation({ responseState: 'available' })
  assert.equal(getParentInvitationStatus(item).label, 'Available')
  assert.equal(getParentSquadDecisionStatus(item).label, 'Squad not yet decided')
})

test('2 Parent Unavailable response does not create Selected', () => {
  const item = invitation({ responseState: 'unavailable' })
  assert.equal(getParentInvitationStatus(item).label, 'Unavailable')
  assert.notEqual(getParentSquadDecisionStatus(item).label, 'Selected')
})

test('3 Parent Maybe response does not create Selected', () => {
  const item = invitation({ responseState: 'maybe' })
  assert.equal(getParentInvitationStatus(item).label, 'Maybe')
  assert.notEqual(getParentSquadDecisionStatus(item).label, 'Selected')
})

test('4 Awaiting response does not create Selected', () => {
  const item = invitation()
  assert.equal(getParentInvitationStatus(item).label, 'Awaiting response')
  assert.notEqual(getParentSquadDecisionStatus(item).label, 'Selected')
})

test('5 Authorised staff action permits Selected only for Available', () => {
  assert.equal(getSquadDecisionChangeBlockReason({ availabilityStatus: 'available', decision: 'selected', matchStatus: 'scheduled' }), '')
})

test('6 Authorised staff action permits Waiting for Available', () => {
  assert.equal(getSquadDecisionChangeBlockReason({ availabilityStatus: 'available', decision: 'waiting', matchStatus: 'scheduled' }), '')
})

test('7 Authorised staff action permits Not selected for Available', () => {
  assert.equal(getSquadDecisionChangeBlockReason({ availabilityStatus: 'available', decision: 'not_selected', matchStatus: 'scheduled' }), '')
})

test('8 Staff can return a pre-match decision to Undecided', () => {
  assert.equal(getSquadDecisionChangeBlockReason({ availabilityStatus: 'available', decision: 'undecided', matchStatus: 'scorer_request' }), '')
})

test('9 Parent role is denied by the authoritative RPC', () => {
  assert.match(migration, /actor_row\.role in \('parent_portal', 'super_admin'\)/)
  assert.match(migration, /Only active authorised team staff can change squad decisions/)
})

test('10 Parent cannot bypass the staff action through direct table writes', () => {
  assert.match(migration, /revoke all on public\.match_day_player_squad_decisions from authenticated/i)
  assert.doesNotMatch(migration, /grant (insert|update|delete).*match_day_player_squad_decisions to authenticated/i)
  assert.match(migration, /staff\.role not in \('parent_portal', 'super_admin'\)/)
  assert.match(migration, /public\.can_manage_match_day\(team_id\)/)
})

test('11 Staff cannot select a player from another team', () => {
  assert.match(migration, /player_row\.team_id is distinct from match_row\.team_id/)
  assert.match(migration, /can_manage_match_day\(match_row\.team_id\)/)
})

test('12 Staff cannot select a player from another club', () => {
  assert.match(migration, /match_row\.club_id <> actor_row\.club_id/)
  assert.match(migration, /player_row\.club_id <> match_row\.club_id/)
})

test('13 Inactive or unauthorised staff fail closed', () => {
  assert.match(migration, /coalesce\(staff\.status, 'active'\) = 'active'/)
  assert.match(migration, /coalesce\(actor_row\.role_rank, 0\) < 20/)
})

test('14 Unavailable player selection is blocked', () => {
  assert.match(getSquadDecisionChangeBlockReason({ availabilityStatus: 'unavailable', decision: 'selected', matchStatus: 'scheduled' }), /Only a player with an Available response/)
  assert.match(migration, /coalesce\(availability_row\.status, 'pending'\) <> 'available'/)
})

test('15 Awaiting-response player is not silently selected', () => {
  assert.match(getSquadDecisionChangeBlockReason({ availabilityStatus: 'pending', decision: 'selected', matchStatus: 'scheduled' }), /Available response/)
})

test('16 Cancelled postponed live Full Time and concluded fixtures reject changes', () => {
  for (const status of ['cancelled', 'postponed', 'live', 'full_time', 'concluded']) {
    assert.match(getSquadDecisionChangeBlockReason({ availabilityStatus: 'available', decision: 'waiting', matchStatus: status }), /locked/)
  }
  assert.match(migration, /match_row\.status not in \('scheduled', 'scorer_request'\)/)
})

test('17 Parent Portal has separate availability and squad status helpers', () => {
  assert.match(parentPage, /Availability: \$\{status\.label\}/)
  assert.match(parentPage, /Squad: \{squadDecision\.label\}/)
})

test('18 Available plus Selected displays correctly', () => {
  const item = invitation({ responseState: 'available', selectionState: 'selected' })
  assert.equal(getParentInvitationStatus(item).label, 'Available')
  assert.equal(getParentSquadDecisionStatus(item).label, 'Selected')
})

test('19 Available plus Waiting displays correctly', () => {
  const item = invitation({ responseState: 'available', selectionState: 'waiting' })
  assert.equal(getParentInvitationStatus(item).label, 'Available')
  assert.equal(getParentSquadDecisionStatus(item).label, 'Waiting for squad decision')
})

test('20 Available plus Not selected displays correctly', () => {
  const item = invitation({ responseState: 'available', selectionState: 'not_selected' })
  assert.equal(getParentInvitationStatus(item).label, 'Available')
  assert.equal(getParentSquadDecisionStatus(item).label, 'Not selected')
})

test('21 Awaiting response plus Undecided displays correctly', () => {
  assert.equal(getMatchDayAvailabilityLabel('pending'), 'Awaiting response')
  assert.equal(getMatchDaySquadDecisionLabel('undecided', { parent: true }), 'Squad not yet decided')
})

test('22 Parent Calendar primary colour remains driven by availability', () => {
  assert.equal(calendarState('available', 'not_selected').state, PARENT_CALENDAR_VISUAL_STATES.accepted)
  assert.equal(calendarState('unavailable', 'selected').state, PARENT_CALENDAR_VISUAL_STATES.declined)
})

test('23 Squad-state changes do not change the primary Calendar colour', () => {
  const states = ['undecided', 'waiting', 'selected', 'not_selected'].map((state) => calendarState('available', state).state)
  assert.deepEqual(new Set(states), new Set([PARENT_CALENDAR_VISUAL_STATES.accepted]))
})

test('24 Volunteer responses remain separate from player squad state', () => {
  assert.match(parentDomain, /invitation\.invitationType === 'match_role'/)
  assert.match(migration, /'match_role_assigned'/)
  assert.match(migration, /'match_role_removed'/)
  assert.doesNotMatch(migration, /update public\.match_day_role_assignments/)
})

test('25 Match Day and Parent Portal read the same squad-decision table', () => {
  assert.match(matchDayPage, /match\?\.squadDecisions/)
  assert.match(migration, /left join public\.match_day_player_squad_decisions decision/)
})

test('26 Staff selection is persisted for hard refresh', () => {
  assert.match(migration, /unique \(match_day_id, player_id\)/)
  assert.match(migration, /on conflict on constraint match_day_player_squad_decisions_match_player_key/)
})

test('27 Parent hard refresh uses the authoritative decision read model', () => {
  assert.match(migration, /create function public\.get_parent_portal_match_days/)
  assert.match(migration, /coalesce\(decision\.status, 'undecided'\)/)
})

test('28 Multi-child invitation state remains isolated by stable child id', () => {
  const first = calendarState('available', 'selected', 'child-1')
  const second = calendarState('unavailable', 'not_selected', 'child-2')
  assert.equal(first.state, PARENT_CALENDAR_VISUAL_STATES.accepted)
  assert.equal(second.state, PARENT_CALENDAR_VISUAL_STATES.declined)
})

test('29 Duplicate names stay separated by player ids', () => {
  assert.match(migration, /unique \(match_day_id, player_id\)/)
  assert.match(matchDayPage, /player\.playerId/)
})

test('30 Existing response-email links remain token scoped and usable', () => {
  assert.match(responseFunction, /token_hash_value: hashToken\(token\)/)
  assert.match(sendFunction, /match-day-availability-confirm\?token=\$\{token\}/)
})

test('31 Existing role-selection workflow remains intact', () => {
  assert.match(matchDayPage, /selectMatchDayVolunteer/)
  assert.match(parentPage, /Volunteer role status/)
})

test('32 Desktop staff controls expose all four decisions', () => {
  for (const state of Object.values(MATCH_DAY_SQUAD_DECISIONS)) {
    assert.equal(normalizeMatchDaySquadDecision(state), state)
  }
  assert.match(matchDayPage, /sm:grid-cols-4/)
})

test('33 Mobile staff controls use a two-column non-overflowing grid', () => {
  assert.match(matchDayPage, /grid grid-cols-2 gap-2 sm:grid-cols-4/)
})

test('34 Desktop parent display names availability and squad separately', () => {
  assert.match(parentPage, /Availability submitted/)
  assert.match(parentPage, /Squad: \{squadDecision\.label\}/)
})

test('35 Mobile parent display uses wrapping status badges', () => {
  assert.match(parentPage, /flex flex-wrap gap-2/)
  assert.match(parentPage, /Squad not yet decided|squadDecision\.label/)
})

test('36 Accessible labels distinguish availability from squad selection', () => {
  assert.match(matchDayPage, /aria-label=\{`Squad decision for/)
  assert.match(matchDayPage, /aria-label=\{`Set \$\{row\.playerName \|\| 'player'\} squad decision to/)
  assert.match(parentPage, /Player availability/)
})
