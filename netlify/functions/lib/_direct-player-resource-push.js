import { createHash } from 'node:crypto'
import { sendExpoPushMessages } from './_expo-push.js'
import { loadFanScope } from './_fan-access.js'
import { buildScopedNotificationTitle } from './_notification-scope.js'
import { listPlayerDirectResourceTargets } from './_player-event-resources.js'
import { playerResourceFeatureCheck } from './_player-resource-notifications.js'

const tokenHash = token => createHash('sha256').update(token).digest('hex')
const RESOURCE_BODY = 'A new resource is ready to view.'

async function loadRecipient(client, intent, featureCheck) {
  const lookup = await client.from('fan_connections').select('auth_user_id').eq('id', intent.connection_id).maybeSingle()
  if (lookup.error) throw lookup.error
  if (!lookup.data?.auth_user_id) return null
  const scope = await loadFanScope(client, lookup.data.auth_user_id, intent.connection_id, 'resources')
  if (!scope.fan.notifications_enabled || scope.fan.relationship_type !== 'player') return null
  const featureAllowed = await featureCheck(client, scope)
  if (!featureAllowed('parentPortal') || !featureAllowed('resourceLibrary')) return null
  const links = await listPlayerDirectResourceTargets(client, scope, [intent.direct_resource_link_id])
  return links.some(link => link.resource_id === intent.resource_id) ? scope : null
}

export async function processDirectPlayerResourcePushes({ client, sendMessages = sendExpoPushMessages,
  featureCheck = playerResourceFeatureCheck }) {
  const { data, error } = await client.rpc('claim_direct_player_resource_pushes', { batch_size_value: 8 })
  if (error) throw error
  const intents = data || []
  const summary = { claimed: intents.length, sent: 0, failed: 0 }
  async function deliver(intent) {
    const delivered = new Set(intent.direct_push_delivered || [])
    let retry = false
    let recipient
    const invalid = []
    try {
      recipient = await loadRecipient(client, intent, featureCheck)
      if (recipient) {
        const devices = await client.from('fan_devices').select('token').eq('auth_user_id', recipient.fan.auth_user_id)
        if (devices.error) throw devices.error
        const currentRecipient = await loadRecipient(client, intent, featureCheck)
        const title = buildScopedNotificationTitle('Resource added', { clubName: recipient.club.name })
        const tokens = currentRecipient?.fan.auth_user_id === recipient.fan.auth_user_id
          ? [...new Set((devices.data || []).map(device => device.token))]
          : []
        await Promise.all(tokens.filter(token => !delivered.has(tokenHash(token))).map(async token => {
          try {
            const result = await sendMessages([{ to: token, title, body: RESOURCE_BODY, sound: 'default', data: {
              app: 'parent', route: 'fans', type: 'resource_shared', fanConnectionId: intent.connection_id,
              directResourceLinkId: intent.direct_resource_link_id, resourceId: intent.resource_id,
            } }], { client, expectedFanAuthUserId: recipient.fan.auth_user_id })
            if (result.sent === 1) { delivered.add(tokenHash(token)); summary.sent += 1 }
            else if ((result.invalidTokens || []).includes(token)) invalid.push(token)
            else if (result.failed) retry = true
          } catch { retry = true }
        }))
      }
    } catch (failure) {
      retry = ![401, 403, 404].includes(failure.statusCode || failure.status)
    }
    if (retry) summary.failed += 1
    const pending = retry && intent.direct_push_attempts < 5
    const result = await client.from('fan_notifications').update({
      direct_push_after: pending ? intent.direct_push_after : null,
      direct_push_delivered: [...delivered],
      ...(!pending && delivered.size ? { push_sent_at: new Date().toISOString() } : {}),
    }).eq('id', intent.id).eq('direct_push_attempts', intent.direct_push_attempts)
    if (result.error) throw result.error
    if (invalid.length) {
      const removed = await client.from('fan_devices').delete()
        .eq('auth_user_id', recipient.fan.auth_user_id).in('token', invalid)
      if (removed.error) throw removed.error
    }
  }
  for (let index = 0; index < intents.length; index += 4) {
    await Promise.all(intents.slice(index, index + 4).map(deliver))
  }
  return summary
}
