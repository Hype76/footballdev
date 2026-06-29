import process from 'node:process'
import { markEmailLogFailed } from './lib/_email-log-store.js'
import { supabaseAdmin } from './lib/_supabase.js'
import { assertPlanFeature, getClubPlanProfile } from './lib/_plan-gate.js'
import { sendPreparedParentEmail } from './send-parent-email.js'
import { sendParentMobilePushById } from './send-parent-mobile-push.js'

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

function normalizeRecipients(value) {
  if (Array.isArray(value)) {
    return value.map((email) => String(email ?? '').trim()).filter(Boolean)
  }

  return String(value ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)
}

async function lockScheduledEmail(row) {
  const { data, error } = await supabaseAdmin
    .from('scheduled_email_queue')
    .update({ status: 'sending' })
    .eq('id', row.id)
    .eq('status', 'scheduled')
    .select('*')
    .maybeSingle()

  if (error) {
    console.error('Scheduled email lock failed', error)
    return null
  }

  return data
}

function buildPreparedEmail(row, planProfile) {
  const payload = row.payload || {}
  const resendPayload = payload.resendPayload || {}
  const recipients = normalizeRecipients(resendPayload.to || row.to_email)

  return {
    emailHtml: String(resendPayload.html ?? ''),
    emailPayload: resendPayload,
    emailSubject: String(resendPayload.subject ?? row.subject ?? '').trim() || 'Football Player',
    planProfile,
    recipients,
    senderCopyEmails: normalizeRecipients(resendPayload.cc),
    storedPayload: payload,
  }
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

async function sendScheduledEmail(row) {
  const lockedRow = await lockScheduledEmail(row)

  if (!lockedRow) {
    return 'skipped'
  }

  try {
    const planProfile = {
      ...await getClubPlanProfile(lockedRow.club_id),
      role: 'system',
      roleRank: 100,
    }
    assertPlanFeature(planProfile, 'parentEmails')
    const preparedEmail = buildPreparedEmail(lockedRow, planProfile)
    const sendResult = await sendPreparedParentEmail(preparedEmail, {
      idempotencySeed: `scheduled:${lockedRow.id}`,
    })

    await supabaseAdmin
      .from('scheduled_email_queue')
      .delete()
      .eq('id', lockedRow.id)

    if (sendResult.duplicate) {
      return 'duplicate'
    }

    const communicationLog = await createSentCommunicationLog(lockedRow)
    await sendScheduledParentPush(communicationLog)

    return 'sent'
  } catch (error) {
    console.error('Scheduled email send failed', error)
    await markEmailLogFailed(error.emailLogRecord, error)
    await markScheduledEmailFailed(lockedRow, error)
    return 'failed'
  }
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
