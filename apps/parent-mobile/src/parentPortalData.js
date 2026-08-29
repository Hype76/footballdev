import * as Crypto from 'expo-crypto'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { wakeChatMobileNotificationProcessor } from '../../../src/lib/chat-notification-wake'
import { getMobileRuntimeConfig } from '../../mobile-core/src/config'
import { normalizeMatchDay } from '../../mobile-core/src/data'
import { fetchJsonWithTimeout, joinApiPath } from '../../mobile-core/src/http'
import { getSelectedParentLink } from '../../mobile-core/src/parentLinks'
import { getAccessToken, supabase } from '../../mobile-core/src/supabase'
import { subscribeToMobileChatRoom } from '../../mobile-core/src/chatRealtime'
import { normalizePersonName } from '../../../src/lib/person-name.js'
import { buildParentCalendarIcs } from './parentExperience.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeBoolean(value) {
  return value === true || value === 'true'
}

function requireSelectedLink(user) {
  const link = getSelectedParentLink(user)
  if (!link?.id) throw new Error('Choose a linked child before continuing.')
  return link
}

function createRequestId(value = '') {
  const normalized = normalizeText(value)
  if (normalized) return normalized
  return Crypto.randomUUID()
}

async function sendCoachTrainingAvailabilityResponsePushSafely({ parentLinkId, requestPlayerId, respondedAt }) {
  try {
    const config = getMobileRuntimeConfig('parent')
    const accessToken = await getAccessToken()
    if (!config.apiBaseUrl || !accessToken || !parentLinkId || !requestPlayerId || !respondedAt) return null

    const { ok, result } = await fetchJsonWithTimeout(joinApiPath(config.apiBaseUrl, '/.netlify/functions/send-coach-mobile-push'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parentLinkId,
        requestPlayerId,
        respondedAt,
        type: 'training_availability_response',
      }),
    })
    if (!ok || result?.success === false) throw new Error(result?.message || 'Coach notification could not be sent.')
    return result
  } catch (error) {
    console.warn('Coach training availability notification failed', error)
    return null
  }
}

function isTransientChatError(error) {
  const signal = normalizeText(`${error?.code || ''} ${error?.message || error}`).toLowerCase()
  return signal.includes('network')
    || signal.includes('failed to fetch')
    || signal.includes('timed out')
    || signal.includes('timeout')
}

const PARENT_CHAT_LOAD_RETRY_DELAYS_MS = [0, 500, 1500]

function waitForChatRetry(delayMs) {
  return delayMs > 0 ? new Promise((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve()
}

function wakeParentChatNotifications() {
  void getAccessToken()
    .then((accessToken) => wakeChatMobileNotificationProcessor({
      accessToken,
      baseUrl: getMobileRuntimeConfig('parent').apiBaseUrl,
    }))
    .catch(() => {})
}

export function normalizeParentInvitation(row = {}) {
  const invitationType = normalizeText(row.invitation_type ?? row.invitationType).toLowerCase()
  return {
    canChangeResponse: normalizeBoolean(row.can_change_response ?? row.canChangeResponse),
    canRespond: normalizeBoolean(row.can_respond ?? row.canRespond),
    childId: row.child_id ?? row.childId ?? '',
    childName: normalizePersonName(row.child_name ?? row.childName) || 'Linked child',
    eventDate: normalizeText(row.event_date ?? row.eventDate),
    eventEnd: row.event_end ?? row.eventEnd ?? '',
    eventId: row.event_id ?? row.eventId ?? '',
    eventLocation: normalizeText(row.event_location ?? row.eventLocation),
    eventStart: row.event_start ?? row.eventStart ?? '',
    eventTitle: normalizeText(row.event_title ?? row.eventTitle) || 'Club event',
    invitationId: normalizeText(row.invitation_id ?? row.invitationId),
    invitationState: normalizeText(row.invitation_state ?? row.invitationState).toLowerCase() || 'active',
    invitationType: ['calendar_attendance', 'training_attendance', 'match_attendance', 'match_role'].includes(invitationType)
      ? invitationType
      : 'calendar_attendance',
    isPending: normalizeBoolean(row.is_pending ?? row.isPending),
    kickoffTimeTbc: normalizeBoolean(row.kickoff_time_tbc ?? row.kickoffTimeTbc),
    lastRespondedAt: row.last_responded_at ?? row.lastRespondedAt ?? '',
    lockReason: normalizeText(row.lock_reason ?? row.lockReason),
    parentLinkId: row.parent_link_id ?? row.parentLinkId ?? '',
    responseDeadline: row.response_deadline ?? row.responseDeadline ?? '',
    responseState: normalizeText(row.response_state ?? row.responseState).toLowerCase() || 'awaiting_response',
    roleType: normalizeText(row.role_type ?? row.roleType).toLowerCase(),
    selectionState: normalizeText(row.selection_state ?? row.selectionState).toLowerCase() || 'not_applicable',
    shirtChoice: normalizeText(row.shirt_choice ?? row.shirtChoice).toLowerCase() || 'home',
    sourceRecordId: row.source_record_id ?? row.sourceRecordId ?? '',
    sourceEventType: normalizeText(row.source_event_type ?? row.sourceEventType).toLowerCase(),
    sourceType: normalizeText(row.source_type ?? row.sourceType),
    teamName: normalizeText(row.team_name ?? row.teamName),
    transportCanOfferLift: normalizeBoolean(row.transport_can_offer_lift ?? row.transportCanOfferLift),
    transportNeedsLift: normalizeBoolean(row.transport_needs_lift ?? row.transportNeedsLift),
    transportRespondedAt: row.transport_responded_at ?? row.transportRespondedAt ?? '',
    transportSeatsOffered: Math.max(0, Number(row.transport_seats_offered ?? row.transportSeatsOffered ?? 0)),
  }
}

export function prepareParentInvitations(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeParentInvitation)
    .sort((left, right) => {
      if (left.isPending !== right.isPending) {
        return left.isPending ? -1 : 1
      }

      return String(left.eventStart || left.eventDate || '').localeCompare(String(right.eventStart || right.eventDate || ''))
        || left.eventTitle.localeCompare(right.eventTitle)
        || left.invitationType.localeCompare(right.invitationType)
    })
}

export function getInvitationResponseOptions(invitation = {}) {
  if (invitation.invitationType === 'match_role') {
    return [{ label: 'Accept offer', value: 'yes' }, { label: 'Decline offer', value: 'no' }]
  }
  if (invitation.invitationType === 'training_attendance') {
    return [{ label: 'Attending', value: 'available' }, { label: 'Not attending', value: 'unavailable' }, { label: 'Maybe', value: 'maybe' }]
  }
  if (invitation.invitationType === 'match_attendance') {
    return [{ label: 'Available', value: 'available' }, { label: 'Unavailable', value: 'unavailable' }, { label: 'Maybe', value: 'maybe' }]
  }
  return []
}

export function getParentVolunteerRoleLabel(invitation = {}) {
  const roleType = normalizeText(invitation.roleType ?? invitation.role_type)
    .toLowerCase()
    .replace(/^volunteer_/, '')
    .replaceAll('-', '_')
  const labels = {
    linesman: 'Linesman',
    referee: 'Referee',
    scorer: 'Scorer',
  }
  return labels[roleType] || 'Match volunteer'
}

export function getParentInvitationDisplayState(invitation = {}) {
  const invitationState = normalizeText(invitation.invitationState).toLowerCase()
  return ['cancelled', 'closed', 'expired'].includes(invitationState)
    ? invitationState
    : normalizeText(invitation.invitationType).toLowerCase() || 'invitation'
}

export function isParentInvitationActionable(invitation = {}) {
  const invitationState = normalizeText(invitation.invitationState).toLowerCase()
  return ['active', 'offered'].includes(invitationState)
    && (invitation.canRespond === true || invitation.canChangeResponse === true)
}

export function normalizeParentChatRoom(row = {}) {
  return {
    canPost: Boolean(row.can_post ?? row.canPost),
    childNames: Array.isArray(row.child_names ?? row.childNames) ? (row.child_names ?? row.childNames).map(normalizePersonName).filter(Boolean) : [],
    clubName: normalizeText(row.club_name ?? row.clubName),
    fixtureStatus: normalizeText(row.fixture_status ?? row.fixtureStatus),
    id: row.id ?? '',
    kickoffTime: row.kickoff_time ?? row.kickoffTime ?? '',
    kickoffTimeTbc: Boolean(row.kickoff_time_tbc ?? row.kickoffTimeTbc),
    latestMessage: normalizeText(row.latest_message ?? row.latestMessage),
    latestMessageAt: row.latest_message_at ?? row.latestMessageAt ?? '',
    matchDate: row.match_date ?? row.matchDate ?? '',
    matchDayId: row.match_day_id ?? row.matchDayId ?? '',
    notificationsMuted: Boolean(row.notifications_muted ?? row.notificationsMuted),
    opponent: normalizeText(row.opponent),
    playerName: normalizePersonName(row.player_name ?? row.playerName),
    status: normalizeText(row.status) || 'active',
    teamName: normalizeText(row.team_name ?? row.teamName),
    title: normalizeText(row.title) || 'Parent Chat',
    type: normalizeText(row.room_type ?? row.type),
    unreadCount: Number(row.unread_count ?? row.unreadCount ?? 0),
  }
}

export function normalizeParentChatMessage(row = {}, user = {}) {
  const isCurrentUser = normalizeText(row.sender_id ?? row.senderId) === normalizeText(user.id)
  return {
    body: normalizeText(row.body),
    canDelete: Boolean(row.can_delete ?? row.canDelete),
    createdAt: row.created_at ?? row.createdAt ?? '',
    deletedAt: row.deleted_at ?? row.deletedAt ?? '',
    id: row.id ?? '',
    roomId: row.room_id ?? row.roomId ?? '',
    senderKind: normalizeText(row.sender_kind ?? row.senderKind),
    senderName: normalizeText(isCurrentUser ? user.displayName || user.name : '') || normalizeText(row.sender_name ?? row.senderName) || 'Chat participant',
    senderRole: normalizeText(row.sender_role ?? row.senderRole),
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  }
}

export function normalizeParentResource(row = {}) {
  return {
    assignedAt: row.assigned_at ?? row.assignedAt ?? '',
    category: normalizeText(row.category) || 'Shared resource',
    description: normalizeText(row.description),
    externalUrl: normalizeText(row.external_url ?? row.externalUrl),
    fileName: normalizeText(row.file_name ?? row.fileName),
    id: row.id ?? '',
    linkId: row.link_id ?? row.linkId ?? '',
    mimeType: normalizeText(row.mime_type ?? row.mimeType),
    resourceType: normalizeText(row.resource_type ?? row.resourceType),
    shareDescription: normalizeText(row.share_description ?? row.shareDescription),
    title: normalizeText(row.title) || 'Shared resource',
  }
}

function normalizeParentMatchEvent(row = {}) {
  return {
    assistName: normalizePersonName(row.assist_name ?? row.assistName),
    assistShirtNumber: normalizeText(row.assist_shirt_number ?? row.assistShirtNumber),
    awayScore: Number(row.away_score ?? row.awayScore ?? 0),
    createdAt: row.created_at ?? row.createdAt ?? '',
    eventSequence: Number(row.event_sequence ?? row.eventSequence ?? 0),
    eventStatus: normalizeText(row.event_status ?? row.eventStatus) || (row.voided_at || row.voidedAt ? 'voided' : 'active'),
    eventType: normalizeText(row.event_type ?? row.eventType) || 'goal',
    homeScore: Number(row.home_score ?? row.homeScore ?? 0),
    id: row.id ?? '',
    isPenaltyGoal: row.is_penalty_goal === true || row.isPenaltyGoal === true,
    matchPhase: normalizeText(row.match_phase ?? row.matchPhase),
    minute: row.minute ?? null,
    notes: normalizeText(row.notes),
    phaseOrder: Number(row.phase_order ?? row.phaseOrder ?? 0),
    playerName: normalizePersonName(row.player_name ?? row.playerName),
    playerOnName: normalizePersonName(row.player_on_name ?? row.playerOnName),
    scorerName: normalizePersonName(row.scorer_name ?? row.scorerName),
    scorerShirtNumber: normalizeText(row.scorer_shirt_number ?? row.scorerShirtNumber),
    stoppageMinute: row.stoppage_minute ?? row.stoppageMinute ?? null,
    teamSide: normalizeText(row.team_side ?? row.teamSide) || 'club',
    voidedAt: row.voided_at ?? row.voidedAt ?? '',
  }
}

function normalizeParentMatchDay(row = {}) {
  const match = normalizeMatchDay(row)
  return {
    ...match,
    clockMode: normalizeText(row.match_clock_mode ?? row.clockMode) || 'fixed',
    conclusionRule: normalizeText(row.match_conclusion_rule ?? row.conclusionRule) || 'normal_time',
    confirmedTeam: Array.isArray(row.selected_player_names ?? row.selectedPlayerNames)
      ? (row.selected_player_names ?? row.selectedPlayerNames).map(normalizePersonName).filter(Boolean)
      : [],
    currentMatchPhase: normalizeText(row.current_match_phase ?? row.currentMatchPhase) || 'pre_match',
    events: Array.isArray(row.events) ? row.events.map(normalizeParentMatchEvent) : match.events,
    homeShootoutScore: Number(row.home_shootout_score ?? row.homeShootoutScore ?? 0),
    awayShootoutScore: Number(row.away_shootout_score ?? row.awayShootoutScore ?? 0),
    matchDurationMinutes: Number(row.match_duration_minutes ?? row.matchDurationMinutes ?? 90),
    shootoutEvents: Array.isArray(row.shootout_events ?? row.shootoutEvents)
      ? (row.shootout_events ?? row.shootoutEvents).map((kick) => ({
          createdAt: kick.created_at ?? kick.createdAt ?? '',
          id: kick.id ?? '',
          outcome: normalizeText(kick.outcome),
          playerName: normalizePersonName(kick.player_name ?? kick.playerName),
          teamSide: normalizeText(kick.team_side ?? kick.teamSide),
          voidedAt: kick.voided_at ?? kick.voidedAt ?? '',
        }))
      : [],
    timerElapsedSeconds: Number(row.timer_elapsed_seconds ?? row.timerElapsedSeconds ?? 0),
    timerPausedAt: row.timer_paused_at ?? row.timerPausedAt ?? '',
    timerStartedAt: row.timer_started_at ?? row.timerStartedAt ?? '',
    timerStatus: normalizeText(row.timer_status ?? row.timerStatus) || 'not_started',
  }
}

export async function getParentPortalMatchDays(user) {
  const link = requireSelectedLink(user)
  const [baseResult, extendedResult, teamResult, scorerResult, shirtResult] = await Promise.all([
    supabase.rpc('get_parent_portal_match_days', { parent_link_id_value: link.id }),
    supabase.rpc('get_parent_portal_match_day_extended_state', { parent_link_id_value: link.id }),
    supabase.rpc('get_parent_portal_confirmed_teams', { parent_link_id_value: link.id }),
    supabase.rpc('get_parent_scorer_game_mode_match_ids', { parent_link_id_value: link.id }),
    supabase.rpc('get_parent_portal_match_shirt_choices', { parent_link_id_value: link.id }),
  ])
  for (const result of [baseResult, extendedResult, teamResult, scorerResult, shirtResult]) {
    if (result.error) throw result.error
  }
  const extendedById = new Map((extendedResult.data || []).map((row) => [String(row.match_day_id ?? row.matchDayId), row]))
  const teamById = new Map((teamResult.data || []).map((row) => [String(row.match_day_id ?? row.matchDayId), row.selected_player_names ?? row.selectedPlayerNames ?? []]))
  const scorerIds = new Set((scorerResult.data || []).map((row) => String(row.match_day_id ?? row.matchDayId)))
  const shirtsById = new Map((shirtResult.data || []).map((row) => [String(row.match_day_id ?? row.matchDayId), row.shirt_choice ?? row.shirtChoice]))
  return (baseResult.data || []).map((row) => {
    const extended = extendedById.get(String(row.id)) || {}
    const eventContext = new Map((extended.event_contexts ?? extended.eventContexts ?? []).map((event) => [String(event.id), event]))
    return normalizeParentMatchDay({
      ...row,
      ...extended,
      events: (row.events || []).map((event) => ({ ...event, ...(eventContext.get(String(event.id)) || {}) })),
      is_scorer: scorerIds.has(String(row.id)),
      shirt_choice: shirtsById.get(String(row.id)),
      selected_player_names: teamById.get(String(row.id)) || [],
    })
  })
}

export async function getParentPortalMatchDayPlayers(user) {
  const link = requireSelectedLink(user)
  const { data, error } = await supabase.rpc('get_parent_portal_match_day_players', { parent_link_id_value: link.id })
  if (error) throw error
  return (data || []).map((row) => ({
    id: row.id ?? '',
    playerName: normalizePersonName(row.player_name ?? row.playerName),
    shirtNumber: normalizeText(row.shirt_number ?? row.shirtNumber),
    status: normalizeText(row.status) || 'active',
  }))
}

export async function getParentInvitations(user) {
  const link = requireSelectedLink(user)
  const [invitationResult, shirtResult, transportResult] = await Promise.all([
    supabase.rpc('get_parent_portal_invitation_summary', { parent_link_id_value: link.id }),
    supabase.rpc('get_parent_portal_match_shirt_choices', { parent_link_id_value: link.id }),
    supabase.rpc('get_parent_portal_match_transport_states', { parent_link_id_value: link.id }),
  ])
  if (invitationResult.error) throw invitationResult.error
  if (shirtResult.error) throw shirtResult.error
  if (transportResult.error) throw transportResult.error
  const shirtsById = new Map((shirtResult.data || []).map((row) => [String(row.match_day_id ?? row.matchDayId), row.shirt_choice ?? row.shirtChoice]))
  const transportByRequestId = new Map((transportResult.data || []).map((row) => [String(row.request_id ?? row.requestId), row]))
  return prepareParentInvitations((invitationResult.data || []).map((row) => ({
    ...row,
    ...(transportByRequestId.get(String(row.source_record_id ?? row.sourceRecordId)) || {}),
    shirt_choice: normalizeText(row.source_event_type ?? row.sourceEventType).toLowerCase() === 'match_day'
      ? shirtsById.get(String(row.event_id ?? row.eventId))
      : undefined,
  })))
}

export async function setParentMatchTransport(user, invitation, mode, seatsOffered = 0) {
  const link = requireSelectedLink(user)
  if (invitation?.invitationType !== 'match_attendance' || !invitation?.sourceRecordId) {
    throw new Error('Choose a Match attendance request before changing carpool.')
  }
  const { data, error } = await supabase.rpc('set_parent_portal_match_transport', {
    parent_link_id_value: link.id,
    request_id_value: invitation.sourceRecordId,
    transport_mode_value: normalizeText(mode),
    transport_seats_offered_value: Math.max(0, Math.min(8, Number(seatsOffered || 0))),
  })
  if (error) throw error
  return data
}

export async function shareParentCalendarItem(item) {
  const content = buildParentCalendarIcs(item)
  if (!content) throw new Error('This event needs a confirmed date before it can be added to a calendar.')
  if (!await Sharing.isAvailableAsync()) throw new Error('Calendar sharing is not available on this device.')
  const fileName = safeFilename(item?.title || item?.eventTitle || `${item?.teamName || 'team'}-${item?.opponent || 'event'}`, 'football-player-event')
  const localUri = `${FileSystem.cacheDirectory}${fileName}.ics`
  await FileSystem.writeAsStringAsync(localUri, content, { encoding: FileSystem.EncodingType.UTF8 })
  try {
    await Sharing.shareAsync(localUri, { dialogTitle: 'Add to calendar', mimeType: 'text/calendar', UTI: 'public.calendar-event' })
    return { shared: true }
  } finally {
    await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {})
  }
}

export async function respondToParentInvitation(user, invitation, responseState) {
  const link = requireSelectedLink(user)
  const response = normalizeText(responseState).toLowerCase()
  if (!invitation?.sourceRecordId) throw new Error('This invitation could not be opened.')
  if (!isParentInvitationActionable(invitation)) throw new Error('This invitation is no longer available for response.')
  if (invitation.invitationType === 'training_attendance') {
    const previousResponse = normalizeText(invitation.responseState).toLowerCase()
    const { data, error } = await supabase.rpc('respond_parent_portal_training_invitation', {
      parent_link_id_value: link.id,
      request_player_id_value: invitation.sourceRecordId,
      response_value: response,
    })
    if (error) throw error
    if (previousResponse !== response && data?.respondedAt) {
      await sendCoachTrainingAvailabilityResponsePushSafely({
        parentLinkId: link.id,
        requestPlayerId: invitation.sourceRecordId,
        respondedAt: data.respondedAt,
      })
    }
    return data
  }
  if (['match_attendance', 'match_role'].includes(invitation.invitationType)) {
    const { data, error } = await supabase.rpc('respond_parent_portal_match_day_invitation', {
      parent_link_id_value: link.id,
      request_id_value: invitation.sourceRecordId,
      response_kind_value: invitation.invitationType === 'match_role' ? 'role' : 'attendance',
      role_type_value: invitation.invitationType === 'match_role' ? invitation.roleType : null,
      response_value: response,
    })
    if (error) throw error
    return data
  }
  throw new Error('This invitation does not require a response.')
}

export async function getParentResources(user) {
  const link = requireSelectedLink(user)
  const { data, error } = await supabase.rpc('get_parent_portal_player_resources', { parent_link_id_value: link.id })
  if (error) throw error
  return (data || []).map(normalizeParentResource)
}

export async function getParentNotificationInbox(user) {
  const link = requireSelectedLink(user)
  const config = getMobileRuntimeConfig('parent')
  const accessToken = await getAccessToken()
  if (!accessToken) throw new Error('Sign in again before opening notifications.')
  const { ok, result } = await fetchJsonWithTimeout(joinApiPath(config.apiBaseUrl, `/.netlify/functions/parent-mobile-notifications?parentLinkId=${encodeURIComponent(link.id)}`), {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!ok || result.success === false) throw new Error(result.message || 'Notifications could not be loaded.')
  return Array.isArray(result.notifications) ? result.notifications : []
}

export async function markParentNotificationRead(user, notificationIds = []) {
  const link = requireSelectedLink(user)
  const config = getMobileRuntimeConfig('parent')
  const accessToken = await getAccessToken()
  const ids = [...new Set((Array.isArray(notificationIds) ? notificationIds : [notificationIds]).map(normalizeText).filter(Boolean))]
  if (!accessToken) throw new Error('Sign in again before opening notifications.')
  const { ok, result } = await fetchJsonWithTimeout(joinApiPath(config.apiBaseUrl, '/.netlify/functions/parent-mobile-notifications'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ notificationIds: ids, parentLinkId: link.id }),
  })
  if (!ok || result.success === false) throw new Error(result.message || 'Notification state could not be saved.')
  return result
}

function getParentApiPaths(config) {
  if (config.supabaseEnvironment === 'production') {
    return {
      development: '/api/parent-development/history',
      resource: '/api/parent-resources/access',
    }
  }
  return {
    development: '/api/mobile-test/parent-development',
    resource: '/api/mobile-test/parent-resource',
  }
}

async function callParentApi(path, body) {
  const config = getMobileRuntimeConfig('parent')
  const accessToken = await getAccessToken()
  if (!accessToken) throw new Error('Sign in again before continuing.')
  const { ok, result } = await fetchJsonWithTimeout(joinApiPath(config.apiBaseUrl, path), {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!ok) throw new Error(result.message || result.error || 'The Parent service could not complete this request.')
  return result
}

export async function getParentDevelopmentHistory(user) {
  const link = requireSelectedLink(user)
  const config = getMobileRuntimeConfig('parent')
  const result = await callParentApi(getParentApiPaths(config).development, { action: 'list', parentLinkId: link.id })
  return Array.isArray(result.reports) ? result.reports : []
}

export async function getParentCalendarEventResources(user) {
  const link = requireSelectedLink(user)
  const config = getMobileRuntimeConfig('parent')
  const result = await callParentApi(getParentApiPaths(config).resource, {
    action: 'list_calendar_event_resources',
    parentLinkId: link.id,
  })

  return (Array.isArray(result.resources) ? result.resources : []).map((resource) => ({
    category: normalizeText(resource.category) || 'general',
    eventId: normalizeText(resource.eventId ?? resource.event_id),
    fileSizeBytes: Math.max(0, Number(resource.fileSizeBytes ?? resource.file_size_bytes ?? 0)),
    id: normalizeText(resource.id ?? resource.resourceId ?? resource.resource_id),
    originalFilename: normalizeText(resource.originalFilename ?? resource.original_filename),
    occurrenceDate: normalizeText(resource.occurrenceDate ?? resource.occurrence_date),
    resourceType: normalizeText(resource.resourceType ?? resource.resource_type) || 'file',
    title: normalizeText(resource.title) || normalizeText(resource.originalFilename ?? resource.original_filename) || 'Event attachment',
  })).filter((resource) => resource.id && resource.eventId && resource.occurrenceDate)
}

export async function getParentCalendarEventDetails(user) {
  const link = requireSelectedLink(user)
  const { data, error } = await supabase.rpc('get_parent_portal_calendar_event_details', {
    parent_link_id_value: link.id,
  })

  if (error) throw error

  return (Array.isArray(data) ? data : []).map((event) => ({
    id: normalizeText(event.id),
    notes: normalizeText(event.notes),
  })).filter((event) => event.id)
}

function safeFilename(value, fallback) {
  return normalizeText(value).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-') || fallback
}

async function downloadAndShareParentFile({ fileName, mimeType, path }) {
  const config = getMobileRuntimeConfig('parent')
  const accessToken = await getAccessToken()
  if (!accessToken) throw new Error('Sign in again before opening this file.')
  const localUri = `${FileSystem.cacheDirectory}${safeFilename(fileName, `parent-file-${Date.now()}`)}`
  const remoteUrl = /^https:\/\//i.test(path) ? path : joinApiPath(config.apiBaseUrl, path)
  const result = await FileSystem.downloadAsync(remoteUrl, localUri, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (result.status < 200 || result.status >= 300) throw new Error('This file could not be downloaded.')
  try {
    if (!await Sharing.isAvailableAsync()) throw new Error('File sharing is not available on this device.')
    await Sharing.shareAsync(result.uri, { dialogTitle: 'Open Parent file', mimeType })
  } finally {
    await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {})
  }
}

export async function openParentDevelopmentReport(user, reportId) {
  const link = requireSelectedLink(user)
  const config = getMobileRuntimeConfig('parent')
  const developmentPath = getParentApiPaths(config).development
  await downloadAndShareParentFile({
    fileName: `development-report-${reportId}.pdf`,
    mimeType: 'application/pdf',
    path: `${developmentPath}?parentLinkId=${encodeURIComponent(link.id)}&reportId=${encodeURIComponent(reportId)}`,
  })
  return { shared: true }
}

export async function openParentResource(user, resourceId, { calendarEventId = '', calendarOccurrenceDate = '' } = {}) {
  const link = requireSelectedLink(user)
  const config = getMobileRuntimeConfig('parent')
  const resourcePath = getParentApiPaths(config).resource
  const result = await callParentApi(resourcePath, {
    calendarEventId: normalizeText(calendarEventId) || undefined,
    calendarOccurrenceDate: normalizeText(calendarOccurrenceDate) || undefined,
    parentLinkId: link.id,
    resourceId,
  })
  if (result.accessType === 'formation_board' && result.formationBoard) return { formationBoard: result.formationBoard }
  if (result.accessType === 'external_link') return { externalUrl: normalizeText(result.accessUrl) }
  if (config.supabaseEnvironment === 'production') {
    const accessUrl = normalizeText(result.accessUrl)
    if (!/^https:\/\//i.test(accessUrl)) throw new Error('This resource could not be opened safely.')
    return { externalUrl: accessUrl }
  }
  await downloadAndShareParentFile({
    fileName: result.fileName || `resource-${resourceId}`,
    mimeType: result.mimeType || 'application/octet-stream',
    path: `${resourcePath}?parentLinkId=${encodeURIComponent(link.id)}&resourceId=${encodeURIComponent(resourceId)}`,
  })
  return { shared: true }
}

export async function getParentChatRooms(user, childOnly = true) {
  const link = requireSelectedLink(user)
  const roomArgs = {
    child_only_value: Boolean(childOnly),
    parent_link_id_value: link.id,
  }
  const [{ data, error }, { data: preferences, error: preferenceError }] = await Promise.all([
    supabase.rpc('get_parent_portal_chat_rooms', roomArgs),
    supabase.rpc('get_parent_portal_chat_notification_preferences', roomArgs),
  ])
  if (error) throw error
  if (preferenceError) throw preferenceError
  const mutedByRoom = new Map((preferences || []).map((preference) => [
    String(preference.room_id || ''),
    Boolean(preference.notifications_muted),
  ]))
  return (data || []).map((row) => normalizeParentChatRoom({
    ...row,
    notifications_muted: mutedByRoom.get(String(row.id || '')) === true,
  }))
}

export async function setParentChatRoomNotifications(user, roomId, notificationsMuted, childOnly = true) {
  const link = requireSelectedLink(user)
  const { data, error } = await supabase.rpc('set_parent_portal_chat_room_notifications', {
    child_only_value: Boolean(childOnly),
    notifications_muted_value: notificationsMuted === true,
    parent_link_id_value: link.id,
    target_room_id: roomId,
  })
  if (error) throw error
  return Boolean(data)
}

export async function getParentChatMessages(user, roomId, childOnly = true) {
  const link = requireSelectedLink(user)
  let lastError
  for (const delayMs of PARENT_CHAT_LOAD_RETRY_DELAYS_MS) {
    await waitForChatRetry(delayMs)
    const { data, error } = await supabase.rpc('get_parent_portal_chat_messages', {
      child_only_value: Boolean(childOnly),
      parent_link_id_value: link.id,
      target_room_id: roomId,
    })
    if (!error) return (data || []).map((row) => normalizeParentChatMessage(row, user))
    lastError = error
    if (!isTransientChatError(error)) break
  }
  throw lastError
}

export function subscribeToParentChatRoom(user, roomId, options = {}) {
  requireSelectedLink(user)
  return subscribeToMobileChatRoom({
    kind: 'parent',
    onChange: options.onChange,
    onStatusChange: options.onStatusChange,
    roomId,
  })
}

export async function getParentChatHistory(user, childOnly = true) {
  const rooms = await getParentChatRooms(user, childOnly)
  const results = await Promise.all(rooms.map(async (room) => {
    const messages = await getParentChatMessages(user, room.id, childOnly)
    return messages.map((message) => ({ ...message, roomId: room.id }))
  }))
  return results.flat()
}

export async function sendParentChatMessage(user, roomId, body, childOnly = true, clientRequestId = '') {
  const link = requireSelectedLink(user)
  const normalizedBody = normalizeText(body)
  if (!roomId || !normalizedBody) throw new Error('Choose a Chat room and add a message before sending.')
  if (normalizedBody.length > 2000) throw new Error('Chat messages must be 2000 characters or fewer.')
  const requestId = createRequestId(clientRequestId)
  let lastError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await supabase.rpc('send_parent_portal_chat_message', {
      body_value: normalizedBody,
      child_only_value: Boolean(childOnly),
      parent_link_id_value: link.id,
      request_id_value: requestId,
      target_room_id: roomId,
    })
    if (!error) {
      wakeParentChatNotifications()
      return data
    }
    lastError = error
    if (!isTransientChatError(error) || attempt === 1) break
  }
  throw lastError
}

export async function markParentChatRoomRead(user, roomId, childOnly = true) {
  const link = requireSelectedLink(user)
  const { data, error } = await supabase.rpc('mark_parent_portal_chat_room_read', {
    child_only_value: Boolean(childOnly),
    parent_link_id_value: link.id,
    target_room_id: roomId,
  })
  if (error) throw error
  return data
}

export async function deleteParentChatMessage(user, messageId, childOnly = true) {
  const link = requireSelectedLink(user)
  const { error } = await supabase.rpc('delete_parent_portal_chat_message', {
    child_only_value: Boolean(childOnly),
    parent_link_id_value: link.id,
    target_message_id: messageId,
  })
  if (error) throw error
}

export async function expressParentScorerInterest(user, matchDayId, message = '') {
  const link = requireSelectedLink(user)
  const { data, error } = await supabase.rpc('express_match_day_scorer_interest', {
    match_day_id_value: matchDayId,
    message_value: normalizeText(message),
    parent_link_id_value: link.id,
  })
  if (error) throw error
  return data
}

async function scorerRpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data
}

export async function sendParentScorerMatchDayPush(user, matchDayId, type, eventId = '') {
  const link = requireSelectedLink(user)
  const config = getMobileRuntimeConfig('parent')
  const accessToken = await getAccessToken()
  if (!config.apiBaseUrl || !accessToken) return null

  try {
    const response = await fetchJsonWithTimeout(joinApiPath(config.apiBaseUrl, '.netlify/functions/send-match-day-push'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: normalizeText(eventId), matchDayId, parentLinkId: link.id, type: normalizeText(type) }),
    })
    return response.ok && response.result?.success !== false ? response.result : null
  } catch {
    return null
  }
}

export function startParentScorerMatch(matchId) {
  return scorerRpc('start_match_day', { match_day_id_value: matchId })
}

export function setParentScorerTimer(matchId, action) {
  return scorerRpc('set_match_day_timer_state', { action_value: action, match_day_id_value: matchId })
}

export function setParentScorerExtendedState(matchId, action) {
  return scorerRpc('set_match_day_extended_state', { action_value: action, match_day_id_value: matchId })
}

export async function updateParentScorerScore(user, matchId, homeScore, awayScore) {
  const link = requireSelectedLink(user)
  return scorerRpc('record_match_day_score_correction_v2', {
    away_score_value: Math.max(0, Number(awayScore || 0)),
    home_score_value: Math.max(0, Number(homeScore || 0)),
    match_day_id_value: matchId,
    notes_value: 'Score corrected by parent scorer',
    parent_link_id_value: link.id,
    request_id_value: createRequestId(),
  })
}

export async function addParentScorerGoal(user, matchId, goal = {}) {
  const link = requireSelectedLink(user)
  return scorerRpc('record_match_day_goal_v2', {
    assist_name_value: normalizeText(goal.assistName),
    assist_shirt_number_value: normalizeText(goal.assistShirtNumber),
    is_penalty_goal_value: goal.isPenaltyGoal === true,
    match_day_id_value: matchId,
    minute_value: goal.minute === '' || goal.minute == null ? null : Number(goal.minute),
    notes_value: normalizeText(goal.notes),
    parent_link_id_value: link.id,
    request_id_value: createRequestId(),
    scorer_name_value: normalizeText(goal.scorerName),
    scorer_shirt_number_value: normalizeText(goal.scorerShirtNumber),
    team_side_value: goal.teamSide === 'opponent' ? 'opponent' : 'club',
  })
}

export async function correctParentScorerGoal(user, match, event, goal = {}, reason = '') {
  const link = requireSelectedLink(user)
  return scorerRpc('correct_match_day_goal', {
    assist_name_value: normalizeText(goal.assistName ?? event.assistName),
    assist_shirt_number_value: normalizeText(goal.assistShirtNumber ?? event.assistShirtNumber),
    correction_reason_value: normalizeText(reason),
    goal_event_id_value: event.id,
    match_day_id_value: match.id,
    minute_value: goal.minute === '' || goal.minute == null ? null : Number(goal.minute ?? event.minute),
    notes_value: normalizeText(goal.notes ?? event.notes),
    parent_link_id_value: link.id,
    scorer_name_value: normalizeText(goal.scorerName ?? event.scorerName),
    scorer_shirt_number_value: normalizeText(goal.scorerShirtNumber ?? event.scorerShirtNumber),
    team_side_value: (goal.teamSide ?? event.teamSide) === 'opponent' ? 'opponent' : 'club',
  })
}

export async function voidParentScorerGoal(user, matchId, eventId, reason = 'Corrected goal') {
  const link = requireSelectedLink(user)
  return scorerRpc('void_match_day_goal', {
    goal_event_id_value: eventId,
    match_day_id_value: matchId,
    parent_link_id_value: link.id,
    reason_value: normalizeText(reason),
  })
}

export function recordParentScorerShootoutKick(matchId, kick = {}) {
  return scorerRpc('record_match_day_shootout_kick', {
    match_day_id_value: matchId,
    notes_value: normalizeText(kick.notes),
    outcome_value: kick.outcome === 'missed' ? 'missed' : 'scored',
    player_name_value: normalizeText(kick.playerName),
    team_side_value: kick.teamSide === 'opponent' ? 'opponent' : 'club',
  })
}

export function voidParentScorerShootoutKick(matchId, kickId, reason = 'Corrected shootout kick') {
  return scorerRpc('void_match_day_shootout_kick', {
    kick_id_value: kickId,
    match_day_id_value: matchId,
    reason_value: normalizeText(reason),
  })
}

export async function updateParentPassword(user, currentPassword, nextPassword) {
  const email = normalizeText(user?.email).toLowerCase()
  if (!email || !normalizeText(currentPassword) || normalizeText(nextPassword).length < 8) {
    throw new Error('Enter your current password and a new password of at least 8 characters.')
  }
  const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
  if (reauthError) throw new Error('Your current password was not recognised.')
  const { error } = await supabase.auth.updateUser({ password: nextPassword })
  if (error) throw error
}

export async function updateParentDisplayName(displayName) {
  const nextDisplayName = normalizeText(displayName)
  if (!nextDisplayName) throw new Error('Enter the name you want shown in the app.')

  const { data, error } = await supabase.auth.updateUser({
    data: {
      display_name: nextDisplayName,
      name: nextDisplayName,
    },
  })
  if (error) throw error
  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession()
  if (refreshError) throw refreshError
  return refreshed?.user || data?.user || null
}
