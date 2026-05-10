import { EVALUATION_SECTIONS } from '../../lib/supabase.js'
import { PLAYER_DECISION_ACTIONS, formatPlayerDate, getPlayerKey } from '../../hooks/players/playersPageUtils.js'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

export function PlayersListSection({
  actionLoadingKey,
  filteredPlayers,
  isLoading,
  onArchivePlayer,
  onFilterChange,
  onOpenPlayer,
  onPageChange,
  onPlayerAction,
  onSearchChange,
  pageSize,
  paginatedPlayers,
  playerDecisionActions,
  playerPage,
  searchTerm,
  urlSection,
  viewFilter,
}) {
  return (
    <SectionCard
      title="All players"
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
            ? 'No players with completed evaluations found.'
            : viewFilter === 'scored'
              ? 'No players with scored evaluations found.'
              : 'No players found.'}
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          {paginatedPlayers.items.map((player) => {
            const isSquadPlayer = String(player.section ?? '').toLowerCase() === 'squad'
            const completedActions = playerDecisionActions.get(String(player.playerId ?? '').trim()) ?? new Set()
            const availableActions = PLAYER_DECISION_ACTIONS.filter(([action]) => !completedActions.has(action))

            return (
              <div
                key={getPlayerKey(player.playerName)}
                className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4"
              >
                <button
                  type="button"
                  onClick={() => onOpenPlayer(player)}
                  className="w-full text-left"
                >
                  <div className="grid gap-4 lg:grid-cols-6 lg:items-center">
                    <div className="md:col-span-2">
                      <p className="text-base font-semibold text-[var(--text-primary)]">{player.playerName}</p>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">{player.team || 'No team entered'}</p>
                      <p className="mt-1 text-sm text-[var(--text-muted)]">
                        {player.positions?.length ? player.positions.join(', ') : 'No positions entered'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Section</p>
                      <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{player.section}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Last Score</p>
                      <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
                        {player.latestScore !== null ? player.latestScore.toFixed(1) : '-'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Average</p>
                      <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
                        {player.averageScore !== null ? player.averageScore.toFixed(1) : '-'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Last Seen</p>
                      <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{formatPlayerDate(player.latestDate)}</p>
                    </div>
                  </div>
                </button>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {!isSquadPlayer ? availableActions.map(([action, label]) => (
                    <button
                      key={action}
                      type="button"
                      disabled={actionLoadingKey === `${player.playerId}:${action}`}
                      onClick={(event) => void onPlayerAction(event, player, action)}
                      className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {actionLoadingKey === `${player.playerId}:${action}` ? 'Saving...' : label}
                    </button>
                  )) : null}
                  <button
                    type="button"
                    disabled={actionLoadingKey === `${player.playerId}:archive`}
                    onClick={(event) => onArchivePlayer(event, player)}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--danger-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {actionLoadingKey === `${player.playerId}:archive` ? 'Archiving...' : 'Archive'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenPlayer(player)}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90"
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
