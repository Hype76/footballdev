import { EVALUATION_SECTIONS } from '../../lib/supabase.js'
import { formatPlayerDate, getPlayerKey } from '../../hooks/players/playersPageUtils.js'
import { Pagination } from '../ui/Pagination.jsx'

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
  const emptyMessage =
    viewFilter === 'evaluated'
      ? 'No players with completed development records found.'
      : viewFilter === 'scored'
        ? 'No players with scored development records found.'
        : 'No players found.'

  return (
    <section
      data-tour-id="players-list-section"
      className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"
    >
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-5 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Player register</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Find, check, and act on players</h2>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
              Use the register as the source of truth for footballers. Search first, filter by section, then open a profile before making squad decisions.
            </p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700">
            {filteredPlayers.length} matching players
          </div>
        </div>
      </div>

      <div className="grid gap-4 border-b border-slate-200 px-5 py-5 sm:px-6 md:grid-cols-2 lg:grid-cols-3">
        <label className="block md:col-span-2">
          <span className="mb-2 block text-sm font-black text-slate-900">Search player register</span>
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search by player, team, or position"
            className="min-h-12 w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-black text-slate-900">Football section</span>
          <select
            value={urlSection}
            onChange={(event) => onFilterChange({ section: event.target.value })}
            className="min-h-12 w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
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

      <div className="px-5 py-5 sm:px-6">
        {isLoading ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-sm font-bold text-slate-600">
            Loading player register...
          </div>
        ) : filteredPlayers.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm font-bold text-slate-600">
            {emptyMessage}
          </div>
        ) : (
          <div className="grid gap-3">
          {paginatedPlayers.items.map((player) => {
            const isSquadPlayer = String(player.section ?? '').toLowerCase() === 'squad'
            const sectionBadgeClass = isSquadPlayer
              ? 'border-sky-200 bg-sky-50 text-sky-800'
              : 'border-amber-200 bg-amber-50 text-amber-800'
            const cardClass = isSquadPlayer
              ? 'border-sky-200 bg-white'
              : 'border-amber-200 bg-white'
            const stripeClass = isSquadPlayer ? 'bg-sky-500' : 'bg-amber-500'

            return (
              <div
                key={getPlayerKey(player.playerName)}
                className={[
                  'relative overflow-hidden rounded-md border shadow-sm transition hover:-translate-y-0.5 hover:shadow-md',
                  cardClass,
                ].join(' ')}
              >
                <div className={['absolute inset-y-0 left-0 w-1', stripeClass].join(' ')} />
                <button
                  type="button"
                  onClick={() => onOpenPlayer(player)}
                  className="w-full px-4 py-4 text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-500"
                >
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_repeat(4,minmax(7rem,1fr))] xl:items-center">
                    <div>
                      <div className="flex max-w-full flex-col gap-2 sm:flex-row sm:items-center">
                        <p
                          className="min-w-0 truncate text-lg font-black text-slate-950"
                          title={player.playerName}
                        >
                          {player.playerName}
                        </p>
                        <span className={['inline-flex min-h-7 w-fit items-center rounded-md border px-3 py-1 text-xs font-black uppercase tracking-[0.12em]', sectionBadgeClass].join(' ')}>
                          {isSquadPlayer ? 'Squad player' : 'Trial player'}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-bold text-slate-700">{player.team || 'No team entered'}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-600">
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
                <div className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:flex-wrap sm:justify-end">
                  {isSquadPlayer ? (
                    <button
                      type="button"
                      disabled={actionLoadingKey === `${player.playerId}:move-to-trial`}
                      title={actionLoadingKey === `${player.playerId}:move-to-trial` ? 'Please wait while this player is being moved to trial.' : undefined}
                      onClick={(event) => void onMovePlayerToTrial(event, player)}
                      className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-900 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {actionLoadingKey === `${player.playerId}:move-to-trial` ? 'Moving...' : 'Move to trial'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={actionLoadingKey === `${player.playerId}:archive`}
                    title={actionLoadingKey === `${player.playerId}:archive` ? 'Please wait while this player is being archived.' : undefined}
                    onClick={(event) => onArchivePlayer(event, player)}
                    className="inline-flex min-h-11 items-center justify-center rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {actionLoadingKey === `${player.playerId}:archive` ? 'Archiving...' : 'Archive'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenPlayer(player)}
                    className="inline-flex min-h-11 items-center justify-center rounded-md bg-emerald-700 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-800"
                  >
                    Open profile
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
      </div>
    </section>
  )
}
