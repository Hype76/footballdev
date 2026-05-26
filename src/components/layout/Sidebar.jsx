import { useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import fallbackLogo from '../../assets/football-player-logo.png'
import { clubNavigation, primaryNavigation } from '../../app/navigation.js'
import {
  canCreateEvaluation,
  canManageClubSettings,
  canManageEmailQueue,
  canManageFormFields,
  canManageMatchDay,
  canManageParentEmailTemplates,
  canManageParentLinks,
  canManagePolls,
  canManageTeamSettings,
  canManageUsers,
  canViewActivityLog,
  canViewBilling,
  canViewEndSeasonStats,
  canViewPlatformFeedback,
  isParentPortalUser,
  isSuperAdmin,
  useAuth,
} from '../../lib/auth.js'
import { getScheduledEmails } from '../../lib/domain/scheduled-emails.js'
import { createFeatureUpgradeMessage, hasPlanFeature } from '../../lib/plans.js'
import { getParentPortalPolls, getPolls } from '../../lib/supabase.js'

const coachNavigationPaths = ['/sessions', '/players', '/assess-player', '/parent-linking', '/email-queue', '/polls', '/match-day']

const navIcons = {
  '/activity-log': 'activity',
  '/add-player': 'player-add',
  '/archived-players': 'archive',
  '/assess-player': 'note',
  '/billing': 'card',
  '/club-settings': 'shield',
  '/email-queue': 'mail',
  '/end-season-stats': 'chart',
  '/form-builder': 'fields',
  '/match-day': 'whistle',
  '/parent-email-templates': 'template',
  '/parent-linking': 'parents',
  '/players': 'players',
  '/polls': 'availability',
  '/sessions': 'calendar',
  '/teams': 'teams',
  '/user-access': 'staff',
  '/coach': 'home',
  '/parent-portal': 'calendar',
  '/parent-messages': 'mail',
  '/parent-polls': 'availability',
  '/friends-family': 'parents',
  '/platform-admin': 'shield',
  '/platform-clubs': 'teams',
  '/platform-billing-options': 'card',
  '/platform-feedback': 'note',
}

const groupDescriptions = {
  'Club setup': 'Identity, staff, rules, and audit',
  Management: 'Shared workspace controls',
  'Platform setup': 'Support and billing tools',
  'Squad tools': 'Player records and club memory',
}

function getSidebarTourId(path) {
  return `sidebar-${String(path ?? '').replace(/^\//, '').replace(/\//g, '-') || 'home'}`
}

function getNavIcon(path) {
  return navIcons[path] || 'home'
}

function NavItemLabel({ item, pollCount = 0, queuedEmailCount = 0 }) {
  const count = item.path === '/polls' ? pollCount : item.path === '/email-queue' ? queuedEmailCount : 0

  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#067a46] shadow-sm shadow-[#d7eadf]/80 ring-1 ring-[#bfe8cd]">
        <NavIcon name={getNavIcon(item.path)} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-black">{item.label}</span>
        {item.helper ? <span className="mt-0.5 block truncate text-xs font-semibold opacity-70">{item.helper}</span> : null}
      </span>
      {count > 0 ? (
        <span className="inline-flex min-h-6 min-w-6 shrink-0 items-center justify-center rounded-lg bg-[#067a46] px-2 text-xs font-black text-white">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </span>
  )
}

export function Sidebar({ isOpen, onClose }) {
  const { signOut, user } = useAuth()
  const displayUser = user
  const logoUrl = displayUser?.clubLogoUrl || fallbackLogo
  const isParentPortal = isParentPortalUser(displayUser)
  const clubLabel = displayUser?.role === 'super_admin' ? 'Platform' : displayUser?.clubName || 'Football Operations'
  const canAccessPlatformFeedback = canViewPlatformFeedback(displayUser)
  const [openPollCount, setOpenPollCount] = useState(0)
  const [queuedEmailCount, setQueuedEmailCount] = useState(0)

  useEffect(() => {
    let isMounted = true

    async function loadOpenPollCount() {
      if (!user) {
        setOpenPollCount(0)
        return
      }

      try {
        if (isParentPortalUser(user)) {
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

  useEffect(() => {
    let isMounted = true

    async function loadQueuedEmailCount() {
      if (!canManageEmailQueue(user) || !hasPlanFeature(user, 'parentEmail')) {
        setQueuedEmailCount(0)
        return
      }

      try {
        const queuedEmails = await getScheduledEmails({ user })

        if (isMounted) {
          setQueuedEmailCount(queuedEmails.length)
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setQueuedEmailCount(0)
        }
      }
    }

    void loadQueuedEmailCount()

    const handleQueueChange = () => {
      void loadQueuedEmailCount()
    }

    window.addEventListener('scheduled-email-queue-changed', handleQueueChange)

    return () => {
      isMounted = false
      window.removeEventListener('scheduled-email-queue-changed', handleQueueChange)
    }
  }, [user])

  const handleSignOut = async () => {
    try {
      onClose()
      await signOut()
    } catch (error) {
      console.error(error)
    }
  }

  const getVisibleNavigationItems = (items) => items.filter((item) => {
    if (isSuperAdmin(displayUser)) {
      return item.path === '/activity-log'
    }

    if (isParentPortal) {
      return item.path === '/parent-portal' || item.path === '/parent-messages' || item.path === '/parent-polls' || item.path === '/friends-family'
    }

    if (
      item.path === '/assess-player' ||
      item.path === '/add-player' ||
      item.path === '/sessions' ||
      item.path === '/players' ||
      item.path === '/archived-players'
    ) {
      return canCreateEvaluation(displayUser)
    }

    if (item.path === '/parent-linking') {
      return canManageParentLinks(displayUser)
    }

    if (item.path === '/email-queue') {
      return canManageEmailQueue(displayUser) && hasPlanFeature(displayUser, 'parentEmail') && queuedEmailCount > 0
    }

    if (item.path === '/polls') {
      return canManagePolls(displayUser)
    }

    if (item.path === '/match-day') {
      return canManageMatchDay(displayUser)
    }

    if (item.path === '/user-access') {
      return canManageUsers(displayUser)
    }

    if (item.path === '/teams') {
      return canManageTeamSettings(displayUser)
    }

    if (item.path === '/end-season-stats') {
      return canViewEndSeasonStats(displayUser)
    }

    if (item.path === '/activity-log') {
      return canViewActivityLog(displayUser)
    }

    if (item.path === '/form-builder') {
      return canManageFormFields(displayUser)
    }

    if (item.path === '/parent-email-templates') {
      return canManageParentEmailTemplates(displayUser)
    }

    if (item.path === '/club-settings') {
      return canManageClubSettings(displayUser)
    }

    if (item.path === '/billing') {
      return canViewBilling(displayUser)
    }

    return true
  }).map((item) => {
    if (item.path === '/activity-log' && !hasPlanFeature(displayUser, 'auditLogs')) {
      return { ...item, disabled: true, disabledMessage: createFeatureUpgradeMessage('auditLogs') }
    }

    if (item.path === '/form-builder' && !hasPlanFeature(displayUser, 'customFormFields')) {
      return { ...item, disabled: true, disabledMessage: createFeatureUpgradeMessage('customFormFields') }
    }

    if (item.path === '/parent-email-templates' && !hasPlanFeature(displayUser, 'parentEmail')) {
      return { ...item, disabled: true, disabledMessage: createFeatureUpgradeMessage('parentEmail') }
    }

    if (item.path === '/email-queue' && !hasPlanFeature(displayUser, 'parentEmail')) {
      return { ...item, disabled: true, disabledMessage: createFeatureUpgradeMessage('parentEmail') }
    }

    return item
  })

  const navigationItems = getVisibleNavigationItems(primaryNavigation)
  const clubNavigationItems = getVisibleNavigationItems(clubNavigation)
  const coachNavigationItems = navigationItems.filter((item) => coachNavigationPaths.includes(item.path))
  const teamNavigationItems = navigationItems.filter((item) => !coachNavigationPaths.includes(item.path))
  const workspaceItems = useMemo(() => {
    if (isParentPortal) {
      return [
        { label: 'Match Day', path: '/parent-portal', helper: 'Fixtures and updates' },
        { label: 'Messages', path: '/parent-messages', helper: 'Club notices' },
        { label: 'Polls', path: '/parent-polls', helper: 'Reply requests' },
        { label: 'Friends and Family', path: '/friends-family', helper: 'Shared access' },
      ]
    }

    return [{ label: 'Home', path: '/coach', helper: 'Today and next actions' }, ...coachNavigationItems]
  }, [coachNavigationItems, isParentPortal])

  return (
    <>
      <div
        className={[
          'fixed inset-0 z-30 bg-[#10231a]/25 backdrop-blur-sm transition lg:hidden',
          isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
        onClick={onClose}
      />

      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 flex w-[min(18.5rem,calc(100vw-1rem))] max-w-[18.5rem] flex-col overflow-y-auto border-r border-[#cfeedd] bg-white px-3 py-4 shadow-2xl shadow-[#cfeedd]/50 transition sm:px-4 lg:fixed lg:translate-x-0 lg:shadow-none',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#e0f3e8] pb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#cfeedd] bg-[#f8fdf9] shadow-sm shadow-[#d7eadf]/70">
                <img src={logoUrl} alt={clubLabel} className="h-full w-full object-contain p-1.5" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#067a46]">
                  {isParentPortal ? 'Parent access' : 'Club control'}
                </p>
                <h2 className="mt-1 truncate text-base font-black tracking-tight text-[#101828]">{clubLabel}</h2>
              </div>
            </div>
            <p className="mt-3 rounded-lg border border-[#cfeedd] bg-[#f8fdf9] px-3 py-2 text-xs font-bold leading-5 text-[#456653]">
              {isParentPortal ? 'Fixtures, replies, and club messages in one view.' : 'Week plan, squad, parents, staff, and match day.'}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-[#cfeedd] bg-white text-[#456653] shadow-sm lg:hidden"
            aria-label="Close navigation"
          >
            X
          </button>
        </div>

        <nav className="mt-4 space-y-3 pb-4">
          <section className="rounded-lg border border-[#cfeedd] bg-[#f8fdf9] p-2 shadow-sm shadow-[#d7eadf]/70">
            <div className="flex items-center justify-between px-2">
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#456653]">
                {isParentPortal ? 'Family view' : 'Match week'}
              </p>
              <span className="rounded-lg bg-[#067a46] px-2 py-1 text-[11px] font-black text-white">
                Active
              </span>
            </div>
            <div className="mt-2 grid gap-1.5">
              {workspaceItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  data-tour-id={getSidebarTourId(item.path)}
                  onClick={onClose}
                  className={({ isActive }) =>
                    [
                      'block rounded-lg px-3 py-3 transition',
                      isActive
                        ? 'bg-[#067a46] text-white shadow-sm shadow-[#b7efce]'
                        : 'bg-white text-[#344054] shadow-sm shadow-[#d7eadf]/70 hover:bg-[#f0fdf6] hover:text-[#101828]',
                    ].join(' ')
                  }
                >
                  <NavItemLabel item={item} pollCount={openPollCount} queuedEmailCount={queuedEmailCount} />
                </NavLink>
              ))}
            </div>
          </section>

          {!isParentPortal && teamNavigationItems.length > 0 ? (
            <NavGroup title="Squad tools" items={teamNavigationItems} onClose={onClose} pollCount={openPollCount} queuedEmailCount={queuedEmailCount} />
          ) : null}

          {!isParentPortal && clubNavigationItems.length > 0 ? (
            <NavGroup title={canManageClubSettings(displayUser) ? 'Club setup' : 'Management'} items={clubNavigationItems} onClose={onClose} pollCount={openPollCount} queuedEmailCount={queuedEmailCount} />
          ) : null}

          {isSuperAdmin(displayUser) ? (
            <PlatformNav onClose={onClose} canAccessPlatformFeedback={canAccessPlatformFeedback} />
          ) : null}
        </nav>

        <div className="mt-auto space-y-3 pt-4">
          {!isParentPortal ? (
            <>
              <NavLink
                to="/information"
                data-tour-id="sidebar-information"
                onClick={onClose}
                className={({ isActive }) =>
                  [
                    'block rounded-lg border px-4 py-3 text-sm font-black transition shadow-sm shadow-[#d7eadf]/60',
                    isActive
                      ? 'border-[#20a464] bg-[#f0fdf6] text-[#065f3b]'
                      : 'border-[#bfe8cd] bg-white text-[#344054] hover:bg-[#f8fdf9]',
                  ].join(' ')
                }
              >
                How to use
              </NavLink>
              {!isSuperAdmin(displayUser) && canAccessPlatformFeedback ? (
                <NavLink
                  to="/platform-feedback"
                  data-tour-id="sidebar-platform-feedback"
                  onClick={onClose}
                  className={({ isActive }) =>
                    [
                      'block rounded-lg border px-4 py-3 text-sm font-black transition shadow-sm shadow-[#d7eadf]/60',
                      isActive
                      ? 'border-[#20a464] bg-[#f0fdf6] text-[#065f3b]'
                      : 'border-[#bfe8cd] bg-white text-[#344054] hover:bg-[#f8fdf9]',
                    ].join(' ')
                  }
                >
                  Share feedback
                </NavLink>
              ) : null}
            </>
          ) : null}
          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[#cfeedd] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#d7eadf]/70 transition hover:bg-[#f8fdf9]"
          >
            Sign out
          </button>
        </div>
      </aside>
    </>
  )
}

function NavGroup({ items, onClose, pollCount, queuedEmailCount, title }) {
  return (
    <details className="group rounded-lg border border-[#cfeedd] bg-white p-2 shadow-sm shadow-[#d7eadf]/70">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-2 text-sm font-black text-[#101828]">
        <span className="min-w-0 flex-1">
          <span className="block">{title}</span>
          <span className="mt-0.5 block text-xs font-semibold text-[#5f7468]">{groupDescriptions[title] || 'Workspace tools'}</span>
        </span>
        <span className="inline-flex min-h-9 min-w-14 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-[#cfeedd] bg-[#f8fdf9] px-2 py-1 text-xs font-black text-[#5f7468] group-open:hidden">Show</span>
        <span className="hidden min-h-9 min-w-14 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-[#cfeedd] bg-[#f8fdf9] px-2 py-1 text-xs font-black text-[#5f7468] group-open:inline-flex">Hide</span>
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
              onClick={onClose}
              className={({ isActive }) =>
                [
                  'block rounded-lg px-3 py-3 transition',
                  isActive
                    ? 'bg-[#f0fdf6] text-[#065f3b] ring-1 ring-[#20a464]'
                    : 'text-[#344054] hover:bg-[#f8fdf9] hover:text-[#101828]',
                ].join(' ')
              }
            >
              <NavItemLabel item={item} pollCount={pollCount} queuedEmailCount={queuedEmailCount} />
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
    { label: 'Billing Options', path: '/platform-billing-options', helper: 'Plans and coupons' },
    ...(canAccessPlatformFeedback ? [{ label: 'Platform Feedback', path: '/platform-feedback', helper: 'Requests and issues' }] : []),
  ]

  return <NavGroup title="Platform setup" items={items} onClose={onClose} pollCount={0} queuedEmailCount={0} />
}

function DisabledNavItem({ item }) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title={item.disabledMessage}
      className="flex min-h-11 w-full cursor-not-allowed items-start gap-3 rounded-lg border border-[#d7eadf] bg-[#f8fdf9] px-3 py-3 text-left opacity-70"
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#5f7468] ring-1 ring-[#bfe8cd]">
        <NavIcon name={getNavIcon(item.path)} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-black text-[#5f7468]">{item.label}</span>
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
      ) : (
        <>
          <path {...common} d="M4 11.5 12 5l8 6.5" />
          <path {...common} d="M6.5 10.5V20h11v-9.5" />
        </>
      )}
    </svg>
  )
}
