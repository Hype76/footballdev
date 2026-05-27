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
    <section className="rounded-lg border border-[#d7e5dc] bg-white p-6 shadow-sm shadow-[#047857]/10 sm:p-8">
      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr] xl:items-end">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">{eyebrow}</p>
          <h2 className="mt-4 max-w-3xl text-3xl font-black tracking-tight text-[#101828] sm:text-4xl">
            {title}
          </h2>
          <p className="mt-4 max-w-2xl text-sm font-semibold leading-6 text-[#4b5f55] sm:text-base">
            {description}
          </p>
        </div>
        <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] p-5 shadow-sm shadow-[#047857]/10">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-lg bg-[#047857]" />
            <p className="text-sm font-black text-[#101828]">{status}</p>
          </div>
          <p className="mt-3 text-sm font-semibold leading-6 text-[#4b5f55]">{detail}</p>
          {actionLabel && onAction ? (
            <button
              type="button"
              onClick={onAction}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#047857] px-4 py-3 text-sm font-black text-white transition hover:bg-[#065f46]"
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
          className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10 transition hover:border-[#047857] hover:bg-[#f7faf8]"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#4b5f55]">{item.label}</p>
              <p className="mt-3 text-4xl font-black tracking-tight text-[#101828]">{item.value}</p>
            </div>
            {item.detail ? (
              <span className="mt-1 h-2.5 w-2.5 rounded-lg bg-[#047857]" />
            ) : null}
          </div>
          {item.caption ? <p className="mt-4 text-sm font-black text-[#101828]">{item.caption}</p> : null}
          {item.detail ? <p className="mt-1 text-sm font-semibold text-[#4b5f55]">{item.detail}</p> : null}
        </div>
      ))}
    </div>
  )
}
