export function SectionCard({ title, description, children, actions }) {
  return (
    <section className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-6 shadow-sm shadow-slate-900/10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">{title}</h3>
          {description ? <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{description}</p> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  )
}
