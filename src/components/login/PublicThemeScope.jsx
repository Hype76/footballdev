import { useEffect } from 'react'
import {
  THEME_CHANGED_EVENT,
  applyThemeColorVariables,
  getStoredThemeAccent,
  getStoredThemeButtonStyle,
  getStoredThemeMode,
  getSystemTheme,
  isCustomThemeAccent,
  normalizeThemeAccent,
  normalizeThemeButtonStyle,
  normalizeThemeMode,
} from '../../lib/theme.js'

function applyPublicTheme() {
  const mode = normalizeThemeMode(getStoredThemeMode())
  const accent = normalizeThemeAccent(getStoredThemeAccent())
  const buttonStyle = normalizeThemeButtonStyle(getStoredThemeButtonStyle())
  const resolvedMode = mode === 'system' ? getSystemTheme() : mode
  const root = document.documentElement
  const body = document.body
  const accentClassName = isCustomThemeAccent(accent) ? 'accent-custom' : `accent-${accent}`

  root.classList.remove(
    'theme-light',
    'theme-dark',
    'accent-yellow',
    'accent-blue',
    'accent-green',
    'accent-red',
    'accent-purple',
    'accent-custom',
    'button-style-solid',
    'button-style-gradient',
  )
  body.classList.remove(
    'theme-light',
    'theme-dark',
    'accent-yellow',
    'accent-blue',
    'accent-green',
    'accent-red',
    'accent-purple',
    'accent-custom',
    'button-style-solid',
    'button-style-gradient',
  )
  root.classList.add(resolvedMode === 'dark' ? 'theme-dark' : 'theme-light')
  root.classList.add(accentClassName)
  root.classList.add(`button-style-${buttonStyle}`)
  body.classList.add(resolvedMode === 'dark' ? 'theme-dark' : 'theme-light')
  body.classList.add(accentClassName)
  body.classList.add(`button-style-${buttonStyle}`)
  applyThemeColorVariables(root, accent, resolvedMode)
  applyThemeColorVariables(body, accent, resolvedMode)
  root.dataset.themeAccent = accent
  root.dataset.buttonStyle = buttonStyle
  body.dataset.themeAccent = accent
  body.dataset.buttonStyle = buttonStyle
}

export function usePublicThemeScope() {
  useEffect(() => {
    const handleChange = () => applyPublicTheme()
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    applyPublicTheme()
    window.addEventListener(THEME_CHANGED_EVENT, handleChange)
    mediaQuery.addEventListener('change', handleChange)

    return () => {
      window.removeEventListener(THEME_CHANGED_EVENT, handleChange)
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])
}

export const publicImageOverlayStyle = {
  background: 'color-mix(in srgb, var(--app-bg) 48%, transparent)',
}

export const publicImageBottomFadeStyle = {
  background: 'linear-gradient(to bottom, transparent, color-mix(in srgb, var(--app-bg) 82%, transparent))',
}
