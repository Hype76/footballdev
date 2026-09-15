import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { parseFanAppLink } from '../../mobile-core/src/fanAppLinkCore'

const pendingKey = 'fp.parent.pending-fan-invitation.v1'
export function useFanAppLink() {
  const [route, setRoute] = useState(null)
  const revision = useRef(0)
  const storage = useRef(Promise.resolve())
  const save = useCallback(next => {
    storage.current = storage.current.catch(() => {}).then(() => next?.kind === 'invite'
      ? SecureStore.setItemAsync(pendingKey, `footballplayerparents://fan-invite/${next.token}`)
      : SecureStore.deleteItemAsync(pendingKey)).catch(() => {})
  }, [])
  const select = useCallback(next => { revision.current++; setRoute(next); save(next) }, [save])
  useEffect(() => {
    let active = true
    const initialRevision = revision.current
    const subscription = Linking.addEventListener('url', event => {
      const next = parseFanAppLink(event.url)
      if (next) select(next)
    })
    Promise.all([Linking.getInitialURL().catch(() => null), SecureStore.getItemAsync(pendingKey).catch(() => null)]).then(([initial, saved]) => {
      if (!active || revision.current !== initialRevision) return
      const next = parseFanAppLink(initial) || parseFanAppLink(saved)
      if (next) select(next)
    })
    return () => { active = false; subscription.remove() }
  }, [select])
  return { route, close: useCallback(() => select(null), [select]), accepted: useCallback(() => select({ kind: 'fans' }), [select]) }
}
