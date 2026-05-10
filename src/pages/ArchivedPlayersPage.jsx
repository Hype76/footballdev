import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { ArchivedPlayersSection } from '../components/players/ArchivedPlayersSection.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { getPaginatedItems } from '../components/ui/pagination-utils.js'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { canCreateEvaluation, useAuth, verifyCurrentUserPassword } from '../lib/auth.js'
import { ARCHIVED_PLAYER_PAGE_SIZE } from '../hooks/players/playersPageUtils.js'
import {
  deleteArchivedPlayers,
  getPlayers,
  readViewCache,
  readViewCacheValue,
  restorePlayer,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

export function ArchivedPlayersPage() {
  const { user } = useAuth()
  const cacheKey = user ? `archived-players:${user.id}:${user.clubId || 'platform'}:${user.roleRank}` : ''
  const [players, setPlayers] = useState(() => {
    const cachedPlayers = readViewCacheValue(cacheKey, 'players', [])
    return Array.isArray(cachedPlayers) ? cachedPlayers : []
  })
  const [searchTerm, setSearchTerm] = useState('')
  const [playerPage, setPlayerPage] = useState(1)
  const [isLoading, setIsLoading] = useState(() => players.length === 0)
  const [isRestoringId, setIsRestoringId] = useState('')
  const [selectedPlayerIds, setSelectedPlayerIds] = useState([])
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const userScopeKey = user ? `${user.id}:${user.clubId || ''}:${user.role}:${user.roleRank}` : ''

  useEffect(() => {
    let isMounted = true
    const cachedValue = readViewCache(cacheKey)

    const loadPlayers = async () => {
      setErrorMessage('')

      try {
        const nextPlayers = await withRequestTimeout(
          () => getPlayers({ user, status: 'archived', includeArchived: true }),
          'Could not load archived players.',
        )

        if (!isMounted) {
          return
        }

        setPlayers(nextPlayers)
        writeViewCache(cacheKey, { players: nextPlayers })
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setPlayers(cachedValue?.players || [])
          setErrorMessage('Archived players could not be refreshed. Existing data is still available where possible.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    if (user) {
      void loadPlayers()
    }

    return () => {
      isMounted = false
    }
  }, [cacheKey, user, userScopeKey])

  const filteredPlayers = useMemo(() => {
    const normalizedSearchTerm = searchTerm.trim().toLowerCase()

    if (!normalizedSearchTerm) {
      return players
    }

    return players.filter(
      (player) =>
        player.playerName.toLowerCase().includes(normalizedSearchTerm) ||
        String(player.team ?? '').toLowerCase().includes(normalizedSearchTerm) ||
        String(player.archivedReason ?? '').toLowerCase().includes(normalizedSearchTerm),
    )
  }, [players, searchTerm])

  const paginatedPlayers = useMemo(
    () => getPaginatedItems(filteredPlayers, playerPage, ARCHIVED_PLAYER_PAGE_SIZE),
    [filteredPlayers, playerPage],
  )

  const selectedPlayers = useMemo(() => {
    const selectedIds = new Set(selectedPlayerIds)
    return players.filter((player) => selectedIds.has(player.id))
  }, [players, selectedPlayerIds])

  const deleteTargetPlayers = useMemo(() => {
    if (!deleteTarget) {
      return []
    }

    return deleteTarget.mode === 'all' ? players : selectedPlayers
  }, [deleteTarget, players, selectedPlayers])

  if (!canCreateEvaluation(user)) {
    return <Navigate to="/" replace />
  }

  const handleRestorePlayer = async (player) => {
    setIsRestoringId(player.id)
    setErrorMessage('')
    setMessage('')

    try {
      await restorePlayer({ user, playerId: player.id })
      const nextPlayers = players.filter((currentPlayer) => currentPlayer.id !== player.id)
      setPlayers(nextPlayers)
      writeViewCache(cacheKey, { players: nextPlayers })
      setSelectedPlayerIds((currentIds) => currentIds.filter((playerId) => playerId !== player.id))
      setMessage(`${player.playerName} was restored to active players.`)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not restore this player.')
    } finally {
      setIsRestoringId('')
    }
  }

  const handleTogglePlayer = (playerId) => {
    setSelectedPlayerIds((currentIds) =>
      currentIds.includes(playerId)
        ? currentIds.filter((currentId) => currentId !== playerId)
        : [...currentIds, playerId],
    )
  }

  const openDeleteModal = (mode) => {
    if (mode === 'selected' && selectedPlayerIds.length === 0) {
      return
    }

    if (mode === 'all' && players.length === 0) {
      return
    }

    setDeleteTarget({ mode })
    setErrorMessage('')
    setMessage('')
  }

  const confirmDeleteArchivedPlayers = async (password) => {
    const playersToDelete = deleteTargetPlayers

    if (playersToDelete.length === 0) {
      setDeleteTarget(null)
      return
    }

    setIsDeleting(true)
    setErrorMessage('')
    setMessage('')

    try {
      await verifyCurrentUserPassword(user.email, password)
      await deleteArchivedPlayers({
        user,
        playerIds: playersToDelete.map((player) => player.id),
      })

      const deletedIds = new Set(playersToDelete.map((player) => player.id))
      const nextPlayers = players.filter((player) => !deletedIds.has(player.id))
      setPlayers(nextPlayers)
      setSelectedPlayerIds((currentIds) => currentIds.filter((playerId) => !deletedIds.has(playerId)))
      writeViewCache(cacheKey, { players: nextPlayers })
      setMessage(
        playersToDelete.length === 1
          ? `${playersToDelete[0].playerName} was deleted from archived players.`
          : `${playersToDelete.length} players were deleted from archived players.`,
      )
      setDeleteTarget(null)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not delete archived players.')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Archived Players"
        title="Archived players"
        description="Review players removed from active lists and restore them when needed."
      />

      {errorMessage ? <NoticeBanner title="Archived players partly available" message={errorMessage} tone="info" /> : null}
      {message ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
          {message}
        </div>
      ) : null}

      <ArchivedPlayersSection
        filteredPlayers={filteredPlayers}
        isDeleting={isDeleting}
        isLoading={isLoading}
        isRestoringId={isRestoringId}
        onDeleteModeOpen={openDeleteModal}
        onPageChange={setPlayerPage}
        onRestorePlayer={handleRestorePlayer}
        onSearchChange={(nextSearchTerm) => {
          setSearchTerm(nextSearchTerm)
          setPlayerPage(1)
        }}
        onTogglePlayer={handleTogglePlayer}
        paginatedPlayers={paginatedPlayers}
        playerPage={playerPage}
        players={players}
        searchTerm={searchTerm}
        selectedPlayerIds={selectedPlayerIds}
      />

      <ConfirmModal
        isOpen={Boolean(deleteTarget)}
        isBusy={isDeleting}
        title={deleteTarget?.mode === 'all' ? 'Clear Archived Players' : 'Delete Archived Players'}
        message={
          deleteTarget?.mode === 'all'
            ? 'This permanently deletes every player currently in archived players.'
            : 'This permanently deletes the selected archived players.'
        }
        items={deleteTargetPlayers.map((player) => player.playerName)}
        itemsTitle="This will delete:"
        confirmLabel={deleteTarget?.mode === 'all' ? 'Clear All' : 'Delete Selected'}
        requirePassword
        onCancel={() => setDeleteTarget(null)}
        onConfirm={(password) => void confirmDeleteArchivedPlayers(password)}
      />
    </div>
  )
}
