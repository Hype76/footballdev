import { getCoachNotificationHistory } from '../../mobile-core/src/coachNotificationHistory'
import { peekMobileResource, readMobileResource } from '../../mobile-core/src/mobileResourceCache'
import { readCoachOfflineResources, saveCoachOfflineResources } from './offline'

export const COACH_NOTIFICATION_RESOURCE = 'coach:notifications'

export async function loadCoachNotificationHistory(user, context, { force = false, onSaved } = {}) {
  const recent = peekMobileResource(user, COACH_NOTIFICATION_RESOURCE)
  if (recent !== undefined) onSaved?.(recent)
  const saved = recent === undefined ? await readCoachOfflineResources(user.id, context).catch(() => null) : null
  const previous = recent ?? saved?.resources?.notifications
  if (Array.isArray(previous)) onSaved?.(previous)
  if (user.isOfflineProfile) return { items: previous || [], stale: true }
  try {
    const items = await readMobileResource(user, COACH_NOTIFICATION_RESOURCE, () => getCoachNotificationHistory(user), { force })
    void saveCoachOfflineResources(user.id, context, { notifications: items }).catch(() => {})
    return { items, stale: false }
  } catch (error) {
    if (Array.isArray(previous)) return { items: previous, stale: true }
    throw error
  }
}
