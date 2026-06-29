import process from 'node:process'
import { randomUUID } from 'node:crypto'
import { createFromAddress, getPublicEmailErrorMessage, sendEmail } from './lib/_email-provider.js'
import {
  createEmailDedupeKey,
  createEmailIdempotencyKey,
  createEmailRecipientDedupeKeys,
  createPendingEmailLog,
  createServerAuditLog,
  markEmailLogFailed,
  markEmailLogSent,
} from './lib/_email-log-store.js'
import { supabaseAdmin } from './lib/_supabase.js'
import {
  assertPlanFeature,
  getAuthenticatedPlanProfile,
  getAuthenticatedRequestUser,
} from './lib/_plan-gate.js'

const DEMO_EMAIL = 'demo@playerfeedback.online'

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

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

function isValidEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(value ?? '').trim())
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

function getSenderCopyEmails(senderEmail, recipient) {
  const senderCopyEmail = normalizeEmail(senderEmail)
  const normalizedRecipient = normalizeEmail(recipient)

  if (!senderCopyEmail || !isValidEmail(senderCopyEmail) || senderCopyEmail === normalizedRecipient) {
    return []
  }

  return [senderCopyEmail]
}

function getMissingEnvVars() {
  return ['RESEND_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL'].filter(
    (envName) => !process.env[envName],
  )
}

async function getInvite(inviteId) {
  const normalizedInviteId = String(inviteId ?? '').trim()

  if (!normalizedInviteId) {
    throw Object.assign(new Error('Staff invite details are required.'), { statusCode: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('club_user_invites')
    .select('id, club_id, email, role_label, role_rank, team_id, invite_token, expires_at, accepted_at, teams:team_id (name), clubs:club_id (name, contact_email, logo_url)')
    .eq('id', normalizedInviteId)
    .maybeSingle()

  if (error || !data) {
    throw Object.assign(new Error('Staff invite could not be found.'), { statusCode: 404 })
  }

  if (data.accepted_at) {
    throw Object.assign(new Error('This staff invite has already been accepted.'), { statusCode: 409 })
  }

  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    throw Object.assign(new Error('This staff invite has expired. Create a new staff invite.'), { statusCode: 410 })
  }

  return data
}

async function assertCanSendInvite({ event, invite }) {
  const planProfile = await getAuthenticatedPlanProfile(event, {
    clubId: invite.club_id,
    teamId: invite.team_id,
  })

  assertPlanFeature(planProfile, invite.team_id ? 'teamStaffRoles' : 'clubStaffRoles')

  if (planProfile.role === 'super_admin') {
    return planProfile
  }

  if (String(planProfile.clubId) !== String(invite.club_id)) {
    throw Object.assign(new Error('This staff invite belongs to a different club.'), { statusCode: 403 })
  }

  if (Number(planProfile.roleRank ?? 0) < 50) {
    throw Object.assign(new Error('You need manager access before sending staff invites.'), { statusCode: 403 })
  }

  if (Number(invite.role_rank ?? 0) > Number(planProfile.roleRank ?? 0)) {
    throw Object.assign(new Error('You cannot invite a role above your own level.'), { statusCode: 403 })
  }

  return planProfile
}

async function createEmailAuditLog(payload) {
  try {
    await createServerAuditLog(payload)
  } catch (error) {
    console.error('Staff invite audit logging failed', error)
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  let recipient = ''
  let emailSubject = 'Staff invite'
  let emailLogRecord = null

  try {
    const missingEnvVars = getMissingEnvVars()

    if (missingEnvVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`)
    }

    const body = JSON.parse(event.body || '{}')
    const requestUser = await getAuthenticatedRequestUser(event)
    const invite = await getInvite(body.inviteId)
    const planProfile = await assertCanSendInvite({ event, invite })
    const normalizedSenderEmail = normalizeEmail(body.senderEmail)

    if (normalizedSenderEmail && normalizedSenderEmail !== requestUser.email) {
      return failureResponse(403, 'Email can only be sent from your logged-in account.')
    }

    if (requestUser.email === DEMO_EMAIL) {
      return failureResponse(403, 'Staff invites are disabled for the demo account.')
    }

    recipient = normalizeEmail(invite.email)

    if (!isValidEmail(recipient)) {
      return failureResponse(400, 'Staff email must be a valid email address.')
    }

    const club = Array.isArray(invite.clubs) ? invite.clubs[0] : invite.clubs
    const team = Array.isArray(invite.teams) ? invite.teams[0] : invite.teams
    const clubName = cleanHeaderPart(club?.name, 'Football Player')
    const teamName = cleanHeaderPart(team?.name, 'Team')
    const safeDisplayName = cleanHeaderPart(body.displayName || planProfile.name, 'Club admin')
    const fromName = `${safeDisplayName} (${clubName})`
    const safeReplyTo = cleanHeaderPart(normalizedSenderEmail || planProfile.email || club?.contact_email, '')
    const senderCopyEmails = getSenderCopyEmails(normalizedSenderEmail, recipient)
    const emailHtml = String(body.html ?? '').trim()

    if (!emailHtml) {
      return failureResponse(400, 'Staff invite email content is required.')
    }

    if (emailHtml.length > 200000) {
      return failureResponse(400, 'Email content is too large.')
    }

    emailSubject = String(body.subject ?? '').trim() || `${clubName} staff invite`
    const emailPayload = {
      from: createFromAddress(fromName),
      to: [recipient],
      replyTo: safeReplyTo || undefined,
      subject: emailSubject,
      html: emailHtml,
    }

    if (senderCopyEmails.length > 0) {
      emailPayload.cc = senderCopyEmails
    }

    const dedupeKey = createEmailDedupeKey(emailPayload)
    const recipientDedupeKeys = createEmailRecipientDedupeKeys({
      payload: emailPayload,
      recipients: [recipient],
    })
    const finalIdempotencyKey = createEmailIdempotencyKey({
      payload: emailPayload,
      idempotencySeed: `staff-invite:${invite.id}:${randomUUID()}`,
    })
    const pendingLogResult = await createPendingEmailLog({
      recipients: [recipient],
      subject: emailSubject,
      payload: {
        resendPayload: emailPayload,
        displayName: safeDisplayName,
        teamName,
        clubName,
        clubId: invite.club_id,
        actorId: planProfile.id,
        actorEmail: requestUser.email,
        requiredFeature: 'staffInvite',
      },
      dedupeKey,
      recipientDedupeKeys,
      idempotencyKey: finalIdempotencyKey,
    })

    emailLogRecord = pendingLogResult.record

    if (pendingLogResult.blocked) {
      return failureResponse(429, 'This invite has already been sent 3 times in 5 minutes. Wait before sending again.')
    }

    if (pendingLogResult.skipped) {
      return successResponse({ duplicate: true })
    }

    const response = await sendEmail(emailPayload, {
      context: {
        emailType: 'staff_invite',
        userRole: planProfile.role,
        actorId: planProfile.id,
        actorEmail: requestUser.email,
        clubId: invite.club_id,
        teamId: invite.team_id,
        targetEntityType: 'club_user_invite',
        targetEntityId: invite.id,
      },
      publicMessage: 'Staff invite could not be sent. Please try again in a moment.',
    })
    await markEmailLogSent(emailLogRecord, response, { recipientDedupeKeys })

    await supabaseAdmin
      .from('club_user_invites')
      .update({ invite_sent_at: new Date().toISOString() })
      .eq('id', invite.id)

    await createEmailAuditLog({
      user: null,
      action: 'staff_invite_sent',
      entityType: 'club_user_invite',
      metadata: {
        to: [recipient],
        cc: senderCopyEmails,
        subject: emailSubject,
        clubId: invite.club_id,
        teamId: invite.team_id,
        inviteId: invite.id,
        actorId: planProfile.id,
        actorEmail: requestUser.email,
      },
    })

    return successResponse({
      id: response?.data?.id || response?.id || '',
      htmlSize: emailHtml.length,
    })
  } catch (error) {
    console.error(error)
    await markEmailLogFailed(emailLogRecord, error)
    await createEmailAuditLog({
      user: null,
      action: 'staff_invite_failed',
      entityType: 'club_user_invite',
      metadata: {
        to: recipient ? [recipient] : [],
        subject: emailSubject,
        error: error.message,
      },
    })

    const publicMessage = error.publicMessage
      ? getPublicEmailErrorMessage(error, 'Staff invite could not be sent. Please try again in a moment.')
      : error.statusCode ? error.message : 'Staff invite could not be sent.'
    return failureResponse(error.statusCode || 500, publicMessage)
  }
}
