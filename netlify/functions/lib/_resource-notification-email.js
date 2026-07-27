import {
  buildAuthoritativeResourceNotificationEmail,
} from '../../../src/lib/resource-notification-email.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase()
}

export function isResourceNotificationQueueRow(row) {
  return row?.payload?.resourceNotification?.type === 'resource_shared'
}

async function loadMaybeSingle(query, label) {
  const { data, error } = await query.maybeSingle()

  if (error) {
    throw Object.assign(new Error(`${label} could not be verified.`), {
      code: 'resource_notification_context_failed',
      cause: error,
    })
  }

  return data
}

export async function loadAuthoritativeResourceNotificationContext(
  supabaseClient,
  row,
) {
  const queueId = normalizeText(row?.id)
  const queueClubId = normalizeText(row?.club_id)
  const queueTeamId = normalizeText(row?.team_id)
  const queueRecipient = normalizeEmail(row?.to_email)

  if (!queueId || !queueClubId || !queueTeamId || !queueRecipient) {
    return { reason: 'queue_scope_missing', sendable: false }
  }

  const notification = await loadMaybeSingle(
    supabaseClient
      .from('resource_library_parent_notifications')
      .select('id, link_id, resource_id, club_id, team_id, player_id, parent_link_id, recipient_email')
      .eq('email_queue_id', queueId)
      .eq('club_id', queueClubId)
      .eq('team_id', queueTeamId),
    'Resource notification',
  )

  if (!notification
    || normalizeEmail(notification.recipient_email) !== queueRecipient
    || !notification.parent_link_id) {
    return { reason: 'notification_scope_invalid', sendable: false }
  }

  const [link, resource, player, team, club, parentLink] = await Promise.all([
    loadMaybeSingle(
      supabaseClient
        .from('resource_library_links')
        .select('id, resource_id, club_id, team_id, linked_type, linked_id, parent_visible, share_description, removed_at')
        .eq('id', notification.link_id)
        .eq('resource_id', notification.resource_id)
        .eq('club_id', notification.club_id)
        .eq('team_id', notification.team_id),
      'Resource assignment',
    ),
    loadMaybeSingle(
      supabaseClient
        .from('resource_library_items')
        .select('id, club_id, team_id, title, archived_at')
        .eq('id', notification.resource_id)
        .eq('club_id', notification.club_id)
        .eq('team_id', notification.team_id),
      'Resource',
    ),
    loadMaybeSingle(
      supabaseClient
        .from('players')
        .select('id, club_id, team_id, player_name, status, archived_at')
        .eq('id', notification.player_id)
        .eq('club_id', notification.club_id)
        .eq('team_id', notification.team_id),
      'Player',
    ),
    loadMaybeSingle(
      supabaseClient
        .from('teams')
        .select('id, club_id, name')
        .eq('id', notification.team_id)
        .eq('club_id', notification.club_id),
      'Team',
    ),
    loadMaybeSingle(
      supabaseClient
        .from('clubs')
        .select('id, name, logo_url')
        .eq('id', notification.club_id),
      'Club',
    ),
    loadMaybeSingle(
      supabaseClient
        .from('parent_player_links')
        .select('id, auth_user_id, club_id, team_id, player_id, email, status')
        .eq('id', notification.parent_link_id)
        .eq('club_id', notification.club_id)
        .eq('player_id', notification.player_id),
      'Parent relationship',
    ),
  ])

  const parentTeamId = normalizeText(parentLink?.team_id)
  const sendable = Boolean(
    link
    && resource
    && player
    && team
    && club
    && parentLink
    && link.linked_type === 'player'
    && normalizeText(link.linked_id) === normalizeText(notification.player_id)
    && link.parent_visible === true
    && !link.removed_at
    && !resource.archived_at
    && normalizeText(player.status).toLowerCase() !== 'archived'
    && !player.archived_at
    && parentLink.status === 'active'
    && parentLink.auth_user_id
    && (!parentTeamId || parentTeamId === normalizeText(notification.team_id))
    && normalizeEmail(parentLink.email) === queueRecipient
  )

  if (!sendable) {
    return { reason: 'authoritative_scope_inactive', sendable: false }
  }

  return {
    clubLogoUrl: normalizeText(club.logo_url),
    clubName: normalizeText(club.name),
    playerId: normalizeText(player.id),
    playerName: normalizeText(player.player_name),
    recipientEmail: queueRecipient,
    resourceDescription: normalizeText(link.share_description),
    resourceTitle: normalizeText(resource.title),
    sendable: true,
    teamName: normalizeText(team.name),
  }
}

export async function prepareScheduledResourceNotificationRow(row, {
  fetchImpl = globalThis.fetch,
  supabaseClient,
} = {}) {
  if (!isResourceNotificationQueueRow(row)) {
    return {
      handled: false,
      row,
      skipped: false,
    }
  }

  const context = await loadAuthoritativeResourceNotificationContext(
    supabaseClient,
    row,
  )

  if (!context.sendable) {
    return {
      handled: true,
      row,
      skipReason: context.reason,
      skipped: true,
    }
  }

  const email = await buildAuthoritativeResourceNotificationEmail({
    ...context,
    fetchImpl,
  })
  const existingPayload = row.payload || {}
  const existingResendPayload = existingPayload.resendPayload || {}
  const {
    from: ignoredFrom,
    reply_to: ignoredReplyToSnake,
    replyTo: ignoredReplyTo,
    ...safeExistingResendPayload
  } = existingResendPayload

  void ignoredFrom
  void ignoredReplyTo
  void ignoredReplyToSnake

  return {
    email,
    handled: true,
    row: {
      ...row,
      subject: email.subject,
      payload: {
        ...existingPayload,
        clubId: row.club_id,
        clubName: email.clubName,
        playerId: context.playerId,
        playerName: email.playerName,
        resendPayload: {
          ...safeExistingResendPayload,
          html: email.html,
          subject: email.subject,
          to: [context.recipientEmail],
        },
        resourceNotification: {
          ...(existingPayload.resourceNotification || {}),
          logoSource: email.logoSource,
        },
        teamId: row.team_id,
        teamName: email.teamName,
      },
    },
    skipped: false,
  }
}
