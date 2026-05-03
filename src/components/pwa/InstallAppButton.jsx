import { useEffect, useState } from 'react'
import { initPWAInstall, isIosDevice, isStandaloneMode, triggerInstall } from '../../lib/pwa-install.js'

export default function InstallAppButton({ className = '', helpClassName = '' }) {
  const [canInstall, setCanInstall] = useState(false)
  const [installMessage, setInstallMessage] = useState('')
  const [showButton] = useState(() => !isStandaloneMode())
  const [showIosHelp] = useState(() => !isStandaloneMode() && isIosDevice())

  useEffect(() => {
    if (!showButton) {
      return undefined
    }

    return initPWAInstall(setCanInstall)
  }, [showButton])

  if (!showButton) {
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
    <div className="contents">
      <button type="button" onClick={handleInstall} className={className} data-install-ready={canInstall}>
        Install App
      </button>
      {installMessage ? <p className={helpClassName}>{installMessage}</p> : null}
    </div>
  )
}
