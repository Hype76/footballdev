import { useEffect, useState } from 'react'

export function ArchivePlayerModal({
  isBusy = false,
  isOpen,
  onCancel,
  onConfirm,
  player,
}) {
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (!isOpen) {
      setReason('')
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  const trimmedReason = reason.trim()

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 py-6">
      <div className="w-full max-w-lg rounded-[28px] border border-[var(--border-color)] bg-[var(--panel-bg)] p-5 shadow-2xl sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Archive player</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          Move {player?.playerName || 'this player'} to archive
        </h2>
        <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
          This removes the player from active player lists, sessions, and normal selection. They can be restored from Archived Players later.
        </p>
        <div className="mt-4 rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 text-sm text-[var(--text-muted)]">
          <p className="font-semibold text-[var(--text-primary)]">{player?.playerName || 'Selected player'}</p>
          <p className="mt-1">{player?.team || 'No team entered'} | {player?.section || 'No section entered'}</p>
        </div>
        <label className="mt-4 block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Archive reason *</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows="4"
            className="min-h-28 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
            placeholder="Example: Player no longer attending trial sessions."
          />
        </label>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(trimmedReason)}
            disabled={isBusy || !trimmedReason}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[var(--danger-border)] bg-[var(--danger-soft)] px-5 py-3 text-sm font-semibold text-[var(--danger-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? 'Archiving...' : 'Archive Player'}
          </button>
        </div>
      </div>
    </div>
  )
}
