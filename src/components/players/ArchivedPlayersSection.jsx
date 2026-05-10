import { ARCHIVED_PLAYER_PAGE_SIZE, formatPlayerDate } from '../../hooks/players/playersPageUtils.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

export function ArchivedPlayersSection({
  filteredPlayers,
  isDeleting,
  isLoading,
  isRestoringId,
  onDeleteModeOpen,
  onPageChange,
  onRestorePlayer,
  onSearchChange,
  onTogglePlayer,
  paginatedPlayers,
  playerPage,
  players,
  searchTerm,
  selectedPlayerIds,
}) {
  return (
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
            onClick={() => onDeleteModeOpen('selected')}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--danger-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Delete selected
          </button>
          <button
            type="button"
            disabled={players.length === 0 || isDeleting}
            onClick={() => onDeleteModeOpen('all')}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--danger-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
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
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search player, team, or archive reason"
          className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
        />
      </label>

      {isLoading ? (
        <div className="mt-5 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
          Loading archived players...
        </div>
      ) : filteredPlayers.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
          No archived players found.
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          {paginatedPlayers.items.map((player) => (
            <div key={player.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
              <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-start">
                <label className="flex items-start pt-1">
                  <input
                    type="checkbox"
                    checked={selectedPlayerIds.includes(player.id)}
                    onChange={() => onTogglePlayer(player.id)}
                    className="h-5 w-5 rounded border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--accent)] focus:ring-[var(--accent)]"
                    aria-label={`Select ${player.playerName}`}
                  />
                </label>
                <div className="md:col-span-2">
                  <p className="text-base font-semibold text-[var(--text-primary)]">{player.playerName}</p>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">
                    {player.team || 'No team entered'} | {player.section || 'No section entered'}
                  </p>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">
                    {player.positions?.length ? player.positions.join(', ') : 'No positions entered'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Archived</p>
                  <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{formatPlayerDate(player.archivedAt)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Reason</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--text-muted)]">{player.archivedReason || 'No reason entered'}</p>
                </div>
                <div className="flex lg:justify-end">
                  <button
                    type="button"
                    disabled={isRestoringId === player.id}
                    onClick={() => void onRestorePlayer(player)}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
                  >
                    {isRestoringId === player.id ? 'Restoring...' : 'Restore'}
                  </button>
                </div>
              </div>
            </div>
          ))}
          <Pagination
            currentPage={playerPage}
            onPageChange={onPageChange}
            pageSize={ARCHIVED_PLAYER_PAGE_SIZE}
            totalItems={filteredPlayers.length}
          />
        </div>
      )}
    </SectionCard>
  )
}
