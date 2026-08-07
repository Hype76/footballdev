const INSTALLATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const parentNotificationDetailLevels = Object.freeze(['minimal', 'detailed'])
export const parentNotificationIntentTypes = Object.freeze([
  'parent_message',
  'parent_poll',
  'matchday_update',
])

function normalize(value) {
  return String(value ?? '').trim()
}

export function isParentInstallationId(value) {
  return INSTALLATION_ID_PATTERN.test(normalize(value))
}

export function normalizeParentNotificationDetail(value) {
  return normalize(value).toLowerCase() === 'detailed' ? 'detailed' : 'minimal'
}

export function normalizeParentNotificationState(value = {}) {
  const detailLevel = normalizeParentNotificationDetail(value.detailLevel)
  const permissionStatus = normalize(value.permissionStatus).toLowerCase() || 'undetermined'
  const registered = Boolean(value.registered)

  return {
    canAskAgain: value.canAskAgain !== false,
    detailLevel,
    enabled: Boolean(value.enabled && registered),
    message: normalize(value.message),
    permissionGranted: Boolean(value.permissionGranted),
    permissionStatus,
    registered,
  }
}

export function getParentNotificationStatusLabel(value = {}) {
  const state = normalizeParentNotificationState(value)
  if (!state.permissionGranted && state.permissionStatus === 'denied') return 'Blocked in device settings'
  if (!state.enabled) return 'Off'
  return state.detailLevel === 'detailed' ? 'On, Detailed' : 'On, Minimal'
}

export function resolveParentNotificationOpen(data, available = {}) {
  if (normalize(data?.app).toLowerCase() !== 'parent') return null

  const route = normalize(data?.route).toLowerCase()
  const routeMap = {
    matchday: 'home',
    messages: 'messages',
    polls: 'polls',
  }
  const tab = routeMap[route]
  if (!tab) return null

  const targetId = normalize(data?.targetId)
  const availableIds = new Set((available[route] || []).map(normalize).filter(Boolean))

  return {
    targetId: targetId && availableIds.has(targetId) ? targetId : '',
    tab,
  }
}

export function containsForbiddenParentNotificationContent(text, playerNames = []) {
  const normalizedText = normalize(text).toLowerCase()
  const forbiddenSignals = ['@', 'assessment', 'staff note', 'phone number']
  if (forbiddenSignals.some((signal) => normalizedText.includes(signal))) return true

  return playerNames.some((name) => {
    const normalizedName = normalize(name).toLowerCase()
    return normalizedName.includes(' ') && normalizedText.includes(normalizedName)
  })
}
