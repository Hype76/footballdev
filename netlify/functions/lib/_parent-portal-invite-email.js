import {
  buildAuthoritativeParentInviteEmail,
  PARENT_PORTAL_EMAIL_ORIGIN,
} from '../../../src/lib/parent-invite-email.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase()
}

function isCurrentTimestamp(value) {
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) && timestamp > Date.now()
}

async function loadMaybeSingle(query, label) {
  const { data, error } = await query.maybeSingle()

  if (error) {
    throw Object.assign(new Error(`${label} could not be verified.`), {
      code: 'parent_portal_invite_context_failed',
      cause: error,
    })
  }

  return data
}

export function isParentPortalInviteQueueRow(row) {
  return row?.payload?.parentPortalInvite?.type === 'coach_mobile_new_player'
}

export async function loadAuthoritativeParentPortalInviteContext(
  supabaseClient,
  row,
) {
  const queueClubId = normalizeText(row?.club_id)
  const queueTeamId = normalizeText(row?.team_id)
  const queuePlayerId = normalizeText(row?.payload?.parentPortalInvite?.playerId)
  const queueLinkId = normalizeText(row?.payload?.parentPortalInvite?.linkId)
  const queueActorId = normalizeText(row?.created_by)
  const queueRecipient = normalizeEmail(row?.to_email)

  if (!queueClubId || !queueTeamId || !queuePlayerId || !queueLinkId || !queueActorId || !queueRecipient) {
    return { reason: 'parent_invite_queue_scope_missing', sendable: false }
  }

  const [inviteLink, player, membership, team, club, actor] = await Promise.all([
    loadMaybeSingle(
      supabaseClient
        .from('parent_player_links')
        .select('id, club_id, team_id, player_id, link_type, email, auth_user_id, invite_token, status, expires_at, invite_sent_at, invited_by')
        .eq('id', queueLinkId)
        .eq('club_id', queueClubId)
        .eq('team_id', queueTeamId)
        .eq('player_id', queuePlayerId),
      'Parent Portal invite',
    ),
    loadMaybeSingle(
      supabaseClient
        .from('players')
        .select('id, club_id, player_name, section, status, archived_at')
        .eq('id', queuePlayerId)
        .eq('club_id', queueClubId),
      'Player',
    ),
    loadMaybeSingle(
      supabaseClient
        .from('player_team_memberships')
        .select('id, club_id, team_id, player_id, status, ended_at')
        .eq('club_id', queueClubId)
        .eq('team_id', queueTeamId)
        .eq('player_id', queuePlayerId)
        .eq('status', 'active')
        .is('ended_at', null),
      'Player team membership',
    ),
    loadMaybeSingle(
      supabaseClient
        .from('teams')
        .select('id, club_id, name')
        .eq('id', queueTeamId)
        .eq('club_id', queueClubId),
      'Team',
    ),
    loadMaybeSingle(
      supabaseClient
        .from('clubs')
        .select('id, name, contact_email, logo_url, status, archived_at')
        .eq('id', queueClubId),
      'Club',
    ),
    loadMaybeSingle(
      supabaseClient
        .from('users')
        .select('id, club_id, email, name, username, display_name, role, role_rank, status')
        .eq('id', queueActorId)
        .eq('club_id', queueClubId),
      'Invite author',
    ),
  ])

  const actorRole = normalizeText(actor?.role).toLowerCase()
  const actorRoleRank = Number(actor?.role_rank ?? 0)
  const playerStatus = normalizeText(player?.status).toLowerCase()
  const baseScopeActive = Boolean(
    inviteLink
    && player
    && membership
    && team
    && club
    && actor
    && inviteLink.link_type === 'parent'
    && inviteLink.status === 'pending'
    && !inviteLink.invite_sent_at
    && !inviteLink.auth_user_id
    && isCurrentTimestamp(inviteLink.expires_at)
    && normalizeEmail(inviteLink.email) === queueRecipient
    && normalizeText(inviteLink.invited_by) === queueActorId
    && normalizeText(player.section).toLowerCase() === 'squad'
    && ['active', 'promoted'].includes(playerStatus)
    && !player.archived_at
    && normalizeText(membership.status).toLowerCase() === 'active'
    && !membership.ended_at
    && normalizeText(club.status || 'active').toLowerCase() === 'active'
    && !club.archived_at
    && normalizeText(actor.status || 'active').toLowerCase() === 'active'
    && actorRoleRank >= 20
    && !['parent_portal', 'adult_player', 'super_admin'].includes(actorRole)
    && normalizeEmail(actor.email) !== 'demo@playerfeedback.online'
  )

  if (!baseScopeActive) {
    return { reason: 'parent_invite_authoritative_scope_inactive', sendable: false }
  }

  const [clubMembership, teamStaff, existingParentPortalLink] = await Promise.all([
    loadMaybeSingle(
      supabaseClient
        .from('user_club_memberships')
        .select('auth_user_id, club_id, role, role_rank')
        .eq('auth_user_id', queueActorId)
        .eq('club_id', queueClubId)
        .eq('role', actor.role)
        .eq('role_rank', actorRoleRank),
      'Invite author club membership',
    ),
    actorRoleRank >= 50
      ? Promise.resolve({ elevatedRole: true })
      : loadMaybeSingle(
          supabaseClient
            .from('team_staff')
            .select('team_id, user_id')
            .eq('team_id', queueTeamId)
            .eq('user_id', queueActorId),
          'Invite author team access',
        ),
    loadMaybeSingle(
      supabaseClient
        .from('parent_player_links')
        .select('id, auth_user_id')
        .eq('club_id', queueClubId)
        .eq('link_type', 'parent')
        .eq('status', 'active')
        .ilike('email', queueRecipient)
        .not('auth_user_id', 'is', null)
        .neq('id', queueLinkId)
        .limit(1),
      'Existing Parent Portal access',
    ),
  ])

  if (!clubMembership || !teamStaff) {
    return { reason: 'parent_invite_authority_inactive', sendable: false }
  }

  return {
    actorName: normalizeText(actor.display_name || actor.name || actor.username || actor.email) || 'Coach',
    club,
    existingParentPortalUser: Boolean(existingParentPortalLink?.auth_user_id),
    inviteLink,
    player,
    recipientEmail: queueRecipient,
    sendable: true,
    team,
  }
}

export async function prepareScheduledParentPortalInviteRow(row, {
  fetchImpl = globalThis.fetch,
  parentOrigin = PARENT_PORTAL_EMAIL_ORIGIN,
  supabaseClient,
} = {}) {
  if (!isParentPortalInviteQueueRow(row)) {
    return {
      handled: false,
      row,
      skipped: false,
    }
  }

  const context = await loadAuthoritativeParentPortalInviteContext(supabaseClient, row)

  if (!context.sendable) {
    return {
      handled: true,
      row,
      skipReason: context.reason,
      skipped: true,
    }
  }

  const email = await buildAuthoritativeParentInviteEmail({
    existingParentPortalUser: context.existingParentPortalUser,
    fetchImpl,
    inviteLink: {
      ...context.inviteLink,
      clubs: context.club,
      players: context.player,
      teams: context.team,
    },
    parentOrigin,
  })
  const existingPayload = row.payload || {}
  const existingResendPayload = existingPayload.resendPayload || {}
  const {
    bcc: ignoredBcc,
    cc: ignoredCc,
    from: ignoredFrom,
    reply_to: ignoredReplyToSnake,
    replyTo: ignoredReplyTo,
    to: ignoredTo,
    ...safeExistingResendPayload
  } = existingResendPayload

  void ignoredBcc
  void ignoredCc
  void ignoredFrom
  void ignoredReplyTo
  void ignoredReplyToSnake
  void ignoredTo

  return {
    email: {
      ...email,
      fromDisplayName: `${context.actorName} (${email.teamName} - ${email.clubName})`,
    },
    handled: true,
    row: {
      ...row,
      subject: email.subject,
      payload: {
        ...existingPayload,
        clubId: row.club_id,
        clubName: email.clubName,
        displayName: context.actorName,
        playerId: context.player.id,
        playerName: email.playerName,
        resendPayload: {
          ...safeExistingResendPayload,
          html: email.html,
          subject: email.subject,
          to: [context.recipientEmail],
        },
        parentPortalInvite: {
          ...(existingPayload.parentPortalInvite || {}),
          linkId: context.inviteLink.id,
          logoSource: email.logoSource,
          playerId: context.player.id,
        },
        teamId: row.team_id,
        teamName: email.teamName,
      },
    },
    skipped: false,
  }
}

export async function markScheduledParentPortalInviteSent(supabaseClient, row) {
  if (!isParentPortalInviteQueueRow(row)) {
    return
  }

  const linkId = normalizeText(row?.payload?.parentPortalInvite?.linkId)
  const playerId = normalizeText(row?.payload?.parentPortalInvite?.playerId)
  const { data, error } = await supabaseClient
    .from('parent_player_links')
    .update({ invite_sent_at: new Date().toISOString() })
    .eq('id', linkId)
    .eq('club_id', row.club_id)
    .eq('team_id', row.team_id)
    .eq('player_id', playerId)
    .eq('status', 'pending')
    .is('invite_sent_at', null)
    .select('id')
    .maybeSingle()

  if (error || !data?.id) {
    throw Object.assign(new Error('Parent Portal invite delivery state could not be recorded.'), {
      code: 'parent_portal_invite_delivery_update_failed',
      cause: error,
    })
  }
}
