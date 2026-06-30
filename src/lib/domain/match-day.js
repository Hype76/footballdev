import { supabase } from '../supabase-client.js'
import { clearViewCaches, invalidateMemoryCacheByPrefix } from './cache-store.js'
import { blockDemoMutation } from './demo-guards.js'
import { createAuditLog } from './audit.js'
import { getEntryUserId, getEntryUserName } from './core-normalizers.js'
import { buildMatchDayParentVisibility } from '../matchday-parent-visibility.js'

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

function assertMatchDayDateIsCurrentOrFuture(matchDate) {
  if (isPastMatchDayDate(matchDate)) {
    throw new Error('Match Day date must be today or in the future.')
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
    matchDayId: row.match_day_id ?? '',
    role: normalizeText(row.role),
    parentLinkId: row.parent_link_id ?? '',
    authUserId: row.auth_user_id ?? parentLink?.auth_user_id ?? '',
    parentEmail: normalizeText(parentLink?.email),
    playerName: normalizeText(player?.player_name),
    assignedByName: normalizeText(row.assigned_by_name),
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? '',
  }
}

function normalizeVolunteerResponse(value) {
  const normalizedValue = normalizeText(value)
  return ['yes', 'no', 'no_response'].includes(normalizedValue) ? normalizedValue : 'no_response'
}

function normalizeAvailabilityRequest(row) {
  const player = Array.isArray(row.players) ? row.players[0] : row.players
  const parentLink = Array.isArray(row.parent_player_links) ? row.parent_player_links[0] : row.parent_player_links
  const parentPlayer = Array.isArray(parentLink?.players) ? parentLink.players[0] : parentLink?.players

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
    createdAt: row.created_at ?? row.createdAt ?? '',
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
  const roleAssignments = Array.isArray(row.match_day_role_assignments)
    ? row.match_day_role_assignments.map(normalizeRoleAssignment)
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
    match_day_events (*)
  `
}

function normalizeTeamIdForMatch(user, match) {
  if (user.activeTeamId) {
    return user.activeTeamId
  }

  return normalizeText(match?.teamId) || null
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

  assertMatchDayDateIsCurrentOrFuture(match?.matchDate)

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

  return normalizeMatchDay(data)
}

export async function updateMatchDay({ user, matchId, updates }) {
  await blockDemoMutation(user)
  assertStaffMatchDayAccess(user)

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
  return normalizeMatchDay(data)
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

  if (!match?.id || !volunteer?.parentLinkId) {
    throw new Error('Choose a volunteer parent first.')
  }

  await assertMatchDayRecordInActiveTeamScope(user, match.id)

  if (selected === false) {
    const { error: deleteRoleError } = await supabase
      .from('match_day_role_assignments')
      .delete()
      .eq('match_day_id', match.id)
      .eq('role', normalizedRole)

    if (deleteRoleError) {
      console.error(deleteRoleError)
      throw deleteRoleError
    }

    if (normalizedRole === 'scorer') {
      const { error: deleteScorerError } = await supabase
        .from('match_day_scorer_assignments')
        .delete()
        .eq('match_day_id', match.id)

      if (deleteScorerError) {
        console.error(deleteScorerError)
        throw deleteScorerError
      }
    }

    invalidateMemoryCacheByPrefix('match-day:')
    return
  }

  const assignmentPayload = {
    match_day_id: match.id,
    club_id: match.clubId,
    team_id: match.teamId || null,
    role: normalizedRole,
    parent_link_id: volunteer.parentLinkId,
    auth_user_id: volunteer.authUserId || null,
    assigned_by: getEntryUserId(user),
    assigned_by_name: getEntryUserName(user),
    updated_at: new Date().toISOString(),
  }

  const { error: roleError } = await supabase
    .from('match_day_role_assignments')
    .upsert(assignmentPayload, {
      onConflict: 'match_day_id,role',
    })

  if (roleError) {
    console.error(roleError)
    throw roleError
  }

  if (normalizedRole === 'scorer') {
    const { error: deleteError } = await supabase
      .from('match_day_scorer_assignments')
      .delete()
      .eq('match_day_id', match.id)

    if (deleteError) {
      console.error(deleteError)
      throw deleteError
    }

    const { error: insertError } = await supabase
      .from('match_day_scorer_assignments')
      .insert({
        match_day_id: match.id,
        club_id: match.clubId,
        team_id: match.teamId || null,
        parent_link_id: volunteer.parentLinkId,
        auth_user_id: volunteer.authUserId || null,
        assigned_by: getEntryUserId(user),
        assigned_by_name: getEntryUserName(user),
      })

    if (insertError) {
      console.error(insertError)
      throw insertError
    }

    if (volunteer.id) {
      const { error: updateError } = await supabase
        .from('match_day_scorer_interest')
        .update({
          status: 'selected',
          updated_at: new Date().toISOString(),
        })
        .eq('id', volunteer.id)

      if (updateError) {
        console.error(updateError)
        throw updateError
      }
    }
  }

  invalidateMemoryCacheByPrefix('match-day:')
}

export async function selectMatchDayScorer({ user, match, interest }) {
  assertMatchInActiveTeamScope(user, match)
  return selectMatchDayVolunteer({ user, match, volunteer: interest, role: 'scorer', selected: true })
}

export async function addStaffMatchDayGoal({ user, match, goal }) {
  await blockDemoMutation(user)
  assertStaffMatchDayAccess(user)
  assertMatchInActiveTeamScope(user, match)

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
