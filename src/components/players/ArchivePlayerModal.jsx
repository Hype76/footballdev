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
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#06140d]/70 px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-lg overflow-hidden rounded-lg border border-[#bddcca] bg-white shadow-2xl shadow-[#06140d]/25"
      >
        <div className="border-b border-[#bddcca] bg-[#fff5f5] px-5 py-5 sm:px-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">Archive player</p>
          <h2 className="mt-3 pr-12 text-2xl font-black tracking-tight text-[#10231a]">
            Move {player?.playerName || 'this player'} out of the active register
          </h2>
          <p className="mt-3 text-sm font-semibold leading-6 text-[#456653]">
            This removes the player from active lists, sessions, and normal selection. They can be restored from Archived Players later.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={isBusy}
          title={isBusy ? 'Please wait while this player is being archived.' : 'Close this window'}
          aria-label="Close this window"
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-white text-sm font-black text-[#10231a] transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          X
        </button>
        <div className="px-5 py-5 sm:px-6">
          <div className="rounded-lg border border-[#bddcca] bg-[#f6fbf8] p-4 text-sm font-semibold text-[#456653] shadow-sm shadow-[#067a46]/10">
            <p className="font-black text-[#10231a]">{player?.playerName || 'Selected player'}</p>
            <p className="mt-1">{player?.team || 'No team entered'} | {player?.section || 'No section entered'}</p>
          </div>
          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-black text-[#10231a]">Archive reason *</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows="4"
              className="min-h-28 w-full rounded-lg border border-[#bddcca] bg-[#f6fbf8] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition placeholder:text-[#789083] focus:border-red-500 focus:bg-white focus:ring-2 focus:ring-red-100"
              placeholder="Example: Player no longer attending trial sessions."
            />
          </label>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={isBusy}
              title={isBusy ? 'Please wait while this player is being archived.' : undefined}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bddcca] bg-white px-5 py-3 text-sm font-black text-[#10231a] transition hover:bg-[#f0fdf6] disabled:cursor-not-allowed disabled:opacity-60"
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
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-500/40 bg-red-600 px-5 py-3 text-sm font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isBusy ? 'Archiving...' : 'Archive player'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
