import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  canCreateEvaluation,
  canManageClubSettings,
  canManageTeamSettings,
  canManageUsers,
  isParentPortalUser,
  isSuperAdmin,
  useAuth,
} from '../../lib/auth.js'
import { getAvailableTeamsForUser, getClubUserInvites, getClubUsers, getEvaluations, getPlayers } from '../../lib/supabase.js'
import {
  CURRENT_RECOVERY_PHASE,
  isRecoveryPathVisible,
} from '../../lib/recovery-phase.js'
import {
  emitPhaseSetupGuideState,
  getPhaseSetupGuideStorageKey,
  isPhaseSetupGuideDismissed,
  isPhaseSetupGuideEnabled,
  PHASE_SETUP_GUIDE_OPEN_EVENT,
  PHASE_SETUP_GUIDE_TARGET_STORAGE_KEY,
} from '../../lib/phase-setup-guide.js'

const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#047857]'
const bodyClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-4 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] focus:outline-none focus:ring-2 focus:ring-[#93c5fd] focus:ring-offset-2'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#047857] hover:bg-[#f7faf8] focus:outline-none focus:ring-2 focus:ring-[#93c5fd] focus:ring-offset-2'

function scrollToTarget(selector) {
  const targetSelector = String(selector ?? '').trim()

  if (!targetSelector) {
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
    return false
  }

  const target = document.querySelector(targetSelector)

  if (!target) {
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
    return false
  }

  if (!target.hasAttribute('tabindex')) {
    target.setAttribute('tabindex', '-1')
  }

  target.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' })
  target.focus({ preventScroll: true })
  return true
}

function getUserGuideType(user) {
  if (isSuperAdmin(user)) {
    return 'platform'
  }

  if (canManageClubSettings(user)) {
    return 'club-admin'
  }

  if (canManageTeamSettings(user) || Number(user?.roleRank ?? 0) >= 50) {
    return 'team-admin'
  }

  return 'coach'
}

function getStatusLabel(isComplete, isReady = true) {
  if (isComplete) {
    return 'Done'
  }

  return isReady ? 'Next' : 'Ready later'
}

function buildClubAdminSteps({ canEvaluate, counts }) {
  return [
    {
      id: 'club-details',
      title: 'Confirm club details',
      body: 'Check the club name, contact details, and badge used inside the workspace.',
      href: '/club-settings',
      action: 'Open club settings',
      targetSelector: '[data-tour-id="club-profile-settings"]',
      complete: counts.clubDetailsComplete,
    },
    {
      id: 'team',
      title: 'Create first team',
      body: 'Create or confirm one team before adding players or development records.',
      href: '/teams',
      action: 'Open teams',
      targetSelector: '[data-tour-id="create-team-section"]',
      complete: counts.teamCount > 0,
    },
    {
      id: 'team-admin',
      title: 'Invite or assign team admin',
      body: 'Invite or assign a Team Admin when this club needs another person connected to the team. Pending assigned invites count, so the club can keep moving while the person accepts later.',
      href: '/user-access',
      action: 'Open staff access',
      targetSelector: '[data-tour-id="allocate-role-section"]',
      complete: counts.teamAdminCount > 0,
      optional: true,
    },
    {
      id: 'player',
      title: 'Add first player',
      body: 'Create one footballer record linked to the active team.',
      href: '/add-player',
      action: 'Add player',
      targetSelector: '[data-tour-id="add-player-form-section"]',
      complete: counts.playerCount > 0,
      ready: canEvaluate,
    },
    {
      id: 'profile',
      title: 'Open player profile',
      body: 'Use the player profile to confirm the record, team, and development history.',
      href: '/players/current',
      action: 'Open players',
      targetSelector: '[data-tour-id="players-list-section"]',
      complete: counts.playerCount > 0,
      ready: canEvaluate,
    },
    {
      id: 'assessment',
      title: 'Create first assessment',
      body: 'Save one internal development record for the player.',
      href: '/assess-player/new',
      action: 'Open assessment',
      targetSelector: '[data-tour-id="create-evaluation-form"]',
      complete: counts.evaluationCount > 0,
      ready: canEvaluate && counts.playerCount > 0,
    },
    {
      id: 'feedback',
      title: 'Send setup feedback',
      body: 'Report anything confusing from this setup path.',
      href: '/feedback/new?route=/phase-1-setup-guide',
      action: 'Report issue',
      targetSelector: '[data-tour-id="tester-feedback-form"]',
      complete: false,
    },
  ]
}

function buildTeamSteps({ canEvaluate, counts, user }) {
  const hasTeam = Boolean(user?.activeTeamId) || counts.teamCount > 0

  return [
    {
      id: 'team-context',
      title: 'Confirm assigned team',
      body: hasTeam ? 'Check that the active team is the one you should use.' : 'A club admin needs to assign a team before team setup can continue.',
      href: '/coach',
      action: 'Open workspace',
      targetSelector: '[data-tour-id="coach-active-team"]',
      complete: hasTeam,
    },
    {
      id: 'players',
      title: 'View players',
      body: 'Open the player register for the assigned team.',
      href: '/players/current',
      action: 'Open players',
      targetSelector: '[data-tour-id="players-list-section"]',
      complete: counts.playerCount > 0,
      ready: hasTeam,
    },
    {
      id: 'add-player',
      title: 'Add player if permitted',
      body: 'Add one player when this account is allowed to create player records.',
      href: '/add-player',
      action: 'Add player',
      targetSelector: '[data-tour-id="add-player-form-section"]',
      complete: counts.playerCount > 0,
      ready: hasTeam && canEvaluate,
    },
    {
      id: 'profile',
      title: 'Open player profile',
      body: 'Confirm the player record opens before creating a development record.',
      href: '/players/current',
      action: 'Open players',
      targetSelector: '[data-tour-id="players-list-section"]',
      complete: counts.playerCount > 0,
      ready: hasTeam,
    },
    {
      id: 'assessment',
      title: 'Create first assessment',
      body: 'Save one internal development record for the player.',
      href: '/assess-player/new',
      action: 'Open assessment',
      targetSelector: '[data-tour-id="create-evaluation-form"]',
      complete: counts.evaluationCount > 0,
      ready: hasTeam && canEvaluate && counts.playerCount > 0,
    },
    {
      id: 'feedback',
      title: 'Send setup feedback',
      body: 'Report anything confusing from this team workflow.',
      href: '/feedback/new?route=/phase-1-setup-guide',
      action: 'Report issue',
      targetSelector: '[data-tour-id="tester-feedback-form"]',
      complete: false,
    },
  ]
}

function buildPlatformSteps() {
  return [
    {
      id: 'platform-dashboard',
      title: 'Confirm workspace',
      body: 'Open platform admin and confirm the current workspace is correct.',
      href: '/platform-admin',
      action: 'Open platform admin',
      targetSelector: '[data-tour-id="platform-admin-overview"]',
      complete: false,
    },
    {
      id: 'phase-gates',
      title: 'Confirm Phase 1 gates',
      body: 'Phase 1 should show setup, teams, players, sessions, and development records only.',
      href: '/platform-admin',
      action: 'Review admin',
      targetSelector: '[data-tour-id="platform-admin-phase-gates"]',
      complete: false,
    },
    {
      id: 'feedback',
      title: 'Submit or review feedback',
      body: 'Use feedback to capture issues found during setup.',
      href: '/feedback/new?route=/phase-1-setup-guide',
      action: 'Report issue',
      targetSelector: '[data-tour-id="tester-feedback-form"]',
      complete: false,
    },
    {
      id: 'clubs',
      title: 'Monitor accounts and clubs',
      body: 'Use current admin tools to review clubs created by signup.',
      href: '/platform-clubs',
      action: 'Open clubs',
      targetSelector: '[data-tour-id="platform-clubs-list"]',
      complete: false,
    },
  ]
}

function getGuideTitle() {
  return 'Setup guide'
}

function isTeamAdminRole(entry) {
  return (entry.role === 'head_manager' || entry.roleKey === 'head_manager' || Number(entry.roleRank ?? 0) >= 70) && entry.role !== 'admin' && entry.roleKey !== 'admin'
}

function buildCounts({ clubUsers, evaluations, pendingInvites, players, teams, user }) {
  const activeTeamAdmins = clubUsers.filter(isTeamAdminRole).length
  const pendingAssignedTeamAdmins = pendingInvites.filter((invite) => !invite.acceptedAt && invite.teamId && isTeamAdminRole(invite)).length

  return {
    clubDetailsComplete: Boolean(user?.clubName) && Boolean(user?.clubContactEmail || user?.clubContactPhone || user?.clubLogoUrl),
    evaluationCount: evaluations.length,
    playerCount: players.length,
    teamAdminCount: activeTeamAdmins + pendingAssignedTeamAdmins,
    teamCount: teams.length,
  }
}

export function PhaseSetupGuide() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const dialogRef = useRef(null)
  const storageKey = useMemo(() => getPhaseSetupGuideStorageKey(user), [user])
  const isEnabled = isPhaseSetupGuideEnabled()
  const [isDismissed, setIsDismissed] = useState(() => isPhaseSetupGuideDismissed(user))
  const [isOpen, setIsOpen] = useState(() => isEnabled && Boolean(user) && !isParentPortalUser(user) && !isPhaseSetupGuideDismissed(user))
  const [activeStepIndex, setActiveStepIndex] = useState(0)
  const [counts, setCounts] = useState({
    clubDetailsComplete: false,
    evaluationCount: 0,
    playerCount: 0,
    teamAdminCount: 0,
    teamCount: 0,
  })
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    const dismissed = isPhaseSetupGuideDismissed(user)
    setIsDismissed(dismissed)
    setIsOpen(isEnabled && Boolean(user) && !isParentPortalUser(user) && !dismissed)
    emitPhaseSetupGuideState(isEnabled && Boolean(user) && !isParentPortalUser(user) && !dismissed)
  }, [isEnabled, storageKey, user])

  useEffect(() => {
    const handleOpen = () => {
      window.localStorage.removeItem(storageKey)
      setIsDismissed(false)
      setIsOpen(true)
      emitPhaseSetupGuideState(true)
    }

    window.addEventListener(PHASE_SETUP_GUIDE_OPEN_EVENT, handleOpen)
    return () => {
      window.removeEventListener(PHASE_SETUP_GUIDE_OPEN_EVENT, handleOpen)
    }
  }, [storageKey])

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      dialogRef.current?.focus()
    }, 50)

    return () => window.clearTimeout(timeoutId)
  }, [isOpen, activeStepIndex])

  useEffect(() => {
    const targetSelector = window.sessionStorage.getItem(PHASE_SETUP_GUIDE_TARGET_STORAGE_KEY)

    if (!targetSelector) {
      return undefined
    }

    window.sessionStorage.removeItem(PHASE_SETUP_GUIDE_TARGET_STORAGE_KEY)
    const timeoutId = window.setTimeout(() => {
      scrollToTarget(targetSelector)
    }, 220)

    return () => window.clearTimeout(timeoutId)
  }, [location.pathname])

  useEffect(() => {
    let isMounted = true

    async function loadProgress() {
      if (!user || isSuperAdmin(user) || isParentPortalUser(user)) {
        return
      }

      setIsLoading(true)

      try {
        const [teamsResult, playersResult, evaluationsResult, clubUsersResult, invitesResult] = await Promise.allSettled([
          getAvailableTeamsForUser(user),
          getPlayers({ user }),
          getEvaluations({ user }),
          canManageUsers(user) ? getClubUsers(user) : Promise.resolve([]),
          canManageUsers(user) ? getClubUserInvites(user) : Promise.resolve([]),
        ])

        if (!isMounted) {
          return
        }

        setCounts(buildCounts({
          clubUsers: clubUsersResult.status === 'fulfilled' ? clubUsersResult.value : [],
          evaluations: evaluationsResult.status === 'fulfilled' ? evaluationsResult.value : [],
          pendingInvites: invitesResult.status === 'fulfilled' ? invitesResult.value : [],
          players: playersResult.status === 'fulfilled' ? playersResult.value : [],
          teams: teamsResult.status === 'fulfilled' ? teamsResult.value : [],
          user,
        }))
      } catch (error) {
        console.error(error)
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadProgress()

    return () => {
      isMounted = false
    }
  }, [location.pathname, user])

  if (!isEnabled || !user || isParentPortalUser(user) || isDismissed) {
    return null
  }

  const type = getUserGuideType(user)
  const canEvaluate = canCreateEvaluation(user)
  const steps = type === 'platform'
    ? buildPlatformSteps()
    : type === 'club-admin'
      ? buildClubAdminSteps({ canEvaluate, counts })
      : buildTeamSteps({ canEvaluate, counts, user })
  const safeSteps = steps.filter((step) => isRecoveryPathVisible(step.href, { user }))
  const completedCount = safeSteps.filter((step) => step.complete).length
  const activeStep = safeSteps[Math.min(activeStepIndex, Math.max(safeSteps.length - 1, 0))]

  const handleDismiss = () => {
    window.localStorage.setItem(storageKey, 'true')
    setIsDismissed(true)
    setIsOpen(false)
    emitPhaseSetupGuideState(false)
  }

  const handleClose = () => {
    setIsOpen(false)
    emitPhaseSetupGuideState(true)
  }

  const handleBack = () => {
    setActiveStepIndex((current) => Math.max(current - 1, 0))
  }

  const handleNext = () => {
    setActiveStepIndex((current) => Math.min(current + 1, Math.max(safeSteps.length - 1, 0)))
  }

  const handleSkip = () => {
    handleNext()
  }

  const handleAction = (step) => {
    const targetHref = String(step?.href || '/coach').trim() || '/coach'
    const targetSelector = String(step?.targetSelector || '').trim()
    const targetUrl = new URL(targetHref, window.location.origin)
    const currentPathWithSearch = `${location.pathname}${location.search}`
    const nextPathWithSearch = `${targetUrl.pathname}${targetUrl.search}`

    if (targetSelector) {
      window.sessionStorage.setItem(PHASE_SETUP_GUIDE_TARGET_STORAGE_KEY, targetSelector)
    }

    setIsOpen(false)
    emitPhaseSetupGuideState(true)

    if (nextPathWithSearch === currentPathWithSearch) {
      window.setTimeout(() => {
        scrollToTarget(targetSelector)
      }, 120)
      return
    }

    navigate(`${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`)
  }

  if (!isOpen || !activeStep) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101828]/55 px-4 py-6 backdrop-blur-sm" data-testid="phase-setup-guide">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="phase-setup-guide-title"
        tabIndex={-1}
        className="max-h-[calc(100vh-3rem)] w-full max-w-3xl overflow-y-auto rounded-lg border border-[#d7e5dc] bg-white shadow-2xl shadow-[#101828]/25 outline-none"
      >
        <div className="border-b border-[#d7e5dc] bg-[#ecfdf5] px-5 py-5 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className={eyebrowClass}>Setup guide</p>
              <h2 id="phase-setup-guide-title" className="mt-2 text-2xl font-black tracking-tight text-[#101828] sm:text-3xl">{getGuideTitle()}</h2>
              <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-[#294238]">
                Follow these steps so the core club, team, player, parent, and feedback flow is ready for real use.
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:bg-[#f7faf8]"
              aria-label="Close setup guide"
            >
              X
            </button>
          </div>
        </div>

        <div className="grid gap-5 px-5 py-5 sm:px-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3">
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#047857]">Phase</p>
              <p className="mt-1 text-lg font-black text-[#101828]">Phase {CURRENT_RECOVERY_PHASE}</p>
            </div>
            <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3">
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#047857]">Wizard progress</p>
              <p className="mt-1 text-lg font-black text-[#101828]">Step {activeStepIndex + 1} of {safeSteps.length}</p>
            </div>
            <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3">
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#047857]">Data checks</p>
              <p className="mt-1 text-lg font-black text-[#101828]">{isLoading ? 'Checking' : `${completedCount} of ${safeSteps.length}`}</p>
            </div>
          </div>

          <article className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#047857]">
                  Step {activeStepIndex + 1}{activeStep.optional ? ' optional' : ''}
                </p>
                <h3 className="mt-2 text-2xl font-black leading-8 text-[#101828]">{activeStep.title}</h3>
              </div>
              <span className={[
                'inline-flex min-h-8 shrink-0 items-center rounded-lg border px-3 text-xs font-black',
                activeStep.complete
                  ? 'border-[#bbf7d0] bg-[#dcfce7] text-[#166534]'
                  : activeStep.ready === false
                    ? 'border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]'
                    : 'border-[#d7e5dc] bg-[#f7faf8] text-[#4b5f55]',
              ].join(' ')}>
                {getStatusLabel(activeStep.complete, activeStep.ready !== false)}
              </span>
            </div>

            <p className={`mt-4 ${bodyClass}`}>{activeStep.body}</p>

            <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <button
                type="button"
                onClick={() => handleAction(activeStep)}
                className={activeStep.ready === false ? secondaryButtonClass : primaryButtonClass}
              >
                {activeStep.action}
              </button>
              <p className="text-xs font-semibold leading-5 text-[#66756c]">
                Opens the real Phase 1 workspace area for this step.
              </p>
            </div>
          </article>

          <div className="flex flex-col gap-3 border-t border-[#d7e5dc] pt-5 lg:flex-row lg:items-center lg:justify-between">
            <p className={bodyClass}>
              Closing hides the modal for now. Dismiss turns it off for this tester, and the sidebar button can reopen it.
            </p>
            <div className="grid gap-2 sm:grid-cols-4 lg:min-w-[34rem]">
              <button type="button" onClick={handleBack} disabled={activeStepIndex === 0} className={secondaryButtonClass}>
                Back
              </button>
              {activeStep.optional ? (
                <button type="button" onClick={handleSkip} className={secondaryButtonClass}>
                  Skip optional
                </button>
              ) : (
                <button type="button" onClick={handleClose} className={secondaryButtonClass}>
                  Close
                </button>
              )}
              <button type="button" onClick={handleNext} disabled={activeStepIndex >= safeSteps.length - 1} className={secondaryButtonClass}>
                Next
              </button>
              <button type="button" onClick={handleDismiss} className={secondaryButtonClass}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
