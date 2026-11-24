const text = value => String(value ?? '').trim().toLowerCase()

function invitationMatchesLink(invitation, link) {
  if (!link?.id || !invitation || invitation.childId !== link.playerId) return false
  if (link.linkType === 'adult_player') return invitation.adultPlayerLinkId === link.id
  return link.linkType === 'parent' && invitation.parentLinkId === link.id
}

export function getParentMatchAttendanceInvitation(match, invitations = [], link = {}) {
  if (!match?.id || !link.id || match.isFanView) return null
  return invitations.find(invitation => invitation.invitationType === 'match_attendance'
    && invitation.eventId === match.id
    && invitationMatchesLink(invitation, link)) || null
}

export function getParentMatchVolunteerInvitations(match, invitations = [], link = {}, now = Date.now()) {
  if (!match?.id || !link?.id || link.linkType !== 'parent' || match.isFanView || match.concludedAt
    || ['cancelled', 'postponed', 'full_time'].includes(match.status)) return []
  return invitations.filter(invitation => invitation.invitationType === 'match_role'
    && invitation.eventId === match.id
    && invitation.parentLinkId === link.id
    && invitation.childId === link.playerId
    && Boolean(invitation.sourceRecordId)
    && ['active', 'offered'].includes(invitation.invitationState)
    && (invitation.canRespond || invitation.canChangeResponse)
    && (!invitation.responseDeadline || Date.parse(invitation.responseDeadline) > now))
}

export function canChangeParentMatchAvailability(match, invitation, link = {}, now = Date.now()) {
  return Boolean(!match?.isFanView && invitationMatchesLink(invitation, link)
    && invitation?.eventId === match?.id && invitation?.invitationType === 'match_attendance' && invitation?.sourceRecordId
    && ['active', 'offered'].includes(invitation.invitationState)
    && (invitation.canRespond || invitation.canChangeResponse)
    && (!invitation.responseDeadline || Date.parse(invitation.responseDeadline) > now)
    && !['cancelled', 'postponed', 'full_time'].includes(match?.status)
    && !match?.concludedAt)
}

export function getParentMatchAvailability(match = {}, invitation, link = {}, now = Date.now()) {
  const status = text(link.linkType === 'adult_player' && invitationMatchesLink(invitation, link)
    ? invitation.responseState : match.availabilityStatus)
  if (['available', 'yes'].includes(status)) return { label: 'Available', tone: 'success', icon: 'check-circle' }
  if (['unavailable', 'no'].includes(status)) return { label: 'Not available', tone: 'danger', icon: 'cancel' }
  if (status === 'maybe') return { label: 'Maybe', tone: 'warning', icon: 'help-outline' }
  if (match.isPlayerView && ['pending', 'awaiting_response', 'not_responded'].includes(status)) return { label: 'Not responded', tone: 'muted', icon: 'remove-circle-outline' }
  if (canChangeParentMatchAvailability(match, invitation, link, now)) return { label: 'Needs response', tone: 'warning', icon: 'help-outline' }
  if (!invitation && !match.availabilityRespondedAt) return { label: 'No response requested', tone: 'muted', icon: 'remove-circle-outline' }
  return { label: 'Not responded', tone: 'muted', icon: 'remove-circle-outline' }
}

export function getParentMatchSquadStatus(match = {}) {
  if (match.squadDecisionState === 'selected') return { label: 'Selected', tone: 'accent', icon: 'groups' }
  if (match.squadDecisionState === 'not_selected') return { label: 'Not selected', tone: 'muted', icon: 'groups' }
  return { label: 'Not announced yet', tone: 'muted', icon: 'groups' }
}
