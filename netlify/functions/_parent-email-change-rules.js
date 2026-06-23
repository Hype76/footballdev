export const unsafeExistingEmailMessage = 'That email is already used by another parent account. Please ask the club to confirm the correct family link.'
export const upToDateMessage = 'Email already up to date.'
export const linkedExistingParentMessage = 'Family access has been linked to that parent email. Sign in with that email to view all linked children.'
export const existingParentAlreadyLinkedMessage = 'Family access is already available through that parent email. Sign in with that email to view all linked children.'
export const pendingEmailChangeMessage = 'Check your inbox to confirm this email change. Your family access will stay on the current email until confirmation is complete.'
export const genericEmailChangeErrorMessage = 'Email could not be updated. Please try again in a moment.'

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function isValidEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(value ?? '').trim())
}

function hasSameChildLink(link, targetLinks) {
  return targetLinks.some((targetLink) =>
    targetLink.playerId === link.playerId
    && targetLink.teamId === link.teamId
    && targetLink.linkType === link.linkType)
}

function hasSameUniqueEmailLink(link, targetLinks, requestedEmail) {
  return targetLinks.some((targetLink) =>
    targetLink.playerId === link.playerId
    && targetLink.teamId === link.teamId
    && targetLink.linkType === link.linkType
    && targetLink.email === requestedEmail
    && targetLink.status !== 'revoked')
}

function hasSafeExistingParentProof(link, targetLinks, requestedEmail) {
  if (link.email === requestedEmail) {
    return true
  }

  if (Array.isArray(link.contactEmails) && link.contactEmails.includes(requestedEmail)) {
    return targetLinks.length === 0 || targetLinks.some((targetLink) => targetLink.clubId === link.clubId)
  }

  return hasSameChildLink(link, targetLinks)
}

export function classifyParentEmailChange({ authUser, requestedEmail, currentLinks = [], targetAuthUser = null, targetLinks = [] }) {
  const normalizedEmail = normalizeEmail(requestedEmail)
  const currentAuthEmail = normalizeEmail(authUser?.email)
  const activeCurrentLinks = currentLinks.filter((link) => link.status === 'active')
  const activeTargetLinks = targetLinks.filter((link) => link.status === 'active')
  const nonRevokedTargetLinks = targetLinks.filter((link) => link.status !== 'revoked')

  if (!authUser?.id) {
    return { ok: false, statusCode: 401, message: 'Login is required.' }
  }

  if (!isValidEmail(normalizedEmail)) {
    return { ok: false, statusCode: 400, message: 'Enter a valid email address.' }
  }

  if (normalizedEmail === currentAuthEmail || activeCurrentLinks.some((link) => link.email === normalizedEmail)) {
    return { ok: true, action: 'noop', email: normalizedEmail, message: upToDateMessage }
  }

  const existingSameFamilyEmailLinks = activeCurrentLinks.filter((link) =>
    hasSameUniqueEmailLink(link, nonRevokedTargetLinks, normalizedEmail)
    && hasSafeExistingParentProof(link, nonRevokedTargetLinks, normalizedEmail))

  if (existingSameFamilyEmailLinks.length > 0) {
    return {
      ok: true,
      action: 'existing-parent-already-linked',
      email: normalizedEmail,
      message: existingParentAlreadyLinkedMessage,
      transferLinkIds: [],
    }
  }

  if (!targetAuthUser?.id) {
    return { ok: true, action: 'request-auth-email-change', email: normalizedEmail, message: pendingEmailChangeMessage }
  }

  if (targetAuthUser.id === authUser.id) {
    return { ok: true, action: 'noop', email: normalizedEmail, message: upToDateMessage }
  }

  const safeLinks = activeCurrentLinks.filter((link) => hasSafeExistingParentProof(link, activeTargetLinks, normalizedEmail))

  if (safeLinks.length === 0) {
    return { ok: false, statusCode: 409, message: unsafeExistingEmailMessage }
  }

  const transferLinks = safeLinks.filter((link) => !hasSameUniqueEmailLink(link, nonRevokedTargetLinks, normalizedEmail))

  if (transferLinks.length === 0) {
    return {
      ok: true,
      action: 'existing-parent-already-linked',
      email: normalizedEmail,
      message: existingParentAlreadyLinkedMessage,
      transferLinkIds: [],
    }
  }

  return {
    ok: true,
    action: 'link-existing-parent',
    email: normalizedEmail,
    message: linkedExistingParentMessage,
    transferLinkIds: transferLinks.map((link) => link.id),
  }
}

export function isParentEmailUniqueConflict(error) {
  const message = String(error?.message ?? '').toLowerCase()
  const details = String(error?.details ?? '').toLowerCase()
  const code = String(error?.code ?? '').toLowerCase()

  return code === '23505'
    || message.includes('parent_player_links_unique_email')
    || details.includes('parent_player_links_unique_email')
    || message.includes('duplicate key value')
}

export function getSafeEmailChangeErrorMessage(error) {
  if (error?.statusCode === 401) {
    return 'Login is required.'
  }

  if (isParentEmailUniqueConflict(error)) {
    return genericEmailChangeErrorMessage
  }

  return genericEmailChangeErrorMessage
}
