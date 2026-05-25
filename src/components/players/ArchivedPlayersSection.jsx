import { ARCHIVED_PLAYER_PAGE_SIZE, formatPlayerDate } from '../../hooks/players/playersPageUtils.js'
import { formatRetentionDate, getRetentionCountdownLabel } from '../../lib/retention.js'
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
      description="Archived players are hidden from active player lists and are scheduled for deletion after 3 months."
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium text-slate-600">
          {selectedPlayerIds.length > 0
            ? `${selectedPlayerIds.length} selected`
            : `${players.length} archived player${players.length === 1 ? '' : 's'}`}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            disabled={selectedPlayerIds.length === 0 || isDeleting}
            title={
              isDeleting
                ? 'Please wait while archived players are being deleted.'
                : selectedPlayerIds.length === 0
                  ? 'Select at least one archived player before deleting.'
                  : undefined
            }
            onClick={() => onDeleteModeOpen('selected')}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Delete selected
          </button>
          <button
            type="button"
            disabled={players.length === 0 || isDeleting}
            title={
              isDeleting
                ? 'Please wait while archived players are being deleted.'
                : players.length === 0
                  ? 'There are no archived players to delete.'
                  : undefined
            }
            onClick={() => onDeleteModeOpen('all')}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Clear all
          </button>
        </div>
      </div>

      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-slate-950">Search archived players</span>
        <input
          type="search"
          value={searchTerm}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search player, team, or archive reason"
          className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
        />
      </label>

      {isLoading ? (
        <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-sm font-semibold text-slate-600">
          Loading archived players...
        </div>
      ) : filteredPlayers.length === 0 ? (
        <div className="mt-5 rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm font-semibold text-slate-600">
          No archived players found.
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          {paginatedPlayers.items.map((player) => (
            <div key={player.id} className="rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-start">
                <label className="flex items-start pt-1">
                  <input
                    type="checkbox"
                    checked={selectedPlayerIds.includes(player.id)}
                    onChange={() => onTogglePlayer(player.id)}
                    className="h-5 w-5 rounded border-slate-200 bg-white text-emerald-700 focus:ring-emerald-600"
                    aria-label={`Select ${player.playerName}`}
                  />
                </label>
                <div className="md:col-span-2">
                  <p className="text-base font-semibold text-slate-950">{player.playerName}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-600">
                    {player.team || 'No team entered'} | {player.section || 'No section entered'}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-600">
                    {player.positions?.length ? player.positions.join(', ') : 'No positions entered'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Archived</p>
                  <p className="mt-2 text-sm font-semibold text-slate-950">{formatPlayerDate(player.archivedAt)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Delete Date</p>
                  <p className="mt-2 text-sm font-semibold text-slate-950">{formatRetentionDate(player.archivedDeleteAt)}</p>
                  <p className="mt-1 text-xs font-semibold text-emerald-700">{getRetentionCountdownLabel(player.archivedDeleteAt)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Reason</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm font-semibold text-slate-600">{player.archivedReason || 'No reason entered'}</p>
                </div>
                <div className="flex lg:justify-end">
                  <button
                    type="button"
                    disabled={isRestoringId === player.id}
                    title={isRestoringId === player.id ? 'Please wait while this player is being restored.' : undefined}
                    onClick={() => void onRestorePlayer(player)}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
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
