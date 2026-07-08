import { supabase } from '../supabase-client.js'
import { clearViewCaches, invalidateMemoryCacheByPrefix } from './cache-store.js'
import { blockDemoMutation } from './demo-guards.js'
import { createAuditLog } from './audit.js'
import { getEntryUserId, getEntryUserName } from './core-normalizers.js'
import { buildMatchDayParentVisibility } from '../matchday-parent-visibility.js'

export { getMatchDayDisplayName, getMatchDayDisplayParts, getMatchDayDisplayScore } from '../matchday-display.js'
export { buildMatchDayParentVisibility } from '../matchday-parent-visibility.js'

export const MATCH_DAY_STATUS_OPTIONS = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'scorer_request', label: 'Scorer request' },
  { value: 'live', label: 'Live' },
  { value: 'half_time', label: 'Half time' },
  { value: 'second_half', label: 'Second half' },
  { value: 'extra_time', label: 'Extra time' },
  { value: 'penalties', label: 'Penalties' },
  { value: 'full_time', label: 'Full time' },
  { value: 'postponed', label: 'Postponed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export const MATCH_DAY_HOME_AWAY_OPTIONS = [
  { value: 'home', label: 'Home' },
  { value: 'away', label: 'Away' },
  { value: 'neutral', label: 'Neutral' },
]

export const MATCH_DAY_ARRIVAL_OPTIONS = [
  { value: '15', label: '15 mins before kick off' },
  { value: '30', label: '30 mins before kick off' },
  { value: '45', label: '45 mins before kick off' },
  { value: '60', label: '60 mins before kick off' },
  { value: 'custom', label: 'Custom arrival time' },
]

const MATCH_DAY_PARENT_AUDIENCES = ['none', 'involved_players', 'all_team_parents', 'all_club_parents']
const MATCH_DAY_EVENT_LOG_TYPES = new Set([
  'match_day_created',
  'match_day_updated',
  'player_selected',
  'player_deselected',
  'player_availability_changed',
  'match_role_assigned',
  'match_role_removed',
  'scorer_updated',
  'linesman_updated',
  'invite_prepared',
  'invite_queued',
  'note_updated',
  'yellow_card',
  'red_card',
  'substitution',
  'water_break',
])

const MATCH_DAY_STAFF_EVENT_TYPES = new Set([
  'yellow_card',
  'red_card',
  'substitution',
  'water_break',
])
const MATCH_DAY_TIMER_ACTIONS = new Set(['start', 'pause', 'half_time', 'hydration', 'resume', 'full_time'])
const MATCH_DAY_TIMER_STATUSES = new Set(['not_started', 'running', 'paused', 'half_time', 'hydration', 'full_time'])

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeTime(value) {
  const normalizedValue = normalizeText(value)
  return /^\d{2}:\d{2}$/.test(normalizedValue) ? normalizedValue : ''
}

function normalizeDateOnly(value) {
  const normalizedValue = normalizeText(value)

  if (!normalizedValue) {
    return ''
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return normalizedValue
  }

  const parsedDate = new Date(normalizedValue)
  return Number.isNaN(parsedDate.getTime()) ? '' : parsedDate.toISOString().slice(0, 10)
}

export function getTodayMatchDayDateValue(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    return ''
  }

  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export function isPastMatchDayDate(matchDate, now = new Date()) {
  const normalizedMatchDate = normalizeDateOnly(matchDate)

  if (!normalizedMatchDate) {
    return false
  }

  return normalizedMatchDate < getTodayMatchDayDateValue(now)
}

export function isPastMatchDayDateTime(matchDate, kickoffTime, now = new Date()) {
  const normalizedMatchDate = normalizeDateOnly(matchDate)

  if (!normalizedMatchDate) {
    return false
  }

  const today = getTodayMatchDayDateValue(now)

  if (normalizedMatchDate < today) {
    return true
  }

  if (normalizedMatchDate > today) {
    return false
  }

  const normalizedKickoffTime = normalizeTime(kickoffTime)

  if (!normalizedKickoffTime || !(now instanceof Date) || Number.isNaN(now.getTime())) {
    return false
  }

  const fixtureDateTime = new Date(`${normalizedMatchDate}T${normalizedKickoffTime}`)

  if (Number.isNaN(fixtureDateTime.getTime())) {
    return false
  }

  const currentMinute = new Date(now)
  currentMinute.setSeconds(0, 0)

  return fixtureDateTime.getTime() < currentMinute.getTime()
}

function assertMatchDayDateIsCurrentOrFuture(matchDate) {
  if (isPastMatchDayDate(matchDate)) {
    throw new Error('Match Day date must be today or in the future.')
  }
}

function assertMatchDayDateTimeIsCurrentOrFuture(matchDate, kickoffTime) {
  if (isPastMatchDayDateTime(matchDate, kickoffTime)) {
    throw new Error('Fixture date and time cannot be in the past.')
  }
}

function normalizeParentAudience(value) {
  const normalizedValue = normalizeText(value)
  return MATCH_DAY_PARENT_AUDIENCES.includes(normalizedValue) ? normalizedValue : 'none'
}

function normalizeBoolean(value) {
  return value === true
}

function shouldRequestScorer(match = {}) {
  if (match.requestScorer !== undefined) {
    return normalizeBoolean(match.requestScorer)
  }

  return normalizeText(match.scorerRequestMessage) !== '' || normalizeText(match.status) === 'scorer_request'
}

export function calculateArrivalTime(kickoffTime, offsetMinutes) {
  const normalizedKickoffTime = normalizeTime(kickoffTime)
  const minutesBeforeKickoff = Number(offsetMinutes ?? 0)

  if (!normalizedKickoffTime || !Number.isFinite(minutesBeforeKickoff) || minutesBeforeKickoff <= 0) {
    return ''
  }

  const [hours, minutes] = normalizedKickoffTime.split(':').map(Number)
  const kickoffMinutes = hours * 60 + minutes
  const arrivalMinutes = (kickoffMinutes - minutesBeforeKickoff + 1440) % 1440
  const arrivalHours = Math.floor(arrivalMinutes / 60)
  const arrivalMinutePart = arrivalMinutes % 60

  return `${String(arrivalHours).padStart(2, '0')}:${String(arrivalMinutePart).padStart(2, '0')}`
}

function normalizeMatchDayEvent(row) {
  return {
    id: row.id ?? '',
    matchDayId: row.match_day_id ?? row.matchDayId ?? '',
    eventType: normalizeText(row.event_type ?? row.eventType) || 'goal',
    teamSide: normalizeText(row.team_side ?? row.teamSide) || 'club',
    minute: row.minute ?? null,
    scorerName: normalizeText(row.scorer_name ?? row.scorerName),
    scorerInitials: normalizeText(row.scorer_initials ?? row.scorerInitials),
    scorerShirtNumber: normalizeText(row.scorer_shirt_number ?? row.scorerShirtNumber),
    assistName: normalizeText(row.assist_name ?? row.assistName),
    assistInitials: normalizeText(row.assist_initials ?? row.assistInitials),
    assistShirtNumber: normalizeText(row.assist_shirt_number ?? row.assistShirtNumber),
    homeScore: Number(row.home_score ?? row.homeScore ?? 0),
    awayScore: Number(row.away_score ?? row.awayScore ?? 0),
    notes: normalizeText(row.notes),
    eventStatus: normalizeText(row.event_status ?? row.eventStatus) || 'active',
    correctedAt: row.corrected_at ?? row.correctedAt ?? '',
    correctedByName: normalizeText(row.corrected_by_name ?? row.correctedByName),
    voidedAt: row.voided_at ?? row.voidedAt ?? '',
    voidedByName: normalizeText(row.voided_by_name ?? row.voidedByName),
    correctionReason: normalizeText(row.correction_reason ?? row.correctionReason),
    createdByName: normalizeText(row.created_by_name ?? row.createdByName),
    createdAt: row.created_at ?? row.createdAt ?? '',
  }
}

function normalizeScorerInterest(row) {
  const player = Array.isArray(row.parent_player_links?.players)
    ? row.parent_player_links.players[0]
    : row.parent_player_links?.players

  return {
    id: row.id ?? '',
    matchDayId: row.match_day_id ?? '',
    parentLinkId: row.parent_link_id ?? '',
    authUserId: row.auth_user_id ?? '',
    parentName: normalizeText(row.parent_name),
    parentEmail: normalizeText(row.parent_email),
    playerName: normalizeText(player?.player_name),
    message: normalizeText(row.message),
    status: normalizeText(row.status) || 'interested',
    createdAt: row.created_at ?? '',
  }
}

function normalizeScorerAssignment(row) {
  return {
    id: row.id ?? '',
    matchDayId: row.match_day_id ?? '',
    parentLinkId: row.parent_link_id ?? '',
    authUserId: row.auth_user_id ?? '',
    assignedByName: normalizeText(row.assigned_by_name),
    createdAt: row.created_at ?? '',
  }
}

function normalizeRoleAssignment(row) {
  const parentLink = Array.isArray(row.parent_player_links) ? row.parent_player_links[0] : row.parent_player_links
  const player = Array.isArray(parentLink?.players) ? parentLink.players[0] : parentLink?.players

  return {
    id: row.id ?? '',
    matchDayId: row.match_day_id ?? row.matchDayId ?? '',
    role: normalizeText(row.role),
    parentLinkId: row.parent_link_id ?? row.parentLinkId ?? '',
    authUserId: row.auth_user_id ?? row.authUserId ?? parentLink?.auth_user_id ?? '',
    parentEmail: normalizeText(row.parent_email ?? row.parentEmail ?? parentLink?.email),
    playerName: normalizeText(row.player_name ?? row.playerName ?? player?.player_name),
    assignedByName: normalizeText(row.assigned_by_name ?? row.assignedByName),
    isCurrentParent: row.is_current_parent === true || row.isCurrentParent === true,
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  }
}

function normalizeVolunteerResponse(value) {
  const normalizedValue = normalizeText(value)
  return ['yes', 'no', 'no_response'].includes(normalizedValue) ? normalizedValue : 'no_response'
}

function normalizeNonNegativeInteger(value) {
  const normalizedValue = Number.parseInt(value ?? 0, 10)

  if (!Number.isFinite(normalizedValue) || normalizedValue < 0) {
    return 0
  }

  return normalizedValue
}

function normalizeAvailabilityRequest(row) {
  const player = Array.isArray(row.players) ? row.players[0] : row.players
  const parentLink = Array.isArray(row.parent_player_links) ? row.parent_player_links[0] : row.parent_player_links
  const parentPlayer = Array.isArray(parentLink?.players) ? parentLink.players[0] : parentLink?.players
  const transportCanOfferLift = row.transport_can_offer_lift === true || row.transportCanOfferLift === true

  return {
    id: row.id ?? '',
    matchDayId: row.match_day_id ?? row.matchDayId ?? '',
    parentLinkId: row.parent_link_id ?? row.parentLinkId ?? '',
    authUserId: row.auth_user_id ?? parentLink?.auth_user_id ?? '',
    playerId: row.player_id ?? row.playerId ?? '',
    playerName: normalizeText(row.player_name ?? row.playerName ?? player?.player_name ?? parentPlayer?.player_name),
    recipientName: normalizeText(row.recipient_name ?? row.recipientName),
    recipientEmail: normalizeText(row.recipient_email ?? row.recipientEmail ?? parentLink?.email),
    recipientType: normalizeText(row.recipient_type ?? row.recipientType) || 'parent',
    status: normalizeText(row.status) || 'pending',
    respondedAt: row.responded_at ?? row.respondedAt ?? '',
    sentAt: row.sent_at ?? row.sentAt ?? '',
    volunteerScorerResponse: normalizeVolunteerResponse(row.volunteer_scorer_response ?? row.volunteerScorerResponse),
    volunteerLinesmanResponse: normalizeVolunteerResponse(row.volunteer_linesman_response ?? row.volunteerLinesmanResponse),
    volunteerRefereeResponse: normalizeVolunteerResponse(row.volunteer_referee_response ?? row.volunteerRefereeResponse),
    volunteerRespondedAt: row.volunteer_responded_at ?? row.volunteerRespondedAt ?? '',
    transportNeedsLift: row.transport_needs_lift === true || row.transportNeedsLift === true,
    transportCanOfferLift,
    transportSeatsOffered: transportCanOfferLift
      ? normalizeNonNegativeInteger(row.transport_seats_offered ?? row.transportSeatsOffered)
      : 0,
    transportRespondedAt: row.transport_responded_at ?? row.transportRespondedAt ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  }
}

function normalizePlayerAvailability(row) {
  return {
    id: row.id ?? '',
    matchDayId: row.match_day_id ?? row.matchDayId ?? '',
    playerId: row.player_id ?? row.playerId ?? '',
    playerName: normalizeText(row.player_name ?? row.playerName),
    status: normalizeText(row.status) || 'pending',
    selectedByParentLinkId: row.selected_by_parent_link_id ?? row.selectedByParentLinkId ?? '',
    selectedByRequestId: row.selected_by_request_id ?? row.selectedByRequestId ?? '',
    selectedByName: normalizeText(row.selected_by_name ?? row.selectedByName),
    selectedByEmail: normalizeText(row.selected_by_email ?? row.selectedByEmail),
    selectedAt: row.selected_at ?? row.selectedAt ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  }
}

function normalizeAvailabilityHistory(row) {
  return {
    id: row.id ?? '',
    matchDayId: row.match_day_id ?? row.matchDayId ?? '',
    playerId: row.player_id ?? row.playerId ?? '',
    requestId: row.request_id ?? row.requestId ?? '',
    parentLinkId: row.parent_link_id ?? row.parentLinkId ?? '',
    playerName: normalizeText(row.player_name ?? row.playerName),
    previousStatus: normalizeText(row.previous_status ?? row.previousStatus),
    status: normalizeText(row.status) || 'pending',
    selectedByName: normalizeText(row.selected_by_name ?? row.selectedByName),
    selectedByEmail: normalizeText(row.selected_by_email ?? row.selectedByEmail),
    notificationQueueId: row.notification_queue_id ?? row.notificationQueueId ?? '',
    notificationWarning: normalizeText(row.notification_warning ?? row.notificationWarning),
    createdAt: row.created_at ?? row.createdAt ?? '',
  }
}

function normalizeMatchDayEventLogEntry(row) {
  const player = Array.isArray(row.players) ? row.players[0] : row.players

  return {
    id: row.id ?? '',
    clubId: row.club_id ?? row.clubId ?? '',
    teamId: row.team_id ?? row.teamId ?? '',
    matchDayId: row.match_day_id ?? row.matchDayId ?? '',
    playerId: row.player_id ?? row.playerId ?? '',
    playerName: normalizeText(row.player_name ?? row.playerName ?? player?.player_name),
    actorUserId: row.actor_user_id ?? row.actorUserId ?? '',
    actorDisplayName: normalizeText(row.actor_display_name ?? row.actorDisplayName),
    actorRole: normalizeText(row.actor_role ?? row.actorRole),
    eventType: normalizeText(row.event_type ?? row.eventType),
    eventLabel: normalizeText(row.event_label ?? row.eventLabel),
    previousValue: row.previous_value ?? row.previousValue ?? null,
    newValue: row.new_value ?? row.newValue ?? null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    createdAt: row.created_at ?? row.createdAt ?? '',
  }
}

export function getInitialsFromFullName(value) {
  return normalizeText(value)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

export function normalizeMatchDay(row) {
  const team = Array.isArray(row.teams) ? row.teams[0] : row.teams
  const interests = Array.isArray(row.match_day_scorer_interest)
    ? row.match_day_scorer_interest.map(normalizeScorerInterest)
    : []
  const assignments = Array.isArray(row.match_day_scorer_assignments)
    ? row.match_day_scorer_assignments.map(normalizeScorerAssignment)
    : []
  const rawRoleAssignments = Array.isArray(row.match_day_role_assignments)
    ? row.match_day_role_assignments
    : Array.isArray(row.role_assignments)
      ? row.role_assignments
      : row.roleAssignments
  const roleAssignments = Array.isArray(rawRoleAssignments)
    ? rawRoleAssignments.map(normalizeRoleAssignment)
    : []
  const rawEvents = Array.isArray(row.match_day_events) ? row.match_day_events : row.events
  const events = Array.isArray(rawEvents) ? rawEvents.map(normalizeMatchDayEvent) : []
  const rawAvailabilityRequests = Array.isArray(row.match_day_availability_requests)
    ? row.match_day_availability_requests
    : row.availabilityRequests
  const availabilityRequests = Array.isArray(rawAvailabilityRequests)
    ? rawAvailabilityRequests.map(normalizeAvailabilityRequest)
    : []
  const playerAvailability = Array.isArray(row.match_day_player_availability)
    ? row.match_day_player_availability.map(normalizePlayerAvailability)
    : []
  const availabilityHistory = Array.isArray(row.match_day_player_availability_history)
    ? row.match_day_player_availability_history.map(normalizeAvailabilityHistory)
    : []
  const eventLog = Array.isArray(row.match_day_event_log)
    ? row.match_day_event_log.map(normalizeMatchDayEventLogEntry)
    : []

  return {
    id: row.id ?? '',
    clubId: row.club_id ?? row.clubId ?? '',
    teamId: row.team_id ?? row.teamId ?? '',
    teamName: normalizeText(team?.name ?? row.team_name ?? row.teamName),
    opponent: normalizeText(row.opponent),
    matchDate: row.match_date ?? row.matchDate ?? '',
    kickoffTime: row.kickoff_time ?? row.kickoffTime ?? '',
    arrivalTime: row.arrival_time ?? row.arrivalTime ?? '',
    homeAway: normalizeText(row.home_away ?? row.homeAway) || 'home',
    venueName: normalizeText(row.venue_name ?? row.venueName),
    venueAddress: normalizeText(row.venue_address ?? row.venueAddress),
    notes: normalizeText(row.notes),
    scorerRequestMessage: normalizeText(row.scorer_request_message ?? row.scorerRequestMessage),
    requestScorer: normalizeBoolean(row.request_scorer ?? row.requestScorer ?? row.status === 'scorer_request'),
    requestLinesman: normalizeBoolean(row.request_linesman ?? row.requestLinesman),
    requestReferee: normalizeBoolean(row.request_referee ?? row.requestReferee),
    parentVisible: row.parent_visible === true || row.parentVisible === true,
    parentAudience: normalizeParentAudience(row.parent_audience ?? row.parentAudience),
    status: normalizeText(row.status) || 'scheduled',
    homeScore: Number(row.home_score ?? row.homeScore ?? 0),
    awayScore: Number(row.away_score ?? row.awayScore ?? 0),
    phaseStartedAt: row.phase_started_at ?? row.phaseStartedAt ?? '',
    timerStartedAt: row.timer_started_at ?? row.timerStartedAt ?? '',
    timerPausedAt: row.timer_paused_at ?? row.timerPausedAt ?? '',
    timerElapsedSeconds: normalizeNonNegativeInteger(row.timer_elapsed_seconds ?? row.timerElapsedSeconds),
    timerStatus: normalizeTimerStatus(row.timer_status ?? row.timerStatus),
    enableMotmPoll: Boolean(row.enable_motm_poll ?? row.enableMotmPoll ?? true),
    motmPollExpiryHours: Number(row.motm_poll_expiry_hours ?? row.motmPollExpiryHours ?? 2),
    motmPollId: row.motm_poll_id ?? row.motmPollId ?? '',
    previousHiddenAt: row.previous_hidden_at ?? row.previousHiddenAt ?? '',
    availabilityStatus: normalizeText(row.availability_status ?? row.availabilityStatus),
    availabilityRespondedAt: row.availability_responded_at ?? row.availabilityRespondedAt ?? '',
    volunteerScorerResponse: normalizeVolunteerResponse(row.volunteer_scorer_response ?? row.volunteerScorerResponse),
    volunteerLinesmanResponse: normalizeVolunteerResponse(row.volunteer_linesman_response ?? row.volunteerLinesmanResponse),
    volunteerRefereeResponse: normalizeVolunteerResponse(row.volunteer_referee_response ?? row.volunteerRefereeResponse),
    volunteerRespondedAt: row.volunteer_responded_at ?? row.volunteerRespondedAt ?? '',
    hasInterest: Boolean(row.has_interest ?? row.hasInterest),
    isScorer: Boolean(row.is_scorer ?? row.isScorer),
    createdByName: normalizeText(row.created_by_name ?? row.createdByName),
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
    scorerInterests: interests,
    scorerAssignments: assignments,
    roleAssignments,
    availabilityRequests,
    playerAvailability,
    availabilityHistory,
    eventLog,
    events,
  }
}

function assertStaffMatchDayAccess(user) {
  if (
    !user?.clubId ||
    !user.activeTeamId ||
    user.role === 'admin' ||
    user.role === 'parent_portal' ||
    user.role === 'super_admin' ||
    Number(user.roleRank ?? 0) < 20
  ) {
    throw new Error('Coach or manager access is required for Match Day.')
  }
}

function assertMatchInActiveTeamScope(user, match) {
  const activeTeamId = normalizeText(user?.activeTeamId)
  const matchTeamId = normalizeText(match?.teamId ?? match?.team_id)

  if (activeTeamId && matchTeamId && matchTeamId !== activeTeamId) {
    throw new Error('This match day is not linked to your active team.')
  }
}

function scopeMatchDayQueryToActiveTeam(query, user) {
  const activeTeamId = normalizeText(user?.activeTeamId)

  if (!activeTeamId) {
    return query.eq('team_id', '__no_active_team__')
  }

  return query.or(`team_id.is.null,team_id.eq.${activeTeamId}`)
}

async function assertMatchDayRecordInActiveTeamScope(user, matchId) {
  const normalizedMatchId = normalizeText(matchId)

  if (!normalizedMatchId) {
    throw new Error('Choose a match day first.')
  }

  let query = supabase
    .from('match_days')
    .select('id')
    .eq('id', normalizedMatchId)
    .eq('club_id', user.clubId)

  query = scopeMatchDayQueryToActiveTeam(query, user)

  const { data, error } = await query.maybeSingle()

  if (error) {
    console.error(error)
    throw error
  }

  if (!data?.id) {
    throw new Error('This match day is not linked to your active team.')
  }
}

function normalizeStatus(value) {
  const normalizedStatus = normalizeText(value)
  return MATCH_DAY_STATUS_OPTIONS.some((option) => option.value === normalizedStatus) ? normalizedStatus : 'scheduled'
}

function normalizeTimerStatus(value) {
  const normalizedStatus = normalizeText(value)
  return MATCH_DAY_TIMER_STATUSES.has(normalizedStatus) ? normalizedStatus : 'not_started'
}

function normalizeHomeAway(value) {
  const normalizedHomeAway = normalizeText(value)
  return MATCH_DAY_HOME_AWAY_OPTIONS.some((option) => option.value === normalizedHomeAway) ? normalizedHomeAway : 'home'
}

function buildMatchSelect() {
  return `
    *,
    teams:team_id (name),
    match_day_scorer_interest (*, parent_player_links:parent_link_id (players:player_id (player_name))),
    match_day_scorer_assignments (*),
    match_day_role_assignments (*, parent_player_links:parent_link_id (email, auth_user_id, players:player_id (player_name))),
    match_day_player_availability (*),
    match_day_player_availability_history (*),
    match_day_availability_requests (*, players:player_id (player_name), parent_player_links:parent_link_id (email, auth_user_id, players:player_id (player_name))),
    match_day_event_log (*, players:player_id (player_name)),
    match_day_events (*)
  `
}

function normalizeTeamIdForMatch(user, match) {
  if (user.activeTeamId) {
    return user.activeTeamId
  }

  return normalizeText(match?.teamId) || null
}

function getActorRole(user) {
  return normalizeText(user?.roleLabel || user?.role)
}

function normalizeEventLogType(eventType) {
  const normalizedEventType = normalizeText(eventType)
  return MATCH_DAY_EVENT_LOG_TYPES.has(normalizedEventType) ? normalizedEventType : 'match_day_updated'
}

function getMatchDayEventLogLabel(eventType, fallbackLabel = '') {
  const label = normalizeText(fallbackLabel)

  if (label) {
    return label
  }

  switch (eventType) {
    case 'match_day_created':
      return 'Fixture created'
    case 'player_selected':
      return 'Player selected'
    case 'player_deselected':
      return 'Player deselected'
    case 'player_availability_changed':
      return 'Availability changed'
    case 'match_role_assigned':
      return 'Volunteer role assigned'
    case 'match_role_removed':
      return 'Volunteer role removed'
    case 'scorer_updated':
      return 'Scorer updated'
    case 'linesman_updated':
      return 'Linesman updated'
    case 'invite_prepared':
      return 'Invite prepared'
    case 'invite_queued':
      return 'Invite queued'
    case 'note_updated':
      return 'Note updated'
    case 'yellow_card':
      return 'Yellow card'
    case 'red_card':
      return 'Red card'
    case 'substitution':
      return 'Substitution'
    case 'water_break':
      return 'Water break'
    case 'match_day_updated':
    default:
      return 'Fixture updated'
  }
}

function sanitizeEventLogObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const nextValue = {}
  Object.entries(value).forEach(([key, itemValue]) => {
    if (itemValue === undefined) {
      return
    }

    nextValue[key] = itemValue
  })

  return Object.keys(nextValue).length > 0 ? nextValue : null
}

function buildMatchDaySnapshot(row) {
  if (!row) {
    return null
  }

  return sanitizeEventLogObject({
    opponent: normalizeText(row.opponent),
    matchDate: row.match_date ?? null,
    kickoffTime: row.kickoff_time ?? null,
    arrivalTime: row.arrival_time ?? null,
    homeAway: normalizeText(row.home_away),
    venueName: normalizeText(row.venue_name),
    venueAddress: normalizeText(row.venue_address),
    notes: normalizeText(row.notes),
    scorerRequestMessage: normalizeText(row.scorer_request_message),
    requestScorer: row.request_scorer === true,
    requestLinesman: row.request_linesman === true,
    requestReferee: row.request_referee === true,
    parentVisible: row.parent_visible === true,
    parentAudience: normalizeText(row.parent_audience),
    status: normalizeText(row.status),
    homeScore: Number(row.home_score ?? 0),
    awayScore: Number(row.away_score ?? 0),
  })
}

function buildMatchDaySnapshotFromMatch(match) {
  if (!match) {
    return null
  }

  return sanitizeEventLogObject({
    opponent: normalizeText(match.opponent),
    matchDate: match.matchDate || null,
    kickoffTime: match.kickoffTime || null,
    arrivalTime: match.arrivalTime || null,
    homeAway: normalizeText(match.homeAway),
    venueName: normalizeText(match.venueName),
    venueAddress: normalizeText(match.venueAddress),
    notes: normalizeText(match.notes),
    scorerRequestMessage: normalizeText(match.scorerRequestMessage),
    requestScorer: match.requestScorer === true,
    requestLinesman: match.requestLinesman === true,
    requestReferee: match.requestReferee === true,
    parentVisible: match.parentVisible === true,
    parentAudience: normalizeText(match.parentAudience),
    status: normalizeText(match.status),
    homeScore: Number(match.homeScore ?? 0),
    awayScore: Number(match.awayScore ?? 0),
  })
}

function buildChangedSnapshot(previousValue, newValue) {
  const previousChanges = {}
  const newChanges = {}
  const keys = new Set([
    ...Object.keys(previousValue ?? {}),
    ...Object.keys(newValue ?? {}),
  ])

  keys.forEach((key) => {
    const previousItem = previousValue?.[key] ?? null
    const newItem = newValue?.[key] ?? null

    if (JSON.stringify(previousItem) !== JSON.stringify(newItem)) {
      previousChanges[key] = previousItem
      newChanges[key] = newItem
    }
  })

  return {
    previousValue: sanitizeEventLogObject(previousChanges),
    newValue: sanitizeEventLogObject(newChanges),
  }
}

async function getMatchDayEventLogSnapshot({ user, matchId }) {
  const normalizedMatchId = normalizeText(matchId)

  if (!normalizedMatchId) {
    return null
  }

  let query = supabase
    .from('match_days')
    .select('opponent, match_date, kickoff_time, arrival_time, home_away, venue_name, venue_address, notes, scorer_request_message, request_scorer, request_linesman, request_referee, parent_visible, parent_audience, status, home_score, away_score')
    .eq('id', normalizedMatchId)
    .eq('club_id', user.clubId)

  query = scopeMatchDayQueryToActiveTeam(query, user)

  const { data, error } = await query.maybeSingle()

  if (error) {
    console.warn('Match Day event log snapshot could not be loaded', error)
    return null
  }

  return buildMatchDaySnapshot(data)
}

export async function createMatchDayEventLogEntry({
  eventLabel = '',
  eventType = 'match_day_updated',
  match,
  metadata = {},
  newValue = null,
  playerId = null,
  previousValue = null,
  user,
} = {}) {
  const normalizedEventType = normalizeEventLogType(eventType)
  const matchDayId = normalizeText(match?.id ?? match?.matchDayId)
  const teamId = normalizeText(match?.teamId ?? match?.team_id ?? user?.activeTeamId)

  if (!user?.clubId || !matchDayId || !teamId) {
    return null
  }

  const { data, error } = await supabase
    .from('match_day_event_log')
    .insert({
      club_id: user.clubId,
      team_id: teamId,
      match_day_id: matchDayId,
      player_id: normalizeText(playerId) || null,
      actor_user_id: getEntryUserId(user) || null,
      actor_display_name: getEntryUserName(user),
      actor_role: getActorRole(user),
      event_type: normalizedEventType,
      event_label: getMatchDayEventLogLabel(normalizedEventType, eventLabel),
      previous_value: sanitizeEventLogObject(previousValue),
      new_value: sanitizeEventLogObject(newValue),
      metadata: sanitizeEventLogObject(metadata) || {},
    })
    .select('*')
    .single()

  if (error) {
    console.warn('Match Day event log write failed', error)
    return null
  }

  return normalizeMatchDayEventLogEntry(data)
}

export async function getMatchDays({ user } = {}) {
  assertStaffMatchDayAccess(user)

  let query = supabase
    .from('match_days')
    .select(buildMatchSelect())
    .eq('club_id', user.clubId)
    .order('match_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (user.activeTeamId) {
    query = query.or(`team_id.is.null,team_id.eq.${user.activeTeamId}`)
  }

  const { data, error } = await query

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeMatchDay)
}

export async function getMatchLocations({ user } = {}) {
  assertStaffMatchDayAccess(user)

  const { data, error } = await supabase
    .from('match_locations')
    .select('*')
    .eq('club_id', user.clubId)
    .order('name', { ascending: true })

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: normalizeText(row.name),
    address: normalizeText(row.address),
    notes: normalizeText(row.notes),
  }))
}

export async function createMatchDay({ user, match }) {
  await blockDemoMutation(user)
  assertStaffMatchDayAccess(user)

  const opponent = normalizeText(match?.opponent)
  const venueName = normalizeText(match?.venueName)
  const venueAddress = normalizeText(match?.venueAddress)
  const teamId = normalizeTeamIdForMatch(user, match)
  const { parentVisible, parentAudience } = buildMatchDayParentVisibility(match)
  const requestScorer = shouldRequestScorer(match)
  const requestLinesman = normalizeBoolean(match?.requestLinesman)
  const requestReferee = normalizeBoolean(match?.requestReferee)

  if (!opponent) {
    throw new Error('Opponent is required.')
  }

  assertMatchDayDateTimeIsCurrentOrFuture(match?.matchDate, match?.kickoffTime)

  if (parentVisible && parentAudience === 'all_team_parents' && !teamId) {
    throw new Error('Choose a team before sharing this fixture with all team parents.')
  }

  const { data: locationId, error: locationError } = await supabase.rpc('upsert_match_location', {
    club_id_value: user.clubId,
    name_value: venueName,
    address_value: venueAddress,
    notes_value: '',
  })

  if (locationError) {
    console.error(locationError)
    throw locationError
  }

  const { data, error } = await supabase
    .from('match_days')
    .insert({
      club_id: user.clubId,
      team_id: teamId,
      location_id: locationId || null,
      opponent,
      match_date: normalizeDateOnly(match?.matchDate) || null,
      kickoff_time: normalizeTime(match?.kickoffTime) || null,
      arrival_time: normalizeTime(match?.arrivalTime) || null,
      home_away: normalizeHomeAway(match?.homeAway),
      venue_name: venueName,
      venue_address: venueAddress,
      notes: normalizeText(match?.notes),
      scorer_request_message: normalizeText(match?.scorerRequestMessage),
      request_scorer: requestScorer,
      request_linesman: requestLinesman,
      request_referee: requestReferee,
      parent_visible: parentVisible,
      parent_audience: parentAudience,
      status: normalizeStatus(match?.status || (requestScorer ? 'scorer_request' : 'scheduled')),
      enable_motm_poll: Boolean(match?.enableMotmPoll ?? true),
      motm_poll_expiry_hours: Math.max(Number(match?.motmPollExpiryHours ?? 2), 1),
      created_by: getEntryUserId(user),
      created_by_name: getEntryUserName(user),
    })
    .select(buildMatchSelect())
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  clearViewCaches()
  invalidateMemoryCacheByPrefix('match-day:')
  await createAuditLog({
    user,
    action: 'match_day_created',
    entityType: 'match_day',
    entityId: data.id,
    metadata: {
      opponent,
      teamId,
      venueName,
    },
  })
  await createMatchDayEventLogEntry({
    user,
    match: data,
    eventType: 'match_day_created',
    eventLabel: 'Fixture created',
    newValue: buildMatchDaySnapshot(data),
    metadata: {
      source: 'staff_match_day',
    },
  })

  return normalizeMatchDay(data)
}

export async function updateMatchDay({ user, matchId, updates }) {
  await blockDemoMutation(user)
  assertStaffMatchDayAccess(user)
  const previousSnapshot = await getMatchDayEventLogSnapshot({ user, matchId })

  const payload = {
    updated_at: new Date().toISOString(),
  }

  if (updates.opponent !== undefined) payload.opponent = normalizeText(updates.opponent)
  if (updates.matchDate !== undefined) {
    assertMatchDayDateIsCurrentOrFuture(updates.matchDate)
    payload.match_date = normalizeDateOnly(updates.matchDate) || null
  }
  if (updates.kickoffTime !== undefined) payload.kickoff_time = normalizeTime(updates.kickoffTime) || null
  if (updates.arrivalTime !== undefined) payload.arrival_time = normalizeTime(updates.arrivalTime) || null
  if (updates.homeAway !== undefined) payload.home_away = normalizeHomeAway(updates.homeAway)
  if (updates.venueName !== undefined) payload.venue_name = normalizeText(updates.venueName)
  if (updates.venueAddress !== undefined) payload.venue_address = normalizeText(updates.venueAddress)
  if (updates.notes !== undefined) payload.notes = normalizeText(updates.notes)
  if (updates.scorerRequestMessage !== undefined) payload.scorer_request_message = normalizeText(updates.scorerRequestMessage)
  if (updates.requestScorer !== undefined) payload.request_scorer = normalizeBoolean(updates.requestScorer)
  if (updates.requestLinesman !== undefined) payload.request_linesman = normalizeBoolean(updates.requestLinesman)
  if (updates.requestReferee !== undefined) payload.request_referee = normalizeBoolean(updates.requestReferee)
  if (updates.parentVisible !== undefined) {
    payload.parent_visible = updates.parentVisible !== false
    if (updates.parentVisible === false) {
      payload.parent_audience = 'none'
    }
  }
  if (updates.parentAudience !== undefined) payload.parent_audience = updates.parentVisible === false ? 'none' : normalizeParentAudience(updates.parentAudience)
  if (updates.status !== undefined) payload.status = normalizeStatus(updates.status)
  if (updates.homeScore !== undefined) payload.home_score = Math.max(Number(updates.homeScore ?? 0), 0)
  if (updates.awayScore !== undefined) payload.away_score = Math.max(Number(updates.awayScore ?? 0), 0)
  if (updates.phaseStartedAt !== undefined) payload.phase_started_at = updates.phaseStartedAt || null

  if (payload.venue_name) {
    const { data: locationId, error: locationError } = await supabase.rpc('upsert_match_location', {
      club_id_value: user.clubId,
      name_value: payload.venue_name,
      address_value: payload.venue_address ?? '',
      notes_value: '',
    })

    if (locationError) {
      console.error(locationError)
      throw locationError
    }

    payload.location_id = locationId || null
  }

  let query = supabase
    .from('match_days')
    .update(payload)
    .eq('id', matchId)
    .eq('club_id', user.clubId)

  query = scopeMatchDayQueryToActiveTeam(query, user)

  const { data, error } = await query
    .select(buildMatchSelect())
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('match-day:')
  const normalizedMatch = normalizeMatchDay(data)
  const nextSnapshot = buildMatchDaySnapshotFromMatch(normalizedMatch)
  const { previousValue, newValue } = buildChangedSnapshot(previousSnapshot, nextSnapshot)
  const updatedFields = Object.keys(newValue ?? {})
  const eventType = updatedFields.length === 1 && updatedFields.includes('notes') ? 'note_updated' : 'match_day_updated'

  await createMatchDayEventLogEntry({
    user,
    match: normalizedMatch,
    eventType,
    eventLabel: eventType === 'note_updated' ? 'Note updated' : 'Fixture updated',
    previousValue,
    newValue,
    metadata: {
      fields: updatedFields,
      source: 'staff_match_day',
    },
  })

  return normalizedMatch
}

function normalizeMatchDayTimerResult(data, fallbackMatch = {}) {
  const result = data ?? {}

  return {
    id: result.id ?? result.matchDayId ?? result.match_day_id ?? fallbackMatch.id ?? '',
    status: normalizeStatus(result.status ?? fallbackMatch.status),
    phaseStartedAt: result.phaseStartedAt ?? result.phase_started_at ?? fallbackMatch.phaseStartedAt ?? '',
    timerStartedAt: result.timerStartedAt ?? result.timer_started_at ?? '',
    timerPausedAt: result.timerPausedAt ?? result.timer_paused_at ?? '',
    timerElapsedSeconds: normalizeNonNegativeInteger(result.timerElapsedSeconds ?? result.timer_elapsed_seconds),
    timerStatus: normalizeTimerStatus(result.timerStatus ?? result.timer_status),
    updatedAt: result.updatedAt ?? result.updated_at ?? '',
  }
}

export async function setMatchDayTimerState({ user, match, matchId, action }) {
  await blockDemoMutation(user)
  assertStaffMatchDayAccess(user)

  const normalizedMatchId = normalizeText(match?.id ?? matchId)
  const normalizedAction = normalizeText(action)

  if (!normalizedMatchId) {
    throw new Error('Choose a match day first.')
  }

  if (!MATCH_DAY_TIMER_ACTIONS.has(normalizedAction)) {
    throw new Error('Choose a supported match clock action.')
  }

  if (match?.id) {
    assertMatchInActiveTeamScope(user, match)
  }

  await assertMatchDayRecordInActiveTeamScope(user, normalizedMatchId)

  const { data, error } = await supabase.rpc('set_match_day_timer_state', {
    match_day_id_value: normalizedMatchId,
    action_value: normalizedAction,
  })

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('match-day:')
  invalidateMemoryCacheByPrefix('parent-match-day:')
  return normalizeMatchDayTimerResult(data, match)
}

const MATCH_DAY_VOLUNTEER_ROLES = new Set(['scorer', 'linesman', 'referee'])

export async function selectMatchDayVolunteer({ user, match, volunteer, role = 'scorer', selected = true }) {
  await blockDemoMutation(user)
  assertStaffMatchDayAccess(user)
  assertMatchInActiveTeamScope(user, match)

  const normalizedRole = normalizeText(role)

  if (!MATCH_DAY_VOLUNTEER_ROLES.has(normalizedRole)) {
    throw new Error('Choose a valid volunteer role.')
  }

  if (!match?.id || !volunteer?.requestId) {
    throw new Error('Choose a volunteer response first.')
  }

  await assertMatchDayRecordInActiveTeamScope(user, match.id)

  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token || ''

  if (!accessToken) {
    throw new Error('Login is required.')
  }

  const response = await fetch('/.netlify/functions/select-match-day-volunteer', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      matchDayId: match.id,
      requestId: volunteer.requestId,
      role: normalizedRole,
      selected: selected !== false,
    }),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok || result.success === false) {
    throw new Error(result.message || 'Volunteer selection could not be updated.')
  }

  invalidateMemoryCacheByPrefix('match-day:')
  return result
}

export async function selectMatchDayScorer({ user, match, interest }) {
  assertMatchInActiveTeamScope(user, match)
  return selectMatchDayVolunteer({ user, match, volunteer: interest, role: 'scorer', selected: true })
}

export async function addStaffMatchDayGoal({ user, match, goal }) {
  await blockDemoMutation(user)
  assertStaffMatchDayAccess(user)
  assertMatchInActiveTeamScope(user, match)

  if (['scheduled', 'scorer_request'].includes(normalizeText(match.status))) {
    await setMatchDayTimerState({ user, match, action: 'start' })
  }

  const teamSide = normalizeText(goal?.teamSide) === 'opponent' ? 'opponent' : 'club'
  let nextHomeScore = Number(match.homeScore ?? 0)
  let nextAwayScore = Number(match.awayScore ?? 0)

  if (teamSide === 'club') {
    if (match.homeAway === 'away') {
      nextAwayScore += 1
    } else {
      nextHomeScore += 1
    }
  } else if (match.homeAway === 'away') {
    nextHomeScore += 1
  } else {
    nextAwayScore += 1
  }

  const payload = {
    match_day_id: match.id,
    club_id: match.clubId,
    team_id: match.teamId || null,
    event_type: 'goal',
    team_side: teamSide,
    minute: goal?.minute ? Number(goal.minute) : null,
    scorer_name: normalizeText(goal?.scorerName),
    scorer_initials: getInitialsFromFullName(goal?.scorerName),
    scorer_shirt_number: normalizeText(goal?.scorerShirtNumber),
    assist_name: normalizeText(goal?.assistName),
    assist_initials: getInitialsFromFullName(goal?.assistName),
    assist_shirt_number: normalizeText(goal?.assistShirtNumber),
    home_score: nextHomeScore,
    away_score: nextAwayScore,
    notes: normalizeText(goal?.notes),
    created_by: getEntryUserId(user),
    created_by_name: getEntryUserName(user),
  }

  let matchUpdateQuery = supabase
    .from('match_days')
    .update({
      home_score: nextHomeScore,
      away_score: nextAwayScore,
      status: ['scheduled', 'scorer_request'].includes(match.status) ? 'live' : match.status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', match.id)
    .eq('club_id', user.clubId)

  matchUpdateQuery = scopeMatchDayQueryToActiveTeam(matchUpdateQuery, user)

  const { data: updatedMatch, error: updateError } = await matchUpdateQuery
    .select('id')
    .single()

  if (updateError) {
    console.error(updateError)
    throw updateError
  }

  if (!updatedMatch?.id) {
    throw new Error('This match day is not linked to your active team.')
  }

  const { data, error } = await supabase
    .from('match_day_events')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('match-day:')
  await createMatchDayEventLogEntry({
    user,
    match,
    eventType: 'scorer_updated',
    eventLabel: 'Goal added',
    previousValue: {
      homeScore: Number(match.homeScore ?? 0),
      awayScore: Number(match.awayScore ?? 0),
      status: normalizeText(match.status),
    },
    newValue: {
      homeScore: nextHomeScore,
      awayScore: nextAwayScore,
      status: ['scheduled', 'scorer_request'].includes(match.status) ? 'live' : match.status,
    },
    metadata: {
      goalEventId: data.id,
      teamSide,
      minute: payload.minute,
      scorerName: payload.scorer_name,
      source: 'staff_match_day',
    },
  })
  return normalizeMatchDayEvent(data)
}

export async function resetPreviousMatchDayResults({ user, teamId = '' } = {}) {
  await blockDemoMutation(user)
  assertStaffMatchDayAccess(user)

  let query = supabase
    .from('match_days')
    .update({
      previous_hidden_at: new Date().toISOString(),
      previous_hidden_by: getEntryUserId(user),
      updated_at: new Date().toISOString(),
    })
    .eq('club_id', user.clubId)
    .eq('status', 'full_time')
    .is('previous_hidden_at', null)

  const normalizedTeamId = normalizeText(teamId) || user.activeTeamId || ''

  if (normalizedTeamId && normalizedTeamId !== user.activeTeamId) {
    throw new Error('This match day is not linked to your active team.')
  }

  if (normalizedTeamId) {
    query = query.eq('team_id', normalizedTeamId)
  }

  const { error } = await query

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('match-day:')
}

export async function getParentPortalMatchDays({ parentLinkId }) {
  const normalizedParentLinkId = normalizeText(parentLinkId)

  if (!normalizedParentLinkId) {
    return []
  }

  const { data, error } = await supabase.rpc('get_parent_portal_match_days', {
    parent_link_id_value: normalizedParentLinkId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeMatchDay)
}

export async function getParentPortalMatchDayPlayers({ parentLinkId }) {
  const normalizedParentLinkId = normalizeText(parentLinkId)

  if (!normalizedParentLinkId) {
    return []
  }

  const { data, error } = await supabase.rpc('get_parent_portal_match_day_players', {
    parent_link_id_value: normalizedParentLinkId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map((row) => ({
    id: row.id ?? '',
    playerName: normalizeText(row.player_name ?? row.playerName),
    shirtNumber: normalizeText(row.shirt_number ?? row.shirtNumber),
    status: normalizeText(row.status) || 'active',
  }))
}

export async function expressMatchDayScorerInterest({ parentLinkId, matchDayId, message = '' }) {
  const { data, error } = await supabase.rpc('express_match_day_scorer_interest', {
    parent_link_id_value: parentLinkId,
    match_day_id_value: matchDayId,
    message_value: message,
  })

  if (error) {
    console.error(error)
    throw error
  }

  return data
}

export async function updateMatchDayScoreAsScorer({ parentLinkId, matchDayId, homeScore, awayScore, status }) {
  const { data, error } = await supabase.rpc('update_match_day_score_as_scorer', {
    parent_link_id_value: parentLinkId,
    match_day_id_value: matchDayId,
    home_score_value: Number(homeScore ?? 0),
    away_score_value: Number(awayScore ?? 0),
    status_value: normalizeText(status) || null,
  })

  if (error) {
    console.error(error)
    throw error
  }

  return data
}

function normalizeGoalCorrectionResult(data) {
  const result = data ?? {}
  const event = result.event ? normalizeMatchDayEvent(result.event) : null

  return {
    matchDayId: result.matchDayId ?? result.match_day_id ?? event?.matchDayId ?? '',
    homeScore: Number(result.homeScore ?? result.home_score ?? event?.homeScore ?? 0),
    awayScore: Number(result.awayScore ?? result.away_score ?? event?.awayScore ?? 0),
    status: normalizeText(result.status),
    event,
  }
}

function buildGoalCorrectionPayload({ match, event, parentLinkId = '', goal = {}, reason = '' }) {
  const sourceEvent = event || {}

  return {
    match_day_id_value: match?.id || sourceEvent.matchDayId || sourceEvent.match_day_id,
    goal_event_id_value: sourceEvent.id,
    parent_link_id_value: normalizeText(parentLinkId) || null,
    team_side_value: normalizeText(goal?.teamSide ?? sourceEvent.teamSide ?? sourceEvent.team_side) === 'opponent' ? 'opponent' : 'club',
    scorer_name_value: normalizeText(goal?.scorerName ?? sourceEvent.scorerName ?? sourceEvent.scorer_name),
    scorer_shirt_number_value: normalizeText(goal?.scorerShirtNumber ?? sourceEvent.scorerShirtNumber ?? sourceEvent.scorer_shirt_number),
    assist_name_value: normalizeText(goal?.assistName ?? sourceEvent.assistName ?? sourceEvent.assist_name),
    assist_shirt_number_value: normalizeText(goal?.assistShirtNumber ?? sourceEvent.assistShirtNumber ?? sourceEvent.assist_shirt_number),
    minute_value: goal?.minute === '' || goal?.minute === null || goal?.minute === undefined ? null : Number(goal.minute),
    notes_value: normalizeText(goal?.notes ?? sourceEvent.notes),
    correction_reason_value: normalizeText(reason),
  }
}

export async function correctStaffMatchDayGoal({ user, match, event, goal, reason = '' }) {
  await blockDemoMutation(user)
  assertStaffMatchDayAccess(user)
  assertMatchInActiveTeamScope(user, match)

  const { data, error } = await supabase.rpc('correct_match_day_goal', buildGoalCorrectionPayload({
    match,
    event,
    goal,
    reason,
  }))

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('match-day:')
  return normalizeGoalCorrectionResult(data)
}

export async function voidStaffMatchDayGoal({ user, match, event, reason = '' }) {
  await blockDemoMutation(user)
  assertStaffMatchDayAccess(user)
  assertMatchInActiveTeamScope(user, match)

  const { data, error } = await supabase.rpc('void_match_day_goal', {
    match_day_id_value: match?.id || event?.matchDayId || event?.match_day_id,
    goal_event_id_value: event?.id,
    parent_link_id_value: null,
    reason_value: normalizeText(reason),
  })

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('match-day:')
  return normalizeGoalCorrectionResult(data)
}

export async function addStaffMatchDayEvent({ user, match, event }) {
  await blockDemoMutation(user)
  assertStaffMatchDayAccess(user)
  assertMatchInActiveTeamScope(user, match)

  const eventType = normalizeText(event?.eventType)
  if (!MATCH_DAY_STAFF_EVENT_TYPES.has(eventType)) {
    throw new Error('Choose a supported Match Day event type.')
  }

  const payload = {
    match_day_id: match.id,
    club_id: match.clubId,
    team_id: match.teamId || null,
    event_type: eventType,
    team_side: normalizeText(event?.teamSide) === 'opponent' ? 'opponent' : 'club',
    minute: event?.minute ? Number(event.minute) : null,
    scorer_name: normalizeText(event?.playerName),
    scorer_initials: getInitialsFromFullName(event?.playerName),
    scorer_shirt_number: normalizeText(event?.playerShirtNumber),
    assist_name: '',
    assist_initials: '',
    assist_shirt_number: '',
    home_score: Number(match.homeScore ?? 0),
    away_score: Number(match.awayScore ?? 0),
    notes: normalizeText(event?.notes),
    created_by: getEntryUserId(user),
    created_by_name: getEntryUserName(user),
  }

  const { data, error } = await supabase
    .from('match_day_events')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('match-day:')
  await createMatchDayEventLogEntry({
    user,
    match,
    eventType,
    eventLabel: getMatchDayEventLogLabel(eventType),
    previousValue: null,
    newValue: {
      eventType,
      teamSide: payload.team_side,
      minute: payload.minute,
      playerName: payload.scorer_name,
      notes: payload.notes,
    },
    metadata: {
      matchEventId: data.id,
      teamSide: payload.team_side,
      minute: payload.minute,
      playerName: payload.scorer_name,
      source: 'staff_match_day',
    },
  })

  return data
}

export async function addMatchDayGoalAsScorer({ parentLinkId, matchDayId, goal }) {
  const { data, error } = await supabase.rpc('add_match_day_goal_as_scorer', {
    parent_link_id_value: parentLinkId,
    match_day_id_value: matchDayId,
    team_side_value: normalizeText(goal?.teamSide) === 'opponent' ? 'opponent' : 'club',
    scorer_name_value: normalizeText(goal?.scorerName),
    scorer_shirt_number_value: normalizeText(goal?.scorerShirtNumber),
    assist_name_value: normalizeText(goal?.assistName),
    assist_shirt_number_value: normalizeText(goal?.assistShirtNumber),
    minute_value: goal?.minute ? Number(goal.minute) : null,
    notes_value: normalizeText(goal?.notes),
  })

  if (error) {
    console.error(error)
    throw error
  }

  return data
}

export async function correctMatchDayGoalAsScorer({ parentLinkId, match, event, goal, reason = '' }) {
  const { data, error } = await supabase.rpc('correct_match_day_goal', buildGoalCorrectionPayload({
    parentLinkId,
    match,
    event,
    goal,
    reason,
  }))

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('parent-match-day:')
  return normalizeGoalCorrectionResult(data)
}

export async function voidMatchDayGoalAsScorer({ parentLinkId, match, event, reason = '' }) {
  const { data, error } = await supabase.rpc('void_match_day_goal', {
    match_day_id_value: match?.id || event?.matchDayId || event?.match_day_id,
    goal_event_id_value: event?.id,
    parent_link_id_value: parentLinkId,
    reason_value: normalizeText(reason),
  })

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('parent-match-day:')
  return normalizeGoalCorrectionResult(data)
}
