import { useState } from 'react'
import { Link } from 'react-router-dom'
import fallbackLogo from '../../assets/football-development-logo-optimized.jpg'
import { getRoleLabel, useAuth } from '../../lib/auth.js'

const themeModeOptions = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
]

const themeAccentOptions = [
  { value: 'yellow', label: 'Yellow' },
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'red', label: 'Red' },
  { value: 'purple', label: 'Purple' },
]

export function Topbar({
  title,
  onMenuClick,
  themeMode,
  themeAccent,
  onThemeModeChange,
  onThemeAccentChange,
}) {
  const { authUser, signOut, user } = useAuth()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const roleLabel = user ? getRoleLabel(user) : 'Loading access'
  const clubLabel = user?.role === 'super_admin' ? 'Platform' : user?.clubName || user?.team || 'No club'
  const logoUrl = user?.clubLogoUrl || fallbackLogo
  const userLabel = user?.email || authUser?.email || user?.name || 'Loading user'

  const handleSignOut = async () => {
    try {
      setIsSigningOut(true)
      await signOut()
    } catch (error) {
      console.error(error)
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border-color)] bg-[var(--app-bg)]/95 px-3 py-3 backdrop-blur sm:px-4 md:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-primary)] lg:hidden"
          aria-label="Open navigation"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>

          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] shadow-sm shadow-black/20">
            <img src={logoUrl} alt={clubLabel} className="h-full w-full object-cover" />
          </div>

          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase tracking-[0.24em] text-[var(--text-secondary)]">
              {clubLabel}
            </p>
            <h2 className="mt-1 truncate text-2xl font-semibold tracking-tight text-[var(--text-primary)]">{title}</h2>
          </div>
        </div>

        <div className="flex w-full flex-col gap-3 rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-2 md:flex-row md:items-center xl:w-auto">
          <div className="min-w-0 flex-1 px-3 py-2 xl:min-w-80">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Signed in</p>
            <p className="mt-1 truncate text-sm font-medium text-[var(--text-primary)]">{userLabel}</p>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">{roleLabel}</p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="block">
              <span className="sr-only">Theme mode</span>
              <select
                value={themeMode}
                onChange={(event) => onThemeModeChange(event.target.value)}
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-soft)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] outline-none transition hover:bg-[var(--panel-alt)] focus:border-[var(--accent)] sm:w-auto"
              >
                {themeModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="sr-only">Theme colour</span>
              <select
                value={themeAccent}
                onChange={(event) => onThemeAccentChange(event.target.value)}
                className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-soft)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] outline-none transition hover:bg-[var(--panel-alt)] focus:border-[var(--accent)] sm:w-auto"
              >
                {themeAccentOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <Link
              to="/user-settings"
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-soft)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-alt)]"
            >
              My Settings
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-soft)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-alt)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSigningOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
