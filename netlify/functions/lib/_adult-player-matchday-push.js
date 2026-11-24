import { sendExpoPushMessages } from './_expo-push.js'
import { deliverCheckpointedTargets } from './_match-day-shootout-notifications.js'

async function loadTargets(client, matchId, installationId = null) {
  const { data, error } = await client.rpc('get_shootout_adult_player_notification_targets', {
    match_day_id_value: matchId, installation_id_value: installationId,
  })
  if (error) throw error
  return data || []
}

export async function sendAdultPlayerShootoutNotifications({ client, match, notificationCopy, eventId = '', checkpoint, sendMessages = sendExpoPushMessages }) {
  const type = notificationCopy.notificationType
  if (!['penalties', 'shootout_kick'].includes(type) && !(type === 'full_time' && notificationCopy.title === 'Penalty shootout finished')) {
    return { adultPlayerSent: 0, adultPlayerFailed: 0 }
  }
  const targets = await loadTargets(client, match.id)
  const send = async (target) => {
    // Recheck the installed device and active verified link immediately before dispatch.
    const active = (await loadTargets(client, match.id, target.installation_id)).find(device =>
      device.installation_id === target.installation_id && device.user_id === target.user_id
      && device.adult_link_id === target.adult_link_id && device.expo_push_token === target.expo_push_token)
    if (!active) return { sent: 0, failed: 0 }
    const result = await sendMessages([{
      to: active.expo_push_token, title: notificationCopy.title,
      body: active.detail_level === 'detailed' ? notificationCopy.detailedBody : notificationCopy.minimalBody,
      sound: 'default', priority: 'high', ttl: 14400, tag: notificationCopy.tag, threadId: notificationCopy.tag,
      data: { app: 'player', route: 'matchday', type, eventId, matchDayId: match.id,
        userId: active.user_id, adultLinkId: active.adult_link_id, clubId: active.club_id, teamId: active.team_id },
    }], { client })
    if ((result.invalidTokens || []).includes(active.expo_push_token)) {
      const revoked = await client.from('adult_player_mobile_push_installations')
        .update({ enabled: false, expo_push_token: null, updated_at: new Date().toISOString() })
        .eq('installation_id', active.installation_id).eq('expo_push_token', active.expo_push_token)
      if (revoked.error) throw revoked.error
      return { sent: 0, failed: 0 }
    }
    return result
  }
  const results = checkpoint
    ? await deliverCheckpointedTargets(targets, { channel: 'mobile', keyFor: device => `adult_${device.installation_id}`, checkpoint, send, isComplete: result => result.failed === 0 })
    : await Promise.allSettled(targets.map(send))
  return results.reduce((summary, result) => {
    if (result.status === 'rejected') return { ...summary, adultPlayerFailed: summary.adultPlayerFailed + 1 }
    if (!result.value) return summary
    return { adultPlayerSent: summary.adultPlayerSent + (result.value.sent || 0), adultPlayerFailed: summary.adultPlayerFailed + (result.value.failed || 0) }
  }, { adultPlayerSent: 0, adultPlayerFailed: 0 })
}
