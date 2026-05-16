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
  getAuthenticatedPlanProfile,
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
    from: `${fromName} <feedback@playerfeedback.online>`,
    to: recipients,
    replyTo: safeReplyTo || undefined,
    subject: String(subject ?? '').trim() || 'Player Feedback',
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

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  let recipients = []
  let emailSubject = 'Player Feedback'
  let emailLogRecord = null

  try {
    const missingEnvVars = getMissingEnvVars()

    if (missingEnvVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`)
    }

    const body = JSON.parse(event.body || '{}')
    const planProfile = await getAuthenticatedPlanProfile(event)
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
      evaluationId,
      playerName,
      parentName,
      senderEmail,
      attachPdf,
    } = body

    const normalizedSenderEmail = normaliseEmail(senderEmail)

    if (normalizedSenderEmail && normalizedSenderEmail !== planProfile.email && normalizedSenderEmail !== planProfile.authEmail) {
      return failureResponse(403, 'Email can only be sent from your logged-in account.')
    }

    if (planProfile.authEmail === DEMO_EMAIL || planProfile.email === DEMO_EMAIL) {
      return failureResponse(403, 'Email sending is disabled for the demo account')
    }

    recipients = normaliseRecipients(parentEmail)

    if (recipients.length === 0) {
      return failureResponse(400, 'Parent email is required')
    }

    if (!recipients.every(isValidEmail)) {
      return failureResponse(400, 'Parent email must be a valid email address')
    }

    if (recipients.length > 5) {
      return failureResponse(400, 'Too many emails in one request')
    }

    if (replyToEmail && !isValidEmail(replyToEmail)) {
      return failureResponse(400, 'Reply-to email must be a valid email address')
    }

    const resend = new Resend(process.env.RESEND_API_KEY)
    const senderReplyTo = isValidEmail(normalizedSenderEmail) ? normalizedSenderEmail : ''
    const safeDisplayName = cleanHeaderPart(displayName, 'Coach')
    const safeTeamName = cleanHeaderPart(teamName, 'Team')
    const safeClubName = cleanHeaderPart(clubName, 'Club')
    const fromName = `${safeDisplayName} (${safeTeamName} - ${safeClubName})`
    const safeReplyTo = cleanHeaderPart(senderReplyTo || replyToEmail || clubContactEmail || clubEmail, '')
    const senderCopyEmails = getSenderCopyEmails(senderEmail, recipients)
    const emailHtml = buildEmailHtml(html)

    if (emailHtml.length > 200000) {
      return failureResponse(400, 'Email content is too large')
    }

    const shouldAttachPdf = attachPdf === true
    if (shouldAttachPdf) {
      assertPlanFeature(planProfile, 'pdfExport')
    }

    const attachmentHtml = buildEmailHtml(pdfHtml || emailHtml)
    const attachments = shouldAttachPdf ? await buildPdfAttachment(attachmentHtml) : []
    emailSubject = String(subject ?? '').trim() || 'Player Feedback'
    const emailPayload = buildEmailPayload({
      fromName,
      recipients,
      safeReplyTo,
      senderCopyEmails,
      subject: emailSubject,
      emailHtml,
      attachments,
    })
    const dedupeKey = createEmailDedupeKey(emailPayload)
    const recipientDedupeKeys = createEmailRecipientDedupeKeys({
      payload: emailPayload,
      recipients,
    })
    const finalIdempotencyKey = createEmailIdempotencyKey({
      payload: emailPayload,
      idempotencySeed: `${evaluationId || 'parent-email'}:${randomUUID()}`,
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
      actorId: planProfile.id,
      actorEmail: planProfile.email,
      requiredFeature: 'parentEmail',
    }
    const pendingLogResult = await createPendingEmailLog({
      recipients,
      subject: emailSubject,
      payload: storedPayload,
      dedupeKey,
      recipientDedupeKeys,
      idempotencyKey: finalIdempotencyKey,
    })

    emailLogRecord = pendingLogResult.record

    if (pendingLogResult.blocked) {
      return failureResponse(429, 'This email has already been sent 3 times in 5 minutes. Wait before sending again.')
    }

    if (pendingLogResult.skipped) {
      return successResponse({ duplicate: true })
    }

    let response
    let sentPayload = emailPayload

    try {
      response = await resend.emails.send(emailPayload)
    } catch (sendWithPdfError) {
      if (attachments.length === 0) {
        throw sendWithPdfError
      }

      console.error('Email send with PDF failed, retrying without attachment', sendWithPdfError)
      sentPayload = removeAttachments(emailPayload)
      response = await resend.emails.send(sentPayload)
    }

    await markEmailLogSent(emailLogRecord, response, { recipientDedupeKeys })
    await createEmailAuditLog({
      user: null,
      action: 'email_sent',
      entityType: 'email',
      metadata: {
        to: recipients,
        cc: senderCopyEmails,
        subject: emailSubject,
        clubId: planProfile.clubId,
        actorId: planProfile.id,
        actorEmail: planProfile.email,
        hasAttachment: Boolean(sentPayload.attachments?.length),
        playerName: String(playerName ?? '').trim(),
        teamName: safeTeamName,
        clubName: safeClubName,
      },
    })

    return successResponse({
      id: response?.data?.id || response?.id || '',
      hasAttachment: Boolean(sentPayload.attachments?.length),
      htmlSize: emailHtml.length,
    })
  } catch (error) {
    console.error(error)
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
