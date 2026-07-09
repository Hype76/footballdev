import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth.js'
import { buildMainAppUrl } from '../../lib/app-origins.js'
import { rememberParentAccessIntent } from '../../lib/parent-auth-intent.js'
import { isRecoveryPathVisible } from '../../lib/recovery-phase.js'
import { TEAM_WORKSPACE_HOME_PATH } from '../../lib/workspace-routes.js'

const parentPortalSections = [
  { id: 'overview', label: 'Overview', description: 'Start here', to: '/parent-portal?section=overview' },
  { id: 'calendar', label: 'Calendar', description: 'Shared dates', to: '/parent-portal?section=calendar' },
  { id: 'invites', label: 'Invites', description: 'Sessions and events', to: '/parent-portal?section=invites' },
  { id: 'matches', label: 'Match cards', description: 'Live and upcoming', to: '/parent-portal?section=matches' },
  { id: 'results', label: 'Results', description: 'Previous games', to: '/parent-portal?section=results' },
  { id: 'resources', label: 'Resources', description: 'Shared links', to: '/parent-portal?section=resources' },
  { id: 'messages', label: 'Messages', description: 'Club messages', to: '/parent-messages', recoveryPath: '/parent-messages' },
  { id: 'polls', label: 'Polls', description: 'Questions to answer', to: '/parent-polls', recoveryPath: '/parent-polls' },
  { id: 'settings', label: 'Settings', description: 'Profile and preferences', to: '/parent-portal?section=settings' },
]

export function ParentPortalSectionNav({
  activeSection,
  className = '',
  counts = {},
  onSelect,
  user,
  variant = 'desktop',
}) {
  const visibleSections = parentPortalSections.filter((section) =>
    !section.recoveryPath || isRecoveryPathVisible(section.recoveryPath, { user }))
  const itemClass = (isActive) => [
    'flex items-center justify-between gap-3 rounded-lg border px-3 text-left transition',
    variant === 'mobile' ? 'min-h-11 w-[5.75rem] shrink-0 justify-center py-2 text-center' : 'min-h-12 w-full py-2',
    isActive
      ? 'border-[#047857] bg-[#ecfdf5] text-[#101828]'
      : 'border-[#d7e5dc] bg-[#f7faf8] text-[#101828] hover:border-[#047857] hover:bg-white',
  ].join(' ')
  const wrapperClass = variant === 'mobile'
    ? `fixed inset-x-0 bottom-0 z-[60] max-h-[38dvh] overflow-y-auto border-t border-[#d7e5dc] bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-2xl shadow-[#047857]/15 backdrop-blur ${className}`.trim()
    : `flex max-h-[calc(100dvh-2.5rem)] flex-col rounded-lg border border-[#d7e5dc] bg-white p-3 shadow-sm shadow-[#047857]/10 ${className}`.trim()
  const listClass = variant === 'mobile'
    ? 'flex gap-2 overflow-x-auto overscroll-x-contain pb-1'
    : 'grid min-h-0 gap-2 overflow-y-auto overscroll-contain pr-1'

  return (
    <div className={wrapperClass}>
      <nav aria-label="Parent portal sections">
        <div className={listClass}>
          {visibleSections.map((section) => {
            const isActive = activeSection === section.id
            const count = counts[section.id]
            const content = (
              <>
                <span className="min-w-0">
                  <span className="block text-xs font-black sm:text-sm">{section.label}</span>
                  {variant === 'mobile' ? null : (
                    <span className="mt-0.5 block text-xs font-semibold text-[#4b5f55]">{section.description}</span>
                  )}
                </span>
                {typeof count === 'number' ? (
                  <span className="shrink-0 rounded-full border border-[#d7e5dc] bg-white px-2 py-1 text-xs font-black text-[#047857]">
                    {count}
                  </span>
                ) : null}
              </>
            )

            return (
              <Link
                key={section.id}
                to={section.to}
                onClick={(event) => {
                  if (!onSelect) {
                    return
                  }

                  const nextUrl = new URL(section.to, window.location.origin)
                  if (nextUrl.pathname === window.location.pathname) {
                    event.preventDefault()
                    onSelect(section.id)
                    window.history.replaceState(null, '', `${nextUrl.pathname}${nextUrl.search}`)
                  }
                }}
                className={itemClass(isActive)}
                aria-current={isActive ? 'page' : undefined}
              >
                {content}
              </Link>
            )
          })}
        </div>
      </nav>
      <div className={variant === 'mobile' ? 'mt-1 border-t border-[#d7e5dc] pt-1.5' : 'mt-3 shrink-0 border-t border-[#d7e5dc] pt-3'}>
        <ParentPortalSignOutAction variant={variant} />
      </div>
    </div>
  )
}

function ParentPortalSignOutAction({ variant = 'desktop' }) {
  const { selectAccessMode, signOut, user } = useAuth()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [isOpeningTeam, setIsOpeningTeam] = useState(false)
  const accessModeOptions = Array.isArray(user?.accessModeOptions) ? user.accessModeOptions : []
  const canOpenTeamWorkspace = accessModeOptions.some((option) => option?.id === 'team')
  const buttonClass = [
    'inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#f2b8b5] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:bg-[#fff4f3] disabled:cursor-not-allowed disabled:opacity-60',
    variant === 'mobile' ? 'min-h-9 px-3 py-2 text-xs' : '',
  ].filter(Boolean).join(' ')
  const switchButtonClass = [
    'inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#047857] bg-[#047857] px-4 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/10 transition hover:bg-[#036c4a] disabled:cursor-not-allowed disabled:opacity-60',
    variant === 'mobile' ? 'min-h-9 px-3 py-2 text-xs' : '',
  ].filter(Boolean).join(' ')

  const handleOpenTeamWorkspace = async () => {
    setIsOpeningTeam(true)

    try {
      await selectAccessMode('team')
      window.location.assign(buildMainAppUrl(TEAM_WORKSPACE_HOME_PATH))
    } catch (error) {
      console.error(error)
      setIsOpeningTeam(false)
    }
  }

  const handleSignOut = async () => {
    setIsSigningOut(true)

    try {
      await signOut()
      rememberParentAccessIntent()
      window.location.assign(buildMainAppUrl('/sign-in?tab=parent'))
    } catch (error) {
      console.error(error)
      setIsSigningOut(false)
    }
  }

  return (
    <div className={variant === 'mobile' && canOpenTeamWorkspace ? 'grid grid-cols-2 gap-2' : 'grid gap-2'}>
      {canOpenTeamWorkspace ? (
        <button
          type="button"
          onClick={handleOpenTeamWorkspace}
          disabled={isOpeningTeam || isSigningOut}
          aria-label="Open team workspace"
          className={switchButtonClass}
        >
          {isOpeningTeam ? 'Opening...' : 'Open team workspace'}
        </button>
      ) : null}
      <button
        type="button"
        onClick={handleSignOut}
        disabled={isSigningOut || isOpeningTeam}
        aria-label="Sign out of the parent portal"
        className={buttonClass}
      >
        {isSigningOut ? 'Signing out...' : 'Sign out'}
      </button>
    </div>
  )
}

export function ParentPortalRouteShell({
  activeSection,
  children,
  counts,
  user,
}) {
  return (
    <div className="space-y-4 pb-28 sm:space-y-5 lg:pb-0">
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)]">
        <ParentPortalSectionNav
          activeSection={activeSection}
          className="hidden lg:block lg:sticky lg:top-5 lg:self-start"
          counts={counts}
          user={user}
          variant="desktop"
        />
        <main className="min-w-0">
          {children}
        </main>
      </div>
      <ParentPortalSectionNav
        activeSection={activeSection}
        className="lg:hidden"
        counts={counts}
        user={user}
        variant="mobile"
      />
    </div>
  )
}
