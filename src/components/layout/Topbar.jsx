import { useLocation, useNavigate } from 'react-router-dom'
import fallbackLogo from '../../assets/football-player-logo.webp'
import { getWorkspaceHomeCopy, useAuth } from '../../lib/auth.js'
import InstallAppButton from '../pwa/InstallAppButton.jsx'
import { getScopedTeamBranding } from '../../lib/team-branding-display.js'

export function Topbar({ title, onMenuClick }) {
  const { isProfileLoading, user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const displayUser = user
  const isWorkspaceHome = location.pathname === '/coach' || location.pathname === '/home'
  const hasWorkspaceHistory = Number(globalThis.history?.state?.idx) > 0
  const backUnavailable = !hasWorkspaceHistory && (isWorkspaceHome || location.pathname === '/')
  const displayTitle = isWorkspaceHome ? getWorkspaceHomeCopy(displayUser).title : title
  const clubLabel = displayUser?.role === 'super_admin'
    ? 'Platform'
    : displayUser?.clubName || displayUser?.team || (isProfileLoading ? 'Opening workspace' : 'Workspace not loaded')
  const scopedBranding = getScopedTeamBranding(displayUser)
  const logoUrl = (scopedBranding ? scopedBranding.logoUrl : displayUser?.clubLogoUrl) || fallbackLogo
  const isPlatformAdminView = displayUser?.role === 'super_admin'
  const isParentPortalView = displayUser?.role === 'parent_portal'
  const nextActionLabel = isParentPortalView
    ? 'Check fixtures and replies'
    : isPlatformAdminView
      ? 'Review clubs and support'
      : displayUser?.activeTeamName
        ? 'Run players, parent updates, and match day'
        : 'Select a team before team actions'
  const todayLabel = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(new Date())

  return (
    <header className="sticky top-0 z-20 border-b border-[#d7e5dc] bg-white/95 px-4 py-2 shadow-sm shadow-[#101828]/5 backdrop-blur sm:px-6 md:px-8 xl:px-10">
      <div className="mx-auto flex max-w-[108rem] items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onMenuClick}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white text-[#4b5f55] shadow-sm shadow-[#047857]/10 lg:hidden"
            aria-label="Open navigation"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
            <img src={logoUrl} alt={clubLabel} className="h-full w-full object-contain p-1.5" />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em]">
              <span className="max-w-[min(18rem,55vw)] truncate whitespace-nowrap text-[#047857]">{clubLabel}</span>
              <span className="hidden rounded-lg border border-[#bbf7d0] bg-[#dcfce7] px-2 py-1 text-[#166534] sm:inline-flex">
                {todayLabel}
              </span>
            </div>
            <h1 className="mt-0.5 truncate text-xl font-black tracking-tight text-[#101828] sm:text-2xl">
              {displayTitle}
            </h1>
            <p className="hidden text-sm font-semibold leading-6 text-[#4b5f55] md:block">
              {nextActionLabel}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button type="button" disabled={backUnavailable}
            onClick={() => {
              if (Number(globalThis.history?.state?.idx) > 0) navigate(-1)
              else navigate('/', { replace: true })
            }}
            className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-[#d7e5dc] bg-white px-2.5 text-sm font-black text-[#101828] hover:bg-[#ecfdf5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#047857] disabled:cursor-default disabled:opacity-50">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m14 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>
          <InstallAppButton
            wrapperClassName="hidden sm:block lg:hidden"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#047857] bg-[#047857] px-3 py-3 text-sm font-black text-white"
          />
        </div>
      </div>
    </header>
  )
}
