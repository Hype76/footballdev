const text = value => String(value ?? '').trim().toLowerCase()

export function getParentMatchAttendanceInvitation(match, invitations = [], link = {}) {
  if (!match?.id || !link.id || link.linkType !== 'parent' || match.isFanView) return null
  return invitations.find(invitation => invitation.invitationType === 'match_attendance'
    && invitation.eventId === match.id
    && invitation.parentLinkId === link.id
    && invitation.childId === link.playerId) || null
}

export function canChangeParentMatchAvailability(match, invitation, link = {}, now = Date.now()) {
  return Boolean(link.linkType === 'parent' && !match?.isFanView
    && invitation?.parentLinkId === link.id && invitation?.childId === link.playerId
    && invitation?.eventId === match?.id && invitation?.invitationType === 'match_attendance' && invitation?.sourceRecordId
    && ['active', 'offered'].includes(invitation.invitationState)
    && (invitation.canRespond || invitation.canChangeResponse)
    && (!invitation.responseDeadline || Date.parse(invitation.responseDeadline) > now)
    && !['cancelled', 'postponed', 'full_time'].includes(match?.status)
    && !match?.concludedAt)
}

export function getParentMatchAvailability(match = {}, invitation, link = {}, now = Date.now()) {
  const status = text(match.availabilityStatus)
  if (['available', 'yes'].includes(status)) return { label: 'Available', tone: 'success', icon: 'check-circle' }
  if (['unavailable', 'no'].includes(status)) return { label: 'Not available', tone: 'danger', icon: 'cancel' }
  if (status === 'maybe') return { label: 'Maybe', tone: 'warning', icon: 'help-outline' }
  if (canChangeParentMatchAvailability(match, invitation, link, now)) return { label: 'Needs response', tone: 'warning', icon: 'help-outline' }
  if (!invitation && !match.availabilityRespondedAt) return { label: 'No response requested', tone: 'muted', icon: 'remove-circle-outline' }
  return { label: 'Not responded', tone: 'muted', icon: 'remove-circle-outline' }
}

export function getParentMatchSquadStatus(match = {}) {
  if (match.squadDecisionState === 'selected') return { label: 'Selected', tone: 'accent', icon: 'groups' }
  if (match.squadDecisionState === 'not_selected') return { label: 'Not selected', tone: 'muted', icon: 'groups' }
  return { label: 'Not announced yet', tone: 'muted', icon: 'groups' }
}
