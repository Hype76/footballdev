import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import fallbackLogo from '../../assets/football-player-logo.png'
import { clubNavigation, primaryNavigation } from '../../app/navigation.js'
import {
  canCreateEvaluation,
  canManageClubSettings,
  canManageFeedbackForms,
  canManageFormFields,
  canManageMatchDay,
  canManageParentEmailTemplates,
  canManageParentLinks,
  canManagePolls,
  canManageResourceLibrary,
  canManageTeamSettings,
  canManageUsers,
  canUseResourceLibrary,
  canUseDataTransfer,
  canUseStaffChat,
  canViewActivityLog,
  canViewBilling,
  canViewEndSeasonStats,
  hasTeamWorkflowContext,
  canViewPlatformFeedback,
  isClubAdmin,
  isParentPortalUser,
  isSuperAdmin,
  getRoleLabel,
  useAuth,
} from '../../lib/auth.js'
import { DEMO_ROLE_OPTIONS, isDemoUser } from '../../lib/demo.js'
import { CAPABILITIES } from '../../lib/paywall-access.js'
import { canUseUiFeature, createUiFeatureUnavailableMessage, getRouteCapability } from '../../lib/paywall-ui.js'
import { getParentPortalPolls, getPolls } from '../../lib/supabase.js'
import { isRecoveryModuleVisible, isRecoveryPathVisible } from '../../lib/recovery-phase.js'

const coachNavigationPaths = ['/calendar', '/sessions', '/players', '/assess-player', '/feedback-forms', '/parent-linking', '/staff-chat', '/parent-chat-staff', '/resources', '/polls', '/match-day']

const navIcons = {
  '/activity-log': 'activity',
  '/add-player': 'player-add',
  '/archived-players': 'archive',
  '/assess-player': 'note',
  '/billing': 'card',
  '/club-settings': 'shield',
  '/data-transfer': 'transfer',
  '/email-queue': 'mail',
  '/feedback-forms': 'template',
  '/end-season-stats': 'chart',
  '/form-builder': 'fields',
  '/calendar': 'calendar',
  '/match-day': 'whistle',
  '/parent-email-templates': 'template',
  '/parent-linking': 'parents',
  '/players': 'players',
  '/polls': 'availability',
  '/resources': 'folder',
  '/sessions': 'calendar',
  '/staff-chat': 'mail',
  '/teams': 'teams',
  '/user-access': 'staff',
  '/coach': 'home',
  '/parent-portal': 'calendar',
  '/parent-chat': 'mail',
  '/parent-chat-staff': 'mail',
  '/parent-polls': 'availability',
  '/friends-family': 'parents',
  '/platform-admin': 'shield',
  '/platform-clubs': 'teams',
  '/platform-billing-options': 'card',
  '/platform-feedback': 'note',
  '/feedback/new': 'note',
}

const groupDescriptions = {
  'Club setup': 'Identity, staff, rules, audit',
  Management: 'Workspace controls',
  'Match Operations': 'Match day and resources',
  'Platform setup': 'Support and billing',
  'Squad tools': 'Teams, reports, and records',
  'Team Comms': 'Staff, parents, and replies',
}

const coreNavigationPaths = ['/calendar', '/players', '/assess-player', '/feedback-forms']
const communicationNavigationPaths = ['/staff-chat', '/parent-chat-staff', '/parent-linking', '/polls']
const matchOperationsNavigationPaths = ['/match-day', '/resources']

function getSidebarTourId(path) {
  return `sidebar-${String(path ?? '').replace(/^\//, '').replace(/\//g, '-') || 'home'}`
}

function getNavIcon(path) {
  return navIcons[path] || 'home'
}

function pickNavigationItems(items, paths, excludedPaths = []) {
  return paths
    .filter((path) => !excludedPaths.includes(path))
    .map((path) => items.find((item) => item.path === path))
    .filter(Boolean)
}

function NavItemLabel({ item, pollCount = 0 }) {
  const count = item.path === '/polls' ? pollCount : 0

  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#047857] shadow-sm shadow-[#047857]/10 ring-1 ring-[#d7e5dc]">
        <NavIcon name={getNavIcon(item.path)} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate whitespace-nowrap text-sm font-black">{item.label}</span>
        {item.helper ? <span className="mt-0.5 block truncate whitespace-nowrap text-xs font-semibold opacity-80">{item.helper}</span> : null}
      </span>
      {count > 0 ? (
        <span className="inline-flex min-h-6 min-w-6 shrink-0 items-center justify-center rounded-lg bg-[#047857] px-2 text-xs font-black text-white shadow-sm shadow-[#047857]/20">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </span>
  )
}

function OperationsStrip({ canUseTeamWorkflow, displayUser, isParentPortal, onClose }) {
  const actions = isParentPortal
    ? [
        { label: 'Calendar', path: '/parent-portal', icon: 'calendar' },
        { label: 'Chat', path: '/parent-chat', icon: 'mail' },
        { label: 'Replies', path: '/parent-polls', icon: 'availability' },
      ]
    : canUseTeamWorkflow ? [
        { label: 'Session', path: '/sessions/start', icon: 'calendar' },
        { label: 'Players', path: '/players/current', icon: 'players' },
        { label: 'Parents', path: '/parent-linking', icon: 'parents' },
      ] : []
  const visibleActions = actions.filter((action) => {
    const capability = getRouteCapability(action.path)

    return isRecoveryPathVisible(action.path, { user: displayUser })
      && canUseUiFeature(displayUser, capability)
  })

  if (visibleActions.length === 0) {
    return null
  }

  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      {visibleActions.map((action) => (
        <Link
          key={action.path}
          to={action.path}
          onClick={onClose}
          className="group grid min-h-20 place-items-center rounded-lg border border-[#d7e5dc] bg-white px-2 py-3 text-center text-[#4b5f55] shadow-sm shadow-[#047857]/10 transition hover:border-[#047857] hover:bg-[#ecfdf5] hover:text-[#101828]"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] text-[#065f46] transition group-hover:bg-white">
            <NavIcon name={action.icon} />
          </span>
          <span className="mt-2 text-xs font-black leading-4">{action.label}</span>
        </Link>
      ))}
    </div>
  )
}

export function Sidebar({ isOpen, onClose }) {
  const {
    authUser,
    clubOptions,
    demoRoleKey,
    hasPlatformAdminAccess,
    isProfileLoading,
    selectAccessMode,
    selectClub,
    selectPlatformAdmin,
    selectTeam,
    setDemoRolePreview,
    signOut,
    teamOptions,
    user,
  } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const displayUser = user
  const logoUrl = displayUser?.clubLogoUrl || fallbackLogo
  const isParentPortal = isParentPortalUser(displayUser)
  const isCoachOnly = Boolean(displayUser) && !isParentPortal && !isSuperAdmin(displayUser) && Number(displayUser?.roleRank ?? 0) < 50
  const canUseTeamWorkflow = hasTeamWorkflowContext(displayUser)
  const clubLabel = displayUser?.role === 'super_admin' ? 'Platform' : displayUser?.clubName || 'Football Operations'
  const canAccessPlatformFeedback = canViewPlatformFeedback(displayUser)
  const feedbackRoute = `/feedback/new?route=${encodeURIComponent(`${location.pathname}${location.search}`)}`
  const [openPollCount, setOpenPollCount] = useState(0)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [isSwitchingTeam, setIsSwitchingTeam] = useState(false)
  const isPlatformAdminView = isSuperAdmin(displayUser)
  const canUseClubAdminView = isClubAdmin(displayUser)
  const roleLabel = displayUser ? getRoleLabel(displayUser) : 'Loading access'
  const userLabel = displayUser?.email || authUser?.email || displayUser?.name || 'Loading user'
  const teamLabel = displayUser?.activeTeamName || (canUseClubAdminView ? 'Club-wide' : clubLabel)
  const hasParentPortalAccess = Array.isArray(displayUser?.parentPortalLinks) && displayUser.parentPortalLinks.length > 0
  const profileAccessModeOptions = Array.isArray(displayUser?.accessModeOptions) ? displayUser.accessModeOptions : []
  const hasTeamAccessOption = profileAccessModeOptions.some((option) => option?.id === 'team')
  const currentActiveTeamId = String(displayUser?.activeTeamId ?? '').trim()
  const teamOptionsWithCurrent = currentActiveTeamId && !teamOptions.some((team) => String(team.id) === currentActiveTeamId)
    ? [
        {
          id: currentActiveTeamId,
          name: displayUser?.activeTeamName || 'Current team',
        },
        ...teamOptions,
      ]
    : teamOptions
  const shouldShowClubAdminOption = !isPlatformAdminView && canUseClubAdminView
  const shouldShowTeamPlaceholder = !isPlatformAdminView && !canUseClubAdminView && teamOptionsWithCurrent?.length > 0
  const shouldShowCurrentTeamAccessOption =
    !isPlatformAdminView && !isParentPortal && (hasPlatformAdminAccess || hasTeamAccessOption) && !displayUser?.activeTeamId
  const shouldShowWorkspaceSelector = hasPlatformAdminAccess || hasParentPortalAccess || hasTeamAccessOption || clubOptions?.length > 0 || shouldShowClubAdminOption || teamOptionsWithCurrent?.length > 0
  const selectedAccessViewValue = isPlatformAdminView
    ? '__platform_admin__'
    : isParentPortal
      ? '__parent_portal__'
      : currentActiveTeamId || (shouldShowCurrentTeamAccessOption ? '__team_access__' : '')
  const workspaceContext = isPlatformAdminView
    ? 'Platform control'
    : displayUser?.activeTeamName
      ? displayUser.activeTeamName
      : canUseClubAdminView
        ? 'Club-wide view'
        : isProfileLoading ? 'Opening workspace' : 'Team required'
  const workLaneLabel = isPlatformAdminView
    ? 'Platform tools'
    : isParentPortal
      ? 'Family tools'
      : canUseClubAdminView && !displayUser?.activeTeamName
        ? 'Club tools'
        : 'Team tools'

  useEffect(() => {
    let isMounted = true

    async function loadOpenPollCount() {
      if (!user) {
        setOpenPollCount(0)
        return
      }

      try {
        if (isParentPortalUser(user)) {
          if (!isRecoveryPathVisible('/parent-polls', { user })) {
            if (isMounted) {
              setOpenPollCount(0)
            }
            return
          }

          const links = Array.isArray(user.parentPortalLinks) ? user.parentPortalLinks : []
          const pollBatches = await Promise.all(
            links.map((link) => getParentPortalPolls({ parentLinkId: link.id }).catch(() => [])),
          )
          const uniquePollIds = new Set(
            pollBatches.flat().filter((poll) => poll.status === 'open').map((poll) => poll.id),
          )

          if (isMounted) {
            setOpenPollCount(uniquePollIds.size)
          }
          return
        }

        if (canManagePolls(user)) {
          if (!isRecoveryModuleVisible('pollsAvailability', { user })) {
            if (isMounted) {
              setOpenPollCount(0)
            }
            return
          }

          const polls = await getPolls({ user })
          const count = polls.filter((poll) => poll.status === 'open').length

          if (isMounted) {
            setOpenPollCount(count)
          }
          return
        }

        if (isMounted) {
          setOpenPollCount(0)
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setOpenPollCount(0)
        }
      }
    }

    void loadOpenPollCount()

    return () => {
      isMounted = false
    }
  }, [user])

  const handleSignOut = async () => {
    try {
      setIsSigningOut(true)
      onClose()
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
        onClose()
      } catch (error) {
        console.error(error)
      } finally {
        setIsSwitchingTeam(false)
      }
      return
    }

    if (teamId === '__team_access__') {
      try {
        setIsSwitchingTeam(true)
        await selectAccessMode('team')
        navigate('/coach')
        onClose()
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
        onClose()
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
      onClose()
    } catch (error) {
      console.error(error)
    } finally {
      setIsSwitchingTeam(false)
    }
  }

  const getVisibleNavigationItems = (items) => items.filter((item) => {
    if (!isRecoveryPathVisible(item.path, { user: displayUser })) {
      return false
    }

    if (isSuperAdmin(displayUser)) {
      return item.path === '/activity-log' || item.path === '/data-transfer'
    }

    if (isParentPortal) {
      return item.path === '/parent-portal' || item.path === '/parent-chat' || item.path === '/parent-polls'
    }

    if (item.path === '/calendar') {
      return (canUseTeamWorkflow && canCreateEvaluation(displayUser) && canUseUiFeature(displayUser, getRouteCapability(item.path)))
        || (isClubAdmin(displayUser) && canUseUiFeature(displayUser, CAPABILITIES.clubWideCalendar))
    }

    if (
      item.path === '/assess-player' ||
      item.path === '/sessions'
    ) {
      return canUseTeamWorkflow && canCreateEvaluation(displayUser) && canUseUiFeature(displayUser, getRouteCapability(item.path))
    }

    if (
      item.path === '/add-player' ||
      item.path === '/players' ||
      item.path === '/archived-players'
    ) {
      return canUseTeamWorkflow && canCreateEvaluation(displayUser) && canUseUiFeature(displayUser, getRouteCapability(item.path))
    }

    if (item.path === '/parent-linking') {
      return canUseTeamWorkflow && canManageParentLinks(displayUser) && canUseUiFeature(displayUser, CAPABILITIES.parentInvitations)
    }

    if (item.path === '/staff-chat' || item.path === '/parent-chat-staff') {
      return canUseStaffChat(displayUser)
    }

    if (item.path === '/resources') {
      return canUseResourceLibrary(displayUser) || canManageResourceLibrary(displayUser)
    }

    if (item.path === '/polls') {
      return canManagePolls(displayUser) && canUseUiFeature(displayUser, CAPABILITIES.teamPolls)
    }

    if (item.path === '/match-day') {
      return canUseTeamWorkflow && canManageMatchDay(displayUser) && canUseUiFeature(displayUser, CAPABILITIES.matchDay)
    }

    if (item.path === '/user-access') {
      return canManageUsers(displayUser) && canUseUiFeature(displayUser, CAPABILITIES.teamStaffRoles)
    }

    if (item.path === '/teams') {
      return canManageTeamSettings(displayUser) && canUseUiFeature(displayUser, CAPABILITIES.teamStaffRoles)
    }

    if (item.path === '/end-season-stats') {
      return canViewEndSeasonStats(displayUser) && canUseUiFeature(displayUser, CAPABILITIES.basicClubAnalytics)
    }

    if (item.path === '/activity-log') {
      return canViewActivityLog(displayUser) && (isSuperAdmin(displayUser) || canUseUiFeature(displayUser, CAPABILITIES.fullOperationalAuditLog))
    }

    if (item.path === '/data-transfer') {
      return canUseDataTransfer(displayUser)
    }

    if (item.path === '/form-builder') {
      return canManageFormFields(displayUser) && canUseUiFeature(displayUser, CAPABILITIES.customDevelopmentFields)
    }

    if (item.path === '/feedback-forms') {
      return canManageFeedbackForms(displayUser) && canUseUiFeature(displayUser, CAPABILITIES.customDevelopmentFields)
    }

    if (item.path === '/parent-email-templates') {
      return canManageParentEmailTemplates(displayUser) && canUseUiFeature(displayUser, CAPABILITIES.parentEmails)
    }

    if (item.path === '/club-settings') {
      return canManageClubSettings(displayUser) && canUseUiFeature(displayUser, CAPABILITIES.basicLogoBranding)
    }

    if (item.path === '/billing') {
      return canViewBilling(displayUser)
    }

    return true
  }).map((item) => {
    const capability = getRouteCapability(item.path)

    if (capability && !canUseUiFeature(displayUser, capability)) {
      return { ...item, disabled: true, disabledMessage: createUiFeatureUnavailableMessage(displayUser, capability) }
    }

    return item
  })

  const navigationItems = getVisibleNavigationItems(primaryNavigation)
  const clubNavigationItems = getVisibleNavigationItems(clubNavigation)
  const coachNavigationItems = navigationItems.filter((item) => coachNavigationPaths.includes(item.path))
  const teamNavigationItems = isCoachOnly ? [] : navigationItems.filter((item) => !coachNavigationPaths.includes(item.path))
  const parentPortalItems = useMemo(() => {
    if (isParentPortal) {
      return [
        { label: 'Calendar', path: '/parent-portal', helper: 'Events and match day' },
        { label: 'Chat', path: '/parent-chat', helper: 'Child, team and match chat' },
        { label: 'Polls', path: '/parent-polls', helper: 'Reply requests' },
      ].filter((item) => isRecoveryPathVisible(item.path, { user: displayUser }))
    }

    return []
  }, [displayUser, isParentPortal])
  const coachOnlyExcludedPaths = isCoachOnly ? ['/polls', '/parent-linking'] : []
  const coreWorkspaceItems = isParentPortal
    ? []
    : [
        { label: 'Home', path: '/coach', helper: 'Today and next actions' },
        ...pickNavigationItems(coachNavigationItems, coreNavigationPaths, coachOnlyExcludedPaths),
      ]
  const communicationItems = isParentPortal ? [] : pickNavigationItems(coachNavigationItems, communicationNavigationPaths, coachOnlyExcludedPaths)
  const matchOperationsItems = isParentPortal ? [] : pickNavigationItems(coachNavigationItems, matchOperationsNavigationPaths, coachOnlyExcludedPaths)

  return (
    <>
      <div
        className={[
          'fixed inset-0 z-30 bg-[#101828]/25 backdrop-blur-sm transition lg:hidden',
          isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
        onClick={onClose}
      />

      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 flex w-[min(20.5rem,calc(100vw-1rem))] max-w-[20.5rem] flex-col overflow-y-auto border-r border-[#d7e5dc] bg-white px-3 py-4 shadow-2xl shadow-[#047857]/10 transition sm:px-4 lg:fixed lg:translate-x-0 lg:shadow-none',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-3 shadow-sm shadow-[#047857]/10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10">
                  <img src={logoUrl} alt={clubLabel} className="h-full w-full object-contain p-1.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#047857]">
                    {isParentPortal ? 'Family portal' : isCoachOnly ? 'Coach tools' : 'Football Player'}
                  </p>
                  <h2 className="mt-1 max-w-[min(12.5rem,calc(100vw-9rem))] truncate whitespace-nowrap text-lg font-black tracking-tight text-[#101828]">{clubLabel}</h2>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white text-[#4b5f55] shadow-sm lg:hidden"
              aria-label="Close navigation"
            >
              X
            </button>
          </div>

          <div className="mt-3 rounded-lg border border-[#d7e5dc] bg-white px-3 py-2">
            <p className="text-xs font-black text-[#101828]">{isParentPortal ? 'Family view' : isCoachOnly ? 'Team workspace' : 'Club workspace'}</p>
            <p className="mt-1 truncate whitespace-nowrap text-sm font-black text-[#047857]">{workspaceContext}</p>
            <p className="mt-1 text-[11px] font-semibold leading-5 text-[#66756c]">
              {workLaneLabel} | {teamLabel}
            </p>
          </div>

          <div className="mt-3 grid gap-2">
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
                  value={selectedAccessViewValue}
                  onChange={handleTeamChange}
                  disabled={isSwitchingTeam}
                  title={isSwitchingTeam ? 'Please wait while the workspace changes.' : undefined}
                  className="min-h-11 rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm font-black text-[#101828] outline-none transition focus:border-[#0f9f6e] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {hasPlatformAdminAccess ? <option value="__platform_admin__">Platform admin</option> : null}
                  {hasParentPortalAccess ? <option value="__parent_portal__">Family portal</option> : null}
                  {shouldShowCurrentTeamAccessOption || (isParentPortal && hasTeamAccessOption) ? <option value="__team_access__">Team access</option> : null}
                  {isPlatformAdminView
                    ? clubOptions.map((club) => (
                        <option key={club.clubId} value={`__club__:${club.clubId}`}>
                          Club: {club.clubName || 'Unnamed club'}
                        </option>
                      ))
                    : null}
                  {shouldShowClubAdminOption ? <option value="">Club admin view</option> : null}
                  {shouldShowTeamPlaceholder ? <option value="">Select team</option> : null}
                  {teamOptionsWithCurrent.map((team) => (
                    <option key={team.id} value={team.id}>
                      Team: {team.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="rounded-lg border border-[#d7e5dc] bg-white px-3 py-2">
              <p className="truncate whitespace-nowrap text-xs font-black text-[#101828]">{workLaneLabel}</p>
              <p className="mt-1 truncate whitespace-nowrap text-[11px] font-semibold text-[#66756c]">{roleLabel}, {userLabel}</p>
            </div>
          </div>
        </div>

        <OperationsStrip canUseTeamWorkflow={canUseTeamWorkflow} displayUser={displayUser} isParentPortal={isParentPortal} onClose={onClose} />

        <nav className="mt-4 space-y-3 pb-4">
          {isParentPortal ? (
            <PrimaryNavSection
              title="Family actions"
              items={parentPortalItems}
              onClose={onClose}
              pollCount={openPollCount}
            />
          ) : (
            <>
              <PrimaryNavSection
                title={isCoachOnly ? 'Coach actions' : 'Club tools'}
                items={coreWorkspaceItems}
                onClose={onClose}
                pollCount={openPollCount}
              />

              {matchOperationsItems.length > 0 ? (
                <NavGroup title="Match Operations" items={matchOperationsItems} onClose={onClose} pollCount={openPollCount} defaultOpen />
              ) : null}

              {communicationItems.length > 0 ? (
                <NavGroup title="Team Comms" items={communicationItems} onClose={onClose} pollCount={openPollCount} defaultOpen />
              ) : null}
            </>
          )}

          {!isParentPortal && teamNavigationItems.length > 0 ? (
            <NavGroup title="Squad tools" items={teamNavigationItems} onClose={onClose} pollCount={openPollCount} />
          ) : null}

          {!isParentPortal && !isCoachOnly && clubNavigationItems.length > 0 ? (
            <NavGroup title={canManageClubSettings(displayUser) ? 'Club setup' : 'Management'} items={clubNavigationItems} onClose={onClose} pollCount={openPollCount} />
          ) : null}

          {isSuperAdmin(displayUser) ? (
            <PlatformNav onClose={onClose} canAccessPlatformFeedback={canAccessPlatformFeedback} />
          ) : null}
        </nav>

        <div className="mt-auto space-y-3 pt-4">
          {!isParentPortal ? (
            <>
              {!isCoachOnly ? (
                <NavLink
                to={feedbackRoute}
                data-tour-id="sidebar-tester-feedback"
                onClick={(event) => {
                  if (event.currentTarget.getAttribute('aria-current') === 'page') {
                    event.preventDefault()
                    return
                  }

                  onClose()
                }}
                className={({ isActive }) =>
                  [
                    'block rounded-lg border px-4 py-3 text-sm font-black transition shadow-sm shadow-[#047857]/10',
                    isActive
                      ? 'border-[#0f9f6e] bg-[#ecfdf5] text-[#065f46]'
                      : 'border-[#d7e5dc] bg-white text-[#4b5f55] hover:bg-[#f7faf8]',
                  ].join(' ')
                }
              >
                Report issue
              </NavLink>
              ) : null}
              {!isSuperAdmin(displayUser) && canAccessPlatformFeedback && isRecoveryModuleVisible('platformFeedback', { user: displayUser }) ? (
                <NavLink
                  to="/platform-feedback"
                  data-tour-id="sidebar-platform-feedback"
                  onClick={(event) => {
                    if (event.currentTarget.getAttribute('aria-current') === 'page') {
                      event.preventDefault()
                      return
                    }

                    onClose()
                  }}
                  className={({ isActive }) =>
                    [
                      'block rounded-lg border px-4 py-3 text-sm font-black transition shadow-sm shadow-[#047857]/10',
                      isActive
                      ? 'border-[#0f9f6e] bg-[#ecfdf5] text-[#065f46]'
                      : 'border-[#d7e5dc] bg-white text-[#4b5f55] hover:bg-[#f7faf8]',
                    ].join(' ')
                  }
                >
                  Development
                </NavLink>
              ) : null}
            </>
          ) : null}
          {isParentPortal ? (
            <NavLink
              to={feedbackRoute}
              data-tour-id="sidebar-tester-feedback"
              onClick={(event) => {
                if (event.currentTarget.getAttribute('aria-current') === 'page') {
                  event.preventDefault()
                  return
                }

                onClose()
              }}
              className={({ isActive }) =>
                [
                  'block rounded-lg border px-4 py-3 text-sm font-black transition shadow-sm shadow-[#047857]/10',
                  isActive
                    ? 'border-[#0f9f6e] bg-[#ecfdf5] text-[#065f46]'
                    : 'border-[#d7e5dc] bg-white text-[#4b5f55] hover:bg-[#f7faf8]',
                ].join(' ')
              }
            >
              Report issue
            </NavLink>
          ) : null}
          <NavLink
            to="/user-settings"
            data-tour-id="sidebar-user-settings"
            onClick={(event) => {
              if (event.currentTarget.getAttribute('aria-current') === 'page') {
                event.preventDefault()
                return
              }

              onClose()
            }}
            className={({ isActive }) =>
              [
                'block rounded-lg border px-4 py-3 text-sm font-black transition shadow-sm shadow-[#047857]/10',
                isActive
                  ? 'border-[#0f9f6e] bg-[#ecfdf5] text-[#065f46]'
                  : 'border-[#d7e5dc] bg-white text-[#4b5f55] hover:bg-[#f7faf8]',
              ].join(' ')
            }
          >
            Settings
          </NavLink>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
            title={isSigningOut ? 'Please wait while you are signed out.' : undefined}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:bg-[#f7faf8]"
          >
            {isSigningOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
      </aside>
    </>
  )
}

function PrimaryNavSection({ items, onClose, pollCount, title }) {
  return (
    <section className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-2 shadow-sm shadow-[#101828]/5">
      <div className="flex items-center justify-between px-2">
        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#4b5f55]">
          {title}
        </p>
        <span className="rounded-lg border border-[#bbf7d0] bg-[#dcfce7] px-2 py-1 text-[11px] font-black text-[#166534]">
          Live
        </span>
      </div>
      <div className="mt-2 grid gap-1.5">
        {items.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            data-tour-id={getSidebarTourId(item.path)}
            onClick={(event) => {
              if (event.currentTarget.getAttribute('aria-current') === 'page') {
                event.preventDefault()
                return
              }

              onClose()
            }}
            className={({ isActive }) =>
              [
                'block rounded-lg px-3 py-3 transition',
                isActive
                  ? 'bg-[#ecfdf5] text-[#065f46] shadow-sm shadow-[#047857]/10 ring-1 ring-[#0f9f6e]'
                  : 'bg-white text-[#4b5f55] shadow-sm shadow-[#047857]/5 hover:bg-[#ecfdf5] hover:text-[#101828]',
              ].join(' ')
            }
          >
            <NavItemLabel item={item} pollCount={pollCount} />
          </NavLink>
        ))}
      </div>
    </section>
  )
}

function NavGroup({ defaultOpen = false, items, onClose, pollCount, title }) {
  return (
    <details open={defaultOpen} className="group rounded-lg border border-[#d7e5dc] bg-white p-2 shadow-sm shadow-[#047857]/10">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-2 text-sm font-black text-[#101828]">
        <span className="min-w-0 flex-1">
          <span className="block truncate whitespace-nowrap">{title}</span>
          <span className="mt-0.5 block truncate whitespace-nowrap text-xs font-semibold text-[#4b5f55]">{groupDescriptions[title] || 'Workspace tools'}</span>
        </span>
        <span className="inline-flex min-h-9 min-w-14 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-2 py-1 text-xs font-black text-[#4b5f55] group-open:hidden">Show</span>
        <span className="hidden min-h-9 min-w-14 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-2 py-1 text-xs font-black text-[#4b5f55] group-open:inline-flex">Hide</span>
      </summary>
      <div className="mt-2 grid gap-1.5">
        {items.map((item) =>
          item.disabled ? (
            <DisabledNavItem key={item.path} item={item} />
          ) : (
            <NavLink
              key={item.path}
              to={item.path}
              data-tour-id={getSidebarTourId(item.path)}
              onClick={(event) => {
                if (event.currentTarget.getAttribute('aria-current') === 'page') {
                  event.preventDefault()
                  return
                }

                onClose()
              }}
              className={({ isActive }) =>
                [
                  'block rounded-lg px-3 py-3 transition',
                  isActive
                    ? 'bg-[#ecfdf5] text-[#065f46] shadow-sm shadow-[#047857]/10 ring-1 ring-[#0f9f6e]'
                    : 'text-[#4b5f55] hover:bg-[#f7faf8] hover:text-[#101828]',
                ].join(' ')
              }
            >
              <NavItemLabel item={item} pollCount={pollCount} />
            </NavLink>
          ),
        )}
      </div>
    </details>
  )
}

function PlatformNav({ canAccessPlatformFeedback, onClose }) {
  const items = [
    { label: 'Platform Admin', path: '/platform-admin', helper: 'System overview' },
    { label: 'Club Management', path: '/platform-clubs', helper: 'Club records' },
    { label: 'Data Transfer', path: '/data-transfer', helper: 'Controlled XLSX onboarding' },
    { label: 'Billing Options', path: '/platform-billing-options', helper: 'Plans and coupons' },
    ...(canAccessPlatformFeedback ? [{ label: 'Platform Feedback', path: '/platform-feedback', helper: 'Requests and issues' }] : []),
  ]

  return <NavGroup title="Platform setup" items={items} onClose={onClose} pollCount={0} />
}

function DisabledNavItem({ item }) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title={item.disabledMessage}
      className="flex min-h-11 w-full cursor-not-allowed items-start gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-3 text-left opacity-70"
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#4b5f55] ring-1 ring-[#d7e5dc]">
        <NavIcon name={getNavIcon(item.path)} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-black text-[#4b5f55]">{item.label}</span>
        <span className="mt-1 block text-xs leading-5 text-[#6d8076]">{item.disabledMessage}</span>
      </span>
    </button>
  )
}

function NavIcon({ name }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: '1.8',
  }

  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      {name === 'calendar' ? (
        <>
          <path {...common} d="M7 4v3M17 4v3M5 9h14" />
          <path {...common} d="M6 6h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
        </>
      ) : name === 'players' || name === 'teams' || name === 'parents' || name === 'staff' ? (
        <>
          <path {...common} d="M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
          <path {...common} d="M15.5 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
          <path {...common} d="M3.5 20a5 5 0 0 1 10 0" />
          <path {...common} d="M13 19a4 4 0 0 1 7.5 0" />
        </>
      ) : name === 'player-add' ? (
        <>
          <path {...common} d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
          <path {...common} d="M4 20a5 5 0 0 1 10 0" />
          <path {...common} d="M18 9v8M14 13h8" />
        </>
      ) : name === 'note' || name === 'template' ? (
        <>
          <path {...common} d="M6 4h9l3 3v13H6V4Z" />
          <path {...common} d="M15 4v4h4M8.5 12h7M8.5 16h5" />
        </>
      ) : name === 'mail' ? (
        <>
          <path {...common} d="M4 6h16v12H4V6Z" />
          <path {...common} d="m4.5 7 7.5 6 7.5-6" />
        </>
      ) : name === 'availability' ? (
        <>
          <path {...common} d="M5 12.5 9.2 17 19 7" />
          <path {...common} d="M4 4h16v16H4V4Z" />
        </>
      ) : name === 'whistle' ? (
        <>
          <path {...common} d="M4 13a5 5 0 0 1 5-5h8v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-1Z" />
          <path {...common} d="M17 8l3-3M9 13h.01" />
        </>
      ) : name === 'card' ? (
        <>
          <path {...common} d="M4 7h16v11H4V7Z" />
          <path {...common} d="M4 11h16M7 15h4" />
        </>
      ) : name === 'shield' ? (
        <>
          <path {...common} d="M12 3 19 6v5c0 4.5-2.7 7.4-7 10-4.3-2.6-7-5.5-7-10V6l7-3Z" />
          <path {...common} d="M9 12l2 2 4-5" />
        </>
      ) : name === 'transfer' ? (
        <>
          <path {...common} d="M7 4h10v5H7V4ZM7 15h10v5H7v-5Z" />
          <path {...common} d="M12 9v6M9 12l3 3 3-3" />
        </>
      ) : name === 'fields' ? (
        <>
          <path {...common} d="M5 6h14M5 12h14M5 18h14" />
          <path {...common} d="M8 4v4M15 10v4M11 16v4" />
        </>
      ) : name === 'chart' || name === 'activity' ? (
        <>
          <path {...common} d="M5 19V5M5 19h15" />
          <path {...common} d="M8 15l3-4 3 2 5-7" />
        </>
      ) : name === 'archive' ? (
        <>
          <path {...common} d="M4 7h16v4H4V7Z" />
          <path {...common} d="M6 11v8h12v-8M10 15h4" />
        </>
      ) : name === 'folder' ? (
        <>
          <path {...common} d="M4 6h6l2 3h8v9.5A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5V6Z" />
          <path {...common} d="M4 10h16" />
        </>
      ) : (
        <>
          <path {...common} d="M4 11.5 12 5l8 6.5" />
          <path {...common} d="M6.5 10.5V20h11v-9.5" />
        </>
      )}
    </svg>
  )
}
