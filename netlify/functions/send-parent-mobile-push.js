import { sendExpoPushMessages } from './lib/_expo-push.js'
import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { supabaseAdmin } from './lib/_supabase.js'
import { filterParentLinksForAppNotifications } from './lib/_parent-communication-preferences.js'
import { writeParentNotificationInbox } from './lib/_parent-notification-inbox.js'
import { addScopeToNotificationPayload } from './lib/_notification-scope.js'
import {
  getDateInTimeZone,
  isCurrentMatchNotificationReference,
  isCurrentParentPollReference,
  isCurrentTrainingNotificationReference,
} from './lib/_parent-notification-validity.js'

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function failureResponse(statusCode, message) {
  return jsonResponse(statusCode, { success: false, message })
}

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function isMissingTableError(error) {
  const code = String(error?.code ?? '').trim()
  const message = String(error?.message ?? '').toLowerCase()

  return code === '42P01' ||
    code === 'PGRST205' ||
    message.includes('relation') && message.includes('does not exist')
}

async function getAuthUser(event) {
  const token = getBearerToken(event)

  if (!token) {
    throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)

  if (error || !data?.user) {
    throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
  }

  return data.user
}

async function getStaffProfile(authUser) {
  const data = await loadActiveAuthorityProfile(supabaseAdmin, authUser, {
    select: 'id, email, role, role_rank, club_id, status',
  })

  if (!data || normalizeText(data.role) === 'parent_portal' || Number(data.role_rank ?? 0) < 20) {
    throw Object.assign(new Error('Club Coach access is required.'), { statusCode: 403 })
  }

  return {
    clubId: data.club_id,
    id: data.id,
    role: normalizeText(data.role),
    roleRank: Number(data.role_rank ?? 0),
  }
}

async function getMessagePayload({ id, profile }) {
  const { data: log, error } = await supabaseAdmin
    .from('communication_logs')
    .select('id, club_id, player_id, evaluation_id, user_id, user_name, metadata, created_at')
    .eq('id', id)
    .eq('club_id', profile.clubId)
    .eq('channel', 'email')
    .eq('action', 'parent_email_sent')
    .maybeSingle()

  if (error || !log) {
    throw Object.assign(new Error('Parent message could not be found.'), { statusCode: 404 })
  }

  const metadata = log.metadata && typeof log.metadata === 'object' ? log.metadata : {}
  const messageBody = normalizeText(metadata.body)
  const reportId = normalizeText(log.evaluation_id || metadata.evaluationId || metadata.evaluation_id || metadata.reportId || metadata.report_id)
  const calendarEventId = normalizeText(metadata.calendarEventId || metadata.calendar_event_id)
  const matchDayId = normalizeText(metadata.matchDayId || metadata.match_day_id)
  const isClubStaffAnnouncement = normalizeText(metadata.source).toLowerCase() === 'club_announcement'
    && normalizeText(metadata.authorType).toLowerCase() === 'club_staff'
    && Boolean(messageBody)
  if (!isClubStaffAnnouncement && !reportId && !calendarEventId && !matchDayId) {
    throw Object.assign(new Error('This email record has no in-app destination.'), { statusCode: 422 })
  }

  if (isClubStaffAnnouncement) {
    const { data: author, error: authorError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('id', log.user_id)
      .eq('club_id', log.club_id)
      .eq('status', 'active')
      .gte('role_rank', 20)
      .maybeSingle()

    if (authorError || !author) {
      throw Object.assign(new Error('This Club announcement does not have an active staff author.'), { statusCode: 403 })
    }
  }

  const data = isClubStaffAnnouncement ? {
    app: 'parent',
    communicationLogId: log.id,
    roomId: 'club-announcements',
    route: 'chat',
    type: 'parent_message',
  } : reportId ? {
    app: 'parent',
    reportId,
    route: 'development',
    type: 'development_report',
  } : calendarEventId ? {
    app: 'parent',
    calendarEventId,
    route: 'calendar',
    type: 'calendar_update',
  } : {
    app: 'parent',
    matchDayId,
    route: 'matchday',
    type: 'matchday_update',
  }

  return {
    clubId: log.club_id,
    data,
    detailedBody: isClubStaffAnnouncement
      ? 'Your club has shared a new announcement.'
      : reportId
        ? 'A Development report is ready to view.'
        : calendarEventId
          ? 'Calendar information has been updated.'
          : 'Matchday information has been updated.',
    minimalBody: 'You have a new update in Football Player Parents.',
    parentLinkQuery: (query) => query.eq('player_id', log.player_id),
    teamId: null,
    title: 'Football Player Parents',
    type: 'parent_message',
  }
}

async function getPollPayload({ id, profile }) {
  const { data: poll, error } = await supabaseAdmin
    .from('polls')
    .select('id, club_id, team_id, title, description, audience, status, closes_at')
    .eq('id', id)
    .eq('club_id', profile.clubId)
    .eq('audience', 'parents')
    .eq('status', 'open')
    .maybeSingle()

  if (error || !poll) {
    throw Object.assign(new Error('Parent poll could not be found.'), { statusCode: 404 })
  }

  if (!isCurrentParentPollReference(poll)) {
    throw Object.assign(new Error('Parent poll is no longer active.'), { statusCode: 404 })
  }

  return {
    clubId: poll.club_id,
    data: {
      app: 'parent',
      pollId: poll.id,
      route: 'polls',
      type: 'parent_poll',
    },
    detailedBody: 'A Parent poll is ready to view.',
    minimalBody: 'A new poll is available.',
    parentLinkQuery: (query) => poll.team_id ? query.eq('team_id', poll.team_id) : query,
    teamId: poll.team_id || null,
    title: 'Football Player Parents',
    type: 'parent_poll',
  }
}

async function getResourcePayload({ id, profile }) {
  const { data: notification, error } = await supabaseAdmin
    .from('resource_library_parent_notifications')
    .select('id, club_id, team_id, resource_id, parent_link_id')
    .eq('id', id)
    .eq('club_id', profile.clubId)
    .maybeSingle()

  if (error || !notification?.parent_link_id || !notification?.resource_id) {
    throw Object.assign(new Error('Shared resource could not be found.'), { statusCode: 404 })
  }

  const { data: resource, error: resourceError } = await supabaseAdmin
    .from('resource_library_items')
    .select('id, club_id, team_id, title, archived_at')
    .eq('id', notification.resource_id)
    .eq('club_id', notification.club_id)
    .maybeSingle()

  if (resourceError || !resource || resource.archived_at || resource.team_id !== notification.team_id) {
    throw Object.assign(new Error('Shared resource is no longer available.'), { statusCode: 404 })
  }

  return {
    clubId: notification.club_id,
    data: {
      app: 'parent',
      notificationId: notification.id,
      parentLinkId: notification.parent_link_id,
      resourceId: notification.resource_id,
      route: 'resources',
      type: 'resource_shared',
    },
    detailedBody: `${normalizeText(resource.title) || 'A resource'} is ready to view.`,
    minimalBody: 'Your club has shared a new resource.',
    parentLinkQuery: (query) => query.eq('id', notification.parent_link_id),
    teamId: notification.team_id || null,
    title: 'New resource shared',
    type: 'resource_shared',
  }
}

async function getMatchDayAvailabilityPayload({ id, profile }) {
  const { data: request, error } = await supabaseAdmin
    .from('match_day_availability_requests')
    .select('id, club_id, team_id, match_day_id, parent_link_id, status, expires_at, token_revoked_at')
    .eq('id', id)
    .eq('club_id', profile.clubId)
    .maybeSingle()

  if (error || !request || !request.parent_link_id || request.token_revoked_at) {
    throw Object.assign(new Error('Availability request could not be found.'), { statusCode: 404 })
  }

  const { data: match, error: matchError } = await supabaseAdmin
    .from('match_days')
    .select('id, club_id, team_id, opponent, match_date, status, deleted_at')
    .eq('id', request.match_day_id)
    .eq('club_id', request.club_id)
    .maybeSingle()

  if (matchError || !match || match.team_id !== request.team_id) {
    throw Object.assign(new Error('Availability request match could not be found.'), { statusCode: 404 })
  }

  if (!isCurrentMatchNotificationReference({ ...request, match_days: match }, request.parent_link_id, Date.now(), getDateInTimeZone())) {
    throw Object.assign(new Error('Availability request is no longer active.'), { statusCode: 404 })
  }

  const matchDate = match.match_date
    ? new Date(`${match.match_date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : 'the upcoming match'
  const opponent = normalizeText(match.opponent) || 'the opposition'

  return {
    clubId: request.club_id,
    data: {
      app: 'parent',
      availabilityRequestId: request.id,
      invitationId: `match:${request.id}`,
      matchDayId: request.match_day_id,
      parentLinkId: request.parent_link_id,
      route: 'invites',
      type: 'matchday_availability',
    },
    categoryId: 'parent-response',
    detailedBody: `Please confirm availability for the match against ${opponent} on ${matchDate}.`,
    minimalBody: 'Your club needs an availability response for an upcoming match.',
    parentLinkQuery: (query) => query.eq('id', request.parent_link_id),
    teamId: request.team_id || null,
    title: 'Availability requested',
    type: 'matchday_update',
  }
}

async function getTrainingAvailabilityPayload({ id, profile }) {
  const { data: requestPlayer, error } = await supabaseAdmin
    .from('training_availability_request_players')
    .select('id, request_id, club_id, team_id, calendar_event_id, parent_link_id, recipient_type, status, response_deadline_at, token_revoked_at')
    .eq('id', id)
    .eq('club_id', profile.clubId)
    .maybeSingle()

  if (
    error
    || !requestPlayer
    || !requestPlayer.parent_link_id
    || requestPlayer.recipient_type !== 'parent'
    || ['cancelled', 'expired'].includes(requestPlayer.status)
  ) {
    throw Object.assign(new Error('Training availability request could not be found.'), { statusCode: 404 })
  }

  const [{ data: request, error: requestError }, { data: event, error: eventError }] = await Promise.all([
    supabaseAdmin
      .from('training_availability_requests')
      .select('id, status, occurrence_starts_at')
      .eq('id', requestPlayer.request_id)
      .eq('club_id', requestPlayer.club_id)
      .maybeSingle(),
    supabaseAdmin
      .from('calendar_events')
      .select('id, title, starts_at, cancelled_at')
      .eq('id', requestPlayer.calendar_event_id)
      .eq('club_id', requestPlayer.club_id)
      .maybeSingle(),
  ])

  if (requestError || eventError || !request || !event || request.status === 'cancelled' || event.cancelled_at) {
    throw Object.assign(new Error('Training availability request is no longer active.'), { statusCode: 404 })
  }

  if (!isCurrentTrainingNotificationReference({ ...requestPlayer, training_availability_requests: request }, requestPlayer.parent_link_id)) {
    throw Object.assign(new Error('Training availability request is no longer active.'), { statusCode: 404 })
  }

  const startsAt = request.occurrence_starts_at || event.starts_at
  const trainingDate = startsAt
    ? new Date(startsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : 'the upcoming session'
  const title = normalizeText(event.title) || 'Training'

  return {
    clubId: requestPlayer.club_id,
    data: {
      app: 'parent',
      invitationId: `training_attendance:${requestPlayer.id}`,
      parentLinkId: requestPlayer.parent_link_id,
      route: 'invites',
      trainingRequestPlayerId: requestPlayer.id,
      type: 'training_availability',
    },
    categoryId: 'parent-response',
    detailedBody: `Please confirm attendance for ${title} on ${trainingDate}.`,
    minimalBody: 'Your club needs an attendance response for an upcoming training session.',
    parentLinkQuery: (query) => query.eq('id', requestPlayer.parent_link_id),
    teamId: requestPlayer.team_id || null,
    title: 'Training response requested',
    type: 'training_update',
  }
}

async function getTargetParentLinks(payload) {
  let query = supabaseAdmin
    .from('parent_player_links')
    .select('id, auth_user_id, club_id, team_id')
    .eq('club_id', payload.clubId)
    .eq('status', 'active')

  query = payload.parentLinkQuery(query)
  const { data, error } = await query

  if (error) {
    if (isMissingTableError(error)) {
      console.warn('Mobile push devices table is not available; skipping native parent push.')
      return []
    }

    throw error
  }

  return filterParentLinksForAppNotifications(supabaseAdmin, data ?? [])
}

async function getMobileDevices({ parentLinks }) {
  if (parentLinks.length === 0) {
    return []
  }

  const linksByAuthUser = new Map()
  for (const link of parentLinks) {
    const authUserId = normalizeText(link.auth_user_id)
    if (!authUserId) continue
    const links = linksByAuthUser.get(authUserId) || []
    links.push(link)
    linksByAuthUser.set(authUserId, links)
  }

  const authUserIds = [...linksByAuthUser.keys()]
  if (authUserIds.length === 0) return []

  const { data, error } = await supabaseAdmin
    .from('parent_mobile_push_installations')
    .select('installation_id, auth_user_id, expo_push_token, parent_link_id, detail_level')
    .eq('status', 'active')
    .eq('enabled', true)
    .neq('detail_level', 'off')
    .in('auth_user_id', authUserIds)

  if (error) {
    if (isMissingTableError(error)) {
      console.warn('Mobile push devices table is not available; skipping native parent push.')
      return []
    }

    throw error
  }

  return (data ?? []).flatMap((device) => {
    const links = linksByAuthUser.get(normalizeText(device.auth_user_id)) || []
    const targetLink = links.find((link) => link.id === device.parent_link_id) || links[0]
    return targetLink ? [{ ...device, parent_link_id: targetLink.id }] : []
  })
}

async function revokeMobileDeviceTokens(deviceTokens) {
  const tokens = [...new Set(deviceTokens.map(normalizeText).filter(Boolean))]

  if (tokens.length === 0) {
    return
  }

  const { error } = await supabaseAdmin
    .from('parent_mobile_push_installations')
    .update({
      auth_user_id: null,
      parent_link_id: null,
      club_id: null,
      team_id: null,
      expo_push_token: null,
      enabled: false,
      status: 'revoked',
      updated_at: new Date().toISOString(),
    })
    .in('expo_push_token', tokens)

  if (error) {
    if (isMissingTableError(error)) {
      console.warn('Mobile push devices table is not available; skipping invalid token revocation.')
      return
    }

    console.error('Parent mobile push device revoke failed', error)
  }
}

export async function sendParentMobilePushById({ id, profile, type }) {
  const basePayload = type === 'parent_message'
    ? await getMessagePayload({ id, profile })
    : type === 'resource_shared'
      ? await getResourcePayload({ id, profile })
    : type === 'matchday_availability'
      ? await getMatchDayAvailabilityPayload({ id, profile })
      : type === 'training_availability'
        ? await getTrainingAvailabilityPayload({ id, profile })
      : await getPollPayload({ id, profile })
  const payload = await addScopeToNotificationPayload(supabaseAdmin, basePayload)
  const parentLinks = await getTargetParentLinks(payload)
  const devices = await getMobileDevices({
    parentLinks,
  })
  const inboxResult = await writeParentNotificationInbox({
    body: payload.minimalBody,
    client: supabaseAdmin,
    clubId: payload.clubId,
    data: payload.data,
    intentType: payload.type,
    parentLinks,
    teamId: payload.teamId,
    title: payload.title,
  })
  const pushResult = await sendExpoPushMessages(devices.map((device) => ({
    body: device.detail_level === 'detailed' ? payload.detailedBody : payload.minimalBody,
    ...(payload.categoryId ? { categoryId: payload.categoryId } : {}),
    data: {
      ...payload.data,
      parentLinkId: payload.data.parentLinkId || device.parent_link_id,
    },
    sound: 'default',
    title: payload.title,
    to: device.expo_push_token,
  })))
  await revokeMobileDeviceTokens(pushResult.invalidTokens || [])

  return {
    failed: pushResult.failed,
    inbox: inboxResult.available,
    parentLinks: parentLinks.length,
    sent: pushResult.sent,
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  try {
    const authUser = await getAuthUser(event)
    const profile = await getStaffProfile(authUser)
    const body = JSON.parse(event.body || '{}')
    const type = normalizeText(body.type)
    const id = normalizeText(body.id)

    if (!id || !['matchday_availability', 'parent_message', 'parent_poll', 'resource_shared', 'training_availability'].includes(type)) {
      return failureResponse(400, 'A valid parent notification type and id are required.')
    }

    const pushResult = await sendParentMobilePushById({ id, profile, type })

    return jsonResponse(200, {
      ...pushResult,
      success: true,
    })
  } catch (error) {
    console.error(error)
    return failureResponse(error.statusCode || 500, error.message || 'Parent notifications could not be sent.')
  }
}
