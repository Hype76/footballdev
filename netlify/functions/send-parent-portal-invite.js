import process from 'node:process'
import { randomUUID } from 'node:crypto'
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
import {
  getAuthenticatedPlanProfile,
  getAuthenticatedRequestUser,
} from './_plan-gate.js'

const DEMO_EMAIL = 'demo@footballplayer.online'

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
    from: `${fromName} <feedback@footballplayer.online>`,
    to: [recipient],
    replyTo: safeReplyTo || undefined,
    subject: String(subject ?? '').trim() || 'Parent Portal Invite',
    html: String(emailHtml ?? '').trim() || '<p>You have been invited to the parent portal.</p>',
  }

  if (senderCopyEmails.length > 0) {
    emailPayload.cc = senderCopyEmails
  }

  return emailPayload
}

async function getInviteLink(linkId) {
  const normalizedLinkId = String(linkId ?? '').trim()

  if (!normalizedLinkId) {
    throw Object.assign(new Error('Parent portal invite details are required.'), { statusCode: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('parent_player_links')
    .select('id, club_id, team_id, player_id, email, status, link_type, players:player_id (player_name, section), teams:team_id (name), clubs:club_id (name, contact_email)')
    .eq('id', normalizedLinkId)
    .maybeSingle()

  if (error || !data) {
    throw Object.assign(new Error('Parent portal invite could not be found.'), { statusCode: 404 })
  }

  if (data.status === 'revoked') {
    throw Object.assign(new Error('This parent portal invite is no longer available.'), { statusCode: 403 })
  }

  if (String(data.players?.section ?? '').trim().toLowerCase() !== 'squad') {
    throw Object.assign(new Error('Parent portal invites can only be sent for squad players.'), { statusCode: 403 })
  }

  return data
}

async function assertCanSendInvite({ event, inviteLink }) {
  const planProfile = await getAuthenticatedPlanProfile(event, {
    clubId: inviteLink.club_id,
  })

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
    throw Object.assign(new Error('You need access to this team before sending parent portal invites.'), { statusCode: 403 })
  }

  return planProfile
}

async function createEmailAuditLog(payload) {
  try {
    await createServerAuditLog(payload)
  } catch (error) {
    console.error('Parent portal invite audit logging failed', error)
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  let recipient = ''
  let emailSubject = 'Parent Portal Invite'
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
      senderEmail,
      subject,
    } = body

    const normalizedSenderEmail = normaliseEmail(senderEmail)

    if (normalizedSenderEmail && normalizedSenderEmail !== requestUser.email) {
      return failureResponse(403, 'Email can only be sent from your logged-in account.')
    }

    if (requestUser.email === DEMO_EMAIL) {
      return failureResponse(403, 'Parent portal invites are disabled for the demo account.')
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

    const resend = new Resend(process.env.RESEND_API_KEY)
    const teamName = cleanHeaderPart(body.teamName || inviteLink.teams?.name, 'Team')
    const clubName = cleanHeaderPart(body.clubName || inviteLink.clubs?.name, 'Club')
    const safeDisplayName = cleanHeaderPart(displayName || planProfile.name, 'Coach')
    const fromName = `${safeDisplayName} (${teamName} - ${clubName})`
    const safeReplyTo = cleanHeaderPart(normalizedSenderEmail || planProfile.email || inviteLink.clubs?.contact_email, '')
    const senderCopyEmails = getSenderCopyEmails(senderEmail, recipient)
    const emailHtml = String(html ?? '').trim()

    if (emailHtml.length > 200000) {
      return failureResponse(400, 'Email content is too large.')
    }

    emailSubject = String(subject ?? '').trim() || 'Parent Portal Invite'
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

    const response = await resend.emails.send(emailPayload)
    await markEmailLogSent(emailLogRecord, response, { recipientDedupeKeys })
    const { error: inviteSentUpdateError } = await supabaseAdmin
      .from('parent_player_links')
      .update({
        invite_sent_at: new Date().toISOString(),
      })
      .eq('id', inviteLink.id)

    if (inviteSentUpdateError) {
      console.error('Parent portal invite sent timestamp update failed', inviteSentUpdateError)
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

    return failureResponse(error.statusCode || 500, error.statusCode ? error.message : 'Parent portal invite could not be sent.')
  }
}
