import { useEffect, useState } from 'react'

const updateDismissedKey = 'football-player:update-prompt-dismissed'

function hasDismissedUpdatePrompt() {
  try {
    return window.sessionStorage?.getItem(updateDismissedKey) === 'true'
  } catch {
    return false
  }
}

function dismissUpdatePromptForSession() {
  try {
    window.sessionStorage?.setItem(updateDismissedKey, 'true')
  } catch {
    // Session storage can be unavailable in hardened browser modes.
  }
}

export function AppUpdatePrompt() {
  const [isUpdateReady, setIsUpdateReady] = useState(false)

  useEffect(() => {
    const handleUpdateReady = () => {
      if (!hasDismissedUpdatePrompt()) {
        setIsUpdateReady(true)
      }
    }

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

  const handleDismiss = () => {
    dismissUpdatePromptForSession()
    setIsUpdateReady(false)
  }

  return (
    <div className="pointer-events-none fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[65] flex justify-center sm:inset-x-auto sm:right-4 sm:justify-end">
      <div className="pointer-events-auto flex w-full max-w-[min(100%,26rem)] flex-wrap items-center gap-2 rounded-lg border border-[#bbf7d0] bg-white px-3 py-2 text-[#101828] shadow-lg shadow-[#047857]/10 sm:w-auto sm:max-w-[26rem] sm:flex-nowrap">
        <div className="min-w-0 flex-1 sm:flex-auto">
          <p className="truncate text-sm font-black leading-5">Update ready</p>
          <p className="truncate text-xs font-semibold leading-5 text-[#4b5f55]">Refresh when finished.</p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2 text-xs font-black text-[#101828] transition hover:bg-[#ecfdf5]"
        >
          Later
        </button>
        <button
          type="button"
          onClick={handleUpdate}
          aria-label="Refresh now"
          className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg bg-[#047857] px-3 py-2 text-xs font-black text-white transition hover:bg-[#065f46]"
        >
          Refresh
        </button>
      </div>
    </div>
  )
}
