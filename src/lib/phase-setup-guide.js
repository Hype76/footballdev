export const PHASE_SETUP_GUIDE_OPEN_EVENT = 'football-phase-setup-guide-open'
export const PHASE_SETUP_GUIDE_STATE_EVENT = 'football-phase-setup-guide-state'
export const PHASE_SETUP_GUIDE_TARGET_STORAGE_KEY = 'football-phase-setup-guide-target-selector'

export function isPhaseSetupGuideEnabled() {
  return String(import.meta.env.VITE_PAYMENTS_DISABLED ?? '').trim().toLowerCase() === 'true'
}

export function getPhaseSetupGuideStorageKey(user) {
  const userKey = String(user?.id || user?.email || 'anonymous').trim() || 'anonymous'
  return `football-phase-1-setup-guide-dismissed:${userKey}`
}

export function openPhaseSetupGuide() {
  window.dispatchEvent(new Event(PHASE_SETUP_GUIDE_OPEN_EVENT))
}

export function isPhaseSetupGuideDismissed(user) {
  return window.localStorage.getItem(getPhaseSetupGuideStorageKey(user)) === 'true'
}

export function emitPhaseSetupGuideState(isActive) {
  window.dispatchEvent(new CustomEvent(PHASE_SETUP_GUIDE_STATE_EVENT, {
    detail: { isActive: Boolean(isActive) },
  }))
}
