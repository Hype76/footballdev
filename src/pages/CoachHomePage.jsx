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
    label: 'Run Training',
    description: 'Open the session queue, mark work, and capture coach notes.',
    path: '/sessions/start',
    primary: true,
  },
  {
    label: 'Check Availability',
    description: 'Use polls and parent replies to know who is available.',
    path: '/polls',
  },
  {
    label: 'Pick Squad',
    description: 'Open match day and work from the players who can attend.',
    path: '/match-day',
  },
  {
    label: 'Add Development Note',
    description: 'Record a useful player observation after training or a match.',
    path: '/assess-player/new',
  },
]

const rhythmItems = [
  {
    label: 'Monday',
    title: 'Follow up from the weekend',
    body: 'Check match notes, attendance gaps, and players who need a coach action.',
    path: '/players/current',
  },
  {
    label: 'Midweek',
    title: 'Prepare training',
    body: 'Create the session, confirm the squad, and keep parent updates in one place.',
    path: '/sessions/start',
  },
  {
    label: 'Friday',
    title: 'Lock match availability',
    body: 'Use polls, parent replies, and match day to confirm who can play.',
    path: '/polls',
  },
  {
    label: 'Weekend',
    title: 'Run match day',
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
      <section className="overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-sm shadow-slate-200/80">
        <div className="grid min-h-[24rem] xl:grid-cols-[1.35fr_0.65fr]">
          <div className="relative overflow-hidden bg-[radial-gradient(circle_at_top_right,#bbf7d0,transparent_35%),linear-gradient(135deg,#ffffff,#f0fdf4_48%,#eef6ff)] p-5 sm:p-8">
            <div className="max-w-3xl">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-emerald-700">Club command centre</p>
              <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
                Run this football week from one screen.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-700">
                Schedule the work, check availability, prepare match day, and keep parents moving without hunting through separate tools.
              </p>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:max-w-3xl">
              {quickActions.map((action) => (
                <Link
                  key={action.path}
                  to={action.path}
                  className={[
                    'rounded-2xl border px-4 py-4 transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-emerald-500',
                    action.primary
                      ? 'border-slate-950 bg-slate-950 text-white shadow-lg shadow-slate-300'
                      : 'border-white bg-white/85 text-slate-950 shadow-sm shadow-slate-200 hover:bg-white',
                  ].join(' ')}
                >
                  <span className="block text-base font-black">{action.label}</span>
                  <span className={['mt-2 block text-sm leading-6', action.primary ? 'text-slate-200' : 'text-slate-600'].join(' ')}>
                    {action.description}
                  </span>
                </Link>
              ))}
            </div>
          </div>

          <div className="grid content-start gap-3 border-t border-emerald-100 bg-white p-5 sm:grid-cols-3 xl:grid-cols-1 xl:border-l xl:border-t-0">
            <CoachMetric label="Players" value={visiblePlayers.length} isLoading={isLoading} to="/players/current" actionLabel="Open squad" />
            <CoachMetric label="Trial list" value={trialPlayerCount} isLoading={isLoading} to="/players/current?section=Trial" actionLabel="Review" />
            <CoachMetric label="Squad list" value={squadPlayerCount} isLoading={isLoading} to="/players/current?section=Squad" actionLabel="Review" />
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {rhythmItems.map((item) => (
          <Link
            key={item.label}
            to={item.path}
            className="rounded-2xl border border-[var(--border-color)] bg-white p-5 shadow-sm shadow-slate-200/80 transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
          >
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">{item.label}</p>
            <h2 className="mt-3 text-lg font-black text-slate-950">{item.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
          </Link>
        ))}
      </section>

      {errorMessage ? (
        <div className="rounded-2xl border border-[var(--border-color)] bg-white px-4 py-3 text-sm text-[var(--text-muted)] shadow-sm">
          {errorMessage}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-3xl border border-[var(--border-color)] bg-white p-5 shadow-sm shadow-slate-200/80 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700">Training queue</p>
              <h2 className="mt-2 text-2xl font-black text-slate-950">
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
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-700"
            >
              Open Session
            </Link>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <CoachMetric label="In queue" value={sessionPlayers.length} isLoading={isLoading} to="/sessions/start" actionLabel="Open" />
            <CoachMetric label="Assessed" value={completedNames.length} isLoading={isLoading} to="/assess-player/completed" actionLabel="Review" />
            <CoachMetric label="To assess" value={unassessedPlayers.length} isLoading={isLoading} to="/sessions/start" actionLabel="Start" />
          </div>

          <div className="mt-5 space-y-3">
            {unassessedPlayers.slice(0, 4).map((player) => (
              <div key={player.id} className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border-color)] bg-slate-50 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-slate-950">{player.playerName}</p>
                  <p className="mt-1 text-xs text-slate-500">{player.section} | {player.team || 'No team'}</p>
                </div>
                <Link
                  to="/sessions/start"
                  className="shrink-0 text-sm font-black text-emerald-700 hover:text-slate-950"
                >
                  Assess
                </Link>
              </div>
            ))}
            {!isLoading && unassessedPlayers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border-color)] bg-slate-50 px-4 py-5 text-sm text-slate-600">
                No players are waiting in the current assessment queue.
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-3xl border border-[var(--border-color)] bg-white p-5 shadow-sm shadow-slate-200/80 sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700">Match readiness</p>
          <div className="mt-4 grid gap-3">
            {[
              { label: 'Availability gaps', value: 'Check parent replies before naming the squad.', path: '/polls' },
              { label: 'Match day board', value: 'Scorers, minutes, notes, and player of the match.', path: '/match-day' },
              { label: 'Parent update', value: 'Send the practical details before kick off.', path: '/parent-linking' },
            ].map((action) => (
              <Link
                key={action.label}
                to={action.path}
                className="rounded-2xl border border-[var(--border-color)] bg-slate-50 px-4 py-4 text-slate-950 transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <span className="block text-sm font-black">{action.label}</span>
                <span className="mt-1 block text-sm leading-6 text-slate-600">{action.value}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-3xl border border-[var(--border-color)] bg-white p-5 shadow-sm shadow-slate-200/80 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700">Development</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">Latest player notes</h2>
          </div>
          <Link
            to="/assess-player/completed"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--border-color)] bg-slate-50 px-4 py-3 text-sm font-black text-slate-950 transition hover:border-emerald-300 hover:bg-emerald-50"
          >
            View All
          </Link>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {recentEvaluations.map((evaluation) => (
            <div key={evaluation.id || `${evaluation.playerName}-${evaluation.createdAt}`} className="rounded-2xl border border-[var(--border-color)] bg-slate-50 p-4">
              <p className="truncate text-sm font-black text-slate-950">{evaluation.playerName}</p>
              <p className="mt-2 text-xs text-slate-500">{evaluation.team || user?.activeTeamName || 'Team'} | score {evaluation.averageScore ?? 'Not scored'}</p>
              <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">
                {getEvaluationSummary(evaluation)}
              </p>
            </div>
          ))}
          {!isLoading && recentEvaluations.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border-color)] bg-slate-50 px-4 py-5 text-sm text-slate-600 lg:col-span-3">
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
        <span className="mt-4 inline-flex min-h-9 items-center justify-center rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white">
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
        className="block rounded-2xl border border-[var(--border-color)] bg-slate-50 px-4 py-4 text-left transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        {content}
      </Link>
    )
  }

  return (
    <div className="rounded-2xl border border-[var(--border-color)] bg-slate-50 px-4 py-4">
      {content}
    </div>
  )
}
