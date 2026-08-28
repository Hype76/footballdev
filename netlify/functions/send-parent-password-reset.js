import { createHmac } from 'node:crypto'
import process from 'node:process'
import {
  buildEmailLogoMarkup,
  resolveReachableEmailLogo,
} from '../../src/lib/email-branding.js'
import { createFromAddress, sendEmail } from './lib/_email-provider.js'
import { createServerAuditLog } from './lib/_email-log-store.js'
import { assertPlanFeature, getAuthenticatedPlanProfile } from './lib/_plan-gate.js'
import { supabaseAdmin } from './lib/_supabase.js'

const PARENT_RESET_REDIRECT = 'https://parent.footballplayer.online/reset-password'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase()
}

function escapeHtml(value) {
  return normalizeText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
    body: JSON.stringify(payload),
  }
}

export function buildParentPasswordResetEmail({
  actionLink,
  clubLogoUrl = '',
  clubName = '',
  playerName = '',
  teamName = '',
} = {}) {
  const resolvedClubName = normalizeText(clubName) || 'Your club'
  const logoMarkup = buildEmailLogoMarkup({
    altText: resolvedClubName,
    clubLogoUrl,
    origin: 'https://footballplayer.online',
  })

  return `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#101828;">
      ${logoMarkup}
      <p style="margin:0 0 8px;color:#047857;font-size:12px;font-weight:900;letter-spacing:0.16em;text-transform:uppercase;">${escapeHtml(resolvedClubName)}</p>
      <h1 style="margin:0 0 12px;font-size:26px;line-height:1.15;">Reset your Parent app password</h1>
      <p style="margin:0 0 12px;color:#4b5f55;font-size:15px;line-height:1.6;font-weight:700;">${escapeHtml(resolvedClubName)} has sent you a secure password reset link.</p>
      <div style="margin:0 0 20px;border:1px solid #d7e5dc;border-radius:10px;background:#f7faf8;padding:14px 16px;">
        <p style="margin:0 0 6px;color:#101828;font-size:14px;font-weight:900;">Player: ${escapeHtml(playerName || 'Linked player')}</p>
        <p style="margin:0;color:#4b5f55;font-size:13px;font-weight:700;">Team: ${escapeHtml(teamName || 'Your team')}</p>
      </div>
      <p style="margin:0 0 22px;">
        <a href="${escapeHtml(actionLink)}" style="display:inline-block;padding:12px 16px;background:#047857;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:900;">Reset password</a>
      </p>
      <p style="margin:20px 0 0;color:#64748b;font-size:12px;line-height:1.5;">If you were not expecting this email, you can ignore it. Your password has not been changed.</p>
    </div>
  `
}

async function loadParentLink(parentLinkId, adminClient) {
  const { data, error } = await adminClient
    .from('parent_player_links')
    .select('id, club_id, team_id, player_id, email, status, auth_user_id, players:player_id (player_name, status, archived_at), teams:team_id (name), clubs:club_id (name, contact_email, logo_url)')
    .eq('id', parentLinkId)
    .maybeSingle()

  if (error || !data) {
    throw Object.assign(new Error('The active Parent app link could not be found.'), { statusCode: 404 })
  }

  if (data.status !== 'active' || !data.auth_user_id) {
    throw Object.assign(new Error('Password reset is available after the parent has accepted Parent app access.'), { statusCode: 409 })
  }

  if (data.players?.archived_at || normalizeText(data.players?.status).toLowerCase() === 'archived') {
    throw Object.assign(new Error('Password reset is not available for an archived player.'), { statusCode: 409 })
  }

  return data
}

async function assertStaffAuthority(event, link, adminClient, profileLoader) {
  const profile = await profileLoader(event, {
    clubId: link.club_id,
    playerId: link.player_id,
    teamId: link.team_id,
  })
  assertPlanFeature(profile, 'parentInvitations')

  if (profile.role === 'super_admin' || String(profile.clubId) !== String(link.club_id)) {
    throw Object.assign(new Error('Club staff access is required to send this password reset.'), { statusCode: 403 })
  }

  if (profile.role === 'admin' || Number(profile.roleRank ?? 0) >= 50) {
    return profile
  }

  const { data: assignment, error } = await adminClient
    .from('team_staff')
    .select('team_id')
    .eq('team_id', link.team_id)
    .eq('user_id', profile.id)
    .maybeSingle()

  if (error || !assignment) {
    throw Object.assign(new Error('You need access to this team before sending a Parent password reset.'), { statusCode: 403 })
  }

  return profile
}

async function enforceRateLimit({ email, profile, adminClient }) {
  const secret = normalizeText(process.env.SUPABASE_SERVICE_ROLE_KEY)

  if (!secret) {
    throw new Error('Password reset security is not configured.')
  }

  const digest = (value, purpose) => createHmac('sha256', secret)
    .update(`${purpose}\0${normalizeText(value)}`)
    .digest('hex')
  const { data, error } = await adminClient.rpc('consume_password_recovery_rate_limit', {
    p_email_digest: digest(email, 'staff-parent-password-reset-email'),
    p_email_limit: 3,
    p_ip_digest: digest(profile.id, 'staff-parent-password-reset-actor'),
    p_ip_limit: 12,
    p_window_seconds: 900,
  })

  if (error || data?.allowed !== true) {
    throw Object.assign(new Error('This password reset was sent recently. Wait before sending another.'), { statusCode: 429 })
  }
}

export function createParentPasswordResetHandler({
  adminClient = supabaseAdmin,
  auditLogger = createServerAuditLog,
  emailSender = sendEmail,
  logoResolver = resolveReachableEmailLogo,
  profileLoader = getAuthenticatedPlanProfile,
} = {}) {
  return async function parentPasswordResetHandler(event = {}) {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { success: false, message: 'Method not allowed.' })
    }

    try {
      let body

      try {
        body = JSON.parse(event.body || '{}')
      } catch {
        return jsonResponse(400, { success: false, message: 'Choose an active Parent app link.' })
      }

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return jsonResponse(400, { success: false, message: 'Choose an active Parent app link.' })
      }

      const parentLinkId = normalizeText(body.parentLinkId)

      if (!parentLinkId || Object.keys(body).some((key) => key !== 'parentLinkId')) {
        return jsonResponse(400, { success: false, message: 'Choose an active Parent app link.' })
      }

      const link = await loadParentLink(parentLinkId, adminClient)
      const profile = await assertStaffAuthority(event, link, adminClient, profileLoader)
      const { data: authUserData, error: authUserError } = await adminClient.auth.admin.getUserById(link.auth_user_id)
      const accountEmail = normalizeEmail(authUserData?.user?.email)

      if (authUserError || !accountEmail || String(authUserData?.user?.id) !== String(link.auth_user_id)) {
        throw Object.assign(new Error('The linked Parent account could not be verified.'), { statusCode: 409 })
      }

      await enforceRateLimit({ email: accountEmail, profile, adminClient })

      const { data: recoveryData, error: recoveryError } = await adminClient.auth.admin.generateLink({
        type: 'recovery',
        email: accountEmail,
        options: { redirectTo: PARENT_RESET_REDIRECT },
      })
      const actionLink = recoveryData?.properties?.action_link

      if (recoveryError || !actionLink) {
        throw Object.assign(new Error('The secure password reset link could not be created.'), { statusCode: 500 })
      }

      const club = Array.isArray(link.clubs) ? link.clubs[0] : link.clubs
      const team = Array.isArray(link.teams) ? link.teams[0] : link.teams
      const player = Array.isArray(link.players) ? link.players[0] : link.players
      const resolvedLogo = await logoResolver({
        clubLogoUrl: club?.logo_url,
        origin: 'https://footballplayer.online',
      })
      const html = buildParentPasswordResetEmail({
        actionLink,
        clubLogoUrl: resolvedLogo.url,
        clubName: club?.name,
        playerName: player?.player_name,
        teamName: team?.name,
      })

      await emailSender({
        from: createFromAddress(`${normalizeText(club?.name) || 'Football Player'} via Football Player`),
        to: [accountEmail],
        replyTo: normalizeEmail(club?.contact_email) || undefined,
        subject: `${normalizeText(club?.name) || 'Football Player'} Parent app password reset`,
        html,
      }, {
        context: {
          actorId: profile.id,
          actorEmail: profile.email,
          clubId: link.club_id,
          teamId: link.team_id,
          emailType: 'parent_password_reset',
          targetEntityId: link.id,
          targetEntityType: 'parent_player_link',
        },
        publicMessage: 'Parent password reset email could not be sent.',
      })

      await auditLogger({
        action: 'parent_password_reset_sent',
        entityType: 'parent_player_link',
        entityId: link.id,
        metadata: {
          actorId: profile.id,
          actorEmail: profile.email,
          clubId: link.club_id,
          teamId: link.team_id,
          playerId: link.player_id,
          recipientEmail: accountEmail,
        },
      })

      return jsonResponse(200, { success: true, message: 'Parent password reset email sent.' })
    } catch (error) {
      console.error(error)
      return jsonResponse(error.statusCode || 500, {
        success: false,
        message: error.statusCode ? error.message : 'Parent password reset email could not be sent.',
      })
    }
  }
}

export const handler = createParentPasswordResetHandler()
