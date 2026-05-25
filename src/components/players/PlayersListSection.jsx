import { EVALUATION_SECTIONS } from '../../lib/supabase.js'
import { formatPlayerDate, getPlayerKey } from '../../hooks/players/playersPageUtils.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

export function PlayersListSection({
  actionLoadingKey,
  filteredPlayers,
  isLoading,
  onArchivePlayer,
  onFilterChange,
  onMovePlayerToTrial,
  onOpenPlayer,
  onPageChange,
  onSearchChange,
  pageSize,
  paginatedPlayers,
  playerPage,
  searchTerm,
  urlSection,
  viewFilter,
}) {
  return (
    <SectionCard
      title="All players"
      tourId="players-list-section"
      description="Use filters to find a player quickly, then open their profile for full history and rating trends."
    >
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <label className="block md:col-span-2">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Search</span>
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search player or team"
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Section</span>
          <select
            value={urlSection}
            onChange={(event) => onFilterChange({ section: event.target.value })}
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
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
        <div className="mt-5 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
          Loading players...
        </div>
      ) : filteredPlayers.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
          {viewFilter === 'evaluated'
            ? 'No players with completed assessments found.'
            : viewFilter === 'scored'
              ? 'No players with scored assessments found.'
              : 'No players found.'}
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          {paginatedPlayers.items.map((player) => {
            const isSquadPlayer = String(player.section ?? '').toLowerCase() === 'squad'
            const sectionBadgeClass = isSquadPlayer
              ? 'border-sky-200 bg-sky-50 text-sky-800'
              : 'border-amber-200 bg-amber-50 text-amber-800'
            const cardClass = isSquadPlayer
              ? 'border-sky-200 bg-white hover:bg-sky-50'
              : 'border-amber-200 bg-white hover:bg-amber-50'
            const stripeClass = isSquadPlayer ? 'bg-sky-500' : 'bg-amber-400'

            return (
              <div
                key={getPlayerKey(player.playerName)}
                className={[
                  'relative overflow-hidden rounded-2xl border p-4 shadow-sm shadow-slate-200/80 transition',
                  cardClass,
                ].join(' ')}
              >
                <div className={['absolute inset-y-0 left-0 w-1.5', stripeClass].join(' ')} />
                <button
                  type="button"
                  onClick={() => onOpenPlayer(player)}
                  className="w-full text-left"
                >
                  <div className="grid gap-4 lg:grid-cols-6 lg:items-center">
                    <div className="md:col-span-2">
                      <div className="grid max-w-full grid-cols-1 gap-2 sm:grid-cols-[minmax(0,9.5rem)_max-content] sm:items-center">
                        <p
                          className="min-w-0 truncate text-base font-black text-slate-950"
                          title={player.playerName}
                        >
                          {player.playerName}
                        </p>
                        <span className={['inline-flex min-h-7 w-32 items-center justify-center rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.12em]', sectionBadgeClass].join(' ')}>
                          {isSquadPlayer ? 'Squad player' : 'Trial player'}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{player.team || 'No team entered'}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        Shirt number: {player.shirtNumber || 'Not entered'}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        {player.positions?.length ? player.positions.join(', ') : 'No positions entered'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Section</p>
                      <p className="mt-2 text-sm font-bold text-slate-950">{player.section}</p>
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Last Score</p>
                      <p className="mt-2 text-sm font-bold text-slate-950">
                        {player.latestScore !== null ? player.latestScore.toFixed(1) : '-'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Average</p>
                      <p className="mt-2 text-sm font-bold text-slate-950">
                        {player.averageScore !== null ? player.averageScore.toFixed(1) : '-'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Last Seen</p>
                      <p className="mt-2 text-sm font-bold text-slate-950">{formatPlayerDate(player.latestDate)}</p>
                    </div>
                  </div>
                </button>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {isSquadPlayer ? (
                    <button
                      type="button"
                      disabled={actionLoadingKey === `${player.playerId}:move-to-trial`}
                      title={actionLoadingKey === `${player.playerId}:move-to-trial` ? 'Please wait while this player is being moved to trial.' : undefined}
                      onClick={(event) => void onMovePlayerToTrial(event, player)}
                      className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {actionLoadingKey === `${player.playerId}:move-to-trial` ? 'Moving...' : 'Move to Trial'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={actionLoadingKey === `${player.playerId}:archive`}
                    title={actionLoadingKey === `${player.playerId}:archive` ? 'Please wait while this player is being archived.' : undefined}
                    onClick={(event) => onArchivePlayer(event, player)}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {actionLoadingKey === `${player.playerId}:archive` ? 'Archiving...' : 'Archive'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenPlayer(player)}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800"
                  >
                    Open Profile
                  </button>
                </div>
              </div>
            )
          })}
          <Pagination
            currentPage={playerPage}
            onPageChange={onPageChange}
            pageSize={pageSize}
            totalItems={filteredPlayers.length}
          />
        </div>
      )}
    </SectionCard>
  )
}
