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

function hexToRgb(value) {
  const normalized = value.slice(1)
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16),
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
    const normalized = channel / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
}

export function getParentThemeContrastRatio(foreground, background) {
  const values = [relativeLuminance(foreground), relativeLuminance(background)]
    .sort((left, right) => right - left)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

function readableForeground(background) {
  return ['#06110a', '#000000', '#ffffff']
    .map((foreground) => ({ foreground, contrast: getParentThemeContrastRatio(foreground, background) }))
    .sort((left, right) => right.contrast - left.contrast)[0].foreground
}

function readableAccent(accent, background, mode) {
  if (getParentThemeContrastRatio(accent, background) >= 4.5) return accent
  const target = mode === 'dark' ? '#ffffff' : '#06110a'
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mixHex(accent, target, step / 20)
    if (getParentThemeContrastRatio(candidate, background) >= 4.5) return candidate
  }
  return target
}

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
  const accentForeground = readableForeground(branded.button)
  const accentText = readableAccent(branded.accent, base.surface, resolvedMode)
  const accentSoft = mixHex(branded.accent, base.surface, resolvedMode === 'dark' ? 0.72 : 0.86)
  const accentMuted = mixHex(branded.accent, base.surface, resolvedMode === 'dark' ? 0.46 : 0.62)

  const tokens = Object.freeze({
    ...base,
    accent: branded.accent,
    accentForeground,
    accentMuted,
    accentSoft,
    accentText,
    buttonPrimary: branded.button,
    selectedSurface: accentSoft,
  })

  return Object.freeze({ branding: Object.freeze(branding), mode: resolvedMode, tokens })
}

export const DEFAULT_PARENT_MOBILE_THEME = createParentMobileTheme()
