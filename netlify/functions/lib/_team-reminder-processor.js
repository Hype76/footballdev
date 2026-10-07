import { queueAvailabilityFollowUp } from './_availability-follow-up.js'
import { loadActiveAuthorityProfile } from './_authority-profile.js'

export async function processTeamReminders({ client, sendSquad, queueFollowUp = queueAvailabilityFollowUp, loadProfile = loadActiveAuthorityProfile }) {
  const claimed = await client.rpc('claim_due_team_reminders', { batch_value: 25 })
  if (claimed.error) throw claimed.error
  const result = { completed: 0, skipped: 0, failed: 0 }
  for (const job of claimed.data || []) {
    let errorCode = ''
    try {
      const current = await client.rpc('team_reminder_is_current', { delivery_key_value: job.deliveryKey, lease_value: job.leaseId })
      if (current.error) throw current.error
      if (current.data !== true) { result.skipped += 1; errorCode = 'Skipped: not current.' }
      else if (job.kind === 'squad') {
        const match = await client.from('match_days').select('*').eq('id', job.eventId).eq('club_id', job.clubId).eq('team_id', job.teamId).single()
        if (match.error) throw match.error
        const inbox = await client.rpc('record_team_reminder_inbox', { delivery_key_value: job.deliveryKey, lease_value: job.leaseId })
        if (inbox.error) throw inbox.error
        if (inbox.data === null) { result.skipped += 1; errorCode = 'Skipped: not current.' }
        else {
          const pushed = await sendSquad({ match: match.data, recipientId: job.recipientId, adminClient: client })
          if (pushed.failed > 0) throw new Error('Squad reminder phone delivery will retry.')
          result.completed += 1
        }
      } else {
        const profile = await loadProfile(client, { id: job.actorId }, { clubId: job.clubId })
        await queueFollowUp({ client, profile, scopedEvent: { id: job.eventId, club_id: job.clubId, team_id: job.teamId },
          sourceType: job.sourceType === 'match-day' ? 'match-day' : 'calendar', occurrenceDate: job.occurrenceDate || '',
          playerId: job.playerId, message: 'Please confirm availability for the upcoming event. Choose Attending, Not attending or Maybe in Football Player Parents.',
          idempotencyKey: job.deliveryKey, automaticReminderKey: job.deliveryKey,
        })
        result.completed += 1
      }
    } catch (error) {
      // A vanished invitation or parent link is a terminal skip, not repeated customer messaging.
      if ([403, 409].includes(error.statusCode)) { result.skipped += 1; errorCode = 'Skipped: not current.' }
      else { result.failed += 1; errorCode = 'Reminder delivery will retry.' }
    }
    const finished = await client.rpc('finish_team_reminder', { delivery_key_value: job.deliveryKey, lease_value: job.leaseId, error_value: errorCode })
    if (finished.error) throw finished.error
  }
  return result
}
