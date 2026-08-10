import { supabase } from '../mobile-core/src/supabase'
import { prepareParentMobileMatchInvitations } from './parentInvitationPresentation'

const MATCH_INVITATION_TYPES = new Set(['match_attendance', 'match_role'])

function normalizeText(value) {
  return String(value ?? '').trim()
}

export async function getParentMobileMatchInvitations(parentLinkId) {
  const normalizedParentLinkId = normalizeText(parentLinkId)

  if (!normalizedParentLinkId) {
    return []
  }

  const { data, error } = await supabase.rpc('get_parent_portal_invitation_summary', {
    parent_link_id_value: normalizedParentLinkId,
  })

  if (error) {
    throw error
  }

  return prepareParentMobileMatchInvitations(data)
}

export async function respondToParentMobileMatchInvitation({ invitation, parentLinkId, responseState } = {}) {
  const normalizedParentLinkId = normalizeText(parentLinkId)
  const normalizedResponseState = normalizeText(responseState).toLowerCase()

  if (!normalizedParentLinkId || !invitation?.sourceRecordId || !invitation.canChangeResponse) {
    throw new Error('This Match request cannot be changed. Refresh and try again.')
  }

  if (!MATCH_INVITATION_TYPES.has(invitation.invitationType)) {
    throw new Error('This invitation is not a Match request.')
  }

  const responseKind = invitation.invitationType === 'match_role' ? 'role' : 'attendance'
  const allowedResponses = responseKind === 'role'
    ? new Set(['yes', 'no'])
    : new Set(['available', 'unavailable', 'maybe'])

  if (!allowedResponses.has(normalizedResponseState)) {
    throw new Error('Choose a valid Match response.')
  }

  const { data, error } = await supabase.rpc('respond_parent_portal_match_day_invitation', {
    parent_link_id_value: normalizedParentLinkId,
    request_id_value: invitation.sourceRecordId,
    response_kind_value: responseKind,
    role_type_value: responseKind === 'role' ? invitation.roleType : null,
    response_value: normalizedResponseState,
  })

  if (error) {
    throw error
  }

  return data
}
