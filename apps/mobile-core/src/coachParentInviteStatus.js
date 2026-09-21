function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function timestamp(value) {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

export function getCoachParentInviteStatus({
  contact,
  inviteResults = {},
  isSending = false,
  link,
  now = Date.now(),
} = {}) {
  if (isSending) return { label: 'Sending', state: 'sending' }

  const linkStatus = String(link?.status || '').trim().toLowerCase()
  if (linkStatus === 'active' || linkStatus === 'accepted') {
    return { label: 'Accepted', state: 'accepted' }
  }

  const email = normalizeEmail(contact?.email ?? link?.email)
  const result = inviteResults[email] ?? inviteResults[contact?.email]
  if (result?.confirmedByServer && result.status === 'accepted') return { label: 'Accepted', state: 'accepted' }
  if (result?.confirmedByServer && result.status === 'sent') return { label: 'Invite sent awaiting acceptance', state: 'sent' }
  if (result?.status === 'failed') {
    const detail = String(result.message || '').trim()
    return {
      label: detail ? `Invite failed: ${detail}` : 'Invite failed',
      state: 'failed',
    }
  }

  const expiresAt = timestamp(link?.expires_at ?? link?.expiresAt)
  if (linkStatus === 'expired' || (linkStatus === 'pending' && expiresAt !== null && expiresAt <= Number(now))) {
    return { label: 'Expired', state: 'expired' }
  }

  const inviteSentAt = link?.invite_sent_at ?? link?.inviteSentAt
  if (linkStatus === 'pending' && timestamp(inviteSentAt) !== null) {
    return { label: 'Invite sent awaiting acceptance', state: 'sent' }
  }

  return { label: 'Not invited', state: 'not-invited' }
}
