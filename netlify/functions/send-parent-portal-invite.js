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

function getSenderCopyEmails(senderEmail, recipient) {
  const senderCopyEmail = normaliseEmail(senderEmail)
  const normalisedRecipient = normaliseEmail(recipient)

  if (!senderCopyEmail || !isValidEmail(senderCopyEmail) || senderCopyEmail === normalisedRecipient) {
    return []
  }

  return [senderCopyEmail]
}

function buildEmailPayload({
  fromName,
  recipient,
  safeReplyTo,
  senderCopyEmails,
  subject,
  emailHtml,
}) {
  const emailPayload = {
    from: createFromAddress(fromName),
    to: [recipient],
    replyTo: safeReplyTo || undefined,
    subject: String(subject ?? '').trim() || 'Family portal invite',
    html: String(emailHtml ?? '').trim() || '<p>You have been invited to the family portal.</p>',
  }

  if (senderCopyEmails.length > 0) {
    emailPayload.cc = senderCopyEmails
  }

  return emailPayload
}

async function getInviteLink(linkId) {
  const normalizedLinkId = String(linkId ?? '').trim()

  if (!normalizedLinkId) {
    throw Object.assign(new Error('Family portal invite details are required.'), { statusCode: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('parent_player_links')
    .select('id, club_id, team_id, player_id, email, status, link_type, players:player_id (player_name, section), teams:team_id (name), clubs:club_id (name, contact_email)')
    .eq('id', normalizedLinkId)
    .maybeSingle()

  if (error || !data) {
    throw Object.assign(new Error('Family portal invite could not be found.'), { statusCode: 404 })
  }

  if (data.status === 'revoked') {
    throw Object.assign(new Error('This family portal invite is no longer available.'), { statusCode: 403 })
  }

  if (String(data.players?.section ?? '').trim().toLowerCase() !== 'squad') {
    throw Object.assign(new Error('Family portal invites can only be sent for squad players.'), { statusCode: 403 })
  }

  return data
}

async function assertCanSendInvite({ event, inviteLink }) {
  const planProfile = await getAuthenticatedPlanProfile(event, {
    clubId: inviteLink.club_id,
    teamId: inviteLink.team_id,
    playerId: inviteLink.player_id,
  })

  assertPlanFeature(planProfile, 'parentInvitations')

  if (planProfile.role === 'super_admin') {
    return planProfile
  }

  if (String(planProfile.clubId) !== String(inviteLink.club_id)) {
    throw Object.assign(new Error('This parent invite belongs to a different club.'), { statusCode: 403 })
  }

  if (Number(planProfile.roleRank ?? 0) >= 50) {
    return planProfile
  }

  const { data: teamStaff, error } = await supabaseAdmin
    .from('team_staff')
    .select('team_id')
    .eq('team_id', inviteLink.team_id)
    .eq('user_id', planProfile.id)
    .maybeSingle()

  if (error || !teamStaff) {
    throw Object.assign(new Error('You need access to this team before sending family portal invites.'), { statusCode: 403 })
  }

  return planProfile
}

async function createEmailAuditLog(payload) {
  try {
    await createServerAuditLog(payload)
  } catch (error) {
    console.error('Family portal invite audit logging failed', error)
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  let recipient = ''
  let emailSubject = 'Family portal invite'
  let emailLogRecord = null

  try {
    const missingEnvVars = getMissingEnvVars()

    if (missingEnvVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`)
    }

    const body = JSON.parse(event.body || '{}')
    const requestUser = await getAuthenticatedRequestUser(event)
    const inviteLink = await getInviteLink(body.inviteLinkId)
    const planProfile = await assertCanSendInvite({ event, inviteLink })

    const {
      displayName,
      html,
      parentEmail,
      copySender = false,
      senderEmail,
      subject,
    } = body

    const normalizedSenderEmail = normaliseEmail(senderEmail)

    if (normalizedSenderEmail && normalizedSenderEmail !== requestUser.email) {
      return failureResponse(403, 'Email can only be sent from your logged-in account.')
    }

    if (requestUser.email === DEMO_EMAIL) {
      return failureResponse(403, 'Family portal invites are disabled for the demo account.')
    }

    recipient = normaliseEmail(parentEmail || inviteLink.email)

    if (!recipient) {
      return failureResponse(400, 'Parent email is required.')
    }

    if (!isValidEmail(recipient)) {
      return failureResponse(400, 'Parent email must be a valid email address.')
    }

    const inviteEmail = normaliseEmail(inviteLink.email)
    if (inviteEmail && inviteEmail !== recipient) {
      return failureResponse(403, 'This invite can only be sent to the linked parent email.')
    }

    const teamName = cleanHeaderPart(body.teamName || inviteLink.teams?.name, 'Team')
    const clubName = cleanHeaderPart(body.clubName || inviteLink.clubs?.name, 'Club')
    const safeDisplayName = cleanHeaderPart(displayName || planProfile.name, 'Coach')
    const fromName = `${safeDisplayName} (${teamName} - ${clubName})`
    const safeReplyTo = cleanHeaderPart(normalizedSenderEmail || planProfile.email || inviteLink.clubs?.contact_email, '')
    const senderCopyEmails = copySender === true ? getSenderCopyEmails(senderEmail, recipient) : []
    const emailHtml = String(html ?? '').trim()

    if (emailHtml.length > 200000) {
      return failureResponse(400, 'Email content is too large.')
    }

    emailSubject = String(subject ?? '').trim() || 'Family portal invite'
    const emailPayload = buildEmailPayload({
      fromName,
      recipient,
      safeReplyTo,
      senderCopyEmails,
      subject: emailSubject,
      emailHtml,
    })
    const dedupeKey = createEmailDedupeKey(emailPayload)
    const recipientDedupeKeys = createEmailRecipientDedupeKeys({
      payload: emailPayload,
      recipients: [recipient],
    })
    const finalIdempotencyKey = createEmailIdempotencyKey({
      payload: emailPayload,
      idempotencySeed: `parent-portal:${inviteLink.id}:${randomUUID()}`,
    })
    const pendingLogResult = await createPendingEmailLog({
      recipients: [recipient],
      subject: emailSubject,
      payload: {
        resendPayload: emailPayload,
        displayName: safeDisplayName,
        teamName,
        clubName,
        playerName: String(body.playerName ?? inviteLink.players?.player_name ?? '').trim(),
        clubId: inviteLink.club_id,
        actorId: planProfile.id,
        actorEmail: requestUser.email,
        requiredFeature: 'parentPortal',
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
        emailType: 'parent_portal_invite',
        userRole: planProfile.role,
        actorId: planProfile.id,
        actorEmail: requestUser.email,
        clubId: inviteLink.club_id,
        teamId: inviteLink.team_id,
        targetEntityType: 'parent_player_link',
        targetEntityId: inviteLink.id,
      },
      publicMessage: 'Family portal invite could not be sent. Please try again in a moment.',
    })
    await markEmailLogSent(emailLogRecord, response, { recipientDedupeKeys })
    const { error: inviteSentUpdateError } = await supabaseAdmin
      .from('parent_player_links')
      .update({
        invite_sent_at: new Date().toISOString(),
      })
      .eq('id', inviteLink.id)

    if (inviteSentUpdateError) {
      console.error('Family portal invite sent timestamp update failed', inviteSentUpdateError)
    }

    await createEmailAuditLog({
      user: null,
      action: 'parent_portal_invite_sent',
      entityType: 'parent_player_link',
      metadata: {
        to: [recipient],
        cc: senderCopyEmails,
        subject: emailSubject,
        clubId: inviteLink.club_id,
        teamId: inviteLink.team_id,
        playerId: inviteLink.player_id,
        linkId: inviteLink.id,
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
      action: 'parent_portal_invite_failed',
      entityType: 'parent_player_link',
      metadata: {
        to: recipient ? [recipient] : [],
        subject: emailSubject,
        error: error.message,
      },
    })

    const publicMessage = error.publicMessage
      ? getPublicEmailErrorMessage(error, 'Family portal invite could not be sent. Please try again in a moment.')
      : error.statusCode ? error.message : 'Family portal invite could not be sent.'
    return failureResponse(error.statusCode || 500, publicMessage)
  }
}
