let tail = Promise.resolve()

// Records and media share one disk budget. Serialising commits prevents two
// independent downloads from both spending the same remaining space.
export function withCoachOfflineStorageLock(operation) {
  const pending = tail.catch(() => {}).then(operation)
  tail = pending.catch(() => {})
  return pending
}
