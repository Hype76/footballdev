import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { authorizeProcessorRequest } from './lib/_processor-auth.js'
import { markEmailLogFailed } from './lib/_email-log-store.js'
import { supabaseAdmin } from './lib/_supabase.js'
import { assertTrustedSystemPlanFeature, getClubPlanProfile } from './lib/_plan-gate.js'
import { sendPreparedParentEmail } from './send-parent-email.js'
import { sendParentMobilePushById } from './send-parent-mobile-push.js'
import { buildPreparedScheduledEmail } from './lib/_scheduled-email-payload.js'
import { prepareScheduledResourceNotificationRow } from './lib/_resource-notification-email.js'
import {
  isCalendarNotificationQueueRow,
  isTrialCalendarNotificationQueueRow,
  prepareScheduledCalendarNotificationRow,
} from './lib/_calendar-notification-email.js'
import {
  isTrainingInvitationQueueRow,
  prepareScheduledTrainingInvitationRow,
  updateTrainingInvitationDelivery,
} from './process-training-availability-requests.js'
import {
  MAX_EMAIL_DELIVERY_ATTEMPTS,
  classifyEmailFailure,
  getNextEmailRetryAt,
  getProviderMessageId,
} from './lib/_email-retry-policy.js'
import {
  allowsParentAppNotifications,
  allowsParentEmail,
  resolveScheduledParentCommunicationChannel,
} from './lib/_parent-communication-preferences.js'

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

  const { error: trialError } = await supabaseAdmin
    .from('calendar_trial_event_invitations')
    .update({
      status,
      updated_at: new Date().toISOString(),
      ...(lastError ? { revoked_reason: String(lastError).slice(0, 1000) } : {}),
    })
    .eq('email_queue_id', queueId)

  if (trialError) {
    console.error('Trial Calendar notification delivery state update failed', trialError)
  }
}

async function updateEventPlayerNotificationEvent(queueId, status, lastError = null) {
  if (!queueId) {
    return
  }

  const { error } = await supabaseAdmin
    .from('event_player_notification_events')
    .update({
      status,
      last_error: lastError,
      updated_at: new Date().toISOString(),
    })
    .eq('email_queue_id', queueId)

  if (error && error.code !== 'PGRST205' && error.code !== '42P01') {
    console.error('Event player notification delivery state update failed', error)
  }
}

async function lockScheduledEmail(row, {
  retryFailed = false,
  workerInvocationId,
} = {}) {
  const { data, error } = await supabaseAdmin.rpc('claim_scheduled_email_job_v1', {
    target_job_id: row.id,
    target_worker_invocation_id: workerInvocationId,
    lease_seconds: 120,
    allow_failed: retryFailed,
  })

  if (error) {
    console.error('Scheduled email lock failed', error)
    return null
  }

  return Array.isArray(data) ? data[0] || null : data
}

async function markScheduledEmailFailed(row, error, workerInvocationId) {
  const attempts = Number(row.attempts ?? 0) + 1
  const failure = classifyEmailFailure(error)
  const retryAllowed = failure.retryable
    && row.retry_enabled !== false
    && row.legacy_review_required !== true
    && attempts < MAX_EMAIL_DELIVERY_ATTEMPTS
  const nextRetryAt = retryAllowed ? getNextEmailRetryAt(attempts) : null
  const { error: updateError } = await supabaseAdmin
    .from('scheduled_email_queue')
    .update({
      status: 'failed',
      attempts,
      last_error: 'Email delivery failed.',
      delivery_state: retryAllowed ? 'retrying' : 'failed',
      next_retry_at: nextRetryAt,
      failure_category: failure.category,
      safe_error_code: failure.safeCode,
      terminal_at: retryAllowed ? null : new Date().toISOString(),
      lease_owner: null,
      leased_at: null,
      lease_expires_at: null,
    })
    .eq('id', row.id)
    .eq('lease_owner', workerInvocationId)

  if (updateError) {
    console.error('Scheduled email failure update failed', updateError)
  }
}

async function markParentAppNotificationRetry(row, {
  payload = null,
  providerAccepted = false,
  providerMessageId = null,
  subject = null,
} = {}) {
  const attempts = Number(row.attempts ?? 0) + 1
  const retryAllowed = row.retry_enabled !== false
    && row.legacy_review_required !== true
    && attempts < MAX_EMAIL_DELIVERY_ATTEMPTS
  const { error } = await supabaseAdmin
    .from('scheduled_email_queue')
    .update({
      attempts,
      delivery_state: retryAllowed
        ? 'retrying_app_notification'
        : providerAccepted
          ? 'provider_accepted_app_notification_failed'
          : 'app_notification_failed',
      failure_category: 'parent_app_notification',
      last_error: providerAccepted
        ? 'Email accepted. App notification delivery is waiting for retry.'
        : 'App notification delivery is waiting for retry.',
      lease_expires_at: null,
      lease_owner: null,
      leased_at: null,
      next_retry_at: retryAllowed ? getNextEmailRetryAt(attempts) : null,
      ...(payload ? { payload } : {}),
      ...(providerAccepted ? {
        provider_accepted_at: new Date().toISOString(),
        provider_message_id: providerMessageId,
      } : {}),
      safe_error_code: 'parent_app_notification_pending',
      status: retryAllowed || !providerAccepted ? 'failed' : 'sent',
      ...(subject ? { subject } : {}),
      terminal_at: retryAllowed ? null : new Date().toISOString(),
    })
    .eq('id', row.id)

  if (error) throw error
  return retryAllowed
}

async function markScheduledAppNotificationSent(row, workerInvocationId) {
  const { error } = await supabaseAdmin
    .from('scheduled_email_queue')
    .update({
      delivery_state: 'app_notification_accepted',
      failure_category: null,
      last_error: null,
      lease_expires_at: null,
      lease_owner: null,
      leased_at: null,
      next_retry_at: null,
      safe_error_code: null,
      status: 'sent',
      terminal_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('lease_owner', workerInvocationId)

  if (error) throw error
}

async function discardSkippedScheduledEmail(row, reason) {
  if (isTrainingInvitationQueueRow(row)) {
    await updateTrainingInvitationDelivery({
      lastError: reason,
      queueId: row.id,
      status: 'cancelled',
      supabase: supabaseAdmin,
    })
  }

  const { error } = await supabaseAdmin
    .from('scheduled_email_queue')
    .update({
      status: 'failed',
      delivery_state: 'cancelled',
      retry_enabled: false,
      next_retry_at: null,
      last_error: 'Email delivery was cancelled before send.',
      failure_category: 'non_retryable_cancelled',
      safe_error_code: String(reason || 'cancelled').slice(0, 100),
      terminal_at: new Date().toISOString(),
      lease_owner: null,
      leased_at: null,
      lease_expires_at: null,
    })
    .eq('id', row.id)

  if (error) {
    throw Object.assign(new Error('Skipped resource notification could not be removed safely.'), {
      code: 'resource_notification_cleanup_failed',
      cause: error,
    })
  }

  console.info('resource_notification_skipped', JSON.stringify({
    queueId: row.id,
    reason,
  }))
}

async function createSentCommunicationLog(row, { deliveryChannel = 'email' } = {}) {
  const log = row.payload?.communicationLog

  if (!log || typeof log !== 'object' || !log.clubId || !log.userId) {
    return null
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('communication_logs')
    .select('id, club_id')
    .eq('club_id', log.clubId)
    .eq('channel', 'email')
    .eq('action', 'parent_email_sent')
    .eq('metadata->>scheduledQueueId', row.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingError) {
    console.error('Scheduled communication log reconciliation failed', existingError)
  } else if (existing?.id) {
    return existing
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
    metadata: {
      ...(log.metadata && typeof log.metadata === 'object' ? log.metadata : {}),
      deliveryChannel,
      scheduledQueueId: row.id,
    },
  }).select('id, club_id').single()

  if (error) {
    console.error('Scheduled email communication log failed', error)
    return null
  }

  return data
}

async function sendScheduledParentPush(row, communicationLog) {
  const availabilityRequestId = String(row?.payload?.matchDayAvailability?.requestId ?? '').trim()
  const trainingRequestPlayerId = String(row?.payload?.trainingInvitation?.requestPlayerId ?? '').trim()
  const resourceNotificationId = String(row?.payload?.resourceNotification?.notificationId ?? '').trim()

  if (resourceNotificationId && row?.payload?.resourceNotification?.parentLinkId) {
    try {
      const pushResult = await sendParentMobilePushById({
        id: resourceNotificationId,
        profile: {
          clubId: row.club_id,
          role: 'system',
          roleRank: 100,
        },
        type: 'resource_shared',
      })
      return Number(pushResult?.sent || 0) > 0
    } catch (error) {
      console.error('Scheduled resource mobile push failed', error)
    }
    return false
  }

  if (availabilityRequestId && row?.payload?.matchDayAvailability?.parentLinkId) {
    try {
      const pushResult = await sendParentMobilePushById({
        id: availabilityRequestId,
        profile: {
          clubId: row.club_id,
          role: 'system',
          roleRank: 100,
        },
        type: 'matchday_availability',
      })
      return Number(pushResult?.sent || 0) > 0
    } catch (error) {
      console.error('Scheduled availability mobile push failed', error)
    }
    return false
  }

  if (
    trainingRequestPlayerId
    && row?.payload?.trainingInvitation?.parentLinkId
    && row?.payload?.trainingInvitation?.recipientType === 'parent'
  ) {
    try {
      const pushResult = await sendParentMobilePushById({
        id: trainingRequestPlayerId,
        profile: {
          clubId: row.club_id,
          role: 'system',
          roleRank: 100,
        },
        type: 'training_availability',
      })
      return Number(pushResult?.sent || 0) > 0
    } catch (error) {
      console.error('Scheduled training availability mobile push failed', error)
    }
    return false
  }

  if (!communicationLog?.id || !communicationLog?.club_id) {
    return false
  }

  try {
    const pushResult = await sendParentMobilePushById({
      id: communicationLog.id,
      profile: {
        clubId: communicationLog.club_id,
        role: 'system',
        roleRank: 100,
      },
      type: 'parent_message',
    })
    return Number(pushResult?.sent || 0) > 0
  } catch (error) {
    console.error('Scheduled email parent mobile push failed', error)
    return false
  }
}

async function validateMatchDayScorerReminder(row) {
  const reminder = row?.payload?.matchDayScorerReminder
  const operationKey = String(reminder?.operationKey ?? '').trim()
  if (!operationKey) {
    return { valid: true }
  }

  const { data, error } = await supabaseAdmin.rpc('validate_match_day_scorer_reminder', {
    operation_key_value: operationKey,
  })
  if (error) {
    console.error('Match Day scorer reminder validation failed', error)
    return { valid: false, reason: 'match_day_scorer_reminder_validation_failed' }
  }

  return {
    valid: data?.valid === true,
    reason: String(data?.reason || 'match_day_scorer_reminder_stale'),
  }
}

async function markMatchDayScorerReminderSent(row) {
  const operationKey = String(row?.payload?.matchDayScorerReminder?.operationKey ?? '').trim()
  if (!operationKey) {
    return
  }

  const { error } = await supabaseAdmin.rpc('mark_match_day_scorer_reminder_sent', {
    operation_key_value: operationKey,
  })
  if (error) {
    console.error('Match Day scorer reminder completion update failed', error)
  }
}

export async function sendScheduledEmail(row, { retryFailed = false } = {}) {
  const workerInvocationId = randomUUID()
  const lockedRow = await lockScheduledEmail(row, {
    retryFailed,
    workerInvocationId,
  })

  if (!lockedRow) {
    return 'skipped'
  }

  const claimedAt = new Date().toISOString()
  if (isCalendarNotificationQueueRow(lockedRow)) {
    await updateCalendarNotificationEvent(lockedRow.id, 'processing')
  }
  await updateEventPlayerNotificationEvent(lockedRow.id, 'processing')

  try {
    const scorerReminderValidation = await validateMatchDayScorerReminder(lockedRow)
    if (!scorerReminderValidation.valid) {
      await discardSkippedScheduledEmail(lockedRow, scorerReminderValidation.reason)
      return 'skipped'
    }

    const planProfile = {
      ...await getClubPlanProfile(lockedRow.club_id),
      role: 'system',
      roleRank: 100,
    }
    assertTrustedSystemPlanFeature(planProfile, 'parentEmails')
    const trainingInvitationPreparation = await prepareScheduledTrainingInvitationRow(
      lockedRow,
      {
        appOrigin: String(process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://footballplayer.online').replace(/\/$/, ''),
        supabaseClient: supabaseAdmin,
      },
    )
    const calendarNotificationPreparation = await prepareScheduledCalendarNotificationRow(
      trainingInvitationPreparation.row,
      {
        supabaseClient: supabaseAdmin,
      },
    )
    const resourceNotificationPreparation = await prepareScheduledResourceNotificationRow(
      calendarNotificationPreparation.row,
      {
        supabaseClient: supabaseAdmin,
      },
    )

    if (
      trainingInvitationPreparation.skipped
      || calendarNotificationPreparation.skipped
      || resourceNotificationPreparation.skipped
    ) {
      const skipReason = trainingInvitationPreparation.skipReason
        || calendarNotificationPreparation.skipReason
        || resourceNotificationPreparation.skipReason
      await discardSkippedScheduledEmail(
        lockedRow,
        skipReason,
      )
      if (isCalendarNotificationQueueRow(lockedRow)) {
        await updateCalendarNotificationEvent(lockedRow.id, 'failed', skipReason)
      }
      await updateEventPlayerNotificationEvent(lockedRow.id, 'failed', skipReason)
      return 'skipped'
    }

    const communicationChannel = await resolveScheduledParentCommunicationChannel(
      supabaseAdmin,
      resourceNotificationPreparation.row,
    )
    const isAvailabilityNotification = Boolean(
      resourceNotificationPreparation.row?.payload?.matchDayAvailability?.requestId
      && resourceNotificationPreparation.row?.payload?.matchDayAvailability?.parentLinkId,
    )
    const isTrainingAvailabilityNotification = Boolean(
      resourceNotificationPreparation.row?.payload?.trainingInvitation?.requestPlayerId
      && resourceNotificationPreparation.row?.payload?.trainingInvitation?.parentLinkId
      && resourceNotificationPreparation.row?.payload?.trainingInvitation?.recipientType === 'parent',
    )
    const isResponseNotification = isAvailabilityNotification || isTrainingAvailabilityNotification
    let appNotificationSent = Boolean(
      resourceNotificationPreparation.row?.payload?.parentCommunication?.appNotificationSentAt,
    )
    if (allowsParentAppNotifications(communicationChannel) && isResponseNotification && !appNotificationSent) {
      appNotificationSent = await sendScheduledParentPush(resourceNotificationPreparation.row, null)
      if (appNotificationSent) {
        const appNotificationSentAt = new Date().toISOString()
        const payload = {
          ...(resourceNotificationPreparation.row.payload || {}),
          parentCommunication: {
            ...(resourceNotificationPreparation.row.payload?.parentCommunication || {}),
            appNotificationSentAt,
          },
        }
        resourceNotificationPreparation.row.payload = payload
        await supabaseAdmin.from('scheduled_email_queue').update({ payload }).eq('id', lockedRow.id).eq('lease_owner', workerInvocationId)
      }
    }
    if (!allowsParentEmail(communicationChannel)) {
      let appOnlyCommunicationLog = null
      if (!appNotificationSent && resourceNotificationPreparation.row?.payload?.communicationLog) {
        appOnlyCommunicationLog = await createSentCommunicationLog(
          resourceNotificationPreparation.row,
          { deliveryChannel: 'app' },
        )
      }
      if (!appNotificationSent) appNotificationSent = await sendScheduledParentPush(resourceNotificationPreparation.row, appOnlyCommunicationLog)
      if (!appNotificationSent) {
        await markParentAppNotificationRetry(lockedRow)
        return 'failed'
      }
      if (isTrainingInvitationQueueRow(lockedRow)) {
        await updateTrainingInvitationDelivery({
          queueId: lockedRow.id,
          status: 'sent',
          supabase: supabaseAdmin,
        })
      }
      await markScheduledAppNotificationSent(lockedRow, workerInvocationId)
      if (isCalendarNotificationQueueRow(lockedRow)) {
        await updateCalendarNotificationEvent(lockedRow.id, 'sent')
      }
      await updateEventPlayerNotificationEvent(lockedRow.id, 'sent')
      return 'sent'
    }

    const preparedEmail = buildPreparedScheduledEmail(
      resourceNotificationPreparation.row,
      planProfile,
      {
        fromDisplayName: calendarNotificationPreparation.email?.fromDisplayName
          || resourceNotificationPreparation.email?.fromDisplayName,
      },
    )
    const sendResult = await sendPreparedParentEmail(preparedEmail, {
      deliveryTelemetry: {
        ...(lockedRow.payload?.deliveryTelemetry || {}),
        logicalKey: `scheduled_email_queue:${lockedRow.id}`,
        sourceType: 'scheduled_email_queue',
        sourceId: lockedRow.id,
        originActionAt: lockedRow.payload?.deliveryTelemetry?.originActionAt || lockedRow.created_at,
        eligibleAt: lockedRow.scheduled_at,
        enqueuedAt: lockedRow.payload?.deliveryTelemetry?.enqueuedAt || lockedRow.created_at,
        scheduledAt: lockedRow.scheduled_at,
        claimedAt,
        processingStartedAt: new Date().toISOString(),
        workerInvocationId,
      },
      idempotencySeed: `scheduled:${lockedRow.id}`,
      retryOwner: 'scheduled_queue',
      retryPending: true,
    })

    if (isTrainingInvitationQueueRow(lockedRow)) {
      await updateTrainingInvitationDelivery({
        queueId: lockedRow.id,
        status: 'sent',
        supabase: supabaseAdmin,
      })
    }
    await updateEventPlayerNotificationEvent(lockedRow.id, 'sent')

    const preparedRow = resourceNotificationPreparation.row
    const preparedPayload = preparedRow.payload || {}
    const sentPayload = isTrialCalendarNotificationQueueRow(lockedRow)
      ? {
          ...preparedPayload,
          resendPayload: {
            ...(preparedPayload.resendPayload || {}),
            html: '<p>Trial event invitation sent.</p>',
          },
          trialEventInvitation: {
            ...(preparedPayload.trialEventInvitation || {}),
            rawToken: null,
          },
        }
      : preparedPayload
    const communicationLog = await createSentCommunicationLog(
      isTrialCalendarNotificationQueueRow(lockedRow)
        ? lockedRow
        : resourceNotificationPreparation.row,
      { deliveryChannel: communicationChannel },
    )
    if (allowsParentAppNotifications(communicationChannel) && !appNotificationSent) {
      appNotificationSent = await sendScheduledParentPush(resourceNotificationPreparation.row, communicationLog)
      if (!appNotificationSent) {
        await markParentAppNotificationRetry(lockedRow, {
          payload: sentPayload,
          providerAccepted: true,
          providerMessageId: getProviderMessageId(sendResult),
          subject: preparedRow.subject,
        })
        return 'failed'
      }
    }

    const finalPayload = appNotificationSent && !sentPayload?.parentCommunication?.appNotificationSentAt
      ? {
          ...sentPayload,
          parentCommunication: {
            ...(sentPayload?.parentCommunication || {}),
            appNotificationSentAt: new Date().toISOString(),
          },
        }
      : sentPayload
    const { error: completionError } = await supabaseAdmin
      .from('scheduled_email_queue')
      .update({
        status: 'sent',
        delivery_state: 'provider_accepted',
        last_error: null,
        next_retry_at: null,
        failure_category: null,
        safe_error_code: null,
        provider_message_id: getProviderMessageId(sendResult),
        provider_accepted_at: new Date().toISOString(),
        lease_owner: null,
        leased_at: null,
        lease_expires_at: null,
        payload: finalPayload,
        subject: preparedRow.subject,
      })
      .eq('id', lockedRow.id)
      .eq('lease_owner', workerInvocationId)

    if (completionError) throw completionError

    await markMatchDayScorerReminderSent(lockedRow)

    if (isCalendarNotificationQueueRow(lockedRow)) {
      await updateCalendarNotificationEvent(lockedRow.id, 'sent')
    }

    return sendResult.duplicate ? 'duplicate' : 'sent'
  } catch (error) {
    console.error('Scheduled email send failed', getSafeErrorDetails(error))
    await markEmailLogFailed(error.emailLogRecord, error)
    await markScheduledEmailFailed(lockedRow, error, workerInvocationId)
    if (isTrainingInvitationQueueRow(lockedRow)) {
      await updateTrainingInvitationDelivery({
        lastError: 'Training availability email could not be sent.',
        queueId: lockedRow.id,
        status: 'failed',
        supabase: supabaseAdmin,
      }).catch((deliveryError) => {
        console.error('Training invitation delivery state update failed', {
          code: String(deliveryError?.code || deliveryError?.name || 'unknown'),
        })
      })
    }
    if (isCalendarNotificationQueueRow(lockedRow)) {
      await updateCalendarNotificationEvent(lockedRow.id, 'failed', 'Email delivery failed.')
    }
    await updateEventPlayerNotificationEvent(lockedRow.id, 'failed', 'Email delivery failed.')
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

  let notificationEventsQuery = supabaseAdmin
    .from('calendar_event_notification_events')
    .select('id, email_queue_id, status')
    .eq('notification_command_id', command.id)
    .eq('club_id', command.club_id)

  notificationEventsQuery = command.team_id
    ? notificationEventsQuery.eq('team_id', command.team_id)
    : notificationEventsQuery.is('team_id', null)

  const { data: notificationEvents, error: eventsError } = await notificationEventsQuery

  if (eventsError) {
    console.error('Calendar notification delivery rows lookup failed', eventsError)
    throw new Error('Calendar notification delivery rows could not be loaded.')
  }

  const { data: trialInvitationEvents, error: trialEventsError } = await supabaseAdmin
    .from('calendar_trial_event_invitations')
    .select('id, email_queue_id, status')
    .eq('notification_command_id', command.id)
    .eq('club_id', command.club_id)

  if (trialEventsError) {
    console.error('Trial Calendar notification delivery rows lookup failed', trialEventsError)
    throw new Error('Trial Calendar notification delivery rows could not be loaded.')
  }

  const allNotificationEvents = [
    ...(notificationEvents ?? []),
    ...(trialInvitationEvents ?? []),
  ]
  const queueIds = [...new Set(allNotificationEvents.map((row) => row.email_queue_id).filter(Boolean))]
  let queueRows = []

  if (queueIds.length > 0) {
    let queueRowsQuery = supabaseAdmin
      .from('scheduled_email_queue')
      .select('*')
      .in('id', queueIds)
      .eq('club_id', command.club_id)

    queueRowsQuery = command.team_id
      ? queueRowsQuery.eq('team_id', command.team_id)
      : queueRowsQuery.is('team_id', null)

    const { data, error } = await queueRowsQuery

    if (error) {
      console.error('Calendar notification queue lookup failed', error)
      throw new Error('Calendar notification queue could not be loaded.')
    }

    queueRows = data ?? []
  }

  let payloadQueueQuery = supabaseAdmin
    .from('scheduled_email_queue')
    .select('*')
    .eq('club_id', command.club_id)
    .contains('payload', { communicationLog: { metadata: { notificationCommandId: command.id } } })

  payloadQueueQuery = command.team_id
    ? payloadQueueQuery.eq('team_id', command.team_id)
    : payloadQueueQuery.is('team_id', null)

  const { data: payloadQueueRows, error: payloadQueueError } = await payloadQueueQuery

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

  for (const notificationEvent of allNotificationEvents) {
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
      payload: { success: false, message: 'Scheduled email processor is not configured.' },
    }
  }

  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('scheduled_email_queue')
    .select('*')
    .in('status', ['scheduled', 'failed', 'sending'])
    .or(
      `and(status.eq.scheduled,scheduled_at.lte.${now}),`
      + `and(status.eq.failed,retry_enabled.eq.true,legacy_review_required.eq.false,next_retry_at.lte.${now}),`
      + `and(status.eq.sending,retry_enabled.eq.true,legacy_review_required.eq.false,lease_expires_at.lte.${now})`,
    )
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
    const status = row.status === 'failed'
      ? await sendScheduledEmail(row, { retryFailed: true })
      : await sendScheduledEmail(row)
    summary[status] += 1
  }

  return {
    statusCode: 200,
    payload: { success: true, ...summary },
  }
}

export async function handler(event) {
  const authorization = authorizeProcessorRequest(event)

  if (!authorization.ok) {
    return authorization.response
  }

  const result = await processScheduledEmails()
  return jsonResponse(result.statusCode, result.payload)
}
