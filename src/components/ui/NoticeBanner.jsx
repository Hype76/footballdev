export function NoticeBanner({ title, message, tone = 'error' }) {
  const toneClassName =
    tone === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-900'
      : 'border-[#bfdbfe] bg-[#eff6ff] text-[#0f172a]'

  return (
    <div className={`rounded-lg border px-4 py-4 shadow-sm ${toneClassName}`}>
      <p className="text-sm font-black">{title}</p>
      {message ? <p className="mt-1 text-sm leading-6 opacity-90">{message}</p> : null}
    </div>
  )
}
