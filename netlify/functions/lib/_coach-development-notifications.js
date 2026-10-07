import { sendExpoPushMessages } from './_expo-push.js'
import { buildScopedNotificationTitle } from './_notification-scope.js'

const retryError = () => Object.assign(new Error('The report is saved. Parent notification delivery will retry in the background.'), { statusCode: 503 })

// Inbox keys are stable. Leased device deliveries are retried after transport failure.
// A lost provider acknowledgement can repeat a push; it cannot duplicate the inbox item.
export async function notifyCoachDevelopmentParents(client, { evaluationId, profile, selectedParentLinkIds }, sendPush = sendExpoPushMessages) {
  const deadline = Date.now() + 25000
  async function rpc(name, payload) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw retryError()
    let result
    try {
      const request = client.rpc(name, payload)
      result = await (typeof request.abortSignal === 'function' ? request.abortSignal(AbortSignal.timeout(Math.min(8000, remaining))) : request)
    } catch { throw retryError() }
    if (result.error) {
      if (result.error.code === '42501') throw Object.assign(new Error('Current access to share this assessment is required.'), { statusCode: 403 })
      throw retryError()
    }
    return result.data
  }
  const data = await rpc('claim_coach_assessment_notifications', {
    actor_value: profile.id, evaluation_value: evaluationId, selected_links_value: selectedParentLinkIds,
  })
  if (!data || !Array.isArray(data.deliveries) || data.deliveries.length > 12
    || !Number.isInteger(data.remaining) || data.remaining < 0) throw retryError()
  const results = await Promise.allSettled(data.deliveries.map(async delivery => {
    const current = await rpc('coach_assessment_notification_is_current', { delivery_value: delivery.id, lease_value: delivery.lease })
    let delivered = false, invalid = false, skipped = current !== true
    if (!skipped) {
      if (Date.now() >= deadline) throw retryError()
      try {
        const result = await sendPush([{
          to: delivery.to,
          sound: 'default',
          title: buildScopedNotificationTitle('Development report', delivery),
          body: 'A new development report is ready to view.',
          data: { app: 'parent', route: 'development', type: 'development_report', reportId: evaluationId,
            notificationId: evaluationId, parentLinkId: delivery.parentLinkId, clubName: delivery.clubName,
            teamName: delivery.teamName, teamId: delivery.teamId },
        }], { client, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) })
        invalid = Array.isArray(result?.invalidTokens) && result.invalidTokens.includes(delivery.to)
        delivered = result?.sent === 1 && result?.failed === 0
        skipped = result?.skipped === 1 && result?.failed === 0
      } catch { /* Release the lease for retry without exposing provider payloads or tokens. */ }
    }
    const completed = await rpc('complete_coach_assessment_notification', {
      delivery_value: delivery.id, lease_value: delivery.lease, delivered_value: delivered,
      invalid_value: invalid, skipped_value: skipped,
    })
    if (completed !== true || (!delivered && !invalid && !skipped)) throw retryError()
  }))
  if (results.some(result => result.status === 'rejected') || Number(data.remaining) > data.deliveries.length) throw retryError()
  return { inboxRecipients: Number(data.inboxRecipients || 0), notificationDelivery: 'processed' }
}
