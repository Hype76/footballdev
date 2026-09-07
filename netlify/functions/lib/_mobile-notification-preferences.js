import { allowsMobileNotification } from '../../../apps/mobile-core/src/notificationCategories.js'

// Re-check preferences at delivery time, including previously queued alerts.
// Never include account IDs or preference records in the provider payload.
export async function filterMobileNotificationMessages(messages, client) {
  const allowed = new Set()
  for (const app of ['parent', 'coach']) {
    const candidates = messages.filter(message => message.data?.app === app)
    if (!candidates.length) continue
    const tokens = [...new Set(candidates.map(message => message.to))]
    for (let offset = 0; offset < tokens.length; offset += 100) {
      const tokenBatch = tokens.slice(offset, offset + 100)
      const { data: installationRows, error } = await client.from(`${app}_mobile_push_installations`)
        .select('auth_user_id, expo_push_token, enabled, status, detail_level')
        .in('expo_push_token', tokenBatch)
      if (error) throw error
      const installations = [...(installationRows || [])]
      const fanTokens = app === 'parent' ? candidates.filter(message => message.data?.route === 'fans' && tokenBatch.includes(message.to)).map(message => message.to) : []
      if (fanTokens.length) {
        const fans = await client.from('fan_devices').select('auth_user_id,token').in('token', fanTokens)
        if (fans.error) throw fans.error
        for (const fan of fans.data || []) {
          if (!(installations || []).some(device => device.expo_push_token === fan.token)) {
            installations.push({ auth_user_id: fan.auth_user_id, expo_push_token: fan.token, enabled: true, status: 'active', detail_level: 'minimal' })
          }
        }
      }
      const users = [...new Set((installations || []).map(row => row.auth_user_id).filter(Boolean))]
      const result = users.length ? await client.from('mobile_notification_preferences')
        .select('auth_user_id, game_day, invites, chats, resources').eq('app', app).in('auth_user_id', users) : { data: [] }
      if (result.error) throw result.error
      const preferences = new Map((result.data || []).map(row => [row.auth_user_id, { ...row, gameDay: row.game_day }]))
      const devices = new Map((installations || []).map(row => [row.expo_push_token, row]))
      for (const message of candidates) {
        const device = devices.get(message.to)
        if (device?.auth_user_id && device.enabled && device.status === 'active' && device.detail_level !== 'off'
          && allowsMobileNotification(preferences.get(device.auth_user_id), message.data)) allowed.add(message)
      }
    }
  }
  // Older shared-app transport is outside the Coach/Parent category contract.
  return messages.filter(message => !['parent', 'coach'].includes(message.data?.app) || allowed.has(message))
}
