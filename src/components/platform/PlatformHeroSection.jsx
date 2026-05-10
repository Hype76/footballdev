export function PlatformHeroSection({
  eyebrow,
  title,
  description,
  status,
  detail,
  actionLabel,
  onAction,
}) {
  return (
    <section className="relative overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.22)] sm:p-8">
      <div className="pointer-events-none absolute -right-24 top-0 h-56 w-56 rounded-full bg-[var(--accent)] opacity-15 blur-3xl" />
      <div className="relative grid gap-6 xl:grid-cols-[1.2fr_0.8fr] xl:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--accent)]">{eyebrow}</p>
          <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-[var(--text-primary)] sm:text-4xl">
            {title}
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--text-muted)] sm:text-base">
            {description}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)]/80 p-5 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-[var(--accent)] shadow-[0_0_24px_var(--accent)] animate-pulse" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">{status}</p>
          </div>
          <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">{detail}</p>
          {actionLabel && onAction ? (
            <button
              type="button"
              onClick={onAction}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:-translate-y-0.5 hover:bg-[var(--panel-soft)]"
            >
              {actionLabel}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export function PlatformStatGrid({ items }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="group relative overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 transition duration-300 hover:-translate-y-1 hover:border-[var(--accent)] hover:shadow-[0_22px_70px_rgba(0,0,0,0.2)]"
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[var(--accent)] opacity-70" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">{item.label}</p>
              <p className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-[var(--text-primary)]">{item.value}</p>
            </div>
            {item.detail ? (
              <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[var(--accent)] opacity-70 transition group-hover:scale-150 group-hover:opacity-100" />
            ) : null}
          </div>
          {item.caption ? <p className="mt-4 text-sm font-semibold text-[var(--text-primary)]">{item.caption}</p> : null}
          {item.detail ? <p className="mt-1 text-sm text-[var(--text-muted)]">{item.detail}</p> : null}
        </div>
      ))}
    </div>
  )
}
