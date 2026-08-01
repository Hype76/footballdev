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
          ? 'border-[#047857] bg-[#ecfdf5] shadow-[#047857]/15'
          : 'border-[#d7e5dc] bg-white shadow-[#047857]/10 hover:border-[#86efac]'
      }`}
      data-testid="game-day-fixture-summary"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex rounded-md border border-[#bbf7d0] bg-[#ecfdf5] px-2 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-[#047857]">
              {lifecycleLabel}
            </span>
            <span className="inline-flex rounded-md border border-[#d7e5dc] bg-[#f7faf8] px-2 py-1 text-[10px] font-black text-[#4b5f55]">
              {homeAwayLabel}
            </span>
            <span className="inline-flex rounded-md border border-[#d7e5dc] bg-[#f7faf8] px-2 py-1 text-[10px] font-black text-[#4b5f55]">
              {fixtureTypeLabel}
            </span>
          </div>
          <h3 className="mt-2 text-sm font-black leading-5 text-[#101828]">{matchName}</h3>
          <p className="mt-1 text-xs font-semibold leading-5 text-[#4b5f55]">{dateLabel}</p>
          {venueLabel ? <p className="text-xs font-semibold leading-5 text-[#4b5f55]">{venueLabel}</p> : null}
        </div>
        <div className={`shrink-0 rounded-lg border px-3 py-2 text-center ${isLive ? 'border-[#047857] bg-white' : 'border-[#d7e5dc] bg-[#f7faf8]'}`}>
          <p className="text-[9px] font-black uppercase tracking-[0.12em] text-[#4b5f55]">Score</p>
          <p className="mt-1 text-lg font-black leading-none text-[#101828]">{scoreSummary}</p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
        <div className="rounded-md border border-[#d7e5dc] bg-[#f7faf8] px-2.5 py-2">
          <p className="text-[9px] font-black uppercase tracking-[0.12em] text-[#047857]">Availability</p>
          <p className="mt-1 text-xs font-bold leading-5 text-[#101828]">{availabilitySummary}</p>
        </div>
        <div className="rounded-md border border-[#d7e5dc] bg-[#f7faf8] px-2.5 py-2">
          <p className="text-[9px] font-black uppercase tracking-[0.12em] text-[#047857]">Roles</p>
          <p className="mt-1 text-xs font-bold leading-5 text-[#101828]">{roleWarningSummary}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="truncate text-[10px] font-black uppercase tracking-[0.1em] text-[#4b5f55]">
          {teamName || 'Team fixture'}
        </span>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg bg-[#047857] px-4 py-2 text-xs font-black text-white transition hover:bg-[#065f46]"
          aria-label={`${isSelected ? 'Close' : 'Manage'} ${matchName}`}
        >
          {isSelected ? 'Close' : 'Manage'}
        </button>
      </div>
    </article>
  )
}
