import { useEffect, useState } from 'react'

function isStandaloneMode() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

export default function InstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState(null)

  useEffect(() => {
    if (isStandaloneMode()) {
      return undefined
    }

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault()
      setInstallPrompt(event)
    }

    const handleAppInstalled = () => {
      setInstallPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  if (!installPrompt) {
    return null
  }

  const handleInstall = async () => {
    await installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }

  return (
    <button
      type="button"
      onClick={handleInstall}
      className="fixed bottom-4 right-4 z-50 rounded-2xl border border-lime-300/50 bg-lime-300 px-5 py-3 text-sm font-black text-black shadow-2xl shadow-lime-300/20 transition hover:bg-lime-200"
    >
      Install app
    </button>
  )
}
