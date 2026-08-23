export const MOBILE_SETTING_LOAD_STATES = Object.freeze({
  ERROR: 'error',
  LOADING: 'loading',
  READY: 'ready',
  STALE: 'stale',
})

export function preserveMobileNotificationState(currentState, message = '') {
  if (!currentState || typeof currentState !== 'object' || Array.isArray(currentState)) {
    return null
  }

  return {
    ...currentState,
    ...(String(message || '').trim() ? { message: String(message).trim() } : {}),
  }
}

export function shouldClearMobileDevicePreferences(ownershipStatus) {
  return String(ownershipStatus || '').trim().toLowerCase() === 'incompatible'
}
