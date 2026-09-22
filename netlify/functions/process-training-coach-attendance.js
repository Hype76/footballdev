import { randomUUID } from 'node:crypto'
import { authorizeNativeScheduledRequest } from './lib/_processor-auth.js'
import { createSupabaseAdminClient } from './lib/_supabase.js'
import { sendCoachTrainingAttendanceInvitationPush } from './send-coach-mobile-push.js'

function normalize(value) {
  return String(value ?? '').trim()
}

export async function processTrainingCoachAttendance({ client, batchSize = 25, sendInvitation = sendCoachTrainingAttendanceInvitationPush, workerId = randomUUID() } = {}) {
  const adminClient = client || createSupabaseAdminClient()
  const { data: claimed, error: claimError } = await adminClient.rpc('claim_training_coach_attendance_notifications', {
    batch_size_value: Math.min(100, Math.max(1, Number(batchSize) || 25)),
    lease_seconds_value: 90,
    worker_id_value: workerId,
  })
  if (claimError) throw claimError

  const summary = { claimed: (claimed || []).length, failed: 0, sent: 0, skipped: 0 }
  for (const attendance of claimed || []) {
    let outcome = 'failed'
    let errorMessage = ''
    try {
      const { data: event, error: eventError } = await adminClient
        .from('calendar_events')
        .select('id,title')
        .eq('id', attendance.calendar_event_id)
        .eq('club_id', attendance.club_id)
        .eq('team_id', attendance.team_id)
        .eq('event_type', 'training')
        .is('cancelled_at', null)
        .maybeSingle()
      if (eventError) throw eventError
      if (!event?.id) {
        outcome = 'skipped'
        errorMessage = 'Training event is no longer active.'
      } else {
        const delivery = await sendInvitation({
          adminClient,
          attendance,
          eventTitle: event.title,
        })
        outcome = delivery.sent > 0 ? 'sent' : delivery.skipped ? 'skipped' : 'failed'
        errorMessage = outcome === 'failed'
          ? 'Coach app notification could not be delivered.'
          : outcome === 'skipped'
            ? 'No active Coach app notification device was available.'
            : ''
      }
    } catch (error) {
      outcome = 'failed'
      errorMessage = normalize(error?.message) || 'Coach app notification could not be delivered.'
    }

    const { data: completed, error: completionError } = await adminClient.rpc('complete_training_coach_attendance_notification', {
      attendance_id_value: attendance.id,
      error_value: errorMessage,
      outcome_value: outcome,
      worker_id_value: workerId,
    })
    if (completionError) throw completionError
    if (completed !== true) throw new Error('Training Coach attendance notification lease was lost.')
    summary[outcome] += 1
  }
  return summary
}

export const config = { schedule: '* * * * *' }

export default async function handler(request) {
  const authorization = await authorizeNativeScheduledRequest(request)
  if (!authorization.ok) return
  await processTrainingCoachAttendance()
}
