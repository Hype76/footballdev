import { useState } from 'react'
import { Link } from 'react-router-dom'
import fallbackLogo from '../../assets/player-feedback-logo.png'
import InstallAppButton from '../pwa/InstallAppButton.jsx'
import { getRoleLabel, isClubAdmin, useAuth } from '../../lib/auth.js'
import { DEMO_ROLE_OPTIONS, isDemoUser } from '../../lib/demo.js'

export function Topbar({ title, onMenuClick }) {
  const { authUser, clubOptions, demoRoleKey, hasPlatformAdminAccess, selectAccessMode, selectClub, selectPlatformAdmin, selectTeam, setDemoRolePreview, signOut, teamOptions, user } = useAuth()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [isSwitchingTeam, setIsSwitchingTeam] = useState(false)
  const roleLabel = user ? getRoleLabel(user) : 'Loading access'
  const canUseClubAdminView = isClubAdmin(user)
  const clubLabel = user?.role === 'super_admin' ? 'Platform' : user?.clubName || user?.team || 'No club'
  const logoUrl = user?.clubLogoUrl || fallbackLogo
  const userLabel = user?.email || authUser?.email || user?.name || 'Loading user'
  const teamLabel = user?.activeTeamName ? `Team: ${user.activeTeamName}` : clubLabel
  const isPlatformAdminView = user?.role === 'super_admin'
  const isParentPortalView = user?.role === 'parent_portal'
  const hasParentPortalAccess = Array.isArray(user?.parentPortalLinks) && user.parentPortalLinks.length > 0
  const shouldShowClubAdminOption = !isPlatformAdminView && canUseClubAdminView
  const shouldShowTeamPlaceholder = !isPlatformAdminView && !canUseClubAdminView && teamOptions?.length > 0
  const shouldShowWorkspaceSelector = hasPlatformAdminAccess || hasParentPortalAccess || clubOptions?.length > 0 || shouldShowClubAdminOption || teamOptions?.length > 0
  const workspaceContext = user?.role === 'super_admin'
    ? 'Viewing platform admin tools'
    : user?.activeTeamName
      ? `Viewing team: ${user.activeTeamName}`
      : canUseClubAdminView
        ? 'Viewing club admin tools'
        : 'Choose a team to continue'

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

  const handleTeamChange = async (event) => {
    const teamId = event.target.value

    if (teamId === '__platform_admin__') {
      try {
        setIsSwitchingTeam(true)
        await selectPlatformAdmin()
      } catch (error) {
        console.error(error)
      } finally {
        setIsSwitchingTeam(false)
      }
      return
    }

    if (teamId === '__parent_portal__') {
      try {
        setIsSwitchingTeam(true)
        await selectAccessMode('parent')
      } catch (error) {
        console.error(error)
      } finally {
        setIsSwitchingTeam(false)
      }
      return
    }

    if (teamId.startsWith('__club__:')) {
      try {
        setIsSwitchingTeam(true)
        await selectClub(teamId.replace('__club__:', ''))
      } catch (error) {
        console.error(error)
      } finally {
        setIsSwitchingTeam(false)
      }
      return
    }

    if (teamId === user?.activeTeamId) {
      return
    }

    try {
      setIsSwitchingTeam(true)
      await selectTeam(teamId)
    } catch (error) {
      console.error(error)
    } finally {
      setIsSwitchingTeam(false)
    }
  }

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border-color)] bg-[var(--app-bg)]/95 px-3 py-2 backdrop-blur sm:px-4 md:px-5 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onMenuClick}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-primary)] lg:hidden"
            aria-label="Open navigation"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] shadow-sm shadow-black/20 sm:h-14 sm:w-14">
            <img src={logoUrl} alt={clubLabel} className="h-full w-full object-contain p-1" />
          </div>

          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase tracking-[0.24em] text-[var(--text-secondary)]">
              {clubLabel}
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold tracking-tight text-[var(--text-primary)] sm:text-2xl">
              {title}
            </h2>
            <p className="mt-1 truncate text-xs font-medium text-[var(--text-muted)]">{workspaceContext}</p>
          </div>
        </div>

        <div className="grid w-full gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-2 lg:w-auto lg:min-w-[360px]">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end sm:justify-end">
            {isDemoUser(user) ? (
              <label className="col-span-2 grid gap-1 sm:min-w-44">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Demo role
                </span>
                <select
                  value={demoRoleKey || ''}
                  onChange={(event) => setDemoRolePreview(event.target.value)}
                  className="min-h-11 rounded-lg border border-[var(--border-color)] bg-[var(--panel-soft)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                >
                  <option value="">Default role</option>
                  {DEMO_ROLE_OPTIONS.map((role) => (
                    <option key={role.role} value={role.role}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {shouldShowWorkspaceSelector ? (
              <label className="col-span-2 grid gap-1 sm:min-w-44">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Workspace view
                </span>
                <select
                  value={isPlatformAdminView ? '__platform_admin__' : isParentPortalView ? '__parent_portal__' : user?.activeTeamId || ''}
                  onChange={handleTeamChange}
                  disabled={isSwitchingTeam}
                  title={isSwitchingTeam ? 'Please wait while the workspace changes.' : undefined}
                  className="min-h-11 rounded-lg border border-[var(--border-color)] bg-[var(--panel-soft)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {hasPlatformAdminAccess ? <option value="__platform_admin__">Platform admin</option> : null}
                  {hasParentPortalAccess ? <option value="__parent_portal__">Parent Portal</option> : null}
                  {isPlatformAdminView
                    ? clubOptions.map((club) => (
                        <option key={club.clubId} value={`__club__:${club.clubId}`}>
                          Club: {club.clubName || 'Unnamed club'}
                        </option>
                      ))
                    : null}
                  {shouldShowClubAdminOption ? <option value="">Club admin view</option> : null}
                  {shouldShowTeamPlaceholder ? <option value="">Select team</option> : null}
                  {teamOptions.map((team) => (
                    <option key={team.id} value={team.id}>
                      Team: {team.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <InstallAppButton
              wrapperClassName="col-span-2 lg:hidden"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--button-primary)] px-3 py-3 text-sm font-semibold text-[var(--button-primary-text)]"
            />
            <Link
              to="/user-settings"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-soft)] px-3 py-3 text-sm font-semibold leading-none text-[var(--text-primary)] transition hover:bg-[var(--panel-alt)]"
            >
              My Settings
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={isSigningOut}
              title={isSigningOut ? 'Please wait while you are signed out.' : undefined}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-soft)] px-3 py-3 text-sm font-semibold leading-none text-[var(--text-primary)] transition hover:bg-[var(--panel-alt)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSigningOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
          <p className="truncate px-2 pb-1 text-xs text-[var(--text-muted)]">
            {userLabel} | {roleLabel} | {teamLabel}
          </p>
        </div>
      </div>
    </header>
  )
}
