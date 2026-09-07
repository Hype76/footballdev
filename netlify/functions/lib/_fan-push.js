import { loadFanScope } from './_fan-access.js'
import { loadFanMatches } from './_fan-schedule.js'
import { sendExpoPushMessages } from './_expo-push.js'
const TYPES = new Set(['match_started','goal','half_time','second_half','extra_time','penalties','full_time','yellow_card','red_card','substitution','score_correction','paused','resumed'])
export async function sendFanMatchNotifications({ client, match, type, eventId, targetParentLinkIds, sendPush = sendExpoPushMessages }) {
  if (!TYPES.has(type) || !targetParentLinkIds.length) return { fanSent: 0, fanFailed: 0 }
  const result = await client.from('fan_connections').select('id,auth_user_id')
    .eq('club_id', match.club_id).eq('status', 'active').eq('relationship_type', 'fan').eq('notifications_enabled', true)
    .contains('permissions', { game_day: true }).in('parent_link_id', targetParentLinkIds)
  if (result.error) throw result.error
  let fanSent = 0
  let fanFailed = 0
  const seenTokens = new Set()
  for (const fan of result.data || []) {
    try {
      const scope = await loadFanScope(client, fan.auth_user_id, fan.id, 'game_day')
      if (!scope.fan.notifications_enabled) continue
      const visible = await loadFanMatches(client, scope, match.id)
      if (!visible.some((item) => item.id === match.id)) continue
      const eventKey = `${match.id}:${type}:${eventId || match.updated_at}`
      const saved = await client.from('fan_notifications').upsert({ connection_id: fan.id, match_id: match.id, event_key: eventKey,
        title: 'Game Day update', body: 'A game you follow has an update. Open Fans to view it.' }, { onConflict: 'connection_id,event_key', ignoreDuplicates: true })
      if (saved.error) throw saved.error
      const record = await client.from('fan_notifications').select('id,push_sent_at').eq('connection_id', fan.id).eq('event_key', eventKey).single()
      if (record.error) throw record.error
      if (record.data.push_sent_at) continue
      const devices = await client.from('fan_devices').select('token').eq('auth_user_id', fan.auth_user_id)
      if (devices.error) throw devices.error
      // Recheck immediately before dispatch in case the Parent or Fan ended access.
      const current = await loadFanScope(client, fan.auth_user_id, fan.id, 'game_day')
      if (!current.fan.notifications_enabled) continue
      const tokens = (devices.data || []).map((d) => d.token).filter((token) => !seenTokens.has(token))
      const delivery = await sendPush(tokens.map((to) => ({ to, title: 'Game Day update', body: 'Open Fans to view a game you follow.', sound: 'default',
        data: { app: 'parent', route: 'fans', fanConnectionId: fan.id, matchDayId: match.id } })))
      if (!delivery.failed) {
        tokens.forEach((token) => seenTokens.add(token))
        const marked = await client.from('fan_notifications').update({ push_sent_at: new Date().toISOString() }).eq('id', record.data.id)
        if (marked.error) throw marked.error
      }
      if (delivery.invalidTokens?.length) await client.from('fan_devices').delete().in('token', delivery.invalidTokens)
      fanSent += delivery.sent; fanFailed += delivery.failed
    } catch (error) { if (error.statusCode !== 403) fanFailed += 1 }
  }
  return { fanSent, fanFailed }
}
