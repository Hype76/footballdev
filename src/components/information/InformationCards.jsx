import { Link } from 'react-router-dom'

export function InfoCard({ title, children }) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
      <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
      <div className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{children}</div>
    </div>
  )
}

function DetailList({ items }) {
  return (
    <div className="mt-4 space-y-2">
      {items.map((item) => (
        <div key={item} className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3">
          <p className="text-sm leading-6 text-[var(--text-primary)]">{item}</p>
        </div>
      ))}
    </div>
  )
}

export function PlanCard({ plan, isCurrent }) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">{plan.label}</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{plan.summary}</p>
        </div>
        {isCurrent ? (
          <span className="inline-flex w-fit rounded-full border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
            Current
          </span>
        ) : null}
      </div>
      <DetailList items={plan.details} />
    </div>
  )
}

export function RoleCard({ guide }) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-5">
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">{guide.label}</h3>
      <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{guide.summary}</p>
      <DetailList items={guide.capabilities} />
    </div>
  )
}

export function QuickLinks({ links }) {
  if (!links.length) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-5 text-sm text-[var(--text-muted)]">
        No quick links are available for this role yet.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      {links.map((link) => (
        <Link
          key={link.path}
          to={link.path}
          className={[
            'inline-flex min-h-11 items-center justify-center rounded-lg px-5 py-3 text-sm font-semibold transition',
            link.primary
              ? 'bg-[var(--button-primary)] text-[var(--button-primary-text)] hover:opacity-90'
              : 'border border-[var(--border-color)] bg-[var(--panel-bg)] text-[var(--text-primary)] hover:bg-[var(--panel-soft)]',
          ].join(' ')}
        >
          {link.label}
        </Link>
      ))}
    </div>
  )
}
