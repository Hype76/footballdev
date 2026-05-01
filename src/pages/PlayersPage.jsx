import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems, Pagination } from '../components/ui/Pagination.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canCreateEvaluation, useAuth } from '../lib/auth.js'
import {
  EVALUATION_SECTIONS,
  createCommunicationLog,
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

const PLAYER_PAGE_SIZE = 12

export function PlayersPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const viewFilter = searchParams.get('view') || 'all'
  const urlSection = searchParams.get('section') || 'All'
  const cacheKey = user ? `players-page:${user.id}:${user.clubId || 'platform'}:${user.roleRank}` : ''
  const [players, setPlayers] = useState(() => {
    const cachedPlayers = readViewCacheValue(cacheKey, 'players', [])
    return Array.isArray(cachedPlayers) ? cachedPlayers : []
  })
  const [evaluations, setEvaluations] = useState(() => {
    const cachedEvaluations = readViewCacheValue(cacheKey, 'evaluations', [])
    return Array.isArray(cachedEvaluations) ? cachedEvaluations : []
  })
  const [searchTerm, setSearchTerm] = useState('')
  const [playerPage, setPlayerPage] = useState(1)
  const [actionLoadingKey, setActionLoadingKey] = useState('')
  const [message, setMessage] = useState('')
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
        playerId: player.id,
        section: player.section,
        team: player.team,
        positions: player.positions ?? [],
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
          positions: [],
          playerId: evaluation.playerId || '',
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
          totalEvaluations: sortedEvaluations.length,
        }
      })
      .sort((left, right) => left.playerName.localeCompare(right.playerName))
  }, [evaluations, players])

  const filteredPlayers = useMemo(() => {
    const normalizedSearchTerm = searchTerm.trim().toLowerCase()

    return playerRows.filter((player) => {
      const matchesSection = urlSection === 'All' || player.section === urlSection
      const matchesView =
        viewFilter === 'evaluated'
          ? player.totalEvaluations > 0
          : viewFilter === 'scored'
            ? player.averageScore !== null
            : true
      const matchesSearch =
        !normalizedSearchTerm ||
        player.playerName.toLowerCase().includes(normalizedSearchTerm) ||
        String(player.team ?? '').toLowerCase().includes(normalizedSearchTerm) ||
        (player.positions ?? []).some((position) => position.toLowerCase().includes(normalizedSearchTerm))

      return matchesSection && matchesView && matchesSearch
    })
  }, [playerRows, searchTerm, urlSection, viewFilter])
  const paginatedPlayers = useMemo(
    () => getPaginatedItems(filteredPlayers, playerPage, PLAYER_PAGE_SIZE),
    [filteredPlayers, playerPage],
  )

  const totalEvaluations = playerRows.reduce((sum, player) => sum + player.totalEvaluations, 0)
  const averageScore = getAverageScore(evaluations)
  const evaluatedPlayerCount = playerRows.filter((player) => player.totalEvaluations > 0).length
  const scoredPlayerCount = playerRows.filter((player) => player.averageScore !== null).length
  const trialPlayerCount = playerRows.filter((player) => player.section === 'Trial').length
  const squadPlayerCount = playerRows.filter((player) => player.section === 'Squad').length

  const updateListFilter = (nextFilters = {}) => {
    const params = new URLSearchParams()
    const nextView = nextFilters.view ?? viewFilter
    const nextSection = nextFilters.section ?? urlSection

    if (nextView && nextView !== 'all') {
      params.set('view', nextView)
    }

    if (nextSection && nextSection !== 'All') {
      params.set('section', nextSection)
    }

    setSearchParams(params)
    setPlayerPage(1)
  }

  if (!canCreateEvaluation(user)) {
    return <Navigate to="/" replace />
  }

  const handlePlayerAction = async (event, player, action) => {
    event.stopPropagation()
    const playerId = player.playerId || players.find((savedPlayer) => getPlayerKey(savedPlayer.playerName) === getPlayerKey(player.playerName))?.id

    if (!playerId) {
      setErrorMessage('Open the player profile first so this action can be saved against the right player.')
      return
    }

    setActionLoadingKey(`${playerId}:${action}`)
    setErrorMessage('')
    setMessage('')

    try {
      await createCommunicationLog({
        user,
        playerId,
        channel: 'player_decision',
        action,
        metadata: {
          playerName: player.playerName,
          team: player.team,
          section: player.section,
        },
      })
      setMessage('Player action saved.')
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not save this player action.')
    } finally {
      setActionLoadingKey('')
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Players"
        title="Player history"
        description="Review every player in this workspace, then open a profile for detailed ratings and progress."
      />

      {errorMessage ? <NoticeBanner title="Player data is partly available" message={errorMessage} tone="info" /> : null}
      {message ? (
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Link
          to="/players?section=Trial"
          aria-label="View trial players"
          className="block cursor-pointer rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 text-left transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--panel-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Trial Players</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{trialPlayerCount}</p>
        </Link>
        <Link
          to="/players?section=Squad"
          aria-label="View squad players"
          className="block cursor-pointer rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 text-left transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--panel-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Squad Players</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{squadPlayerCount}</p>
        </Link>
        <Link
          to="/players?view=evaluated"
          aria-label="View players with completed evaluations"
          className="block cursor-pointer rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 text-left transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--panel-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Evaluations</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{totalEvaluations}</p>
          <p className="mt-1 text-xs font-semibold text-[var(--text-muted)]">{evaluatedPlayerCount} players</p>
        </Link>
        <Link
          to="/players?view=scored"
          aria-label="View players with scored evaluations"
          className="block cursor-pointer rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 text-left transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--panel-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Average Score</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">
            {averageScore !== null ? averageScore.toFixed(1) : '-'}
          </p>
          <p className="mt-1 text-xs font-semibold text-[var(--text-muted)]">{scoredPlayerCount} scored players</p>
        </Link>
      </div>

      <SectionCard
        title="All players"
        description="Use filters to find a player quickly, then open their profile for full history and rating trends."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <label className="block lg:col-span-2">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Search</span>
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value)
                setPlayerPage(1)
              }}
              placeholder="Search player or team"
              className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Section</span>
            <select
              value={urlSection}
              onChange={(event) => updateListFilter({ section: event.target.value })}
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
            {viewFilter === 'evaluated'
              ? 'No players with completed evaluations found.'
              : viewFilter === 'scored'
                ? 'No players with scored evaluations found.'
                : 'No players found.'}
          </div>
        ) : (
          <div className="mt-5 grid gap-3">
            {paginatedPlayers.items.map((player) => (
              <div
                key={getPlayerKey(player.playerName)}
                className="rounded-[22px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4"
              >
                <button
                  type="button"
                  onClick={() => navigate(`/player/${encodeURIComponent(player.playerName)}`)}
                  className="w-full text-left"
                >
                  <div className="grid gap-4 lg:grid-cols-6 lg:items-center">
                    <div className="lg:col-span-2">
                      <p className="text-base font-semibold text-[var(--text-primary)]">{player.playerName}</p>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">{player.team || 'No team entered'}</p>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">
                        {player.positions?.length ? player.positions.join(', ') : 'No positions entered'}
                      </p>
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
                </button>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {[
                    ['invite_back_selected', 'Invite Back'],
                    ['no_place_offered_selected', 'No Place Offered'],
                    ['offer_place_selected', 'Offer Place'],
                  ].map(([action, label]) => (
                    <button
                      key={action}
                      type="button"
                      disabled={actionLoadingKey === `${player.playerId}:${action}`}
                      onClick={(event) => void handlePlayerAction(event, player, action)}
                      className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {actionLoadingKey === `${player.playerId}:${action}` ? 'Saving...' : label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => navigate(`/player/${encodeURIComponent(player.playerName)}`)}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90"
                  >
                    Open Profile
                  </button>
                </div>
              </div>
            ))}
            <Pagination
              currentPage={playerPage}
              onPageChange={setPlayerPage}
              pageSize={PLAYER_PAGE_SIZE}
              totalItems={filteredPlayers.length}
            />
          </div>
        )}
      </SectionCard>
    </div>
  )
}
