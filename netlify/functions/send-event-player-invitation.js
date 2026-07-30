import { createHash, randomBytes } from 'node:crypto'
import { createFromAddress, sendEmail } from './lib/_email-provider.js'
import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import {
  getPlayerInvitationContacts,
  isValidInvitationEmail,
} from './lib/_match-day-actionable-invitation.js'
import { json } from './lib/_stripe-billing.js'
import { createPublicSupabaseClient, createSupabaseAdminClient } from './lib/_supabase.js'
import {
  buildAvailabilityEmail,
  buildOccurrences,
  getPlayerContacts,
  shouldIncludeRecurringSchedule,
} from './process-training-availability-requests.js'
import { handler as sendMatchDayAvailabilityRequests } from './send-match-day-availability-requests.js'

const ACTIONS = new Set(['send', 'resend', 'retry'])
const SOURCE_TYPES = new Set(['calendar', 'match-day'])

function normalizeText(value) {
  return String(value ?? '').trim()
}

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  const [scheme, token] = String(header).split(' ')
  return scheme?.toLowerCase() === 'bearer' ? normalizeText(token) : ''
}

function getAppOrigin(event = {}) {
  const host = event.headers?.['x-forwarded-host'] || event.headers?.host || 'footballplayer.online'
  const protocol = event.headers?.['x-forwarded-proto'] || 'https'
  return `${protocol}://${host}`.replace(/\/$/, '')
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizeText(value))
}

function maskEmail(value) {
  const email = normalizeText(value).toLowerCase()
  const [localPart, domain] = email.split('@')

  if (!localPart || !domain) {
    return 'Eligible recipient'
  }

  return `${localPart.slice(0, 1)}***@${domain}`
}

function createRequestClient(event, token) {
  return createPublicSupabaseClient(event, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  })
}

async function loadRequestAuthority({ adminSupabase, event, sourceType, supabase, token }) {
  if (!token) {
    throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(token)

  if (authError || !authData?.user?.id) {
    throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
  }

  const profile = await loadActiveAuthorityProfile(adminSupabase, authData.user)

  if (
    profile.role === 'parent_portal'
    || profile.role === 'super_admin'
    || Number(profile.role_rank ?? 0) < 20
  ) {
    throw Object.assign(new Error('Authorised team staff access is required.'), { statusCode: 403 })
  }

  let scopedQuery = sourceType === 'match-day'
    ? supabase
        .from('match_days')
        .select('id, club_id, team_id, status, deleted_at')
        .eq('id', event.eventId)
        .is('deleted_at', null)
    : supabase
        .from('calendar_events')
        .select('id, club_id, team_id, event_type, cancelled_at')
        .eq('id', event.eventId)
        .eq('event_type', 'training')
        .is('cancelled_at', null)

  const { data: scopedEvent, error: scopedEventError } = await scopedQuery.maybeSingle()

  if (scopedEventError) {
    throw scopedEventError
  }

  if (
    !scopedEvent?.id
    || !scopedEvent.team_id
    || scopedEvent.club_id !== profile.club_id
  ) {
    throw Object.assign(new Error('This event is outside your active team scope.'), { statusCode: 403 })
  }

  if (
    sourceType === 'match-day'
    && ['cancelled', 'full_time', 'postponed'].includes(normalizeText(scopedEvent.status).toLowerCase())
  ) {
    throw Object.assign(new Error('This fixture is closed for invitation actions.'), { statusCode: 409 })
  }

  return { profile, scopedEvent }
}

async function loadRecipientPreview({
  adminSupabase,
  occurrenceDate,
  playerId,
  scopedEvent,
  sourceType,
}) {
  const playerSelect = sourceType === 'match-day'
    ? 'id, player_name, parent_name, parent_email, parent_contacts, contact_type, status'
    : 'id, player_name, parent_name, parent_email, contact_type, status'
  const playerQuery = adminSupabase
    .from('players')
    .select(playerSelect)
    .eq('id', playerId)
    .eq('club_id', scopedEvent.club_id)
    .eq('team_id', scopedEvent.team_id)
    .neq('status', 'archived')
  const inviteQuery = sourceType === 'match-day'
    ? adminSupabase
        .from('calendar_event_invites')
        .select('id')
        .eq('match_day_id', scopedEvent.id)
    : adminSupabase
        .from('calendar_event_invites')
        .select('id')
        .eq('calendar_event_id', scopedEvent.id)

  const [
    { data: player, error: playerError },
    { data: invite, error: inviteError },
    { data: parentLinks, error: parentLinksError },
  ] = await Promise.all([
    playerQuery.maybeSingle(),
    inviteQuery
      .eq('club_id', scopedEvent.club_id)
      .eq('team_id', scopedEvent.team_id)
      .eq('player_id', playerId)
      .neq('invite_status', 'cancelled')
      .is('cancelled_at', null)
      .maybeSingle(),
    adminSupabase
      .from('parent_player_links')
      .select('id, player_id, email, parent_name, display_name, status')
      .eq('club_id', scopedEvent.club_id)
      .eq('team_id', scopedEvent.team_id)
      .eq('player_id', playerId)
      .eq('status', 'active'),
  ])

  if (playerError || inviteError || parentLinksError) {
    throw playerError || inviteError || parentLinksError
  }

  if (!player?.id || !invite?.id) {
    throw Object.assign(new Error('The active invitation recipient scope could not be verified.'), { statusCode: 409 })
  }

  if (sourceType === 'calendar' && !/^\d{4}-\d{2}-\d{2}$/.test(normalizeText(occurrenceDate))) {
    throw Object.assign(new Error('Choose a training occurrence before previewing this invitation.'), { statusCode: 409 })
  }

  const contacts = sourceType === 'match-day'
    ? getPlayerInvitationContacts(player).filter((contact) => isValidInvitationEmail(contact.email))
    : getPlayerContacts({ parentLinks: parentLinks ?? [], player })

  if (contacts.length === 0) {
    throw Object.assign(new Error('No eligible parent or adult-player recipient is available.'), { statusCode: 409 })
  }

  return {
    playerId,
    recipientCount: contacts.length,
    recipients: contacts.map((contact) => ({
      address: maskEmail(contact.email),
      type: contact.type === 'player' ? 'Adult player' : 'Parent',
    })),
  }
}

async function beginAction({
  action,
  adminSupabase,
  eventId,
  idempotencyKey,
  playerId,
  profile,
  scopedEvent,
  sourceType,
}) {
  const { data, error } = await adminSupabase
    .from('event_player_invitation_actions')
    .insert({
      action,
      actor_id: profile.id,
      club_id: scopedEvent.club_id,
      event_id: eventId,
      idempotency_key: idempotencyKey,
      player_id: playerId,
      source_type: sourceType,
      status: 'processing',
      team_id: scopedEvent.team_id,
    })
    .select('id')
    .single()

  if (error?.code === '23505') {
    const { data: previous, error: previousError } = await adminSupabase
      .from('event_player_invitation_actions')
      .select('id, action, actor_id, club_id, team_id, source_type, event_id, player_id, status, result, failure_detail')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()

    if (previousError) {
      throw previousError
    }

    if (
      previous?.action !== action
      || previous?.actor_id !== profile.id
      || previous?.club_id !== scopedEvent.club_id
      || previous?.team_id !== scopedEvent.team_id
      || previous?.source_type !== sourceType
      || previous?.event_id !== eventId
      || previous?.player_id !== playerId
    ) {
      throw Object.assign(new Error('This idempotency key is already assigned to a different invitation action.'), { statusCode: 409 })
    }

    if (previous?.status === 'failed') {
      throw Object.assign(
        new Error(previous.failure_detail || 'This invitation action previously failed. Start a new retry action.'),
        { statusCode: 409 },
      )
    }

    if (previous?.status === 'processing') {
      throw Object.assign(new Error('This invitation action is already processing.'), { statusCode: 409 })
    }

    return {
      duplicate: true,
      id: previous?.id,
      result: previous?.result || {},
    }
  }

  if (error) {
    throw error
  }

  return { duplicate: false, id: data.id, result: {} }
}

async function finishAction(adminSupabase, actionId, result) {
  const { error } = await adminSupabase
    .from('event_player_invitation_actions')
    .update({
      completed_at: new Date().toISOString(),
      failure_detail: '',
      result,
      status: 'completed',
    })
    .eq('id', actionId)

  if (error) {
    throw error
  }
}

async function failAction(adminSupabase, actionId, error) {
  if (!actionId) {
    return
  }

  await adminSupabase
    .from('event_player_invitation_actions')
    .update({
      completed_at: new Date().toISOString(),
      failure_detail: normalizeText(error?.message) || 'Invitation action failed.',
      status: 'failed',
    })
    .eq('id', actionId)
}

async function sendTrainingInvitation({
  action,
  adminSupabase,
  appOrigin,
  eventId,
  occurrenceDate,
  playerId,
  profile,
  scopedEvent,
}) {
  const [{ data: event, error: eventError }, { data: player, error: playerError }, { data: invite, error: inviteError }] = await Promise.all([
    adminSupabase
      .from('calendar_events')
      .select('id, club_id, team_id, event_type, title, starts_at, ends_at, recurrence_frequency, recurrence_until, location, notes, cancelled_at, teams:team_id(name), clubs:club_id(name, logo_url)')
      .eq('id', eventId)
      .eq('club_id', scopedEvent.club_id)
      .eq('team_id', scopedEvent.team_id)
      .eq('event_type', 'training')
      .is('cancelled_at', null)
      .maybeSingle(),
    adminSupabase
      .from('players')
      .select('id, club_id, team_id, player_name, status, parent_email, contact_type')
      .eq('id', playerId)
      .eq('club_id', scopedEvent.club_id)
      .eq('team_id', scopedEvent.team_id)
      .neq('status', 'archived')
      .maybeSingle(),
    adminSupabase
      .from('calendar_event_invites')
      .select('id, invite_status')
      .eq('calendar_event_id', eventId)
      .eq('club_id', scopedEvent.club_id)
      .eq('team_id', scopedEvent.team_id)
      .eq('player_id', playerId)
      .neq('invite_status', 'cancelled')
      .is('cancelled_at', null)
      .maybeSingle(),
  ])

  if (eventError || playerError || inviteError) {
    throw eventError || playerError || inviteError
  }

  if (!event?.id || !player?.id || !invite?.id) {
    throw Object.assign(new Error('The active training invitation scope could not be verified.'), { statusCode: 409 })
  }

  const occurrences = buildOccurrences(event)
  const occurrence = occurrences.find((candidate) => candidate.occurrenceDate === occurrenceDate)

  if (!occurrence || occurrence.occurrenceStartsAt.getTime() <= Date.now()) {
    throw Object.assign(new Error('Choose a future training occurrence before sending an invitation.'), { statusCode: 409 })
  }

  const { data: setting, error: settingError } = await adminSupabase
    .from('training_availability_settings')
    .select('id, enabled, send_days_before')
    .eq('calendar_event_id', eventId)
    .eq('club_id', scopedEvent.club_id)
    .eq('team_id', scopedEvent.team_id)
    .maybeSingle()

  if (settingError) {
    throw settingError
  }

  if (!setting?.id || setting.enabled !== true) {
    throw Object.assign(new Error('Training Availability must be enabled before sending this invitation.'), { statusCode: 409 })
  }

  const { data: parentLinks, error: parentLinksError } = await adminSupabase
    .from('parent_player_links')
    .select('id, player_id, email, parent_name, display_name')
    .eq('club_id', scopedEvent.club_id)
    .eq('team_id', scopedEvent.team_id)
    .eq('player_id', playerId)
    .eq('status', 'active')

  if (parentLinksError) {
    throw parentLinksError
  }

  const contacts = getPlayerContacts({ parentLinks: parentLinks ?? [], player })

  if (contacts.length === 0) {
    throw Object.assign(new Error('No eligible parent or adult-player recipient is available.'), { statusCode: 409 })
  }

  const { data: existingRequest, error: existingRequestError } = await adminSupabase
    .from('training_availability_requests')
    .select('*')
    .eq('calendar_event_id', eventId)
    .eq('occurrence_date', occurrence.occurrenceDate)
    .maybeSingle()

  if (existingRequestError) {
    throw existingRequestError
  }

  if (!existingRequest?.id && action !== 'send') {
    throw Object.assign(new Error('There is no existing training invitation for this action.'), { statusCode: 409 })
  }

  let request = existingRequest

  if (!request?.id) {
    const { data: insertedRequest, error: requestError } = await adminSupabase
      .from('training_availability_requests')
      .insert({
        calendar_event_id: eventId,
        club_id: scopedEvent.club_id,
        generated_at: new Date().toISOString(),
        occurrence_date: occurrence.occurrenceDate,
        occurrence_ends_at: occurrence.occurrenceEndsAt?.toISOString() || null,
        occurrence_starts_at: occurrence.occurrenceStartsAt.toISOString(),
        send_at: new Date().toISOString(),
        setting_id: setting.id,
        status: 'pending',
        team_id: scopedEvent.team_id,
      })
      .select('*')
      .single()

    if (requestError) {
      throw requestError
    }

    request = insertedRequest
  }

  const recipientContexts = []

  for (const contact of contacts) {
    const { data: existing, error: existingError } = await adminSupabase
      .from('training_availability_request_players')
      .select('*')
      .eq('request_id', request.id)
      .eq('player_id', playerId)
      .eq('recipient_email', contact.email)
      .maybeSingle()

    if (existingError) {
      throw existingError
    }

    recipientContexts.push({ contact, existing })
  }

  if (action === 'send' && recipientContexts.some(({ existing }) => existing?.id)) {
    throw Object.assign(new Error('This player already has a training invitation. Use Resend invitation.'), { statusCode: 409 })
  }

  const actionRecipients = action === 'send'
    ? recipientContexts
    : action === 'resend'
      ? recipientContexts.filter(({ existing }) => existing?.id)
      : recipientContexts.filter(({ existing }) => existing?.id && existing.status === 'failed')

  if (actionRecipients.length === 0) {
    throw Object.assign(
      new Error(
        action === 'retry'
          ? 'This training invitation does not have a failed delivery to retry.'
          : 'There is no existing training invitation for this action.',
      ),
      { statusCode: 409 },
    )
  }

  const { error: requestSendingError } = await adminSupabase
    .from('training_availability_requests')
    .update({
      last_error: null,
      send_at: new Date().toISOString(),
      status: 'sending',
    })
    .eq('id', request.id)

  if (requestSendingError) {
    throw requestSendingError
  }

  const { error: inviteUpdateError } = await adminSupabase
    .from('calendar_event_invites')
    .update({
      notify_requested: true,
      response_requirement: 'response_required',
      training_availability_requested: true,
      updated_at: new Date().toISOString(),
      updated_by: profile.id,
    })
    .eq('id', invite.id)

  if (inviteUpdateError) {
    throw inviteUpdateError
  }

  let failedCount = 0
  let sentCount = 0

  for (const { contact } of actionRecipients) {
    const token = randomBytes(32).toString('hex')
    const { data: requestPlayer, error: requestPlayerError } = await adminSupabase
      .from('training_availability_request_players')
      .upsert({
        calendar_event_id: eventId,
        club_id: scopedEvent.club_id,
        last_error: null,
        parent_link_id: contact.parentLinkId,
        player_id: playerId,
        player_name: player.player_name,
        recipient_email: contact.email,
        recipient_name: contact.name,
        recipient_type: contact.type,
        request_id: request.id,
        status: 'queued',
        team_id: scopedEvent.team_id,
        token_hash: hashToken(token),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'request_id,player_id,recipient_email',
      })
      .select('*')
      .single()

    if (requestPlayerError) {
      throw requestPlayerError
    }

    const responseUrl = `${appOrigin}/.netlify/functions/training-availability-response?token=${token}`
    const email = buildAvailabilityEmail({
      appOrigin,
      event,
      includeRecurringSchedule: shouldIncludeRecurringSchedule({ occurrence, occurrences }),
      occurrence,
      occurrences,
      player,
      recipient: contact,
      responseUrl,
      teamName: event.teams?.name || '',
    })

    try {
      await sendEmail({
        from: createFromAddress('Football Player'),
        to: [contact.email],
        subject: email.subject,
        html: email.html,
      }, {
        context: {
          clubId: scopedEvent.club_id,
          emailType: 'training_availability',
          targetEntityId: requestPlayer.id,
          targetEntityType: 'training_availability_request_player',
          teamId: scopedEvent.team_id,
          userRole: profile.role,
        },
        publicMessage: 'Training availability email could not be sent.',
      })
    } catch (error) {
      await adminSupabase
        .from('training_availability_request_players')
        .update({
          last_error: 'Training availability email could not be sent.',
          status: 'failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', requestPlayer.id)
      console.error('Training availability recipient failed', error)
      failedCount += 1
      continue
    }

    const { error: sentUpdateError } = await adminSupabase
      .from('training_availability_request_players')
      .update({
        email_sent_at: new Date().toISOString(),
        last_error: null,
        status: 'sent',
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestPlayer.id)

    if (sentUpdateError) {
      throw sentUpdateError
    }

    sentCount += 1
  }

  const { error: requestUpdateError } = await adminSupabase
    .from('training_availability_requests')
    .update({
      last_error: failedCount > 0 ? 'Some Training Availability emails could not be sent.' : null,
      sent_at: new Date().toISOString(),
      status: failedCount > 0 ? 'partial_failed' : 'sent',
    })
    .eq('id', request.id)

  if (requestUpdateError) {
    throw requestUpdateError
  }

  const { error: auditError } = await adminSupabase
    .from('audit_logs')
    .insert({
      action: `event_player_invitation_${action}`,
      actor_id: profile.id,
      club_id: scopedEvent.club_id,
      entity_id: eventId,
      entity_type: 'calendar_event',
      metadata: {
        eventId,
        occurrenceDate,
        playerId,
        failedCount,
        recipientCount: sentCount,
        sourceType: 'calendar',
        teamId: scopedEvent.team_id,
      },
    })

  if (auditError) {
    console.warn('Training invitation audit log write failed', { code: auditError.code || 'unknown' })
  }

  return {
    auditLogRecorded: !auditError,
    failedCount,
    playerId,
    queuedCount: 0,
    recipientCount: sentCount + failedCount,
    sentCount,
  }
}

export async function handler(event) {
  let actionId = ''

  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, message: 'Method not allowed.' })
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const action = normalizeText(body.action).toLowerCase()
    const eventId = normalizeText(body.eventId)
    const idempotencyKey = normalizeText(body.idempotencyKey)
    const occurrenceDate = normalizeText(body.occurrenceDate)
    const playerId = normalizeText(body.playerId)
    const preview = body.preview === true
    const sourceType = normalizeText(body.sourceType).toLowerCase()

    if (!ACTIONS.has(action) || !SOURCE_TYPES.has(sourceType)) {
      throw Object.assign(new Error('Choose a supported one-player invitation action.'), { statusCode: 400 })
    }

    if (!isUuid(eventId) || !isUuid(playerId) || !isUuid(idempotencyKey)) {
      throw Object.assign(new Error('A valid event, player, and idempotency key are required.'), { statusCode: 400 })
    }

    const token = getBearerToken(event)
    const supabase = createRequestClient(event, token)
    const adminSupabase = createSupabaseAdminClient(event)
    const { profile, scopedEvent } = await loadRequestAuthority({
      adminSupabase,
      event: { eventId },
      sourceType,
      supabase,
      token,
    })
    const recipientPreview = await loadRecipientPreview({
      adminSupabase,
      occurrenceDate,
      playerId,
      scopedEvent,
      sourceType,
    })

    if (preview) {
      return json(200, {
        ...recipientPreview,
        preview: true,
        success: true,
      })
    }

    const actionCommand = await beginAction({
      action,
      adminSupabase,
      eventId,
      idempotencyKey,
      playerId,
      profile,
      scopedEvent,
      sourceType,
    })
    actionId = actionCommand.id

    if (actionCommand.duplicate) {
      return json(200, {
        ...actionCommand.result,
        duplicate: true,
        success: true,
      })
    }

    let result

    if (sourceType === 'match-day') {
      const delegatedResponse = await sendMatchDayAvailabilityRequests({
        ...event,
        body: JSON.stringify({
          idempotencyKey,
          invitationAction: action,
          matchDayId: eventId,
          playerIds: [playerId],
        }),
      })
      const delegatedResult = JSON.parse(delegatedResponse.body || '{}')

      if (delegatedResponse.statusCode >= 400 || delegatedResult.success === false) {
        throw Object.assign(
          new Error(delegatedResult.message || 'The Match Day invitation action failed.'),
          { statusCode: delegatedResponse.statusCode || 400 },
        )
      }

      result = {
        failedCount: Number(delegatedResult.failedCount ?? 0),
        playerId,
        queuedCount: Number(delegatedResult.queuedCount ?? 0),
        recipientCount: Number(delegatedResult.recipientCount ?? delegatedResult.queuedCount ?? 0),
        sentCount: 0,
      }

      const { error: auditError } = await adminSupabase
        .from('audit_logs')
        .insert({
          action: `event_player_invitation_${action}`,
          actor_id: profile.id,
          club_id: scopedEvent.club_id,
          entity_id: eventId,
          entity_type: 'match_day',
          metadata: {
            eventId,
            idempotencyKey,
            playerId,
            recipientCount: result.recipientCount,
            sourceType,
            teamId: scopedEvent.team_id,
          },
        })

      if (auditError) {
        console.warn('Match Day invitation audit log write failed', { code: auditError.code || 'unknown' })
      }

      result.auditLogRecorded = !auditError
    } else {
      result = await sendTrainingInvitation({
        action,
        adminSupabase,
        appOrigin: getAppOrigin(event),
        eventId,
        occurrenceDate,
        playerId,
        profile,
        scopedEvent,
      })
    }

    await finishAction(adminSupabase, actionId, result)
    return json(200, {
      ...result,
      duplicate: false,
      success: true,
    })
  } catch (error) {
    console.error(error)

    try {
      const adminSupabase = createSupabaseAdminClient(event)
      await failAction(adminSupabase, actionId, error)
    } catch (failureWriteError) {
      console.error(failureWriteError)
    }

    return json(error.statusCode || 400, {
      success: false,
      message: error.message || 'The invitation action could not be completed.',
    })
  }
}
