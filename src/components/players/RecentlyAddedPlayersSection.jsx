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
      className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"
    >
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-5 sm:px-6">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Recently added</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Check the latest records</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Open a player profile to edit details, add parent links, or start an assessment.
            </p>
          </div>
          <span className="inline-flex min-h-10 w-fit items-center rounded-md border border-slate-200 bg-white px-4 text-sm font-black text-slate-700">
            {recentPlayers.length} total
          </span>
        </div>
      </div>

      {recentPlayers.length === 0 ? (
        <div className="m-5 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm font-bold text-slate-600 sm:m-6">
          No player records yet.
        </div>
      ) : (
        <div className="grid gap-3 px-5 py-5 sm:grid-cols-2 sm:px-6 xl:grid-cols-4">
          {paginatedRecentPlayers.items.map((player) => (
            <Link
              key={player.id}
              to={`/player/${encodeURIComponent(player.playerName)}`}
              className="group rounded-md border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <p className="text-base font-black text-slate-950">{player.playerName}</p>
              <p className="mt-2 text-sm font-bold text-slate-700">
                {player.section} | {player.team || 'No team'}
              </p>
              <p className="mt-1 text-sm leading-5 text-slate-600">
                {player.positions?.length ? player.positions.join(', ') : 'No positions entered'}
              </p>
              <span className="mt-4 inline-flex min-h-9 items-center rounded-md bg-slate-950 px-3 text-xs font-black text-white transition group-hover:bg-emerald-700">
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
