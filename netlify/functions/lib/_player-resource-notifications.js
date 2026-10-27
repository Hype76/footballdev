import { loadFanScope } from './_fan-access.js'
import { loadFanSchedule } from './_fan-schedule.js'
import { canReadPlayerEventResources } from './_player-event-resources.js'
import { sendExpoPushMessages } from './_expo-push.js'
import { buildScopedNotificationTitle } from './_notification-scope.js'

export async function playerResourceFeatureCheck(client, scope, assertFeature) {
  const { assertParentPlanFeatureForScope } = await import('./_parent-plan-gate.js')
  const { canUsePlanEntitlement } = await import('./_plan-gate.js')
  const profile = await (assertFeature || assertParentPlanFeatureForScope)({ actionCategory: 'READ', clubId: scope.fan.club_id,
    featureName: 'resourceLibrary', parentLinkId: scope.parent.id, playerId: scope.player.id,
    teamId: scope.player.team_id }, { supabaseAdmin: client })
  return feature => canUsePlanEntitlement(profile, feature)
}

export async function sendPlayerResourceNotifications({ client, preparation, source, parentLinkIds, teamName = '',
  sendPush = messages => sendExpoPushMessages(messages, { client }), featureCheck = playerResourceFeatureCheck }) {
  const result = { playerSent: 0, playerFailed: 0, playerInbox: 0 }
  if (preparation.source_type !== 'calendar' || ['cancelled', 'deleted'].includes(preparation.change_action) || !parentLinkIds.length) return result
  const previous = new Set((preparation.source_snapshot?.resource_links || []).map(link => `${link.date}:${link.id}`))
  const added = (source?.resource_links || []).filter(link => !previous.has(`${link.date}:${link.id}`))
  if (!added.length) return result
  const candidates = await client.from('fan_connections').select('id,auth_user_id')
    .eq('club_id', preparation.club_id).eq('status', 'active').eq('relationship_type', 'player')
    .eq('notifications_enabled', true).in('parent_link_id', parentLinkIds)
    .contains('permissions', { resources: true, schedule: true, development: true })
  if (candidates.error) throw candidates.error
  const delivered = new Set()
  for (const candidate of candidates.data || []) {
    try {
      const scope = await loadFanScope(client, candidate.auth_user_id, candidate.id, 'resources')
      if (!canReadPlayerEventResources(scope) || !scope.fan.notifications_enabled) continue
      const featureAllowed = await featureCheck(client, scope)
      const schedule = await loadFanSchedule(client, scope, new Date(), { featureAllowed })
      for (const resource of added) {
        const authorised = schedule.flatMap(item => item.resources || []).find(r => r.id === resource.id
          && r.eventId === preparation.source_id && r.occurrenceDate === resource.date)
        if (!authorised) continue
        const title = buildScopedNotificationTitle('Resource added', { clubName: scope.club.name, teamName })
        const body = `${authorised.title || 'A new resource'} is available for your calendar event.`
        const eventKey = `calendar-resource:${preparation.id}:${resource.date}:${resource.id}`
        const saved = await client.from('fan_notifications').upsert({ connection_id: scope.fan.id,
          match_id: null, calendar_event_id: preparation.source_id, resource_id: resource.id,
          occurrence_date: resource.date, event_key: eventKey, title, body },
        { onConflict: 'connection_id,event_key', ignoreDuplicates: true })
        if (saved.error) throw saved.error
        const record = await client.from('fan_notifications').select('id,push_sent_at')
          .eq('connection_id', scope.fan.id).eq('event_key', eventKey).single()
        if (record.error) throw record.error
        if (record.data.push_sent_at) continue
        result.playerInbox += 1
        const devices = await client.from('fan_devices').select('token').eq('auth_user_id', candidate.auth_user_id)
        if (devices.error) throw devices.error
        // Re-authorise both the account and the exact current occurrence before dispatch.
        const current = await loadFanScope(client, candidate.auth_user_id, candidate.id, 'resources')
        if (!canReadPlayerEventResources(current) || !current.fan.notifications_enabled) continue
        const currentFeatures = await featureCheck(client, current)
        const currentSchedule = await loadFanSchedule(client, current, new Date(), { featureAllowed: currentFeatures })
        if (!currentSchedule.some(item => item.resources?.some(r => r.id === resource.id
          && r.eventId === preparation.source_id && r.occurrenceDate === resource.date))) continue
        const tokens = (devices.data || []).map(device => device.token)
          .filter(token => !delivered.has(`${eventKey}:${token}`))
        const delivery = await sendPush(tokens.map(to => ({ to, title, body, sound: 'default',
          data: { app: 'parent', route: 'fans', type: 'resource_shared', fanConnectionId: candidate.id,
            calendarEventId: preparation.source_id, occurrenceDate: resource.date, resourceId: resource.id } })))
        result.playerSent += delivery.sent
        result.playerFailed += delivery.failed
        if (!delivery.failed) {
          tokens.forEach(token => delivered.add(`${eventKey}:${token}`))
          const marked = await client.from('fan_notifications').update({ push_sent_at: new Date().toISOString() }).eq('id', record.data.id)
          if (marked.error) throw marked.error
        }
        if (delivery.invalidTokens?.length) {
          const removed = await client.from('fan_devices').delete().in('token', delivery.invalidTokens)
          if (removed.error) throw removed.error
        }
      }
    } catch (error) { if (![401, 403].includes(error.statusCode || error.status)) result.playerFailed += 1 }
  }
  return result
}
