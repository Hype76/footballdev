export const THEME_MODE_STORAGE_KEY = 'app-theme-mode'
export const THEME_ACCENT_STORAGE_KEY = 'app-theme-accent'
export const THEME_BUTTON_STYLE_STORAGE_KEY = 'app-theme-button-style'
export const THEME_CHANGED_EVENT = 'app-theme-changed'

export const THEME_MODES = ['system', 'dark', 'light']
export const THEME_ACCENTS = ['yellow', 'blue', 'green', 'red', 'purple']
export const THEME_BUTTON_STYLES = ['solid', 'gradient']

export const themeModeOptions = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Match device' },
]

export const themeAccentOptions = [
  { value: 'yellow', label: 'Yellow' },
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'red', label: 'Red' },
  { value: 'purple', label: 'Purple' },
]

export const themeButtonStyleOptions = [
  { value: 'solid', label: 'Solid colour' },
  { value: 'gradient', label: 'Gradient' },
]

export function getStoredThemeMode() {
  const storedThemeMode = window.localStorage.getItem(THEME_MODE_STORAGE_KEY)
  return THEME_MODES.includes(storedThemeMode) ? storedThemeMode : 'light'
}

export function getStoredThemeAccent() {
  const storedThemeAccent = window.localStorage.getItem(THEME_ACCENT_STORAGE_KEY)
  return THEME_ACCENTS.includes(storedThemeAccent) ? storedThemeAccent : 'green'
}

export function getStoredThemeButtonStyle() {
  const storedThemeButtonStyle = window.localStorage.getItem(THEME_BUTTON_STYLE_STORAGE_KEY)
  return THEME_BUTTON_STYLES.includes(storedThemeButtonStyle) ? storedThemeButtonStyle : 'solid'
}

export function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function normalizeThemeMode(value) {
  return THEME_MODES.includes(value) ? value : 'light'
}

export function normalizeThemeAccent(value) {
  return THEME_ACCENTS.includes(value) ? value : 'yellow'
}

export function normalizeThemeButtonStyle(value) {
  return THEME_BUTTON_STYLES.includes(value) ? value : 'solid'
}

export function saveThemePreferences({ mode, accent, buttonStyle }) {
  const nextMode = normalizeThemeMode(mode)
  const nextAccent = normalizeThemeAccent(accent)
  const nextButtonStyle = normalizeThemeButtonStyle(buttonStyle)

  window.localStorage.setItem(THEME_MODE_STORAGE_KEY, nextMode)
  window.localStorage.setItem(THEME_ACCENT_STORAGE_KEY, nextAccent)
  window.localStorage.setItem(THEME_BUTTON_STYLE_STORAGE_KEY, nextButtonStyle)
  window.dispatchEvent(
    new CustomEvent(THEME_CHANGED_EVENT, {
      detail: {
        mode: nextMode,
        accent: nextAccent,
        buttonStyle: nextButtonStyle,
      },
    }),
  )

  return {
    mode: nextMode,
    accent: nextAccent,
    buttonStyle: nextButtonStyle,
  }
}
