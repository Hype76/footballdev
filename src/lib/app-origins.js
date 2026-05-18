const PRODUCTION_APP_ORIGIN = 'https://playerfeedback.online'
const STAGING_APP_ORIGIN = 'https://staging.playerfeedback.online'
const PRODUCTION_PARENT_ORIGIN = 'https://parent.playerfeedback.online'
const STAGING_PARENT_ORIGIN = 'https://parent-staging.playerfeedback.online'

function cleanOrigin(value) {
  return String(value ?? '').trim().replace(/\/$/, '')
}

export function isParentPortalHost(hostname = globalThis.location?.hostname ?? '') {
  const normalizedHost = String(hostname ?? '').trim().toLowerCase()

  return normalizedHost === 'parent.playerfeedback.online' || normalizedHost === 'parent-staging.playerfeedback.online'
}

export function getMainAppOrigin() {
  const configuredOrigin = cleanOrigin(import.meta.env.VITE_APP_URL ?? import.meta.env.VITE_PUBLIC_APP_URL)

  if (configuredOrigin) {
    return configuredOrigin
  }

  const currentOrigin = cleanOrigin(globalThis.location?.origin)

  if (!currentOrigin || globalThis.location?.hostname === 'localhost') {
    return PRODUCTION_APP_ORIGIN
  }

  if (isParentPortalHost(globalThis.location?.hostname)) {
    return globalThis.location.hostname === 'parent-staging.playerfeedback.online'
      ? STAGING_APP_ORIGIN
      : PRODUCTION_APP_ORIGIN
  }

  return currentOrigin
}

export function getParentAppOrigin() {
  const configuredOrigin = cleanOrigin(import.meta.env.VITE_PARENT_APP_URL)

  if (configuredOrigin) {
    return configuredOrigin
  }

  const currentOrigin = cleanOrigin(globalThis.location?.origin)
  const currentHost = String(globalThis.location?.hostname ?? '').trim().toLowerCase()

  if (currentHost === 'localhost') {
    return currentOrigin || STAGING_PARENT_ORIGIN
  }

  if (currentHost === 'staging.playerfeedback.online' || currentHost === 'parent-staging.playerfeedback.online') {
    return STAGING_PARENT_ORIGIN
  }

  if (currentHost === 'playerfeedback.online' || currentHost === 'parent.playerfeedback.online') {
    return PRODUCTION_PARENT_ORIGIN
  }

  return currentOrigin || PRODUCTION_PARENT_ORIGIN
}

export function buildParentAppUrl(path = '/') {
  const normalizedPath = String(path ?? '/').startsWith('/') ? String(path ?? '/') : `/${path}`

  return `${getParentAppOrigin()}${normalizedPath}`
}
