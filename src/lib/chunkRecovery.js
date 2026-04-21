const CHUNK_RECOVERY_KEY = 'football-dev-chunk-recovery-at'
const CHUNK_RECOVERY_WINDOW_MS = 10000

export function isDynamicImportError(error) {
  const message = String(error?.message ?? error ?? '').toLowerCase()

  return (
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('importing a module script failed') ||
    message.includes('loading chunk') ||
    message.includes('chunkloaderror')
  )
}

export function recoverFromStaleChunk(error) {
  if (!isDynamicImportError(error) || typeof window === 'undefined') {
    return false
  }

  const now = Date.now()
  const previousAttempt = Number(window.sessionStorage.getItem(CHUNK_RECOVERY_KEY) ?? 0)

  if (previousAttempt && now - previousAttempt < CHUNK_RECOVERY_WINDOW_MS) {
    return false
  }

  window.sessionStorage.setItem(CHUNK_RECOVERY_KEY, String(now))
  window.location.reload()
  return true
}

export function clearChunkRecoveryMarker() {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.removeItem(CHUNK_RECOVERY_KEY)
}
