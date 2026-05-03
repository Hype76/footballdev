import { useEffect, useState } from 'react'
import { getQueuedDrafts, syncDrafts } from '../../lib/offline-drafts.js'

function getPendingDraftCount() {
  return getQueuedDrafts().length
}

export default function OfflineDraftSync() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [isSyncing, setIsSyncing] = useState(false)
  const [pendingDraftCount, setPendingDraftCount] = useState(getPendingDraftCount)
  const [syncMessage, setSyncMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    const refreshDraftCount = () => {
      setPendingDraftCount(getPendingDraftCount())
    }

    const runSync = async () => {
      if (!navigator.onLine || isSyncing) {
        refreshDraftCount()
        return
      }

      const pendingCount = getPendingDraftCount()

      if (pendingCount === 0) {
        setSyncMessage('')
        return
      }

      setIsSyncing(true)
      setSyncMessage('Back online - syncing drafts...')

      try {
        const result = await syncDrafts()

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
  }, [isSyncing])

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
    ? `Offline - saving locally${pendingDraftCount ? ` (${pendingDraftCount})` : ''}`
    : syncMessage || `${pendingDraftCount} draft${pendingDraftCount === 1 ? '' : 's'} waiting to sync`

  return (
    <div className="fixed bottom-4 left-4 z-50 max-w-sm rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] shadow-2xl shadow-black/30">
      {isSyncing ? 'Syncing drafts...' : message}
    </div>
  )
}
