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

  return Boolean(section) && status !== 'archived' && !player?.archivedAt && !player?.archived_at
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

export function canAutoSendParentInvite(link, now = Date.now()) {
  return !link || link.status === 'uninvited'
    || (link.status === 'pending' && (!(link.invite_sent_at || link.inviteSentAt)
      || Date.parse(link.expires_at || link.expiresAt) <= now))
}

export function canSendPendingParentInviteRetry({ link, email, expiresAt, now = Date.now() }) {
  const expiry = typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN
  return link?.link_type === 'parent'
    && link.status === 'pending'
    && !link.invite_sent_at
    && typeof email === 'string'
    && normalizeParentPortalInviteEmail(link.email) === normalizeParentPortalInviteEmail(email)
    && expiry === Date.parse(link.expires_at)
    && expiry > now
}

export function getParentPortalInviteActionForContact({
  contact,
  isSending = false,
  links = [],
  player,
  now = Date.now(),
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

  const matchingLinks = links.filter((candidate) => (
    (candidate?.linkType ?? candidate?.link_type ?? 'parent') === 'parent'
    && normalizeParentPortalInviteEmail(candidate?.email) === email
  ))
  const link = matchingLinks.find((candidate) => candidate.status === 'active') || matchingLinks[0]

  if (link?.status === 'active') {
    return {
      canSend: false,
      label: '',
      statusLabel: 'Parent portal linked',
      title: 'This parent already has active portal access.',
    }
  }

  const wasSent = Boolean(link?.inviteSentAt || link?.invite_sent_at)

  const expired = link?.status === 'pending' && Date.parse(link.expiresAt || link.expires_at) <= now
  const canRetryPending = link?.id && link.status === 'pending' && (expired || !wasSent)

  return {
    canSend: !isSending,
    retryLinkId: canRetryPending ? link.id : '',
    expired,
    label: wasSent ? 'Resend parent portal invite' : 'Send parent portal invite',
    statusLabel: expired ? 'Invite expired' : wasSent ? 'Invite sent' : canRetryPending ? 'Invite not sent' : '',
    title: isSending ? 'Please wait while this parent invite is being sent.' : '',
  }
}
