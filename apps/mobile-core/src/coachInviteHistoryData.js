import { assertCoachOperationalRead } from './coachOperationalData'
import { getAccessToken } from './supabase'
import { getMobileRuntimeConfig } from './config'
import { fetchJsonWithTimeout, joinApiPath } from './http'

export async function getCoachInviteHistory(user, invite) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  if (!invite?.eventId || !invite?.playerId || !['training', 'match'].includes(invite.kind)) throw new Error('Choose an invitation to view its history.')
  if (invite.teamId && invite.teamId !== user.activeTeamId) throw new Error('Choose an invitation from your active team.')
  const token = await getAccessToken()
  if (!token) throw new Error('Sign in again to view invite history.')
  const { ok, result } = await fetchJsonWithTimeout(joinApiPath(getMobileRuntimeConfig('coach').apiBaseUrl, '.netlify/functions/get-coach-invite-history'), {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: invite.eventId, playerId: invite.playerId, kind: invite.kind, occurrenceDate: invite.occurrenceDate }),
  })
  if (!ok || result?.success !== true || !result?.history) throw new Error(result?.message || 'Invite history could not be loaded.')
  const history = result.history
  if (!Number.isSafeInteger(history.emailSends) || history.emailSends < 0
    || !Number.isSafeInteger(history.resendRequests) || history.resendRequests < 0
    || !Array.isArray(history.recentEmailSends) || !Array.isArray(history.recentResendRequests)) {
    throw new Error('Invite history could not be loaded.')
  }
  return result.history
}
