import { useEffect } from 'react'
import {
  THEME_CHANGED_EVENT,
  getStoredThemeAccent,
  getStoredThemeButtonStyle,
  getStoredThemeMode,
  getSystemTheme,
  normalizeThemeAccent,
  normalizeThemeButtonStyle,
  normalizeThemeMode,
} from '../../lib/theme.js'

function applyPublicTheme() {
  const mode = normalizeThemeMode(getStoredThemeMode())
  const accent = normalizeThemeAccent(getStoredThemeAccent())
  const buttonStyle = normalizeThemeButtonStyle(getStoredThemeButtonStyle())
  const resolvedMode = mode === 'system' ? getSystemTheme() : mode
  const body = document.body

  body.classList.remove(
    'theme-light',
    'theme-dark',
    'accent-yellow',
    'accent-blue',
    'accent-green',
    'accent-red',
    'accent-purple',
    'button-style-solid',
    'button-style-gradient',
  )
  body.classList.add(resolvedMode === 'dark' ? 'theme-dark' : 'theme-light')
  body.classList.add(`accent-${accent}`)
  body.classList.add(`button-style-${buttonStyle}`)
  body.dataset.themeAccent = accent
  body.dataset.buttonStyle = buttonStyle
}

export function usePublicThemeScope() {
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => applyPublicTheme()

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
