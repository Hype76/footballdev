import process from 'node:process'
import { markEmailLogFailed } from './lib/_email-log-store.js'
import { supabaseAdmin } from './lib/_supabase.js'
import { assertPlanFeature, getClubPlanProfile } from './lib/_plan-gate.js'
import { sendPreparedParentEmail } from './send-parent-email.js'
import { sendParentMobilePushById } from './send-parent-mobile-push.js'
import { buildPreparedScheduledEmail } from './lib/_scheduled-email-payload.js'

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function getMissingEnvVars() {
  return ['RESEND_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL'].filter(
    (envName) => !process.env[envName],
  )
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? '').trim())
}

function getSafeErrorDetails(error) {
  return {
    code: String(error?.code ?? 'unknown_error').slice(0, 100),
    message: String(error?.message ?? 'Scheduled email processing failed.').slice(0, 500),
    providerStatus: Number.isFinite(Number(error?.providerStatus)) ? Number(error.providerStatus) : null,
  }
}

function isCalendarNotificationQueueRow(row) {
  return row?.payload?.communicationLog?.metadata?.source === 'calendar_event_notification'
}

async function updateCalendarNotificationEvent(queueId, status, lastError = null) {
  if (!queueId) {
    return
  }

  const { error } = await supabaseAdmin
    .from('calendar_event_notification_events')
    .update({
      status,
      last_error: lastError,
      updated_at: new Date().toISOString(),
    })
    .eq('email_queue_id', queueId)

  if (error) {
    console.error('Calendar notification delivery state update failed', error)
  }
}

async function lockScheduledEmail(row, { retryFailed = false } = {}) {
  const { data, error } = await supabaseAdmin
    .from('scheduled_email_queue')
    .update({ status: 'sending' })
    .eq('id', row.id)
    .in('status', retryFailed ? ['scheduled', 'failed'] : ['scheduled'])
    .select('*')
    .maybeSingle()

  if (error) {
    console.error('Scheduled email lock failed', error)
    return null
  }

  return data
}

async function markScheduledEmailFailed(row, error) {
  const attempts = Number(row.attempts ?? 0) + 1
  const { error: updateError } = await supabaseAdmin
    .from('scheduled_email_queue')
    .update({
      status: 'failed',
      attempts,
      last_error: error.message || String(error),
    })
    .eq('id', row.id)

  if (updateError) {
    console.error('Scheduled email failure update failed', updateError)
  }
}

async function createSentCommunicationLog(row) {
  const log = row.payload?.communicationLog

  if (!log || typeof log !== 'object' || !log.clubId || !log.userId) {
    return null
  }

  const { data, error } = await supabaseAdmin.from('communication_logs').insert({
    club_id: log.clubId,
    player_id: log.playerId || null,
    evaluation_id: log.evaluationId || null,
    user_id: log.userId,
    user_name: String(log.userName ?? '').trim(),
    user_email: String(log.userEmail ?? row.created_by_email ?? '').trim().toLowerCase(),
    channel: 'email',
    action: 'parent_email_sent',
    recipient_email: String(log.recipientEmail ?? row.to_email ?? '').trim(),
    metadata: log.metadata && typeof log.metadata === 'object' ? log.metadata : {},
  }).select('id, club_id').single()

  if (error) {
    console.error('Scheduled email communication log failed', error)
    return null
  }

  return data
}

async function sendScheduledParentPush(communicationLog) {
  if (!communicationLog?.id || !communicationLog?.club_id) {
    return
  }

  try {
    await sendParentMobilePushById({
      id: communicationLog.id,
      profile: {
        clubId: communicationLog.club_id,
        role: 'system',
        roleRank: 100,
      },
      type: 'parent_message',
    })
  } catch (error) {
    console.error('Scheduled email parent mobile push failed', error)
  }
}

export async function sendScheduledEmail(row, { retryFailed = false } = {}) {
  const lockedRow = await lockScheduledEmail(row, { retryFailed })

  if (!lockedRow) {
    return 'skipped'
  }

  if (isCalendarNotificationQueueRow(lockedRow)) {
    await updateCalendarNotificationEvent(lockedRow.id, 'processing')
  }

  try {
    const planProfile = {
      ...await getClubPlanProfile(lockedRow.club_id),
      role: 'system',
      roleRank: 100,
    }
    assertPlanFeature(planProfile, 'parentEmails')
    const preparedEmail = buildPreparedScheduledEmail(lockedRow, planProfile)
    const sendResult = await sendPreparedParentEmail(preparedEmail, {
      idempotencySeed: `scheduled:${lockedRow.id}`,
    })

    if (isCalendarNotificationQueueRow(lockedRow)) {
      await supabaseAdmin
        .from('scheduled_email_queue')
        .update({ status: 'sent', last_error: null })
        .eq('id', lockedRow.id)
      await updateCalendarNotificationEvent(lockedRow.id, 'sent')
    } else {
      await supabaseAdmin
        .from('scheduled_email_queue')
        .delete()
        .eq('id', lockedRow.id)
    }

    if (sendResult.duplicate) {
      return 'duplicate'
    }

    const communicationLog = await createSentCommunicationLog(lockedRow)
    await sendScheduledParentPush(communicationLog)

    return 'sent'
  } catch (error) {
    console.error('Scheduled email send failed', getSafeErrorDetails(error))
    await markEmailLogFailed(error.emailLogRecord, error)
    await markScheduledEmailFailed(lockedRow, error)
    if (isCalendarNotificationQueueRow(lockedRow)) {
      await updateCalendarNotificationEvent(lockedRow.id, 'failed', error.message || String(error))
    }
    return 'failed'
  }
}

export async function processCalendarNotificationCommand({ commandId, profile } = {}) {
  const normalizedCommandId = String(commandId ?? '').trim()

  if (!isUuid(normalizedCommandId)) {
    throw Object.assign(new Error('A valid Calendar notification command is required.'), { statusCode: 400 })
  }

  const { data: command, error: commandError } = await supabaseAdmin
    .from('calendar_event_notification_commands')
    .select('id, club_id, team_id, requested_by, result')
    .eq('id', normalizedCommandId)
    .eq('club_id', profile.clubId)
    .eq('requested_by', profile.id)
    .maybeSingle()

  if (commandError) {
    console.error('Calendar notification command lookup failed', commandError)
    throw new Error('Calendar notification delivery could not be loaded.')
  }

  if (!command) {
    throw Object.assign(new Error('Calendar notification command was not found for this account.'), { statusCode: 404 })
  }

  if (profile.role !== 'admin') {
    const { data: teamAccess, error: teamAccessError } = await supabaseAdmin
      .from('team_staff')
      .select('team_id')
      .eq('team_id', command.team_id)
      .eq('user_id', profile.id)
      .maybeSingle()

    if (teamAccessError || !teamAccess) {
      throw Object.assign(new Error('You do not have permission to deliver notifications for this team.'), { statusCode: 403 })
    }
  }

  const { data: notificationEvents, error: eventsError } = await supabaseAdmin
    .from('calendar_event_notification_events')
    .select('id, email_queue_id, status')
    .eq('notification_command_id', command.id)
    .eq('club_id', command.club_id)
    .eq('team_id', command.team_id)

  if (eventsError) {
    console.error('Calendar notification delivery rows lookup failed', eventsError)
    throw new Error('Calendar notification delivery rows could not be loaded.')
  }

  const queueIds = [...new Set((notificationEvents ?? []).map((row) => row.email_queue_id).filter(Boolean))]
  let queueRows = []

  if (queueIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('scheduled_email_queue')
      .select('*')
      .in('id', queueIds)
      .eq('club_id', command.club_id)
      .eq('team_id', command.team_id)

    if (error) {
      console.error('Calendar notification queue lookup failed', error)
      throw new Error('Calendar notification queue could not be loaded.')
    }

    queueRows = data ?? []
  }

  const { data: payloadQueueRows, error: payloadQueueError } = await supabaseAdmin
    .from('scheduled_email_queue')
    .select('*')
    .eq('club_id', command.club_id)
    .eq('team_id', command.team_id)
    .contains('payload', { communicationLog: { metadata: { notificationCommandId: command.id } } })

  if (payloadQueueError) {
    console.error('Calendar notification payload queue rows lookup failed', payloadQueueError)
    throw new Error('Calendar notification delivery rows could not be loaded.')
  }

  queueRows = [...new Map([
    ...queueRows,
    ...(payloadQueueRows ?? []),
  ].map((row) => [row.id, row])).values()]

  const queueById = new Map(queueRows.map((row) => [row.id, row]))
  const summary = {
    deliveredCount: 0,
    processingCount: 0,
    failedCount: 0,
    skippedCount: 0,
  }

  for (const notificationEvent of notificationEvents ?? []) {
    if (notificationEvent.status === 'sent') {
      summary.deliveredCount += 1
      summary.skippedCount += 1
      continue
    }

    const queueRow = queueById.get(notificationEvent.email_queue_id)

    if (!queueRow || queueRow.status === 'sent') {
      if (queueRow?.status === 'sent') {
        await updateCalendarNotificationEvent(queueRow.id, 'sent')
        summary.deliveredCount += 1
        summary.skippedCount += 1
      } else {
        summary.failedCount += 1
      }
      continue
    }

    const status = await sendScheduledEmail(queueRow, { retryFailed: true })

    if (status === 'sent' || status === 'duplicate') {
      summary.deliveredCount += 1
      if (status === 'duplicate') {
        summary.skippedCount += 1
      }
    } else if (status === 'failed') {
      summary.failedCount += 1
    } else {
      summary.processingCount += 1
    }
  }

  const finalState = summary.failedCount > 0
    ? summary.deliveredCount > 0 ? 'portal_ready_email_partial' : 'portal_ready_email_failed'
    : summary.processingCount > 0 ? 'portal_ready_email_processing' : 'portal_ready_email_delivered'
  const result = {
    ...(command.result || {}),
    ...summary,
    finalState,
  }

  const { error: resultError } = await supabaseAdmin
    .from('calendar_event_notification_commands')
    .update({ result, completed_at: new Date().toISOString() })
    .eq('id', command.id)
    .eq('requested_by', profile.id)

  if (resultError) {
    console.error('Calendar notification command result update failed', resultError)
  }

  return summary
}

export async function processScheduledEmails() {
  const missingEnvVars = getMissingEnvVars()

  if (missingEnvVars.length > 0) {
    return {
      statusCode: 500,
      payload: { success: false, message: `Missing required environment variables: ${missingEnvVars.join(', ')}` },
    }
  }

  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('scheduled_email_queue')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_at', now)
    .order('scheduled_at', { ascending: true })
    .limit(25)

  if (error) {
    console.error(error)
    return {
      statusCode: 500,
      payload: { success: false, message: 'Scheduled email queue could not be loaded.' },
    }
  }

  const summary = {
    scanned: data?.length ?? 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    duplicate: 0,
  }

  for (const row of data ?? []) {
    const status = await sendScheduledEmail(row)
    summary[status] += 1
  }

  return {
    statusCode: 200,
    payload: { success: true, ...summary },
  }
}

export async function handler(event) {
  if (event.httpMethod && event.httpMethod !== 'POST') {
    return jsonResponse(405, { success: false, message: 'Method Not Allowed' })
  }

  const result = await processScheduledEmails()
  return jsonResponse(result.statusCode, result.payload)
}
