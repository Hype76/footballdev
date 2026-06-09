import { Link } from 'react-router-dom'
import { Pagination } from '../ui/Pagination.jsx'

export function RecentlyAddedPlayersSection({
  onPageChange,
  pageSize,
  paginatedRecentPlayers,
  recentPlayerPage,
  recentPlayers,
}) {
  return (
    <section
      className="overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#101828]/5"
    >
      <div className="border-b border-[#d7e5dc] bg-[#f7faf8] px-5 py-5 sm:px-6">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#065f46]">Recently added</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Check the latest player records</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
              Use this list to avoid duplicates before adding another player to the register.
            </p>
          </div>
          <span className="inline-flex min-h-10 w-fit items-center rounded-lg border border-[#bbf7d0] bg-white px-4 text-sm font-black text-[#065f46] shadow-sm shadow-[#065f46]/10">
            {recentPlayers.length} total
          </span>
        </div>
      </div>

      {recentPlayers.length === 0 ? (
        <div className="m-5 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-8 text-sm font-bold text-[#4b5f55] shadow-sm shadow-[#101828]/5 sm:m-6">
          No player records yet. Add the first player above.
        </div>
      ) : (
        <div className="grid gap-3 px-5 py-5 sm:grid-cols-2 sm:px-6 xl:grid-cols-4">
          {paginatedRecentPlayers.items.map((player) => (
            <Link
              key={player.id}
              to={`/player/${encodeURIComponent(player.playerName)}`}
              className="group rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#101828]/5 transition hover:-translate-y-0.5 hover:border-[#047857] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#047857]"
            >
              <p className="text-base font-black text-[#101828]">{player.playerName}</p>
              <p className="mt-2 text-sm font-bold text-[#065f46]">
                Section: {player.section || 'Trial'}, Team: {player.team || 'No team assigned'}
              </p>
              <p className="mt-1 text-sm font-semibold leading-5 text-[#4b5f55]">
                {player.positions?.length ? player.positions.join(', ') : 'No positions entered'}
              </p>
              <span className="mt-4 inline-flex min-h-9 items-center rounded-lg bg-[#047857] px-3 text-xs font-black text-white shadow-sm shadow-[#047857]/20 transition group-hover:bg-[#065f46]">
                Open profile
              </span>
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
    </section>
  )
}
