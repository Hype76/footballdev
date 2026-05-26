import { EVALUATION_SECTIONS } from '../../lib/supabase.js'
import { formatPlayerDate, getPlayerKey } from '../../hooks/players/playersPageUtils.js'
import { Pagination } from '../ui/Pagination.jsx'

const fieldClass = 'min-h-12 w-full rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#8da59a] focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]'
const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.14em] text-[#5f7468]'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bfe8cd] bg-white px-4 py-3 text-sm font-black text-[#101828] transition hover:border-[#20a464] hover:bg-[#f0fdf6] disabled:cursor-not-allowed disabled:opacity-60'

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
      className="overflow-hidden rounded-lg border border-[#b7efce] bg-white shadow-sm shadow-[#d7eadf]/80"
    >
      <div className="border-b border-[#bfe8cd] bg-[#f8fdf9] px-5 py-5 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Player register</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Find, check, and act on players</h2>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#5f7468]">
              Use the register as the source of truth for footballers. Search first, filter by section, then open a profile before making squad decisions.
            </p>
          </div>
          <div className="rounded-lg border border-[#bfe8cd] bg-white px-4 py-3 text-sm font-black text-[#456653] shadow-sm shadow-[#d7eadf]/60">
            {filteredPlayers.length} matching players
          </div>
        </div>
      </div>

      <div className="grid gap-4 border-b border-[#bfe8cd] px-5 py-5 sm:px-6 md:grid-cols-2 lg:grid-cols-3">
        <label className="block md:col-span-2">
          <span className={labelClass}>Search player register</span>
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search by player, team, or position"
            className={fieldClass}
          />
        </label>

        <label className="block">
          <span className={labelClass}>Football section</span>
          <select
            value={urlSection}
            onChange={(event) => onFilterChange({ section: event.target.value })}
            className={fieldClass}
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
          <div className="rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] px-4 py-6 text-sm font-bold text-[#5f7468] shadow-sm shadow-[#d7eadf]/60">
            Loading player register...
          </div>
        ) : filteredPlayers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#9addb4] bg-[#f8fdf9] px-4 py-8 text-sm font-bold text-[#5f7468] shadow-sm shadow-[#d7eadf]/60">
            {emptyMessage}
          </div>
        ) : (
          <div className="grid gap-3">
          {paginatedPlayers.items.map((player) => {
            const isSquadPlayer = String(player.section ?? '').toLowerCase() === 'squad'
            const sectionBadgeClass = isSquadPlayer
              ? 'border-[#b2ddff] bg-[#eff8ff] text-[#175cd3]'
              : 'border-[#fedf89] bg-[#fffaeb] text-[#93370d]'
            const stripeClass = isSquadPlayer ? 'bg-[#2e90fa]' : 'bg-[#f79009]'

            return (
              <div
                key={getPlayerKey(player.playerName)}
                className="relative overflow-hidden rounded-lg border border-[#bfe8cd] bg-white shadow-sm shadow-[#d7eadf]/70 transition hover:-translate-y-0.5 hover:border-[#20a464] hover:shadow-md"
              >
                <div className={['absolute inset-y-0 left-0 w-1', stripeClass].join(' ')} />
                <button
                  type="button"
                  onClick={() => onOpenPlayer(player)}
                  className="w-full px-4 py-4 text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#20a464]"
                >
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_repeat(4,minmax(7rem,1fr))] xl:items-center">
                    <div>
                      <div className="flex max-w-full flex-col gap-2 sm:flex-row sm:items-center">
                        <p
                          className="min-w-0 truncate text-lg font-black text-[#101828]"
                          title={player.playerName}
                        >
                          {player.playerName}
                        </p>
                        <span className={['inline-flex min-h-7 w-fit items-center rounded-lg border px-3 py-1 text-xs font-black uppercase tracking-[0.12em]', sectionBadgeClass].join(' ')}>
                          {isSquadPlayer ? 'Squad player' : 'Trial player'}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-bold text-[#456653]">{player.team || 'No team entered'}</p>
                      <p className="mt-1 text-sm font-semibold text-[#5f7468]">
                        {player.positions?.length ? player.positions.join(', ') : 'No positions entered'}
                      </p>
                    </div>
                    <div>
                      <p className={eyebrowClass}>Section</p>
                      <p className="mt-2 text-sm font-black text-[#101828]">{player.section}</p>
                    </div>
                    <div>
                      <p className={eyebrowClass}>Last Score</p>
                      <p className="mt-2 text-sm font-black text-[#101828]">
                        {player.latestScore !== null ? player.latestScore.toFixed(1) : '-'}
                      </p>
                    </div>
                    <div>
                      <p className={eyebrowClass}>Average</p>
                      <p className="mt-2 text-sm font-black text-[#101828]">
                        {player.averageScore !== null ? player.averageScore.toFixed(1) : '-'}
                      </p>
                    </div>
                    <div>
                      <p className={eyebrowClass}>Last Seen</p>
                      <p className="mt-2 text-sm font-black text-[#101828]">{formatPlayerDate(player.latestDate)}</p>
                    </div>
                  </div>
                </button>
                <div className="flex flex-col gap-2 border-t border-[#bfe8cd] bg-[#f8fdf9] px-4 py-3 sm:flex-row sm:flex-wrap sm:justify-end">
                  {isSquadPlayer ? (
                    <button
                      type="button"
                      disabled={actionLoadingKey === `${player.playerId}:move-to-trial`}
                      title={actionLoadingKey === `${player.playerId}:move-to-trial` ? 'Please wait while this player is being moved to trial.' : undefined}
                      onClick={(event) => void onMovePlayerToTrial(event, player)}
                      className={secondaryButtonClass}
                    >
                      {actionLoadingKey === `${player.playerId}:move-to-trial` ? 'Moving...' : 'Move to trial'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={actionLoadingKey === `${player.playerId}:archive`}
                    title={actionLoadingKey === `${player.playerId}:archive` ? 'Please wait while this player is being archived.' : undefined}
                    onClick={(event) => onArchivePlayer(event, player)}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {actionLoadingKey === `${player.playerId}:archive` ? 'Archiving...' : 'Archive'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenPlayer(player)}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#067a46] px-4 py-3 text-sm font-black text-white transition hover:bg-[#05603a]"
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
