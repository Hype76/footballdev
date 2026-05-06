import { useState } from 'react'

export function ConfirmModal({
  confirmLabel = 'Confirm',
  isBusy = false,
  isOpen,
  items = [],
  itemsTitle = 'This will delete:',
  message,
  onCancel,
  onConfirm,
  reasonLabel = 'Reason',
  reasonPlaceholder = '',
  requireReason = false,
  requirePassword = false,
  title = 'Confirm action',
}) {
  const [password, setPassword] = useState('')
  const [reason, setReason] = useState('')
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)

  const resetFields = () => {
    setPassword('')
    setReason('')
    setIsPasswordVisible(false)
  }

  const handleCancel = () => {
    resetFields()
    onCancel()
  }

  const handleConfirm = () => {
    const nextPassword = password
    const nextReason = reason
    resetFields()
    onConfirm(nextPassword, nextReason)
  }

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 py-6">
      <div className="w-full max-w-lg rounded-[28px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 shadow-2xl sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Please confirm</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[var(--text-primary)]">{title}</h2>
        {message ? <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">{message}</p> : null}
        {items.length > 0 ? (
          <div className="mt-4 rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
            <p className="text-sm font-semibold text-[var(--text-primary)]">{itemsTitle}</p>
            <ul className="mt-3 space-y-2">
              {items.map((item) => (
                <li key={item} className="text-sm leading-6 text-[var(--text-muted)]">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {requireReason ? (
          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">{reasonLabel}</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={reasonPlaceholder}
              rows={4}
              className="min-h-28 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
            />
          </label>
        ) : null}
        {requirePassword ? (
          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">
              Enter your password to confirm
            </span>
            <div className="flex rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] focus-within:border-[var(--accent)]">
              <input
                type={isPasswordVisible ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                className="min-h-11 min-w-0 flex-1 rounded-l-2xl bg-transparent px-4 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
              <button
                type="button"
                onClick={() => setIsPasswordVisible((current) => !current)}
                className="min-h-11 rounded-r-2xl px-4 py-3 text-sm font-semibold text-[var(--text-secondary)]"
              >
                {isPasswordVisible ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>
        ) : null}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isBusy}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isBusy || (requirePassword && !password.trim()) || (requireReason && !reason.trim())}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--danger-border)] bg-[var(--danger-soft)] px-5 py-3 text-sm font-semibold text-[var(--danger-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
