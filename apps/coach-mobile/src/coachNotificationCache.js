import { getCoachNotificationHistory } from '../../mobile-core/src/coachNotificationHistory'
import { invalidateMobileResource, mobileResourceKey, peekMobileResource, readMobileResource } from '../../mobile-core/src/mobileResourceCache'
import { readCoachOfflineResources, saveCoachOfflineResources } from './offline'

export const COACH_NOTIFICATION_RESOURCE = 'coach:notifications'
const deniedScopes = new Set()
const scopeGenerations = new Map()
const scopeJobs = new Map()
const scopeSubscribers = new Map()
const superseded = Symbol('superseded notification refresh')

export function loadCoachNotificationHistory(user, context, { force = false, onSaved } = {}) {
  const scope = JSON.stringify([mobileResourceKey(user, COACH_NOTIFICATION_RESOURCE), context?.id, context?.authorityId, context?.authoritySource, context?.role, context?.roleRank, context?.paymentAccess])
  const generation = (scopeGenerations.get(scope) || 0) + 1
  scopeGenerations.set(scope, generation)
  const previous = scopeJobs.get(scope)
  let supersede
  const supersededSignal = new Promise(resolve => { supersede = resolve })
  const entry = { promise: null, supersede, successor: null }
  scopeJobs.set(scope, entry)
  if (previous) { previous.successor = entry; previous.supersede() }
  const subscribers = scopeSubscribers.get(scope) || new Set()
  scopeSubscribers.set(scope, subscribers)
  const subscriber = { onSaved }
  subscribers.add(subscriber)
  const assertCurrent = () => {
    if (scopeGenerations.get(scope) !== generation) throw superseded
  }
  const job = Promise.race([
    runNotificationRefresh(user, context, { force, onSaved, scope, assertCurrent }),
    supersededSignal.then(() => { throw superseded }),
  ]).catch(async error => {
    if (error !== superseded) throw error
    return await entry.successor.promise
  }).finally(() => {
    if (scopeJobs.get(scope)?.promise === job) scopeJobs.delete(scope)
    subscribers.delete(subscriber)
    if (!subscribers.size) scopeSubscribers.delete(scope)
  })
  entry.promise = job
  return job
}

async function runNotificationRefresh(user, context, { force, onSaved, scope, assertCurrent }) {
  const denied = deniedScopes.has(scope)
  const recent = denied ? undefined : peekMobileResource(user, COACH_NOTIFICATION_RESOURCE, { allowStale: true })
  if (recent !== undefined) onSaved?.(recent)
  const offline = !denied && recent === undefined ? readCoachOfflineResources(user.id, context).catch(() => null) : Promise.resolve(null)
  if (user.isOfflineProfile) {
    const saved = await offline
    assertCurrent()
    const previous = recent ?? saved?.resources?.notifications
    if (recent === undefined && Array.isArray(previous)) onSaved?.(previous)
    return { items: previous || [], stale: true }
  }
  const network = readMobileResource(user, COACH_NOTIFICATION_RESOURCE, () => getCoachNotificationHistory(user), { force: force || denied })
    .then(items => ({ items }), error => ({ error }))
  const first = await Promise.race([network.then(result => ({ result })), offline.then(saved => ({ saved }))])
  assertCurrent()
  let previous = recent
  if ('saved' in first && recent === undefined && Array.isArray(first.saved?.resources?.notifications)) {
    previous = first.saved.resources.notifications
    onSaved?.(previous)
  }
  const result = first.result || await network
  assertCurrent()
  if (!result.error) {
    deniedScopes.delete(scope)
    const items = result.items
    void saveCoachOfflineResources(user.id, context, { notifications: items }).catch(() => {})
    return { items, stale: false }
  }
  if (result.error?.code === '42501' || result.error?.status === 403 || result.error?.statusCode === 403 || /permission denied|row.level security|not authori[sz]ed/i.test(String(result.error?.message || ''))) {
    deniedScopes.add(scope)
    invalidateMobileResource(user, COACH_NOTIFICATION_RESOURCE)
    for (const subscriber of scopeSubscribers.get(scope) || []) subscriber.onSaved?.([])
    try {
      await saveCoachOfflineResources(user.id, context, { notifications: [] })
    } catch (purgeError) {
      assertCurrent()
      const failure = new Error('Notification access was denied, and saved notifications could not be cleared from this phone.')
      failure.code = result.error?.code || (result.error?.status === 403 || result.error?.statusCode === 403 ? '42501' : undefined)
      failure.cause = purgeError
      throw failure
    }
    assertCurrent()
    throw result.error
  }
  if (!Array.isArray(previous)) previous = (await offline)?.resources?.notifications
  assertCurrent()
  if (Array.isArray(previous)) return { items: previous, stale: true }
  throw result.error
}
