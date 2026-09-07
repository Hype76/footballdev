import { contrastSafeColor, mixThemeColor, readableThemeTokens, themeContrastRatio, themeForeground } from './themeContrast.js'

const THEME_ACCENTS = new Set(['yellow', 'blue', 'green', 'red', 'purple'])
const HEX_ACCENT_PATTERN = /^#[0-9a-f]{6}$/

const WEB_ACCENT_PALETTES = Object.freeze({
  light: Object.freeze({
    yellow: Object.freeze({ accent: '#facc15', button: '#facc15' }),
    blue: Object.freeze({ accent: '#1d4ed8', button: '#1d4ed8' }),
    green: Object.freeze({ accent: '#15803d', button: '#047857' }),
    red: Object.freeze({ accent: '#dc2626', button: '#dc2626' }),
    purple: Object.freeze({ accent: '#7c3aed', button: '#7c3aed' }),
  }),
  dark: Object.freeze({
    yellow: Object.freeze({ accent: '#fde047', button: '#fde047' }),
    blue: Object.freeze({ accent: '#60a5fa', button: '#60a5fa' }),
    green: Object.freeze({ accent: '#4ade80', button: '#4ade80' }),
    red: Object.freeze({ accent: '#f87171', button: '#f87171' }),
    purple: Object.freeze({ accent: '#a78bfa', button: '#a78bfa' }),
  }),
})

const BASE_TOKENS = Object.freeze({
  dark: Object.freeze({
    background: '#030603',
    surface: '#0a160c',
    surfaceRaised: '#102415',
    portalBackground: '#061412',
    portalSurface: '#10231f',
    pitch: '#18733a',
    pitchLine: '#ffffff',
    textPrimary: '#f2faef',
    textSecondary: '#a9b8a6',
    border: '#1d3520',
    borderStrong: '#35543a',
    success: '#6ee7b7',
    successSurface: '#11240f',
    warning: '#ffdca2',
    warningSurface: '#2c210d',
    danger: '#ffb4ab',
    dangerSurface: '#351313',
    muted: '#78908a',
  }),
  light: Object.freeze({
    background: '#f3f7f6',
    surface: '#ffffff',
    surfaceRaised: '#f7faf8',
    portalBackground: '#f3f7f6',
    portalSurface: '#ffffff',
    pitch: '#18733a',
    pitchLine: '#ffffff',
    textPrimary: '#132522',
    textSecondary: '#536461',
    border: '#cbd8d5',
    borderStrong: '#9fb3ae',
    success: '#047857',
    successSurface: '#ecfdf5',
    warning: '#8a5800',
    warningSurface: '#fff7e0',
    danger: '#b42318',
    dangerSurface: '#fff1f0',
    muted: '#6f817d',
  }),
})

function normalizeText(value) {
  return String(value ?? '').trim()
}

export function normalizeParentThemeMode(value) {
  return normalizeText(value).toLowerCase() === 'light' ? 'light' : 'dark'
}

export function normalizeParentThemeAccent(value, fallback = 'yellow') {
  const normalized = normalizeText(value).toLowerCase()
  if (THEME_ACCENTS.has(normalized) || HEX_ACCENT_PATTERN.test(normalized)) return normalized
  const normalizedFallback = normalizeText(fallback).toLowerCase()
  return THEME_ACCENTS.has(normalizedFallback) || HEX_ACCENT_PATTERN.test(normalizedFallback)
    ? normalizedFallback
    : 'yellow'
}

export function normalizeParentButtonStyle(value) {
  return normalizeText(value).toLowerCase() === 'gradient' ? 'gradient' : 'solid'
}

export function normalizeParentLogoUrl(value) {
  const normalized = normalizeText(value)
  if (!normalized) return ''
  try {
    const url = new URL(normalized)
    return url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

export const getParentThemeContrastRatio = themeContrastRatio

function resolveAccentPalette(accent, mode) {
  if (HEX_ACCENT_PATTERN.test(accent)) return { accent, button: accent }
  return WEB_ACCENT_PALETTES[mode][accent] || WEB_ACCENT_PALETTES[mode].yellow
}

export function resolveParentMobileBranding(selectedLink = null) {
  return {
    accent: normalizeParentThemeAccent(selectedLink?.themeAccent, 'yellow'),
    buttonStyle: normalizeParentButtonStyle(selectedLink?.themeButtonStyle),
    clubLogoUrl: normalizeParentLogoUrl(selectedLink?.clubLogoUrl),
    sourceClubId: normalizeText(selectedLink?.clubId),
    sourceLinkId: normalizeText(selectedLink?.id),
  }
}

export function createParentMobileTheme({ mode = 'dark', selectedLink = null } = {}) {
  const resolvedMode = normalizeParentThemeMode(mode)
  const branding = resolveParentMobileBranding(selectedLink)
  const base = BASE_TOKENS[resolvedMode]
  const branded = resolveAccentPalette(branding.accent, resolvedMode)
  const accentForeground = themeForeground(branded.button)
  const accentSoft = mixThemeColor(branded.accent, base.surface, resolvedMode === 'dark' ? 0.84 : 0.92)
  const accentMuted = mixThemeColor(branded.accent, base.surface, resolvedMode === 'dark' ? 0.46 : 0.62)

  const surfaces = [base.background, base.surface, base.surfaceRaised, base.portalBackground, base.portalSurface, base.successSurface, base.warningSurface, base.dangerSurface, accentSoft]
  const accentText = contrastSafeColor(branded.accent, surfaces, resolvedMode)
  const tokens = Object.freeze({
    ...readableThemeTokens(base, surfaces, resolvedMode),
    accent: branded.accent,
    accentForeground,
    accentMuted,
    accentSoft,
    accentText,
    notificationFill: '#b91c1c',
    notificationForeground: '#ffffff',
    buttonPrimary: branded.button,
    selectedSurface: accentSoft,
  })

  return Object.freeze({ branding: Object.freeze(branding), mode: resolvedMode, tokens })
}

export const DEFAULT_PARENT_MOBILE_THEME = createParentMobileTheme()
