import { ARCHIVED_PLAYER_PAGE_SIZE, formatPlayerDate } from '../../hooks/players/playersPageUtils.js'
import { formatRetentionDate, getRetentionCountdownLabel } from '../../lib/retention.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

const dangerButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60'
const labelClass = 'mb-2 block text-sm font-black text-[#0f172a]'
const fieldClass = 'min-h-11 w-full rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-3 text-sm font-semibold text-[#0f172a] outline-none transition placeholder:text-[#64748b] focus:border-[#2563eb] focus:bg-white focus:ring-2 focus:ring-[#dbeafe]'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.16em] text-[#2563eb]'
const detailClass = 'text-sm font-semibold text-[#475569]'

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
        <p className="text-sm font-bold text-[#475569]">
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
            className={dangerButtonClass}
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
            className={dangerButtonClass}
          >
            Clear all
          </button>
        </div>
      </div>

      <label className="block">
        <span className={labelClass}>Search archived players</span>
        <input
          type="search"
          value={searchTerm}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search player, team, or archive reason"
          className={fieldClass}
        />
      </label>

      {isLoading ? (
        <div className="mt-5 rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-6 text-sm font-bold text-[#475569] shadow-sm shadow-[#2563eb]/10">
          Loading archived players...
        </div>
      ) : filteredPlayers.length === 0 ? (
        <div className="mt-5 rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-4 py-6 text-sm font-bold text-[#475569] shadow-sm shadow-[#2563eb]/10">
          No archived players found.
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          {paginatedPlayers.items.map((player) => (
            <div key={player.id} className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4 shadow-sm shadow-[#2563eb]/10">
              <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-start">
                <label className="flex items-start pt-1">
                  <input
                    type="checkbox"
                    checked={selectedPlayerIds.includes(player.id)}
                    onChange={() => onTogglePlayer(player.id)}
                    className="h-5 w-5 rounded border-[#cbd5e1] bg-white text-[#2563eb] focus:ring-[#2563eb]"
                    aria-label={`Select ${player.playerName}`}
                  />
                </label>
                <div className="md:col-span-2">
                  <p className="text-base font-black text-[#0f172a]">{player.playerName}</p>
                  <p className={`mt-1 ${detailClass}`}>
                    {player.team || 'No team entered'} | {player.section || 'No section entered'}
                  </p>
                  <p className={`mt-1 ${detailClass}`}>
                    {player.positions?.length ? player.positions.join(', ') : 'No positions entered'}
                  </p>
                </div>
                <div>
                  <p className={eyebrowClass}>Archived</p>
                  <p className="mt-2 text-sm font-black text-[#0f172a]">{formatPlayerDate(player.archivedAt)}</p>
                </div>
                <div>
                  <p className={eyebrowClass}>Delete Date</p>
                  <p className="mt-2 text-sm font-black text-[#0f172a]">{formatRetentionDate(player.archivedDeleteAt)}</p>
                  <p className="mt-1 text-xs font-black text-[#2563eb]">{getRetentionCountdownLabel(player.archivedDeleteAt)}</p>
                </div>
                <div>
                  <p className={eyebrowClass}>Reason</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm font-semibold text-[#475569]">{player.archivedReason || 'No reason entered'}</p>
                </div>
                <div className="flex lg:justify-end">
                  <button
                    type="button"
                    disabled={isRestoringId === player.id}
                    title={isRestoringId === player.id ? 'Please wait while this player is being restored.' : undefined}
                    onClick={() => void onRestorePlayer(player)}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#2563eb] px-4 py-3 text-sm font-black text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
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
