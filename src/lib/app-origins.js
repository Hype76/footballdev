const PRODUCTION_APP_ORIGIN = 'https://footballplayer.online'
const PRODUCTION_PARENT_ORIGIN = 'https://parent.footballplayer.online'
const LEGACY_PRODUCTION_APP_HOST = 'playerfeedback.online'
const LEGACY_PRODUCTION_PARENT_HOST = 'parent.playerfeedback.online'

function cleanOrigin(value) {
  return String(value ?? '').trim().replace(/\/$/, '')
}

function isAuthBrowserFixtureMode() {
  return String(import.meta.env.VITE_AUTH_ACCESS_BROWSER_FIXTURES ?? '').trim().toLowerCase() === 'true'
}

export function isParentPortalHost(hostname = globalThis.location?.hostname ?? '') {
  const normalizedHost = String(hostname ?? '').trim().toLowerCase()

  return normalizedHost === 'parent.footballplayer.online'
    || normalizedHost === LEGACY_PRODUCTION_PARENT_HOST
}

export function isParentInviteHost(hostname = globalThis.location?.hostname ?? '') {
  return isParentPortalHost(hostname)
}

export function getMainAppOrigin() {
  const currentOrigin = cleanOrigin(globalThis.location?.origin)
  const currentHost = String(globalThis.location?.hostname ?? '').trim().toLowerCase()
  const configuredOrigin = cleanOrigin(import.meta.env.VITE_APP_URL ?? import.meta.env.VITE_PUBLIC_APP_URL)

  if (isAuthBrowserFixtureMode() && configuredOrigin) {
    return configuredOrigin
  }

  if (!currentOrigin || currentHost === 'localhost') {
    return PRODUCTION_APP_ORIGIN
  }

  if (isParentPortalHost(currentHost)) {
    return PRODUCTION_APP_ORIGIN
  }

  if (currentHost === 'footballplayer.online' || currentHost === LEGACY_PRODUCTION_APP_HOST) {
    return PRODUCTION_APP_ORIGIN
  }

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

  if (isAuthBrowserFixtureMode() && isParentPortalHost(currentHost)) {
    return currentOrigin || PRODUCTION_PARENT_ORIGIN
  }

  if (currentHost === 'localhost') {
    return currentOrigin || PRODUCTION_PARENT_ORIGIN
  }

  if (currentHost === 'footballplayer.online'
    || currentHost === 'parent.footballplayer.online'
    || currentHost === LEGACY_PRODUCTION_APP_HOST
    || currentHost === LEGACY_PRODUCTION_PARENT_HOST) {
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
