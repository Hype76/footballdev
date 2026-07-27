export function NoticeBanner({ title, message, tone = 'error' }) {
  const toneClassName =
    tone === 'error'
      ? 'border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger-text)]'
      : 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text-primary)]'

  return (
    <div className={`rounded-lg border px-4 py-4 shadow-sm ${toneClassName}`}>
      <p className="text-sm font-black">{title}</p>
      {message ? <p className="mt-1 text-sm leading-6 opacity-90">{message}</p> : null}
    </div>
  )
}
