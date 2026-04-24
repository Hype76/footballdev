export const THEME_MODE_STORAGE_KEY = 'app-theme-mode'
export const THEME_ACCENT_STORAGE_KEY = 'app-theme-accent'
export const THEME_CHANGED_EVENT = 'app-theme-changed'

export const THEME_MODES = ['system', 'dark', 'light']
export const THEME_ACCENTS = ['yellow', 'blue', 'green', 'red', 'purple']

export const themeModeOptions = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

export const themeAccentOptions = [
  { value: 'yellow', label: 'Yellow' },
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'red', label: 'Red' },
  { value: 'purple', label: 'Purple' },
]

export function getStoredThemeMode() {
  const storedThemeMode = window.localStorage.getItem(THEME_MODE_STORAGE_KEY)
  return THEME_MODES.includes(storedThemeMode) ? storedThemeMode : 'system'
}

export function getStoredThemeAccent() {
  const storedThemeAccent = window.localStorage.getItem(THEME_ACCENT_STORAGE_KEY)
  return THEME_ACCENTS.includes(storedThemeAccent) ? storedThemeAccent : 'yellow'
}

export function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function normalizeThemeMode(value) {
  return THEME_MODES.includes(value) ? value : 'system'
}

export function normalizeThemeAccent(value) {
  return THEME_ACCENTS.includes(value) ? value : 'yellow'
}

export function saveThemePreferences({ mode, accent }) {
  const nextMode = normalizeThemeMode(mode)
  const nextAccent = normalizeThemeAccent(accent)

  window.localStorage.setItem(THEME_MODE_STORAGE_KEY, nextMode)
  window.localStorage.setItem(THEME_ACCENT_STORAGE_KEY, nextAccent)
  window.dispatchEvent(
    new CustomEvent(THEME_CHANGED_EVENT, {
      detail: {
        mode: nextMode,
        accent: nextAccent,
      },
    }),
  )

  return {
    mode: nextMode,
    accent: nextAccent,
  }
}
