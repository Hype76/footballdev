import { useEffect, useState } from 'react'
import { initPWAInstall, isIosDevice, isStandaloneMode, triggerInstall } from '../../lib/pwa-install.js'

export default function InstallAppButton({ className = '', helpClassName = '', wrapperClassName = 'contents' }) {
  const [canInstall, setCanInstall] = useState(false)
  const [installMessage, setInstallMessage] = useState('')
  const [isStandalone] = useState(() => isStandaloneMode())
  const [showIosHelp] = useState(() => isIosDevice())

  useEffect(() => {
    if (isStandalone) {
      return undefined
    }

    return initPWAInstall(setCanInstall)
  }, [isStandalone])

  if (isStandalone) {
    return null
  }

  const handleInstall = async () => {
    const didPrompt = await triggerInstall()
    setCanInstall(false)

    if (!didPrompt) {
      setInstallMessage(
        showIosHelp
          ? 'Tap Share, then Add to Home Screen'
          : 'Use your browser menu, then choose Install App or Add to Home Screen',
      )
    }
  }

  return (
    <div className={wrapperClassName}>
      <button type="button" onClick={handleInstall} className={className} data-install-ready={canInstall}>
        Install App
      </button>
      {installMessage ? <p className={helpClassName}>{installMessage}</p> : null}
    </div>
  )
}
