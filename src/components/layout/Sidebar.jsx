import { NavLink } from 'react-router-dom'
import { primaryNavigation } from '../../app/navigation.js'
import { canAccessApprovals, canManageClubSettings, canManageFormFields, canManageUsers, useAuth } from '../../lib/auth.js'

export function Sidebar({ isOpen, onClose }) {
  const { signOut, user } = useAuth()
  const navigationItems = primaryNavigation.filter((item) => {
    if (item.path === '/approvals') {
      return canAccessApprovals(user)
    }

    if (item.path === '/user-access') {
      return canManageUsers(user)
    }

    if (item.path === '/form-builder') {
      return canManageFormFields(user)
    }

    if (item.path === '/club-settings') {
      return canManageClubSettings(user)
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
          'fixed inset-y-0 left-0 z-40 flex w-[88vw] max-w-72 flex-col border-r border-[var(--border-color)] bg-[var(--sidebar-bg)] px-4 py-5 transition sm:px-5 sm:py-6 lg:fixed lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-secondary)]">Coaching Suite</p>
            <h1 className="mt-3 text-xl font-semibold tracking-tight text-[var(--text-primary)]">Football Operations</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">Evaluation, approvals, and structured club access.</p>
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

        <nav className="mt-10 space-y-2">
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

        <div className="mt-auto space-y-4 rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Workspace</p>
          <p className="mt-3 text-sm font-medium text-[var(--text-primary)]">Supabase connected</p>
          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
            Auth, club scoping, approvals, and structured role allocation are active in this workspace.
          </p>
          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-soft)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-alt)]"
          >
            Sign out
          </button>
        </div>
      </aside>
    </>
  )
}
