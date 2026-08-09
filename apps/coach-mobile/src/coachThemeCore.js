const ACCENTS = new Set(['yellow', 'blue', 'green', 'red', 'purple'])
const HEX_PATTERN = /^#[0-9a-f]{6}$/

const PALETTES = Object.freeze({
  dark: Object.freeze({ yellow: '#fde047', blue: '#60a5fa', green: '#4ade80', red: '#f87171', purple: '#a78bfa' }),
  light: Object.freeze({ yellow: '#ca8a04', blue: '#1d4ed8', green: '#15803d', red: '#dc2626', purple: '#7c3aed' }),
})

const BASE = Object.freeze({
  dark: Object.freeze({
    background: '#030603', disabled: '#536457', overlay: 'rgba(0,0,0,0.72)', surface: '#0a160c', surfaceRaised: '#102415',
    textPrimary: '#f2faef', textSecondary: '#a9b8a6', textMuted: '#78908a', border: '#1d3520', success: '#6ee7b7', warning: '#ffd166', danger: '#ff8b82',
  }),
  light: Object.freeze({
    background: '#f3f7f6', disabled: '#9aa8a4', overlay: 'rgba(19,37,34,0.46)', surface: '#ffffff', surfaceRaised: '#eaf1ee',
    textPrimary: '#132522', textSecondary: '#536461', textMuted: '#6f817d', border: '#cbd8d5', success: '#047857', warning: '#8a5800', danger: '#b42318',
  }),
})

function normalize(value) {
  return String(value ?? '').trim()
}

function normalizeMode(value) {
  return normalize(value).toLowerCase() === 'light' ? 'light' : 'dark'
}

function normalizeAccent(value, fallback = 'green') {
  const normalized = normalize(value).toLowerCase()
  if (ACCENTS.has(normalized) || HEX_PATTERN.test(normalized)) return normalized
  return ACCENTS.has(fallback) ? fallback : 'green'
}

function channel(hex, offset) {
  return Number.parseInt(hex.slice(offset, offset + 2), 16)
}

function luminance(hex) {
  const values = [1, 3, 5].map((offset) => {
    const value = channel(hex, offset) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return (0.2126 * values[0]) + (0.7152 * values[1]) + (0.0722 * values[2])
}

export function getCoachContrastRatio(left, right) {
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

function readableForeground(background) {
  return ['#06110a', '#ffffff'].sort((left, right) => (
    getCoachContrastRatio(right, background) - getCoachContrastRatio(left, background)
  ))[0]
}

export function normalizeCoachLogoUrl(value) {
  try {
    const url = new URL(normalize(value))
    return url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

export function resolveCoachBranding(context = null) {
  const clubAccent = normalizeAccent(context?.clubAccent, '')
  const teamAccent = normalizeAccent(context?.teamAccent, '')
  const hasClubAccent = ACCENTS.has(normalize(context?.clubAccent).toLowerCase()) || HEX_PATTERN.test(normalize(context?.clubAccent).toLowerCase())
  const hasTeamAccent = ACCENTS.has(normalize(context?.teamAccent).toLowerCase()) || HEX_PATTERN.test(normalize(context?.teamAccent).toLowerCase())
  return Object.freeze({
    accent: hasClubAccent ? clubAccent : hasTeamAccent ? teamAccent : 'green',
    buttonStyle: normalize(context?.clubButtonStyle || context?.teamButtonStyle).toLowerCase() === 'gradient' ? 'gradient' : 'solid',
    logoUrl: normalizeCoachLogoUrl(context?.clubLogoUrl),
    source: hasClubAccent ? 'club' : hasTeamAccent ? 'team' : 'default',
  })
}

export function createCoachTheme({ context = null, mode = 'dark' } = {}) {
  const resolvedMode = normalizeMode(mode)
  const branding = resolveCoachBranding(context)
  const base = BASE[resolvedMode]
  const accent = HEX_PATTERN.test(branding.accent) ? branding.accent : PALETTES[resolvedMode][branding.accent]
  const selected = resolvedMode === 'dark' ? `${accent}2e` : `${accent}1f`
  const tokens = Object.freeze({
    ...base,
    accent,
    accentForeground: readableForeground(accent),
    selected,
    selectedForeground: accent,
  })
  return Object.freeze({ branding, mode: resolvedMode, tokens })
}

export const DEFAULT_COACH_THEME = createCoachTheme()
