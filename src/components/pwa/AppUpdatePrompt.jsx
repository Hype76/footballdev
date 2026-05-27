import { useEffect, useState } from 'react'

export function AppUpdatePrompt() {
  const [isUpdateReady, setIsUpdateReady] = useState(false)

  useEffect(() => {
    const handleUpdateReady = () => setIsUpdateReady(true)

    window.addEventListener('football-player:update-ready', handleUpdateReady)

    return () => {
      window.removeEventListener('football-player:update-ready', handleUpdateReady)
    }
  }, [])

  if (!isUpdateReady) {
    return null
  }

  const handleUpdate = () => {
    if (typeof window.footballPlayerApplyUpdate === 'function') {
      window.footballPlayerApplyUpdate()
      return
    }

    window.location.reload()
  }

  return (
    <div className="fixed inset-x-4 bottom-4 z-[70] rounded-lg border border-[var(--accent)] bg-[var(--panel-bg)] p-4 text-[var(--text-primary)] shadow-xl shadow-black/30 sm:left-auto sm:w-[26rem]">
      <p className="text-sm font-semibold">Update available</p>
      <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
        A newer version of Football Player is ready. Refresh when you are not in the middle of a note or assessment.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => setIsUpdateReady(false)}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)]"
        >
          Later
        </button>
        <button
          type="button"
          onClick={handleUpdate}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-4 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90"
        >
          Refresh now
        </button>
      </div>
    </div>
  )
}
