import { useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useMatches } from 'react-router-dom'
import { useAuth } from '../../lib/auth.js'
import { createAuditLog } from '../../lib/supabase.js'
import {
  THEME_ACCENT_STORAGE_KEY,
  THEME_CHANGED_EVENT,
  THEME_MODE_STORAGE_KEY,
  getStoredThemeAccent,
  getStoredThemeMode,
  getSystemTheme,
  normalizeThemeAccent,
  normalizeThemeMode,
} from '../../lib/theme.js'
import { Sidebar } from './Sidebar.jsx'
import { Topbar } from './Topbar.jsx'

export function Layout() {
  const { authError, clubOptions, isProfileLoading, selectClub, selectTeam, teamOptions, user } = useAuth()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [clubSelectionError, setClubSelectionError] = useState('')
  const [themeMode, setThemeMode] = useState(getStoredThemeMode)
  const [themeAccent, setThemeAccent] = useState(getStoredThemeAccent)
  const [systemTheme, setSystemTheme] = useState(getSystemTheme)
  const lastClickAuditRef = useRef({ key: '', timestamp: 0 })
  const location = useLocation()
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
    const handleThemeChange = (event) => {
      setThemeMode(normalizeThemeMode(event.detail?.mode ?? getStoredThemeMode()))
      setThemeAccent(normalizeThemeAccent(event.detail?.accent ?? getStoredThemeAccent()))
    }

    window.addEventListener(THEME_CHANGED_EVENT, handleThemeChange)
    return () => {
      window.removeEventListener(THEME_CHANGED_EVENT, handleThemeChange)
    }
  }, [])

  useEffect(() => {
    if (!user?.id) {
      return
    }

    const hasSavedTheme = Boolean(user.themeMode || user.themeAccent)

    if (!hasSavedTheme) {
      return
    }

    setThemeMode(normalizeThemeMode(user.themeMode || getStoredThemeMode()))
    setThemeAccent(normalizeThemeAccent(user.themeAccent || getStoredThemeAccent()))
  }, [user?.id, user?.themeAccent, user?.themeMode])

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

  useEffect(() => {
    if (!user?.id) {
      return
    }

    void createAuditLog({
      user,
      action: 'page_viewed',
      entityType: 'page',
      metadata: {
        path: location.pathname,
        search: location.search,
        title: activeTitle,
      },
    })
  }, [activeTitle, location.pathname, location.search, user])

  useEffect(() => {
    if (!user?.id) {
      return undefined
    }

    const handleTrackedClick = (event) => {
      const target = event.target instanceof Element ? event.target.closest('button, a, [role="button"]') : null

      if (!target) {
        return
      }

      const label =
        String(target.getAttribute('aria-label') ?? '').trim() ||
        String(target.textContent ?? '').replace(/\s+/g, ' ').trim() ||
        String(target.getAttribute('href') ?? '').trim() ||
        'Unlabelled action'
      const href = target instanceof HTMLAnchorElement ? target.getAttribute('href') : ''
      const key = `${location.pathname}:${label}:${href || ''}`
      const now = Date.now()

      if (lastClickAuditRef.current.key === key && now - lastClickAuditRef.current.timestamp < 2000) {
        return
      }

      lastClickAuditRef.current = {
        key,
        timestamp: now,
      }

      void createAuditLog({
        user,
        action: 'ui_clicked',
        entityType: 'ui',
        metadata: {
          label: label.slice(0, 160),
          path: location.pathname,
          href,
          tag: target.tagName.toLowerCase(),
        },
      })
    }

    document.addEventListener('click', handleTrackedClick, true)
    return () => {
      document.removeEventListener('click', handleTrackedClick, true)
    }
  }, [location.pathname, user])

  const handleClubSelect = async (clubId) => {
    setClubSelectionError('')

    try {
      await selectClub(clubId)
    } catch (error) {
      console.error(error)
      setClubSelectionError(error.message || 'Could not open this club.')
    }
  }

  const handleTeamSelect = async (teamId) => {
    setClubSelectionError('')

    try {
      await selectTeam(teamId)
    } catch (error) {
      console.error(error)
      setClubSelectionError(error.message || 'Could not open this team.')
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
          />

          <main className="flex-1 px-0 py-2 sm:px-4 sm:py-5 md:px-5 md:py-6 xl:px-8">
            <div className="mx-auto w-full max-w-7xl">
              <div className="min-w-0 overflow-hidden border-y border-[var(--border-color)] bg-[var(--shell-card)] p-3 shadow-sm shadow-slate-900/10 sm:rounded-[28px] sm:border sm:p-5 md:p-6">
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

      {clubOptions.length === 0 && teamOptions.length > 1 ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8">
          <div className="w-full max-w-xl rounded-[28px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 shadow-2xl shadow-black/40 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-secondary)]">Choose Team</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Which team do you want to work with?</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
              Your account is linked to more than one team. Pick the team workspace you want to use for player work in this session.
            </p>

            <div className="mt-5 space-y-3">
              {teamOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleTeamSelect(option.id)}
                  disabled={isProfileLoading}
                  className="flex min-h-16 w-full items-center justify-between gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-left transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">
                      {option.name || 'Unnamed team'}
                    </span>
                    <span className="mt-1 block text-xs text-[var(--text-muted)]">
                      Team workspace
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-[var(--text-secondary)]">Open</span>
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
