import { useMatchDayWakeLock } from '../../lib/use-matchday-wake-lock.js'

export function MatchDayWakeLockControl({ active = true }) {
  const wakeLock = useMatchDayWakeLock({ active })

  return (
    <section className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-3" aria-label="Screen awake control">
      <label className="flex min-h-10 items-center justify-between gap-3 text-sm font-black text-[#101828]">
        <span>
          Keep screen awake
          <span className="mt-1 block text-xs font-semibold text-[#4b5f55]">Optional for this browser session. No Match Day data is changed.</span>
        </span>
        <input
          type="checkbox"
          checked={wakeLock.enabled}
          onChange={(event) => wakeLock.setEnabled(event.target.checked)}
          className="h-5 w-5 shrink-0 accent-[#047857]"
        />
      </label>
      {wakeLock.enabled ? (
        <p className={`mt-2 text-xs font-bold ${wakeLock.isActive ? 'text-[#047857]' : 'text-[#92400e]'}`} role="status">
          {wakeLock.isActive ? 'Screen awake is active.' : wakeLock.errorMessage || 'Requesting screen awake access...'}
        </p>
      ) : null}
    </section>
  )
}
