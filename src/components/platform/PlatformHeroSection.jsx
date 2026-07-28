import { Link } from 'react-router-dom'

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
    <section className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-6 text-[var(--text-primary)] shadow-sm shadow-black/10 sm:p-8">
      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr] xl:items-end">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--accent)]">{eyebrow}</p>
          <h2 className="mt-4 max-w-3xl text-3xl font-black tracking-tight text-[var(--text-primary)] sm:text-4xl">
            {title}
          </h2>
          <p className="mt-4 max-w-2xl text-sm font-semibold leading-6 text-[var(--text-muted)] sm:text-base">
            {description}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-5 shadow-sm shadow-black/10">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-lg bg-[var(--accent)]" />
            <p className="text-sm font-black text-[var(--text-primary)]">{status}</p>
          </div>
          <p className="mt-3 text-sm font-semibold leading-6 text-[var(--text-muted)]">{detail}</p>
          {actionLabel && onAction ? (
            <button
              type="button"
              onClick={onAction}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-black text-[var(--button-primary-text)] transition hover:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
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
      {items.map((item) => {
        const content = (
          <>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">{item.label}</p>
              <p className="mt-3 text-4xl font-black tracking-tight text-[var(--text-primary)]">{item.value}</p>
            </div>
            {item.detail ? (
              <span className="mt-1 h-2.5 w-2.5 rounded-lg bg-[var(--accent)]" />
            ) : null}
          </div>
          {item.caption ? <p className="mt-4 text-sm font-black text-[var(--text-primary)]">{item.caption}</p> : null}
          {item.detail ? <p className="mt-1 text-sm font-semibold text-[var(--text-muted)]">{item.detail}</p> : null}
          {item.actionLabel ? (
            <p className="mt-4 flex items-center justify-between gap-3 text-sm font-black text-[var(--accent)]">
              <span>{item.actionLabel}</span>
              <span aria-hidden="true">→</span>
            </p>
          ) : null}
          </>
        )
        const cardClass = 'platform-overview-card block min-h-44 rounded-lg border p-5 text-left shadow-sm shadow-black/10 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--app-bg)]'

        return item.path ? (
          <Link
            key={item.label}
            to={item.path}
            className={cardClass}
            aria-label={`${item.label}: ${item.actionLabel || 'View details'}`}
          >
            {content}
          </Link>
        ) : (
          <article key={item.label} className={cardClass}>
            {content}
          </article>
        )
      })}
    </div>
  )
}
