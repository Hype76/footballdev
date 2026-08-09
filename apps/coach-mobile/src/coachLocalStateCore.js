export const COACH_LOCAL_STATE_SCHEMA_VERSION = 1

const CATEGORIES = Object.freeze(['context', 'deep-link', 'offline', 'notification', 'theme'])

function normalize(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function getMobileLocalStateKey(appRole, category, suffix = '') {
  const app = normalize(appRole)
  const normalizedCategory = normalize(category)
  if (!['coach', 'parent'].includes(app)) throw new Error('local_state_app_mismatch')
  if (!CATEGORIES.includes(normalizedCategory)) throw new Error('local_state_category_invalid')
  const normalizedSuffix = String(suffix ?? '').trim()
  return `fp.mobile.local.v${COACH_LOCAL_STATE_SCHEMA_VERSION}.${app}.${normalizedCategory}${normalizedSuffix ? `.${normalizedSuffix}` : ''}`
}

export function getCoachLocalStateKeys(userId = '') {
  const normalizedUserId = String(userId ?? '').trim()
  return Object.freeze({
    context: getMobileLocalStateKey('coach', 'context', normalizedUserId),
    deepLink: getMobileLocalStateKey('coach', 'deep-link', normalizedUserId),
    offline: getMobileLocalStateKey('coach', 'offline', normalizedUserId),
    notification: getMobileLocalStateKey('coach', 'notification', normalizedUserId),
    theme: getMobileLocalStateKey('coach', 'theme'),
  })
}

export function getParentLocalStateKeys(userId = '') {
  const normalizedUserId = String(userId ?? '').trim()
  return Object.freeze({
    context: getMobileLocalStateKey('parent', 'context', normalizedUserId),
    deepLink: getMobileLocalStateKey('parent', 'deep-link', normalizedUserId),
    offline: getMobileLocalStateKey('parent', 'offline', normalizedUserId),
    notification: getMobileLocalStateKey('parent', 'notification', normalizedUserId),
    theme: getMobileLocalStateKey('parent', 'theme'),
  })
}
