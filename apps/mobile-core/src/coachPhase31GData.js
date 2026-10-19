import { getCoachCalendarResources } from './coachCalendarData'
import { getCoachChatRooms, getCoachDevelopmentSummary, getCoachInvitesAndAvailability, getCoachPolls } from './coachPhase31EData'
import { readMobileResource } from './mobileResourceCache'
import { buildCoachHomeOperationalSnapshot, mergeCoachHomeOperationalSnapshots } from './coachPhase31GCore'
import { getCoachMatchDays, getCoachSessions } from './data'
import { withMobileAsyncTimeout } from './http'
import { isMobileRouteAllowed } from './matchdayPolicyCore.js'

function sourceError(name, result) {
  return result.status === 'rejected' ? `${name}:${String(result.reason?.message || 'unavailable')}` : ''
}

export async function getCoachPhase31GHomeSnapshot(user) {
  const [primary, attention] = await Promise.all([
    getCoachPhase31GPrimaryHomeSnapshot(user),
    getCoachPhase31GAttentionSnapshot(user),
  ])
  return mergeCoachHomeOperationalSnapshots(primary, attention)
}

export function mergeCoachPhase31GHomeSnapshots(primary, attention) {
  return mergeCoachHomeOperationalSnapshots(primary, attention)
}

export async function getCoachPhase31GPrimaryHomeSnapshot(user, onProgress, onTiming) {
  const names = ['matches', 'sessions', 'calendar']
  const routes = ['matchday', 'sessions', 'calendar']
  const partial = {}
  const started = {}
  const timed = (name, loader) => {
    started[name] = Date.now()
    return Promise.resolve().then(loader).then(
      value => { onTiming?.(name, Date.now() - started[name], 'success'); return value },
      error => { onTiming?.(name, Date.now() - started[name], 'error'); throw error },
    )
  }
  const results = await Promise.allSettled([
    () => getCoachMatchDays(user),
    () => getCoachSessions(user),
    () => getCoachCalendarResources(user, { homeSummary: true, includeDetails: false }),
  ].map((loader, index) => withMobileAsyncTimeout(() => isMobileRouteAllowed(user, routes[index], user?.matchdayPolicy) ? timed(names[index], loader) : []).then(value => {
    partial[names[index]] = value
    onProgress?.(buildCoachHomeOperationalSnapshot(partial))
    return value
  })))
  const values = Object.fromEntries(results.map((result, index) => [names[index], result.status === 'fulfilled' ? result.value : null]))
  const errors = results.map((result, index) => sourceError(names[index], result)).filter(Boolean)
  if (!values.matches && !values.sessions && !values.calendar) throw new Error('Coach operational summary could not be loaded.')
  return buildCoachHomeOperationalSnapshot({ ...values, errors })
}

export async function getCoachPhase31GAttentionSnapshot(user, { force = true, onTiming, readLocalDevelopmentDrafts = async () => ({}) } = {}) {
  const names = ['development', 'chatRooms', 'polls', 'invites']
  const routes = ['development', 'chat', 'polls', 'invites']
  const timed = (name, loader) => {
    const startedAt = Date.now()
    return Promise.resolve().then(loader).then(
      value => { onTiming?.(name, Date.now() - startedAt, 'success'); return value },
      error => { onTiming?.(name, Date.now() - startedAt, 'error'); throw error },
    )
  }
  const results = await Promise.allSettled([
    async () => {
      const [development, localDevelopmentDrafts] = await Promise.all([
        readMobileResource(user, 'coach:development-open-summary', () => getCoachDevelopmentSummary(user), { force }),
        readLocalDevelopmentDrafts(),
      ])
      return { ...development, localDevelopmentDrafts: Object.values(localDevelopmentDrafts || {}) }
    },
    () => readMobileResource(user, 'coach:phase31e:chat', () => getCoachChatRooms(user), { force }),
    () => readMobileResource(user, 'coach:phase31e:polls', () => getCoachPolls(user), { force }),
    () => readMobileResource(user, 'coach:home-availability-summary', () => getCoachInvitesAndAvailability(user, { summaryOnly: true }), { force, maxAgeMs: 180_000 }),
  ].map((loader, index) => isMobileRouteAllowed(user, routes[index], user?.matchdayPolicy) ? timed(names[index], loader) : null))
  const values = Object.fromEntries(results.map((result, index) => [names[index], result.status === 'fulfilled' ? result.value : null]))
  const errors = results.map((result, index) => sourceError(names[index], result)).filter(Boolean)
  return buildCoachHomeOperationalSnapshot({ ...values, localDevelopmentDrafts: values.development?.localDevelopmentDrafts, errors })
}
