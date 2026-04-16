import { useAuth } from '../../lib/auth.js'

export function Topbar({ title, onMenuClick }) {
  const { user } = useAuth()

  return (
    <header className="sticky top-0 z-20 border-b border-[#dbe3d6] bg-[#f5f7f3] px-3 py-3 sm:px-4 md:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-wrap items-start gap-3 sm:items-center">
        <button
          type="button"
          onClick={onMenuClick}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-[#dbe3d6] bg-[#fbfcf9] text-slate-700 lg:hidden"
          aria-label="Open navigation"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5a6b5b]">Football Coaching Tool</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h2>
        </div>

        <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2 sm:gap-3">
          <div className="min-h-11 rounded-2xl border border-[#dbe3d6] bg-[#fbfcf9] px-4 py-3 text-sm text-slate-600">
            Team: {user?.team || 'No team'}
          </div>
          <div className="min-h-11 rounded-2xl border border-[#dbe3d6] bg-[#fbfcf9] px-4 py-3 text-sm text-slate-600">
            User: {user?.name || 'No user'} ({user?.role || 'Unknown'})
          </div>
        </div>
      </div>
    </header>
  )
}
