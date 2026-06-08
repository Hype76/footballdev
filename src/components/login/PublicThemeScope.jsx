import { useEffect } from 'react'
import {
  THEME_CHANGED_EVENT,
  getStoredThemeAccent,
  getStoredThemeButtonStyle,
  getStoredThemeMode,
  normalizeThemeAccent,
  normalizeThemeButtonStyle,
  normalizeThemeMode,
} from '../../lib/theme.js'

function applyPublicTheme() {
  const mode = normalizeThemeMode(getStoredThemeMode())
  const accent = normalizeThemeAccent(getStoredThemeAccent())
  const buttonStyle = normalizeThemeButtonStyle(getStoredThemeButtonStyle())
  const resolvedMode = mode === 'light' ? 'light' : 'dark'
  const root = document.documentElement
  const body = document.body

  root.classList.remove(
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
  root.classList.add(resolvedMode === 'dark' ? 'theme-dark' : 'theme-light')
  root.classList.add(`accent-${accent}`)
  root.classList.add(`button-style-${buttonStyle}`)
  body.classList.add(resolvedMode === 'dark' ? 'theme-dark' : 'theme-light')
  body.classList.add(`accent-${accent}`)
  body.classList.add(`button-style-${buttonStyle}`)
  root.dataset.themeAccent = accent
  root.dataset.buttonStyle = buttonStyle
  body.dataset.themeAccent = accent
  body.dataset.buttonStyle = buttonStyle
}

export function usePublicThemeScope() {
  useEffect(() => {
    const handleChange = () => applyPublicTheme()

    applyPublicTheme()
    window.addEventListener(THEME_CHANGED_EVENT, handleChange)

    return () => {
      window.removeEventListener(THEME_CHANGED_EVENT, handleChange)
    }
  }, [])
}

export const publicImageOverlayStyle = {
  background: 'color-mix(in srgb, var(--app-bg) 48%, transparent)',
}

export const publicImageBottomFadeStyle = {
  background: 'linear-gradient(to bottom, transparent, color-mix(in srgb, var(--app-bg) 82%, transparent))',
}
