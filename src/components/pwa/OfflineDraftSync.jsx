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

    const refreshDraftCount = () => {
      setPendingDraftCount(getPendingDraftCount(user))
    }

    const runSync = async () => {
      if (!navigator.onLine || isSyncing) {
        refreshDraftCount()
        return
      }

      const pendingCount = getPendingDraftCount(user)

      if (pendingCount === 0) {
        setSyncMessage('')
        return
      }

      setIsSyncing(true)
      setSyncMessage('Back online. Syncing drafts...')

      try {
        const result = await syncDrafts({ user })

        if (!isMounted) {
          return
        }

        refreshDraftCount()
        setSyncMessage(result.failed > 0 ? 'Some drafts are still saved locally' : 'All drafts synced')
      } finally {
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
  }, [isSyncing, user])

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
    ? `Offline. Saving locally${pendingDraftCount ? ` (${pendingDraftCount})` : ''}`
    : syncMessage || `${pendingDraftCount} draft${pendingDraftCount === 1 ? '' : 's'} waiting to sync`

  return (
    <div className="fixed bottom-4 left-4 z-50 max-w-sm rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-lg shadow-[#047857]/10">
      {isSyncing ? 'Syncing drafts...' : message}
    </div>
  )
}
