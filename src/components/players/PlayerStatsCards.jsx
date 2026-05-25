import { Link } from 'react-router-dom'

export function PlayerStatsCards({
  evaluatedPlayerCount,
  squadPlayerCount,
  totalEvaluations,
  trialPlayerCount,
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <Link
        to="/players/current?section=Trial"
        aria-label="View trial players"
        className="block cursor-pointer rounded-3xl border border-amber-200 bg-white p-5 text-left shadow-sm shadow-slate-200/80 transition hover:-translate-y-0.5 hover:border-amber-300 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
      >
        <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">Trial Players</p>
        <p className="mt-3 text-3xl font-black text-slate-950">{trialPlayerCount}</p>
        <span className="mt-4 inline-flex min-h-9 items-center justify-center rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white">
          View
        </span>
      </Link>
      <Link
        to="/players/current?section=Squad"
        aria-label="View squad players"
        className="block cursor-pointer rounded-3xl border border-sky-200 bg-white p-5 text-left shadow-sm shadow-slate-200/80 transition hover:-translate-y-0.5 hover:border-sky-300 hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-400"
      >
        <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">Squad Players</p>
        <p className="mt-3 text-3xl font-black text-slate-950">{squadPlayerCount}</p>
        <span className="mt-4 inline-flex min-h-9 items-center justify-center rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white">
          View
        </span>
      </Link>
      <Link
        to="/assess-player/completed"
        aria-label="View players with completed assessments"
        className="block cursor-pointer rounded-3xl border border-emerald-200 bg-white p-5 text-left shadow-sm shadow-slate-200/80 transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
      >
        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Assessments</p>
        <p className="mt-3 text-3xl font-black text-slate-950">{totalEvaluations}</p>
        <p className="mt-1 text-xs font-bold text-slate-500">{evaluatedPlayerCount} players</p>
        <span className="mt-4 inline-flex min-h-9 items-center justify-center rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white">
          Review
        </span>
      </Link>
    </div>
  )
}
