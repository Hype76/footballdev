import { isParentPortalUser } from './auth-permissions.js'

export const SELECTED_ACCESS_MODE_STORAGE_KEY = 'selected-access-mode'
export const PARENT_ACCESS_MODE = 'parent'

const parentIntentPaths = new Set([
  '/parent-login',
  '/parent-portal',
  '/parent-messages',
  '/parent-polls',
  '/friends-family',
  '/parents/portal',
])

export function normalizeParentIntentPath(pathname = '') {
  const rawPath = String(pathname || '/').split('?')[0].split('#')[0]
  const withLeadingSlash = rawPath.startsWith('/') ? rawPath : `/${rawPath}`
  return withLeadingSlash.replace(/\/+$/, '') || '/'
}

export function isParentIntentPath(pathname = '') {
  return parentIntentPaths.has(normalizeParentIntentPath(pathname))
}

export function rememberParentAccessIntent() {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.setItem(SELECTED_ACCESS_MODE_STORAGE_KEY, PARENT_ACCESS_MODE)
}

export function hasActiveParentPortalLink(user) {
  return Array.isArray(user?.parentPortalLinks) && user.parentPortalLinks.length > 0
}

export function canOpenParentPortal(user) {
  return isParentPortalUser(user) && hasActiveParentPortalLink(user)
}

export function getSignedInAccountEmail({ user, session } = {}) {
  return String(user?.email ?? session?.user?.email ?? '').trim()
}
