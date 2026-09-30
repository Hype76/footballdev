export const DEVICE_THEME_MODES = ['system', 'light', 'dark']

export function normalizeDeviceThemeMode(mode) {
  return DEVICE_THEME_MODES.includes(mode) ? mode : 'system'
}

export function resolveDeviceThemeMode(preference, systemMode) {
  const mode = normalizeDeviceThemeMode(preference)
  return mode === 'system' ? (systemMode === 'dark' ? 'dark' : 'light') : mode
}
