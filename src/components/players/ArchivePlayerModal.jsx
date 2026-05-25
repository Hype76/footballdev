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
      const timeoutId = window.setTimeout(() => setReason(''), 0)
      return () => window.clearTimeout(timeoutId)
    }

    return undefined
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  const trimmedReason = reason.trim()

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/70 px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-lg overflow-hidden rounded-md border border-slate-200 bg-white shadow-2xl"
      >
        <div className="border-b border-slate-200 bg-rose-50 px-5 py-5 sm:px-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-rose-700">Archive player</p>
          <h2 className="mt-3 pr-12 text-2xl font-black tracking-tight text-slate-950">
            Move {player?.playerName || 'this player'} out of the active register
          </h2>
          <p className="mt-3 text-sm font-semibold leading-6 text-slate-700">
            This removes the player from active lists, sessions, and normal selection. They can be restored from Archived Players later.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={isBusy}
          title={isBusy ? 'Please wait while this player is being archived.' : 'Close this window'}
          aria-label="Close this window"
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-md border border-rose-200 bg-white text-sm font-black text-slate-950 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          X
        </button>
        <div className="px-5 py-5 sm:px-6">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-600">
            <p className="font-black text-slate-950">{player?.playerName || 'Selected player'}</p>
            <p className="mt-1">{player?.team || 'No team entered'} | {player?.section || 'No section entered'}</p>
          </div>
          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-black text-slate-900">Archive reason *</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows="4"
              className="min-h-28 w-full rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
              placeholder="Example: Player no longer attending trial sessions."
            />
          </label>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={isBusy}
              title={isBusy ? 'Please wait while this player is being archived.' : undefined}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onConfirm(trimmedReason)}
              disabled={isBusy || !trimmedReason}
              title={
                isBusy
                  ? 'Please wait while this player is being archived.'
                  : !trimmedReason
                    ? 'Enter a reason before archiving this player.'
                    : undefined
              }
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-rose-300 bg-rose-600 px-5 py-3 text-sm font-black text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isBusy ? 'Archiving...' : 'Archive player'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
