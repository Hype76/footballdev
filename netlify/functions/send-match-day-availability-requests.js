import process from 'node:process'
import { createHash } from 'node:crypto'
import { createFromAddress } from './lib/_email-provider.js'
import { json } from './lib/_stripe-billing.js'
import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { createPublicSupabaseClient, createSupabaseAdminClient } from './lib/_supabase.js'
import { assertWorkspaceBillingAction } from './lib/_billing-access.js'
import {
  buildMatchDayActionableInvitationEmail,
  createInvitationToken,
  isValidInvitationEmail,
  normalizeInvitationEmail,
  normalizeInvitationText,
  resolveEligibleMatchDayInvitationContacts,
} from './lib/_match-day-actionable-invitation.js'
import { resolveMatchDayNotificationTeamName } from '../../src/lib/team-notification-display.js'

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  const [scheme, token] = String(header).split(' ')
  return scheme?.toLowerCase() === 'bearer' ? token : ''
}

function normalizeText(value) {
  return normalizeInvitationText(value)
}

function normalizeEmail(value) {
  return normalizeInvitationEmail(value)
}

function isValidEmail(value) {
  return isValidInvitationEmail(value)
}

function hashResponseToken(token) {
  return createHash('sha256').update(String(token || '')).digest('hex')
}

function tokenFromResponseContent(value) {
  const match = String(value || '').match(/[?&]token=([a-f0-9]{64})(?:[&#"'\s]|$)/i)
  return normalizeText(match?.[1]).toLowerCase()
}

export function getReusableMatchDayResponseToken(request, queues = []) {
  const expectedHash = normalizeText(request?.token_hash).toLowerCase()

  if (!/^[a-f0-9]{64}$/.test(expectedHash) || request?.token_revoked_at) {
    return ''
  }

  for (const queue of queues || []) {
    const payload = queue?.payload || {}
    const candidates = [
      payload.matchDayAvailability?.rawToken,
      tokenFromResponseContent(payload.resendPayload?.html),
      tokenFromResponseContent(payload.resendPayload?.text),
    ]

    for (const candidate of candidates) {
      const token = normalizeText(candidate).toLowerCase()

      if (/^[a-f0-9]{64}$/.test(token) && hashResponseToken(token) === expectedHash) {
        return token
      }
    }
  }

  return ''
}

async function getVolunteerRequestTemplates(adminSupabase, match) {
  const { data, error } = await adminSupabase
    .from('parent_email_templates')
    .select('template_key, audience, label, body, is_enabled, section_availability')
    .eq('club_id', match.club_id)
    .eq('team_id', match.team_id)
    .eq('audience', 'parent')

  if (error) {
    throw error
  }

  return data ?? []
}

function getAppOrigin(event) {
  const host = event.headers['x-forwarded-host'] || event.headers.host || 'footballplayer.online'
  const protocol = event.headers['x-forwarded-proto'] || 'https'
  const requestOrigin = `${protocol}://${host}`.replace(/\/$/, '')
  return requestOrigin || normalizeText(process.env.VITE_APP_URL || process.env.URL).replace(/\/$/, '')
}

function createRequestSupabaseClient(event, token) {
  return createPublicSupabaseClient(event, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  })
}

async function getAuthenticatedProfile(event, supabase, adminSupabase) {
  const token = getBearerToken(event)

  if (!token) {
    throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(token)

  if (authError || !authData?.user?.id) {
    throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
  }

  const profile = await loadActiveAuthorityProfile(adminSupabase, authData.user, {
    select: 'id, email, name, display_name, role, role_label, role_rank, club_id, status',
  })

  if (!profile?.club_id || profile.role === 'parent_portal' || profile.role === 'super_admin' || Number(profile.role_rank ?? 0) < 20) {
    throw Object.assign(new Error('Coach or manager access is required.'), { statusCode: 403 })
  }

  return profile
}

async function createMatchDayEventLogEntry(adminSupabase, {
  eventLabel = '',
  eventType = 'match_day_updated',
  match,
  metadata = {},
  newValue = null,
  playerId = null,
  previousValue = null,
  profile,
} = {}) {
  if (!match?.id || !match?.club_id || !match?.team_id) {
    return
  }

  try {
    const { error } = await adminSupabase
      .from('match_day_event_log')
      .insert({
        club_id: match.club_id,
        team_id: match.team_id,
        match_day_id: match.id,
        player_id: playerId || null,
        actor_user_id: profile?.id || null,
        actor_display_name: normalizeText(profile?.display_name || profile?.name || profile?.email),
        actor_role: normalizeText(profile?.role_label || profile?.role),
        event_type: eventType,
        event_label: eventLabel,
        previous_value: previousValue,
        new_value: newValue,
        metadata,
      })

    if (error) {
      console.warn('Match Day event log write failed', error)
    }
  } catch (error) {
    console.warn('Match Day event log write failed', error)
  }
}

function getInvitationExpiry(match) {
  const matchDate = normalizeText(match?.match_date)
  const minimumExpiry = Date.now() + 86400000
  const matchExpiry = /^\d{4}-\d{2}-\d{2}$/.test(matchDate)
    ? new Date(`${matchDate}T23:59:59.999Z`).getTime() + (2 * 86400000)
    : 0
  return new Date(Math.max(minimumExpiry, matchExpiry)).toISOString()
}

async function prepareCalendarEditInvitations({
  adminSupabase,
  appOrigin,
  matchDayId,
  notificationRequestToken,
  profile,
  supabase,
}) {
  const { data: commandResult, error: commandError } = await supabase.rpc('notify_calendar_event_parents', {
    calendar_event_id_value: null,
    event_action_value: 'update',
    match_day_id_value: matchDayId,
    notification_request_token_value: notificationRequestToken,
    player_ids_value: [],
  })

  if (commandError) {
    throw commandError
  }

  const commandId = normalizeText(commandResult?.notificationCommandId)
  if (!commandId || commandResult?.actionReconciliationState !== 'ready') {
    throw new Error(commandResult?.failureDetail || 'The updated invitation request could not be prepared safely.')
  }

  try {
  const [{ data: command, error: commandReadError }, { data: match, error: matchError }, { data: notifications, error: notificationError }] = await Promise.all([
    adminSupabase
      .from('calendar_event_notification_commands')
      .select('id, club_id, team_id, match_day_id, player_ids, event_revision, notification_type, result')
      .eq('id', commandId)
      .eq('club_id', profile.club_id)
      .eq('match_day_id', matchDayId)
      .maybeSingle(),
    adminSupabase
      .from('match_days')
      .select('*, teams:team_id (name, notification_display_name), clubs:club_id (name, logo_url)')
      .eq('id', matchDayId)
      .eq('club_id', profile.club_id)
      .is('deleted_at', null)
      .maybeSingle(),
    adminSupabase
      .from('calendar_event_notification_events')
      .select('id, email_queue_id, parent_link_id, player_id, recipient_email, status')
      .eq('notification_command_id', commandId),
  ])

  if (commandReadError || !command?.id) {
    throw commandReadError || new Error('The Calendar notification command could not be verified.')
  }
  if (matchError || !match?.id || ['cancelled', 'full_time', 'postponed'].includes(normalizeText(match?.status).toLowerCase())) {
    throw matchError || new Error('This fixture cannot accept updated responses.')
  }
  if (notificationError) {
    throw notificationError
  }

  const authoritativePlayerIds = [...new Set((command.player_ids ?? []).map(String).filter(Boolean))]
  const [{ data: players, error: playersError }, eligibleContacts, { data: requests, error: requestsError }, { data: assignments, error: assignmentsError }, queueResult, historicalQueueResult] = await Promise.all([
    adminSupabase
      .from('players')
      .select('id, club_id, team_id, player_name, section, status, parent_name, parent_email, parent_contacts, contact_type')
      .eq('club_id', profile.club_id)
      .in('id', authoritativePlayerIds),
    resolveEligibleMatchDayInvitationContacts(adminSupabase, {
      clubId: profile.club_id,
      playerIds: authoritativePlayerIds,
      teamId: match.team_id,
    }),
    adminSupabase
      .from('match_day_availability_requests')
      .select('*')
      .eq('match_day_id', matchDayId)
      .eq('club_id', profile.club_id),
    adminSupabase
      .from('match_day_role_assignments')
      .select('role')
      .eq('match_day_id', matchDayId)
      .eq('club_id', profile.club_id)
      .eq('team_id', match.team_id),
    adminSupabase
      .from('scheduled_email_queue')
      .select('*')
      .eq('club_id', profile.club_id)
      .eq('team_id', match.team_id)
      .contains('payload', { communicationLog: { metadata: { notificationCommandId: commandId } } }),
    adminSupabase
      .from('scheduled_email_queue')
      .select('id, payload, status, created_at')
      .eq('club_id', profile.club_id)
      .eq('team_id', match.team_id)
      .contains('payload', { matchDayAvailability: { matchDayId } })
      .order('created_at', { ascending: false })
      .limit(500),
  ])
  const { data: queueRows, error: queueError } = queueResult
  const { data: historicalQueueRows, error: historicalQueueError } = historicalQueueResult

  if (playersError || requestsError || assignmentsError || queueError || historicalQueueError) {
    throw playersError || requestsError || assignmentsError || queueError || historicalQueueError
  }

  const volunteerTemplates = await getVolunteerRequestTemplates(adminSupabase, match)
  const playerMap = new Map((players ?? []).map((player) => [String(player.id), player]))
  const queueMap = new Map((queueRows ?? []).map((row) => [String(row.id), row]))
  const notificationMap = new Map((notifications ?? []).map((row) => [`${row.player_id}:${normalizeEmail(row.recipient_email)}`, row]))
  const recipientUnits = [...new Map((eligibleContacts ?? [])
    .map((contact) => {
      const player = playerMap.get(String(contact.playerId))
      const recipientEmail = normalizeEmail(contact.email)
      return [`${contact.playerId}:${recipientEmail}`, { contact, player, recipientEmail }]
    })
    .filter(([, unit]) => unit.player && isValidEmail(unit.recipientEmail))).values()]
  const activeScopeKeys = new Set(recipientUnits.map((unit) => `${unit.player.id}:${unit.recipientEmail}`))
  const filledRoles = new Set((assignments ?? []).map((assignment) => normalizeText(assignment.role).toLowerCase()))
  const actionableMatch = {
    ...match,
    request_scorer: match.request_scorer === true && !filledRoles.has('scorer'),
    request_linesman: match.request_linesman === true && !filledRoles.has('linesman'),
    request_referee: match.request_referee === true && !filledRoles.has('referee'),
  }
  const preparedQueueIds = []
  let duplicateCount = Number(commandResult?.duplicateCount ?? 0)
  let failedCount = 0

  for (const { contact, player, recipientEmail } of recipientUnits) {
    const notification = notificationMap.get(`${player.id}:${recipientEmail}`)
    const request = (requests ?? []).find((candidate) =>
      String(candidate.player_id) === String(player.id)
      && normalizeEmail(candidate.recipient_email) === recipientEmail
      && candidate.recipient_type === contact.type
      && candidate.channel === 'email')
    let queue = notification?.email_queue_id ? queueMap.get(String(notification.email_queue_id)) : null

    if (!queue && request?.id) {
      queue = (queueRows ?? []).find((candidate) => candidate.payload?.matchDayAvailability?.requestId === request.id) || null
    }

    if (!player || !request) {
      failedCount += 1
      continue
    }

    if (queue?.payload?.matchDayActionableInvitation?.prepared === true) {
      duplicateCount += 1
      preparedQueueIds.push(queue.id)
      continue
    }

    if (queue && queue.status !== 'scheduled') {
      duplicateCount += 1
      continue
    }

    const historicalRequestQueues = (historicalQueueRows ?? []).filter((candidate) =>
      candidate.payload?.matchDayAvailability?.requestId === request.id)
    let token = getReusableMatchDayResponseToken(request, [queue, ...historicalRequestQueues].filter(Boolean))
    let tokenHash = request.token_hash

    if (!token) {
      const createdToken = createInvitationToken()
      token = createdToken.token
      tokenHash = createdToken.tokenHash
    }

    const expiry = getInvitationExpiry(match)
    const { error: requestUpdateError } = await adminSupabase
      .from('match_day_availability_requests')
      .update({
        expires_at: expiry,
        parent_link_id: contact.parentLinkId || null,
        recipient_email: recipientEmail,
        recipient_name: request.recipient_name || contact.name || (contact.type === 'player' ? player.player_name : 'Parent or guardian'),
        token_hash: tokenHash,
        token_revoked_at: null,
        token_revoked_reason: null,
        token_revoked_by: null,
        token_revoked_source: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', request.id)
      .eq('match_day_id', matchDayId)
      .eq('club_id', profile.club_id)

    if (requestUpdateError) {
      failedCount += 1
      continue
    }

    const responseUrl = `${appOrigin}/.netlify/functions/match-day-availability-confirm?token=${token}`
    const recipient = {
      email: recipientEmail,
      name: request.recipient_name || contact.name,
      type: contact.type,
    }
    const email = buildMatchDayActionableInvitationEmail({
      appOrigin,
      match: actionableMatch,
      player,
      recipient,
      responseUrl,
      updated: true,
      volunteerTemplates,
    })
    const payload = {
      ...(queue?.payload || {}),
      resendPayload: {
        ...((queue?.payload || {}).resendPayload || {}),
        from: createFromAddress('Football Player'),
        to: [recipientEmail],
        subject: email.subject,
        html: email.html,
        text: email.text,
      },
      matchDayAvailability: {
        matchDayId,
        requestId: request.id,
        playerId: player.id,
        parentLinkId: contact.parentLinkId || null,
        purpose: 'availability_request_notification',
        rawToken: token,
        tokenHash,
      },
      matchDayActionableInvitation: {
        prepared: true,
        source: 'calendar_edit',
        notificationCommandId: commandId,
        eventRevision: command.event_revision,
      },
      visibleInEmailQueue: false,
      displayName: 'Football Player',
      teamName: resolveMatchDayNotificationTeamName(match),
      clubName: normalizeText(match.clubs?.name),
      playerName: normalizeText(player.player_name),
      parentName: normalizeText(request.recipient_name),
      clubId: match.club_id,
      teamId: match.team_id,
      actorId: profile.id,
      actorEmail: normalizeEmail(profile.email),
      actorRole: profile.role || '',
      requiredFeature: 'parentEmails',
    }
    payload.communicationLog = {
      ...(payload.communicationLog || {}),
      clubId: match.club_id,
      playerId: player.id,
      userId: profile.id,
      userName: normalizeText(profile.display_name || profile.name || profile.email),
      userEmail: normalizeEmail(profile.email),
      recipientEmail,
      metadata: {
        ...(payload.communicationLog?.metadata || {}),
        type: 'match_day_availability',
        source: 'calendar_event_notification',
        matchDayId,
        matchDayAvailabilityRequestId: request.id,
        notificationCommandId: commandId,
        subject: email.subject,
        body: email.html,
      },
    }
    let queueUpdateError = null
    if (queue?.id) {
      const queueUpdate = await adminSupabase
        .from('scheduled_email_queue')
        .update({
          subject: email.subject,
          scheduled_at: new Date().toISOString(),
          payload,
        })
        .eq('id', queue.id)
        .eq('club_id', profile.club_id)
        .eq('status', 'scheduled')
      queueUpdateError = queueUpdate.error
    } else {
      const queueInsert = await adminSupabase
        .from('scheduled_email_queue')
        .insert({
          club_id: match.club_id,
          team_id: match.team_id,
          created_by: profile.id,
          created_by_email: normalizeEmail(profile.email),
          to_email: recipientEmail,
          subject: email.subject,
          status: 'scheduled',
          scheduled_at: new Date().toISOString(),
          payload,
        })
        .select('id')
        .single()
      queueUpdateError = queueInsert.error
      queue = queueInsert.data ? { id: queueInsert.data.id, payload, status: 'scheduled' } : null
    }

    if (queueUpdateError) {
      failedCount += 1
      continue
    }

    preparedQueueIds.push(queue.id)
  }

  const staleRequests = (requests ?? []).filter((request) =>
    request.parent_link_id
    && !activeScopeKeys.has(`${request.player_id}:${normalizeEmail(request.recipient_email)}`))
  for (const staleRequest of staleRequests) {
    await adminSupabase
      .from('match_day_availability_requests')
      .update({
        token_revoked_at: new Date().toISOString(),
        token_revoked_reason: 'recipient_authority_removed',
        token_revoked_by: profile.id,
        token_revoked_source: 'calendar_edit_actionable_invitation',
        expires_at: new Date(0).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', staleRequest.id)
      .eq('match_day_id', matchDayId)
      .eq('club_id', profile.club_id)
  }

  if (failedCount > 0) {
    throw new Error('One or more updated invitations could not be prepared safely. No email was released.')
  }

  await createMatchDayEventLogEntry(adminSupabase, {
    eventType: 'invite_prepared',
    eventLabel: 'Updated actionable invitations prepared',
    match,
    metadata: {
      notificationCommandId: commandId,
      preparedQueueCount: preparedQueueIds.length,
      staleTokenCount: staleRequests.length,
      source: 'calendar_edit_actionable_invitation',
    },
    newValue: { state: failedCount > 0 ? 'partial' : 'ready' },
    playerId: null,
    profile,
  })

  return {
    ...commandResult,
    success: failedCount === 0,
    queuedCount: preparedQueueIds.length,
    failedCount,
    duplicateCount,
    eligibleRecipientCount: recipientUnits.length,
    finalState: failedCount > 0 ? 'actionable_invitation_partial' : 'actionable_invitation_ready',
    actionableInvitationPrepared: true,
    staleTokenCount: staleRequests.length,
  }
  } catch (error) {
    const { data: unsafeQueues } = await adminSupabase
      .from('scheduled_email_queue')
      .select('id, payload')
      .eq('club_id', profile.club_id)
      .eq('status', 'scheduled')
      .contains('payload', { communicationLog: { metadata: { notificationCommandId: commandId } } })

    for (const queue of unsafeQueues ?? []) {
      await adminSupabase
        .from('scheduled_email_queue')
        .update({
          status: 'failed',
          last_error: 'Actionable invitation preparation failed closed.',
          payload: {
            ...(queue.payload || {}),
            resendPayload: {
              ...((queue.payload || {}).resendPayload || {}),
              to: [],
            },
            calendarActionableInvitationBlocked: true,
          },
        })
        .eq('id', queue.id)
        .eq('club_id', profile.club_id)
        .eq('status', 'scheduled')
    }

    await adminSupabase
      .from('calendar_event_notification_events')
      .update({
        status: 'failed',
        last_error: 'Actionable invitation preparation failed closed.',
        updated_at: new Date().toISOString(),
      })
      .eq('notification_command_id', commandId)
      .eq('club_id', profile.club_id)

    throw error
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, message: 'Method not allowed.' })
  }

  try {
    const token = getBearerToken(event)
    const supabase = createRequestSupabaseClient(event, token)
    const adminSupabase = createSupabaseAdminClient(event)
    const profile = await getAuthenticatedProfile(event, supabase, adminSupabase)
    await assertWorkspaceBillingAction({ clubId: profile.club_id, profile })
    const body = JSON.parse(event.body || '{}')
    const matchDayId = normalizeText(body.matchDayId)
    const playerIds = Array.isArray(body.playerIds)
      ? [...new Set(body.playerIds.map(normalizeText).filter(Boolean))]
      : []
    const notificationRequestToken = normalizeText(body.notificationRequestToken)
    const calendarEditMode = body.source === 'calendar_edit'
    const invitationAction = normalizeText(body.invitationAction).toLowerCase()
    const invitationActionKey = normalizeText(body.idempotencyKey)
    const targetedInvitationAction = ['send', 'resend', 'retry'].includes(invitationAction)

    if (!matchDayId) {
      throw Object.assign(new Error('Match Day is required.'), { statusCode: 400 })
    }

    if (!calendarEditMode && playerIds.length === 0) {
      throw Object.assign(new Error('Select at least one player.'), { statusCode: 400 })
    }

    if (targetedInvitationAction && playerIds.length !== 1) {
      throw Object.assign(new Error('A direct invitation action must target exactly one player.'), { statusCode: 400 })
    }

    if (
      targetedInvitationAction
      && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invitationActionKey)
    ) {
      throw Object.assign(new Error('A valid invitation idempotency key is required.'), { statusCode: 400 })
    }

    if (calendarEditMode && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notificationRequestToken)) {
      throw Object.assign(new Error('A valid Calendar notification request token is required.'), { statusCode: 400 })
    }

    if (calendarEditMode) {
      return json(200, await prepareCalendarEditInvitations({
        adminSupabase,
        appOrigin: getAppOrigin(event),
        matchDayId,
        notificationRequestToken,
        profile,
        supabase,
      }))
    }

    if (targetedInvitationAction) {
      const { data: priorActions, error: priorActionError } = await adminSupabase
        .from('scheduled_email_queue')
        .select('id')
        .eq('club_id', profile.club_id)
        .contains('payload', {
          eventPlayerInvitationAction: {
            idempotencyKey: invitationActionKey,
          },
        })
        .limit(1)

      if (priorActionError) {
        throw priorActionError
      }

      if ((priorActions ?? []).length > 0) {
        return json(200, {
          success: true,
          duplicate: true,
          duplicateCount: 1,
          queuedCount: 0,
          recipientCount: 0,
          playerId: playerIds[0],
        })
      }
    }

    const { data: match, error: matchError } = await supabase
      .from('match_days')
      .select('*, teams:team_id (name, notification_display_name), clubs:club_id (name, logo_url)')
      .eq('id', matchDayId)
      .eq('club_id', profile.club_id)
      .is('deleted_at', null)
      .maybeSingle()

    if (matchError) {
      throw matchError
    }

    if (!match?.id) {
      throw Object.assign(new Error('Fixture was not found.'), { statusCode: 404 })
    }

    const volunteerTemplates = await getVolunteerRequestTemplates(adminSupabase, match)
    const { data: membershipRows, error: membershipsError } = await adminSupabase
      .from('player_team_memberships')
      .select('player_id')
      .eq('club_id', match.club_id)
      .eq('team_id', match.team_id)
      .eq('status', 'active')
      .is('ended_at', null)
      .in('player_id', playerIds)

    if (membershipsError) {
      throw membershipsError
    }

    const authorisedPlayerIds = [...new Set(
      (membershipRows ?? []).map((membership) => normalizeText(membership.player_id)).filter(Boolean),
    )]
    const { data: players, error: playersError } = authorisedPlayerIds.length > 0
      ? await adminSupabase
      .from('players')
      .select('id, club_id, team_id, player_name, section, status, parent_name, parent_email, parent_contacts, contact_type')
      .eq('club_id', match.club_id)
      .neq('status', 'archived')
      .is('archived_at', null)
      .in('id', authorisedPlayerIds)
      : { data: [], error: null }

    if (playersError) {
      throw playersError
    }

    const appOrigin = getAppOrigin(event)
    const createdRequests = []
    const queuedEmails = []
    const missingContacts = []
    const createdPlayerIds = new Set()
    const duplicatePlayerIds = new Set()
    const loadedPlayerIds = new Set((players ?? []).map((player) => String(player.id)))
    let duplicateQueueCount = 0
    let lastQueuedAt = ''
    const eligibleContacts = await resolveEligibleMatchDayInvitationContacts(adminSupabase, {
      clubId: match.club_id,
      playerIds,
      teamId: match.team_id,
    })

    for (const playerId of playerIds) {
      if (!loadedPlayerIds.has(String(playerId))) {
        missingContacts.push({ playerId, playerName: 'Player' })
      }
    }

    for (const player of players ?? []) {
      const contacts = eligibleContacts
        .filter((contact) => String(contact.playerId) === String(player.id))
        .filter((contact) => isValidEmail(contact.email))

      if (contacts.length === 0) {
        missingContacts.push({ playerId: player.id, playerName: player.player_name })
        continue
      }

      const [requestResult, responseResult] = await Promise.all([
        adminSupabase
          .from('match_day_availability_requests')
          .select('id, status, token_hash, token_revoked_at, token_version, recipient_email, recipient_type, parent_link_id')
          .eq('match_day_id', match.id)
          .eq('club_id', match.club_id)
          .eq('team_id', match.team_id)
          .eq('player_id', player.id),
        adminSupabase
          .from('match_day_player_availability')
          .select('id, status')
          .eq('match_day_id', match.id)
          .eq('club_id', match.club_id)
          .eq('team_id', match.team_id)
          .eq('player_id', player.id)
          .maybeSingle(),
      ])

      if (requestResult.error || responseResult.error) {
        throw requestResult.error || responseResult.error
      }

      const playerRequests = requestResult.data || []
      const hasCurrentResponse = responseResult.data?.id
        && ['available', 'maybe', 'unavailable'].includes(normalizeText(responseResult.data.status).toLowerCase())

      if (targetedInvitationAction && hasCurrentResponse) {
        throw Object.assign(new Error('This Player already has a valid availability response. The reusable response link remains available without another email.'), { statusCode: 409 })
      }

      if (invitationAction === 'send' && playerRequests.length > 0) {
        throw Object.assign(new Error('This Player already has an availability invitation. Use Resend availability invite.'), { statusCode: 409 })
      }

      if (['resend', 'retry'].includes(invitationAction) && playerRequests.length === 0) {
        throw Object.assign(new Error('There is no existing availability invitation for this action.'), { statusCode: 409 })
      }

      const activeRecipientKeys = new Set(contacts.map((contact) => `${normalizeEmail(contact.email)}:${contact.type}`))
      const staleRequests = playerRequests.filter((request) => (
        !request.token_revoked_at
        && !activeRecipientKeys.has(`${normalizeEmail(request.recipient_email)}:${request.recipient_type}`)
      ))

      for (const staleRequest of targetedInvitationAction ? staleRequests : []) {
        const { error: revokeError } = await adminSupabase
          .from('match_day_availability_requests')
          .update({
            token_revoked_at: new Date().toISOString(),
            token_revoked_by: profile.id,
            token_revoked_reason: 'recipient_authority_removed',
            token_revoked_source: 'game_day_invited_player_manager',
            updated_at: new Date().toISOString(),
          })
          .eq('id', staleRequest.id)
          .eq('match_day_id', match.id)
          .eq('club_id', match.club_id)
          .eq('team_id', match.team_id)

        if (revokeError) {
          throw revokeError
        }
      }

      for (const contact of contacts) {
        const parentLinkId = contact.parentLinkId || null
        const existingRequest = playerRequests.find((request) => (
          normalizeEmail(request.recipient_email) === normalizeEmail(contact.email)
          && request.recipient_type === contact.type
        )) || null

        let existingQueues = []

        if (existingRequest?.id) {
          const { data: loadedQueues, error: existingQueueError } = await adminSupabase
            .from('scheduled_email_queue')
            .select('id, status, payload')
            .eq('club_id', match.club_id)
            .contains('payload', { matchDayAvailability: { requestId: existingRequest.id } })
            .order('created_at', { ascending: false })
            .limit(20)

          if (existingQueueError) {
            throw existingQueueError
          }

          existingQueues = loadedQueues || []

          if (!targetedInvitationAction && (existingQueues ?? []).some((queue) => ['scheduled', 'sending', 'sent'].includes(queue.status))) {
            duplicateQueueCount += 1
            duplicatePlayerIds.add(String(player.id))
            continue
          }

          if (!targetedInvitationAction) {
            duplicateQueueCount += 1
            duplicatePlayerIds.add(String(player.id))
            continue
          }

          if (invitationAction === 'retry' && !(existingQueues ?? []).some((queue) => queue.status === 'failed')) {
            throw Object.assign(new Error('This invitation does not have a failed delivery to retry.'), { statusCode: 409 })
          }
        } else if (invitationAction === 'retry') {
          continue
        }

        const reusableToken = existingRequest?.id && targetedInvitationAction
          ? getReusableMatchDayResponseToken(existingRequest, existingQueues || [])
          : ''

        if (existingRequest?.id && targetedInvitationAction && !existingRequest.token_revoked_at && !reusableToken) {
          throw Object.assign(new Error('The existing availability link cannot be reused safely. Revoke it explicitly before issuing a security replacement.'), { statusCode: 409 })
        }

        const createdToken = reusableToken ? null : createInvitationToken()
        const token = reusableToken || createdToken.token
        const tokenHash = reusableToken ? existingRequest.token_hash : createdToken.tokenHash
        const requestMutation = existingRequest?.id && targetedInvitationAction
          ? supabase
              .from('match_day_availability_requests')
              .update({
                expires_at: getInvitationExpiry(match),
                parent_link_id: parentLinkId,
                recipient_name: contact.name,
                status: existingRequest.status === 'expired' ? 'pending' : existingRequest.status,
                ...(existingRequest.token_revoked_at ? {
                  token_hash: tokenHash,
                  token_revoked_at: null,
                  token_revoked_by: null,
                  token_revoked_reason: null,
                  token_revoked_source: null,
                  token_version: Number(existingRequest.token_version || 1) + 1,
                } : {}),
                updated_at: new Date().toISOString(),
              })
              .eq('id', existingRequest.id)
          : supabase
              .from('match_day_availability_requests')
              .upsert({
                match_day_id: match.id,
                club_id: match.club_id,
                team_id: match.team_id || null,
                player_id: player.id,
                player_name: player.player_name,
                recipient_email: contact.email,
                recipient_name: contact.name,
                recipient_type: contact.type,
                parent_link_id: parentLinkId,
                channel: 'email',
                expires_at: getInvitationExpiry(match),
                token_hash: tokenHash,
                status: 'pending',
                volunteer_scorer_response: 'no_response',
                volunteer_linesman_response: 'no_response',
                volunteer_referee_response: 'no_response',
                volunteer_responded_at: null,
                created_by: profile.id,
                created_by_name: normalizeText(profile.display_name || profile.name || profile.email),
                updated_at: new Date().toISOString(),
              }, {
                onConflict: 'match_day_id,player_id,recipient_email,recipient_type,channel',
              })
        const { data: request, error: requestError } = await requestMutation
          .select('*')
          .single()

        if (requestError) {
          throw requestError
        }

        await createMatchDayEventLogEntry(adminSupabase, {
          eventType: 'invite_prepared',
          eventLabel: `${normalizeText(player.player_name) || 'Player'} invite prepared`,
          match,
          metadata: {
            channel: 'email',
            hasParentLink: Boolean(parentLinkId),
            recipientType: contact.type,
            requestId: request.id,
            source: targetedInvitationAction
              ? 'game_day_invited_player_manager'
              : 'send_match_day_availability_requests',
          },
          newValue: {
            status: request.status,
          },
          playerId: player.id,
          profile,
        })

        const responseUrl = `${appOrigin}/.netlify/functions/match-day-availability-confirm?token=${token}`
        const email = buildMatchDayActionableInvitationEmail({
          appOrigin,
          match,
          player,
          recipient: contact,
          responseUrl,
          volunteerTemplates,
        })
        const payload = {
          visibleInEmailQueue: false,
          resendPayload: {
            from: createFromAddress('Football Player'),
            to: [contact.email],
            subject: email.subject,
            html: email.html,
            text: email.text,
          },
          displayName: 'Football Player',
          teamName: resolveMatchDayNotificationTeamName(match),
          clubName: normalizeText(match.clubs?.name),
          playerName: normalizeText(player.player_name),
          parentName: normalizeText(contact.name),
          clubId: match.club_id,
          teamId: match.team_id || null,
          actorId: profile.id,
          actorEmail: normalizeEmail(profile.email),
          actorRole: profile.role || '',
          requiredFeature: 'parentEmails',
          communicationLog: {
            clubId: match.club_id,
            playerId: player.id,
            userId: profile.id,
            userName: normalizeText(profile.display_name || profile.name || profile.email),
            userEmail: normalizeEmail(profile.email),
            recipientEmail: contact.email,
            metadata: {
              type: 'match_day_availability',
              matchDayId: match.id,
              matchDayAvailabilityRequestId: request.id,
              invitationAction: targetedInvitationAction ? invitationAction : 'initial_send',
            },
          },
          matchDayAvailability: {
            matchDayId: match.id,
            requestId: request.id,
            playerId: player.id,
            parentLinkId: parentLinkId || '',
            purpose: 'availability_request_notification',
            rawToken: token,
            tokenHash,
          },
          ...(targetedInvitationAction ? {
            eventPlayerInvitationAction: {
              action: invitationAction,
              idempotencyKey: invitationActionKey,
              playerId: player.id,
              sourceType: 'match-day',
            },
          } : {}),
        }
        const queuedAt = new Date().toISOString()
        const { data: queuedEmail, error: queueError } = await adminSupabase
          .from('scheduled_email_queue')
          .insert({
            club_id: match.club_id,
            team_id: match.team_id || null,
            created_by: profile.id,
            created_by_email: normalizeEmail(profile.email),
            to_email: contact.email,
            subject: email.subject,
            status: 'scheduled',
            scheduled_at: queuedAt,
            payload,
          })
          .select('id')
          .single()

        if (queueError) {
          throw queueError
        }

        lastQueuedAt = queuedAt

        await createMatchDayEventLogEntry(adminSupabase, {
          eventType: 'invite_queued',
          eventLabel: `${normalizeText(player.player_name) || 'Player'} invite queued`,
          match,
          metadata: {
            channel: 'email',
            queueId: queuedEmail.id,
            requestId: request.id,
            source: 'send_match_day_availability_requests',
            invitationAction: targetedInvitationAction ? invitationAction : 'initial_send',
            invitationActionKey: targetedInvitationAction ? invitationActionKey : '',
          },
          newValue: {
            queued: true,
          },
          playerId: player.id,
          profile,
        })

        createdRequests.push(request)
        queuedEmails.push(queuedEmail)
        createdPlayerIds.add(String(player.id))
      }
    }

    const existingPlayerIds = [...duplicatePlayerIds]
      .filter((playerId) => !createdPlayerIds.has(playerId))
    const resolvedPlayerIds = new Set([...createdPlayerIds, ...existingPlayerIds])
    const unresolvedPlayerIds = playerIds
      .map(String)
      .filter((playerId) => !resolvedPlayerIds.has(playerId))

    return json(200, {
      success: true,
      complete: unresolvedPlayerIds.length === 0,
      selectedPlayerCount: playerIds.length,
      createdPlayerCount: createdPlayerIds.size,
      existingPlayerCount: existingPlayerIds.length,
      resolvedPlayerCount: resolvedPlayerIds.size,
      requestCount: createdRequests.length,
      queuedCount: queuedEmails.length,
      sentCount: 0,
      missingContactCount: unresolvedPlayerIds.length,
      missingContacts,
      unresolvedPlayerIds,
      duplicateCount: duplicateQueueCount,
      duplicateQueueCount,
      duplicate: false,
      playerId: targetedInvitationAction ? playerIds[0] : '',
      recipientCount: queuedEmails.length,
      lastSentAt: '',
      queuedAt: targetedInvitationAction ? lastQueuedAt : '',
      requestState: targetedInvitationAction ? 'queued' : '',
      emailConfigured: true,
    })
  } catch (error) {
    console.error(error)
    return json(error.statusCode || 400, {
      success: false,
      message: error.message || 'Availability requests could not be queued.',
    })
  }
}
