const PRODUCTION_APP_ORIGIN = 'https://footballplayer.online'
const STAGING_APP_ORIGIN = 'https://staging.footballplayer.online'
const STAGING_ALIAS_APP_ORIGIN = 'https://football-os-staging.staging.footballplayer.online'
const PRODUCTION_PARENT_ORIGIN = 'https://parent.footballplayer.online'
const STAGING_PARENT_ORIGIN = 'https://parent-staging.staging.footballplayer.online'
const STAGING_ALIAS_APP_HOST = 'football-os-staging.staging.footballplayer.online'
const LEGACY_PRODUCTION_APP_HOST = 'playerfeedback.online'
const LEGACY_STAGING_APP_HOST = 'staging.playerfeedback.online'
const LEGACY_PRODUCTION_PARENT_HOST = 'parent.playerfeedback.online'
const LEGACY_STAGING_PARENT_HOST = 'parent-staging.playerfeedback.online'

function cleanOrigin(value) {
  return String(value ?? '').trim().replace(/\/$/, '')
}

function isAuthBrowserFixtureMode() {
  return String(import.meta.env.VITE_AUTH_ACCESS_BROWSER_FIXTURES ?? '').trim().toLowerCase() === 'true'
}

export function isParentPortalHost(hostname = globalThis.location?.hostname ?? '') {
  const normalizedHost = String(hostname ?? '').trim().toLowerCase()

  return normalizedHost === 'parent.footballplayer.online'
    || normalizedHost === 'parent-staging.footballplayer.online'
    || normalizedHost === 'parent-staging.staging.footballplayer.online'
    || normalizedHost === LEGACY_PRODUCTION_PARENT_HOST
    || normalizedHost === LEGACY_STAGING_PARENT_HOST
}

export function isParentInviteHost(hostname = globalThis.location?.hostname ?? '') {
  return isParentPortalHost(hostname) || String(hostname ?? '').trim().toLowerCase() === STAGING_ALIAS_APP_HOST
}

export function getMainAppOrigin() {
  const currentOrigin = cleanOrigin(globalThis.location?.origin)
  const currentHost = String(globalThis.location?.hostname ?? '').trim().toLowerCase()

  if (!currentOrigin || currentHost === 'localhost') {
    return PRODUCTION_APP_ORIGIN
  }

  if (isParentPortalHost(currentHost)) {
    return currentHost === 'parent-staging.footballplayer.online'
      || currentHost === 'parent-staging.staging.footballplayer.online'
      || currentHost === LEGACY_STAGING_PARENT_HOST
      ? STAGING_APP_ORIGIN
      : PRODUCTION_APP_ORIGIN
  }

  if (currentHost === 'staging.footballplayer.online' || currentHost === LEGACY_STAGING_APP_HOST) {
    return STAGING_APP_ORIGIN
  }

  if (currentHost === STAGING_ALIAS_APP_HOST) {
    return STAGING_ALIAS_APP_ORIGIN
  }

  if (currentHost === 'footballplayer.online' || currentHost === LEGACY_PRODUCTION_APP_HOST) {
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

  if (isAuthBrowserFixtureMode() && isParentPortalHost(currentHost)) {
    return currentOrigin || PRODUCTION_PARENT_ORIGIN
  }

  if (currentHost === 'localhost') {
    return currentOrigin || STAGING_PARENT_ORIGIN
  }

  if (currentHost === 'staging.footballplayer.online'
    || currentHost === STAGING_ALIAS_APP_HOST
    || currentHost === 'parent-staging.footballplayer.online'
    || currentHost === 'parent-staging.staging.footballplayer.online'
    || currentHost === LEGACY_STAGING_APP_HOST
    || currentHost === LEGACY_STAGING_PARENT_HOST) {
    return STAGING_PARENT_ORIGIN
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
