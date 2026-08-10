import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { prepareParentMobileMatchInvitations } from '../apps/parent-mobile/parentInvitationPresentation.js'

const [parentAppSource, parentInvitationSource] = await Promise.all([
  readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/parent-mobile/parentInvitations.js', import.meta.url), 'utf8'),
])

function matchRequest(overrides = {}) {
  return {
    invitation_id: overrides.invitation_id || 'match-request-1',
    invitation_type: overrides.invitation_type || 'match_attendance',
    source_record_id: overrides.source_record_id || 'request-1',
    source_event_type: overrides.source_event_type || 'match_day',
    event_id: overrides.event_id || 'fixture-1',
    event_title: overrides.event_title || 'Match Day vs Test United',
    event_start: overrides.event_start || '2030-08-11T18:00:00.000Z',
    child_id: overrides.child_id || 'child-1',
    child_name: overrides.child_name || 'FP TEST Player',
    parent_link_id: overrides.parent_link_id || 'parent-link-1',
    invitation_state: overrides.invitation_state || 'active',
    response_state: overrides.response_state || 'awaiting_response',
    can_respond: overrides.can_respond ?? true,
    can_change_response: overrides.can_change_response ?? true,
    is_pending: overrides.is_pending ?? true,
    ...overrides,
  }
}

test('current canonical Match requests remain visible and are ordered before history', () => {
  const invitations = prepareParentMobileMatchInvitations([
    matchRequest({
      invitation_id: 'cancelled',
      invitation_state: 'cancelled',
      can_respond: false,
      can_change_response: false,
      is_pending: false,
      lock_reason: 'This fixture is not active.',
    }),
    matchRequest({ invitation_id: 'current' }),
    matchRequest({
      invitation_id: 'responded',
      response_state: 'available',
      is_pending: false,
    }),
    matchRequest({
      invitation_id: 'training',
      invitation_type: 'training_attendance',
      source_event_type: 'calendar_event',
    }),
  ])

  assert.deepEqual(invitations.map((invitation) => invitation.invitationId), [
    'current',
    'cancelled',
    'responded',
  ])
  assert.equal(invitations[0].canChangeResponse, true)
  assert.equal(invitations[1].invitationState, 'cancelled')
  assert.equal(invitations[1].lockReason, 'This fixture is not active.')
})

test('Parent mobile fetches the web Parent Portal invitation summary without a client date or status exclusion', () => {
  assert.match(parentInvitationSource, /supabase\.rpc\('get_parent_portal_invitation_summary'/)
  assert.match(parentInvitationSource, /parent_link_id_value: normalizedParentLinkId/)
  assert.match(parentInvitationSource, /prepareParentMobileMatchInvitations\(data\)/)
  assert.doesNotMatch(parentInvitationSource, /matchDate|Date\.now|new Date|responseDeadline.*filter|invitationState.*filter/)
})

test('Parent mobile response reuses the canonical Match invitation command and authority fields', () => {
  assert.match(parentInvitationSource, /supabase\.rpc\('respond_parent_portal_match_day_invitation'/)
  assert.match(parentInvitationSource, /parent_link_id_value: normalizedParentLinkId/)
  assert.match(parentInvitationSource, /request_id_value: invitation\.sourceRecordId/)
  assert.match(parentInvitationSource, /response_kind_value: responseKind/)
  assert.match(parentInvitationSource, /role_type_value: responseKind === 'role' \? invitation\.roleType : null/)
  assert.match(parentInvitationSource, /response_value: normalizedResponseState/)
})

test('Parent app exposes current, responded, stale, and cancelled Match request state in Invites', () => {
  assert.match(parentAppSource, /getParentMobileMatchInvitations\(selectedLink\?\.id\)/)
  assert.match(parentAppSource, /\{ key: 'invites', label: 'Invites', count: pendingInvitationCount \}/)
  assert.match(parentAppSource, /activeTab === 'invites'/)
  assert.match(parentAppSource, /Match availability request/)
  assert.match(parentAppSource, /Current response:/)
  assert.match(parentAppSource, /invitation\.canChangeResponse/)
  assert.match(parentAppSource, /invitation\.lockReason/)
  assert.match(parentAppSource, /respondToParentMobileMatchInvitation/)
})
