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
      className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-200/70"
    >
      <div className="border-b border-slate-200 bg-[#f9fafb] px-5 py-5 sm:px-6">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Recently added</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Check the latest records</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#667085]">
              Open a player profile to edit details, add parent links, or start a development record.
            </p>
          </div>
          <span className="inline-flex min-h-10 w-fit items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-[#475467] shadow-sm shadow-slate-200/60">
            {recentPlayers.length} total
          </span>
        </div>
      </div>

      {recentPlayers.length === 0 ? (
        <div className="m-5 rounded-lg border border-dashed border-slate-300 bg-[#f9fafb] px-4 py-8 text-sm font-bold text-[#667085] shadow-sm shadow-slate-200/60 sm:m-6">
          No player records yet.
        </div>
      ) : (
        <div className="grid gap-3 px-5 py-5 sm:grid-cols-2 sm:px-6 xl:grid-cols-4">
          {paginatedRecentPlayers.items.map((player) => (
            <Link
              key={player.id}
              to={`/player/${encodeURIComponent(player.playerName)}`}
              className="group rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/70 transition hover:-translate-y-0.5 hover:border-[#20a464] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#20a464]"
            >
              <p className="text-base font-black text-[#101828]">{player.playerName}</p>
              <p className="mt-2 text-sm font-bold text-[#475467]">
                {player.section} / {player.team || 'No team'}
              </p>
              <p className="mt-1 text-sm font-semibold leading-5 text-[#667085]">
                {player.positions?.length ? player.positions.join(', ') : 'No positions entered'}
              </p>
              <span className="mt-4 inline-flex min-h-9 items-center rounded-lg bg-[#067a46] px-3 text-xs font-black text-white transition group-hover:bg-[#05603a]">
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
