export const PARENT_OFFLINE_MAX_BYTES = 500_000_000

export function assertParentOfflineCapacity(document, byteLength) {
  if (typeof byteLength !== 'function') throw new Error('offline_storage_size_unavailable')
  const size = byteLength(JSON.stringify(document))
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('offline_storage_size_unavailable')
  if (size > PARENT_OFFLINE_MAX_BYTES) throw new Error('There is not enough offline storage. Reconnect and sync before recording more.')
  return size
}
