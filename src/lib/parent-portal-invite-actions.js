export function normalizeParentPortalInviteEmail(email) {
  return String(email ?? '').trim().toLowerCase()
}

export function getUnlistedParentAccessLinks({ contacts = [], links = [] } = {}) {
  const contactEmails = new Set(contacts.map((contact) => normalizeParentPortalInviteEmail(contact.email)).filter(Boolean))
  return links.filter((link) => (
    String(link.linkType ?? link.link_type ?? 'parent') === 'parent'
    && ['active', 'pending'].includes(link.status)
    && !contactEmails.has(normalizeParentPortalInviteEmail(link.email))
  ))
}

export function isParentPortalInviteEligiblePlayer(player) {
  const section = String(player?.section ?? '').trim().toLowerCase()
  const status = String(player?.status ?? 'active').trim().toLowerCase()

  return ['trial', 'squad'].includes(section) && status !== 'archived'
}

export function getPlayerParentInviteContacts(player) {
  if (player?.contactType === 'self') return []
  const contacts = player?.parentContacts?.length ? player.parentContacts : [{ name: player?.parentName, email: player?.parentEmail }]
  const unique = new Map()
  for (const contact of contacts) {
    const email = normalizeParentPortalInviteEmail(contact.email)
    if (contact.type !== 'self' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) unique.set(email, { ...contact, email })
  }
  return [...unique.values()]
}

export function canAutoSendParentInvite(link) {
  return !link || link.status === 'uninvited'
    || (link.status === 'pending' && !(link.invite_sent_at || link.inviteSentAt))
}

export function getParentPortalInviteActionForContact({
  contact,
  isSending = false,
  links = [],
  player,
} = {}) {
  const email = normalizeParentPortalInviteEmail(contact?.email)

  if (!email || contact?.type === 'self' || player?.contactType === 'self' || !isParentPortalInviteEligiblePlayer(player)) {
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
