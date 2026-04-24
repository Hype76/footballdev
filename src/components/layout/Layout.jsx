import { useEffect, useMemo, useState } from 'react'
import { Navigate, Outlet, useLocation, useMatches } from 'react-router-dom'
import { useAuth } from '../../lib/auth.js'
import { Sidebar } from './Sidebar.jsx'
import { Topbar } from './Topbar.jsx'

const THEME_MODE_STORAGE_KEY = 'app-theme-mode'
const THEME_ACCENT_STORAGE_KEY = 'app-theme-accent'
const THEME_MODES = ['system', 'dark', 'light']
const THEME_ACCENTS = ['yellow', 'blue', 'green', 'red', 'purple']

function getStoredThemeMode() {
  const storedThemeMode = window.localStorage.getItem(THEME_MODE_STORAGE_KEY)
  return THEME_MODES.includes(storedThemeMode) ? storedThemeMode : 'system'
}

function getStoredThemeAccent() {
  const storedThemeAccent = window.localStorage.getItem(THEME_ACCENT_STORAGE_KEY)
  return THEME_ACCENTS.includes(storedThemeAccent) ? storedThemeAccent : 'yellow'
}

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function Layout() {
  const { user } = useAuth()
  const location = useLocation()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [themeMode, setThemeMode] = useState(getStoredThemeMode)
  const [themeAccent, setThemeAccent] = useState(getStoredThemeAccent)
  const [systemTheme, setSystemTheme] = useState(getSystemTheme)
  const matches = useMatches()
  const activeTitle = [...matches].reverse().find((match) => match.handle?.title)?.handle?.title ?? 'Dashboard'
  const resolvedTheme = useMemo(
    () => (themeMode === 'system' ? systemTheme : themeMode),
    [systemTheme, themeMode],
  )

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleSystemThemeChange = () => {
      setSystemTheme(mediaQuery.matches ? 'dark' : 'light')
    }

    mediaQuery.addEventListener('change', handleSystemThemeChange)
    return () => {
      mediaQuery.removeEventListener('change', handleSystemThemeChange)
    }
  }, [])

  useEffect(() => {
    document.body.classList.remove(
      'theme-light',
      'theme-dark',
      'accent-yellow',
      'accent-blue',
      'accent-green',
      'accent-red',
      'accent-purple',
    )
    document.body.classList.add(resolvedTheme === 'dark' ? 'theme-dark' : 'theme-light')
    document.body.classList.add(`accent-${themeAccent}`)
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, themeMode)
    window.localStorage.setItem(THEME_ACCENT_STORAGE_KEY, themeAccent)
  }, [resolvedTheme, themeAccent, themeMode])

  useEffect(() => {
    const legacyTheme = window.localStorage.getItem('app-theme')

    if (legacyTheme) {
      window.localStorage.removeItem('app-theme')
    }
  }, [])

  const handleThemeModeChange = (nextThemeMode) => {
    setThemeMode(THEME_MODES.includes(nextThemeMode) ? nextThemeMode : 'system')
  }

  const handleThemeAccentChange = (nextThemeAccent) => {
    setThemeAccent(THEME_ACCENTS.includes(nextThemeAccent) ? nextThemeAccent : 'yellow')
  }

  if (user?.forcePasswordChange && location.pathname !== '/reset-password') {
    return <Navigate to="/reset-password" replace />
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[var(--app-bg)] text-[var(--text-primary)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px]">
        <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

        <div className="flex min-h-screen min-w-0 flex-1 flex-col lg:pl-72">
          <Topbar
            title={activeTitle}
            onMenuClick={() => setIsSidebarOpen(true)}
            themeMode={themeMode}
            themeAccent={themeAccent}
            onThemeModeChange={handleThemeModeChange}
            onThemeAccentChange={handleThemeAccentChange}
          />

          <main className="flex-1 px-3 py-4 sm:px-4 sm:py-5 md:px-6 md:py-6 xl:px-8">
            <div className="mx-auto w-full max-w-7xl">
              <div className="overflow-hidden rounded-[24px] border border-[var(--border-color)] bg-[var(--shell-card)] p-3 shadow-sm shadow-slate-900/10 sm:rounded-[28px] sm:p-5 md:p-6">
                <Outlet />
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
