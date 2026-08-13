import { getCoachCalendarResources } from './coachCalendarData'
import { getCoachChatRooms, getCoachDevelopmentWorkspace, getCoachInvitesAndAvailability, getCoachMessages, getCoachPolls } from './coachPhase31EData'
import { buildCoachHomeOperationalSnapshot } from './coachPhase31GCore'
import { getCoachHomeSummary, getCoachMatchDays, getCoachSessions } from './data'

function sourceError(name, result) {
  return result.status === 'rejected' ? `${name}:${String(result.reason?.message || 'unavailable')}` : ''
}

export async function getCoachPhase31GHomeSnapshot(user) {
  const names = ['summary', 'matches', 'sessions', 'calendar', 'development', 'chatRooms', 'messages', 'polls', 'invites']
  const results = await Promise.allSettled([
    getCoachHomeSummary(user),
    getCoachMatchDays(user),
    getCoachSessions(user),
    getCoachCalendarResources(user),
    getCoachDevelopmentWorkspace(user),
    getCoachChatRooms(user),
    getCoachMessages(user),
    getCoachPolls(user),
    getCoachInvitesAndAvailability(user),
  ])
  const values = Object.fromEntries(results.map((result, index) => [names[index], result.status === 'fulfilled' ? result.value : null]))
  const errors = results.map((result, index) => sourceError(names[index], result)).filter(Boolean)
  if (!values.summary && !values.matches && !values.sessions) throw new Error('Coach operational summary could not be loaded.')
  return buildCoachHomeOperationalSnapshot({ ...values, errors })
}
