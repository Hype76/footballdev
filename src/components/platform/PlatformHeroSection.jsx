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
    <section className="rounded-lg border border-[#bfe8cd] bg-white p-6 shadow-sm shadow-[#d7eadf]/70 sm:p-8">
      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr] xl:items-end">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">{eyebrow}</p>
          <h2 className="mt-4 max-w-3xl text-3xl font-black tracking-tight text-[#101828] sm:text-4xl">
            {title}
          </h2>
          <p className="mt-4 max-w-2xl text-sm font-semibold leading-6 text-[#5f7468] sm:text-base">
            {description}
          </p>
        </div>
        <div className="rounded-lg border border-[#abefc6] bg-[#ecfdf3] p-5 shadow-sm shadow-[#d7eadf]/70">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-[#067a46]" />
            <p className="text-sm font-black text-[#101828]">{status}</p>
          </div>
          <p className="mt-3 text-sm font-semibold leading-6 text-[#456653]">{detail}</p>
          {actionLabel && onAction ? (
            <button
              type="button"
              onClick={onAction}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#067a46] px-4 py-3 text-sm font-black text-white transition hover:bg-[#05603a]"
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
          className="rounded-lg border border-[#cfeedd] bg-white p-5 shadow-sm shadow-[#d7eadf]/70 transition hover:border-[#20a464] hover:bg-[#f8fdf9]"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#5f7468]">{item.label}</p>
              <p className="mt-3 text-4xl font-black tracking-tight text-[#101828]">{item.value}</p>
            </div>
            {item.detail ? (
              <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[#067a46]" />
            ) : null}
          </div>
          {item.caption ? <p className="mt-4 text-sm font-black text-[#101828]">{item.caption}</p> : null}
          {item.detail ? <p className="mt-1 text-sm font-semibold text-[#5f7468]">{item.detail}</p> : null}
        </div>
      ))}
    </div>
  )
}
