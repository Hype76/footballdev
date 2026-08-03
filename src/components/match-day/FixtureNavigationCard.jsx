export function FixtureNavigationCard({
  availabilitySummary,
  dateLabel,
  fixtureTypeLabel,
  homeAwayLabel,
  isLive = false,
  isSelected = false,
  lifecycleLabel,
  matchName,
  onOpen,
  roleWarningSummary,
  scoreSummary,
  teamName,
  venueLabel,
}) {
  return (
    <article
      aria-current={isSelected ? 'true' : undefined}
      className={`rounded-lg border p-3 shadow-sm transition ${
        isSelected
          ? 'border-[var(--accent)] bg-[var(--accent-soft)] shadow-black/10'
          : 'border-[var(--border-color)] bg-[var(--panel-bg)] shadow-black/5 hover:border-[var(--accent)]'
      }`}
      data-testid="game-day-fixture-summary"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-[var(--text-secondary)]">
              {lifecycleLabel}
            </span>
            <span className="inline-flex rounded-full bg-[var(--panel-alt)] px-2.5 py-1 text-[10px] font-black text-[var(--text-muted)]">
              {homeAwayLabel}
            </span>
            <span className="inline-flex rounded-full bg-[var(--panel-alt)] px-2.5 py-1 text-[10px] font-black text-[var(--text-muted)]">
              {fixtureTypeLabel}
            </span>
          </div>
          <h3 className="mt-2 text-sm font-black leading-5 text-[var(--text-primary)]">{matchName}</h3>
          <p className="mt-1 text-xs font-semibold leading-5 text-[var(--text-muted)]">{dateLabel}</p>
          {venueLabel ? <p className="text-xs font-semibold leading-5 text-[var(--text-muted)]">{venueLabel}</p> : null}
        </div>
        <div className={`shrink-0 rounded-lg px-3 py-2 text-center ${isLive ? 'bg-[var(--accent-soft)]' : 'bg-[var(--panel-alt)]'}`}>
          <p className="text-[9px] font-black uppercase tracking-[0.12em] text-[var(--text-muted)]">Score</p>
          <p className="mt-1 text-lg font-black leading-none text-[var(--text-primary)]">{scoreSummary}</p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
        <div className="rounded-md bg-[var(--panel-alt)] px-2.5 py-2">
          <p className="text-[9px] font-black uppercase tracking-[0.12em] text-[var(--text-secondary)]">Availability</p>
          <p className="mt-1 text-xs font-bold leading-5 text-[var(--text-primary)]">{availabilitySummary}</p>
        </div>
        <div className="rounded-md bg-[var(--panel-alt)] px-2.5 py-2">
          <p className="text-[9px] font-black uppercase tracking-[0.12em] text-[var(--text-secondary)]">Roles</p>
          <p className="mt-1 text-xs font-bold leading-5 text-[var(--text-primary)]">{roleWarningSummary}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="truncate text-[10px] font-black uppercase tracking-[0.1em] text-[var(--text-muted)]">
          {teamName || 'Team fixture'}
        </span>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-2 text-xs font-black text-[var(--button-primary-text)] transition hover:bg-[var(--button-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          aria-label={`${isSelected ? 'Close' : 'Manage'} ${matchName}`}
        >
          {isSelected ? 'Close' : 'Manage'}
        </button>
      </div>
    </article>
  )
}
