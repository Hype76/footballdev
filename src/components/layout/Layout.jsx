import { useEffect, useMemo, useState } from 'react'
import { Outlet, useMatches } from 'react-router-dom'
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
  const { authError, clubOptions, isProfileLoading, selectClub } = useAuth()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [clubSelectionError, setClubSelectionError] = useState('')
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

  const handleClubSelect = async (clubId) => {
    setClubSelectionError('')

    try {
      await selectClub(clubId)
    } catch (error) {
      console.error(error)
      setClubSelectionError(error.message || 'Could not open this club.')
    }
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

      {clubOptions.length > 1 ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8">
          <div className="w-full max-w-xl rounded-[28px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 shadow-2xl shadow-black/40 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-secondary)]">Choose Club</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Which club do you want to open?</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
              This email is linked to more than one club. Pick the club workspace you want to use for this session.
            </p>

            <div className="mt-5 space-y-3">
              {clubOptions.map((option) => (
                <button
                  key={option.clubId}
                  type="button"
                  onClick={() => handleClubSelect(option.clubId)}
                  disabled={isProfileLoading}
                  className="flex min-h-16 w-full items-center justify-between gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-left transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">
                      {option.clubName || 'Unnamed club'}
                    </span>
                    <span className="mt-1 block text-xs text-[var(--text-muted)]">
                      {option.roleLabel || option.role || 'Club user'}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-[var(--text-secondary)]">
                    {isProfileLoading ? 'Opening...' : 'Open'}
                  </span>
                </button>
              ))}
            </div>

            {clubSelectionError || authError ? (
              <div className="mt-4 rounded-[20px] border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-medium text-[var(--danger-text)]">
                {clubSelectionError || authError}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
