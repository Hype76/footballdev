export function normalizeParentPortalInviteEmail(email) {
  return String(email ?? '').trim().toLowerCase()
}

export function isParentPortalInviteEligiblePlayer(player) {
  return String(player?.section ?? '').trim().toLowerCase() === 'squad'
}

export function getParentPortalInviteActionForContact({
  contact,
  isSending = false,
  links = [],
  player,
} = {}) {
  const email = normalizeParentPortalInviteEmail(contact?.email)

  if (!email || !isParentPortalInviteEligiblePlayer(player)) {
    return {
      canSend: false,
      label: '',
      statusLabel: '',
      title: '',
    }
  }

  const link = links.find((candidate) => normalizeParentPortalInviteEmail(candidate?.email) === email)

  if (link?.status === 'active') {
    return {
      canSend: false,
      label: '',
      statusLabel: 'Parent portal linked',
      title: 'This parent already has active portal access.',
    }
  }

  const wasSent = Boolean(link?.inviteSentAt || link?.invite_sent_at)

  return {
    canSend: !isSending,
    label: wasSent ? 'Resend parent portal invite' : 'Send parent portal invite',
    statusLabel: wasSent ? 'Invite sent' : '',
    title: isSending ? 'Please wait while this parent invite is being sent.' : '',
  }
}
