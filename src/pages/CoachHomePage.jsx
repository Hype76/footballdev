import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth.js'
import {
  getAssessmentSessionPlayers,
  getAssessmentSessions,
  getEvaluations,
  getPlayers,
  readViewCache,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'
import {
  formatSessionDate,
  formatSessionType,
  getCompletedPlayerNamesFromEvaluations,
  normalizeProgressName,
} from '../lib/session-page-utils.js'

const quickActions = [
  {
    label: 'Start training',
    description: 'Open the active queue, mark attendance, and record what coaches saw.',
    path: '/sessions/start',
    primary: true,
  },
  {
    label: 'Check availability',
    description: 'Use parent replies before choosing the training group or match squad.',
    path: '/polls',
  },
  {
    label: 'Match day',
    description: 'Build the squad, capture scorers, minutes, and post-match notes.',
    path: '/match-day',
  },
  {
    label: 'Player note',
    description: 'Record one practical observation while the session is still fresh.',
    path: '/assess-player/new',
  },
]

const operatingLanes = [
  {
    label: 'Players',
    title: 'Know who is in the squad',
    body: 'Add the player, link their contacts, and keep their football record current.',
    path: '/players/current',
  },
  {
    label: 'Training',
    title: 'Run one useful session',
    body: 'Pick the group, take attendance, then record the coaching points that matter.',
    path: '/sessions/start',
  },
  {
    label: 'Parents',
    title: 'Get replies before decisions',
    body: 'Use invites, availability, and parent messages before match day changes.',
    path: '/parent-linking',
  },
  {
    label: 'Match day',
    title: 'Close the weekend properly',
    body: 'Record squad, score, minutes, scorers, and notes while the detail is fresh.',
    path: '/match-day',
  },
]

const rhythmItems = [
  {
    label: 'Monday',
    title: 'Close the weekend',
    body: 'Check match notes, attendance gaps, and players who need a coach action.',
    path: '/players/current',
  },
  {
    label: 'Midweek',
    title: 'Run training',
    body: 'Create the session, confirm the squad, and keep parent updates in one place.',
    path: '/sessions/start',
  },
  {
    label: 'Friday',
    title: 'Lock availability',
    body: 'Use polls, parent replies, and match day to confirm who can play.',
    path: '/polls',
  },
  {
    label: 'Weekend',
    title: 'Record match day',
    body: 'Record score, scorers, notes, and player of the match for the team history.',
    path: '/match-day',
  },
]

const surfaceClass = 'overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-200/70'
const sectionHeaderClass = 'border-b border-slate-200 bg-sky-50 px-5 py-5 sm:px-6'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-sky-700'
const bodyTextClass = 'text-sm font-semibold leading-6 text-slate-600'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-sky-600 px-4 py-3 text-sm font-black text-white transition hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-white'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-950 transition hover:border-sky-300 hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-white'

function getActiveSession(sessions) {
  const openSessions = sessions.filter((session) => session.status !== 'completed')

  return openSessions[0] || sessions[0] || null
}

function getRecentEvaluations(evaluations) {
  return [...evaluations]
    .sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0))
    .slice(0, 3)
}

function getEvaluationSummary(evaluation) {
  const candidates = [
    evaluation?.overallComments,
    evaluation?.comments,
    evaluation?.responses?.['Overall Comments'],
    evaluation?.responses?.overall,
    evaluation?.strengths,
  ]
  const textValue = candidates.find((value) => typeof value === 'string' && value.trim())

  if (textValue) {
    return textValue
  }

  const responseObject = candidates.find((value) => value && typeof value === 'object')
  if (responseObject) {
    return Object.values(responseObject)
      .filter((value) => typeof value === 'string' && value.trim())
      .join(' ')
      .trim() || 'No summary added yet.'
  }

  return 'No summary added yet.'
}

export function CoachHomePage() {
  const { user } = useAuth()
  const activeTeamScope = user?.activeTeamId || user?.activeTeamName || 'assigned'
  const cacheKey = user?.clubId ? `coach-home:${user.clubId}:${user.id}:${user.roleRank}:${activeTeamScope}` : ''
  const cachedValue = useMemo(() => readViewCache(cacheKey), [cacheKey])
  const [sessions, setSessions] = useState(() => cachedValue?.sessions || [])
  const [players, setPlayers] = useState(() => cachedValue?.players || [])
  const [evaluations, setEvaluations] = useState(() => cachedValue?.evaluations || [])
  const [sessionPlayers, setSessionPlayers] = useState(() => cachedValue?.sessionPlayers || [])
  const [isLoading, setIsLoading] = useState(() => sessions.length === 0 && players.length === 0)
  const [errorMessage, setErrorMessage] = useState('')
  const activeSession = useMemo(() => getActiveSession(sessions), [sessions])
  const recentEvaluations = useMemo(() => getRecentEvaluations(evaluations), [evaluations])
  const completedNames = useMemo(
    () => getCompletedPlayerNamesFromEvaluations(evaluations, activeSession, sessionPlayers),
    [activeSession, evaluations, sessionPlayers],
  )
  const completedNameSet = useMemo(() => new Set(completedNames), [completedNames])
  const unassessedPlayers = useMemo(
    () => sessionPlayers.filter((player) => !completedNameSet.has(normalizeProgressName(player.playerName))),
    [completedNameSet, sessionPlayers],
  )
  const visiblePlayers = players.length > 0 ? players : sessionPlayers
  const trialPlayerCount = visiblePlayers.filter((player) => player.section === 'Trial').length
  const squadPlayerCount = visiblePlayers.filter((player) => player.section === 'Squad').length
  const readinessItems = useMemo(() => [
    {
      label: 'Squad base',
      state: visiblePlayers.length > 0 ? 'Ready' : 'Missing',
      detail: visiblePlayers.length > 0 ? `${visiblePlayers.length} players available.` : 'Add players before sessions, match day, or parent links.',
      path: visiblePlayers.length > 0 ? '/players/current' : '/add-player',
      tone: visiblePlayers.length > 0 ? 'good' : 'risk',
    },
    {
      label: 'Session queue',
      state: activeSession ? 'Ready' : 'Missing',
      detail: activeSession ? `${sessionPlayers.length} players linked to the active session.` : 'Create the next training or match session.',
      path: '/sessions/start',
      tone: activeSession ? 'good' : 'risk',
    },
    {
      label: 'Coach records',
      state: completedNames.length > 0 ? 'Moving' : 'Empty',
      detail: completedNames.length > 0 ? `${completedNames.length} records linked to the current queue.` : 'Add the first player note from a real session.',
      path: '/assess-player/new',
      tone: completedNames.length > 0 ? 'good' : 'watch',
    },
    {
      label: 'Weekend control',
      state: 'Check',
      detail: 'Confirm availability before publishing match day details.',
      path: '/polls',
      tone: 'watch',
    },
  ], [activeSession, completedNames.length, sessionPlayers.length, visiblePlayers.length])

  useEffect(() => {
    let isMounted = true

    const loadCoachHome = async () => {
      setErrorMessage('')

      try {
        const [sessionsResult, playersResult, evaluationsResult] = await Promise.allSettled([
          withRequestTimeout(() => getAssessmentSessions({ user }), 'Could not load sessions.'),
          withRequestTimeout(() => getPlayers({ user }), 'Could not load players.'),
          withRequestTimeout(() => getEvaluations({ user }), 'Could not load development records.'),
        ])

        if (!isMounted) {
          return
        }

        const nextSessions = sessionsResult.status === 'fulfilled' ? sessionsResult.value : cachedValue?.sessions || []
        const nextPlayers = playersResult.status === 'fulfilled' ? playersResult.value : cachedValue?.players || []
        const nextEvaluations =
          evaluationsResult.status === 'fulfilled' ? evaluationsResult.value : cachedValue?.evaluations || []
        const nextActiveSession = getActiveSession(nextSessions)
        const nextSessionPlayers = nextActiveSession?.id
          ? await withRequestTimeout(
              () => getAssessmentSessionPlayers({ user, sessionId: nextActiveSession.id }),
              'Could not load session players.',
            ).catch((error) => {
              console.error(error)
              return cachedValue?.sessionPlayers || []
            })
          : []

        if (!isMounted) {
          return
        }

        setSessions(nextSessions)
        setPlayers(nextPlayers)
        setEvaluations(nextEvaluations)
        setSessionPlayers(nextSessionPlayers)
        writeViewCache(cacheKey, {
          sessions: nextSessions,
          players: nextPlayers,
          evaluations: nextEvaluations,
          sessionPlayers: nextSessionPlayers,
        })

        if ([sessionsResult, playersResult, evaluationsResult].some((result) => result.status === 'rejected')) {
          setErrorMessage('Some coach data could not be refreshed. Cached data is shown where available.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    if (user) {
      void loadCoachHome()
    }

    return () => {
      isMounted = false
    }
  }, [cacheKey, cachedValue, user])

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-200/70">
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_25rem]">
          <div>
            <div className="px-5 py-6 sm:px-6 lg:px-8">
              <p className={eyebrowClass}>Club command board</p>
              <h1 className="mt-3 max-w-5xl text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
                Start with the next football job.
              </h1>
              <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-slate-600">
                This board is built around the work that moves a club week forward: players, training, parents, and match day.
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {operatingLanes.map((lane) => (
                  <Link
                    key={lane.label}
                    to={lane.path}
                    className="group rounded-lg border border-slate-200 bg-sky-50 px-4 py-4 shadow-sm shadow-slate-200/70 transition hover:-translate-y-0.5 hover:border-sky-300 hover:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <span className="inline-flex min-h-8 items-center rounded-lg border border-sky-100 bg-white px-3 text-xs font-black uppercase tracking-[0.14em] text-sky-700">
                      {lane.label}
                    </span>
                    <span className="mt-4 block text-base font-black leading-6 text-slate-950">{lane.title}</span>
                    <span className="mt-2 block text-sm font-semibold leading-6 text-slate-600">{lane.body}</span>
                    <span className="mt-4 inline-flex min-h-9 items-center rounded-lg bg-slate-950 px-3 text-xs font-black text-white transition group-hover:bg-sky-600">
                      Open
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-5 py-5 sm:px-6 lg:px-8">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {quickActions.map((action) => (
                  <Link
                    key={action.path}
                    to={action.path}
                    className={[
                      'min-w-0 rounded-lg border px-4 py-4 shadow-sm transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-sky-500',
                      action.primary
                        ? 'border-sky-600 bg-sky-600 text-white'
                        : 'border-slate-200 bg-white text-slate-950 hover:border-sky-300 hover:bg-sky-50',
                    ].join(' ')}
                  >
                    <span className="block text-sm font-black leading-5">{action.label}</span>
                    <span className={['mt-2 block text-xs font-semibold leading-5', action.primary ? 'text-sky-50' : 'text-slate-600'].join(' ')}>
                      {action.description}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <div className="grid content-between border-t border-slate-200 bg-sky-50 p-5 sm:p-6 xl:border-l xl:border-t-0">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-600">Today rule</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-slate-950">
                Session first. Availability before match day.
              </p>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <CoachMetric label="Players" value={visiblePlayers.length} isLoading={isLoading} to="/players/current" actionLabel="Open" compact />
              <CoachMetric label="Recorded" value={completedNames.length} isLoading={isLoading} to="/assess-player/completed" actionLabel="Review" compact />
              <CoachMetric label="Waiting" value={unassessedPlayers.length} isLoading={isLoading} to="/sessions/start" actionLabel="Start" compact />
            </div>
            <p className="mt-4 text-sm font-semibold leading-6 text-slate-600">
              The board uses live workspace data where possible, then pushes staff to the next useful action.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {readinessItems.map((item) => (
          <Link
            key={item.label}
            to={item.path}
            className={[
              'rounded-lg border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70 transition hover:-translate-y-0.5 hover:border-sky-300 hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-500',
            ].join(' ')}
          >
            <span className="flex items-center justify-between gap-3">
              <span className="min-w-0 text-xs font-black uppercase tracking-[0.16em] text-slate-600">{item.label}</span>
              <span className={[
                'shrink-0 whitespace-nowrap rounded-lg border px-2 py-1 text-[11px] font-black',
                item.tone === 'good' ? 'border-sky-200 bg-sky-50 text-sky-800' : item.tone === 'risk' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-800',
              ].join(' ')}
              >
                {item.state}
              </span>
            </span>
            <span className="mt-3 block text-sm font-semibold leading-6 text-slate-600">{item.detail}</span>
          </Link>
        ))}
      </section>

      {errorMessage ? (
        <div className="rounded-lg border border-[#fedf89] bg-[#fffaeb] px-4 py-3 text-sm font-bold text-[#93370d] shadow-sm">
          {errorMessage}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <section className={surfaceClass}>
          <div className={sectionHeaderClass}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className={eyebrowClass}>Training queue</p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">
                  {activeSession?.title || activeSession?.team || (isLoading ? 'Loading session' : 'No session selected')}
                </h2>
                <p className={`mt-2 ${bodyTextClass}`}>
                  {activeSession
                    ? `${formatSessionType(activeSession.sessionType)} | ${formatSessionDate(activeSession.sessionDate)}`
                    : 'Create or open a session to start coach work.'}
                </p>
              </div>
              <Link
                to="/sessions/start"
                className={primaryButtonClass}
              >
                Open session
              </Link>
            </div>
          </div>

          <div className="px-5 py-5 sm:px-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <CoachMetric label="In queue" value={sessionPlayers.length} isLoading={isLoading} to="/sessions/start" actionLabel="Open" />
              <CoachMetric label="Recorded" value={completedNames.length} isLoading={isLoading} to="/assess-player/completed" actionLabel="Review" />
              <CoachMetric label="To record" value={unassessedPlayers.length} isLoading={isLoading} to="/sessions/start" actionLabel="Start" />
              <CoachMetric label="Trial" value={trialPlayerCount} isLoading={isLoading} to="/players/current?section=Trial" actionLabel="Review" />
              <CoachMetric label="Squad" value={squadPlayerCount} isLoading={isLoading} to="/players/current?section=Squad" actionLabel="Review" />
            </div>

            <div className="mt-5 space-y-3">
              {unassessedPlayers.slice(0, 4).map((player) => (
                <div key={player.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-sky-50 px-4 py-3 shadow-sm shadow-slate-200/70">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-slate-950">{player.playerName}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-600">{player.section} / {player.team || 'No team'}</p>
                  </div>
                  <Link
                    to="/sessions/start"
                    className="shrink-0 rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm font-black text-sky-700 transition hover:bg-sky-50 hover:text-slate-950"
                  >
                    Record
                  </Link>
                </div>
              ))}
              {!isLoading && unassessedPlayers.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-sky-50 px-4 py-5 text-sm font-bold text-slate-600">
                  No players are waiting in the current development queue.
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className={surfaceClass}>
          <div className={sectionHeaderClass}>
            <p className={eyebrowClass}>Match readiness</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Before the weekend</h2>
          </div>
          <div className="grid gap-3 px-5 py-5 sm:px-6">
            {[
              { label: 'Availability gaps', value: 'Check parent replies before naming the squad.', path: '/polls' },
              { label: 'Match day board', value: 'Scorers, minutes, notes, and player of the match.', path: '/match-day' },
              { label: 'Parent update', value: 'Send the practical details before kick off.', path: '/parent-linking' },
            ].map((action) => (
              <Link
                key={action.label}
                to={action.path}
                className="rounded-lg border border-slate-200 bg-sky-50 px-4 py-4 text-slate-950 shadow-sm shadow-slate-200/70 transition hover:-translate-y-0.5 hover:border-sky-300 hover:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <span className="block text-sm font-black">{action.label}</span>
                <span className="mt-1 block text-sm font-semibold leading-6 text-slate-600">{action.value}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {rhythmItems.map((item) => (
          <Link
            key={item.label}
            to={item.path}
            className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70 transition hover:-translate-y-0.5 hover:border-sky-300 hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <p className={eyebrowClass}>{item.label}</p>
            <h2 className="mt-3 text-lg font-black text-slate-950">{item.title}</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{item.body}</p>
          </Link>
        ))}
      </section>

      <section className={surfaceClass}>
        <div className={sectionHeaderClass}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className={eyebrowClass}>Development</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Latest player notes</h2>
            </div>
            <Link
              to="/assess-player/completed"
              className={secondaryButtonClass}
            >
              View all
            </Link>
          </div>
        </div>
        <div className="grid gap-3 px-5 py-5 sm:px-6 lg:grid-cols-3">
          {recentEvaluations.map((evaluation) => (
            <div key={evaluation.id || `${evaluation.playerName}-${evaluation.createdAt}`} className="rounded-lg border border-slate-200 bg-sky-50 p-4 shadow-sm shadow-slate-200/70">
              <p className="truncate text-sm font-black text-slate-950">{evaluation.playerName}</p>
              <p className="mt-2 text-xs font-semibold text-slate-600">{evaluation.team || user?.activeTeamName || 'Team'} / score {evaluation.averageScore ?? 'Not scored'}</p>
              <p className="mt-3 line-clamp-3 text-sm font-semibold leading-6 text-slate-600">
                {getEvaluationSummary(evaluation)}
              </p>
            </div>
          ))}
          {!isLoading && recentEvaluations.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-sky-50 px-4 py-5 text-sm font-bold text-slate-600 lg:col-span-3">
              Completed development records will appear here.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function CoachMetric({ actionLabel = 'Open', compact = false, isLoading, label, to, value }) {
  const content = (
    <>
      <span className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">{label}</span>
      <span className={['mt-2 block font-black text-slate-950', compact ? 'text-2xl' : 'text-3xl'].join(' ')}>
        {isLoading ? '...' : value}
      </span>
      {to ? (
        <span className={['inline-flex items-center justify-center rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white', compact ? 'mt-3 min-h-8' : 'mt-4 min-h-9'].join(' ')}>
          {actionLabel}
        </span>
      ) : null}
    </>
  )

  if (to) {
    return (
      <Link
        to={to}
        aria-label={`${actionLabel} ${label.toLowerCase()}`}
        className={['block rounded-lg border border-slate-200 bg-white text-left shadow-sm shadow-slate-200/70 transition hover:-translate-y-0.5 hover:border-sky-300 hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-500', compact ? 'px-3 py-3' : 'px-4 py-4'].join(' ')}
      >
        {content}
      </Link>
    )
  }

  return (
    <div className={['rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-200/70', compact ? 'px-3 py-3' : 'px-4 py-4'].join(' ')}>
      {content}
    </div>
  )
}
