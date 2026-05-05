import { NavLink } from 'react-router-dom'
import fallbackLogo from '../../assets/player-feedback-logo.png'
import { primaryNavigation } from '../../app/navigation.js'
import {
  canCreateEvaluation,
  canManageFormFields,
  canManageUsers,
  canViewActivityLog,
  isSuperAdmin,
  useAuth,
} from '../../lib/auth.js'

export function Sidebar({ isOpen, onClose }) {
  const { signOut, user } = useAuth()
  const logoUrl = user?.clubLogoUrl || fallbackLogo
  const clubLabel = user?.role === 'super_admin' ? 'Platform' : user?.clubName || 'Football Operations'
  const navigationItems = primaryNavigation.filter((item) => {
    if (isSuperAdmin(user)) {
      return item.path === '/activity-log'
    }

    if (
      item.path === '/assess-player' ||
      item.path === '/add-player' ||
      item.path === '/sessions' ||
      item.path === '/players' ||
      item.path === '/archived-players'
    ) {
      return canCreateEvaluation(user)
    }

    if (item.path === '/user-access') {
      return canManageUsers(user)
    }

    if (item.path === '/activity-log') {
      return canViewActivityLog(user)
    }

    if (item.path === '/form-builder') {
      return canManageFormFields(user)
    }

    return true
  })

  const handleSignOut = async () => {
    try {
      onClose()
      await signOut()
    } catch (error) {
      console.error(error)
    }
  }

  return (
    <>
      <div
        className={[
          'fixed inset-0 z-30 bg-black/50 transition lg:hidden',
          isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
        onClick={onClose}
      />

      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 flex w-[min(20rem,calc(100vw-1rem))] max-w-72 flex-col overflow-y-auto border-r border-[var(--border-color)] bg-[var(--sidebar-bg)] px-4 py-5 transition sm:px-5 sm:py-6 lg:fixed lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-4 flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)]">
              <img src={logoUrl} alt={clubLabel} className="h-full w-full object-contain p-1" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-secondary)]">Coaching Suite</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-muted)] lg:hidden"
            aria-label="Close navigation"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <nav className="mt-8 space-y-2 pb-4">
          {navigationItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onClose}
              className={({ isActive }) =>
                [
                  'block min-h-11 rounded-2xl px-4 py-3 text-sm font-medium transition',
                  isActive
                    ? 'bg-[var(--sidebar-active-bg)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--panel-soft)] hover:text-[var(--text-primary)]',
                ].join(' ')
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {isSuperAdmin(user) ? (
          <div className="mt-2 rounded-[22px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-3">
            <p className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
              Platform tools
            </p>
            <NavLink
              to="/platform-admin"
              onClick={onClose}
              className={({ isActive }) =>
                [
                  'mt-2 block min-h-11 rounded-2xl px-4 py-3 text-sm font-semibold transition',
                  isActive
                    ? 'bg-[var(--sidebar-active-bg)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--panel-soft)] hover:text-[var(--text-primary)]',
                ].join(' ')
              }
            >
              Platform Admin
            </NavLink>
            <NavLink
              to="/platform-feedback"
              onClick={onClose}
              className={({ isActive }) =>
                [
                  'mt-2 block min-h-11 rounded-2xl px-4 py-3 text-sm font-semibold transition',
                  isActive
                    ? 'bg-[var(--sidebar-active-bg)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--panel-soft)] hover:text-[var(--text-primary)]',
                ].join(' ')
              }
            >
              Platform Feedback
            </NavLink>
          </div>
        ) : null}

        <div className="mt-auto pt-4">
          <div className="mb-3 rounded-[22px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-3">
            <p className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
              Information
            </p>
            <NavLink
              to="/information"
              onClick={onClose}
              className={({ isActive }) =>
                [
                  'mt-2 block min-h-11 rounded-2xl px-4 py-3 text-sm font-semibold transition',
                  isActive
                    ? 'bg-[var(--sidebar-active-bg)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--panel-soft)] hover:text-[var(--text-primary)]',
                ].join(' ')
              }
            >
              How to use
            </NavLink>
          </div>
          {!isSuperAdmin(user) ? (
          <div className="mb-3 rounded-[22px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-3">
            <p className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
              Platform feedback
            </p>
            <NavLink
              to="/platform-feedback"
              onClick={onClose}
              className={({ isActive }) =>
                [
                  'mt-2 block min-h-11 rounded-2xl px-4 py-3 text-sm font-semibold transition',
                  isActive
                    ? 'bg-[var(--sidebar-active-bg)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--panel-soft)] hover:text-[var(--text-primary)]',
                ].join(' ')
              }
            >
              Share feedback
            </NavLink>
          </div>
          ) : null}
          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
          >
            Sign out
          </button>
        </div>
      </aside>
    </>
  )
}
