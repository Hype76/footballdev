import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import fallbackLogo from '../../assets/football-player-logo.png'
import { DEMO_ROLE_OPTIONS, isDemoUser } from '../../lib/demo.js'
import { getRoleLabel, getWorkspaceHomeCopy, isClubAdmin, useAuth } from '../../lib/auth.js'
import InstallAppButton from '../pwa/InstallAppButton.jsx'

export function Topbar({ title, onMenuClick }) {
  const { authUser, clubOptions, demoRoleKey, hasPlatformAdminAccess, isProfileLoading, selectAccessMode, selectClub, selectPlatformAdmin, selectTeam, setDemoRolePreview, signOut, teamOptions, user } = useAuth()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [isSwitchingTeam, setIsSwitchingTeam] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const displayUser = user
  const isWorkspaceHome = location.pathname === '/coach' || location.pathname === '/home'
  const displayTitle = isWorkspaceHome ? getWorkspaceHomeCopy(displayUser).title : title
  const roleLabel = displayUser ? getRoleLabel(displayUser) : 'Loading access'
  const canUseClubAdminView = isClubAdmin(displayUser)
  const clubLabel = displayUser?.role === 'super_admin'
    ? 'Platform'
    : displayUser?.clubName || displayUser?.team || (isProfileLoading ? 'Opening workspace' : 'Workspace not loaded')
  const logoUrl = displayUser?.clubLogoUrl || fallbackLogo
  const userLabel = displayUser?.email || authUser?.email || displayUser?.name || 'Loading user'
  const teamLabel = displayUser?.activeTeamName || (canUseClubAdminView ? 'Club-wide' : clubLabel)
  const isPlatformAdminView = displayUser?.role === 'super_admin'
  const isParentPortalView = displayUser?.role === 'parent_portal'
  const hasParentPortalAccess = Array.isArray(displayUser?.parentPortalLinks) && displayUser.parentPortalLinks.length > 0
  const shouldShowClubAdminOption = !isPlatformAdminView && canUseClubAdminView
  const shouldShowTeamPlaceholder = !isPlatformAdminView && !canUseClubAdminView && teamOptions?.length > 0
  const shouldShowCurrentTeamAccessOption =
    !isPlatformAdminView && !isParentPortalView && hasPlatformAdminAccess && !displayUser?.activeTeamId
  const shouldShowWorkspaceSelector = hasPlatformAdminAccess || hasParentPortalAccess || clubOptions?.length > 0 || shouldShowClubAdminOption || teamOptions?.length > 0
  const workspaceContext = user?.role === 'super_admin'
    ? 'Platform control'
    : displayUser?.activeTeamName
      ? displayUser.activeTeamName
      : canUseClubAdminView
        ? 'Club-wide view'
        : isProfileLoading ? 'Opening workspace' : 'Team required'
  const workLaneLabel = isPlatformAdminView
    ? 'Platform tools'
    : isParentPortalView
      ? 'Family tools'
      : canUseClubAdminView && !displayUser?.activeTeamName
        ? 'Club tools'
        : 'Team tools'
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
        navigate('/parent-portal')
      } catch (error) {
        console.error(error)
      } finally {
        setIsSwitchingTeam(false)
      }
      return
    }

    if (teamId === '__team_access__') {
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
    <header className="sticky top-0 z-20 border-b border-[#d7e5dc] bg-white/95 px-4 py-3 shadow-sm shadow-[#101828]/5 backdrop-blur sm:px-6 md:px-8 xl:px-10">
      <div className="mx-auto grid max-w-[108rem] gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,36rem)] xl:items-center">
        <div className="flex min-w-0 items-center gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-3 shadow-sm shadow-[#047857]/10 sm:px-4">
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

          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
            <img src={logoUrl} alt={clubLabel} className="h-full w-full object-contain p-1.5" />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em]">
              <span className="max-w-[min(18rem,55vw)] truncate whitespace-nowrap text-[#047857]">{clubLabel}</span>
              <span className="rounded-lg border border-[#bbf7d0] bg-[#dcfce7] px-2 py-1 text-[#166534]">
                {todayLabel}
              </span>
            </div>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-[#101828] sm:text-3xl">
              {displayTitle}
            </h1>
            <p className="mt-1 text-sm font-semibold leading-6 text-[#4b5f55]">
              {nextActionLabel}
            </p>
          </div>
        </div>

        <div className="grid w-full gap-2 rounded-lg border border-[#d7e5dc] bg-white p-2 shadow-sm shadow-[#047857]/10">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#4b5f55]">View</p>
                <p className="mt-1 truncate whitespace-nowrap text-sm font-black text-[#101828]">{workspaceContext}</p>
              </div>
              <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#4b5f55]">Focus</p>
                <p className="mt-1 truncate whitespace-nowrap text-sm font-black text-[#101828]">{teamLabel}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 md:grid-cols-[auto_auto]">
              <Link
                to="/user-settings"
                className="inline-flex min-h-11 min-w-[7.5rem] items-center justify-center whitespace-nowrap rounded-lg border border-[#d7e5dc] bg-white px-3 py-3 text-sm font-black leading-none text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:bg-[#ecfdf5]"
              >
                Settings
              </Link>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={isSigningOut}
                title={isSigningOut ? 'Please wait while you are signed out.' : undefined}
                className="inline-flex min-h-11 min-w-[6.25rem] items-center justify-center whitespace-nowrap rounded-lg border border-[#f4b6b6] bg-white px-3 py-3 text-sm font-black leading-none text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:bg-[#fff5f5] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSigningOut ? 'Signing out...' : 'Sign out'}
              </button>
            </div>
          </div>

          <div className="grid gap-2 border-t border-[#e2e8f0] pt-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div className="grid gap-2 md:grid-cols-2">
              {isDemoUser(displayUser) ? (
                <label className="grid gap-1">
                  <span className="text-[11px] font-black uppercase tracking-[0.16em] text-[#4b5f55]">
                    Demo role
                  </span>
                  <select
                    value={demoRoleKey || ''}
                    onChange={(event) => setDemoRolePreview(event.target.value)}
                    className="min-h-11 rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm font-black text-[#101828] outline-none transition focus:border-[#0f9f6e]"
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
                <label className="grid gap-1">
                  <span className="text-[11px] font-black uppercase tracking-[0.16em] text-[#4b5f55]">
                    Access view
                  </span>
                  <select
                    value={isPlatformAdminView
                      ? '__platform_admin__'
                      : isParentPortalView
                        ? '__parent_portal__'
                        : displayUser?.activeTeamId || (shouldShowCurrentTeamAccessOption ? '__team_access__' : '')}
                    onChange={handleTeamChange}
                    disabled={isSwitchingTeam}
                    title={isSwitchingTeam ? 'Please wait while the workspace changes.' : undefined}
                    className="min-h-11 rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm font-black text-[#101828] outline-none transition focus:border-[#0f9f6e] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {hasPlatformAdminAccess ? <option value="__platform_admin__">Platform admin</option> : null}
                    {hasParentPortalAccess ? <option value="__parent_portal__">Family portal</option> : null}
                    {shouldShowCurrentTeamAccessOption ? <option value="__team_access__">Team access</option> : null}
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
            </div>

            <div className="grid gap-2 sm:grid-cols-[1fr_auto] md:min-w-[16rem]">
              <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2">
                <p className="truncate whitespace-nowrap text-xs font-black text-[#101828]">{workLaneLabel}</p>
                <p className="mt-1 truncate whitespace-nowrap text-[11px] font-semibold text-[#66756c]">{roleLabel}, {userLabel}</p>
              </div>
              <InstallAppButton
                wrapperClassName="lg:hidden"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#047857] bg-[#047857] px-3 py-3 text-sm font-black text-white"
              />
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
