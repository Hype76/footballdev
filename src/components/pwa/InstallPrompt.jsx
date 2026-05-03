import { useEffect, useState } from 'react'
import { initPWAInstall, isIosDevice, isStandaloneMode, triggerInstall } from '../../lib/pwa-install.js'

export default function InstallPrompt() {
  const [canInstall, setCanInstall] = useState(false)
  const [showIosHelp] = useState(() => !isStandaloneMode() && isIosDevice())

  useEffect(() => {
    if (isStandaloneMode()) {
      return undefined
    }

    return initPWAInstall(setCanInstall)
  }, [])

  if (!canInstall && !showIosHelp) {
    return null
  }

  const handleInstall = async () => {
    await triggerInstall()
    setCanInstall(false)
  }

  return canInstall ? (
    <button
      type="button"
      onClick={handleInstall}
      className="fixed bottom-4 right-4 z-50 rounded-2xl border border-lime-300/50 bg-lime-300 px-5 py-3 text-sm font-black text-black shadow-2xl shadow-lime-300/20 transition hover:bg-lime-200"
    >
      Install App
    </button>
  ) : (
    <div className="fixed bottom-4 right-4 z-50 max-w-xs rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] shadow-2xl shadow-black/30">
      Tap Share, then Add to Home Screen
    </div>
  )
}
