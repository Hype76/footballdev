import { createHash, randomBytes } from 'node:crypto'

export function normalizeInvitationValue(value) {
  return String(value ?? '').trim()
}

export function generateInvitationValue() {
  return randomBytes(32).toString('base64url')
}

export function digestInvitationValue(value) {
  const normalizedValue = normalizeInvitationValue(value)

  if (!normalizedValue) {
    return ''
  }

  return createHash('sha256').update(normalizedValue).digest('hex')
}

export function buildClubOwnerInviteUrl(baseUrl, invitationValue) {
  const origin = String(baseUrl ?? '').trim().replace(/\/$/, '')
  return `${origin}/club-invite#token=${encodeURIComponent(invitationValue)}`
}

export function getBearerToken(event = {}) {
  const header = String(event.headers?.authorization || event.headers?.Authorization || '')
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}
