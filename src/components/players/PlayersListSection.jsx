import { EVALUATION_SECTIONS } from '../../lib/supabase.js'
import { formatPlayerDate, getPlayerKey } from '../../hooks/players/playersPageUtils.js'
import { Pagination } from '../ui/Pagination.jsx'
import { PlayerStatePanel } from './PlayerStatePanel.jsx'

const fieldClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#94a3b8] focus:border-[#047857] focus:ring-2 focus:ring-[#bbf7d0]'
const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const eyebrowClass = 'text-xs font-black uppercase tracking-[0.14em] text-[#4b5f55]'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#101828]/5 transition hover:border-[#047857] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'

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
  const emptyState =
    viewFilter === 'evaluated'
      ? {
          action: 'Switch the view or open the development workflow.',
          body: 'The register is filtering for players with completed development history. Clear the filter or record a player from a session.',
          title: 'No completed development records match this view.',
        }
      : viewFilter === 'scored'
        ? {
            action: 'Clear the filter or create the first scored record.',
            body: 'The register is filtering for scored records. Scores appear after coaches complete numeric development fields.',
            title: 'No scored development records match this view.',
          }
        : {
            action: 'Clear the search or add the first player.',
            body: 'Players appear here after they are added to Trial or Squad. Search and filters can also hide existing records.',
            title: 'No player records match this search.',
          }

  return (
    <section
      data-tour-id="players-list-section"
      className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#101828]/5"
    >
      <div className="border-b border-[#d7e5dc] bg-[#f7faf8] px-5 py-5 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#065f46]">Live register</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Find the footballer before you change the workflow</h2>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">
              Search by player, team, or position. Filter by section, then open the profile when the decision needs parent or development context.
            </p>
          </div>
          <div className="rounded-lg border border-[#bbf7d0] bg-white px-4 py-3 text-sm font-black text-[#065f46] shadow-sm shadow-[#065f46]/10">
            {filteredPlayers.length} matching players
          </div>
        </div>
      </div>

      <div className="grid gap-4 border-b border-[#d7e5dc] bg-white px-5 py-5 sm:px-6 md:grid-cols-2 lg:grid-cols-3">
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
          <PlayerStatePanel
            action="Keep this page open while the workspace refreshes."
            body="The register is loading squad, trial, team, position, and score context before actions are available."
            eyebrow="Loading register"
            title="Checking player records."
          />
        ) : filteredPlayers.length === 0 ? (
          <PlayerStatePanel
            action={emptyState.action}
            body={emptyState.body}
            eyebrow="Register empty"
            title={emptyState.title}
          />
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
                className="relative overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#101828]/5 transition hover:-translate-y-0.5 hover:border-[#047857] hover:shadow-md"
              >
                <div className={['absolute inset-y-0 left-0 w-1', stripeClass].join(' ')} />
                <button
                  type="button"
                  onClick={() => onOpenPlayer(player)}
                  className="w-full px-4 py-4 text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#047857]"
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
                      <p className="mt-2 text-sm font-bold text-[#4b5f55]">{player.team || 'No team entered'}</p>
                      <p className="mt-1 text-sm font-semibold text-[#4b5f55]">
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
                <div className="grid gap-3 border-t border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                  <p className="text-sm font-semibold leading-6 text-[#4b5f55]">
                    {player.totalEvaluations > 0
                      ? `${player.totalEvaluations} development record${player.totalEvaluations === 1 ? '' : 's'} attached.`
                      : 'No development records yet. Start from a session or profile when the player is ready.'}
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
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
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#fecdca] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318] transition hover:bg-[#ffe4e8] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {actionLoadingKey === `${player.playerId}:archive` ? 'Archiving...' : 'Archive'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenPlayer(player)}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-4 py-3 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46]"
                  >
                    Open profile
                  </button>
                  </div>
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
