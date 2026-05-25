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
      return {
        ...item,
        disabled: true,
        disabledMessage: createFeatureUpgradeMessage('auditLogs'),
      }
    }

    if (item.path === '/form-builder' && !hasPlanFeature(displayUser, 'customFormFields')) {
      return {
        ...item,
        disabled: true,
        disabledMessage: createFeatureUpgradeMessage('customFormFields'),
      }
    }

    if (item.path === '/parent-email-templates' && !hasPlanFeature(displayUser, 'parentEmail')) {
      return {
        ...item,
        disabled: true,
        disabledMessage: createFeatureUpgradeMessage('parentEmail'),
      }
    }

    if (item.path === '/email-queue' && !hasPlanFeature(displayUser, 'parentEmail')) {
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
  const clubNavigationLabel = canManageClubSettings(displayUser) ? 'Club' : 'Management'
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
          'fixed inset-y-0 left-0 z-40 flex w-[min(21rem,calc(100vw-1rem))] max-w-80 flex-col overflow-y-auto border-r border-[var(--border-color)] bg-[var(--sidebar-bg)] px-4 py-5 shadow-2xl shadow-slate-200/70 transition sm:px-5 sm:py-6 lg:fixed lg:translate-x-0 lg:shadow-none',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-4 flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] shadow-sm shadow-slate-200">
              <img src={logoUrl} alt={clubLabel} className="h-full w-full object-contain p-1" />
            </div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-[var(--text-secondary)]">Club OS</p>
            <h2 className="mt-2 truncate text-lg font-black tracking-tight text-[var(--text-primary)]">{clubLabel}</h2>
            <p className="mt-1 text-xs font-semibold text-[var(--text-muted)]">Football operations workspace</p>
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

        <nav className="mt-7 space-y-3 pb-4">
          <div className="rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white p-3 shadow-sm shadow-emerald-100">
            <p className="px-2 text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
              This week
            </p>
            <p className="px-2 pt-1 text-xs leading-5 text-slate-600">
              Schedule, squads, parents, match day.
            </p>
            <div className="mt-3 grid gap-2">
              <NavLink
                to="/coach"
                data-tour-id="sidebar-coach-home"
                onClick={onClose}
                className={({ isActive }) =>
                  [
                    'block min-h-12 rounded-xl px-4 py-3 text-base font-black transition',
                    isActive
                      ? 'bg-slate-950 text-white shadow-sm'
                      : 'bg-white text-slate-900 shadow-sm shadow-slate-100 hover:bg-emerald-50',
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
                        'block min-h-12 rounded-xl px-4 py-3 text-base font-black transition',
                        isActive
                          ? 'bg-slate-950 text-white shadow-sm'
                          : 'bg-white text-slate-900 shadow-sm shadow-slate-100 hover:bg-emerald-50',
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
            <details className="group rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] p-3 shadow-sm shadow-slate-200/70">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-xl px-2 text-sm font-black text-[var(--text-primary)]">
              Player and team tools
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
                          'block min-h-11 rounded-xl px-4 py-3 text-sm font-bold transition',
                          isActive
                            ? 'bg-[var(--sidebar-active-bg)] text-emerald-950'
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
            className="mt-2 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] p-3 shadow-sm shadow-slate-200/70"
            data-tour-id="sidebar-club-section"
          >
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-xl px-2 text-sm font-black text-[var(--text-primary)]">
              {clubNavigationLabel} control
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
                      'mt-2 block min-h-11 rounded-xl px-4 py-3 text-sm font-bold transition',
                      isActive
                        ? 'bg-[var(--sidebar-active-bg)] text-emerald-950'
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

        {isSuperAdmin(displayUser) ? (
          <div className="mt-2 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-3">
            <p className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
              Platform control
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
          <div className="mb-3 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] p-3 shadow-sm shadow-slate-200/70">
            <p className="px-2 text-xs font-black uppercase tracking-[0.18em] text-[var(--text-secondary)]">
              Information
            </p>
            <NavLink
              to="/information"
              data-tour-id="sidebar-information"
              onClick={onClose}
              className={({ isActive }) =>
                  [
                  'mt-2 block min-h-11 rounded-xl px-4 py-3 text-sm font-bold transition',
                  isActive
                    ? 'bg-[var(--sidebar-active-bg)] text-emerald-950'
                    : 'text-[var(--text-muted)] hover:bg-[var(--panel-soft)] hover:text-[var(--text-primary)]',
                ].join(' ')
              }
            >
              How to use
            </NavLink>
          </div>
          {!isSuperAdmin(displayUser) && canAccessPlatformFeedback ? (
            <div className="mb-3 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] p-3 shadow-sm shadow-slate-200/70">
              <p className="px-2 text-xs font-black uppercase tracking-[0.18em] text-[var(--text-secondary)]">
                Platform feedback
              </p>
              <NavLink
                to="/platform-feedback"
                data-tour-id="sidebar-platform-feedback"
                onClick={onClose}
                className={({ isActive }) =>
                  [
                    'mt-2 block min-h-11 rounded-xl px-4 py-3 text-sm font-bold transition',
                    isActive
                      ? 'bg-[var(--sidebar-active-bg)] text-emerald-950'
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
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-bold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
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
