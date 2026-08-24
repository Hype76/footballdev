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

  const detailLevel = normalize(mode) === 'enable' && requestedLevel === 'off'
    ? 'minimal'
    : requestedLevel
  return Object.freeze({ detailLevel, enabled: detailLevel !== 'off' })
}
