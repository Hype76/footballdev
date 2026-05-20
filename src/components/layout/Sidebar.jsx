import { useEffect, useState } from 'react'
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
  canViewPlatformFeedback,
  canViewActivityLog,
  canViewBilling,
  canViewEndSeasonStats,
  isSuperAdmin,
  isParentPortalUser,
  useAuth,
} from '../../lib/auth.js'
import { getScheduledEmails } from '../../lib/domain/scheduled-emails.js'
import { createFeatureUpgradeMessage, hasPlanFeature } from '../../lib/plans.js'
import { getParentPortalPolls, getPolls } from '../../lib/supabase.js'

function getSidebarTourId(path) {
  return `sidebar-${String(path ?? '').replace(/^\//, '').replace(/\//g, '-') || 'home'}`
}

function NavItemLabel({ label, showPollCount = false, pollCount = 0 }) {
  return (
    <span className="flex min-w-0 items-center justify-between gap-3">
      <span className="min-w-0 truncate">{label}</span>
      {showPollCount && pollCount > 0 ? (
        <span className="inline-flex min-h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] px-2 text-xs font-bold text-black">
          {pollCount > 99 ? '99+' : pollCount}
        </span>
      ) : null}
    </span>
  )
}

export function Sidebar({ isOpen, onClose }) {
  const { signOut, user } = useAuth()
  const logoUrl = user?.clubLogoUrl || fallbackLogo
  const isParentPortal = isParentPortalUser(user)
  const clubLabel = user?.role === 'super_admin' ? 'Platform' : user?.clubName || 'Football Operations'
  const canAccessPlatformFeedback = canViewPlatformFeedback(user)
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
    if (isSuperAdmin(user)) {
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
      return canCreateEvaluation(user)
    }

    if (item.path === '/parent-linking') {
      return canManageParentLinks(user)
    }

    if (item.path === '/email-queue') {
      return canManageEmailQueue(user) && hasPlanFeature(user, 'parentEmail') && queuedEmailCount > 0
    }

    if (item.path === '/polls') {
      return canManagePolls(user)
    }

    if (item.path === '/match-day') {
      return canManageMatchDay(user)
    }

    if (item.path === '/user-access') {
      return canManageUsers(user)
    }

    if (item.path === '/teams') {
      return canManageTeamSettings(user)
    }

    if (item.path === '/end-season-stats') {
      return canViewEndSeasonStats(user)
    }

    if (item.path === '/activity-log') {
      return canViewActivityLog(user)
    }

    if (item.path === '/form-builder') {
      return canManageFormFields(user)
    }

    if (item.path === '/parent-email-templates') {
      return canManageParentEmailTemplates(user)
    }

    if (item.path === '/club-settings') {
      return canManageClubSettings(user)
    }

    if (item.path === '/billing') {
      return canViewBilling(user)
    }

    return true
  }).map((item) => {
    if (item.path === '/activity-log' && !hasPlanFeature(user, 'auditLogs')) {
      return {
        ...item,
        disabled: true,
        disabledMessage: createFeatureUpgradeMessage('auditLogs'),
      }
    }

    if (item.path === '/form-builder' && !hasPlanFeature(user, 'customFormFields')) {
      return {
        ...item,
        disabled: true,
        disabledMessage: createFeatureUpgradeMessage('customFormFields'),
      }
    }

    if (item.path === '/parent-email-templates' && !hasPlanFeature(user, 'parentEmail')) {
      return {
        ...item,
        disabled: true,
        disabledMessage: createFeatureUpgradeMessage('parentEmail'),
      }
    }

    if (item.path === '/email-queue' && !hasPlanFeature(user, 'parentEmail')) {
      return {
        ...item,
        disabled: true,
        disabledMessage: createFeatureUpgradeMessage('parentEmail'),
      }
    }

    return item
  })
  const navigationItems = getVisibleNavigationItems(primaryNavigation)
  const clubNavigationItems = getVisibleNavigationItems(clubNavigation)
  const clubNavigationLabel = canManageClubSettings(user) ? 'Club' : 'Management'
  const coachNavigationPaths = ['/sessions', '/players', '/assess-player', '/parent-linking', '/email-queue', '/polls', '/match-day']
  const coachNavigationItems = navigationItems.filter((item) => coachNavigationPaths.includes(item.path))
  const teamNavigationItems = navigationItems.filter((item) => !coachNavigationPaths.includes(item.path))

  if (isParentPortal) {
    return (
      <>
        <div
          className={[
            'fixed inset-0 z-30 bg-black/50 transition lg:hidden',
            isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
          ].join(' ')}
          onClick={onClose}
        />
        <aside
          className={[
            'fixed inset-y-0 left-0 z-40 flex w-[min(20rem,calc(100vw-1rem))] max-w-72 flex-col overflow-y-auto border-r border-[var(--border-color)] bg-[var(--sidebar-bg)] px-4 py-5 transition sm:px-5 sm:py-6 lg:fixed lg:translate-x-0',
            isOpen ? 'translate-x-0' : '-translate-x-full',
          ].join(' ')}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-4 flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)]">
                <img src={logoUrl} alt={clubLabel} className="h-full w-full object-contain p-1" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-secondary)]">Parent Portal</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-muted)] lg:hidden"
              aria-label="Close navigation"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <nav className="mt-7 space-y-2 pb-4">
            <NavLink
              to="/parent-portal"
              onClick={onClose}
              className={({ isActive }) =>
                [
                  'block min-h-12 rounded-lg px-4 py-3 text-base font-semibold transition',
                  isActive
                    ? 'bg-[var(--button-primary)] text-[var(--button-primary-text)]'
                    : 'bg-[var(--panel-alt)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]',
                ].join(' ')
              }
            >
              Match Day
            </NavLink>
            <NavLink
              to="/parent-messages"
              onClick={onClose}
              className={({ isActive }) =>
                [
                  'block min-h-12 rounded-lg px-4 py-3 text-base font-semibold transition',
                  isActive
                    ? 'bg-[var(--button-primary)] text-[var(--button-primary-text)]'
                    : 'bg-[var(--panel-alt)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]',
                ].join(' ')
              }
            >
              Messages
            </NavLink>
            <NavLink
              to="/parent-polls"
              onClick={onClose}
              className={({ isActive }) =>
                [
                  'block min-h-12 rounded-lg px-4 py-3 text-base font-semibold transition',
                  isActive
                    ? 'bg-[var(--button-primary)] text-[var(--button-primary-text)]'
                    : 'bg-[var(--panel-alt)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]',
                ].join(' ')
              }
            >
              <NavItemLabel label="Polls" pollCount={openPollCount} showPollCount />
            </NavLink>
            <NavLink
              to="/friends-family"
              onClick={onClose}
              className={({ isActive }) =>
                [
                  'block min-h-12 rounded-lg px-4 py-3 text-base font-semibold transition',
                  isActive
                    ? 'bg-[var(--button-primary)] text-[var(--button-primary-text)]'
                    : 'bg-[var(--panel-alt)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]',
                ].join(' ')
              }
            >
              Friends and Family
            </NavLink>
          </nav>
          <div className="mt-auto pt-4">
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
            >
              Sign out
            </button>
          </div>
        </aside>
      </>
    )
  }

  return (
    <>
      <div
        className={[
          'fixed inset-0 z-30 bg-black/50 transition lg:hidden',
          isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        ].join(' ')}
        onClick={onClose}
      />

      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 flex w-[min(20rem,calc(100vw-1rem))] max-w-72 flex-col overflow-y-auto border-r border-[var(--border-color)] bg-[var(--sidebar-bg)] px-4 py-5 transition sm:px-5 sm:py-6 lg:fixed lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-4 flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)]">
              <img src={logoUrl} alt={clubLabel} className="h-full w-full object-contain p-1" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--text-secondary)]">Coaching Suite</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-muted)] lg:hidden"
            aria-label="Close navigation"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <nav className="mt-7 space-y-2 pb-4">
          <div className="rounded-lg border border-[var(--accent)] bg-[var(--panel-bg)] p-3">
            <p className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
              Coach Mode
            </p>
            <p className="px-2 pt-1 text-xs leading-5 text-[var(--text-muted)]">
              Session tools first.
            </p>
            <div className="mt-3 space-y-2">
              <NavLink
                to="/coach"
                data-tour-id="sidebar-coach-home"
                onClick={onClose}
                className={({ isActive }) =>
                  [
                    'block min-h-12 rounded-lg px-4 py-3 text-base font-semibold transition',
                    isActive
                      ? 'bg-[var(--button-primary)] text-[var(--button-primary-text)]'
                      : 'bg-[var(--panel-alt)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]',
                  ].join(' ')
                }
              >
                Home
              </NavLink>
              {coachNavigationItems.map((item) =>
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
                        'block min-h-12 rounded-lg px-4 py-3 text-base font-semibold transition',
                        isActive
                          ? 'bg-[var(--button-primary)] text-[var(--button-primary-text)]'
                          : 'bg-[var(--panel-alt)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]',
                      ].join(' ')
                    }
                  >
                    <NavItemLabel
                      label={item.label}
                      pollCount={openPollCount}
                      showPollCount={item.path === '/polls'}
                    />
                  </NavLink>
                ),
              )}
            </div>
          </div>

          {teamNavigationItems.length > 0 ? (
            <details className="group rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-3">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg px-2 text-sm font-semibold text-[var(--text-primary)]">
                Team tools
                <span className="text-xs text-[var(--text-muted)] group-open:hidden">Show</span>
                <span className="hidden text-xs text-[var(--text-muted)] group-open:inline">Hide</span>
              </summary>
              <div className="mt-2 space-y-2">
                {teamNavigationItems.map((item) =>
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
                          'block min-h-11 rounded-lg px-4 py-3 text-sm font-semibold transition',
                          isActive
                            ? 'bg-[var(--sidebar-active-bg)] text-[var(--text-primary)]'
                            : 'text-[var(--text-muted)] hover:bg-[var(--panel-soft)] hover:text-[var(--text-primary)]',
                        ].join(' ')
                      }
                    >
                      <NavItemLabel
                        label={item.label}
                        pollCount={openPollCount}
                        showPollCount={item.path === '/polls'}
                      />
                    </NavLink>
                  ),
                )}
              </div>
            </details>
          ) : null}
        </nav>

        {clubNavigationItems.length > 0 ? (
          <details
            className="mt-2 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-3"
            data-tour-id="sidebar-club-section"
          >
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg px-2 text-sm font-semibold text-[var(--text-primary)]">
              {clubNavigationLabel} tools
              <span className="text-xs text-[var(--text-muted)]">Admin</span>
            </summary>
            {clubNavigationItems.map((item) =>
              item.disabled ? (
                <div key={item.path} className="mt-2">
                  <DisabledNavItem item={item} />
                </div>
              ) : (
                <NavLink
                  key={item.path}
                  to={item.path}
                  data-tour-id={getSidebarTourId(item.path)}
                  onClick={onClose}
                  className={({ isActive }) =>
                    [
                      'mt-2 block min-h-11 rounded-lg px-4 py-3 text-sm font-semibold transition',
                      isActive
                        ? 'bg-[var(--sidebar-active-bg)] text-[var(--text-primary)]'
                        : 'text-[var(--text-muted)] hover:bg-[var(--panel-soft)] hover:text-[var(--text-primary)]',
                    ].join(' ')
                  }
                >
                  <NavItemLabel
                    label={item.label}
                    pollCount={openPollCount}
                    showPollCount={item.path === '/polls'}
                  />
                </NavLink>
              ),
            )}
          </details>
        ) : null}

        {isSuperAdmin(user) ? (
          <div className="mt-2 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-3">
            <p className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
              Platform tools
            </p>
            <NavLink
              to="/platform-admin"
              data-tour-id="sidebar-platform-admin"
              onClick={onClose}
              className={({ isActive }) =>
                [
                  'mt-2 block min-h-11 rounded-lg px-4 py-3 text-sm font-semibold transition',
                  isActive
                    ? 'bg-[var(--sidebar-active-bg)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--panel-soft)] hover:text-[var(--text-primary)]',
                ].join(' ')
              }
            >
              Platform Admin
            </NavLink>
            <NavLink
              to="/platform-clubs"
              data-tour-id="sidebar-platform-clubs"
              onClick={onClose}
              className={({ isActive }) =>
                [
                  'mt-2 block min-h-11 rounded-lg px-4 py-3 text-sm font-semibold transition',
                  isActive
                    ? 'bg-[var(--sidebar-active-bg)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--panel-soft)] hover:text-[var(--text-primary)]',
                ].join(' ')
              }
            >
              Club/Team Management
            </NavLink>
            <NavLink
              to="/platform-billing-options"
              data-tour-id="sidebar-platform-billing-options"
              onClick={onClose}
              className={({ isActive }) =>
                [
                  'mt-2 block min-h-11 rounded-lg px-4 py-3 text-sm font-semibold transition',
                  isActive
                    ? 'bg-[var(--sidebar-active-bg)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--panel-soft)] hover:text-[var(--text-primary)]',
                ].join(' ')
              }
            >
              Billing Options
            </NavLink>
            {canAccessPlatformFeedback ? (
              <NavLink
                to="/platform-feedback"
                data-tour-id="sidebar-platform-feedback"
                onClick={onClose}
                className={({ isActive }) =>
                  [
                    'mt-2 block min-h-11 rounded-lg px-4 py-3 text-sm font-semibold transition',
                    isActive
                      ? 'bg-[var(--sidebar-active-bg)] text-[var(--text-primary)]'
                      : 'text-[var(--text-muted)] hover:bg-[var(--panel-soft)] hover:text-[var(--text-primary)]',
                  ].join(' ')
                }
              >
                Platform Feedback
              </NavLink>
            ) : null}
          </div>
        ) : null}

        <div className="mt-auto pt-4">
          <div className="mb-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-3">
            <p className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
              Information
            </p>
            <NavLink
              to="/information"
              data-tour-id="sidebar-information"
              onClick={onClose}
              className={({ isActive }) =>
                [
                  'mt-2 block min-h-11 rounded-lg px-4 py-3 text-sm font-semibold transition',
                  isActive
                    ? 'bg-[var(--sidebar-active-bg)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--panel-soft)] hover:text-[var(--text-primary)]',
                ].join(' ')
              }
            >
              How to use
            </NavLink>
          </div>
          {!isSuperAdmin(user) && canAccessPlatformFeedback ? (
            <div className="mb-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-3">
              <p className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
                Platform feedback
              </p>
              <NavLink
                to="/platform-feedback"
                data-tour-id="sidebar-platform-feedback"
                onClick={onClose}
                className={({ isActive }) =>
                  [
                    'mt-2 block min-h-11 rounded-lg px-4 py-3 text-sm font-semibold transition',
                    isActive
                      ? 'bg-[var(--sidebar-active-bg)] text-[var(--text-primary)]'
                      : 'text-[var(--text-muted)] hover:bg-[var(--panel-soft)] hover:text-[var(--text-primary)]',
                  ].join(' ')
                }
              >
                Share feedback
              </NavLink>
            </div>
          ) : null}
          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
          >
            Sign out
          </button>
        </div>
      </aside>
    </>
  )
}

function DisabledNavItem({ item }) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title={item.disabledMessage}
      className="flex min-h-11 w-full cursor-not-allowed items-start gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-left opacity-65"
    >
      <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-secondary)]" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M7 11V8a5 5 0 0 1 10 0v3" />
        <rect x="5" y="11" width="14" height="10" rx="2" />
      </svg>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[var(--text-muted)]">{item.label}</span>
        <span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">{item.disabledMessage}</span>
      </span>
    </button>
  )
}
