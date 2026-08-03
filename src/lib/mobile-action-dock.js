export const MOBILE_ACTION_DOCK_STORAGE_KEY = 'footballplayer.online:mobile-action-dock:collapsed:v1'
export const MOBILE_ACTION_DOCK_PREFERENCE_EVENT = 'footballplayer:mobile-action-dock-preference'
export const MOBILE_ACTION_DOCK_LAYOUT_EVENT = 'footballplayer:mobile-action-dock-layout'

function resolveStorage(storage) {
  try {
    return storage === undefined ? globalThis?.window?.localStorage : storage
  } catch {
    return null
  }
}

export function readMobileActionDockCollapsed(storage) {
  try {
    return resolveStorage(storage)?.getItem(MOBILE_ACTION_DOCK_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeMobileActionDockCollapsed(collapsed, storage) {
  try {
    const resolvedStorage = resolveStorage(storage)
    if (!resolvedStorage) return false
    resolvedStorage.setItem(MOBILE_ACTION_DOCK_STORAGE_KEY, collapsed ? 'true' : 'false')
    return true
  } catch {
    return false
  }
}

export function getMobileFloatingBottomClearance({
  documentElement = globalThis?.document?.documentElement,
  fallback = 112,
} = {}) {
  try {
    const value = globalThis?.window?.getComputedStyle(documentElement)
      .getPropertyValue('--mobile-floating-bottom-clearance')
      .trim()
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

export function isMobileVirtualKeyboardOpen({
  activeElement = globalThis?.document?.activeElement,
  innerHeight = globalThis?.window?.innerHeight,
  visualViewport = globalThis?.window?.visualViewport,
} = {}) {
  const tagName = String(activeElement?.tagName || '').toLowerCase()
  const isEditable = activeElement?.isContentEditable === true || ['input', 'select', 'textarea'].includes(tagName)
  const viewportHeight = Number(visualViewport?.height)
  const layoutHeight = Number(innerHeight)

  return Boolean(
    isEditable
      && Number.isFinite(viewportHeight)
      && Number.isFinite(layoutHeight)
      && layoutHeight - viewportHeight > 120,
  )
}
