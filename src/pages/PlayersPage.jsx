import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems } from '../components/ui/pagination-utils.js'
import { useToast } from '../components/ui/toast-context.js'
import { ArchivePlayerModal } from '../components/players/ArchivePlayerModal.jsx'
import { PlayersListSection } from '../components/players/PlayersListSection.jsx'
import { PlayerStatsCards } from '../components/players/PlayerStatsCards.jsx'
import { canCreateEvaluation, useAuth } from '../lib/auth.js'
import {
  PLAYER_PAGE_SIZE,
  buildPlayerProfilePath,
  getAverageScore,
  getPlayerKey,
} from '../hooks/players/playersPageUtils.js'
import {
  EVALUATION_SECTIONS,
  archivePlayer,
  getEvaluations,
  getPlayers,
  movePlayerToTrial,
  readViewCache,
  readViewCacheValue,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

const playerRegisterRules = [
  {
    label: 'Search first',
    body: 'Avoid duplicate players. Parent contacts, team links, notes, and history should stay attached to one record.',
  },
  {
    label: 'Section matters',
    body: 'Trial and Squad control where the player appears in sessions, parent invites, and match day.',
  },
  {
    label: 'Open before changing',
    body: 'Use the profile when the decision needs context. Archive moves and section changes should follow the full history.',
  },
]

export function PlayersPage({
  defaultView = 'all',
  headerDescription = 'Use one football register for squad status, parent contacts, team assignment, and development history. Search first, then open the profile before making decisions.',
  headerEyebrow = 'Player register',
  headerTitle = 'Keep player records clear before adding sessions, notes, or match activity.',
}) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedViewFilter = searchParams.get('view') || defaultView
  const requestedSection = searchParams.get('section') || 'All'
  const isValidViewFilter = ['all', 'evaluated', 'scored'].includes(requestedViewFilter)
  const isValidSectionFilter = requestedSection === 'All' || EVALUATION_SECTIONS.includes(requestedSection)
  const viewFilter = isValidViewFilter ? requestedViewFilter : defaultView
  const urlSection = isValidSectionFilter ? requestedSection : 'All'
  const activeTeamScope = user?.activeTeamId || user?.activeTeamName || 'all'
  const cacheKey = user ? `players-page:${user.id}:${user.clubId || 'platform'}:${user.roleRank}:${activeTeamScope}` : ''
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
  const [archiveTarget, setArchiveTarget] = useState(null)
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(() => players.length === 0 && evaluations.length === 0)
  const [errorMessage, setErrorMessage] = useState('')
  const userScopeKey = user ? `${user.id}:${user.clubId || ''}:${user.role}:${user.roleRank}:${activeTeamScope}` : ''

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
        status: player.status,
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
          status: 'active',
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
  const evaluatedPlayerCount = playerRows.filter((player) => player.totalEvaluations > 0).length
  const trialPlayerCount = playerRows.filter((player) => player.section === 'Trial').length
  const squadPlayerCount = playerRows.filter((player) => player.section === 'Squad').length
  const playersWithoutRecords = Math.max(0, playerRows.length - evaluatedPlayerCount)

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

  const clearInvalidFilters = () => {
    setSearchParams({})
    setPlayerPage(1)
  }

  if (!canCreateEvaluation(user)) {
    return <Navigate to="/" replace />
  }

  const handleMovePlayerToTrial = async (event, player) => {
    event.stopPropagation()
    const playerId = player.playerId || players.find((savedPlayer) => getPlayerKey(savedPlayer.playerName) === getPlayerKey(player.playerName))?.id

    if (!playerId) {
      setErrorMessage('Open the player profile first so this player can be moved.')
      return
    }

    setActionLoadingKey(`${playerId}:move-to-trial`)
    setErrorMessage('')
    setMessage('')

    try {
      const movedPlayer = await movePlayerToTrial({
        user,
        playerId,
      })
      const nextPlayers = players.map((savedPlayer) => (savedPlayer.id === playerId ? movedPlayer : savedPlayer))
      setPlayers(nextPlayers)
      writeViewCache(cacheKey, {
        players: nextPlayers,
        evaluations,
      })
      setMessage(`${movedPlayer.playerName} was moved to Trial players.`)
      showToast({ title: 'Player moved', message: `${movedPlayer.playerName} was moved to Trial players.` })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not move this player to Trial.')
    } finally {
      setActionLoadingKey('')
    }
  }

  const handleArchivePlayer = (event, player) => {
    event.stopPropagation()

    if (!player.playerId) {
      setErrorMessage('Open the player profile first so this player can be archived correctly.')
      return
    }

    setArchiveTarget(player)
  }

  const confirmArchivePlayer = async (reason) => {
    if (!archiveTarget?.playerId) {
      return
    }

    setActionLoadingKey(`${archiveTarget.playerId}:archive`)
    setErrorMessage('')
    setMessage('')

    try {
      await archivePlayer({
        user,
        playerId: archiveTarget.playerId,
        reason,
      })
      setPlayers((current) => current.filter((player) => player.id !== archiveTarget.playerId))
      setMessage(`${archiveTarget.playerName} was moved to archived players.`)
      showToast({ title: 'Player archived', message: `${archiveTarget.playerName} was moved to archived players.` })
      setArchiveTarget(null)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not archive this player.')
    } finally {
      setActionLoadingKey('')
    }
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#101828]/5">
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_25rem]">
          <div>
            <div className="px-5 py-6 sm:px-6 lg:px-8">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">{headerEyebrow}</p>
              <h1 className="mt-3 max-w-5xl text-3xl font-black leading-[1.02] tracking-tight text-[#101828] sm:text-4xl">{headerTitle}</h1>
              <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#4b5f55]">{headerDescription}</p>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {playerRegisterRules.map((item) => (
                  <article key={item.label} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#101828]/5">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-[#065f46]">{item.label}</p>
                    <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">{item.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
          <div className="grid content-between border-t border-[#bbf7d0] bg-[#ecfdf5] p-5 sm:p-6 xl:border-l xl:border-t-0">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#065f46]">Register state</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-[#101828]">
                {playerRows.length} players tracked
              </p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
                {filteredPlayers.length} match the current search and filters.
              </p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <PlayerMetric label="Trial" value={trialPlayerCount} isLoading={isLoading} />
              <PlayerMetric label="Squad" value={squadPlayerCount} isLoading={isLoading} />
              <PlayerMetric label="Records" value={totalEvaluations} isLoading={isLoading} />
              <PlayerMetric label="No record" value={playersWithoutRecords} isLoading={isLoading} />
            </div>
            <p className="mt-4 text-sm font-semibold leading-6 text-[#4b5f55]">
              Add players once, then let sessions, notes, parent links, and match activity use the same record.
            </p>
          </div>
        </div>
      </section>

      {errorMessage ? <NoticeBanner title="Player data is partly available" message={errorMessage} tone="info" /> : null}
      {!isValidViewFilter || !isValidSectionFilter ? (
        <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-4 text-sm font-semibold text-[#101828] shadow-sm shadow-[#101828]/5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-bold">Player filters were reset</p>
              <p className="mt-1 leading-6 text-[#4b5f55]">
                The link used an unknown filter, so the full player list is shown instead.
              </p>
            </div>
            <button
              type="button"
              onClick={clearInvalidFilters}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-bold text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5]"
            >
              Clear filters
            </button>
          </div>
        </div>
      ) : null}
      {message ? (
        <div className="rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] px-4 py-3 text-sm font-bold text-[#047857]">
          {message}
        </div>
      ) : null}

      <PlayerStatsCards
        evaluatedPlayerCount={evaluatedPlayerCount}
        squadPlayerCount={squadPlayerCount}
        totalEvaluations={totalEvaluations}
        trialPlayerCount={trialPlayerCount}
      />

      <PlayersListSection
        actionLoadingKey={actionLoadingKey}
        filteredPlayers={filteredPlayers}
        isLoading={isLoading}
        onArchivePlayer={handleArchivePlayer}
        onFilterChange={updateListFilter}
        onMovePlayerToTrial={handleMovePlayerToTrial}
        onOpenPlayer={(player) => navigate(buildPlayerProfilePath(player))}
        onPageChange={setPlayerPage}
        onSearchChange={(nextSearchTerm) => {
          setSearchTerm(nextSearchTerm)
          setPlayerPage(1)
        }}
        pageSize={PLAYER_PAGE_SIZE}
        paginatedPlayers={paginatedPlayers}
        playerPage={playerPage}
        searchTerm={searchTerm}
        urlSection={urlSection}
        viewFilter={viewFilter}
      />

      <ArchivePlayerModal
        isOpen={Boolean(archiveTarget)}
        isBusy={actionLoadingKey.endsWith(':archive')}
        player={archiveTarget}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={(reason) => void confirmArchivePlayer(reason)}
      />
    </div>
  )
}

function PlayerMetric({ isLoading, label, value }) {
  return (
    <div className="rounded-lg border border-[#bbf7d0] bg-white px-3 py-3 shadow-sm shadow-[#065f46]/10">
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#065f46]">{label}</p>
      <p className="mt-2 text-2xl font-black text-[#101828]">{isLoading ? '...' : value}</p>
    </div>
  )
}
