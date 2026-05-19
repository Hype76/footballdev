import { supabase } from '../supabase-client.js'
import { clearViewCaches, invalidateMemoryCacheByPrefix } from './cache-store.js'
import { blockDemoMutation } from './demo-guards.js'
import { createAuditLog } from './audit.js'
import { getEntryUserId, getEntryUserName } from './core-normalizers.js'

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

function normalizeText(value) {
  return String(value ?? '').trim()
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
  const rawEvents = Array.isArray(row.match_day_events) ? row.match_day_events : row.events
  const events = Array.isArray(rawEvents) ? rawEvents.map(normalizeMatchDayEvent) : []

  return {
    id: row.id ?? '',
    clubId: row.club_id ?? row.clubId ?? '',
    teamId: row.team_id ?? row.teamId ?? '',
    teamName: normalizeText(team?.name ?? row.team_name ?? row.teamName),
    opponent: normalizeText(row.opponent),
    matchDate: row.match_date ?? row.matchDate ?? '',
    kickoffTime: row.kickoff_time ?? row.kickoffTime ?? '',
    homeAway: normalizeText(row.home_away ?? row.homeAway) || 'home',
    venueName: normalizeText(row.venue_name ?? row.venueName),
    venueAddress: normalizeText(row.venue_address ?? row.venueAddress),
    notes: normalizeText(row.notes),
    scorerRequestMessage: normalizeText(row.scorer_request_message ?? row.scorerRequestMessage),
    status: normalizeText(row.status) || 'scheduled',
    homeScore: Number(row.home_score ?? row.homeScore ?? 0),
    awayScore: Number(row.away_score ?? row.awayScore ?? 0),
    previousHiddenAt: row.previous_hidden_at ?? row.previousHiddenAt ?? '',
    hasInterest: Boolean(row.has_interest ?? row.hasInterest),
    isScorer: Boolean(row.is_scorer ?? row.isScorer),
    createdByName: normalizeText(row.created_by_name ?? row.createdByName),
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
    scorerInterests: interests,
    scorerAssignments: assignments,
    events,
  }
}

function assertStaffMatchDayAccess(user) {
  if (!user?.clubId || user.role === 'parent_portal' || user.role === 'super_admin' || Number(user.roleRank ?? 0) < 20) {
    throw new Error('Coach or manager access is required for Match Day.')
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
    match_day_events (*)
  `
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
  const teamId = normalizeText(match?.teamId) || user.activeTeamId || null

  if (!opponent) {
    throw new Error('Opponent is required.')
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
      match_date: normalizeText(match?.matchDate) || null,
      kickoff_time: normalizeText(match?.kickoffTime) || null,
      home_away: normalizeHomeAway(match?.homeAway),
      venue_name: venueName,
      venue_address: venueAddress,
      notes: normalizeText(match?.notes),
      scorer_request_message: normalizeText(match?.scorerRequestMessage),
      status: normalizeStatus(match?.status || 'scorer_request'),
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
  if (updates.matchDate !== undefined) payload.match_date = normalizeText(updates.matchDate) || null
  if (updates.kickoffTime !== undefined) payload.kickoff_time = normalizeText(updates.kickoffTime) || null
  if (updates.homeAway !== undefined) payload.home_away = normalizeHomeAway(updates.homeAway)
  if (updates.venueName !== undefined) payload.venue_name = normalizeText(updates.venueName)
  if (updates.venueAddress !== undefined) payload.venue_address = normalizeText(updates.venueAddress)
  if (updates.notes !== undefined) payload.notes = normalizeText(updates.notes)
  if (updates.scorerRequestMessage !== undefined) payload.scorer_request_message = normalizeText(updates.scorerRequestMessage)
  if (updates.status !== undefined) payload.status = normalizeStatus(updates.status)
  if (updates.homeScore !== undefined) payload.home_score = Math.max(Number(updates.homeScore ?? 0), 0)
  if (updates.awayScore !== undefined) payload.away_score = Math.max(Number(updates.awayScore ?? 0), 0)

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

  const { data, error } = await supabase
    .from('match_days')
    .update(payload)
    .eq('id', matchId)
    .eq('club_id', user.clubId)
    .select(buildMatchSelect())
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('match-day:')
  return normalizeMatchDay(data)
}

export async function selectMatchDayScorer({ user, match, interest }) {
  await blockDemoMutation(user)
  assertStaffMatchDayAccess(user)

  if (!match?.id || !interest?.parentLinkId) {
    throw new Error('Choose an interested parent first.')
  }

  const { error: insertError } = await supabase
    .from('match_day_scorer_assignments')
    .upsert({
      match_day_id: match.id,
      club_id: match.clubId,
      team_id: match.teamId || null,
      parent_link_id: interest.parentLinkId,
      auth_user_id: interest.authUserId || null,
      assigned_by: getEntryUserId(user),
      assigned_by_name: getEntryUserName(user),
    }, {
      onConflict: 'match_day_id,parent_link_id',
    })

  if (insertError) {
    console.error(insertError)
    throw insertError
  }

  const { error: updateError } = await supabase
    .from('match_day_scorer_interest')
    .update({
      status: 'selected',
      updated_at: new Date().toISOString(),
    })
    .eq('id', interest.id)

  if (updateError) {
    console.error(updateError)
    throw updateError
  }

  invalidateMemoryCacheByPrefix('match-day:')
}

export async function addStaffMatchDayGoal({ user, match, goal }) {
  await blockDemoMutation(user)
  assertStaffMatchDayAccess(user)

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

  const { error: updateError } = await supabase
    .from('match_days')
    .update({
      home_score: nextHomeScore,
      away_score: nextAwayScore,
      status: ['scheduled', 'scorer_request'].includes(match.status) ? 'live' : match.status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', match.id)
    .eq('club_id', user.clubId)

  if (updateError) {
    console.error(updateError)
    throw updateError
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
