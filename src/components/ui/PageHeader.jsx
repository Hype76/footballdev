export function PageHeader({ eyebrow, title, description, action }) {
  return (
    <div className="flex flex-col gap-5 rounded-[28px] border border-[#dbe3d6] bg-[#f2f6ef] px-6 py-6 sm:px-8 sm:py-8 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#5a6b5b]">{eyebrow}</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600 sm:text-base">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
