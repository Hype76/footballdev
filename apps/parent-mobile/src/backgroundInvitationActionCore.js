const normalize = value => String(value ?? '').trim()
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

export function getBackgroundInvitationAction(response) {
  const action = normalize(response?.actionIdentifier)
  if (!['parent_accept', 'parent_decline'].includes(action)) return null
  const request = response.notification?.request
  const data = request?.content?.data
  const invitationId = normalize(data?.invitationId).replace(/^match:/, 'match_attendance:')
  const [kind, sourceId, extra] = invitationId.split(':')
  if (data?.app !== 'parent' || data?.route !== 'invites' || !uuid.test(normalize(data?.parentLinkId))
    || !['match_attendance', 'training_attendance', 'match_role'].includes(kind) || !uuid.test(sourceId) || extra
    || !normalize(request?.identifier)) throw new Error('invitation_action_invalid')
  return { action, invitationId, kind, parentLinkId: normalize(data.parentLinkId), responseId: normalize(request.identifier), sourceId }
}

export function getBackgroundInvitationCommand(action, records, now = Date.now()) {
  const invitation = records.find(row => normalize(row.invitation_id ?? row.invitationId) === action.invitationId)
  if (!invitation || normalize(invitation.parent_link_id ?? invitation.parentLinkId) !== action.parentLinkId
    || normalize(invitation.source_record_id ?? invitation.sourceRecordId) !== action.sourceId
    || normalize(invitation.invitation_type ?? invitation.invitationType) !== action.kind
    || !['active', 'offered'].includes(normalize(invitation.invitation_state ?? invitation.invitationState))
    || ![true, 'true'].includes(invitation.can_respond ?? invitation.canRespond)
      && ![true, 'true'].includes(invitation.can_change_response ?? invitation.canChangeResponse)) throw new Error('invitation_action_unavailable')
  const deadline = Date.parse(invitation.response_deadline ?? invitation.responseDeadline)
  if (Number.isFinite(deadline) && deadline <= now) throw new Error('invitation_action_expired')
  const accepted = action.action === 'parent_accept'
  const response = action.kind === 'match_role' ? accepted ? 'yes' : 'no' : accepted ? 'available' : 'unavailable'
  if (action.kind === 'training_attendance') return {
    name: 'respond_parent_portal_training_invitation',
    args: { parent_link_id_value: action.parentLinkId, request_player_id_value: action.sourceId, response_value: response },
  }
  return {
    name: 'respond_parent_portal_match_day_invitation',
    args: { parent_link_id_value: action.parentLinkId, request_id_value: action.sourceId,
      response_kind_value: action.kind === 'match_role' ? 'role' : 'attendance',
      role_type_value: action.kind === 'match_role' ? normalize(invitation.role_type ?? invitation.roleType) : null, response_value: response },
  }
}

export async function performBackgroundInvitationAction(response, dependencies) {
  const action = getBackgroundInvitationAction(response)
  if (!action) return { ignored: true }
  const { session, client } = await dependencies.getAuthenticatedClient()
  if (!session?.user?.id || !session?.access_token) throw new Error('invitation_action_sign_in_required')
  const key = `fp.parent.notification-responses.v1.${session.user.id}`
  const history = await dependencies.readHistory(key)
  if (history.includes(action.responseId)) return { duplicate: true }
  const link = await client.from('parent_player_links').select('id').eq('id', action.parentLinkId)
    .eq('auth_user_id', session.user.id).eq('status', 'active').maybeSingle()
  if (link.error || !link.data) throw new Error('invitation_action_link_denied')
  const summary = await client.rpc('get_parent_portal_invitation_summary', { parent_link_id_value: action.parentLinkId })
  if (summary.error) throw summary.error
  const command = getBackgroundInvitationCommand(action, summary.data || [])
  // Verify the saved account again immediately before writing. The isolated client
  // keeps this operation bound to the same bearer token even during an account switch.
  if (!await dependencies.isCurrentSession(session)) throw new Error('invitation_action_account_changed')
  const result = await client.rpc(command.name, command.args)
  if (result.error) throw result.error
  if (!result.data) throw new Error('invitation_action_not_confirmed')
  await dependencies.writeHistory(key, [...history, action.responseId].slice(-32)).catch(() => {})
  if (dependencies.afterSaved) await dependencies.afterSaved({ action, session, result: result.data }).catch(() => {})
  return { saved: true, accepted: action.action === 'parent_accept', action, result: result.data }
}
