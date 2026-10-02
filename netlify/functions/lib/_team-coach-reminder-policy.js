import { buildTeamCoachReminderConfiguration } from '../../../src/lib/coach-reminder-policy.js'
import { normalizeTeamCoachReminderPolicy } from '../../../src/lib/coach-reminder-settings.js'

const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '')
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) })
const reject = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }) }

export function createTeamCoachReminderPolicyHandler({ enabled, createClients, loadAuthority }) {
  return async event => {
    // Check before constructing any client, so absent/default flags cannot write
    // to a database or silently create new policy rows on a read.
    if (enabled() !== true) return json(503, { success: false, message: 'Team reminder settings are not available yet.' })
    if (event.httpMethod !== 'POST') return json(405, { success: false, message: 'Method Not Allowed' })
    if (!String(event.headers?.['content-type'] || event.headers?.['Content-Type'] || '').toLowerCase().startsWith('application/json')) {
      return json(415, { success: false, message: 'Use a JSON request.' })
    }
    try {
      const token = /^Bearer\s+(\S+)$/i.exec(event.headers?.authorization || event.headers?.Authorization || '')?.[1]
      if (!token) reject('Sign in to manage team reminders.', 401)
      if (String(event.body || '').length > 8192) reject('The reminder request is too large.', 413)
      let body
      try { body = JSON.parse(event.body || '{}') } catch { reject('The reminder request is invalid.') }
      if (!body || Array.isArray(body) || typeof body !== 'object' || !uuid(body.teamId) || !['get','save'].includes(body.action)) reject('Choose a team and a recognised reminder action.')
      const allowed = body.action === 'get' ? ['action','teamId'] : ['action','teamId','expectedRevision','requestId','options','optedIn']
      if (Object.keys(body).some(key => !allowed.includes(key))) reject('The reminder request contains unsupported fields.')
      let configuration
      if (body.action === 'save') {
        if (!uuid(body.requestId) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) reject('Reload the team settings before saving.')
        try { configuration = buildTeamCoachReminderConfiguration(body) } catch (error) { reject(error.message) }
      }
      const { requestClient, adminClient } = await createClients(event, token)
      const auth = await requestClient.auth.getUser(token)
      if (auth.error || !auth.data?.user?.id) reject('Sign in to manage team reminders.', 401)
      const profile = await loadAuthority(adminClient, auth.data.user)
      if (['parent_portal','super_admin','adult_player'].includes(profile.role) || Number(profile.role_rank) < 20) reject('Authorised team Coach access is required.', 403)
      const team = await requestClient.from('teams').select('id,club_id,archived_at').eq('id',body.teamId).eq('club_id',profile.club_id).is('archived_at',null).maybeSingle()
      if (team.error) throw team.error
      if (!team.data) reject('This team is outside your active Coach access.', 403)
      if (profile.role !== 'admin') {
        const staff = await requestClient.from('team_staff').select('role_rank').eq('team_id',body.teamId).eq('user_id',profile.id).maybeSingle()
        if (staff.error) throw staff.error
        if (Number(staff.data?.role_rank || 0) < 20) reject('This team is outside your active Coach access.', 403)
      }
      let row, duplicate = false
      if (body.action === 'save') {
        const saved = await requestClient.rpc('save_team_coach_reminder_policy_v1', {
          target_club_id: profile.club_id, target_team_id: body.teamId, expected_revision: body.expectedRevision,
          request_id_value: body.requestId, options_value: configuration.options, opted_in_value: configuration.optedIn,
        })
        if (saved.error) throw saved.error
        row = saved.data?.policy; duplicate = saved.data?.duplicate === true
        if (!row) throw new Error('Policy save did not return its persisted state.')
      } else {
        const loaded = await requestClient.from('team_coach_reminder_policies').select('*').eq('club_id',profile.club_id).eq('team_id',body.teamId).maybeSingle()
        if (loaded.error) throw loaded.error
        row = loaded.data
      }
      return json(200, { success: true, policy: normalizeTeamCoachReminderPolicy(row, { clubId: profile.club_id, teamId: body.teamId }),
        duplicate, deliveryEnabled: false, squadCompletionReady: true })
    } catch (error) {
      if (error.code === '40001') return json(409, { success: false, message: 'Another Coach updated this team’s reminder settings. Reload them before saving.' })
      if (error.code === '42501') return json(403, { success: false, message: 'Authorised team Coach access is required.' })
      if (error.code === '22023') return json(400, { success: false, message: 'The reminder configuration or request ID is invalid. Reload before trying again.' })
      return json(error.statusCode || 500, { success: false, message: error.statusCode ? error.message : 'Team reminder settings could not be loaded or saved.' })
    }
  }
}
