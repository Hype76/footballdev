import { getCoachCalendarResources } from './coachCalendarData'
import { getCoachChatRooms, getCoachDevelopmentWorkspace, getCoachInvitesAndAvailability, getCoachMessages, getCoachPolls } from './coachPhase31EData'
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
    getCoachCalendarResources(user),
  ])
  const values = Object.fromEntries(results.map((result, index) => [names[index], result.status === 'fulfilled' ? result.value : null]))
  const errors = results.map((result, index) => sourceError(names[index], result)).filter(Boolean)
  if (!values.summary && !values.matches && !values.sessions) throw new Error('Coach operational summary could not be loaded.')
  return buildCoachHomeOperationalSnapshot({ ...values, errors })
}

export async function getCoachPhase31GAttentionSnapshot(user) {
  const names = ['development', 'chatRooms', 'messages', 'polls', 'invites']
  const results = await Promise.allSettled([
    getCoachDevelopmentWorkspace(user),
    getCoachChatRooms(user),
    getCoachMessages(user),
    getCoachPolls(user),
    getCoachInvitesAndAvailability(user),
  ])
  const values = Object.fromEntries(results.map((result, index) => [names[index], result.status === 'fulfilled' ? result.value : null]))
  const errors = results.map((result, index) => sourceError(names[index], result)).filter(Boolean)
  return buildCoachHomeOperationalSnapshot({ ...values, errors })
}
