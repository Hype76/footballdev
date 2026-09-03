import { getCoachCalendarResources } from './coachCalendarData'
import { getCoachChatRooms, getCoachDevelopmentSummary, getCoachInvitesAndAvailability, getCoachPolls } from './coachPhase31EData'
import { readMobileResource } from './mobileResourceCache'
import { buildCoachHomeOperationalSnapshot, mergeCoachHomeOperationalSnapshots } from './coachPhase31GCore'
import { getCoachHomeSummary, getCoachMatchDays, getCoachSessions } from './data'

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

export async function getCoachPhase31GPrimaryHomeSnapshot(user) {
  const names = ['summary', 'matches', 'sessions', 'calendar']
  const results = await Promise.allSettled([
    getCoachHomeSummary(user),
    getCoachMatchDays(user),
    getCoachSessions(user),
    getCoachCalendarResources(user, { includeDetails: false }),
  ])
  const values = Object.fromEntries(results.map((result, index) => [names[index], result.status === 'fulfilled' ? result.value : null]))
  const errors = results.map((result, index) => sourceError(names[index], result)).filter(Boolean)
  if (!values.summary && !values.matches && !values.sessions) throw new Error('Coach operational summary could not be loaded.')
  return buildCoachHomeOperationalSnapshot({ ...values, errors })
}

export async function getCoachPhase31GAttentionSnapshot(user, { force = true } = {}) {
  const names = ['development', 'chatRooms', 'polls', 'invites']
  const results = await Promise.allSettled([
    readMobileResource(user, 'coach:development-summary', () => getCoachDevelopmentSummary(user), { force }),
    readMobileResource(user, 'coach:phase31e:chat', () => getCoachChatRooms(user), { force }),
    readMobileResource(user, 'coach:phase31e:polls', () => getCoachPolls(user), { force }),
    readMobileResource(user, 'coach:phase31e:invites', () => getCoachInvitesAndAvailability(user), { force }),
  ])
  const values = Object.fromEntries(results.map((result, index) => [names[index], result.status === 'fulfilled' ? result.value : null]))
  const errors = results.map((result, index) => sourceError(names[index], result)).filter(Boolean)
  return buildCoachHomeOperationalSnapshot({ ...values, errors })
}
