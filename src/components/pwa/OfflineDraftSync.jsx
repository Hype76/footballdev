import { useEffect, useState } from 'react'
import { getQueuedDrafts, syncDrafts } from '../../lib/offline-drafts.js'
import { useAuth } from '../../lib/auth.js'

function getPendingDraftCount(user) {
  return getQueuedDrafts({ user }).length
}

export default function OfflineDraftSync() {
  const { user } = useAuth()
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [isSyncing, setIsSyncing] = useState(false)
  const [pendingDraftCount, setPendingDraftCount] = useState(() => getPendingDraftCount(user))
  const [syncMessage, setSyncMessage] = useState('')

  useEffect(() => {
    let isMounted = true
    let syncInFlight = false

    const refreshDraftCount = () => {
      setPendingDraftCount(getPendingDraftCount(user))
    }

    const runSync = async () => {
      if (!navigator.onLine || document.visibilityState === 'hidden' || syncInFlight) {
        refreshDraftCount()
        return
      }

      const pendingCount = getPendingDraftCount(user)

      if (pendingCount === 0) {
        setSyncMessage('')
        return
      }

      syncInFlight = true
      setIsSyncing(true)
      setSyncMessage('Back online. Syncing drafts...')

      try {
        const result = await syncDrafts({ user })

        if (!isMounted) {
          return
        }

        refreshDraftCount()
        setSyncMessage(result.failed > 0 || getPendingDraftCount(user) > 0 ? 'Some drafts are still saved locally' : 'All drafts synced')
      } catch {
        if (isMounted) setSyncMessage('Saved drafts could not sync. Reconnect and retry.')
      } finally {
        syncInFlight = false
        if (isMounted) {
          setIsSyncing(false)
        }
      }
    }

    const handleOnline = () => {
      setIsOnline(true)
      void runSync()
    }

    const handleOffline = () => {
      setIsOnline(false)
      refreshDraftCount()
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('offline-drafts-changed', refreshDraftCount)

    void runSync()
    const intervalId = window.setInterval(() => {
      void runSync()
    }, 45000)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('offline-drafts-changed', refreshDraftCount)
    }
  }, [user])

  useEffect(() => {
    if (syncMessage !== 'All drafts synced') {
      return undefined
    }

    const timeoutId = window.setTimeout(() => setSyncMessage(''), 3000)

    return () => window.clearTimeout(timeoutId)
  }, [syncMessage])

  if (isOnline && pendingDraftCount === 0 && !syncMessage) {
    return null
  }

  const message = !isOnline
    ? pendingDraftCount ? `Offline. ${pendingDraftCount} saved draft${pendingDraftCount === 1 ? '' : 's'} waiting to sync.` : 'Offline. Some information and actions need a connection.'
    : syncMessage || `${pendingDraftCount} draft${pendingDraftCount === 1 ? '' : 's'} waiting to sync`

  return (
    <div role="status" aria-live="polite" className="fixed bottom-[var(--mobile-floating-bottom-clearance)] left-4 z-50 max-w-sm rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-lg shadow-[#047857]/10 transition-[bottom] duration-150 motion-reduce:transition-none">
      {isSyncing ? 'Syncing drafts...' : message}
    </div>
  )
}
