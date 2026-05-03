import process from 'node:process'
import { Resend } from 'resend'
import { createAuditLog } from '../../src/lib/domain/audit.js'
import { buildPdfBuffer } from '../../src/lib/pdf-builder.js'
import {
  createEmailDedupeKey,
  createPendingEmailLog,
  markEmailLogFailed,
  markEmailLogSent,
} from './_email-log-store.js'

function cleanHeaderPart(value, fallback) {
  const cleanedValue = String(value ?? '')
    .replace(/[<>\r\n"]/g, '')
    .trim()

  return cleanedValue || fallback
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

function buildEmailHtml(html) {
  return String(html ?? '').trim() || '<p>No content</p>'
}

function buildEmailPayload({
  fromName,
  recipients,
  safeReplyTo,
  subject,
  emailHtml,
  attachments,
}) {
  const emailPayload = {
    from: `${fromName} <feedback@playerfeedback.online>`,
    to: recipients,
    reply_to: safeReplyTo || undefined,
    subject: String(subject ?? '').trim() || 'Player Feedback',
    html: emailHtml,
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

async function buildPdfAttachment(emailHtml) {
  try {
    const pdfBuffer = await withTimeout(
      buildPdfBuffer(emailHtml),
      10000,
      'PDF generation timed out',
    )

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

async function createEmailAuditLog(payload) {
  try {
    await createAuditLog(payload)
  } catch (error) {
    console.error('Email audit logging failed', error)
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  let recipients = []
  let emailSubject = 'Player Feedback'
  let emailLogRecord = null

  try {
    const body = JSON.parse(event.body || '{}')

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
    } = body

    recipients = normaliseRecipients(parentEmail)

    if (recipients.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing parentEmail' }) }
    }

    if (!process.env.RESEND_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Email service is not configured' }) }
    }

    const resend = new Resend(process.env.RESEND_API_KEY)
    const safeDisplayName = cleanHeaderPart(displayName, 'Coach')
    const safeTeamName = cleanHeaderPart(teamName, 'Team')
    const safeClubName = cleanHeaderPart(clubName, 'Club')
    const fromName = `${safeDisplayName} (${safeTeamName} - ${safeClubName})`
    const safeReplyTo = cleanHeaderPart(replyToEmail || clubContactEmail || clubEmail, '')
    const emailHtml = buildEmailHtml(html)
    const attachments = await buildPdfAttachment(emailHtml)
    emailSubject = String(subject ?? '').trim() || 'Player Feedback'
    const emailPayload = buildEmailPayload({
      fromName,
      recipients,
      safeReplyTo,
      subject: emailSubject,
      emailHtml,
      attachments,
    })
    const dedupeKey = createEmailDedupeKey(emailPayload)
    const pendingLogResult = await createPendingEmailLog({
      recipients,
      subject: emailSubject,
      payload: emailPayload,
      dedupeKey,
    })

    emailLogRecord = pendingLogResult.record

    if (pendingLogResult.skipped) {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, duplicate: true }),
      }
    }

    const response = await resend.emails.send(emailPayload)
    await markEmailLogSent(emailLogRecord, response)
    await createEmailAuditLog({
      user: null,
      action: 'email_sent',
      entityType: 'email',
      metadata: {
        to: recipients,
        subject: emailSubject,
        hasAttachment: attachments.length > 0,
      },
    })

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, data: response }),
    }
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

    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    }
  }
}
