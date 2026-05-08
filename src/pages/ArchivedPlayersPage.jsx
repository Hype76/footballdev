import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { getPaginatedItems, Pagination } from '../components/ui/Pagination.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canCreateEvaluation, useAuth, verifyCurrentUserPassword } from '../lib/auth.js'
import {
  deletePlayerRecord,
  getPlayers,
  readViewCache,
  readViewCacheValue,
  restorePlayer,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

const ARCHIVED_PLAYER_PAGE_SIZE = 12

function formatDate(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return 'No date entered'
  }

  const parsedDate = new Date(normalizedValue)
  return Number.isNaN(parsedDate.getTime()) ? normalizedValue : parsedDate.toLocaleDateString()
}

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
      await Promise.all(
        playersToDelete.map((player) =>
          deletePlayerRecord({
            user,
            playerId: player.id,
          }),
        ),
      )

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
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
          {message}
        </div>
      ) : null}

      <SectionCard
        title="Archive"
        description="Archived players are hidden from active player lists, but remain retrievable here."
      >
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-[var(--text-muted)]">
            {selectedPlayerIds.length > 0
              ? `${selectedPlayerIds.length} selected`
              : `${players.length} archived player${players.length === 1 ? '' : 's'}`}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={selectedPlayerIds.length === 0 || isDeleting}
              onClick={() => openDeleteModal('selected')}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--danger-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Delete selected
            </button>
            <button
              type="button"
              disabled={players.length === 0 || isDeleting}
              onClick={() => openDeleteModal('all')}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--danger-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Clear all
            </button>
          </div>
        </div>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Search archived players</span>
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => {
              setSearchTerm(event.target.value)
              setPlayerPage(1)
            }}
            placeholder="Search player, team, or archive reason"
            className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>

        {isLoading ? (
          <div className="mt-5 rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            Loading archived players...
          </div>
        ) : filteredPlayers.length === 0 ? (
          <div className="mt-5 rounded-[20px] border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
            No archived players found.
          </div>
        ) : (
          <div className="mt-5 grid gap-3">
            {paginatedPlayers.items.map((player) => (
              <div key={player.id} className="rounded-[22px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
                <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-start">
                  <label className="flex items-start pt-1">
                    <input
                      type="checkbox"
                      checked={selectedPlayerIds.includes(player.id)}
                      onChange={() => handleTogglePlayer(player.id)}
                      className="h-5 w-5 rounded border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--accent)] focus:ring-[var(--accent)]"
                      aria-label={`Select ${player.playerName}`}
                    />
                  </label>
                  <div className="md:col-span-2">
                    <p className="text-base font-semibold text-[var(--text-primary)]">{player.playerName}</p>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">{player.team || 'No team entered'} | {player.section || 'No section entered'}</p>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                      {player.positions?.length ? player.positions.join(', ') : 'No positions entered'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Archived</p>
                    <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{formatDate(player.archivedAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Reason</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--text-muted)]">{player.archivedReason || 'No reason entered'}</p>
                  </div>
                  <div className="flex lg:justify-end">
                    <button
                      type="button"
                      disabled={isRestoringId === player.id}
                      onClick={() => void handleRestorePlayer(player)}
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
                    >
                      {isRestoringId === player.id ? 'Restoring...' : 'Restore'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <Pagination
              currentPage={playerPage}
              onPageChange={setPlayerPage}
              pageSize={ARCHIVED_PLAYER_PAGE_SIZE}
              totalItems={filteredPlayers.length}
            />
          </div>
        )}
      </SectionCard>

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
