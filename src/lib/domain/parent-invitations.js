import { supabase } from '../supabase-client.js'

const ATTENDANCE_RESPONSE_OPTIONS = [
  { value: 'available', label: 'Accept' },
  { value: 'unavailable', label: 'Decline' },
  { value: 'maybe', label: 'Maybe' },
]

const ROLE_RESPONSE_OPTIONS = [
  { value: 'yes', label: 'Accept offer' },
  { value: 'no', label: 'Decline offer' },
]

const ACTION_REQUIRED_RESPONSES = new Set(['awaiting_response', 'no_response'])
const ACCEPTED_RESPONSES = new Set(['accepted', 'available', 'yes'])
const DECLINED_RESPONSES = new Set(['declined', 'unavailable', 'no'])
const PLAYER_INVITATION_TYPES = new Set(['calendar_attendance', 'training_attendance', 'match_attendance'])
const CLOSED_INVITATION_STATES = new Set(['cancelled', 'closed', 'expired', 'withdrawn'])
const CLOSED_EVENT_STATES = new Set(['cancelled', 'postponed', 'full_time', 'concluded', 'closed'])
const COMPLETED_EVENT_STATES = new Set(['full_time', 'concluded'])

export const PARENT_CALENDAR_VISUAL_STATES = Object.freeze({
  accepted: 'accepted',
  declined: 'declined',
  actionRequired: 'action_required',
  informational: 'informational',
  past: 'past',
  cancelledOrPostponed: 'cancelled_or_postponed',
})

export const PARENT_PLAYER_PARTICIPATION_STATES = Object.freeze({
  accepted: 'accepted',
  available: 'available',
  declined: 'declined',
  unavailable: 'unavailable',
  responseRequired: 'response_required',
  noResponseRequired: 'no_response_required',
  selected: 'selected',
  confirmed: 'confirmed',
  closed: 'closed',
})

export const PARENT_VOLUNTEER_STATES = Object.freeze({
  noOffer: 'no_offer',
  responseRequired: 'response_required',
  accepted: 'accepted',
  declined: 'declined',
  selected: 'selected',
  confirmed: 'confirmed',
  withdrawn: 'withdrawn',
  locked: 'locked',
  closed: 'closed',
})

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeBoolean(value) {
  return value === true || value === 'true'
}

function normalizeInvitationType(value) {
  const normalizedValue = normalizeText(value).toLowerCase()
  return ['calendar_attendance', 'training_attendance', 'match_attendance', 'match_role'].includes(normalizedValue)
    ? normalizedValue
    : 'calendar_attendance'
}

export function normalizeParentInvitation(row = {}) {
  const invitationType = normalizeInvitationType(row.invitation_type ?? row.invitationType)
  const eventId = row.event_id ?? row.eventId ?? ''
  const childId = row.child_id ?? row.childId ?? ''

  return {
    invitationId: normalizeText(row.invitation_id ?? row.invitationId),
    invitationType,
    sourceRecordId: row.source_record_id ?? row.sourceRecordId ?? '',
    sourceType: normalizeText(row.source_type ?? row.sourceType),
    eventId,
    eventKey: `${normalizeText(row.source_event_type ?? row.sourceEventType)}:${eventId}:${childId}`,
    eventType: normalizeText(row.event_type ?? row.eventType) || 'general',
    eventTitle: normalizeText(row.event_title ?? row.eventTitle) || 'Club event',
    eventDate: normalizeText(row.event_date ?? row.eventDate),
    eventStart: row.event_start ?? row.eventStart ?? '',
    eventEnd: row.event_end ?? row.eventEnd ?? '',
    eventLocation: normalizeText(row.event_location ?? row.eventLocation),
    teamName: normalizeText(row.team_name ?? row.teamName),
    kickoffTimeTbc: normalizeBoolean(row.kickoff_time_tbc ?? row.kickoffTimeTbc),
    childId,
    childName: normalizeText(row.child_name ?? row.childName) || 'Linked child',
    parentLinkId: row.parent_link_id ?? row.parentLinkId ?? '',
    roleType: normalizeText(row.role_type ?? row.roleType).toLowerCase(),
    invitationState: normalizeText(row.invitation_state ?? row.invitationState).toLowerCase() || 'active',
    responseState: normalizeText(row.response_state ?? row.responseState).toLowerCase() || 'awaiting_response',
    selectionState: normalizeText(row.selection_state ?? row.selectionState).toLowerCase() || 'not_applicable',
    canRespond: normalizeBoolean(row.can_respond ?? row.canRespond),
    canChangeResponse: normalizeBoolean(row.can_change_response ?? row.canChangeResponse),
    lockReason: normalizeText(row.lock_reason ?? row.lockReason),
    responseDeadline: row.response_deadline ?? row.responseDeadline ?? '',
    lastRespondedAt: row.last_responded_at ?? row.lastRespondedAt ?? '',
  }
}

export function getParentInvitationTypeLabel(invitation = {}) {
  if (invitation.invitationType === 'match_role') {
    const roleLabels = {
      scorer: 'Scorer offer',
      referee: 'Referee offer',
      linesman: 'Linesman offer',
    }
    return roleLabels[invitation.roleType] || 'Match Day role offer'
  }

  if (invitation.invitationType === 'training_attendance') {
    return 'Training attendance'
  }

  if (invitation.invitationType === 'match_attendance') {
    return 'Match attendance'
  }

  return 'Event invitation'
}

export function getParentInvitationStatus(invitation = {}) {
  if (invitation.selectionState === 'selected') {
    return {
      label: 'Selected by staff',
      detail: invitation.lockReason || 'Staff have confirmed this Match Day role.',
      tone: 'selected',
    }
  }

  if (invitation.selectionState === 'selected_elsewhere') {
    return {
      label: 'Not selected',
      detail: invitation.lockReason || 'Another volunteer has been selected for this role.',
      tone: 'closed',
    }
  }

  if (['cancelled', 'closed', 'expired', 'withdrawn'].includes(invitation.invitationState)) {
    return {
      label: invitation.invitationState === 'cancelled' ? 'Cancelled' : 'Closed',
      detail: invitation.lockReason || 'This invitation can no longer be changed.',
      tone: 'closed',
    }
  }

  const responseLabels = {
    accepted: 'Accepted',
    available: 'Accepted',
    declined: 'Declined',
    unavailable: 'Declined',
    maybe: 'Maybe',
    yes: 'Accepted',
    no: 'Declined',
    awaiting_response: 'Awaiting response',
    no_response: 'Awaiting response',
    not_required: 'No response required',
    recorded: 'Response recorded',
  }

  const label = responseLabels[invitation.responseState] || 'Awaiting response'
  return {
    label,
    detail: invitation.lockReason || (invitation.canChangeResponse ? 'You can change this response while the invitation remains open.' : ''),
    tone: label === 'Accepted'
      ? 'accepted'
      : label === 'Declined'
        ? 'declined'
        : label === 'Awaiting response'
          ? 'waiting'
          : 'quiet',
  }
}

export function getParentInvitationCategory(invitation = {}) {
  const status = getParentInvitationStatus(invitation)

  if (invitation.canRespond && ['awaiting_response', 'no_response'].includes(invitation.responseState)) {
    return 'needs_response'
  }

  if (invitation.selectionState === 'selected') {
    return 'selected'
  }

  if (status.label === 'Accepted' || status.label === 'Maybe') {
    return 'accepted'
  }

  if (status.label === 'Declined') {
    return 'declined'
  }

  if (['cancelled', 'closed', 'expired', 'withdrawn'].includes(invitation.invitationState) || invitation.selectionState === 'selected_elsewhere') {
    return 'closed'
  }

  return 'information'
}

function parseTimestamp(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime()
  }

  const normalizedValue = normalizeText(value)
  if (!normalizedValue) {
    return null
  }

  const parsedDate = new Date(normalizedValue)
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate.getTime()
}

function getEventEndTimestamp(event = {}) {
  const explicitEnd = parseTimestamp(event.eventEnd ?? event.endsAt ?? event.end)
  if (explicitEnd !== null) {
    return explicitEnd
  }

  const dateOnly = normalizeText(event.eventDate ?? event.date)
  const dateMatch = dateOnly.match(/^(\d{4}-\d{2}-\d{2})/)
  if (dateMatch) {
    return parseTimestamp(`${dateMatch[1]}T23:59:59.999`)
  }

  const start = parseTimestamp(event.eventStart ?? event.startsAt ?? event.start)
  if (start === null) {
    return null
  }

  const startDate = new Date(start)
  startDate.setHours(23, 59, 59, 999)
  return startDate.getTime()
}

function getScopedPlayerInvitations(invitations = [], childId = '') {
  const normalizedChildId = normalizeText(childId)
  const playerInvitations = (Array.isArray(invitations) ? invitations : [])
    .filter((invitation) => PLAYER_INVITATION_TYPES.has(invitation.invitationType))

  if (!normalizedChildId) {
    return playerInvitations
  }

  return playerInvitations.filter((invitation) => normalizeText(invitation.childId) === normalizedChildId)
}

export function getParentPlayerParticipationState(invitations = [], options = {}) {
  const playerInvitations = getScopedPlayerInvitations(invitations, options.childId)
  const actionableInvitations = playerInvitations.filter((invitation) =>
    invitation.canRespond === true && ACTION_REQUIRED_RESPONSES.has(invitation.responseState))

  if (actionableInvitations.length > 0) {
    return {
      participationState: PARENT_PLAYER_PARTICIPATION_STATES.responseRequired,
      state: PARENT_CALENDAR_VISUAL_STATES.actionRequired,
      label: actionableInvitations.length > 1 ? `${actionableInvitations.length} player responses needed` : 'Player response needed',
      actionCount: actionableInvitations.length,
    }
  }

  if (playerInvitations.some((invitation) => DECLINED_RESPONSES.has(invitation.responseState))) {
    return {
      participationState: PARENT_PLAYER_PARTICIPATION_STATES.unavailable,
      state: PARENT_CALENDAR_VISUAL_STATES.declined,
      label: 'Player unavailable',
      actionCount: 0,
    }
  }

  if (playerInvitations.some((invitation) => ['selected', 'confirmed'].includes(invitation.selectionState)
    || ['selected', 'confirmed'].includes(invitation.responseState))) {
    return {
      participationState: PARENT_PLAYER_PARTICIPATION_STATES.selected,
      state: PARENT_CALENDAR_VISUAL_STATES.accepted,
      label: 'Player selected',
      actionCount: 0,
    }
  }

  if (playerInvitations.some((invitation) => ACCEPTED_RESPONSES.has(invitation.responseState))) {
    return {
      participationState: PARENT_PLAYER_PARTICIPATION_STATES.available,
      state: PARENT_CALENDAR_VISUAL_STATES.accepted,
      label: 'Player available',
      actionCount: 0,
    }
  }

  if (playerInvitations.some((invitation) => invitation.responseState === 'maybe')) {
    return {
      participationState: PARENT_PLAYER_PARTICIPATION_STATES.noResponseRequired,
      state: PARENT_CALENDAR_VISUAL_STATES.informational,
      label: 'Player response: Maybe',
      actionCount: 0,
    }
  }

  if (playerInvitations.some((invitation) => invitation.selectionState === 'selected_elsewhere')) {
    return {
      participationState: PARENT_PLAYER_PARTICIPATION_STATES.noResponseRequired,
      state: PARENT_CALENDAR_VISUAL_STATES.informational,
      label: 'Player not selected',
      actionCount: 0,
    }
  }

  if (playerInvitations.length > 0 && playerInvitations.every((invitation) => CLOSED_INVITATION_STATES.has(invitation.invitationState))) {
    return {
      participationState: PARENT_PLAYER_PARTICIPATION_STATES.closed,
      state: PARENT_CALENDAR_VISUAL_STATES.informational,
      label: 'Player availability closed',
      actionCount: 0,
    }
  }

  return {
    participationState: PARENT_PLAYER_PARTICIPATION_STATES.noResponseRequired,
    state: PARENT_CALENDAR_VISUAL_STATES.informational,
    label: 'Information only',
    actionCount: 0,
  }
}

function getVolunteerRoleLabel(invitation = {}) {
  const roleLabels = {
    scorer: 'Scorer',
    referee: 'Referee',
    linesman: 'Linesman',
  }

  return roleLabels[invitation.roleType] || 'Volunteer role'
}

function getVolunteerDetail(invitation = {}) {
  const roleLabel = getVolunteerRoleLabel(invitation)
  const roleName = roleLabel.toLowerCase()

  if (invitation.selectionState === 'selected') {
    return { key: invitation.invitationId || roleName, roleType: invitation.roleType, state: PARENT_VOLUNTEER_STATES.selected, label: `Selected as ${roleName}` }
  }

  if (invitation.selectionState === 'selected_elsewhere') {
    return { key: invitation.invitationId || roleName, roleType: invitation.roleType, state: PARENT_VOLUNTEER_STATES.closed, label: `${roleLabel} not selected` }
  }

  if (CLOSED_INVITATION_STATES.has(invitation.invitationState)) {
    const state = invitation.invitationState === 'withdrawn'
      ? PARENT_VOLUNTEER_STATES.withdrawn
      : PARENT_VOLUNTEER_STATES.closed
    const stateLabel = invitation.invitationState === 'cancelled' ? 'cancelled' : invitation.invitationState === 'withdrawn' ? 'withdrawn' : 'closed'
    return { key: invitation.invitationId || roleName, roleType: invitation.roleType, state, label: `${roleLabel} ${stateLabel}` }
  }

  if (ACTION_REQUIRED_RESPONSES.has(invitation.responseState)) {
    const state = invitation.canRespond === true ? PARENT_VOLUNTEER_STATES.responseRequired : PARENT_VOLUNTEER_STATES.locked
    const label = invitation.canRespond === true ? `${roleLabel} response needed` : `${roleLabel} response locked`
    return { key: invitation.invitationId || roleName, roleType: invitation.roleType, state, label }
  }

  if (ACCEPTED_RESPONSES.has(invitation.responseState)) {
    return { key: invitation.invitationId || roleName, roleType: invitation.roleType, state: PARENT_VOLUNTEER_STATES.accepted, label: `${roleLabel} accepted` }
  }

  if (DECLINED_RESPONSES.has(invitation.responseState)) {
    return { key: invitation.invitationId || roleName, roleType: invitation.roleType, state: PARENT_VOLUNTEER_STATES.declined, label: `${roleLabel} declined` }
  }

  return { key: invitation.invitationId || roleName, roleType: invitation.roleType, state: PARENT_VOLUNTEER_STATES.locked, label: `${roleLabel} response recorded` }
}

export function getParentVolunteerState(invitations = [], options = {}) {
  const childId = normalizeText(options.childId)
  const roleInvitations = (Array.isArray(invitations) ? invitations : [])
    .filter((invitation) => invitation.invitationType === 'match_role'
      && (!childId || normalizeText(invitation.childId) === childId))
  const details = roleInvitations.map(getVolunteerDetail)
  const statePriority = [
    PARENT_VOLUNTEER_STATES.responseRequired,
    PARENT_VOLUNTEER_STATES.selected,
    PARENT_VOLUNTEER_STATES.confirmed,
    PARENT_VOLUNTEER_STATES.accepted,
    PARENT_VOLUNTEER_STATES.declined,
    PARENT_VOLUNTEER_STATES.withdrawn,
    PARENT_VOLUNTEER_STATES.locked,
    PARENT_VOLUNTEER_STATES.closed,
  ]
  const state = statePriority.find((candidate) => details.some((detail) => detail.state === candidate))
    || PARENT_VOLUNTEER_STATES.noOffer

  return {
    state,
    details,
    actionCount: details.filter((detail) => detail.state === PARENT_VOLUNTEER_STATES.responseRequired).length,
  }
}

export function getParentCalendarVisualState(event = {}, options = {}) {
  const invitations = Array.isArray(event.invitations) ? event.invitations : []
  const childId = normalizeText(options.childId ?? event.childId ?? event.data?.childId)
  const playerState = getParentPlayerParticipationState(invitations, { childId })
  const volunteerState = getParentVolunteerState(invitations, { childId })
  const supplementaryState = {
    playerState: playerState.participationState,
    volunteerState: volunteerState.state,
    volunteerDetails: volunteerState.details,
    volunteerActionCount: volunteerState.actionCount,
  }
  const eventStatus = normalizeText(event.eventStatus ?? event.status).toLowerCase()
  const playerInvitations = getScopedPlayerInvitations(invitations, childId)
  const invitationCancelled = playerInvitations.length > 0 && playerInvitations.every((invitation) => invitation.invitationState === 'cancelled')
  const cancelled = Boolean(event.cancelledAt) || eventStatus === 'cancelled' || invitationCancelled
  const postponed = eventStatus === 'postponed'
  const now = parseTimestamp(options.now) ?? Date.now()
  const eventEnd = getEventEndTimestamp(event)
  const isPast = COMPLETED_EVENT_STATES.has(eventStatus) || (eventEnd !== null && eventEnd < now)

  if (isPast) {
    const historicalLabel = cancelled
      ? 'Cancelled'
      : postponed
        ? 'Postponed'
        : playerState.label

    return {
      state: PARENT_CALENDAR_VISUAL_STATES.past,
      label: historicalLabel === 'Information only' ? 'Past' : `Past, ${historicalLabel}`,
      historicalLabel,
      actionCount: 0,
      isPast: true,
      isActionable: false,
      ...supplementaryState,
    }
  }

  if (cancelled || postponed) {
    const label = postponed ? 'Postponed' : 'Cancelled'
    return {
      state: PARENT_CALENDAR_VISUAL_STATES.cancelledOrPostponed,
      label,
      historicalLabel: label,
      actionCount: 0,
      isPast: false,
      isActionable: false,
      ...supplementaryState,
    }
  }

  if (CLOSED_EVENT_STATES.has(eventStatus)) {
    return {
      state: PARENT_CALENDAR_VISUAL_STATES.informational,
      label: playerState.label === 'Information only' ? 'Closed' : playerState.label,
      historicalLabel: playerState.label,
      actionCount: 0,
      isPast: false,
      isActionable: false,
      ...supplementaryState,
    }
  }

  return {
    ...playerState,
    historicalLabel: playerState.label,
    isPast: false,
    isActionable: playerState.state === PARENT_CALENDAR_VISUAL_STATES.actionRequired,
    ...supplementaryState,
  }
}

export function getParentInvitationResponseOptions(invitation = {}) {
  if (invitation.invitationType === 'match_role') {
    return ROLE_RESPONSE_OPTIONS
  }

  if (['training_attendance', 'match_attendance'].includes(invitation.invitationType)) {
    return ATTENDANCE_RESPONSE_OPTIONS
  }

  return []
}

export function groupParentInvitationsByEvent(invitations = []) {
  const groups = new Map()

  invitations.forEach((invitation) => {
    const key = invitation.eventKey
    const current = groups.get(key)

    if (current) {
      current.invitations.push(invitation)
      current.eventStart = current.eventStart || invitation.eventStart
      current.eventEnd = current.eventEnd || invitation.eventEnd
      current.eventDate = current.eventDate || invitation.eventDate
      current.kickoffTimeTbc = current.kickoffTimeTbc || invitation.kickoffTimeTbc
      current.eventLocation = current.eventLocation || invitation.eventLocation
      return
    }

    groups.set(key, {
      key,
      eventId: invitation.eventId,
      sourceEventType: invitation.eventKey.split(':')[0],
      eventType: invitation.eventType,
      eventTitle: invitation.eventTitle,
      eventDate: invitation.eventDate,
      eventStart: invitation.eventStart,
      eventEnd: invitation.eventEnd,
      eventLocation: invitation.eventLocation,
      teamName: invitation.teamName,
      kickoffTimeTbc: invitation.kickoffTimeTbc,
      childId: invitation.childId,
      childName: invitation.childName,
      invitations: [invitation],
    })
  })

  return [...groups.values()]
    .map((group) => ({
      ...group,
      invitations: [...group.invitations].sort((left, right) =>
        left.invitationType.localeCompare(right.invitationType) || left.roleType.localeCompare(right.roleType)),
    }))
    .sort((left, right) =>
      String(left.eventStart || left.eventDate || '').localeCompare(String(right.eventStart || right.eventDate || ''))
      || left.eventTitle.localeCompare(right.eventTitle))
}

export async function getParentPortalInvitationState({ parentLinkId } = {}) {
  const normalizedParentLinkId = normalizeText(parentLinkId)

  if (!normalizedParentLinkId) {
    return []
  }

  const { data, error } = await supabase.rpc('get_parent_portal_invitation_state', {
    parent_link_id_value: normalizedParentLinkId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeParentInvitation)
}

export async function respondToParentPortalInvitation({ parentLinkId, invitation, responseState } = {}) {
  const normalizedParentLinkId = normalizeText(parentLinkId)
  const normalizedResponse = normalizeText(responseState).toLowerCase()

  if (!normalizedParentLinkId || !invitation?.sourceRecordId) {
    throw new Error('This invitation could not be opened. Refresh the Parent Portal and try again.')
  }

  if (invitation.invitationType === 'training_attendance') {
    const { data, error } = await supabase.rpc('respond_parent_portal_training_invitation', {
      parent_link_id_value: normalizedParentLinkId,
      request_player_id_value: invitation.sourceRecordId,
      response_value: normalizedResponse,
    })

    if (error) {
      console.error(error)
      throw error
    }

    return data
  }

  if (['match_attendance', 'match_role'].includes(invitation.invitationType)) {
    const { data, error } = await supabase.rpc('respond_parent_portal_match_day_invitation', {
      parent_link_id_value: normalizedParentLinkId,
      request_id_value: invitation.sourceRecordId,
      response_kind_value: invitation.invitationType === 'match_role' ? 'role' : 'attendance',
      role_type_value: invitation.invitationType === 'match_role' ? invitation.roleType : null,
      response_value: normalizedResponse,
    })

    if (error) {
      console.error(error)
      throw error
    }

    return data
  }

  throw new Error('This invitation does not require a response.')
}
