import { Link } from 'react-router-dom'
import { Pagination } from '../ui/Pagination.jsx'
import { SectionCard } from '../ui/SectionCard.jsx'

export function RecentlyAddedPlayersSection({
  onPageChange,
  pageSize,
  paginatedRecentPlayers,
  recentPlayerPage,
  recentPlayers,
}) {
  return (
    <SectionCard
      title="Recently added"
      description="Open a player profile to edit details or start an assessment."
    >
      {recentPlayers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-6 text-sm text-[var(--text-muted)]">
          No player records yet.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {paginatedRecentPlayers.items.map((player) => (
            <Link
              key={player.id}
              to={`/player/${encodeURIComponent(player.playerName)}`}
              className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 transition hover:bg-[var(--panel-soft)]"
            >
              <p className="text-base font-semibold text-[var(--text-primary)]">{player.playerName}</p>
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                {player.section} | {player.team || 'No team'}
              </p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {player.positions?.length ? player.positions.join(', ') : 'No positions entered'}
              </p>
            </Link>
          ))}
          <div className="sm:col-span-2 xl:col-span-4">
            <Pagination
              currentPage={recentPlayerPage}
              onPageChange={onPageChange}
              pageSize={pageSize}
              totalItems={recentPlayers.length}
            />
          </div>
        </div>
      )}
    </SectionCard>
  )
}
