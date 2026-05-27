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
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#101828]/70 px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-lg overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-2xl shadow-[#101828]/25"
      >
        <div className="border-b border-[#d7e5dc] bg-[#fff5f5] px-5 py-5 sm:px-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">Archive player</p>
          <h2 className="mt-3 pr-12 text-2xl font-black tracking-tight text-[#101828]">
            Move {player?.playerName || 'this player'} out of the active register
          </h2>
          <p className="mt-3 text-sm font-semibold leading-6 text-[#4b5f55]">
            This removes the player from active lists, sessions, and normal selection. They can be restored from Archived Players later.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={isBusy}
          title={isBusy ? 'Please wait while this player is being archived.' : 'Close this window'}
          aria-label="Close this window"
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-white text-sm font-black text-[#101828] transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          X
        </button>
        <div className="px-5 py-5 sm:px-6">
          <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 text-sm font-semibold text-[#4b5f55] shadow-sm shadow-[#047857]/10">
            <p className="font-black text-[#101828]">{player?.playerName || 'Selected player'}</p>
            <p className="mt-1">Team: {player?.team || 'No team entered'}, Section: {player?.section || 'No section entered'}</p>
          </div>
          <label className="mt-4 block">
            <span className="mb-2 block text-sm font-black text-[#101828]">Archive reason *</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows="4"
              className="min-h-28 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#66756c] focus:border-red-500 focus:bg-white focus:ring-2 focus:ring-red-100"
              placeholder="Example: Player no longer attending trial sessions."
            />
          </label>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={isBusy}
              title={isBusy ? 'Please wait while this player is being archived.' : undefined}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] transition hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60"
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
