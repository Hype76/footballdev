import { supabase } from '../supabase-client.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

export function normalizeAdultPlayerInvitation(row = {}) {
  return {
    invitationId: normalizeText(row.invitation_id),
    invitationType: normalizeText(row.invitation_type),
    sourceRecordId: normalizeText(row.source_record_id),
    eventId: normalizeText(row.event_id),
    eventType: normalizeText(row.event_type),
    eventTitle: normalizeText(row.event_title) || 'Club event',
    eventStart: row.event_start ?? null,
    eventEnd: row.event_end ?? null,
    eventLocation: normalizeText(row.event_location),
    teamName: normalizeText(row.team_name),
    responseState: normalizeText(row.response_state) || 'awaiting_response',
    selectionState: normalizeText(row.selection_state) || 'not_applicable',
    canRespond: row.can_respond === true,
    lockReason: normalizeText(row.lock_reason),
    responseDeadline: row.response_deadline ?? null,
    lastRespondedAt: row.last_responded_at ?? null,
  }
}

export async function getOwnAdultPlayerInvitations() {
  const { data, error } = await supabase.rpc('get_own_adult_player_invitation_state')

  if (error) {
    console.error(error)
    throw new Error('Your invitations could not be loaded. Refresh and try again.')
  }

  return (Array.isArray(data) ? data : []).map(normalizeAdultPlayerInvitation)
}

export async function respondToOwnAdultPlayerInvitation({ invitation, responseState } = {}) {
  const normalizedResponse = normalizeText(responseState).toLowerCase()

  if (!invitation?.sourceRecordId) {
    throw new Error('This invitation could not be opened. Refresh and try again.')
  }

  const rpcName = invitation.invitationType === 'match_attendance'
    ? 'respond_own_adult_player_match_invitation'
    : invitation.invitationType === 'training_attendance'
      ? 'respond_own_adult_player_training_invitation'
      : ''

  if (!rpcName) {
    throw new Error('This event does not require a response.')
  }

  const requestField = invitation.invitationType === 'match_attendance'
    ? 'request_id_value'
    : 'request_player_id_value'
  const { data, error } = await supabase.rpc(rpcName, {
    [requestField]: invitation.sourceRecordId,
    response_value: normalizedResponse,
  })

  if (error) {
    console.error(error)
    throw new Error('Your response could not be saved. Refresh and try again.')
  }

  if (data?.success !== true) {
    const deniedError = new Error(data?.message || 'This response is not permitted.')
    deniedError.code = data?.denialCategory || 'response_denied'
    throw deniedError
  }

  return data
}
