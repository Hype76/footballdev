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
    <section className="rounded-lg border border-[#cbd5e1] bg-white p-6 shadow-sm shadow-[#2563eb]/10 sm:p-8">
      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr] xl:items-end">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]">{eyebrow}</p>
          <h2 className="mt-4 max-w-3xl text-3xl font-black tracking-tight text-[#0f172a] sm:text-4xl">
            {title}
          </h2>
          <p className="mt-4 max-w-2xl text-sm font-semibold leading-6 text-[#475569] sm:text-base">
            {description}
          </p>
        </div>
        <div className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] p-5 shadow-sm shadow-[#2563eb]/10">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-[#2563eb]" />
            <p className="text-sm font-black text-[#0f172a]">{status}</p>
          </div>
          <p className="mt-3 text-sm font-semibold leading-6 text-[#475569]">{detail}</p>
          {actionLabel && onAction ? (
            <button
              type="button"
              onClick={onAction}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#2563eb] px-4 py-3 text-sm font-black text-white transition hover:bg-[#1d4ed8]"
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
          className="rounded-lg border border-[#cbd5e1] bg-white p-5 shadow-sm shadow-[#2563eb]/10 transition hover:border-[#2563eb] hover:bg-[#f8fafc]"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#475569]">{item.label}</p>
              <p className="mt-3 text-4xl font-black tracking-tight text-[#0f172a]">{item.value}</p>
            </div>
            {item.detail ? (
              <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[#2563eb]" />
            ) : null}
          </div>
          {item.caption ? <p className="mt-4 text-sm font-black text-[#0f172a]">{item.caption}</p> : null}
          {item.detail ? <p className="mt-1 text-sm font-semibold text-[#475569]">{item.detail}</p> : null}
        </div>
      ))}
    </div>
  )
}
