export const PARENT_PORTAL_MOBILE_NAV_STORAGE_KEY = 'footballplayer.online:parent-portal-mobile-nav:collapsed:v1'
export const PARENT_PORTAL_MOBILE_NAV_PREFERENCE_EVENT = 'footballplayer:parent-portal-mobile-nav-preference'

function resolveStorage(storage) {
  try {
    return storage === undefined ? globalThis?.window?.localStorage : storage
  } catch {
    return null
  }
}

export function readParentPortalMobileNavCollapsed(storage) {
  try {
    return resolveStorage(storage)?.getItem(PARENT_PORTAL_MOBILE_NAV_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeParentPortalMobileNavCollapsed(collapsed, storage) {
  try {
    const resolvedStorage = resolveStorage(storage)
    if (!resolvedStorage) return false
    resolvedStorage.setItem(PARENT_PORTAL_MOBILE_NAV_STORAGE_KEY, collapsed ? 'true' : 'false')
    return true
  } catch {
    return false
  }
}
