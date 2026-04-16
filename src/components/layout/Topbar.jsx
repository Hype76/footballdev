import { useState } from 'react'
import { useAuth } from '../../lib/auth.js'

export function Topbar({ title, onMenuClick }) {
  const { signOut, user } = useAuth()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const roleLabel = user?.role
    ? user.role
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    : 'Unknown'
  const clubLabel = user?.role === 'super_admin' ? 'Platform' : user?.clubName || user?.team || 'No club'
  const logoUrl = user?.clubLogoUrl || ''

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
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#dbe3d6] bg-[#fbfcf9]">
              {logoUrl ? (
                <img src={logoUrl} alt={clubLabel} className="h-full w-full object-cover" />
              ) : (
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5a6b5b]">Logo</span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5a6b5b]">{clubLabel}</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h2>
            </div>
          </div>
        </div>

        <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2 sm:gap-3">
          <div className="min-h-11 rounded-2xl border border-[#dbe3d6] bg-[#fbfcf9] px-4 py-3 text-sm text-slate-600">
            Club: {clubLabel}
          </div>
          <div className="rounded-2xl border border-[#dbe3d6] bg-[#fbfcf9] px-4 py-3 text-sm text-slate-600">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>User: {user?.email || user?.name || 'No user'} ({roleLabel})</span>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[#dbe3d6] bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-[#f3f6f1] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {isSigningOut ? 'Signing out...' : 'Sign out'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
