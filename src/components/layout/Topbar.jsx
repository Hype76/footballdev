import { useState } from 'react'
import { Link } from 'react-router-dom'
import fallbackLogo from '../../assets/football-player-logo.png'
import { DEMO_ROLE_OPTIONS, isDemoUser } from '../../lib/demo.js'
import { getRoleLabel, isClubAdmin, useAuth } from '../../lib/auth.js'
import InstallAppButton from '../pwa/InstallAppButton.jsx'

export function Topbar({ title, onMenuClick }) {
  const { authUser, clubOptions, demoRoleKey, hasPlatformAdminAccess, isProfileLoading, selectAccessMode, selectClub, selectPlatformAdmin, selectTeam, setDemoRolePreview, signOut, teamOptions, user } = useAuth()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [isSwitchingTeam, setIsSwitchingTeam] = useState(false)
  const displayUser = user
  const roleLabel = displayUser ? getRoleLabel(displayUser) : 'Loading access'
  const canUseClubAdminView = isClubAdmin(displayUser)
  const clubLabel = displayUser?.role === 'super_admin'
    ? 'Platform'
    : displayUser?.clubName || displayUser?.team || (isProfileLoading ? 'Opening workspace' : 'No club')
  const logoUrl = displayUser?.clubLogoUrl || fallbackLogo
  const userLabel = displayUser?.email || authUser?.email || displayUser?.name || 'Loading user'
  const teamLabel = displayUser?.activeTeamName ? `Team: ${displayUser.activeTeamName}` : clubLabel
  const isPlatformAdminView = displayUser?.role === 'super_admin'
  const isParentPortalView = displayUser?.role === 'parent_portal'
  const hasParentPortalAccess = Array.isArray(displayUser?.parentPortalLinks) && displayUser.parentPortalLinks.length > 0
  const shouldShowClubAdminOption = !isPlatformAdminView && canUseClubAdminView
  const shouldShowTeamPlaceholder = !isPlatformAdminView && !canUseClubAdminView && teamOptions?.length > 0
  const shouldShowWorkspaceSelector = hasPlatformAdminAccess || hasParentPortalAccess || clubOptions?.length > 0 || shouldShowClubAdminOption || teamOptions?.length > 0
  const workspaceContext = user?.role === 'super_admin'
    ? 'Platform control'
    : displayUser?.activeTeamName
      ? displayUser.activeTeamName
      : canUseClubAdminView
        ? 'Club operations'
        : isProfileLoading ? 'Opening workspace' : 'Choose a team'
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
    <header className="sticky top-0 z-20 border-b border-emerald-100 bg-white/95 px-4 py-3 shadow-sm shadow-emerald-900/5 sm:px-6 md:px-8 xl:px-10">
      <div className="mx-auto flex max-w-[78rem] flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            onClick={onMenuClick}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm lg:hidden"
            aria-label="Open navigation"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-950 shadow-sm">
            <img src={logoUrl} alt={clubLabel} className="h-full w-full object-contain p-1.5" />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-[11px] font-black uppercase tracking-[0.18em] text-emerald-700">
                {clubLabel}
              </p>
              <span className="rounded-md bg-lime-100 px-2 py-1 text-[11px] font-black text-lime-950 ring-1 ring-lime-200">
                {workspaceContext}
              </span>
              <span className="rounded-md bg-sky-50 px-2 py-1 text-[11px] font-black text-sky-800 ring-1 ring-sky-100">
                {todayLabel}
              </span>
            </div>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
              {title}
            </h1>
            <p className="mt-1 text-sm font-semibold text-slate-600">{userLabel} | {roleLabel} | {teamLabel}</p>
          </div>
        </div>

        <div className="grid w-full gap-2 rounded-lg border border-slate-200 bg-[#f7fafc] p-2 shadow-sm 2xl:w-auto 2xl:min-w-[38rem]">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_auto_auto] md:items-end">
            {isDemoUser(displayUser) ? (
              <label className="col-span-2 grid gap-1 md:col-span-1">
                <span className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                  Demo role
                </span>
                <select
                  value={demoRoleKey || ''}
                  onChange={(event) => setDemoRolePreview(event.target.value)}
                  className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-950 outline-none transition focus:border-emerald-500"
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
              <label className="col-span-2 grid gap-1 md:col-span-1">
                <span className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                  Workspace view
                </span>
                <select
                  value={isPlatformAdminView ? '__platform_admin__' : isParentPortalView ? '__parent_portal__' : displayUser?.activeTeamId || ''}
                  onChange={handleTeamChange}
                  disabled={isSwitchingTeam}
                  title={isSwitchingTeam ? 'Please wait while the workspace changes.' : undefined}
                  className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-950 outline-none transition focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
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
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-700 px-3 py-3 text-sm font-black text-white"
            />
            <Link
              to="/user-settings"
              className="inline-flex min-h-11 min-w-[7.5rem] items-center justify-center whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-black leading-none text-slate-950 transition hover:bg-slate-100"
            >
              My Settings
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={isSigningOut}
              title={isSigningOut ? 'Please wait while you are signed out.' : undefined}
              className="inline-flex min-h-11 min-w-[6.25rem] items-center justify-center whitespace-nowrap rounded-lg border border-slate-950 bg-slate-950 px-3 py-3 text-sm font-black leading-none text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSigningOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
