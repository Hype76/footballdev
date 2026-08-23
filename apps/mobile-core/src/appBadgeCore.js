function normalize(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function normalizeMobileAppRole(appRole) {
  const role = normalize(appRole)
  if (!['coach', 'parent'].includes(role)) throw new Error('app_badge_role_invalid')
  return role
}

export function getMobileAppBadgeStorageKey(appRole) {
  return `fp.mobile.app-badge.v1.${normalizeMobileAppRole(appRole)}.enabled`
}

export function normalizeMobileAppBadgeEnabled(value) {
  if (value === false) return false
  const normalized = normalize(value)
  if (['0', 'disabled', 'false', 'off'].includes(normalized)) return false
  return true
}

export function getMobileAppBadgeCount({ count = 0, enabled = true } = {}) {
  if (!normalizeMobileAppBadgeEnabled(enabled)) return 0
  const numericCount = Number(count)
  if (!Number.isFinite(numericCount)) return 0
  return Math.max(0, Math.min(99, Math.floor(numericCount)))
}

export function getCoachAppBadgeCount({ unreadChat = 0 } = {}) {
  return getMobileAppBadgeCount({ count: unreadChat })
}

export function getParentAppBadgeCount({ unreadNotifications = 0, unreadChat = 0 } = {}) {
  const notificationCount = Number(unreadNotifications)
  const chatCount = Number(unreadChat)
  return getMobileAppBadgeCount({
    count: (Number.isFinite(notificationCount) ? notificationCount : 0)
      + (Number.isFinite(chatCount) ? chatCount : 0),
  })
}
