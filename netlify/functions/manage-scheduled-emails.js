import { supabaseAdmin } from './_supabase.js'
import {
  assertPlanFeature,
  getAuthenticatedPlanProfile,
  getClubPlanProfile,
} from './_plan-gate.js'
import { sendPreparedParentEmail } from './send-parent-email.js'

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function successResponse(payload = {}) {
  return jsonResponse(200, { success: true, ...payload })
}

function failureResponse(statusCode, message) {
  return jsonResponse(statusCode, { success: false, message })
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

function isValidEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(value ?? '').trim())
}

function parseScheduledAt(value) {
  const parsedDate = new Date(String(value ?? '').trim())

  if (Number.isNaN(parsedDate.getTime())) {
    throw Object.assign(new Error('Choose a valid scheduled send date and time.'), { statusCode: 400 })
  }

  if (parsedDate.getTime() <= Date.now() + 30000) {
    throw Object.assign(new Error('Scheduled send time must be at least 30 seconds from now.'), { statusCode: 400 })
  }

  return parsedDate.toISOString()
}

function canUseQueue(profile) {
  return Boolean(profile?.clubId) && profile.role !== 'super_admin' && Number(profile.roleRank ?? 0) >= 20
}

function normalizeRow(row) {
  const payload = row.payload || {}
  const resendPayload = payload.resendPayload || {}

  return {
    id: row.id,
    clubId: row.club_id,
    teamId: row.team_id,
    createdBy: row.created_by,
    createdByEmail: row.created_by_email,
    toEmail: row.to_email,
    subject: row.subject,
    status: row.status,
    scheduledAt: row.scheduled_at,
    html: String(resendPayload.html ?? ''),
    hasAttachment: Boolean(resendPayload.attachments?.length),
    lastError: row.last_error,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    displayName: payload.displayName || '',
    teamName: payload.teamName || '',
    clubName: payload.clubName || '',
    playerName: payload.playerName || '',
    parentName: payload.parentName || '',
  }
}

async function getQueueRow({ id, profile }) {
  const { data, error } = await supabaseAdmin
    .from('scheduled_email_queue')
    .select('*')
    .eq('id', id)
    .eq('club_id', profile.clubId)
    .maybeSingle()

  if (error) {
    console.error(error)
    throw new Error('Email queue item could not be loaded.')
  }

  if (!data) {
    throw Object.assign(new Error('Email queue item was not found.'), { statusCode: 404 })
  }

  return data
}

async function listQueue({ profile }) {
  let query = supabaseAdmin
    .from('scheduled_email_queue')
    .select('*')
    .eq('club_id', profile.clubId)
    .in('status', ['scheduled', 'failed'])
    .order('scheduled_at', { ascending: true })
    .limit(100)

  if (Number(profile.roleRank ?? 0) < 50) {
    query = query.eq('created_by', profile.id)
  }

  const { data, error } = await query

  if (error) {
    console.error(error)
    throw new Error('Email queue could not be loaded.')
  }

  return (data ?? []).map(normalizeRow)
}

async function updateQueueItem({ body, profile }) {
  const row = await getQueueRow({ id: body.id, profile })

  if (row.status === 'sending') {
    throw Object.assign(new Error('This email is already being sent.'), { statusCode: 409 })
  }

  const recipients = normalizeRecipients(body.toEmail)

  if (recipients.length === 0 || !recipients.every(isValidEmail)) {
    throw Object.assign(new Error('Enter at least one valid recipient email.'), { statusCode: 400 })
  }

  if (recipients.length > 5) {
    throw Object.assign(new Error('Too many emails in one queue item.'), { statusCode: 400 })
  }

  const subject = String(body.subject ?? '').trim() || 'Football Player'
  const html = String(body.html ?? '').trim() || '<p>No content</p>'
  const payload = {
    ...(row.payload || {}),
    resendPayload: {
      ...((row.payload || {}).resendPayload || {}),
      to: recipients,
      subject,
      html,
    },
  }

  if (payload.communicationLog && typeof payload.communicationLog === 'object') {
    payload.communicationLog = {
      ...payload.communicationLog,
      recipientEmail: recipients.join(', '),
      metadata: {
        ...(payload.communicationLog.metadata || {}),
        subject,
        body: html,
        scheduledAt: parseScheduledAt(body.scheduledAt),
      },
    }
  }

  const { data, error } = await supabaseAdmin
    .from('scheduled_email_queue')
    .update({
      to_email: recipients.join(', '),
      subject,
      scheduled_at: parseScheduledAt(body.scheduledAt),
      status: 'scheduled',
      last_error: null,
      payload,
    })
    .eq('id', row.id)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw new Error('Email queue item could not be updated.')
  }

  return normalizeRow(data)
}

async function deleteQueueItem({ body, profile }) {
  const row = await getQueueRow({ id: body.id, profile })

  if (row.status === 'sending') {
    throw Object.assign(new Error('This email is already being sent.'), { statusCode: 409 })
  }

  const { error } = await supabaseAdmin
    .from('scheduled_email_queue')
    .delete()
    .eq('id', row.id)

  if (error) {
    console.error(error)
    throw new Error('Email queue item could not be deleted.')
  }

  return { id: row.id }
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

async function createSentCommunicationLog(row) {
  const log = row.payload?.communicationLog

  if (!log || typeof log !== 'object' || !log.clubId || !log.userId) {
    return
  }

  const { error } = await supabaseAdmin.from('communication_logs').insert({
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
  })

  if (error) {
    console.error('Queued email communication log failed', error)
  }
}

async function sendNowQueueItem({ body, profile }) {
  const row = await getQueueRow({ id: body.id, profile })

  if (row.status === 'sending') {
    throw Object.assign(new Error('This email is already being sent.'), { statusCode: 409 })
  }

  const { data: lockedRow, error: lockError } = await supabaseAdmin
    .from('scheduled_email_queue')
    .update({ status: 'sending' })
    .eq('id', row.id)
    .neq('status', 'sending')
    .select('*')
    .maybeSingle()

  if (lockError || !lockedRow) {
    throw Object.assign(new Error('This email is already being processed.'), { statusCode: 409 })
  }

  try {
    const planProfile = await getClubPlanProfile(lockedRow.club_id)
    assertPlanFeature(planProfile, 'parentEmail')
    const sendResult = await sendPreparedParentEmail(buildPreparedEmail(lockedRow, planProfile), {
      idempotencySeed: `scheduled:${lockedRow.id}`,
    })

    await supabaseAdmin
      .from('scheduled_email_queue')
      .delete()
      .eq('id', lockedRow.id)

    if (!sendResult.duplicate) {
      await createSentCommunicationLog(lockedRow)
    }

    return {
      id: lockedRow.id,
      duplicate: Boolean(sendResult.duplicate),
    }
  } catch (error) {
    await supabaseAdmin
      .from('scheduled_email_queue')
      .update({
        status: 'failed',
        last_error: error.message || String(error),
        attempts: Number(lockedRow.attempts ?? 0) + 1,
      })
      .eq('id', lockedRow.id)
    throw error
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const profile = await getAuthenticatedPlanProfile(event, { clubId: body.clubId })
    assertPlanFeature(profile, 'parentEmail')

    if (!canUseQueue(profile)) {
      return failureResponse(403, 'You do not have permission to manage the email queue.')
    }

    const action = String(body.action ?? 'list').trim()

    if (action === 'list') {
      return successResponse({ queue: await listQueue({ profile }) })
    }

    if (action === 'update') {
      return successResponse({ item: await updateQueueItem({ body, profile }) })
    }

    if (action === 'delete') {
      return successResponse(await deleteQueueItem({ body, profile }))
    }

    if (action === 'sendNow') {
      return successResponse(await sendNowQueueItem({ body, profile }))
    }

    return failureResponse(400, 'Unknown email queue action.')
  } catch (error) {
    console.error(error)
    return failureResponse(error.statusCode || 500, error.statusCode ? error.message : 'Email queue action failed.')
  }
}
