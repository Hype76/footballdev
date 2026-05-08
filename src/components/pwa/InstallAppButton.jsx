import { useEffect, useState } from 'react'
import { initPWAInstall, isStandaloneMode, triggerInstall } from '../../lib/pwa-install.js'

export default function InstallAppButton({ className = '', wrapperClassName = 'contents' }) {
  const [canInstall, setCanInstall] = useState(false)
  const [isStandalone] = useState(() => isStandaloneMode())

  useEffect(() => {
    if (isStandalone) {
      return undefined
    }

    return initPWAInstall(setCanInstall)
  }, [isStandalone])

  if (isStandalone || !canInstall) {
    return null
  }

  const handleInstall = async () => {
    await triggerInstall()
    setCanInstall(false)
  }

  return (
    <div className={wrapperClassName}>
      <button type="button" onClick={handleInstall} className={className}>
        Install App
      </button>
    </div>
  )
}
