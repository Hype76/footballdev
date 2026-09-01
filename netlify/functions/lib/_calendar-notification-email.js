import { createHash } from 'node:crypto'
import {
  buildAuthoritativeCalendarNotificationEmail,
  CALENDAR_NOTIFICATION_PARENT_PORTAL_URL,
  CALENDAR_NOTIFICATION_PLATFORM_ORIGIN,
} from '../../../src/lib/calendar-notification-email.js'
import { resolveMatchDayNotificationTeamName, resolveTeamNotificationDisplayName } from '../../../src/lib/team-notification-display.js'

const CALENDAR_NOTIFICATION_SOURCES = new Set([
  'calendar_event_notification',
  'calendar_trial_event_notification',
])

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase()
}

function hashToken(value) {
  return createHash('sha256').update(normalizeText(value)).digest('hex')
}

function getMetadata(row) {
  return row?.payload?.communicationLog?.metadata || {}
}

export function isCalendarNotificationQueueRow(row) {
  return CALENDAR_NOTIFICATION_SOURCES.has(getMetadata(row).source)
}

export function isTrialCalendarNotificationQueueRow(row) {
  return getMetadata(row).source === 'calendar_trial_event_notification'
}

async function loadMaybeSingle(query, label) {
  const { data, error } = await query.maybeSingle()

  if (error) {
    throw Object.assign(new Error(`${label} could not be verified.`), {
      code: 'calendar_notification_context_failed',
      cause: error,
    })
  }

  return data
}

async function loadCalendarEventContext(supabaseClient, { calendarEventId, clubId }) {
  return loadMaybeSingle(
    supabaseClient
      .from('calendar_events')
      .select('id, club_id, team_id, event_type, title, starts_at, ends_at, location, notes, parent_visible, parent_audience, cancelled_at')
      .eq('id', calendarEventId)
      .eq('club_id', clubId),
    'Calendar event',
  )
}

async function loadMatchDayContext(supabaseClient, { clubId, matchDayId }) {
  const fixture = await loadMaybeSingle(
    supabaseClient
      .from('match_days')
      .select('id, club_id, team_id, notification_team_name, opponent, match_date, kickoff_time, kickoff_time_tbc, venue_name, notes, parent_visible, parent_audience, status')
      .eq('id', matchDayId)
      .eq('club_id', clubId),
    'Match Day fixture',
  )

  if (!fixture) {
    return null
  }

  const startsAt = fixture.kickoff_time_tbc || !fixture.kickoff_time
    ? `${fixture.match_date}T00:00:00+01:00`
    : `${fixture.match_date}T${String(fixture.kickoff_time).slice(0, 8)}+01:00`

  return {
    cancelled_at: fixture.status === 'cancelled' ? new Date().toISOString() : null,
    club_id: fixture.club_id,
    ends_at: '',
    event_type: 'match',
    id: fixture.id,
    location: fixture.venue_name,
    notes: fixture.notes,
    notification_team_name: fixture.notification_team_name,
    parent_audience: fixture.parent_audience,
    parent_visible: fixture.parent_visible,
    starts_at: startsAt,
    team_id: fixture.team_id,
    title: `Match vs ${normalizeText(fixture.opponent) || 'Opponent'}`,
  }
}

async function loadEventContext(supabaseClient, notification) {
  if (notification.calendar_event_id) {
    return loadCalendarEventContext(supabaseClient, {
      calendarEventId: notification.calendar_event_id,
      clubId: notification.club_id,
    })
  }

  if (notification.match_day_id) {
    return loadMatchDayContext(supabaseClient, {
      clubId: notification.club_id,
      matchDayId: notification.match_day_id,
    })
  }

  return null
}

function resolveEventNotificationTeamName(event, brand) {
  if (normalizeText(event?.event_type).toLowerCase() === 'match') {
    return resolveMatchDayNotificationTeamName({
      notification_team_name: event.notification_team_name,
      teams: brand.team,
    }, brand.team?.name) || normalizeText(brand.club?.name)
  }

  return resolveTeamNotificationDisplayName(brand.team || {}, brand.team?.name) || normalizeText(brand.club?.name)
}

async function loadCommonBrandContext(supabaseClient, { clubId, teamId }) {
  const [club, team] = await Promise.all([
    loadMaybeSingle(
      supabaseClient
        .from('clubs')
        .select('id, name, logo_url, theme_accent')
        .eq('id', clubId),
      'Club',
    ),
    teamId
      ? loadMaybeSingle(
          supabaseClient
            .from('teams')
            .select('id, club_id, name, notification_display_name')
            .eq('id', teamId)
            .eq('club_id', clubId),
          'Team',
        )
      : Promise.resolve(null),
  ])

  return { club, team }
}

async function loadParentNotificationContext(supabaseClient, row) {
  const queueId = normalizeText(row?.id)
  const queueClubId = normalizeText(row?.club_id)
  const queueRecipient = normalizeEmail(row?.to_email)

  if (!queueId || !queueClubId || !queueRecipient) {
    return { reason: 'queue_scope_missing', sendable: false }
  }

  const notification = await loadMaybeSingle(
    supabaseClient
      .from('calendar_event_notification_events')
      .select('id, club_id, team_id, calendar_event_id, match_day_id, notification_type, parent_link_id, player_id, recipient_email, status')
      .eq('email_queue_id', queueId)
      .eq('club_id', queueClubId),
    'Calendar notification',
  )

  if (!notification || normalizeEmail(notification.recipient_email) !== queueRecipient) {
    return { reason: 'notification_scope_invalid', sendable: false }
  }

  const event = await loadEventContext(supabaseClient, notification)
  const [player, parentLink, brand, calendarInvite] = await Promise.all([
    loadMaybeSingle(
      supabaseClient
        .from('players')
        .select('id, club_id, team_id, player_name, status')
        .eq('id', notification.player_id)
        .eq('club_id', notification.club_id),
      'Player',
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
    loadCommonBrandContext(supabaseClient, {
      clubId: notification.club_id,
      teamId: notification.team_id,
    }),
    notification.calendar_event_id && normalizeText(event?.event_type).toLowerCase() === 'training'
      ? loadMaybeSingle(
          supabaseClient
            .from('calendar_event_invites')
            .select('id, response_requirement, training_availability_requested, invite_status')
            .eq('calendar_event_id', notification.calendar_event_id)
            .eq('player_id', notification.player_id)
            .eq('club_id', notification.club_id),
          'Calendar invitation',
        )
      : Promise.resolve(null),
  ])
  const parent = parentLink?.auth_user_id
    ? await loadMaybeSingle(
        supabaseClient
          .from('users')
          .select('id, display_name, name, email, status')
          .eq('id', parentLink.auth_user_id)
          .eq('club_id', notification.club_id),
        'Parent profile',
      )
    : null
  const eventTeamId = normalizeText(event?.team_id)
  const notificationTeamId = normalizeText(notification.team_id)
  const playerTeamId = normalizeText(player?.team_id)
  const teamScopeMatches = notificationTeamId
    ? eventTeamId === notificationTeamId && playerTeamId === notificationTeamId
    : !eventTeamId
  const sendable = Boolean(
    event
    && player
    && parentLink
    && parent
    && brand.club
    && event.parent_visible === true
    && ['involved_players', 'all_team_parents', 'all_club_parents'].includes(event.parent_audience)
    && !event.cancelled_at
    && normalizeText(player.status).toLowerCase() !== 'archived'
    && parentLink.status === 'active'
    && parentLink.auth_user_id
    && normalizeText(parent.status || 'active').toLowerCase() === 'active'
    && normalizeEmail(parentLink.email) === queueRecipient
    && teamScopeMatches
  )

  if (
    normalizeText(event?.event_type).toLowerCase() === 'training'
    && calendarInvite?.invite_status !== 'cancelled'
    && (
      calendarInvite?.response_requirement === 'response_required'
      || calendarInvite?.training_availability_requested === true
    )
  ) {
    return { reason: 'training_response_delivery_owned_by_rsvp_queue', sendable: false }
  }

  if (!sendable) {
    return { reason: 'authoritative_scope_inactive', sendable: false }
  }

  const portalUrl = `${CALENDAR_NOTIFICATION_PARENT_PORTAL_URL}&eventId=${encodeURIComponent(event.id)}&parentLinkId=${encodeURIComponent(parentLink.id)}`

  return {
    action: notification.notification_type,
    clubLogoUrl: normalizeText(brand.club.logo_url),
    clubName: normalizeText(brand.club.name),
    endsAt: event.ends_at,
    eventTitle: event.title,
    eventType: event.event_type,
    location: event.location,
    notes: event.notes,
    parentName: normalizeText(parent.display_name || parent.name) || 'Parent or guardian',
    playerName: normalizeText(player.player_name),
    portalUrl,
    recipientEmail: queueRecipient,
    sendable: true,
    startsAt: event.starts_at,
    teamName: resolveEventNotificationTeamName(event, brand),
    themeAccent: normalizeText(brand.club.theme_accent),
    trialInvitation: false,
  }
}

async function loadTrialNotificationContext(supabaseClient, row) {
  const queueId = normalizeText(row?.id)
  const queueClubId = normalizeText(row?.club_id)
  const queueRecipient = normalizeEmail(row?.to_email)
  const rawToken = normalizeText(row?.payload?.trialEventInvitation?.rawToken)

  if (!queueId || !queueClubId || !queueRecipient || !/^[0-9a-f]{64}$/i.test(rawToken)) {
    return { reason: 'trial_queue_scope_missing', sendable: false }
  }

  const invitation = await loadMaybeSingle(
    supabaseClient
      .from('calendar_trial_event_invitations')
      .select('id, notification_command_id, club_id, team_id, calendar_event_id, match_day_id, parent_link_id, guardian_id, player_id, recipient_email, recipient_name, token_hash, expires_at, revoked_at, status')
      .eq('email_queue_id', queueId)
      .eq('club_id', queueClubId),
    'Trial event invitation',
  )

  if (!invitation
    || normalizeEmail(invitation.recipient_email) !== queueRecipient
    || hashToken(rawToken) !== normalizeText(invitation.token_hash).toLowerCase()) {
    return { reason: 'trial_notification_scope_invalid', sendable: false }
  }

  const [event, player, parentLink, guardian, brand] = await Promise.all([
    loadEventContext(supabaseClient, invitation),
    loadMaybeSingle(
      supabaseClient
        .from('players')
        .select('id, club_id, team_id, player_name, section, status')
        .eq('id', invitation.player_id)
        .eq('club_id', invitation.club_id)
        .eq('team_id', invitation.team_id),
      'Trial player',
    ),
    loadMaybeSingle(
      supabaseClient
        .from('parent_player_links')
        .select('id, auth_user_id, club_id, team_id, player_id, guardian_id, email, status, receives_communications')
        .eq('id', invitation.parent_link_id)
        .eq('club_id', invitation.club_id)
        .eq('team_id', invitation.team_id)
        .eq('player_id', invitation.player_id),
      'Trial guardian relationship',
    ),
    loadMaybeSingle(
      supabaseClient
        .from('guardians')
        .select('id, club_id, first_name, last_name, email, status')
        .eq('id', invitation.guardian_id)
        .eq('club_id', invitation.club_id),
      'Trial guardian',
    ),
    loadCommonBrandContext(supabaseClient, {
      clubId: invitation.club_id,
      teamId: invitation.team_id,
    }),
  ])
  const now = Date.now()
  const sendable = Boolean(
    event
    && player
    && parentLink
    && guardian
    && brand.club
    && !invitation.revoked_at
    && new Date(invitation.expires_at).getTime() > now
    && !event.cancelled_at
    && event.parent_visible === true
    && ['involved_players', 'all_team_parents'].includes(event.parent_audience)
    && normalizeText(player.section).toLowerCase() === 'trial'
    && normalizeText(player.status).toLowerCase() !== 'archived'
    && parentLink.status === 'uninvited'
    && !parentLink.auth_user_id
    && parentLink.receives_communications === true
    && normalizeText(parentLink.guardian_id) === normalizeText(guardian.id)
    && normalizeText(guardian.status).toLowerCase() === 'active'
    && normalizeEmail(guardian.email) === queueRecipient
    && normalizeEmail(parentLink.email) === queueRecipient
  )

  if (!sendable) {
    return { reason: 'trial_authoritative_scope_inactive', sendable: false }
  }

  return {
    action: getMetadata(row).notificationType,
    clubLogoUrl: normalizeText(brand.club.logo_url),
    clubName: normalizeText(brand.club.name),
    endsAt: event.ends_at,
    eventTitle: event.title,
    eventType: event.event_type,
    location: event.location,
    notes: event.notes,
    parentName: normalizeText(invitation.recipient_name) || `${guardian.first_name || ''} ${guardian.last_name || ''}`.trim(),
    playerName: normalizeText(player.player_name),
    recipientEmail: queueRecipient,
    responseUrl: `${CALENDAR_NOTIFICATION_PLATFORM_ORIGIN}/.netlify/functions/calendar-trial-rsvp?token=${encodeURIComponent(rawToken)}`,
    sendable: true,
    startsAt: event.starts_at,
    teamName: resolveEventNotificationTeamName(event, brand),
    themeAccent: normalizeText(brand.club.theme_accent),
    trialInvitation: true,
  }
}

export async function loadAuthoritativeCalendarNotificationContext(supabaseClient, row) {
  if (!isCalendarNotificationQueueRow(row)) {
    return { reason: 'not_calendar_notification', sendable: false }
  }

  return isTrialCalendarNotificationQueueRow(row)
    ? loadTrialNotificationContext(supabaseClient, row)
    : loadParentNotificationContext(supabaseClient, row)
}

export async function prepareScheduledCalendarNotificationRow(row, {
  fetchImpl = globalThis.fetch,
  supabaseClient,
} = {}) {
  if (!isCalendarNotificationQueueRow(row)) {
    return {
      handled: false,
      row,
      skipped: false,
    }
  }

  const context = await loadAuthoritativeCalendarNotificationContext(supabaseClient, row)

  if (!context.sendable) {
    return {
      handled: true,
      row,
      skipReason: context.reason,
      skipped: true,
    }
  }

  const email = await buildAuthoritativeCalendarNotificationEmail({
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
        displayName: email.clubName,
        playerName: email.playerName,
        resendPayload: {
          ...safeExistingResendPayload,
          html: email.html,
          subject: email.subject,
          to: [context.recipientEmail],
        },
        teamId: row.team_id,
        teamName: email.teamName,
      },
    },
    skipped: false,
  }
}
