import { evaluateCoachReminderJob } from '../../../src/lib/coach-reminder-policy.js'

// The durable adapter compares its context snapshot against authoritative reads
// inside the commit transaction under a job lock. Changed sources abort commit.
// There is deliberately no scheduler or sending production endpoint.
export async function processCoachReminderJob({ repository, jobKey, now }) {
  if (!repository?.withLockedJob) throw new Error('A transactional reminder repository is required.')
  return repository.withLockedJob(jobKey, async transaction => {
    const job = await transaction.getJob()
    if (!job) return { state: 'missing' }
    if (['completed', 'skipped'].includes(job.state)) return { state: job.state, duplicate: true }
    const context = await transaction.loadCurrentContext()
    const result = evaluateCoachReminderJob({ ...context, job, now })
    if (result.state === 'pending') return result
    if (result.effect) await transaction.insertEffectOnce(result.effect)
    for (const notification of result.notifications) {
      await transaction.insertNotificationOnce({ ...notification, jobKey, action: job.action,
        effectProvenance: result.effect?.provenance || null })
    }
    await transaction.finish({ state: result.state, reason: result.reason, completedAt: now })
    return result
  })
}

// Delivery must recheck current context under the claim before calling this.
// The provider must support durable idempotency/reconciliation for this key.
// An interrupted or ambiguous send is held, never blindly retried as a new send.
export async function deliverCoachReminderNotification({ repository, transport, notificationKey, now }) {
  const claim = await repository.claimNotification(notificationKey, now)
  if (!claim) return { state: 'not_claimed' }
  const { notification, leaseToken } = claim
  try {
    const current = await repository.validateNotification(claim, now)
    if (!current.valid) {
      await repository.skipNotification(claim, current.reason)
      return { state: 'skipped', reason: current.reason }
    }
    const receipt = await transport.send({ ...notification, idempotencyKey: notification.idempotencyKey })
    if (!receipt?.accepted || !receipt.providerId) throw new Error('Provider acceptance is uncertain.')
    await repository.acceptNotification(notificationKey, leaseToken, receipt)
    return { state: 'accepted', providerId: receipt.providerId }
  } catch (error) {
    await repository.holdNotification(notificationKey, leaseToken, 'delivery_requires_reconciliation')
    throw error
  }
}
