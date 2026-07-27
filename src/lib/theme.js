export const THEME_MODE_STORAGE_KEY = 'app-theme-mode'
export const THEME_ACCENT_STORAGE_KEY = 'app-theme-accent'
export const THEME_BUTTON_STYLE_STORAGE_KEY = 'app-theme-button-style'
export const THEME_BUTTON_STYLE_VERSION_STORAGE_KEY = 'app-theme-button-style-version'
export const THEME_CHANGED_EVENT = 'app-theme-changed'
export const THEME_BUTTON_STYLE_VERSION = '2'

export const THEME_MODES = ['system', 'dark', 'light']
export const THEME_ACCENTS = ['yellow', 'blue', 'green', 'red', 'purple']
export const THEME_BUTTON_STYLES = ['solid', 'gradient']
export const CUSTOM_THEME_ACCENT_OPTION = 'custom'
export const DEFAULT_CUSTOM_THEME_ACCENT = '#047857'

const HEX_THEME_ACCENT_PATTERN = /^#[0-9a-f]{6}$/
const BLACK_FOREGROUND = '#000000'
const DARK_FOREGROUND = '#06110a'
const LIGHT_FOREGROUND = '#ffffff'

const fixedThemeAccentPalettes = {
  light: {
    yellow: { accent: '#facc15', button: '#facc15' },
    blue: { accent: '#1d4ed8', button: '#1d4ed8' },
    green: { accent: '#15803d', button: '#047857' },
    red: { accent: '#dc2626', button: '#dc2626' },
    purple: { accent: '#7c3aed', button: '#7c3aed' },
  },
  dark: {
    yellow: { accent: '#fde047', button: '#fde047' },
    blue: { accent: '#60a5fa', button: '#60a5fa' },
    green: { accent: '#4ade80', button: '#4ade80' },
    red: { accent: '#f87171', button: '#f87171' },
    purple: { accent: '#a78bfa', button: '#a78bfa' },
  },
}

export const themeModeOptions = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export const themeAccentOptions = [
  { value: 'yellow', label: 'Yellow' },
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'red', label: 'Red' },
  { value: 'purple', label: 'Purple' },
  { value: CUSTOM_THEME_ACCENT_OPTION, label: 'Custom' },
]

export const themeButtonStyleOptions = [
  { value: 'solid', label: 'Solid' },
  { value: 'gradient', label: 'Gradient' },
]

export function getStoredThemeMode() {
  const storedThemeMode = window.localStorage.getItem(THEME_MODE_STORAGE_KEY)
  return THEME_MODES.includes(storedThemeMode) ? storedThemeMode : 'system'
}

export function getStoredThemeAccent() {
  return normalizeThemeAccent(window.localStorage.getItem(THEME_ACCENT_STORAGE_KEY), 'green')
}

export function getStoredThemeButtonStyle() {
  const storedThemeButtonStyle = window.localStorage.getItem(THEME_BUTTON_STYLE_STORAGE_KEY)
  const storedVersion = window.localStorage.getItem(THEME_BUTTON_STYLE_VERSION_STORAGE_KEY)

  if (storedVersion !== THEME_BUTTON_STYLE_VERSION) {
    return normalizeLegacyThemeButtonStyle(storedThemeButtonStyle)
  }

  return normalizeThemeButtonStyle(storedThemeButtonStyle)
}

export function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function normalizeThemeMode(value) {
  return THEME_MODES.includes(value) ? value : 'system'
}

export function normalizeThemeAccent(value, fallback = 'yellow') {
  const normalizedValue = String(value ?? '').trim().toLowerCase()

  if (THEME_ACCENTS.includes(normalizedValue) || HEX_THEME_ACCENT_PATTERN.test(normalizedValue)) {
    return normalizedValue
  }

  return THEME_ACCENTS.includes(fallback) || HEX_THEME_ACCENT_PATTERN.test(String(fallback ?? '').toLowerCase())
    ? String(fallback).toLowerCase()
    : 'yellow'
}

export function isCustomThemeAccent(value) {
  return HEX_THEME_ACCENT_PATTERN.test(String(value ?? '').trim())
}

export function getThemeAccentOption(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase()

  if (THEME_ACCENTS.includes(normalizedValue)) {
    return normalizedValue
  }

  return isCustomThemeAccent(normalizedValue) ? CUSTOM_THEME_ACCENT_OPTION : CUSTOM_THEME_ACCENT_OPTION
}

export function normalizeClubAccentColour(value) {
  const rawValue = String(value ?? '').trim()
  const normalizedValue = rawValue.toLowerCase()

  if (!THEME_ACCENTS.includes(normalizedValue) && !HEX_THEME_ACCENT_PATTERN.test(rawValue)) {
    throw new Error('Choose a valid club accent colour.')
  }

  return normalizedValue
}

export function normalizeThemeButtonStyle(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase()
  const legacySolidValues = new Set([
    'legacy solid',
    'legacy-solid',
    'legacy_solid',
    'solid colour',
    'solid-colour',
    'solid_colour',
    'solid color',
    'solid-color',
    'solid_color',
  ])

  if (legacySolidValues.has(normalizedValue)) {
    return 'solid'
  }

  return THEME_BUTTON_STYLES.includes(normalizedValue) ? normalizedValue : 'solid'
}

export function normalizeClubButtonStyle(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase()
  const normalizedButtonStyle = normalizeThemeButtonStyle(normalizedValue)
  const recognizedLegacyValue = [
    'legacy solid',
    'legacy-solid',
    'legacy_solid',
    'solid colour',
    'solid-colour',
    'solid_colour',
    'solid color',
    'solid-color',
    'solid_color',
  ].includes(normalizedValue)

  if (!THEME_BUTTON_STYLES.includes(normalizedValue) && !recognizedLegacyValue) {
    throw new Error('Choose a valid club button style.')
  }

  return normalizedButtonStyle
}

export function normalizeLegacyThemeButtonStyle() {
  return 'solid'
}

function hexToRgb(value) {
  const normalizedValue = normalizeClubAccentColour(value).slice(1)
  return {
    red: Number.parseInt(normalizedValue.slice(0, 2), 16),
    green: Number.parseInt(normalizedValue.slice(2, 4), 16),
    blue: Number.parseInt(normalizedValue.slice(4, 6), 16),
  }
}

function rgbToHex({ red, green, blue }) {
  return `#${[red, green, blue]
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0'))
    .join('')}`
}

function mixHex(source, target, targetWeight) {
  const sourceRgb = hexToRgb(source)
  const targetRgb = hexToRgb(target)
  const weight = Math.max(0, Math.min(1, Number(targetWeight) || 0))

  return rgbToHex({
    red: sourceRgb.red + ((targetRgb.red - sourceRgb.red) * weight),
    green: sourceRgb.green + ((targetRgb.green - sourceRgb.green) * weight),
    blue: sourceRgb.blue + ((targetRgb.blue - sourceRgb.blue) * weight),
  })
}

function relativeLuminance(value) {
  const { red, green, blue } = hexToRgb(value)
  const channels = [red, green, blue].map((channel) => {
    const normalizedChannel = channel / 255
    return normalizedChannel <= 0.04045
      ? normalizedChannel / 12.92
      : ((normalizedChannel + 0.055) / 1.055) ** 2.4
  })

  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
}

export function getThemeContrastRatio(foreground, background) {
  const luminances = [relativeLuminance(foreground), relativeLuminance(background)]
    .sort((left, right) => right - left)
  return (luminances[0] + 0.05) / (luminances[1] + 0.05)
}

function chooseReadableForeground(backgrounds) {
  const candidates = [DARK_FOREGROUND, BLACK_FOREGROUND, LIGHT_FOREGROUND]

  return candidates
    .map((foreground) => ({
      foreground,
      minimumContrast: Math.min(...backgrounds.map((background) =>
        getThemeContrastRatio(foreground, background))),
    }))
    .sort((left, right) => right.minimumContrast - left.minimumContrast)[0]
}

function ensureReadableAccentText(accent, background, resolvedTheme) {
  const contrast = getThemeContrastRatio(accent, background)

  if (contrast >= 4.5) {
    return accent
  }

  const target = resolvedTheme === 'dark' ? LIGHT_FOREGROUND : DARK_FOREGROUND

  for (let step = 1; step <= 20; step += 1) {
    const candidate = mixHex(accent, target, step / 20)

    if (getThemeContrastRatio(candidate, background) >= 4.5) {
      return candidate
    }
  }

  return target
}

function createGradient(primary) {
  const candidates = [
    {
      endpoint: mixHex(primary, LIGHT_FOREGROUND, 0.34),
      direction: LIGHT_FOREGROUND,
    },
    {
      endpoint: mixHex(primary, DARK_FOREGROUND, 0.3),
      direction: DARK_FOREGROUND,
    },
  ]

  return candidates
    .map((candidate) => ({
      ...candidate,
      ...chooseReadableForeground([primary, candidate.endpoint]),
    }))
    .sort((left, right) => right.minimumContrast - left.minimumContrast)[0]
}

export function createThemeColorTokens(value, resolvedTheme = 'light') {
  const normalizedTheme = resolvedTheme === 'dark' ? 'dark' : 'light'
  const normalizedAccent = normalizeThemeAccent(value, 'green')
  const customAccent = isCustomThemeAccent(normalizedAccent)
  const palette = customAccent
    ? { accent: normalizedAccent, button: normalizedAccent }
    : fixedThemeAccentPalettes[normalizedTheme][normalizedAccent]
  const panelBackground = normalizedTheme === 'dark' ? '#14201c' : '#ffffff'
  const accentSoft = mixHex(
    palette.accent,
    panelBackground,
    normalizedTheme === 'dark' ? 0.7 : 0.84,
  )
  const gradient = createGradient(palette.button)
  const hoverPrimary = mixHex(palette.button, gradient.direction, 0.1)
  const activePrimary = mixHex(palette.button, gradient.direction, 0.18)
  const hoverEndpoint = mixHex(gradient.endpoint, gradient.direction, 0.08)
  const activeEndpoint = mixHex(gradient.endpoint, gradient.direction, 0.14)
  const disabledPrimary = mixHex(palette.button, panelBackground, 0.58)
  const disabledForeground = chooseReadableForeground([disabledPrimary]).foreground
  const textSecondary = ensureReadableAccentText(palette.accent, panelBackground, normalizedTheme)

  return {
    accent: palette.accent,
    accentText: chooseReadableForeground([palette.accent]).foreground,
    accentSoft,
    buttonPrimary: palette.button,
    buttonPrimaryText: gradient.foreground,
    buttonPrimaryGradient: `linear-gradient(135deg, ${palette.button}, ${gradient.endpoint})`,
    buttonPrimaryGradientHover: `linear-gradient(135deg, ${hoverPrimary}, ${hoverEndpoint})`,
    buttonPrimaryGradientActive: `linear-gradient(135deg, ${activePrimary}, ${activeEndpoint})`,
    buttonPrimaryHover: hoverPrimary,
    buttonPrimaryActive: activePrimary,
    buttonPrimaryDisabled: disabledPrimary,
    buttonPrimaryDisabledText: disabledForeground,
    focusRing: textSecondary,
    sidebarActiveBackground: accentSoft,
    textSecondary,
  }
}

export function getThemeColorVariableStyle(value, resolvedTheme = 'light') {
  const tokens = createThemeColorTokens(value, resolvedTheme)

  return {
    '--accent': tokens.accent,
    '--accent-text': tokens.accentText,
    '--accent-soft': tokens.accentSoft,
    '--button-primary': tokens.buttonPrimary,
    '--button-primary-gradient': tokens.buttonPrimaryGradient,
    '--button-primary-gradient-hover': tokens.buttonPrimaryGradientHover,
    '--button-primary-gradient-active': tokens.buttonPrimaryGradientActive,
    '--button-primary-text': tokens.buttonPrimaryText,
    '--button-primary-hover': tokens.buttonPrimaryHover,
    '--button-primary-active': tokens.buttonPrimaryActive,
    '--button-primary-disabled': tokens.buttonPrimaryDisabled,
    '--button-primary-disabled-text': tokens.buttonPrimaryDisabledText,
    '--focus-ring': tokens.focusRing,
    '--sidebar-active-bg': tokens.sidebarActiveBackground,
    '--text-secondary': tokens.textSecondary,
  }
}

export function applyThemeColorVariables(target, value, resolvedTheme = 'light') {
  if (!target?.style) {
    return
  }

  Object.entries(getThemeColorVariableStyle(value, resolvedTheme)).forEach(([property, propertyValue]) => {
    target.style.setProperty(property, propertyValue)
  })
}

export function saveThemePreferences({ mode, accent, buttonStyle }) {
  const nextMode = normalizeThemeMode(mode)
  const nextAccent = normalizeThemeAccent(accent)
  const nextButtonStyle = normalizeThemeButtonStyle(buttonStyle)

  window.localStorage.setItem(THEME_MODE_STORAGE_KEY, nextMode)
  window.localStorage.setItem(THEME_ACCENT_STORAGE_KEY, nextAccent)
  window.localStorage.setItem(THEME_BUTTON_STYLE_STORAGE_KEY, nextButtonStyle)
  window.localStorage.setItem(THEME_BUTTON_STYLE_VERSION_STORAGE_KEY, THEME_BUTTON_STYLE_VERSION)
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
