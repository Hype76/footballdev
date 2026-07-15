import { isParentPortalUser } from './auth-permissions.js'
import {
  normalizeLoginAccessIntent,
  SELECTED_ACCESS_MODE_STORAGE_KEY,
  rememberLoginAccessIntent,
} from './login-access-intent.js'

export { SELECTED_ACCESS_MODE_STORAGE_KEY } from './login-access-intent.js'
export const PARENT_ACCESS_MODE = 'parent'

const parentIntentPaths = new Set([
  '/parent-login',
  '/parents-login',
  '/parent/sign-in',
  '/parent-portal',
  '/parent-messages',
  '/parent-chat',
  '/parent-polls',
  '/parents/sign-in',
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

export function getParentInviteToken(search = '') {
  const params = new URLSearchParams(String(search ?? '').replace(/^\?/, ''))
  return String(params.get('parentInvite') ?? '').trim()
}

export function buildParentInviteAcceptancePath(token = '') {
  const normalizedToken = String(token ?? '').trim()
  return normalizedToken ? `/parent-invite/${encodeURIComponent(normalizedToken)}?accept=1` : ''
}

export function buildParentInviteSuccessPath(parentLinkId = '') {
  const normalizedParentLinkId = String(parentLinkId ?? '').trim()
  const params = new URLSearchParams({ linked: '1' })

  if (normalizedParentLinkId) {
    params.set('parentLinkId', normalizedParentLinkId)
  }

  return `/parent-portal?${params.toString()}`
}

export function isParentInviteSignInIntent({ pathname = '', search = '' } = {}) {
  return normalizeParentIntentPath(pathname) === '/sign-in' && Boolean(getParentInviteToken(search))
}

export function isIntentionalParentAccessContext({
  isParentHost = false,
  loginAccessIntent = '',
  pathname = '',
} = {}) {
  return Boolean(isParentHost)
    || normalizeLoginAccessIntent(loginAccessIntent) === PARENT_ACCESS_MODE
    || isParentIntentPath(pathname)
}

export function resolveAccessModeForRoute({
  isParentHost = false,
  loginAccessIntent = '',
  pathname = '',
  selectedAccessMode = '',
} = {}) {
  const normalizedAccessMode = normalizeLoginAccessIntent(selectedAccessMode)
  const normalizedPath = normalizeParentIntentPath(pathname)

  if (normalizedAccessMode === PARENT_ACCESS_MODE && normalizedPath === '/' && !isIntentionalParentAccessContext({
    isParentHost,
    loginAccessIntent,
    pathname: normalizedPath,
  })) {
    return 'team'
  }

  return normalizedAccessMode
}

export function rememberParentAccessIntent() {
  rememberLoginAccessIntent(PARENT_ACCESS_MODE)
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
