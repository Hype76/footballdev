import { isParentDefinitelyOffline } from './parentExperience.js'
import { mobileResourceKey } from '../../mobile-core/src/mobileResourceCache.js'

export function parentConnectivityScope(user, link) {
  return JSON.stringify([mobileResourceKey(user, 'parent-connectivity'), link?.id, link?.clubId, link?.teamId, link?.playerId, Boolean(user?.isOfflineProfile)])
}

export function createParentConnectivityMonitor({ probe, onChange }) {
  let generation = 0
  let disposed = false
  return {
    update(state) {
      if (disposed) return
      const request = ++generation
      const offline = isParentDefinitelyOffline(state)
      const unverified = state?.isConnected === true && state?.isInternetReachable === false
      onChange(offline, unverified)
      if (state?.isConnected !== true || state?.isInternetReachable !== false) return
      void Promise.resolve().then(probe).then(() => {
        if (!disposed && request === generation) onChange(false, false)
      }).catch(() => {})
    },
    dispose() { disposed = true; generation += 1 },
  }
}
