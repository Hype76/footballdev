import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  canCreateEvaluation,
  canManageClubSettings,
  canManageTeamSettings,
  canManageUsers,
  isParentPortalUser,
  isSuperAdmin,
  useAuth,
} from '../../lib/auth.js'
import { getAvailableTeamsForUser, getClubUsers, getEvaluations, getPlayers } from '../../lib/supabase.js'
import {
  CURRENT_RECOVERY_PHASE,
  isRecoveryPathVisible,
} from '../../lib/recovery-phase.js'
import {
  getPhaseSetupGuideStorageKey,
  isPhaseSetupGuideEnabled,
  PHASE_SETUP_GUIDE_OPEN_EVENT,
} from '../../lib/phase-setup-guide.js'

const cardClass = 'mb-5 overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#047857]/10'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#047857]'
const bodyClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-4 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46]'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#047857] hover:bg-[#f7faf8]'

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
      body: 'Check the club name, contact details, and badge used inside the test workspace.',
      href: '/club-settings',
      action: 'Open club settings',
      complete: counts.clubDetailsComplete,
    },
    {
      id: 'team',
      title: 'Create first team',
      body: 'Create or confirm one team before adding players or development records.',
      href: '/teams',
      action: 'Open teams',
      complete: counts.teamCount > 0,
    },
    {
      id: 'team-admin',
      title: 'Invite or assign team admin',
      body: 'Use staff access when this club needs another person connected to the team.',
      href: '/user-access',
      action: 'Open staff access',
      complete: counts.teamAdminCount > 0,
      optional: true,
    },
    {
      id: 'player',
      title: 'Add first player',
      body: 'Create one footballer record linked to the active team.',
      href: '/add-player',
      action: 'Add player',
      complete: counts.playerCount > 0,
      ready: canEvaluate,
    },
    {
      id: 'profile',
      title: 'Open player profile',
      body: 'Use the player profile to confirm the record, team, and development history.',
      href: '/players/current',
      action: 'Open players',
      complete: counts.playerCount > 0,
      ready: canEvaluate,
    },
    {
      id: 'assessment',
      title: 'Create first assessment',
      body: 'Save one internal development record for the player.',
      href: '/assess-player/new',
      action: 'Open assessment',
      complete: counts.evaluationCount > 0,
      ready: canEvaluate && counts.playerCount > 0,
    },
    {
      id: 'feedback',
      title: 'Submit tester feedback',
      body: 'Report anything confusing from this Phase 1 setup path.',
      href: '/feedback/new?route=/phase-1-setup-guide',
      action: 'Report issue',
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
      body: hasTeam ? 'Check that the active team is the one you should test.' : 'A club admin needs to assign a team before team setup can continue.',
      href: '/coach',
      action: 'Open workspace',
      complete: hasTeam,
    },
    {
      id: 'players',
      title: 'View players',
      body: 'Open the player register for the assigned team.',
      href: '/players/current',
      action: 'Open players',
      complete: counts.playerCount > 0,
      ready: hasTeam,
    },
    {
      id: 'add-player',
      title: 'Add player if permitted',
      body: 'Add one player when this test account is allowed to create player records.',
      href: '/add-player',
      action: 'Add player',
      complete: counts.playerCount > 0,
      ready: hasTeam && canEvaluate,
    },
    {
      id: 'profile',
      title: 'Open player profile',
      body: 'Confirm the player record opens before creating a development record.',
      href: '/players/current',
      action: 'Open players',
      complete: counts.playerCount > 0,
      ready: hasTeam,
    },
    {
      id: 'assessment',
      title: 'Create first assessment',
      body: 'Save one internal development record for the player.',
      href: '/assess-player/new',
      action: 'Open assessment',
      complete: counts.evaluationCount > 0,
      ready: hasTeam && canEvaluate && counts.playerCount > 0,
    },
    {
      id: 'feedback',
      title: 'Submit tester feedback',
      body: 'Report anything confusing from this Phase 1 team workflow.',
      href: '/feedback/new?route=/phase-1-setup-guide',
      action: 'Report issue',
      complete: false,
    },
  ]
}

function buildPlatformSteps() {
  return [
    {
      id: 'platform-dashboard',
      title: 'Confirm staging environment',
      body: 'Open platform admin and confirm this is the staging test workspace.',
      href: '/platform-admin',
      action: 'Open platform admin',
      complete: false,
    },
    {
      id: 'phase-gates',
      title: 'Confirm Phase 1 gates',
      body: 'Phase 1 should show setup, teams, players, sessions, and development records only.',
      href: '/platform-admin',
      action: 'Review admin',
      complete: false,
    },
    {
      id: 'clubs',
      title: 'Monitor test clubs',
      body: 'Use current admin tools to review staging clubs created by tester signup.',
      href: '/platform-clubs',
      action: 'Open clubs',
      complete: false,
    },
    {
      id: 'feedback',
      title: 'Review or submit feedback',
      body: 'Use tester feedback to capture issues found during the Phase 1 loop.',
      href: '/feedback/new?route=/phase-1-setup-guide',
      action: 'Report issue',
      complete: false,
    },
  ]
}

function getGuideTitle(type) {
  if (type === 'platform') {
    return 'Platform admin test guide'
  }

  if (type === 'club-admin') {
    return 'Club admin setup guide'
  }

  if (type === 'team-admin') {
    return 'Team admin setup guide'
  }

  return 'Coach setup guide'
}

function buildCounts({ clubUsers, evaluations, players, teams, user }) {
  return {
    clubDetailsComplete: Boolean(user?.clubName) && Boolean(user?.clubContactEmail || user?.clubContactPhone || user?.clubLogoUrl),
    evaluationCount: evaluations.length,
    playerCount: players.length,
    teamAdminCount: clubUsers.filter((clubUser) => clubUser.role === 'head_manager' || Number(clubUser.roleRank ?? 0) >= 70 && clubUser.role !== 'admin').length,
    teamCount: teams.length,
  }
}

export function PhaseSetupGuide() {
  const { user } = useAuth()
  const location = useLocation()
  const guideRef = useRef(null)
  const storageKey = useMemo(() => getPhaseSetupGuideStorageKey(user), [user])
  const isEnabled = isPhaseSetupGuideEnabled()
  const [isDismissed, setIsDismissed] = useState(() => window.localStorage.getItem(storageKey) === 'true')
  const [counts, setCounts] = useState({
    clubDetailsComplete: false,
    evaluationCount: 0,
    playerCount: 0,
    teamAdminCount: 0,
    teamCount: 0,
  })
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    setIsDismissed(window.localStorage.getItem(storageKey) === 'true')
  }, [storageKey])

  useEffect(() => {
    const handleOpen = () => {
      window.localStorage.removeItem(storageKey)
      setIsDismissed(false)
      window.setTimeout(() => {
        guideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }

    window.addEventListener(PHASE_SETUP_GUIDE_OPEN_EVENT, handleOpen)
    return () => {
      window.removeEventListener(PHASE_SETUP_GUIDE_OPEN_EVENT, handleOpen)
    }
  }, [storageKey])

  useEffect(() => {
    let isMounted = true

    async function loadProgress() {
      if (!user || isSuperAdmin(user) || isParentPortalUser(user)) {
        return
      }

      setIsLoading(true)

      try {
        const [teamsResult, playersResult, evaluationsResult, clubUsersResult] = await Promise.allSettled([
          getAvailableTeamsForUser(user),
          getPlayers({ user }),
          getEvaluations({ user }),
          canManageUsers(user) ? getClubUsers(user) : Promise.resolve([]),
        ])

        if (!isMounted) {
          return
        }

        setCounts(buildCounts({
          clubUsers: clubUsersResult.status === 'fulfilled' ? clubUsersResult.value : [],
          evaluations: evaluationsResult.status === 'fulfilled' ? evaluationsResult.value : [],
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

  const handleDismiss = () => {
    window.localStorage.setItem(storageKey, 'true')
    setIsDismissed(true)
  }

  return (
    <section ref={guideRef} className={cardClass} data-testid="phase-setup-guide">
      <div className="border-b border-[#d7e5dc] bg-[#ecfdf5] px-5 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <p className={eyebrowClass}>Staging test guide</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828] sm:text-3xl">{getGuideTitle(type)}</h2>
            <p className="mt-3 max-w-4xl text-sm font-semibold leading-6 text-[#294238]">
              This is a simple setup guide for staging testers. It is not the final live onboarding experience. The full version will be more polished and tailored later. For now, follow these steps so we can test the core club, team, player, and feedback flow.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:min-w-[24rem]">
            <div className="rounded-lg border border-[#bbf7d0] bg-white px-4 py-3 shadow-sm shadow-[#047857]/10">
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#047857]">Phase</p>
              <p className="mt-1 text-lg font-black text-[#101828]">Phase {CURRENT_RECOVERY_PHASE}</p>
            </div>
            <div className="rounded-lg border border-[#bbf7d0] bg-white px-4 py-3 shadow-sm shadow-[#047857]/10">
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#047857]">Progress</p>
              <p className="mt-1 text-lg font-black text-[#101828]">{isLoading ? 'Checking' : `${completedCount} of ${safeSteps.length}`}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 bg-white px-5 py-5 sm:px-6 lg:px-8">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {safeSteps.map((step, index) => (
            <article key={step.id} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#047857]">
                    Step {index + 1}{step.optional ? ' optional' : ''}
                  </p>
                  <h3 className="mt-2 text-lg font-black leading-6 text-[#101828]">{step.title}</h3>
                </div>
                <span className={[
                  'inline-flex min-h-8 shrink-0 items-center rounded-lg border px-3 text-xs font-black',
                  step.complete
                    ? 'border-[#bbf7d0] bg-[#dcfce7] text-[#166534]'
                    : step.ready === false
                      ? 'border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]'
                      : 'border-[#d7e5dc] bg-white text-[#4b5f55]',
                ].join(' ')}>
                  {getStatusLabel(step.complete, step.ready !== false)}
                </span>
              </div>
              <p className={`mt-3 ${bodyClass}`}>{step.body}</p>
              <Link
                to={step.href}
                className={`mt-4 ${step.ready === false ? secondaryButtonClass : primaryButtonClass}`}
              >
                {step.action}
              </Link>
            </article>
          ))}
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-[#d7e5dc] bg-white px-4 py-4 shadow-sm shadow-[#047857]/10 sm:flex-row sm:items-center sm:justify-between">
          <p className={bodyClass}>
            This guide does not create data by itself. Each button opens the current safe Phase 1 surface so testers can complete one real action.
          </p>
          <button type="button" onClick={handleDismiss} className={secondaryButtonClass}>
            Dismiss guide
          </button>
        </div>
      </div>
    </section>
  )
}
