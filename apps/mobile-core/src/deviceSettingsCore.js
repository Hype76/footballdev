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

export function getMobileNotificationIndicator(state, loadState = MOBILE_SETTING_LOAD_STATES.LOADING) {
  const hasState = Boolean(state && typeof state === 'object' && !Array.isArray(state))
  const checking = loadState === MOBILE_SETTING_LOAD_STATES.LOADING
  const ready = loadState === MOBILE_SETTING_LOAD_STATES.READY
  const preferenceEnabled = hasState && state.preferenceEnabled === undefined
    ? Boolean(state.enabled)
    : Boolean(state?.preferenceEnabled)
  const enabled = Boolean(
    hasState
    && ready
    && state.enabled
    && state.registered
    && state.permissionGranted
    && preferenceEnabled
    && String(state.detailLevel || '').trim().toLowerCase() !== 'off'
  )
  const lastConfirmed = [MOBILE_SETTING_LOAD_STATES.ERROR, MOBILE_SETTING_LOAD_STATES.STALE].includes(loadState)

  if (checking) {
    return Object.freeze({
      accessibilityLabel: 'Checking notification status. Open notification settings.',
      enabled: false,
      iconKey: 'notification.status-checking',
    })
  }

  if (enabled) {
    return Object.freeze({
      accessibilityLabel: 'Notifications on. Open notification settings.',
      enabled: true,
      iconKey: 'notification.status-on',
    })
  }

  return Object.freeze({
    accessibilityLabel: lastConfirmed
      ? 'Notifications off or need attention, last confirmed. Open notification settings.'
      : 'Notifications off or need attention. Open notification settings.',
    enabled: false,
    iconKey: 'notification.status-off',
  })
}

export function shouldClearMobileDevicePreferences(ownershipStatus) {
  return String(ownershipStatus || '').trim().toLowerCase() === 'incompatible'
}
