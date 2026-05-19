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
  const currentOrigin = cleanOrigin(globalThis.location?.origin)
  const currentHost = String(globalThis.location?.hostname ?? '').trim().toLowerCase()

  if (!currentOrigin || currentHost === 'localhost') {
    return PRODUCTION_APP_ORIGIN
  }

  if (isParentPortalHost(currentHost)) {
    return currentHost === 'parent-staging.playerfeedback.online'
      ? STAGING_APP_ORIGIN
      : PRODUCTION_APP_ORIGIN
  }

  if (currentHost === 'staging.playerfeedback.online') {
    return STAGING_APP_ORIGIN
  }

  if (currentHost === 'playerfeedback.online') {
    return PRODUCTION_APP_ORIGIN
  }

  const configuredOrigin = cleanOrigin(import.meta.env.VITE_APP_URL ?? import.meta.env.VITE_PUBLIC_APP_URL)

  if (configuredOrigin) {
    return configuredOrigin
  }

  return currentOrigin
}

export function buildMainAppUrl(path = '/') {
  const normalizedPath = String(path ?? '/').startsWith('/') ? String(path ?? '/') : `/${path}`

  return `${getMainAppOrigin()}${normalizedPath}`
}

export function getParentAppOrigin() {
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

  const configuredOrigin = cleanOrigin(import.meta.env.VITE_PARENT_APP_URL)

  if (configuredOrigin) {
    return configuredOrigin
  }

  return currentOrigin || PRODUCTION_PARENT_ORIGIN
}

export function buildParentAppUrl(path = '/') {
  const normalizedPath = String(path ?? '/').startsWith('/') ? String(path ?? '/') : `/${path}`

  return `${getParentAppOrigin()}${normalizedPath}`
}
