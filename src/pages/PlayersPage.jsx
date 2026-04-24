import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canCreateEvaluation, useAuth } from '../lib/auth.js'
import {
  EVALUATION_SECTIONS,
  getEvaluations,
  getPlayers,
  readViewCache,
  readViewCacheValue,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

function getPlayerKey(playerName) {
  return String(playerName ?? '').trim().toLowerCase()
}

function getAverageScore(evaluations) {
  const scoredEvaluations = evaluations.filter((evaluation) => evaluation.averageScore !== null)

  if (scoredEvaluations.length === 0) {
    return null
  }

  return scoredEvaluations.reduce((sum, evaluation) => sum + evaluation.averageScore, 0) / scoredEvaluations.length
}

function formatDate(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return 'No date entered'
  }

  const parsedDate = new Date(normalizedValue)
  return Number.isNaN(parsedDate.getTime()) ? normalizedValue : parsedDate.toLocaleDateString()
}

export function PlayersPage() {
  const { user } = useAuth()
  const cacheKey = user ? `players-page:${user.id}:${user.clubId || 'platform'}:${user.roleRank}` : ''
  const [players, setPlayers] = useState(() => {
    const cachedPlayers = readViewCacheValue(cacheKey, 'players', [])
    return Array.isArray(cachedPlayers) ? cachedPlayers : []
  })
  const [evaluations, setEvaluations] = useState(() => {
    const cachedEvaluations = readViewCacheValue(cacheKey, 'evaluations', [])
    return Array.isArray(cachedEvaluations) ? cachedEvaluations : []
  })
  const [selectedSection, setSelectedSection] = useState('All')
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoading, setIsLoading] = useState(() => players.length === 0 && evaluations.length === 0)
  const [errorMessage, setErrorMessage] = useState('')
  const userScopeKey = user ? `${user.id}:${user.clubId || ''}:${user.role}:${user.roleRank}` : ''

  useEffect(() => {
    let isMounted = true
    const cachedValue = readViewCache(cacheKey)

    const loadData = async () => {
      setErrorMessage('')

      try {
        const [playersResult, evaluationsResult] = await Promise.allSettled([
          withRequestTimeout(() => getPlayers({ user }), 'Could not load players.'),
          withRequestTimeout(() => getEvaluations({ user }), 'Could not load player history.'),
        ])

        if (!isMounted) {
          return
        }

        const nextPlayers = playersResult.status === 'fulfilled' ? playersResult.value : cachedValue?.players || []
        const nextEvaluations =
          evaluationsResult.status === 'fulfilled' ? evaluationsResult.value : cachedValue?.evaluations || []

        if (playersResult.status === 'rejected') {
          console.error(playersResult.reason)
        }

        if (evaluationsResult.status === 'rejected') {
          console.error(evaluationsResult.reason)
        }

        setPlayers(nextPlayers)
        setEvaluations(nextEvaluations)
        writeViewCache(cacheKey, {
          players: nextPlayers,
          evaluations: nextEvaluations,
        })

        if (playersResult.status === 'rejected' || evaluationsResult.status === 'rejected') {
          setErrorMessage('Some player data could not be refreshed. Existing data is still available where possible.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    if (user) {
      void loadData()
    }

    return () => {
      isMounted = false
    }
  }, [cacheKey, user, userScopeKey])

  const playerRows = useMemo(() => {
    const playersByName = new Map()

    players.forEach((player) => {
      const key = getPlayerKey(player.playerName)

      if (!key) {
        return
      }

      playersByName.set(key, {
        playerName: player.playerName,
        section: player.section,
        team: player.team,
        parentName: player.parentName,
        parentEmail: player.parentEmail,
        evaluations: [],
      })
    })

    evaluations.forEach((evaluation) => {
      const key = getPlayerKey(evaluation.playerName)

      if (!key) {
        return
      }

      if (!playersByName.has(key)) {
        playersByName.set(key, {
          playerName: evaluation.playerName,
          section: evaluation.section,
          team: evaluation.team,
          parentName: evaluation.parentName,
          parentEmail: evaluation.parentEmail,
          evaluations: [],
        })
      }

      playersByName.get(key).evaluations.push(evaluation)
    })

    return Array.from(playersByName.values())
      .map((player) => {
        const sortedEvaluations = [...player.evaluations].sort((left, right) => right.createdAt - left.createdAt)
        const averageScore = getAverageScore(sortedEvaluations)
        const latestEvaluation = sortedEvaluations[0]

        return {
          ...player,
          evaluations: sortedEvaluations,
          averageScore,
          latestScore: latestEvaluation?.averageScore ?? null,
          latestDate: latestEvaluation?.createdAt ? new Date(latestEvaluation.createdAt).toISOString() : '',
          latestDecision: latestEvaluation?.decision || 'No decision',
          totalEvaluations: sortedEvaluations.length,
        }
      })
      .sort((left, right) => left.playerName.localeCompare(right.playerName))
  }, [evaluations, players])

  const filteredPlayers = useMemo(() => {
    const normalizedSearchTerm = searchTerm.trim().toLowerCase()

    return playerRows.filter((player) => {
      const matchesSection = selectedSection === 'All' || player.section === selectedSection
      const matchesSearch =
        !normalizedSearchTerm ||
        player.playerName.toLowerCase().includes(normalizedSearchTerm) ||
        String(player.team ?? '').toLowerCase().includes(normalizedSearchTerm)

      return matchesSection && matchesSearch
    })
  }, [playerRows, searchTerm, selectedSection])

  const totalEvaluations = playerRows.reduce((sum, player) => sum + player.totalEvaluations, 0)
  const averageScore = getAverageScore(evaluations)

  if (!canCreateEvaluation(user)) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Players"
        title="Player history"
        description="Review every player in this workspace, then open a profile for detailed ratings and progress."
      />

      {errorMessage ? <NoticeBanner title="Player data is partly available" message={errorMessage} tone="info" /> : null}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Players</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{playerRows.length}</p>
        </div>
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Evaluations</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{totalEvaluations}</p>
        </div>
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Trial</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">
            {playerRows.filter((player) => player.section === 'Trial').length}
          </p>
        </div>
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Average Score</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">
            {averageScore !== null ? averageScore.toFixed(1) : '-'}
          </p>
        </div>
      </div>

      <SectionCard
        title="All players"
        description="Use filters to find a player quickly, then open their profile for full history and rating trends."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <label className="block md:col-span-2">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Search</span>
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search player or team"
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Section</span>
            <select
              value={selectedSection}
              onChange={(event) => setSelectedSection(event.target.value)}
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            >
              <option value="All">All</option>
              {EVALUATION_SECTIONS.map((section) => (
                <option key={section} value={section}>
                  {section}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isLoading ? (
          <div className="mt-5 rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            Loading players...
          </div>
        ) : filteredPlayers.length === 0 ? (
          <div className="mt-5 rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            No players found.
          </div>
        ) : (
          <div className="mt-5 grid gap-3">
            {filteredPlayers.map((player) => (
              <Link
                key={getPlayerKey(player.playerName)}
                to={`/player/${encodeURIComponent(player.playerName)}`}
                className="rounded-[22px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 transition hover:bg-[var(--panel-soft)]"
              >
                <div className="grid gap-4 md:grid-cols-6 md:items-center">
                  <div className="md:col-span-2">
                    <p className="text-base font-semibold text-[var(--text-primary)]">{player.playerName}</p>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">{player.team || 'No team entered'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Section</p>
                    <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{player.section}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Last Score</p>
                    <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
                      {player.latestScore !== null ? player.latestScore.toFixed(1) : '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Average</p>
                    <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
                      {player.averageScore !== null ? player.averageScore.toFixed(1) : '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Last Seen</p>
                    <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{formatDate(player.latestDate)}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
