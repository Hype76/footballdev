let deferredPrompt = null

export function isStandaloneMode() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

export function isIosDevice() {
  const userAgent = window.navigator.userAgent.toLowerCase()
  return /iphone|ipad|ipod/.test(userAgent)
}

export function initPWAInstall(setCanInstall) {
  const handleBeforeInstallPrompt = (event) => {
    event.preventDefault()
    console.log('PWA install available')
    deferredPrompt = event
    setCanInstall(true)
  }

  const handleAppInstalled = () => {
    deferredPrompt = null
    setCanInstall(false)
  }

  window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  window.addEventListener('appinstalled', handleAppInstalled)

  return () => {
    window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.removeEventListener('appinstalled', handleAppInstalled)
  }
}

export async function triggerInstall() {
  if (!deferredPrompt) {
    return false
  }

  deferredPrompt.prompt()
  await deferredPrompt.userChoice
  deferredPrompt = null
  return true
}
