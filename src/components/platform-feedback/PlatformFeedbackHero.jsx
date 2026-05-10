export function PlatformFeedbackHero({ isLoading }) {
  return (
    <section className="relative overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)] sm:p-8">
      <div className="relative grid gap-6 xl:grid-cols-[1.2fr_0.8fr] xl:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">Product feedback</p>
          <h2 className="mt-4 max-w-3xl text-3xl font-semibold text-[var(--text-primary)] sm:text-4xl">
            Share ideas, vote on priorities, and read platform admin responses.
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--text-muted)] sm:text-base">
            Feedback stays visible so clubs can see what has been requested, planned, and completed.
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)]/80 p-5 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-[var(--accent)] shadow-[0_0_24px_var(--accent)] animate-pulse" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {isLoading ? 'Refreshing feedback' : 'Feedback board loaded'}
            </p>
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
            One practical idea per item keeps voting clean and useful.
          </p>
        </div>
      </div>
    </section>
  )
}
