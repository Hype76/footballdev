export function PageHeader({ eyebrow, title, description, action }) {
  return (
    <div className="flex min-w-0 flex-col gap-5 rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-soft)] px-4 py-5 sm:rounded-[28px] sm:px-8 sm:py-8 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--text-secondary)]">{eyebrow}</p>
        <h2 className="mt-3 break-words text-2xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-4xl">{title}</h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--text-muted)] sm:text-base">{description}</p>
      </div>
      {action ? <div className="w-full shrink-0 sm:w-auto">{action}</div> : null}
    </div>
  )
}
