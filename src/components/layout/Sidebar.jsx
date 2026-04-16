import { NavLink } from 'react-router-dom'
import { primaryNavigation } from '../../app/navigation.js'
import { canAccessApprovals, useAuth } from '../../lib/auth.js'

export function Sidebar({ isOpen, onClose }) {
  const { user } = useAuth()
  const navigationItems = primaryNavigation.filter((item) => {
    if (item.path !== '/approvals') {
      return true
    }

    return canAccessApprovals(user)
  })

  return (
    <>
      <div
        className={[
          'fixed inset-0 z-30 bg-slate-900/25 transition lg:hidden',
          isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
        onClick={onClose}
      />

      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 flex w-[88vw] max-w-72 flex-col border-r border-[#dbe3d6] bg-[#eef3ea] px-4 py-5 transition sm:px-5 sm:py-6 lg:fixed lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#5a6b5b]">Coaching Suite</p>
            <h1 className="mt-3 text-xl font-semibold tracking-tight text-slate-900">Football Operations</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">Evaluation and approval workspace</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-[#dbe3d6] bg-[#fbfcf9] text-slate-500 lg:hidden"
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
                    ? 'bg-[#dfe8db] text-slate-900'
                    : 'text-slate-600 hover:bg-[#e7eee3] hover:text-slate-900',
                ].join(' ')
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto rounded-[24px] border border-[#dbe3d6] bg-[#fbfcf9] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5a6b5b]">Workspace</p>
          <p className="mt-3 text-sm font-medium text-slate-900">Supabase connected</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Auth, club scoping, and evaluation routing are active in this workspace.
          </p>
        </div>
      </aside>
    </>
  )
}
