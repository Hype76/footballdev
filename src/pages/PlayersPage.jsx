import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems } from '../components/ui/pagination-utils.js'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { ArchivePlayerModal } from '../components/players/ArchivePlayerModal.jsx'
import { PlayersListSection } from '../components/players/PlayersListSection.jsx'
import { PlayerStatsCards } from '../components/players/PlayerStatsCards.jsx'
import { canCreateEvaluation, useAuth } from '../lib/auth.js'
import { PLAYER_PAGE_SIZE, getAverageScore, getPlayerKey } from '../hooks/players/playersPageUtils.js'
import {
  archivePlayer,
  createCommunicationLog,
  getEvaluations,
  getPlayerDecisionLogs,
  getPlayers,
  readViewCache,
  readViewCacheValue,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

export function PlayersPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
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
  const [decisionLogs, setDecisionLogs] = useState(() => {
    const cachedDecisionLogs = readViewCacheValue(cacheKey, 'decisionLogs', [])
    return Array.isArray(cachedDecisionLogs) ? cachedDecisionLogs : []
  })
  const [searchTerm, setSearchTerm] = useState('')
  const [playerPage, setPlayerPage] = useState(1)
  const [actionLoadingKey, setActionLoadingKey] = useState('')
  const [archiveTarget, setArchiveTarget] = useState(null)
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(() => players.length === 0 && evaluations.length === 0 && decisionLogs.length === 0)
  const [errorMessage, setErrorMessage] = useState('')
  const userScopeKey = user ? `${user.id}:${user.clubId || ''}:${user.role}:${user.roleRank}` : ''

  useEffect(() => {
    let isMounted = true
    const cachedValue = readViewCache(cacheKey)

    const loadData = async () => {
      setErrorMessage('')

      try {
        const [playersResult, evaluationsResult, decisionLogsResult] = await Promise.allSettled([
          withRequestTimeout(() => getPlayers({ user }), 'Could not load players.'),
          withRequestTimeout(() => getEvaluations({ user }), 'Could not load player history.'),
          withRequestTimeout(() => getPlayerDecisionLogs({ user }), 'Could not load player actions.'),
        ])

        if (!isMounted) {
          return
        }

        const nextPlayers = playersResult.status === 'fulfilled' ? playersResult.value : cachedValue?.players || []
        const nextEvaluations =
          evaluationsResult.status === 'fulfilled' ? evaluationsResult.value : cachedValue?.evaluations || []
        const nextDecisionLogs =
          decisionLogsResult.status === 'fulfilled' ? decisionLogsResult.value : cachedValue?.decisionLogs || []

        if (playersResult.status === 'rejected') {
          console.error(playersResult.reason)
        }

        if (evaluationsResult.status === 'rejected') {
          console.error(evaluationsResult.reason)
        }

        if (decisionLogsResult.status === 'rejected') {
          console.error(decisionLogsResult.reason)
        }

        setPlayers(nextPlayers)
        setEvaluations(nextEvaluations)
        setDecisionLogs(nextDecisionLogs)
        writeViewCache(cacheKey, {
          players: nextPlayers,
          evaluations: nextEvaluations,
          decisionLogs: nextDecisionLogs,
        })

        if (playersResult.status === 'rejected' || evaluationsResult.status === 'rejected' || decisionLogsResult.status === 'rejected') {
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

  const playerDecisionActions = useMemo(() => {
    const actionsByPlayerId = new Map()

    decisionLogs.forEach((log) => {
      const playerId = String(log.playerId ?? '').trim()

      if (!playerId) {
        return
      }

      if (!actionsByPlayerId.has(playerId)) {
        actionsByPlayerId.set(playerId, new Set())
      }

      actionsByPlayerId.get(playerId).add(log.action)
    })

    return actionsByPlayerId
  }, [decisionLogs])

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
      showToast({ title: 'Player action saved', message: `${player.playerName} action has been saved.` })
      if (playerId) {
        setDecisionLogs((current) => [
          {
            id: `${playerId}:${action}:${Date.now()}`,
            playerId,
            action,
            channel: 'player_decision',
            metadata: {
              playerName: player.playerName,
              team: player.team,
              section: player.section,
            },
          },
          ...current,
        ])
      }
    } catch (error) {
      console.error(error)
      setErrorMessage('Could not save this player action.')
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
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Players"
        title="Player history"
        description="Review every player in this workspace, then open a profile for detailed ratings and progress."
      />

      {errorMessage ? <NoticeBanner title="Player data is partly available" message={errorMessage} tone="info" /> : null}
      {message ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
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
        onOpenPlayer={(player) => navigate(`/player/${encodeURIComponent(player.playerName)}`)}
        onPageChange={setPlayerPage}
        onPlayerAction={handlePlayerAction}
        onSearchChange={(nextSearchTerm) => {
          setSearchTerm(nextSearchTerm)
          setPlayerPage(1)
        }}
        pageSize={PLAYER_PAGE_SIZE}
        paginatedPlayers={paginatedPlayers}
        playerDecisionActions={playerDecisionActions}
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
