import { Link } from 'react-router-dom'

export function PageHeader({ eyebrow, title, description, action, tourId = 'page-header' }) {
  return (
    <div
      data-tour-id={tourId}
      className="flex min-w-0 flex-col gap-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-soft)] px-4 py-5 sm:rounded-lg sm:px-6 sm:py-7 lg:flex-row lg:items-end lg:justify-between xl:px-8 xl:py-8"
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--text-secondary)]">{eyebrow}</p>
            <h2 className="mt-3 break-words text-2xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-3xl lg:text-4xl">{title}</h2>
          </div>
          <Link
            to="/"
            className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] shadow-sm shadow-black/10 transition hover:bg-[var(--panel-alt)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--panel-soft)] lg:hidden"
          >
            Home
          </Link>
        </div>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--text-muted)] sm:text-base">{description}</p>
      </div>
      {action ? <div className="w-full shrink-0 sm:w-auto">{action}</div> : null}
    </div>
  )
}
