export function SessionStatePanel({ action, body, eyebrow = 'Session setup', title }) {
  return (
    <div className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] p-4 shadow-sm shadow-[#1d4ed8]/10 sm:p-5">
      <div className="flex gap-3">
        <span className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#bfdbfe] bg-white text-sm font-black text-[#1d4ed8]">
          FP
        </span>
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#1d4ed8]">{eyebrow}</p>
          <p className="mt-2 text-base font-black text-[#0f172a]">{title}</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#475569]">{body}</p>
          {action ? (
            <p className="mt-3 rounded-lg border border-[#bfdbfe] bg-white px-3 py-2 text-sm font-black text-[#0f172a]">
              {action}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
