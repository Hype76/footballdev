import { Buffer } from 'node:buffer'
import { createSupabaseAdminClient } from './lib/_supabase.js'
import { createFromAddress, sendEmail } from './lib/_email-provider.js'
import { fanAccessSummary, fanInviteUrl } from '../../src/lib/fans.js'
import { loadFanInviteForOwner, loadFanScope } from './lib/_fan-access.js'
import { loadFanMatches, loadFanSchedule } from './lib/_fan-schedule.js'
import { loadHistory } from './parent-development-history.js'
import { loadAuthorisedResource } from './parent-resource-access.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }, body: JSON.stringify(body) })

export async function handleFans(event, { createClient = createSupabaseAdminClient, deliverEmail = sendEmail } = {}) {
  if (event.httpMethod !== 'POST') return json(405, { message: 'Method not allowed.' })
  if (Buffer.byteLength(event.body || '') > 8192) return json(413, { message: 'Request is too large.' })
  try {
    const body = JSON.parse(event.body || '{}')
    const token = String(event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '')
    if (!token) return json(401, { message: 'Sign in to continue.' })
    const client = createClient(event)
    const { data, error } = await client.auth.getUser(token)
    if (error || !data?.user?.id) return json(401, { message: 'Sign in to continue.' })
    const actor = data.user.id
    if (['register_device', 'unregister_device'].includes(body.action)) {
      if (!/^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/.test(body.token || '')) return json(400, { message: 'Notification registration is invalid.' })
      const result = body.action === 'register_device'
        ? await client.from('fan_devices').upsert({ token: body.token, auth_user_id: actor, updated_at: new Date().toISOString() })
        : await client.from('fan_devices').delete().eq('token', body.token).eq('auth_user_id', actor)
      if (result.error) throw result.error
      return json(200, { success: true })
    }
    if (!UUID.test(body.connectionId || '')) return json(400, { message: 'Choose a valid Fan connection.' })
    if (body.action === 'send_invitation') {
      const fan = await loadFanInviteForOwner(client, actor, body.connectionId)
      if (fan.email_sent_at) return json(200, { success: true, alreadySent: true })
      const url = fanInviteUrl('https://parent.footballplayer.online', fan.invite_token)
      await deliverEmail({ from: createFromAddress('Football Player'), to: [fan.email], subject: 'Your Football Player Fan invitation',
        html: `<p>Hello ${escape(fan.name)},</p><p>You have been invited as a Fan on Football Player.</p><ul>${fanAccessSummary(fan.permissions).map((text) => `<li>${escape(text)}</li>`).join('')}</ul><p><a href="${escape(url)}">Review and accept invitation</a></p><p>Sign in with ${escape(fan.email)}. This invitation expires after 24 hours. You can remove your access at any time.</p>`,
      }, { idempotencyKey: `fan-invitation-${fan.id}`, context: { emailType: 'fan_invitation', actorUserId: actor, targetEntityType: 'fan_connection', targetEntityId: fan.id } })
      const sent = await client.from('fan_connections').update({ email_sent_at: new Date().toISOString() }).eq('id', fan.id)
      if (sent.error) throw sent.error
      return json(200, { success: true })
    }
    const permission = { schedule: 'schedule', matches: 'game_day', notifications: 'game_day', development: 'development', resources: 'resources', open_resource: 'resources' }[body.action]
    if (!permission) return json(400, { message: 'Choose a valid Fan action.' })
    const scope = await loadFanScope(client, actor, body.connectionId, permission)
    if (body.action === 'development') return json(200, { reports: await loadHistory({ parentLink: scope.parent, supabaseAdmin: client }) })
    if (body.action === 'schedule') return json(200, { schedule: await loadFanSchedule(client, scope) })
    if (body.action === 'notifications') {
      const result = await client.from('fan_notifications').select('id, match_id, title, body, created_at').eq('connection_id', scope.fan.id).order('created_at', { ascending: false }).limit(60)
      if (result.error) throw result.error
      const visible = new Set((await loadFanMatches(client, scope)).map((match) => match.id))
      return json(200, { notifications: (result.data || []).filter((item) => visible.has(item.match_id)) })
    }
    if (body.action === 'matches') {
      const matches = await loadFanMatches(client, scope)
      if (body.matchId) {
        if (!matches.some((match) => match.id === body.matchId)) return json(403, { message: 'This Game Day is unavailable.' })
        const events = await client.from('match_day_events').select('id, event_type, minute, home_score, away_score, created_at')
          .eq('match_day_id', body.matchId).eq('event_status', 'active').order('created_at', { ascending: true })
        if (events.error) throw events.error
        return json(200, { matches: matches.filter((match) => match.id === body.matchId), events: events.data || [] })
      }
      return json(200, { matches })
    }
    if (body.action === 'resources') {
      const result = await client.from('resource_library_links').select('resource_id, resource_library_items!inner(id, title, description, archived_at, club_id, team_id)')
        .eq('club_id', scope.fan.club_id).eq('team_id', scope.player.team_id).eq('linked_type', 'player').eq('linked_id', scope.player.id).eq('parent_visible', true).is('removed_at', null)
      if (result.error) throw result.error
      const resources = (result.data || []).map((row) => row.resource_library_items).filter((r) => r && !r.archived_at && r.club_id === scope.fan.club_id && r.team_id === scope.player.team_id)
        .map(({ id, title, description }) => ({ id, title, description }))
      return json(200, { resources })
    }
    if (!UUID.test(body.resourceId || '')) return json(400, { message: 'Choose a valid resource.' })
    const { access, resource, formationBoard } = await loadAuthorisedResource({ authUserId: scope.parent.auth_user_id, parentLinkId: scope.parent.id, resourceId: body.resourceId, supabaseAdmin: client })
    if (formationBoard) return json(200, { formationBoard })
    if (access.accessType === 'external_link') return json(200, access)
    const signed = await client.storage.from('resource-library').createSignedUrl(resource.storage_path, 60)
    if (signed.error) throw signed.error
    return json(200, { ...access, accessUrl: signed.data.signedUrl })
  } catch (error) {
    const status = error.statusCode || error.status || (error instanceof SyntaxError ? 400 : 500)
    return json(status, { message: status >= 500 ? 'Fans could not be loaded. Please try again.' : error.message })
  }
}
export const handler = (event) => handleFans(event)
