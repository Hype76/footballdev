export function NoticeBanner({ title, message, tone = 'error' }) {
  const toneClassName =
    tone === 'error'
      ? 'border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger-text)]'
      : 'border-[var(--border-color)] bg-[var(--panel-alt)] text-[var(--text-primary)]'

  return (
    <div className={`rounded-[20px] border px-4 py-4 ${toneClassName}`}>
      <p className="text-sm font-semibold">{title}</p>
      {message ? <p className="mt-1 text-sm leading-6 opacity-90">{message}</p> : null}
    </div>
  )
}
