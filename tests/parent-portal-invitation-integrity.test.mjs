import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { migrationSourceUrl } from './helpers/migration-source.mjs'
import {
  getParentInvitationCategory,
  getParentInvitationResponseOptions,
  getParentInvitationStatus,
  groupParentInvitationsByEvent,
  normalizeParentInvitation,
} from '../src/lib/domain/parent-invitations.js'

const migrationUrl = migrationSourceUrl('20260713150000_parent_portal_calendar_invite_integrity.sql', 'active')
const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const parentInvitationDomainUrl = new URL('../src/lib/domain/parent-invitations.js', import.meta.url)

async function readMigration() {
  return readFile(migrationUrl, 'utf8')
}

function getFunctionSection(source, functionName) {
  const start = source.indexOf(`create or replace function public.${functionName}`)
  assert.notEqual(start, -1, `${functionName} should exist`)
  const nextFunction = source.indexOf('\ncreate or replace function public.', start + 1)
  return source.slice(start, nextFunction === -1 ? source.length : nextFunction)
}

test('shared invitation normalizer keeps stable event, child, request, and role identities', () => {
  const invitation = normalizeParentInvitation({
    invitation_id: 'match_role:request-1:referee',
    invitation_type: 'match_role',
    source_record_id: 'request-1',
    source_type: 'match_day',
    source_event_type: 'match_day',
    event_id: 'event-1',
    child_id: 'child-1',
    child_name: 'Alex Player',
    role_type: 'referee',
    invitation_state: 'offered',
    response_state: 'awaiting_response',
    selection_state: 'not_selected',
    can_respond: true,
    can_change_response: true,
  })

  assert.equal(invitation.invitationId, 'match_role:request-1:referee')
  assert.equal(invitation.sourceRecordId, 'request-1')
  assert.equal(invitation.eventKey, 'match_day:event-1:child-1')
  assert.equal(invitation.roleType, 'referee')
  assert.equal(invitation.canChangeResponse, true)
})

test('siblings and multiple role offers stay separate while one child event is grouped', () => {
  const invitations = [
    ['child-1', 'scorer'],
    ['child-1', 'referee'],
    ['child-2', 'scorer'],
  ].map(([childId, roleType], index) => normalizeParentInvitation({
    invitation_id: `invite-${index}`,
    invitation_type: 'match_role',
    source_record_id: `request-${childId}`,
    source_event_type: 'match_day',
    event_id: 'match-1',
    child_id: childId,
    child_name: childId,
    role_type: roleType,
  }))

  const groups = groupParentInvitationsByEvent(invitations)
  assert.equal(groups.length, 2)
  assert.deepEqual(groups.find((group) => group.childId === 'child-1').invitations.map((item) => item.roleType), ['referee', 'scorer'])
  assert.equal(groups.find((group) => group.childId === 'child-2').invitations.length, 1)
})

test('offered, accepted, declined, selected, unavailable, closed, and informational states remain distinct', () => {
  const offered = normalizeParentInvitation({ invitation_type: 'match_role', response_state: 'awaiting_response', can_respond: true })
  const accepted = normalizeParentInvitation({ invitation_type: 'match_role', response_state: 'accepted' })
  const declined = normalizeParentInvitation({ invitation_type: 'match_role', response_state: 'declined' })
  const selected = normalizeParentInvitation({ invitation_type: 'match_role', response_state: 'accepted', selection_state: 'selected' })
  const unavailable = normalizeParentInvitation({ invitation_type: 'match_role', response_state: 'accepted', selection_state: 'selected_elsewhere' })
  const closed = normalizeParentInvitation({ invitation_type: 'match_role', invitation_state: 'closed', response_state: 'awaiting_response' })
  const informational = normalizeParentInvitation({ invitation_type: 'calendar_attendance', response_state: 'not_required' })

  assert.equal(getParentInvitationStatus(offered).label, 'Awaiting response')
  assert.equal(getParentInvitationStatus(accepted).label, 'Accepted')
  assert.equal(getParentInvitationStatus(declined).label, 'Declined')
  assert.equal(getParentInvitationStatus(selected).label, 'Selected by staff')
  assert.equal(getParentInvitationStatus(unavailable).label, 'Not selected')
  assert.equal(getParentInvitationStatus(closed).label, 'Closed')
  assert.equal(getParentInvitationStatus(informational).label, 'No response required')
  assert.equal(getParentInvitationCategory(offered), 'needs_response')
  assert.equal(getParentInvitationCategory(selected), 'selected')
})

test('attendance and role offers expose only their supported response transitions', () => {
  const attendance = normalizeParentInvitation({ invitation_type: 'match_attendance' })
  const training = normalizeParentInvitation({ invitation_type: 'training_attendance' })
  const role = normalizeParentInvitation({ invitation_type: 'match_role' })
  const information = normalizeParentInvitation({ invitation_type: 'calendar_attendance' })

  assert.deepEqual(getParentInvitationResponseOptions(attendance).map((option) => option.value), ['available', 'unavailable', 'maybe'])
  assert.deepEqual(getParentInvitationResponseOptions(training).map((option) => option.value), ['available', 'unavailable', 'maybe'])
  assert.deepEqual(getParentInvitationResponseOptions(role).map((option) => option.value), ['yes', 'no'])
  assert.deepEqual(getParentInvitationResponseOptions(information), [])
})

test('read model repairs null parent link calendar invites through authenticated child scope', async () => {
  const migration = await readMigration()
  const readModel = getFunctionSection(migration, 'get_parent_portal_invitation_state')
  const calendarStart = readModel.indexOf('calendar_items as (')
  const calendarEnd = readModel.indexOf('training_items as (', calendarStart)
  const calendarSection = readModel.slice(calendarStart, calendarEnd)

  assert.match(readModel, /where link\.id = parent_link_id_value[\s\S]*link\.auth_user_id = auth\.uid\(\)[\s\S]*link\.status = 'active'/)
  assert.match(calendarSection, /invite\.club_id = link\.club_id[\s\S]*invite\.team_id = link\.team_id[\s\S]*invite\.player_id = link\.player_id/)
  assert.doesNotMatch(calendarSection, /invite\.parent_link_id = link\.id/)
  assert.match(calendarSection, /event\.parent_visible is true and event\.parent_audience = 'involved_players'/)
})

test('read model includes training, Match Day attendance, and separate supported role offers', async () => {
  const migration = await readMigration()
  const readModel = getFunctionSection(migration, 'get_parent_portal_invitation_state')

  assert.match(readModel, /'training_attendance'::text as invitation_type/)
  assert.match(readModel, /'match_attendance'::text as invitation_type/)
  assert.match(readModel, /'match_role'::text as invitation_type/)
  assert.match(readModel, /link\.team_id as link_team_id/)
  assert.match(readModel, /availability_request\.team_id = match_day\.link_team_id/)
  assert.match(readModel, /\('scorer'::text, match_day\.request_scorer, request\.volunteer_scorer_response\)/)
  assert.match(readModel, /\('linesman'::text, match_day\.request_linesman, request\.volunteer_linesman_response\)/)
  assert.match(readModel, /\('referee'::text, match_day\.request_referee, request\.volunteer_referee_response\)/)
  assert.match(readModel, /assignment\.parent_link_id = match_day\.link_id then 'selected'/)
  assert.match(readModel, /assignment\.id is not null then 'selected_elsewhere'/)
  assert.match(readModel, /where match_day\.team_id = match_day\.link_team_id[\s\S]*role_offer\.is_requested is true/)
})

test('Match Day response RPC fails closed across parent, child, club, team, deadline, and final selection boundaries', async () => {
  const migration = await readMigration()
  const rpc = getFunctionSection(migration, 'respond_parent_portal_match_day_invitation')

  assert.match(rpc, /link\.auth_user_id = auth\.uid\(\)/)
  assert.match(rpc, /request\.club_id = link_row\.club_id/)
  assert.match(rpc, /request\.team_id = link_row\.team_id/)
  assert.match(rpc, /request\.player_id = link_row\.player_id/)
  assert.match(rpc, /request\.parent_link_id = link_row\.id[\s\S]*lower\(request\.recipient_email\) = lower\(link_row\.email\)/)
  assert.match(rpc, /request_row\.status = 'expired' or request_row\.expires_at <= now\(\)/)
  assert.match(rpc, /match_row\.status in \('cancelled', 'postponed', 'full_time'\)/)
  assert.match(rpc, /match_row\.concluded_at is not null/)
  assert.match(rpc, /from public\.match_day_role_assignments assignment[\s\S]*assignment\.role = normalized_role/)
  assert.match(rpc, /Staff have completed the selection for this role/)
  assert.match(rpc, /public\.submit_match_day_availability_response/)
  assert.doesNotMatch(rpc, /insert into public\.match_day_role_assignments/i)
})

test('Training response RPC verifies ownership and rejects cancelled, expired, or started sessions', async () => {
  const migration = await readMigration()
  const rpc = getFunctionSection(migration, 'respond_parent_portal_training_invitation')

  assert.match(rpc, /link\.auth_user_id = auth\.uid\(\)/)
  assert.match(rpc, /request_player\.club_id = link_row\.club_id/)
  assert.match(rpc, /request_player\.team_id = link_row\.team_id/)
  assert.match(rpc, /request_player\.player_id = link_row\.player_id/)
  assert.match(rpc, /request_player\.parent_link_id = link_row\.id[\s\S]*lower\(request_player\.recipient_email\) = lower\(link_row\.email\)/)
  assert.match(rpc, /request_player_row\.status in \('cancelled', 'expired'\)/)
  assert.match(rpc, /event_row\.cancelled_at is not null/)
  assert.match(rpc, /request_row\.occurrence_starts_at <= now\(\)/)
  assert.match(rpc, /public\.submit_training_availability_response/)
})

test('new parent invitation RPCs are authenticated only and do not broaden anonymous access', async () => {
  const migration = await readMigration()

  assert.match(migration, /revoke execute on function public\.get_parent_portal_invitation_state\(uuid\) from anon;/)
  assert.match(migration, /revoke execute on function public\.respond_parent_portal_match_day_invitation\(uuid, uuid, text, text, text\) from anon;/)
  assert.match(migration, /revoke execute on function public\.respond_parent_portal_training_invitation\(uuid, uuid, text\) from anon;/)
  assert.match(migration, /grant execute on function public\.get_parent_portal_invitation_state\(uuid\) to authenticated, service_role;/)
  assert.doesNotMatch(migration, /grant execute on function public\.(get_parent_portal_invitation_state|respond_parent_portal_match_day_invitation|respond_parent_portal_training_invitation)[^;]+to anon;/)
})

test('Parent Calendar modal and Invites use the same invitation state and refresh after mutation', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')
  const modalStart = source.indexOf('function ParentCalendarEventModal')
  const modalEnd = source.indexOf('const parentInvitationSections', modalStart)
  const modal = source.slice(modalStart, modalEnd)
  const inviteStart = source.indexOf('function ParentUpcomingEvents')
  const inviteEnd = source.indexOf('function ParentPortalSignOutButton', inviteStart)
  const invites = source.slice(inviteStart, inviteEnd)
  const mutationStart = source.indexOf('const handleParentInvitationResponse')
  const mutationEnd = source.indexOf('useEffect(() => {', mutationStart)
  const mutation = source.slice(mutationStart, mutationEnd)

  assert.match(source, /getParentPortalInvitationState\(\{ parentLinkId: selectedLink\.id \}\)/)
  assert.match(source, /visibleCalendarEvents\.find\(\(event\) => event\.id === selectedCalendarEventId\)[\s\S]*parentCalendarEvents\.find\(\(event\) => event\.id === selectedCalendarEventId\)/)
  assert.match(modal, /Child attendance/)
  assert.match(modal, /Match Day roles/)
  assert.match(modal, /No attendance response is required for this event/)
  assert.match(modal, /No Match Day role has been offered for this event/)
  assert.match(source, /\{ id: 'needs_response', label: 'Needs response' \}/)
  assert.match(source, /\{ id: 'selected', label: 'Confirmed or selected' \}/)
  assert.match(source, /\{ id: 'closed', label: 'Closed or past' \}/)
  assert.match(invites, /View event/)
  assert.match(mutation, /respondToParentPortalInvitation/)
  assert.match(mutation, /refreshInvitationViews\(\)/)
  assert.match(source, /setParentInvitations\(nextParentInvitations\)/)
  assert.match(source, /setMatches\(nextMatches\)/)
})

test('child switching clears stale invitation details while new data loads', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')
  const loadStart = source.indexOf('async function runLoad')
  const loadEnd = source.indexOf('void runLoad', loadStart)
  const load = source.slice(loadStart, loadEnd)

  assert.match(load, /if \(showLoading\) \{[\s\S]*setSelectedCalendarEventId\(''\)[\s\S]*setParentInvitations\(\[\]\)[\s\S]*setSharedCalendarEvents\(\[\]\)/)
})

test('parent invitation domain does not expose contact fields or persist response state in browser storage', async () => {
  const source = await readFile(parentInvitationDomainUrl, 'utf8')
  const normalizerStart = source.indexOf('export function normalizeParentInvitation')
  const normalizerEnd = source.indexOf('export function getParentInvitationTypeLabel', normalizerStart)
  const normalizer = source.slice(normalizerStart, normalizerEnd)

  assert.doesNotMatch(normalizer, /recipientEmail|parentEmail|parentContact|selectedByEmail/)
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/)
  assert.match(source, /supabase\.rpc\('get_parent_portal_invitation_state'/)
  assert.match(source, /supabase\.rpc\('respond_parent_portal_match_day_invitation'/)
  assert.match(source, /supabase\.rpc\('respond_parent_portal_training_invitation'/)
})
