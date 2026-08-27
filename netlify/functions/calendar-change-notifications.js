import process from 'node:process'
import webpush from 'web-push'
import { randomUUID } from 'node:crypto'
import {
  buildCalendarNotificationHtml,
  buildCalendarNotificationLocalDateTime,
  CALENDAR_NOTIFICATION_PARENT_PORTAL_URL,
  formatCalendarNotificationDateTime,
} from '../../src/lib/calendar-notification-email.js'
import { resolveTeamNotificationDisplayName } from '../../src/lib/team-notification-display.js'
import { loadActiveAuthorityProfile } from './lib/_authority-profile.js'
import { createFromAddress, sendEmail } from './lib/_email-provider.js'
import { sendExpoPushMessages } from './lib/_expo-push.js'
import { buildScopedNotificationTitle } from './lib/_notification-scope.js'
import { getParentCommunicationChannels, allowsParentAppNotifications, allowsParentEmail } from './lib/_parent-communication-preferences.js'
import { writeParentNotificationInbox } from './lib/_parent-notification-inbox.js'
import { supabaseAdmin } from './lib/_supabase.js'

const SOURCE_TYPES = new Set(['calendar', 'match-day', 'session', 'assessment-reminder'])
const CHANGE_ACTIONS = new Set(['rescheduled', 'cancelled', 'deleted'])

function normalizeText(value) {
  return String(value ?? '').trim()
}

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

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizeText(value))
}

function relation(value) {
  return Array.isArray(value) ? value[0] : value
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeText).filter(Boolean))]
}

async function getAuthUser(event) {
  const token = getBearerToken(event)
  if (!token) throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
  return data.user
}

async function getStaffProfile(authUser) {
  const profile = await loadActiveAuthorityProfile(supabaseAdmin, authUser, {
    select: 'id, email, display_name, name, role, role_rank, club_id, status',
  })
  if (!profile || normalizeText(profile.role) === 'parent_portal' || Number(profile.role_rank || 0) < 20) {
    throw Object.assign(new Error('Coach or manager access is required.'), { statusCode: 403 })
  }
  return {
    clubId: normalizeText(profile.club_id),
    displayName: normalizeText(profile.display_name || profile.name || profile.email),
    id: normalizeText(profile.id),
    roleRank: Number(profile.role_rank || 0),
  }
}

async function assertTeamAuthority(profile, teamId) {
  const normalizedTeamId = normalizeText(teamId)
  if (profile.roleRank >= 50) return
  if (!normalizedTeamId) {
    throw Object.assign(new Error('Club-wide Calendar changes require Club Admin access.'), { statusCode: 403 })
  }
  const { data, error } = await supabaseAdmin
    .from('team_staff')
    .select('team_id')
    .eq('team_id', normalizedTeamId)
    .eq('user_id', profile.id)
    .maybeSingle()
  if (error || !data) {
    throw Object.assign(new Error('You cannot change this Team Calendar item.'), { statusCode: 403 })
  }
}

async function maybeSingle(query, message) {
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data && message) throw Object.assign(new Error(message), { statusCode: 404 })
  return data
}

async function loadSource(sourceType, sourceId, clubId, { required = true } = {}) {
  if (sourceType === 'calendar') {
    return maybeSingle(
      supabaseAdmin.from('calendar_events')
        .select('id, club_id, team_id, event_type, title, starts_at, ends_at, location, notes, parent_visible, parent_audience, cancelled_at, updated_at')
        .eq('id', sourceId).eq('club_id', clubId),
      required ? 'Calendar event could not be found.' : '',
    )
  }
  if (sourceType === 'match-day') {
    return maybeSingle(
      supabaseAdmin.from('match_days')
        .select('id, club_id, team_id, opponent, match_date, kickoff_time, kickoff_time_tbc, venue_name, notes, parent_visible, parent_audience, status, deleted_at, updated_at')
        .eq('id', sourceId).eq('club_id', clubId),
      required ? 'Match Day fixture could not be found.' : '',
    )
  }
  if (sourceType === 'session') {
    return maybeSingle(
      supabaseAdmin.from('assessment_sessions')
        .select('id, club_id, team_id, team, opponent, session_type, session_date, start_time, end_time, location, notes, title, status, updated_at')
        .eq('id', sourceId).eq('club_id', clubId),
      required ? 'Session could not be found.' : '',
    )
  }
  return maybeSingle(
    supabaseAdmin.from('communication_logs')
      .select('id, club_id, player_id, evaluation_id, metadata, created_at')
      .eq('id', sourceId).eq('club_id', clubId)
      .eq('channel', 'reminder').eq('action', 'next_assessment_reminder_set'),
    required ? 'Development reminder could not be found.' : '',
  )
}

async function getPlayerTeam(playerId, clubId) {
  if (!playerId) return null
  return maybeSingle(
    supabaseAdmin.from('players').select('id, team_id, player_name').eq('id', playerId).eq('club_id', clubId),
    '',
  )
}

async function getParentLinkIdsForPlayers(clubId, playerIds) {
  const ids = unique(playerIds)
  if (ids.length === 0) return []
  const { data, error } = await supabaseAdmin.from('parent_player_links')
    .select('id').eq('club_id', clubId).eq('status', 'active').in('player_id', ids)
  if (error) throw error
  return unique((data || []).map((row) => row.id))
}

async function getParentLinkIdsForScope({ clubId, source, sourceId, sourceType, teamId }) {
  if (sourceType === 'assessment-reminder') {
    return getParentLinkIdsForPlayers(clubId, [source.player_id])
  }

  const audience = normalizeText(source.parent_audience)
  if (audience === 'all_club_parents') {
    const { data, error } = await supabaseAdmin.from('parent_player_links')
      .select('id').eq('club_id', clubId).eq('status', 'active')
    if (error) throw error
    return unique((data || []).map((row) => row.id))
  }
  if (audience === 'all_team_parents') {
    const { data, error } = await supabaseAdmin.from('parent_player_links')
      .select('id').eq('club_id', clubId).eq('team_id', teamId).eq('status', 'active')
    if (error) throw error
    return unique((data || []).map((row) => row.id))
  }

  if (sourceType === 'calendar' || sourceType === 'session') {
    const column = sourceType === 'calendar' ? 'calendar_event_id' : 'assessment_session_id'
    const { data, error } = await supabaseAdmin.from('calendar_event_invites')
      .select('parent_link_id, player_id').eq('club_id', clubId).eq(column, sourceId).neq('invite_status', 'cancelled')
    if (error) throw error
    const directIds = unique((data || []).map((row) => row.parent_link_id))
    const fallbackIds = await getParentLinkIdsForPlayers(clubId, (data || []).map((row) => row.player_id))
    if (sourceType === 'session') {
      const { data: sessionPlayers, error: playerError } = await supabaseAdmin.from('assessment_session_players')
        .select('player_id').eq('session_id', sourceId)
      if (playerError) throw playerError
      return unique([...directIds, ...fallbackIds, ...await getParentLinkIdsForPlayers(clubId, (sessionPlayers || []).map((row) => row.player_id))])
    }
    return unique([...directIds, ...fallbackIds])
  }

  const { data, error } = await supabaseAdmin.from('match_day_availability_requests')
    .select('parent_link_id, player_id').eq('club_id', clubId).eq('match_day_id', sourceId)
  if (error) throw error
  return unique([
    ...(data || []).map((row) => row.parent_link_id),
    ...await getParentLinkIdsForPlayers(clubId, (data || []).map((row) => row.player_id)),
  ])
}

function sourceScheduleKey(sourceType, source) {
  if (!source) return ''
  if (sourceType === 'calendar') return `${source.starts_at || ''}|${source.ends_at || ''}`
  if (sourceType === 'match-day') return `${source.match_date || ''}|${source.kickoff_time || ''}|${source.kickoff_time_tbc === true}`
  if (sourceType === 'session') return `${source.session_date || ''}|${source.start_time || ''}|${source.end_time || ''}`
  return normalizeText(source.metadata?.dueDate)
}

async function verifyChange(preparation) {
  const sourceType = preparation.source_type
  const sourceId = preparation.source_id
  const current = await loadSource(sourceType, sourceId, preparation.club_id, { required: false })
  const action = preparation.change_action

  if (action === 'deleted') return { changed: !current || sourceType === 'match-day' && Boolean(current?.deleted_at), current }
  if (action === 'cancelled') {
    const changed = sourceType === 'calendar'
      ? Boolean(current?.cancelled_at)
      : sourceType === 'match-day'
        ? normalizeText(current?.status) === 'cancelled' || Boolean(current?.deleted_at)
        : sourceType === 'session'
          ? normalizeText(current?.status) === 'cancelled'
          : false
    return { changed, current }
  }
  if (sourceType === 'assessment-reminder') {
    const { data, error } = await supabaseAdmin.from('communication_logs')
      .select('id, club_id, player_id, evaluation_id, metadata, created_at')
      .eq('club_id', preparation.club_id)
      .eq('channel', 'reminder')
      .eq('action', 'next_assessment_reminder_set')
      .eq('metadata->>rescheduledFromReminderId', sourceId)
      .order('created_at', { ascending: false }).limit(1)
    if (error) throw error
    return { changed: Boolean(data?.[0]), current: data?.[0] || current }
  }
  return {
    changed: Boolean(current) && sourceScheduleKey(sourceType, current) !== sourceScheduleKey(sourceType, preparation.source_snapshot),
    current,
  }
}

function getSourcePresentation(sourceType, source) {
  if (sourceType === 'calendar') {
    return { endsAt: source.ends_at, eventType: source.event_type || 'Event', location: source.location, notes: source.notes, startsAt: source.starts_at, title: source.title || 'Calendar event' }
  }
  if (sourceType === 'match-day') {
    const startsAt = source.kickoff_time_tbc || !source.kickoff_time
      ? source.match_date
      : buildCalendarNotificationLocalDateTime(source.match_date, source.kickoff_time)
    return { endsAt: '', eventType: 'Match', location: source.venue_name, notes: source.notes, startsAt, title: `Match vs ${normalizeText(source.opponent) || 'Opponent'}` }
  }
  if (sourceType === 'session') {
    const startsAt = source.start_time
      ? buildCalendarNotificationLocalDateTime(source.session_date, source.start_time)
      : source.session_date
    return { endsAt: '', eventType: source.session_type || 'Session', location: source.location, notes: source.notes, startsAt, title: source.title || 'Session' }
  }
  return { endsAt: '', eventType: 'Development review', location: '', notes: '', startsAt: source.metadata?.dueDate || '', title: 'Development review' }
}

function getChangeCopy(action, presentation) {
  const label = action === 'rescheduled' ? 'Event rescheduled' : action === 'cancelled' ? 'Event cancelled' : 'Event removed'
  const date = action === 'rescheduled' ? ` New time: ${formatCalendarNotificationDateTime(presentation.startsAt)}.` : ''
  return {
    body: `${presentation.title} was ${action === 'deleted' ? 'removed' : action}.${date}`,
    label,
  }
}

function configureWebPush() {
  const publicKey = normalizeText(process.env.VITE_WEB_PUSH_PUBLIC_KEY || process.env.WEB_PUSH_PUBLIC_KEY)
  const privateKey = normalizeText(process.env.WEB_PUSH_PRIVATE_KEY)
  if (!publicKey || !privateKey) return false
  webpush.setVapidDetails(normalizeText(process.env.WEB_PUSH_SUBJECT) || 'mailto:support@footballplayer.online', publicKey, privateKey)
  return true
}

async function sendWebPush(subscription, payload) {
  try {
    await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { auth: subscription.auth, p256dh: subscription.p256dh } }, JSON.stringify(payload))
    return { sent: true }
  } catch (error) {
    if ([404, 410].includes(error.statusCode)) {
      await supabaseAdmin.from('parent_push_subscriptions').update({ status: 'revoked', updated_at: new Date().toISOString() }).eq('id', subscription.id)
      return { revoked: true, sent: false }
    }
    console.error('Calendar change web push failed', error)
    return { sent: false }
  }
}

async function deliverPreparation(preparation, currentSource) {
  const parentLinkIds = unique(preparation.parent_link_ids)
  if (parentLinkIds.length === 0) return { emailFailed: 0, emailSent: 0, inbox: 0, mobileFailed: 0, mobileSent: 0, recipientCount: 0, webSent: 0 }

  const [{ data: links, error: linksError }, { data: club, error: clubError }] = await Promise.all([
    supabaseAdmin.from('parent_player_links')
      .select('id, auth_user_id, club_id, team_id, player_id, email, status, players:player_id(player_name)')
      .eq('club_id', preparation.club_id).eq('status', 'active').in('id', parentLinkIds),
    supabaseAdmin.from('clubs').select('id, name, logo_url, theme_accent').eq('id', preparation.club_id).maybeSingle(),
  ])
  if (linksError) throw linksError
  if (clubError || !club) throw clubError || new Error('Club branding could not be loaded.')
  const team = preparation.team_id
    ? await maybeSingle(supabaseAdmin.from('teams').select('id, name, notification_display_name').eq('id', preparation.team_id).eq('club_id', preparation.club_id), '')
    : null
  const authUserIds = unique((links || []).map((link) => link.auth_user_id))
  const [{ data: parents, error: parentsError }, channels] = await Promise.all([
    authUserIds.length > 0
      ? supabaseAdmin.from('users').select('id, display_name, name, email, status').in('id', authUserIds)
      : Promise.resolve({ data: [], error: null }),
    getParentCommunicationChannels(supabaseAdmin, authUserIds),
  ])
  if (parentsError) throw parentsError
  const parentById = new Map((parents || []).map((parent) => [normalizeText(parent.id), parent]))
  const eligibleLinks = (links || []).filter((link) => {
    if (!link.auth_user_id) return Boolean(normalizeText(link.email))
    const parent = parentById.get(normalizeText(link.auth_user_id))
    return normalizeText(parent?.status || 'active') === 'active'
  })
  const appLinks = eligibleLinks.filter((link) => link.auth_user_id && allowsParentAppNotifications(channels.get(normalizeText(link.auth_user_id)) || 'both'))
  const emailLinks = eligibleLinks.filter((link) => allowsParentEmail(channels.get(normalizeText(link.auth_user_id)) || 'both') && normalizeText(link.email))
  const appAuthIds = unique(appLinks.map((link) => link.auth_user_id))
  const [{ data: devices, error: devicesError }, { data: subscriptions, error: subscriptionsError }] = await Promise.all([
    appAuthIds.length > 0
      ? supabaseAdmin.from('parent_mobile_push_installations')
        .select('installation_id, auth_user_id, expo_push_token, parent_link_id, detail_level')
        .eq('status', 'active').eq('enabled', true).neq('detail_level', 'off').in('auth_user_id', appAuthIds)
      : Promise.resolve({ data: [], error: null }),
    appLinks.length > 0
      ? supabaseAdmin.from('parent_push_subscriptions')
        .select('id, parent_link_id, endpoint, p256dh, auth').eq('status', 'active').in('parent_link_id', appLinks.map((link) => link.id))
      : Promise.resolve({ data: [], error: null }),
  ])
  if (devicesError && !['42P01', 'PGRST205'].includes(normalizeText(devicesError.code))) throw devicesError
  if (subscriptionsError) throw subscriptionsError

  const source = currentSource || preparation.source_snapshot
  const presentation = getSourcePresentation(preparation.source_type, source)
  const copy = getChangeCopy(preparation.change_action, presentation)
  const notificationTeamName = resolveTeamNotificationDisplayName(team || {}, team?.name || '')
  const title = buildScopedNotificationTitle(copy.label, { clubName: club.name, teamName: notificationTeamName })
  const notificationData = {
    app: 'parent',
    calendarChangeId: preparation.id,
    eventId: preparation.change_action === 'deleted' ? '' : preparation.source_id,
    route: 'calendar',
    sourceId: preparation.source_id,
    sourceType: preparation.source_type,
    teamId: preparation.team_id || '',
    type: 'calendar_change',
  }
  const inbox = await writeParentNotificationInbox({ body: copy.body, client: supabaseAdmin, clubId: preparation.club_id, data: notificationData, intentType: 'calendar_update', parentLinks: appLinks, teamId: preparation.team_id, title })
  const linkByAuth = new Map()
  for (const link of appLinks) {
    const rows = linkByAuth.get(link.auth_user_id) || []
    rows.push(link)
    linkByAuth.set(link.auth_user_id, rows)
  }
  const mobileMessages = (devices || []).flatMap((device) => {
    const deviceLinks = linkByAuth.get(device.auth_user_id) || []
    const link = deviceLinks.find((item) => item.id === device.parent_link_id) || deviceLinks[0]
    return link ? [{ to: device.expo_push_token, title, body: copy.body, data: { ...notificationData, parentLinkId: link.id }, sound: 'default' }] : []
  })
  const mobile = await sendExpoPushMessages(mobileMessages)
  if (mobile.invalidTokens?.length) {
    await supabaseAdmin.from('parent_mobile_push_installations').update({ enabled: false, expo_push_token: null, status: 'revoked', updated_at: new Date().toISOString() }).in('expo_push_token', mobile.invalidTokens)
  }
  const webPayload = { badge: '/icons/favicon-48.png', body: copy.body, icon: '/icons/icon-192.png', tag: `calendar-change-${preparation.id}`, title, url: '/parent-portal?section=calendar' }
  const webResults = configureWebPush() ? await Promise.all((subscriptions || []).map((subscription) => sendWebPush(subscription, webPayload))) : []

  const emailTargets = [...new Map(emailLinks.map((link) => [normalizeText(link.email).toLowerCase(), link])).values()]
  const emailResults = await Promise.allSettled(emailTargets.map(async (link) => {
    const parent = parentById.get(normalizeText(link.auth_user_id))
    const player = relation(link.players)
    const html = buildCalendarNotificationHtml({
      action: preparation.change_action,
      clubLogoUrl: club.logo_url,
      clubName: club.name,
      endsAt: presentation.endsAt,
      eventTitle: presentation.title,
      eventType: presentation.eventType,
      location: presentation.location,
      notes: presentation.notes,
      parentName: parent?.display_name || parent?.name || 'Parent or guardian',
      playerName: player?.player_name || 'your child',
      portalUrl: CALENDAR_NOTIFICATION_PARENT_PORTAL_URL,
      startsAt: presentation.startsAt,
      teamName: notificationTeamName || club.name,
      themeAccent: club.theme_accent,
    })
    return sendEmail({ from: createFromAddress(club.name), html, subject: `${club.name}: ${copy.label}`, to: [link.email] }, {
      context: { actorId: preparation.actor_user_id, clubId: preparation.club_id, emailType: 'calendar_change', targetEntityId: preparation.source_id, targetEntityType: preparation.source_type, teamId: preparation.team_id },
      idempotencyKey: `calendar-change/${preparation.id}/${link.id}`,
    })
  }))
  return {
    emailFailed: emailResults.filter((result) => result.status === 'rejected').length,
    emailSent: emailResults.filter((result) => result.status === 'fulfilled').length,
    inbox: inbox.inserted,
    mobileFailed: mobile.failed,
    mobileSent: mobile.sent,
    recipientCount: eligibleLinks.length,
    webSent: webResults.filter((result) => result.sent).length,
  }
}

async function prepareNotification(profile, body) {
  const sourceType = normalizeText(body.sourceType).toLowerCase()
  const sourceId = normalizeText(body.sourceId)
  const changeAction = normalizeText(body.changeAction).toLowerCase()
  const requestToken = normalizeText(body.requestToken) || randomUUID()
  if (!SOURCE_TYPES.has(sourceType) || !isUuid(sourceId) || !CHANGE_ACTIONS.has(changeAction) || !isUuid(requestToken)) {
    throw Object.assign(new Error('Choose a valid Calendar change before notifying people.'), { statusCode: 400 })
  }
  let source = await loadSource(sourceType, sourceId, profile.clubId)
  let teamId = normalizeText(source.team_id)
  if (sourceType === 'assessment-reminder') {
    const player = await getPlayerTeam(source.player_id, profile.clubId)
    teamId = normalizeText(player?.team_id)
    source = { ...source, player_name: player?.player_name || '' }
  }
  await assertTeamAuthority(profile, teamId)
  const parentLinkIds = await getParentLinkIdsForScope({ clubId: profile.clubId, source, sourceId, sourceType, teamId })
  const row = {
    actor_user_id: profile.id,
    change_action: changeAction,
    club_id: profile.clubId,
    parent_link_ids: parentLinkIds,
    request_token: requestToken,
    source_id: sourceId,
    source_snapshot: source,
    source_type: sourceType,
    status: 'prepared',
    team_id: teamId || null,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabaseAdmin.from('calendar_change_notification_preparations')
    .upsert(row, { ignoreDuplicates: true, onConflict: 'actor_user_id,request_token' })
    .select('*').maybeSingle()
  if (error) throw error
  const preparation = data || await maybeSingle(
    supabaseAdmin.from('calendar_change_notification_preparations').select('*').eq('actor_user_id', profile.id).eq('request_token', requestToken),
    'Notification choice could not be prepared.',
  )
  return jsonResponse(200, { preparationId: preparation.id, recipientCount: preparation.parent_link_ids?.length || 0, success: true })
}

async function commitNotification(profile, body) {
  const preparationId = normalizeText(body.preparationId)
  if (!isUuid(preparationId)) throw Object.assign(new Error('Notification preparation is required.'), { statusCode: 400 })
  const preparation = await maybeSingle(
    supabaseAdmin.from('calendar_change_notification_preparations').select('*').eq('id', preparationId).eq('actor_user_id', profile.id).eq('club_id', profile.clubId),
    'Notification preparation could not be found.',
  )
  if (preparation.status === 'committed') return jsonResponse(200, { ...preparation.delivery_result, duplicate: true, success: true })
  if (preparation.status !== 'prepared' || new Date(preparation.expires_at).getTime() <= Date.now()) {
    throw Object.assign(new Error('The notification choice expired. The Calendar change was not notified.'), { statusCode: 409 })
  }
  const verification = await verifyChange(preparation)
  if (!verification.changed) {
    throw Object.assign(new Error('The Calendar change was not confirmed, so nobody was notified.'), { statusCode: 409 })
  }
  const { data: claimed, error: claimError } = await supabaseAdmin.from('calendar_change_notification_preparations')
    .update({ status: 'committing', updated_at: new Date().toISOString() }).eq('id', preparation.id).eq('status', 'prepared').select('*').maybeSingle()
  if (claimError) throw claimError
  if (!claimed) {
    const latest = await maybeSingle(supabaseAdmin.from('calendar_change_notification_preparations').select('*').eq('id', preparation.id), '')
    if (latest?.status === 'committed') return jsonResponse(200, { ...latest.delivery_result, duplicate: true, success: true })
    throw Object.assign(new Error('Notification delivery is already being processed.'), { statusCode: 409 })
  }
  try {
    const result = await deliverPreparation(claimed, verification.current)
    await supabaseAdmin.from('calendar_change_notification_preparations').update({ committed_at: new Date().toISOString(), delivery_result: result, status: 'committed', updated_at: new Date().toISOString() }).eq('id', claimed.id).eq('status', 'committing')
    return jsonResponse(200, { ...result, success: true })
  } catch (error) {
    await supabaseAdmin.from('calendar_change_notification_preparations').update({ delivery_result: { error: normalizeText(error.message) }, status: 'failed', updated_at: new Date().toISOString() }).eq('id', claimed.id)
    throw error
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return failureResponse(405, 'Method Not Allowed')
  try {
    const authUser = await getAuthUser(event)
    const profile = await getStaffProfile(authUser)
    const body = JSON.parse(event.body || '{}')
    const operation = normalizeText(body.operation).toLowerCase()
    if (operation === 'prepare') return prepareNotification(profile, body)
    if (operation === 'commit') return commitNotification(profile, body)
    return failureResponse(400, 'Choose prepare or commit for this notification.')
  } catch (error) {
    console.error('Calendar change notification failed', error)
    return failureResponse(error.statusCode || 500, error.message || 'Calendar change notifications could not be sent.')
  }
}
