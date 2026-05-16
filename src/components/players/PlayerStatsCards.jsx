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
        className="block cursor-pointer rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 text-left transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--panel-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Trial Players</p>
        <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{trialPlayerCount}</p>
      </Link>
      <Link
        to="/players/current?section=Squad"
        aria-label="View squad players"
        className="block cursor-pointer rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 text-left transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--panel-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Squad Players</p>
        <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{squadPlayerCount}</p>
      </Link>
      <Link
        to="/assess-player/completed"
        aria-label="View players with completed evaluations"
        className="block cursor-pointer rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 text-left transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--panel-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Evaluations</p>
        <p className="mt-3 text-2xl font-semibold text-[var(--text-primary)]">{totalEvaluations}</p>
        <p className="mt-1 text-xs font-semibold text-[var(--text-muted)]">{evaluatedPlayerCount} players</p>
      </Link>
    </div>
  )
}
