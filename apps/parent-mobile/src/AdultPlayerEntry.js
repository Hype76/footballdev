import { useEffect, useRef, useState } from 'react'
import { AdultPlayerScreen } from './AdultPlayerScreen'
import { selectAdultPlayerView } from './adultPlayerAccess.js'
import { prepareAdultPlayerNotificationMode, resolveAdultPlayerNotificationMode } from './adultPlayerNotificationsCore.js'
import { useAdultPlayerAccess } from './useAdultPlayerAccess'

export function AdultPlayerEntry({ userId, links, parentProfilePending, onSignOut, renderParent, renderFan, renderPlayer, notificationResponse, onRejectPlayerNotification, wasPlayerNotificationHandled }) {
  const { access, refresh } = useAdultPlayerAccess(userId)
  const hasParent = links.some(link => link.linkType !== 'fan')
  const hasFan = !hasParent && links.some(link => link.linkType === 'fan')
  const [preferredMode, setPreferredMode] = useState(null)
  const pendingPush = useRef(null)
  const responseId = notificationResponse?.notification?.request?.identifier || ''
  const data = notificationResponse?.notification?.request?.content?.data
  useEffect(() => {
    if (!responseId || data?.app !== 'player') return undefined
    let current = true
    const pending = { responseId, data, retry: false }
    pendingPush.current = pending
    void (async () => {
      if (await wasPlayerNotificationHandled?.(userId, responseId)) {
        if (current && pendingPush.current === pending) pendingPush.current = null
        return 'handled'
      }
      if (!current || pendingPush.current !== pending) return 'stale'
      return prepareAdultPlayerNotificationMode({
      data, userId, refresh, isCurrent: () => current && pendingPush.current === pending,
      selectPlayer: () => { pendingPush.current = null; setPreferredMode('player') },
      reject: () => { pendingPush.current = null; onRejectPlayerNotification?.(responseId) },
      })
    })().then(outcome => { if (current && outcome === 'retry') pending.retry = true }).catch(() => { if (current) pending.retry = true })
    return () => { current = false }
  }, [responseId, data, userId, refresh, onRejectPlayerNotification, wasPlayerNotificationHandled])

  // A failed check remains pending. Existing foreground/manual access refreshes
  // can finish the switch after connectivity returns without replaying a tap.
  useEffect(() => {
    const pending = pendingPush.current
    if (!pending?.retry) return
    const outcome = resolveAdultPlayerNotificationMode(pending.data, userId, access)
    if (outcome === 'retry') return
    void Promise.resolve().then(() => {
      if (pendingPush.current !== pending) return
      pendingPush.current = null
      if (outcome === 'player') setPreferredMode('player')
      else onRejectPlayerNotification?.(pending.responseId)
    })
  }, [access, userId, onRejectPlayerNotification])

  const view = parentProfilePending ? 'checking' : selectAdultPlayerView({ access, hasParent, hasFan, preferredMode })

  const openPlayer = access.status === 'linked' ? () => setPreferredMode('player') : null
  if (view === 'fan') return renderFan(openPlayer)
  if (view === 'parent') return renderParent({ openPlayer, playerAccess: { refresh, error: access.message } })

  if (view === 'player' && access.link && renderPlayer) return renderPlayer({ link: access.link, openOtherAccount: hasParent || hasFan ? () => setPreferredMode(hasParent ? 'parent' : 'fan') : null })

  return (
    <AdultPlayerScreen key={access.link?.id || 'access'} access={parentProfilePending ? { status: 'checking' } : access} onRefresh={refresh} onSignOut={onSignOut}
      onSwitchAccount={hasParent || hasFan ? () => setPreferredMode(hasParent ? 'parent' : 'fan') : null}
      switchLabel={hasParent ? 'Open Parent account' : 'Open Fan account'} />
  )
}
