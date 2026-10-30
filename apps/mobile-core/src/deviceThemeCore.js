export const DEVICE_THEME_MODES = ['system', 'light', 'dark']

// A new preference generation resets existing installations once. Later choices
// stay in this generation across launches, sign-outs and subsequent updates.
export function getDeviceThemeStorageKey(appRole) {
  return appRole === 'coach' ? 'fp.mobile.local.v1.coach.theme.light-default-v2' : 'fp.parent.display-theme.v2'
}

export function normalizeDeviceThemeMode(mode) {
  return DEVICE_THEME_MODES.includes(mode) ? mode : 'light'
}

export function resolveDeviceThemeMode(preference, systemMode) {
  const mode = normalizeDeviceThemeMode(preference)
  return mode === 'system' ? (systemMode === 'dark' ? 'dark' : 'light') : mode
}
