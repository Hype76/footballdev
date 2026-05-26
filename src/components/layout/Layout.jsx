import { useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useMatches } from 'react-router-dom'
import { isClubAdmin, isSuperAdmin, useAuth } from '../../lib/auth.js'
import { createAuditLog } from '../../lib/supabase.js'
import {
  THEME_ACCENT_STORAGE_KEY,
  THEME_BUTTON_STYLE_STORAGE_KEY,
  THEME_CHANGED_EVENT,
  THEME_MODE_STORAGE_KEY,
  getStoredThemeAccent,
  getStoredThemeButtonStyle,
  getStoredThemeMode,
  getSystemTheme,
  normalizeThemeAccent,
  normalizeThemeButtonStyle,
  normalizeThemeMode,
} from '../../lib/theme.js'
import { Sidebar } from './Sidebar.jsx'
import { Topbar } from './Topbar.jsx'
import { OnboardingProvider } from '../onboarding/OnboardingProvider.jsx'

export function Layout() {
  const { accessModeOptions, authError, clubOptions, isProfileLoading, selectAccessMode, selectClub, selectTeam, teamOptions, user } = useAuth()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [clubSelectionError, setClubSelectionError] = useState('')
  const [themeMode, setThemeMode] = useState(getStoredThemeMode)
  const [themeAccent, setThemeAccent] = useState(getStoredThemeAccent)
  const [themeButtonStyle, setThemeButtonStyle] = useState(getStoredThemeButtonStyle)
  const [systemTheme, setSystemTheme] = useState(getSystemTheme)
  const lastClickAuditRef = useRef({ key: '', timestamp: 0 })
  const location = useLocation()
  const matches = useMatches()
  const activeTitle = [...matches].reverse().find((match) => match.handle?.title)?.handle?.title ?? 'Dashboard'
  const resolvedTheme = useMemo(
    () => (themeMode === 'system' ? systemTheme : themeMode),
    [systemTheme, themeMode],
  )
  const effectiveTheme = import.meta.env.MODE === 'staging' ? 'light' : resolvedTheme

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
      setThemeButtonStyle(normalizeThemeButtonStyle(event.detail?.buttonStyle ?? getStoredThemeButtonStyle()))
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

    const hasSavedTheme = Boolean(user.themeMode || user.themeAccent || user.themeButtonStyle)

    if (!hasSavedTheme) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setThemeMode(normalizeThemeMode(user.themeMode || getStoredThemeMode()))
      setThemeAccent(normalizeThemeAccent(user.themeAccent || getStoredThemeAccent()))
      setThemeButtonStyle(normalizeThemeButtonStyle(user.themeButtonStyle || getStoredThemeButtonStyle()))
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [user?.id, user?.themeAccent, user?.themeButtonStyle, user?.themeMode])

  useEffect(() => {
    document.body.classList.remove(
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
    document.body.classList.add(effectiveTheme === 'dark' ? 'theme-dark' : 'theme-light')
    document.body.classList.add(`accent-${themeAccent}`)
    document.body.classList.add(`button-style-${themeButtonStyle}`)
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, themeMode)
    window.localStorage.setItem(THEME_ACCENT_STORAGE_KEY, themeAccent)
    window.localStorage.setItem(THEME_BUTTON_STYLE_STORAGE_KEY, themeButtonStyle)
  }, [effectiveTheme, themeAccent, themeButtonStyle, themeMode])

  useEffect(() => {
    const legacyTheme = window.localStorage.getItem('app-theme')

    if (legacyTheme) {
      window.localStorage.removeItem('app-theme')
    }
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [location.pathname])

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

  const handleAccessModeSelect = async (accessMode) => {
    setClubSelectionError('')

    try {
      await selectAccessMode(accessMode)
    } catch (error) {
      console.error(error)
      setClubSelectionError(error.message || 'Could not open this access.')
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

  const needsAccessModeSelection = !user && accessModeOptions.length > 0
  const needsClubSelection = !needsAccessModeSelection && !isSuperAdmin(user) && clubOptions.length > 1
  const needsTeamSelection = !needsAccessModeSelection && clubOptions.length === 0 && teamOptions.length > 1 && !user?.activeTeamId && !isClubAdmin(user)

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f7fbf8] text-[#10231a]">
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(180deg,#ffffff_0%,#f7fbf8_48%,#eef8f2_100%)]" />
      <div className="flex min-h-screen w-full">
        <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

        <div className="flex min-h-screen min-w-0 flex-1 flex-col lg:pl-[20.5rem]">
          <Topbar
            title={activeTitle}
            onMenuClick={() => setIsSidebarOpen(true)}
          />

          <main className="flex-1 px-4 py-5 sm:px-6 md:px-8 xl:px-10">
            <div className="mx-auto w-full max-w-[108rem]">
              <OnboardingProvider>
                {needsAccessModeSelection ? (
                  <WorkspaceSelection
                    eyebrow="Workspace access"
                    title="Choose the work area for this session."
                    description="This login can open more than one football workspace. Pick the access mode before using team tools, parent messages, or setup actions."
                    error={clubSelectionError || authError}
                    isLoading={isProfileLoading}
                    options={accessModeOptions.map((option) => ({
                      ...option,
                      action: 'Open access',
                    }))}
                    onSelect={handleAccessModeSelect}
                  />
                ) : needsClubSelection ? (
                  <WorkspaceSelection
                    eyebrow="Club access"
                    title="Choose the club workspace to open."
                    description="This email is linked to more than one club. Pick the club before changing players, teams, staff, parents, or billing details."
                    error={clubSelectionError || authError}
                    isLoading={isProfileLoading}
                    options={clubOptions.map((option) => ({
                      id: option.clubId,
                      label: option.clubName || 'Unnamed club',
                      meta: option.roleLabel || option.role || 'Club user',
                      action: 'Open club',
                    }))}
                    onSelect={handleClubSelect}
                  />
                ) : needsTeamSelection ? (
                  <WorkspaceSelection
                    eyebrow="Team access"
                    title="Choose the team to work with."
                    description="Your account is linked to more than one team. Pick the team before opening player records, sessions, availability, or match day."
                    error={clubSelectionError || authError}
                    isLoading={isProfileLoading}
                    options={teamOptions.map((option) => ({
                      id: option.id,
                      label: option.name || 'Unnamed team',
                      meta: 'Team workspace',
                      action: 'Open team',
                    }))}
                    onSelect={handleTeamSelect}
                  />
                ) : (
                  <Outlet />
                )}
              </OnboardingProvider>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

function WorkspaceSelection({ description, error, eyebrow, isLoading, onSelect, options, title }) {
  return (
    <section className="mx-auto max-w-5xl overflow-hidden rounded-lg border border-[#bddcca] bg-white shadow-sm shadow-[#d7eadf]/80">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="border-b border-[#d7eadf] bg-[#f0fdf6] p-5 sm:p-7 lg:border-b-0 lg:border-r">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-[#067a46]">{eyebrow}</p>
          <h1 className="mt-4 text-3xl font-black tracking-tight text-[#10231a] sm:text-4xl">{title}</h1>
          <p className="mt-4 max-w-2xl text-sm font-semibold leading-7 text-[#456653]">{description}</p>
          <div className="mt-6 rounded-lg border border-[#bddcca] bg-white px-4 py-4 shadow-sm shadow-[#d7eadf]/70">
            <p className="text-sm font-black text-[#10231a]">Before you continue</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#456653]">
              The workspace selection controls what data loads, which actions are available, and where saved football records belong.
            </p>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          <div className="grid gap-3">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onSelect(option.id)}
                disabled={isLoading}
                title={isLoading ? 'Please wait while the workspace opens.' : undefined}
                className="group flex min-h-20 w-full items-center justify-between gap-4 rounded-lg border border-[#bddcca] bg-white px-4 py-4 text-left shadow-sm shadow-[#d7eadf]/70 transition hover:border-[#20a464] hover:bg-[#f8fdf9] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#bddcca] bg-[#f0fdf6] text-sm font-black text-[#067a46]">
                    {String(option.label || 'W').slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-base font-black text-[#10231a]">{option.label}</span>
                    <span className="mt-1 block text-sm font-semibold text-[#456653]">{option.meta}</span>
                  </span>
                </span>
                <span className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-[#bddcca] bg-[#f0fdf6] px-4 text-sm font-black text-[#067a46] transition group-hover:border-[#067a46] group-hover:bg-[#067a46] group-hover:text-white">
                  {isLoading ? 'Opening...' : option.action || 'Open'}
                </span>
              </button>
            ))}
          </div>

          {error ? (
            <div className="mt-4 rounded-lg border border-[#f4b6b6] bg-[#fff5f5] px-4 py-3 text-sm font-bold text-[#b42318]">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
