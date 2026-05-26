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
      className="overflow-hidden rounded-lg border border-[#d8e3ee] bg-white shadow-sm shadow-[#0f172a]/5"
    >
      <div className="border-b border-[#d8e3ee] bg-[#f8fbfd] px-5 py-5 sm:px-6">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#1d4ed8]">Recently added</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-[#0f172a]">Check the latest player records</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#475569]">
              Use this list to avoid duplicates before adding another footballer to the register.
            </p>
          </div>
          <span className="inline-flex min-h-10 w-fit items-center rounded-lg border border-[#bfdbfe] bg-white px-4 text-sm font-black text-[#1d4ed8] shadow-sm shadow-[#1d4ed8]/10">
            {recentPlayers.length} total
          </span>
        </div>
      </div>

      {recentPlayers.length === 0 ? (
        <div className="m-5 rounded-lg border border-[#d8e3ee] bg-[#f8fbfd] px-4 py-8 text-sm font-bold text-[#475569] shadow-sm shadow-[#0f172a]/5 sm:m-6">
          No player records yet. Add the first footballer above.
        </div>
      ) : (
        <div className="grid gap-3 px-5 py-5 sm:grid-cols-2 sm:px-6 xl:grid-cols-4">
          {paginatedRecentPlayers.items.map((player) => (
            <Link
              key={player.id}
              to={`/player/${encodeURIComponent(player.playerName)}`}
              className="group rounded-lg border border-[#d8e3ee] bg-white p-4 shadow-sm shadow-[#0f172a]/5 transition hover:-translate-y-0.5 hover:border-[#2563eb] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
            >
              <p className="text-base font-black text-[#0f172a]">{player.playerName}</p>
              <p className="mt-2 text-sm font-bold text-[#1d4ed8]">
                {player.section} / {player.team || 'No team'}
              </p>
              <p className="mt-1 text-sm font-semibold leading-5 text-[#475569]">
                {player.positions?.length ? player.positions.join(', ') : 'No positions entered'}
              </p>
              <span className="mt-4 inline-flex min-h-9 items-center rounded-lg bg-[#0f172a] px-3 text-xs font-black text-white transition group-hover:bg-[#1d4ed8]">
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
