const NOTIFICATION_LEVELS = new Set(['off', 'minimal', 'detailed'])

function normalize(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function normalizeCoachMobileNotificationLevel(value) {
  const level = normalize(value)
  return NOTIFICATION_LEVELS.has(level) ? level : 'minimal'
}

export function resolveCoachMobileRegistrationPreference({ existing = null, mode = 'preserve', requestedDetailLevel = 'minimal' } = {}) {
  const requestedLevel = normalizeCoachMobileNotificationLevel(requestedDetailLevel)
  const preserveExisting = normalize(mode) !== 'enable' && existing?.status === 'active'

  if (preserveExisting) {
    const detailLevel = normalizeCoachMobileNotificationLevel(existing.detail_level)
    return Object.freeze({
      detailLevel,
      enabled: Boolean(existing.enabled && detailLevel !== 'off'),
    })
  }

  if (normalize(mode) !== 'enable') {
    return Object.freeze({ detailLevel: requestedLevel, enabled: false })
  }

  const detailLevel = requestedLevel === 'off' ? 'minimal' : requestedLevel
  return Object.freeze({ detailLevel, enabled: true })
}

export function resolveCoachMobileRegistrationIdentity({
  authUserId = '',
  existing = null,
  requestedInstallationId = '',
  tokenInstallation = null,
} = {}) {
  const userId = normalize(authUserId)
  const requestedOwned = normalize(existing?.auth_user_id) === userId ? existing : null
  const tokenOwned = normalize(tokenInstallation?.auth_user_id) === userId
    && tokenInstallation?.status === 'active'
    ? tokenInstallation
    : null
  const preferenceSource = requestedOwned?.status === 'active' ? requestedOwned : tokenOwned
  const installationId = normalize(preferenceSource?.installation_id) || normalize(requestedInstallationId)

  return Object.freeze({ installationId, preferenceSource })
}
