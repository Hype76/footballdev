import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems, Pagination } from '../components/ui/Pagination.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canCreateEvaluation, useAuth } from '../lib/auth.js'
import {
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
      setMessage(`${player.playerName} was restored to active players.`)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not restore this player.')
    } finally {
      setIsRestoringId('')
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
                <div className="grid gap-4 lg:grid-cols-5 lg:items-start">
                  <div className="lg:col-span-2">
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
    </div>
  )
}
