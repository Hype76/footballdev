// Local acceptance is complete only after encrypted persistence succeeds.
// Remote confirmation must not keep the originating phone action locked.
export function releaseCancelledParentLoads(resources) {
  return Object.fromEntries(Object.entries(resources).map(([name, resource]) => [name, {
    ...resource,
    loading: false,
    error: resource.loading && !resource.items?.length
      ? resource.error || 'Refresh this section to load your information.' : resource.error,
  }]))
}

export async function acceptDurableMobileAction({ enqueue, isCurrent, onAccepted, sync, onSynced, onSyncError }) {
  const command = await enqueue()
  if (!isCurrent()) return { command, background: Promise.resolve(null) }
  onAccepted(command)
  const background = Promise.resolve().then(sync).then(async result => {
    if (isCurrent()) await onSynced?.(result, command)
    return result
  }).catch(error => {
    if (isCurrent()) onSyncError?.(error)
    return null
  })
  return { command, background }
}
