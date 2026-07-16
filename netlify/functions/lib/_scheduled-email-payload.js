import { createFromAddress } from './_email-provider.js'

export function normalizeQueuedEmailRecipients(value) {
  if (Array.isArray(value)) {
    return value.map((email) => String(email ?? '').trim()).filter(Boolean)
  }

  return String(value ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)
}

function getQueuedEmailFromName(payload = {}) {
  const displayName = String(payload.displayName ?? '').trim() || 'Football Player'
  const teamName = String(payload.teamName ?? '').trim()
  const clubName = String(payload.clubName ?? '').trim()
  const scopeName = [teamName, clubName].filter(Boolean).join(' - ')
  return scopeName ? `${displayName} (${scopeName})` : displayName
}

export function buildPreparedScheduledEmail(row, planProfile) {
  const payload = row?.payload || {}
  const resendPayload = payload.resendPayload || {}
  const recipients = normalizeQueuedEmailRecipients(resendPayload.to || row?.to_email)
  const emailPayload = {
    ...resendPayload,
    from: String(resendPayload.from ?? '').trim() || createFromAddress(getQueuedEmailFromName(payload)),
    to: recipients,
  }

  return {
    emailHtml: String(resendPayload.html ?? ''),
    emailPayload,
    emailSubject: String(resendPayload.subject ?? row?.subject ?? '').trim() || 'Football Player',
    planProfile,
    recipients,
    senderCopyEmails: normalizeQueuedEmailRecipients(resendPayload.cc),
    storedPayload: payload,
  }
}
