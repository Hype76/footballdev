import process from 'node:process'
import { randomUUID } from 'node:crypto'
import { Resend } from 'resend'
import { buildPdfBuffer } from '../../src/lib/pdf-builder.js'
import {
  createEmailDedupeKey,
  createEmailIdempotencyKey,
  createEmailRecipientDedupeKeys,
  createPendingEmailLog,
  createServerAuditLog,
  markEmailLogFailed,
  markEmailLogSent,
} from './_email-log-store.js'
import { supabaseAdmin } from './_supabase.js'
import {
  assertPlanFeature,
  getAuthenticatedRequestUser,
  getClubPlanProfile,
} from './_plan-gate.js'

void supabaseAdmin

const DEMO_EMAIL = 'demo@playerfeedback.online'

function cleanHeaderPart(value, fallback) {
  const cleanedValue = String(value ?? '')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127 && !'<>{}[]"\'`;\\'.includes(character)
    })
    .join('')
    .trim()

  return cleanedValue || fallback
}

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

function getMissingEnvVars() {
  return ['RESEND_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL'].filter(
    (envName) => !process.env[envName],
  )
}

function isValidEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(value ?? '').trim())
}

function normaliseEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

function normaliseRecipients(value) {
  if (Array.isArray(value)) {
    return value.map((email) => String(email ?? '').trim()).filter(Boolean)
  }

  return String(value ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)
}

function getSenderCopyEmails(senderEmail, recipients) {
  const normalisedRecipients = new Set(recipients.map(normaliseEmail))
  const senderCopyEmail = normaliseEmail(senderEmail)

  if (!senderCopyEmail || !isValidEmail(senderCopyEmail) || normalisedRecipients.has(senderCopyEmail)) {
    return []
  }

  return [senderCopyEmail]
}

function buildEmailHtml(html) {
  return String(html ?? '').trim() || '<p>No content</p>'
}

function buildEmailPayload({
  fromName,
  recipients,
  safeReplyTo,
  senderCopyEmails,
  subject,
  emailHtml,
  attachments,
}) {
  const emailPayload = {
    from: `${fromName} <feedback@footballplayer.online>`,
    to: recipients,
    replyTo: safeReplyTo || undefined,
    subject: String(subject ?? '').trim() || 'Football Player',
    html: emailHtml,
  }

  if (senderCopyEmails.length > 0) {
    emailPayload.cc = senderCopyEmails
  }

  if (attachments.length > 0) {
    emailPayload.attachments = attachments
  }

  return emailPayload
}

function withTimeout(promise, timeoutMs, errorMessage) {
  let timeoutId
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(errorMessage))
    }, timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId)
  })
}

async function buildPdfAttachment(pdfHtml) {
  try {
    const pdfBuffer = await withTimeout(
      buildPdfBuffer(pdfHtml),
      10000,
      'PDF generation timed out',
    )

    if (!pdfBuffer?.length) {
      return []
    }

    return [
      {
        filename: 'player-feedback.pdf',
        content: pdfBuffer.toString('base64'),
        contentType: 'application/pdf',
      },
    ]
  } catch (error) {
    console.error('PDF attachment generation failed', error)
    return []
  }
}

function removeAttachments(emailPayload) {
  const { attachments, ...payloadWithoutAttachments } = emailPayload
  void attachments
  return payloadWithoutAttachments
}

async function createEmailAuditLog(payload) {
  try {
    await createServerAuditLog(payload)
  } catch (error) {
    console.error('Email audit logging failed', error)
  }
}

function parseScheduledAt(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return null
  }

  const parsedDate = new Date(normalizedValue)

  if (Number.isNaN(parsedDate.getTime())) {
    throw Object.assign(new Error('Choose a valid scheduled send date and time.'), { statusCode: 400 })
  }

  return parsedDate
}

function isFutureScheduledDate(dateValue) {
  return dateValue instanceof Date && dateValue.getTime() > Date.now() + 30000
}

export async function prepareParentEmail({ body, requestUser }) {
  const planProfile = await getClubPlanProfile(body.clubId)
  assertPlanFeature(planProfile, 'parentEmail')

  const {
    parentEmail,
    displayName,
    teamName,
    clubName,
    replyToEmail,
    clubContactEmail,
    clubEmail,
    subject,
    html,
    pdfHtml,
    logoUrl,
    playerName,
    parentName,
    senderEmail,
    attachPdf,
  } = body

  const normalizedSenderEmail = normaliseEmail(senderEmail)

  if (normalizedSenderEmail && normalizedSenderEmail !== requestUser.email) {
    throw Object.assign(new Error('Email can only be sent from your logged-in account.'), { statusCode: 403 })
  }

  if (requestUser.email === DEMO_EMAIL) {
    throw Object.assign(new Error('Email sending is disabled for the demo account'), { statusCode: 403 })
  }

  const recipients = normaliseRecipients(parentEmail)

  if (recipients.length === 0) {
    throw Object.assign(new Error('Parent email is required'), { statusCode: 400 })
  }

  if (!recipients.every(isValidEmail)) {
    throw Object.assign(new Error('Parent email must be a valid email address'), { statusCode: 400 })
  }

  if (recipients.length > 5) {
    throw Object.assign(new Error('Too many emails in one request'), { statusCode: 400 })
  }

  if (replyToEmail && !isValidEmail(replyToEmail)) {
    throw Object.assign(new Error('Reply-to email must be a valid email address'), { statusCode: 400 })
  }

  const senderReplyTo = isValidEmail(normalizedSenderEmail) ? normalizedSenderEmail : ''
  const safeDisplayName = cleanHeaderPart(displayName, 'Coach')
  const safeTeamName = cleanHeaderPart(teamName, 'Team')
  const safeClubName = cleanHeaderPart(clubName, 'Club')
  const fromName = `${safeDisplayName} (${safeTeamName} - ${safeClubName})`
  const safeReplyTo = cleanHeaderPart(senderReplyTo || replyToEmail || clubContactEmail || clubEmail, '')
  const senderCopyEmails = getSenderCopyEmails(senderEmail, recipients)
  const emailHtml = buildEmailHtml(html)

  if (emailHtml.length > 200000) {
    throw Object.assign(new Error('Email content is too large'), { statusCode: 400 })
  }

  const shouldAttachPdf = attachPdf === true
  if (shouldAttachPdf) {
    assertPlanFeature(planProfile, 'pdfExport')
  }

  const attachmentHtml = buildEmailHtml(pdfHtml || emailHtml)
  const attachments = shouldAttachPdf ? await buildPdfAttachment(attachmentHtml) : []
  const emailSubject = String(subject ?? '').trim() || 'Football Player'
  const emailPayload = buildEmailPayload({
    fromName,
    recipients,
    safeReplyTo,
    senderCopyEmails,
    subject: emailSubject,
    emailHtml,
    attachments,
  })
  const storedPayload = {
    resendPayload: emailPayload,
    displayName: safeDisplayName,
    teamName: safeTeamName,
    clubName: safeClubName,
    logoUrl: String(logoUrl ?? '').trim(),
    playerName: String(playerName ?? '').trim(),
    parentName: String(parentName ?? '').trim(),
    clubId: planProfile.clubId,
    teamId: String(body.teamId ?? '').trim() || null,
    actorId: String(body.userId ?? requestUser.id ?? '').trim(),
    actorEmail: requestUser.email,
    requiredFeature: 'parentEmail',
    communicationLog: body.communicationLog && typeof body.communicationLog === 'object' ? body.communicationLog : null,
  }

  return {
    attachments,
    emailHtml,
    emailPayload,
    emailSubject,
    planProfile,
    recipients,
    senderCopyEmails,
    storedPayload,
  }
}

async function createScheduledEmail({ preparedEmail, scheduledAt }) {
  const { data, error } = await supabaseAdmin
    .from('scheduled_email_queue')
    .insert({
      club_id: preparedEmail.planProfile.clubId,
      team_id: preparedEmail.storedPayload.teamId,
      created_by: preparedEmail.storedPayload.actorId || null,
      created_by_email: preparedEmail.storedPayload.actorEmail,
      to_email: preparedEmail.recipients.join(', '),
      subject: preparedEmail.emailSubject,
      status: 'scheduled',
      scheduled_at: scheduledAt.toISOString(),
      payload: preparedEmail.storedPayload,
    })
    .select('id, scheduled_at')
    .single()

  if (error) {
    console.error(error)
    throw new Error('Email could not be added to the queue.')
  }

  await createEmailAuditLog({
    user: null,
    action: 'email_scheduled',
    entityType: 'email',
    entityId: data.id,
    metadata: {
      to: preparedEmail.recipients,
      subject: preparedEmail.emailSubject,
      clubId: preparedEmail.planProfile.clubId,
      teamId: preparedEmail.storedPayload.teamId,
      actorId: preparedEmail.storedPayload.actorId,
      actorEmail: preparedEmail.storedPayload.actorEmail,
      scheduledAt: data.scheduled_at,
      hasAttachment: Boolean(preparedEmail.emailPayload.attachments?.length),
    },
  })

  return data
}

export async function sendPreparedParentEmail(preparedEmail, { idempotencySeed = '' } = {}) {
  let emailLogRecord = null
  const dedupeKey = createEmailDedupeKey(preparedEmail.emailPayload)
  const recipientDedupeKeys = createEmailRecipientDedupeKeys({
    payload: preparedEmail.emailPayload,
    recipients: preparedEmail.recipients,
  })
  const finalIdempotencyKey = createEmailIdempotencyKey({
    payload: preparedEmail.emailPayload,
    idempotencySeed: idempotencySeed || `parent-email:${randomUUID()}`,
  })
  const pendingLogResult = await createPendingEmailLog({
    recipients: preparedEmail.recipients,
    subject: preparedEmail.emailSubject,
    payload: preparedEmail.storedPayload,
    dedupeKey,
    recipientDedupeKeys,
    idempotencyKey: finalIdempotencyKey,
  })

  emailLogRecord = pendingLogResult.record

  if (pendingLogResult.blocked) {
    throw Object.assign(new Error('This email has already been sent 3 times in 5 minutes. Wait before sending again.'), { statusCode: 429, emailLogRecord })
  }

  if (pendingLogResult.skipped) {
    return { duplicate: true, emailLogRecord }
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  let response
  let sentPayload = preparedEmail.emailPayload

  try {
    response = await resend.emails.send(preparedEmail.emailPayload)
  } catch (sendWithPdfError) {
    if (!preparedEmail.emailPayload.attachments?.length) {
      throw Object.assign(sendWithPdfError, { emailLogRecord })
    }

    console.error('Email send with PDF failed, retrying without attachment', sendWithPdfError)
    sentPayload = removeAttachments(preparedEmail.emailPayload)
    response = await resend.emails.send(sentPayload)
  }

  await markEmailLogSent(emailLogRecord, response, { recipientDedupeKeys })
  await createEmailAuditLog({
    user: null,
    action: 'email_sent',
    entityType: 'email',
    metadata: {
      to: preparedEmail.recipients,
      cc: preparedEmail.senderCopyEmails,
      subject: preparedEmail.emailSubject,
      clubId: preparedEmail.planProfile.clubId,
      teamId: preparedEmail.storedPayload.teamId,
      actorId: preparedEmail.storedPayload.actorId,
      actorEmail: preparedEmail.storedPayload.actorEmail,
      hasAttachment: Boolean(sentPayload.attachments?.length),
      playerName: preparedEmail.storedPayload.playerName,
      teamName: preparedEmail.storedPayload.teamName,
      clubName: preparedEmail.storedPayload.clubName,
    },
  })

  return {
    id: response?.data?.id || response?.id || '',
    hasAttachment: Boolean(sentPayload.attachments?.length),
    htmlSize: preparedEmail.emailHtml.length,
    emailLogRecord,
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  let recipients = []
  let emailSubject = 'Football Player'
  let emailLogRecord = null

  try {
    const missingEnvVars = getMissingEnvVars()

    if (missingEnvVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`)
    }

    const body = JSON.parse(event.body || '{}')
    const requestUser = await getAuthenticatedRequestUser(event)
    const scheduledAt = parseScheduledAt(body.scheduledAt)

    if (scheduledAt && !isFutureScheduledDate(scheduledAt)) {
      throw Object.assign(new Error('Scheduled send time must be at least 30 seconds from now.'), { statusCode: 400 })
    }

    const preparedEmail = await prepareParentEmail({ body, requestUser })
    recipients = preparedEmail.recipients
    emailSubject = preparedEmail.emailSubject

    if (isFutureScheduledDate(scheduledAt)) {
      const scheduledRecord = await createScheduledEmail({ preparedEmail, scheduledAt })
      return successResponse({
        scheduled: true,
        queueId: scheduledRecord.id,
        scheduledAt: scheduledRecord.scheduled_at,
      })
    }

    const sendResult = await sendPreparedParentEmail(preparedEmail, {
      idempotencySeed: `${body.evaluationId || 'parent-email'}:${randomUUID()}`,
    })
    emailLogRecord = sendResult.emailLogRecord

    if (sendResult.duplicate) {
      return successResponse({ duplicate: true })
    }

    return successResponse(sendResult)
  } catch (error) {
    console.error(error)
    emailLogRecord = error.emailLogRecord || emailLogRecord
    await markEmailLogFailed(emailLogRecord, error)
    await createEmailAuditLog({
      user: null,
      action: 'email_failed',
      entityType: 'email',
      metadata: {
        to: recipients,
        subject: emailSubject,
        error: error.message,
      },
    })

    return failureResponse(error.statusCode || 500, error.statusCode ? error.message : 'Email failed - will retry automatically')
  }
}
