export function SessionStatePanel({ action, body, eyebrow = 'Session setup', title }) {
  return (
    <div className="rounded-lg border border-[#bfe8cd] bg-[#f0fdf6] p-4 shadow-sm shadow-[#d7eadf]/70 sm:p-5">
      <div className="flex gap-3">
        <span className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#bfe8cd] bg-white text-sm font-black text-[#067a46]">
          FP
        </span>
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#067a46]">{eyebrow}</p>
          <p className="mt-2 text-base font-black text-[#101828]">{title}</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#456653]">{body}</p>
          {action ? (
            <p className="mt-3 rounded-lg border border-[#bfe8cd] bg-white px-3 py-2 text-sm font-black text-[#101828]">
              {action}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
