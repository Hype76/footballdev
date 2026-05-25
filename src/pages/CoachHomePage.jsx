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
    label: 'Run today',
    description: 'Open the active session, mark attendance, and record useful coach notes.',
    path: '/sessions/start',
    primary: true,
  },
  {
    label: 'Check availability',
    description: 'Use parent replies before choosing the training group or match squad.',
    path: '/polls',
  },
  {
    label: 'Prepare match day',
    description: 'Build the squad, capture scorers, minutes, and post-match notes.',
    path: '/match-day',
  },
  {
    label: 'Add player note',
    description: 'Record one practical observation while the session is still fresh.',
    path: '/assess-player/new',
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

  useEffect(() => {
    let isMounted = true

    const loadCoachHome = async () => {
      setErrorMessage('')

      try {
        const [sessionsResult, playersResult, evaluationsResult] = await Promise.allSettled([
          withRequestTimeout(() => getAssessmentSessions({ user }), 'Could not load sessions.'),
          withRequestTimeout(() => getPlayers({ user }), 'Could not load players.'),
          withRequestTimeout(() => getEvaluations({ user }), 'Could not load assessments.'),
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
    <div className="space-y-6">
      <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Club command</p>
            <h1 className="mt-3 max-w-4xl text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
              Run the football week from one screen.
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              Start with the next real club action: session, availability, match day, or player development. The home screen should point staff into work, not make them hunt through menus.
            </p>
          </div>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-800">Today rule</p>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-950">
              If there is a session, open the queue first. If there is a match, confirm availability before match day.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {quickActions.map((action) => (
          <Link
            key={action.path}
            to={action.path}
            className={[
              'rounded-md border p-5 shadow-sm transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-emerald-500',
              action.primary
                ? 'border-emerald-700 bg-emerald-700 text-white'
                : 'border-slate-200 bg-white text-slate-950 hover:border-emerald-300 hover:bg-emerald-50',
            ].join(' ')}
          >
            <span className="block text-base font-black">{action.label}</span>
            <span className={['mt-2 block text-sm leading-6', action.primary ? 'text-emerald-50' : 'text-slate-600'].join(' ')}>
              {action.description}
            </span>
          </Link>
        ))}
      </section>

      {errorMessage ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900 shadow-sm">
          {errorMessage}
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Workspace state</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            These numbers decide what staff should open first.
          </p>
        </div>
        <CoachMetric label="Players" value={visiblePlayers.length} isLoading={isLoading} to="/players/current" actionLabel="Open squad" />
        <CoachMetric label="Trial list" value={trialPlayerCount} isLoading={isLoading} to="/players/current?section=Trial" actionLabel="Review" />
        <CoachMetric label="Squad list" value={squadPlayerCount} isLoading={isLoading} to="/players/current?section=Squad" actionLabel="Review" />
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-5 sm:px-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Training queue</p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">
                  {activeSession?.title || activeSession?.team || (isLoading ? 'Loading session' : 'No session selected')}
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  {activeSession
                    ? `${formatSessionType(activeSession.sessionType)} | ${formatSessionDate(activeSession.sessionDate)}`
                    : 'Create or open a session to start coach work.'}
                </p>
              </div>
              <Link
                to="/sessions/start"
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-emerald-700 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-800"
              >
                Open session
              </Link>
            </div>
          </div>

          <div className="px-5 py-5 sm:px-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <CoachMetric label="In queue" value={sessionPlayers.length} isLoading={isLoading} to="/sessions/start" actionLabel="Open" />
              <CoachMetric label="Assessed" value={completedNames.length} isLoading={isLoading} to="/assess-player/completed" actionLabel="Review" />
              <CoachMetric label="To assess" value={unassessedPlayers.length} isLoading={isLoading} to="/sessions/start" actionLabel="Start" />
            </div>

            <div className="mt-5 space-y-3">
              {unassessedPlayers.slice(0, 4).map((player) => (
                <div key={player.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-slate-950">{player.playerName}</p>
                    <p className="mt-1 text-xs text-slate-500">{player.section} | {player.team || 'No team'}</p>
                  </div>
                  <Link
                    to="/sessions/start"
                    className="shrink-0 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-black text-emerald-700 transition hover:bg-emerald-50 hover:text-slate-950"
                  >
                    Assess
                  </Link>
                </div>
              ))}
              {!isLoading && unassessedPlayers.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-bold text-slate-600">
                  No players are waiting in the current assessment queue.
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-5 sm:px-6">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Match readiness</p>
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
                className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4 text-slate-950 transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <span className="block text-sm font-black">{action.label}</span>
                <span className="mt-1 block text-sm leading-6 text-slate-600">{action.value}</span>
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
            className="rounded-md border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50"
          >
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">{item.label}</p>
            <h2 className="mt-3 text-lg font-black text-slate-950">{item.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
          </Link>
        ))}
      </section>

      <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Development</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Latest player notes</h2>
            </div>
            <Link
              to="/assess-player/completed"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-950 transition hover:border-emerald-300 hover:bg-emerald-50"
            >
              View all
            </Link>
          </div>
        </div>
        <div className="grid gap-3 px-5 py-5 sm:px-6 lg:grid-cols-3">
          {recentEvaluations.map((evaluation) => (
            <div key={evaluation.id || `${evaluation.playerName}-${evaluation.createdAt}`} className="rounded-md border border-slate-200 bg-slate-50 p-4">
              <p className="truncate text-sm font-black text-slate-950">{evaluation.playerName}</p>
              <p className="mt-2 text-xs text-slate-500">{evaluation.team || user?.activeTeamName || 'Team'} | score {evaluation.averageScore ?? 'Not scored'}</p>
              <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">
                {getEvaluationSummary(evaluation)}
              </p>
            </div>
          ))}
          {!isLoading && recentEvaluations.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-bold text-slate-600 lg:col-span-3">
              Completed assessments will appear here.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function CoachMetric({ actionLabel = 'Open', isLoading, label, to, value }) {
  const content = (
    <>
      <span className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">{label}</span>
      <span className="mt-2 block text-3xl font-black text-slate-950">{isLoading ? '...' : value}</span>
      {to ? (
        <span className="mt-4 inline-flex min-h-9 items-center justify-center rounded-md bg-slate-950 px-3 py-2 text-xs font-black text-white">
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
        className="block rounded-md border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        {content}
      </Link>
    )
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white px-4 py-4 shadow-sm">
      {content}
    </div>
  )
}
