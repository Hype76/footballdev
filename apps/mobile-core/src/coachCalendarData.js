import { CAPABILITIES } from '../../../src/lib/paywall-access.js'
import { buildCoachCalendarEvents, buildCoachCalendarPayload, normalizeCoachCalendarEvent } from './coachCalendarCore'
import {
  assertCoachCapability,
  assertCoachOperationalMutation,
  assertCoachOperationalRead,
  getCoachEntryIdentity,
  recordCoachOperationalAudit,
  scopeCoachQuery,
} from './coachOperationalData'
import { supabase } from './supabase'

function normalize(value) {
  return String(value ?? '').trim()
}

async function getTrainingAvailabilityByEventId(user, eventIds) {
  if (eventIds.length === 0) return {}
  const [requestPlayersResult, responsesResult] = await Promise.all([
    supabase
      .from('training_availability_request_players')
      .select('id, request_id, calendar_event_id, player_id, player_name, status, training_availability_requests(occurrence_date, occurrence_starts_at)')
      .eq('club_id', user.clubId)
      .in('calendar_event_id', eventIds),
    supabase
      .from('training_availability_responses')
      .select('request_id, calendar_event_id, player_id, status, note, responded_at, responded_by_name')
      .eq('club_id', user.clubId)
      .in('calendar_event_id', eventIds),
  ])
  if (requestPlayersResult.error) throw requestPlayersResult.error
  if (responsesResult.error) throw responsesResult.error
  const responses = new Map((responsesResult.data || []).map((row) => [`${row.request_id}:${row.player_id}`, row]))
  const summaries = {}
  for (const row of requestPlayersResult.data || []) {
    const eventId = normalize(row.calendar_event_id)
    if (!eventId) continue
    const response = responses.get(`${row.request_id}:${row.player_id}`)
    const state = normalize(response?.status || row.status || 'pending').toLowerCase()
    if (!summaries[eventId]) summaries[eventId] = { available: 0, details: [], maybe: 0, pending: 0, unavailable: 0 }
    const summary = summaries[eventId]
    if (state === 'available') summary.available += 1
    else if (state === 'unavailable') summary.unavailable += 1
    else if (state === 'maybe') summary.maybe += 1
    else summary.pending += 1
    summary.details.push({
      note: normalize(response?.note),
      playerId: normalize(row.player_id),
      playerName: normalize(row.player_name),
      respondedAt: normalize(response?.responded_at),
      respondedByName: normalize(response?.responded_by_name),
      status: state,
    })
  }
  return summaries
}

export async function getCoachCalendarResources(user) {
  assertCoachOperationalRead(user)
  let calendarQuery = supabase
    .from('calendar_events')
    .select('*, teams:team_id(name)')
    .eq('club_id', user.clubId)
    .order('starts_at', { ascending: true })
    .limit(300)
  calendarQuery = scopeCoachQuery(calendarQuery, user, { includeClubWide: true })

  const matchesPromise = user.activeTeamId
    ? supabase
      .from('match_days')
      .select('id, team_id, opponent, match_date, kickoff_time, kickoff_time_tbc, status, venue_name, venue_address, notes, updated_at, teams:team_id(name)')
      .eq('club_id', user.clubId)
      .eq('team_id', user.activeTeamId)
      .order('match_date', { ascending: true })
      .limit(100)
    : Promise.resolve({ data: [], error: null })
  const sessionsPromise = user.activeTeamId
    ? supabase
      .from('assessment_sessions')
      .select('id, team_id, team, title, opponent, session_type, session_date, start_time, end_time, location, notes, status, updated_at, teams:team_id(name)')
      .eq('club_id', user.clubId)
      .eq('team_id', user.activeTeamId)
      .order('session_date', { ascending: true })
      .limit(100)
    : Promise.resolve({ data: [], error: null })
  const [calendarResult, matchesResult, sessionsResult] = await Promise.all([calendarQuery, matchesPromise, sessionsPromise])
  const firstError = calendarResult.error || matchesResult.error || sessionsResult.error
  if (firstError) throw firstError
  const calendarRows = calendarResult.data || []
  const trainingIds = calendarRows.filter((row) => row.event_type === 'training').map((row) => row.id)
  const availabilityByEventId = await getTrainingAvailabilityByEventId(user, trainingIds)
  return buildCoachCalendarEvents({
    availabilityByEventId,
    calendarEvents: calendarRows.map((row) => ({
      ...row,
      canEdit: user.role === 'admin' || Boolean(row.team_id),
      isInheritedClubEvent: Boolean(user.activeTeamId && !row.team_id),
    })),
    matches: matchesResult.data || [],
    sessions: sessionsResult.data || [],
  })
}

function assertCalendarCapabilities(user, payload) {
  assertCoachCapability(user, payload.team_id ? CAPABILITIES.teamCalendar : CAPABILITIES.clubWideEvents)
  if (payload.recurrence_frequency !== 'none') assertCoachCapability(user, CAPABILITIES.recurringEvents)
  if (payload.parent_visible) assertCoachCapability(user, CAPABILITIES.parentPortal)
}

export async function saveCoachCalendarEvent(user, form, existingEvent = null) {
  assertCoachOperationalMutation(user)
  if (existingEvent && (existingEvent.sourceType !== 'calendar_event' || existingEvent.canEdit === false)) {
    throw new Error('This item must be edited in its authoritative Match Day or Session workflow.')
  }
  const payload = buildCoachCalendarPayload({ context: user, form })
  const playerIds = [...new Set((form?.involvedPlayerIds || []).map(normalize).filter(Boolean))]
  if (payload.parent_visible && payload.parent_audience === 'involved_players' && playerIds.length === 0) {
    throw new Error('Add at least one involved Player or choose a wider parent audience.')
  }
  assertCalendarCapabilities(user, payload)
  const now = new Date().toISOString()
  const identity = getCoachEntryIdentity(user, 'updated')
  let query
  let action
  if (existingEvent?.sourceId) {
    query = supabase
      .from('calendar_events')
      .update({ ...payload, ...identity, updated_by: user.id, updated_at: now })
      .eq('id', existingEvent.sourceId)
      .eq('club_id', user.clubId)
    action = 'calendar_event_updated'
  } else {
    query = supabase
      .from('calendar_events')
      .insert({
        ...payload,
        ...getCoachEntryIdentity(user),
        ...identity,
        created_by: user.id,
        updated_by: user.id,
      })
    action = 'calendar_event_created'
  }
  const { data, error } = await query.select('*, teams:team_id(name)').single()
  if (error) throw error

  if (payload.parent_visible && payload.team_id) {
    const selectionMode = payload.parent_audience === 'all_team_parents' ? 'whole_squad' : 'manual'
    const { error: scopeError } = await supabase.rpc('sync_calendar_event_parent_scope_v2', {
      calendar_event_id_value: data.id,
      include_trial_players_value: false,
      match_day_id_value: null,
      player_ids_value: selectionMode === 'whole_squad' ? [] : playerIds,
      selection_mode_value: selectionMode,
    })
    if (scopeError) throw scopeError
  }

  await recordCoachOperationalAudit({
    action,
    entityId: data.id,
    entityType: 'calendar_event',
    metadata: {
      communicationsMode: 'disabled_test_sink',
      eventType: payload.event_type,
      startsAt: payload.starts_at,
      teamId: payload.team_id,
      title: payload.title,
    },
    user,
  })
  return normalizeCoachCalendarEvent(data)
}

export function getCoachCalendarCommunicationsBoundary() {
  return Object.freeze({
    apiOrigin: 'https://footballplayer-mobile-test-api.netlify.app',
    environment: 'test',
    externalDeliveryAllowed: false,
    mode: 'disabled_test_sink',
    productionAccess: false,
    schedulesAllowed: false,
  })
}
