export function PlatformFeedbackStats({ feedbackStats }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {feedbackStats.map((item) => (
        <div
          key={item.label}
          className="group relative overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 transition duration-300 hover:-translate-y-1 hover:border-[var(--accent)] hover:shadow-[0_22px_70px_rgba(0,0,0,0.2)]"
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[var(--accent)] opacity-70" />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">{item.label}</p>
          <p className="mt-3 text-4xl font-semibold text-[var(--text-primary)]">{item.value}</p>
          <p className="mt-3 text-sm text-[var(--text-muted)]">{item.caption}</p>
        </div>
      ))}
    </div>
  )
}
