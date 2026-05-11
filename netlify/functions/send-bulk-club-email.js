import process from 'node:process'
import { Resend } from 'resend'
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

const MAX_BULK_RECIPIENTS = 200
const MAX_CC_RECIPIENTS = 10
const DEMO_EMAIL = 'demo@playerfeedback.online'

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
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

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

function normalizeEmailList(value) {
  const values = Array.isArray(value) ? value : String(value ?? '').split(',')
  return [...new Set(values.map(normalizeEmail).filter(Boolean))]
}

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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function buildMessageHtml(message) {
  const paragraphs = String(message ?? '')
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  if (paragraphs.length === 0) {
    return '<p>No message entered.</p>'
  }

  return paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

async function getAuthenticatedClubAdmin(event) {
  const token = getBearerToken(event)

  if (!token) {
    throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)

  if (authError || !authData?.user) {
    throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
  }

  const authUser = authData.user
  const email = normalizeEmail(authUser.email)
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('id, auth_user_id, email, name, role, role_label, role_rank, club_id, reply_to_email, clubs:club_id (name, contact_email)')
    .or(`auth_user_id.eq.${authUser.id},email.eq.${email}`)
    .maybeSingle()

  if (profileError || !profile) {
    throw Object.assign(new Error('User profile could not be loaded.'), { statusCode: 403 })
  }

  if (profile.role !== 'admin' || !profile.club_id) {
    throw Object.assign(new Error('Bulk email is only available to Club Admin users.'), { statusCode: 403 })
  }

  return {
    ...profile,
    authEmail: email,
  }
}

function addAllowedContactEmails(allowedEmails, contacts, audience, fallbackEmail = '', fallbackType = 'parent') {
  const normalizedContacts = Array.isArray(contacts) ? contacts : []

  normalizedContacts.forEach((contact) => {
    const email = normalizeEmail(contact?.email ?? contact?.parentEmail)
    const type = String(contact?.type ?? contact?.contactType ?? '').trim().toLowerCase() === 'self' ? 'self' : 'parent'

    if (email && type === audience) {
      allowedEmails.add(email)
    }
  })

  const fallback = normalizeEmail(fallbackEmail)

  if (fallback && fallbackType === audience && normalizedContacts.length === 0) {
    allowedEmails.add(fallback)
  }
}

async function getAllowedRecipientEmails(profile, audience) {
  const { data, error } = await supabaseAdmin
    .from('players')
    .select('parent_email, parent_contacts, contact_type, status')
    .eq('club_id', profile.club_id)
    .neq('status', 'archived')

  if (error) {
    throw error
  }

  const allowedEmails = new Set()

  ;(data ?? []).forEach((player) => {
    const fallbackType = String(player.contact_type ?? '').trim().toLowerCase() === 'self' ? 'self' : 'parent'
    addAllowedContactEmails(allowedEmails, player.parent_contacts, audience, player.parent_email, fallbackType)
  })

  return allowedEmails
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  let emailLogRecord = null
  let selectedRecipients = []
  let subject = 'Club Update'

  try {
    const missingEnvVars = getMissingEnvVars()

    if (missingEnvVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`)
    }

    const profile = await getAuthenticatedClubAdmin(event)

    if (profile.authEmail === DEMO_EMAIL || normalizeEmail(profile.email) === DEMO_EMAIL) {
      return failureResponse(403, 'Email sending is disabled for the demo account')
    }

    const body = JSON.parse(event.body || '{}')
    const audience = String(body.audience ?? '').trim().toLowerCase()

    if (!['parent', 'self'].includes(audience)) {
      return failureResponse(400, 'Choose parent or player recipients.')
    }

    selectedRecipients = normalizeEmailList(body.recipients)
    const ccRecipients = normalizeEmailList(body.cc)
    subject = String(body.subject ?? '').trim()
    const message = String(body.message ?? '').trim()

    if (selectedRecipients.length === 0) {
      return failureResponse(400, 'Select at least one recipient.')
    }

    if (selectedRecipients.length > MAX_BULK_RECIPIENTS) {
      return failureResponse(400, `Bulk emails are limited to ${MAX_BULK_RECIPIENTS} recipients.`)
    }

    if (!selectedRecipients.every(isValidEmail)) {
      return failureResponse(400, 'Every selected recipient must be a valid email address.')
    }

    if (ccRecipients.length > MAX_CC_RECIPIENTS || !ccRecipients.every(isValidEmail)) {
      return failureResponse(400, 'CC can include up to 10 valid email addresses.')
    }

    if (!subject) {
      return failureResponse(400, 'Subject is required.')
    }

    if (!message) {
      return failureResponse(400, 'Message is required.')
    }

    if (message.length > 20000) {
      return failureResponse(400, 'Message is too large.')
    }

    const allowedEmails = await getAllowedRecipientEmails(profile, audience)
    const unauthorizedRecipients = selectedRecipients.filter((email) => !allowedEmails.has(email))

    if (unauthorizedRecipients.length > 0) {
      return failureResponse(403, 'One or more selected recipients are not available for this club.')
    }

    const senderEmail = normalizeEmail(profile.email || profile.authEmail)
    const replyTo = senderEmail || normalizeEmail(profile.authEmail)

    if (!isValidEmail(replyTo)) {
      return failureResponse(400, 'Your account email must be valid before sending bulk email.')
    }

    const safeSenderName = cleanHeaderPart(profile.name || senderEmail, 'Club Admin')
    const safeClubName = cleanHeaderPart(profile.clubs?.name, 'Club')
    const emailHtml = [
      '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#111827">',
      buildMessageHtml(message),
      '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">',
      `<p style="color:#4b5563">Sent by ${escapeHtml(safeSenderName)} for ${escapeHtml(safeClubName)}.</p>`,
      '</div>',
    ].join('')
    const emailPayload = {
      from: `${safeClubName} <feedback@playerfeedback.online>`,
      to: [replyTo],
      bcc: selectedRecipients,
      cc: ccRecipients.length > 0 ? ccRecipients : undefined,
      replyTo,
      subject,
      html: emailHtml,
    }
    const dedupeKey = createEmailDedupeKey(emailPayload)
    const recipientDedupeKeys = createEmailRecipientDedupeKeys({
      payload: emailPayload,
      recipients: selectedRecipients,
    })
    const idempotencyKey = createEmailIdempotencyKey({
      payload: emailPayload,
      idempotencySeed: `${profile.id}:${Date.now()}`,
    })
    const pendingLogResult = await createPendingEmailLog({
      recipients: selectedRecipients,
      subject,
      payload: {
        resendPayload: emailPayload,
        senderName: safeSenderName,
        clubName: safeClubName,
        audience,
      },
      dedupeKey,
      recipientDedupeKeys,
      idempotencyKey,
    })

    emailLogRecord = pendingLogResult.record

    if (pendingLogResult.blocked) {
      return failureResponse(429, 'This email has already been sent 3 times in 5 minutes. Wait before sending again.')
    }

    const resend = new Resend(process.env.RESEND_API_KEY)
    const response = await resend.emails.send(emailPayload)

    await markEmailLogSent(emailLogRecord, response, { recipientDedupeKeys })
    await createServerAuditLog({
      action: 'bulk_email_sent',
      entityType: 'email',
      metadata: {
        clubId: profile.club_id,
        actorId: profile.id,
        actorEmail: senderEmail,
        audience,
        recipientCount: selectedRecipients.length,
        cc: ccRecipients,
        subject,
      },
    })

    return successResponse({
      id: response?.data?.id || response?.id || '',
      recipientCount: selectedRecipients.length,
    })
  } catch (error) {
    console.error(error)
    await markEmailLogFailed(emailLogRecord, error)
    await createServerAuditLog({
      action: 'bulk_email_failed',
      entityType: 'email',
      metadata: {
        to: selectedRecipients,
        subject,
        error: error.message,
      },
    })

    return failureResponse(error.statusCode || 500, error.statusCode ? error.message : 'Bulk email failed.')
  }
}
