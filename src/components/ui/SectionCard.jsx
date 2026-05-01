export function SectionCard({ title, description, children, actions }) {
  return (
    <section className="min-w-0 rounded-[22px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 shadow-sm shadow-slate-900/10 sm:rounded-[24px] sm:p-5 lg:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">{title}</h3>
          {description ? <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{description}</p> : null}
        </div>
        {actions ? <div className="w-full shrink-0 sm:w-auto">{actions}</div> : null}
      </div>
      <div className="mt-4 sm:mt-6">{children}</div>
    </section>
  )
}
