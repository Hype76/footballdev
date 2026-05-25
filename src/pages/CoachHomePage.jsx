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
    label: 'Run session',
    description: 'Open the active queue, mark attendance, and add useful coach notes.',
    path: '/sessions/start',
    primary: true,
  },
  {
    label: 'Availability',
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
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-200/80">
        <div className="grid gap-6 px-5 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_28rem] lg:items-stretch">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Football operating room</p>
            <h1 className="mt-3 max-w-4xl text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
              Run the week from one match-ready board.
            </h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-slate-700">
              Start with the next real football action: build the squad, run the session, record the note, or confirm match day. No generic dashboard noise.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {quickActions.map((action) => (
                <Link
                  key={action.path}
                  to={action.path}
                  className={[
                    'rounded-lg border px-4 py-4 shadow-sm transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-emerald-500',
                    action.primary
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-950 hover:border-emerald-300 hover:bg-emerald-50',
                  ].join(' ')}
                >
                  <span className="block text-sm font-black">{action.label}</span>
                  <span className={['mt-2 block text-xs leading-5', action.primary ? 'text-emerald-50' : 'text-slate-600'].join(' ')}>
                    {action.description}
                  </span>
                </Link>
              ))}
            </div>
          </div>
          <div className="grid content-between rounded-lg border border-slate-200 bg-slate-50 p-5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Today rule</p>
              <p className="mt-2 text-xl font-black tracking-tight text-slate-950">
                Session first. Availability before match day.
              </p>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
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
              'rounded-lg border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-emerald-500',
              item.tone === 'good' ? 'hover:border-emerald-300 hover:bg-emerald-50' : 'hover:border-amber-300 hover:bg-amber-50',
            ].join(' ')}
          >
            <span className="flex items-center justify-between gap-3">
              <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{item.label}</span>
              <span className={[
                'rounded-md px-2 py-1 text-[11px] font-black',
                item.tone === 'good' ? 'bg-emerald-100 text-emerald-900' : item.tone === 'risk' ? 'bg-rose-100 text-rose-900' : 'bg-amber-100 text-amber-950',
              ].join(' ')}
              >
                {item.state}
              </span>
            </span>
            <span className="mt-3 block text-sm font-semibold leading-6 text-slate-700">{item.detail}</span>
          </Link>
        ))}
      </section>

      {errorMessage ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900 shadow-sm">
          {errorMessage}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-white px-5 py-5 sm:px-6">
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
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-600 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-700"
              >
                Open session
              </Link>
            </div>
          </div>

          <div className="px-5 py-5 sm:px-6">
            <div className="grid gap-3 sm:grid-cols-5">
              <CoachMetric label="In queue" value={sessionPlayers.length} isLoading={isLoading} to="/sessions/start" actionLabel="Open" />
              <CoachMetric label="Recorded" value={completedNames.length} isLoading={isLoading} to="/assess-player/completed" actionLabel="Review" />
              <CoachMetric label="To record" value={unassessedPlayers.length} isLoading={isLoading} to="/sessions/start" actionLabel="Start" />
              <CoachMetric label="Trial" value={trialPlayerCount} isLoading={isLoading} to="/players/current?section=Trial" actionLabel="Review" />
              <CoachMetric label="Squad" value={squadPlayerCount} isLoading={isLoading} to="/players/current?section=Squad" actionLabel="Review" />
            </div>

            <div className="mt-5 space-y-3">
              {unassessedPlayers.slice(0, 4).map((player) => (
                <div key={player.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-slate-950">{player.playerName}</p>
                    <p className="mt-1 text-xs text-slate-500">{player.section} / {player.team || 'No team'}</p>
                  </div>
                  <Link
                    to="/sessions/start"
                    className="shrink-0 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-black text-emerald-700 transition hover:bg-emerald-50 hover:text-slate-950"
                  >
                    Record
                  </Link>
                </div>
              ))}
              {!isLoading && unassessedPlayers.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-bold text-slate-600">
                  No players are waiting in the current development queue.
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-white px-5 py-5 sm:px-6">
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
                className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-slate-950 transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
            className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50"
          >
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">{item.label}</p>
            <h2 className="mt-3 text-lg font-black text-slate-950">{item.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
          </Link>
        ))}
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-white px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Development</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Latest player notes</h2>
            </div>
            <Link
              to="/assess-player/completed"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-950 transition hover:border-emerald-300 hover:bg-emerald-50"
            >
              View all
            </Link>
          </div>
        </div>
        <div className="grid gap-3 px-5 py-5 sm:px-6 lg:grid-cols-3">
          {recentEvaluations.map((evaluation) => (
            <div key={evaluation.id || `${evaluation.playerName}-${evaluation.createdAt}`} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="truncate text-sm font-black text-slate-950">{evaluation.playerName}</p>
              <p className="mt-2 text-xs text-slate-500">{evaluation.team || user?.activeTeamName || 'Team'} / score {evaluation.averageScore ?? 'Not scored'}</p>
              <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">
                {getEvaluationSummary(evaluation)}
              </p>
            </div>
          ))}
          {!isLoading && recentEvaluations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-bold text-slate-600 lg:col-span-3">
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
      <span className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">{label}</span>
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
        className={['block rounded-lg border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500', compact ? 'px-3 py-3' : 'px-4 py-4'].join(' ')}
      >
        {content}
      </Link>
    )
  }

  return (
    <div className={['rounded-lg border border-slate-200 bg-white shadow-sm', compact ? 'px-3 py-3' : 'px-4 py-4'].join(' ')}>
      {content}
    </div>
  )
}
