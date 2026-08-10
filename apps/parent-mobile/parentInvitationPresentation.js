const MATCH_INVITATION_TYPES = new Set(['match_attendance', 'match_role'])

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeBoolean(value) {
  return value === true || value === 'true'
}

export function normalizeParentMobileInvitation(row = {}) {
  return {
    canChangeResponse: normalizeBoolean(row.can_change_response ?? row.canChangeResponse),
    canRespond: normalizeBoolean(row.can_respond ?? row.canRespond),
    childId: row.child_id ?? row.childId ?? '',
    childName: normalizeText(row.child_name ?? row.childName) || 'Linked child',
    eventEnd: row.event_end ?? row.eventEnd ?? '',
    eventId: row.event_id ?? row.eventId ?? '',
    eventLocation: normalizeText(row.event_location ?? row.eventLocation),
    eventStart: row.event_start ?? row.eventStart ?? '',
    eventTitle: normalizeText(row.event_title ?? row.eventTitle) || 'Match Day',
    invitationId: normalizeText(row.invitation_id ?? row.invitationId),
    invitationState: normalizeText(row.invitation_state ?? row.invitationState).toLowerCase() || 'active',
    invitationType: normalizeText(row.invitation_type ?? row.invitationType).toLowerCase(),
    isPending: normalizeBoolean(row.is_pending ?? row.isPending),
    lastRespondedAt: row.last_responded_at ?? row.lastRespondedAt ?? '',
    lockReason: normalizeText(row.lock_reason ?? row.lockReason),
    parentLinkId: row.parent_link_id ?? row.parentLinkId ?? '',
    responseDeadline: row.response_deadline ?? row.responseDeadline ?? '',
    responseState: normalizeText(row.response_state ?? row.responseState).toLowerCase() || 'awaiting_response',
    roleType: normalizeText(row.role_type ?? row.roleType).toLowerCase(),
    selectionState: normalizeText(row.selection_state ?? row.selectionState).toLowerCase() || 'not_applicable',
    sourceEventType: normalizeText(row.source_event_type ?? row.sourceEventType).toLowerCase(),
    sourceRecordId: row.source_record_id ?? row.sourceRecordId ?? '',
    teamName: normalizeText(row.team_name ?? row.teamName),
  }
}

export function isParentMobileMatchInvitation(invitation) {
  return invitation.sourceEventType === 'match_day'
    && MATCH_INVITATION_TYPES.has(invitation.invitationType)
}

function compareInvitations(left, right) {
  if (left.isPending !== right.isPending) {
    return left.isPending ? -1 : 1
  }

  return String(left.eventStart || '').localeCompare(String(right.eventStart || ''))
    || left.eventTitle.localeCompare(right.eventTitle)
    || left.invitationType.localeCompare(right.invitationType)
}

export function prepareParentMobileMatchInvitations(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeParentMobileInvitation)
    .filter(isParentMobileMatchInvitation)
    .sort(compareInvitations)
}
