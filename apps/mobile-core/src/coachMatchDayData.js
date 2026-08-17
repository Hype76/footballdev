import * as Crypto from 'expo-crypto'
import { normalizeExtraTimeHalfMinutes, normalizeExtraTimePeriodCount, normalizeMatchDayConclusionRule } from '../../../src/lib/matchday-extended-ops.js'
import { normalizeLegacyMatchHomeAway, normalizeMatchClockMode, normalizeMatchDurationMinutes } from '../../../src/lib/matchday-model.js'
import { normalizeMatchDaySquadDecision } from '../../../src/lib/matchday-squad-selection.js'
import { validateFinalMatchReportNotes } from '../../../src/lib/matchday-final-report.js'
import { validateMatchDayEventUndoInput } from '../../../src/lib/matchday-event-undo.js'
import { validateCoachFixtureForm } from './coachFixtureCore.js'
import { getMobileRuntimeConfig } from './config'
import { fetchJsonWithTimeout, joinApiPath } from './http'
import { assertCoachOperationalMutation, assertCoachOperationalRead, recordCoachOperationalAudit } from './coachOperationalData'
import { getAccessToken, supabase } from './supabase'

const STANDARD_TIMER_ACTIONS = new Set(['pause', 'half_time', 'hydration', 'resume', 'full_time', 'conclude'])
const EXTENDED_TIMER_ACTIONS = new Set(['normal_time_complete', 'start_extra_time', 'extra_time_half_time', 'start_extra_time_second_half', 'complete_extra_time', 'start_penalties'])
const STAFF_EVENT_TYPES = new Set(['yellow_card', 'red_card', 'substitution'])

function normalize(value) { return String(value ?? '').trim() }
function relation(value) { return Array.isArray(value) ? value[0] : value }
function integer(value) { const number = Number(value ?? 0); return Number.isFinite(number) ? Math.max(Math.floor(number), 0) : 0 }
function optionalInteger(value) { return value === null || value === undefined || value === '' ? null : integer(value) }
function requestId() { return Crypto.randomUUID() }

function normalizeEvent(row = {}) {
  const teamSide = normalize(row.team_side ?? row.teamSide)
  return {
    id: row.id ?? '', matchDayId: row.match_day_id ?? row.matchDayId ?? '', eventType: normalize(row.event_type ?? row.eventType) || 'goal',
    teamSide: teamSide || 'club', teamSideRecorded: row.team_side_recorded === false || row.teamSideRecorded === false ? false : Boolean(teamSide),
    minute: row.minute ?? null, scorerName: normalize(row.scorer_name ?? row.scorerName), scorerShirtNumber: normalize(row.scorer_shirt_number ?? row.scorerShirtNumber),
    assistName: normalize(row.assist_name ?? row.assistName), assistShirtNumber: normalize(row.assist_shirt_number ?? row.assistShirtNumber),
    playerName: normalize(row.player_name ?? row.playerName ?? row.scorer_name ?? row.scorerName), playerShirtNumber: normalize(row.player_shirt_number ?? row.playerShirtNumber ?? row.scorer_shirt_number ?? row.scorerShirtNumber),
    playerOnName: normalize(row.player_on_name ?? row.playerOnName ?? row.assist_name ?? row.assistName), playerOnShirtNumber: normalize(row.player_on_shirt_number ?? row.playerOnShirtNumber ?? row.assist_shirt_number ?? row.assistShirtNumber),
    homeScore: integer(row.home_score ?? row.homeScore), awayScore: integer(row.away_score ?? row.awayScore), notes: normalize(row.notes),
    isPenaltyGoal: row.is_penalty_goal === true || row.isPenaltyGoal === true, eventStatus: normalize(row.event_status ?? row.eventStatus) || 'active',
    correctionReason: normalize(row.correction_reason ?? row.correctionReason), requestId: normalize(row.request_id ?? row.requestId), voidedAt: row.voided_at ?? row.voidedAt ?? '', createdByName: normalize(row.created_by_name ?? row.createdByName), createdAt: row.created_at ?? row.createdAt ?? '',
    eventTeamId: row.event_team_id ?? row.eventTeamId ?? '', eventTeamName: normalize(row.event_team_name ?? row.eventTeamName), matchPhase: normalize(row.match_phase ?? row.matchPhase), phaseOrder: row.phase_order ?? row.phaseOrder ?? null,
  }
}

function normalizeShootoutKick(row = {}) {
  return { id: row.id ?? '', matchDayId: row.match_day_id ?? row.matchDayId ?? '', teamSide: normalize(row.team_side ?? row.teamSide) === 'opponent' ? 'opponent' : 'club', outcome: normalize(row.outcome) === 'missed' ? 'missed' : 'scored', kickNumber: integer(row.kick_number ?? row.kickNumber), playerName: normalize(row.player_name ?? row.playerName), notes: normalize(row.notes), eventStatus: normalize(row.event_status ?? row.eventStatus) || 'active', voidReason: normalize(row.void_reason ?? row.voidReason), homeShootoutScore: integer(row.home_shootout_score ?? row.homeShootoutScore), awayShootoutScore: integer(row.away_shootout_score ?? row.awayShootoutScore), createdByName: normalize(row.created_by_name ?? row.createdByName), createdAt: row.created_at ?? row.createdAt ?? '' }
}

function normalizeSquadDecision(row = {}) {
  return { id: row.id ?? '', matchDayId: row.match_day_id ?? row.matchDayId ?? '', playerId: row.player_id ?? row.playerId ?? '', status: normalizeMatchDaySquadDecision(row.status), decidedByName: normalize(row.decided_by_name ?? row.decidedByName), decidedAt: row.decided_at ?? row.decidedAt ?? '', updatedAt: row.updated_at ?? row.updatedAt ?? '' }
}

function normalizeAvailability(row = {}) {
  return { id: row.id ?? '', playerId: row.player_id ?? row.playerId ?? '', playerName: normalize(row.player_name ?? row.playerName), status: normalize(row.status) || 'pending', selectedAt: row.selected_at ?? row.selectedAt ?? '' }
}

function normalizeRequest(row = {}) {
  const player = relation(row.players) || relation(relation(row.parent_player_links)?.players)
  return {
    id: row.id ?? '', requestId: row.id ?? '', playerId: row.player_id ?? row.playerId ?? '', playerName: normalize(row.player_name ?? row.playerName ?? player?.player_name),
    recipientName: normalize(row.recipient_name ?? row.recipientName), recipientEmail: normalize(row.recipient_email ?? row.recipientEmail ?? relation(row.parent_player_links)?.email),
    status: normalize(row.status) || 'pending', scorerEligible: row.scorer_eligible === true || row.scorerEligible === true, scorerEligibilityReason: normalize(row.scorer_eligibility_reason ?? row.scorerEligibilityReason),
    volunteerScorerResponse: normalize(row.volunteer_scorer_response ?? row.volunteerScorerResponse) || 'no_response', volunteerLinesmanResponse: normalize(row.volunteer_linesman_response ?? row.volunteerLinesmanResponse) || 'no_response', volunteerRefereeResponse: normalize(row.volunteer_referee_response ?? row.volunteerRefereeResponse) || 'no_response',
    parentLinkId: row.parent_link_id ?? row.parentLinkId ?? '', authUserId: row.auth_user_id ?? row.authUserId ?? '', sentAt: row.sent_at ?? row.sentAt ?? '', respondedAt: row.responded_at ?? row.respondedAt ?? '',
  }
}

function normalizeRoleAssignment(row = {}) {
  const parentLink = relation(row.parent_player_links)
  const player = relation(parentLink?.players)
  return { id: row.id ?? '', role: normalize(row.role), parentLinkId: row.parent_link_id ?? row.parentLinkId ?? '', authUserId: row.auth_user_id ?? row.authUserId ?? parentLink?.auth_user_id ?? '', parentEmail: normalize(row.parent_email ?? row.parentEmail ?? parentLink?.email), playerName: normalize(row.player_name ?? row.playerName ?? player?.player_name), assignedByName: normalize(row.assigned_by_name ?? row.assignedByName), createdAt: row.created_at ?? row.createdAt ?? '' }
}

export function normalizeCoachMatchDay(row = {}) {
  const team = relation(row.teams)
  const finalReportRow = relation(row.match_day_final_reports) || row.finalReport
  const rawEvents = row.match_day_events ?? row.events ?? []
  const rawKicks = row.match_day_shootout_kicks ?? row.shootoutEvents ?? []
  return {
    id: row.id ?? '', clubId: row.club_id ?? row.clubId ?? '', teamId: row.team_id ?? row.teamId ?? '', teamName: normalize(team?.name ?? row.team_name ?? row.teamName) || 'Our team', opponent: normalize(row.opponent) || 'Opponent',
    fixtureType: normalize(row.fixture_type ?? row.fixtureType) || 'league', conclusionRule: normalizeMatchDayConclusionRule(row.match_conclusion_rule ?? row.conclusionRule), currentMatchPhase: normalize(row.current_match_phase ?? row.currentMatchPhase) || 'pre_match', extraTimeHalfMinutes: normalizeExtraTimeHalfMinutes(row.extra_time_half_minutes ?? row.extraTimeHalfMinutes), extraTimePeriodCount: normalizeExtraTimePeriodCount(row.extra_time_period_count ?? row.extraTimePeriodCount),
    matchDate: row.match_date ?? row.matchDate ?? '', kickoffTime: row.kickoff_time ?? row.kickoffTime ?? '', kickoffTimeTbc: row.kickoff_time_tbc === true || row.kickoffTimeTbc === true, arrivalTime: row.arrival_time ?? row.arrivalTime ?? '', homeAway: normalizeLegacyMatchHomeAway(row.home_away ?? row.homeAway), clockMode: normalizeMatchClockMode(row.match_clock_mode ?? row.clockMode), matchDurationMinutes: normalizeMatchDurationMinutes(row.match_duration_minutes ?? row.matchDurationMinutes), venueName: normalize(row.venue_name ?? row.venueName), venueAddress: normalize(row.venue_address ?? row.venueAddress), notes: normalize(row.notes),
    requestScorer: row.request_scorer === true || row.requestScorer === true || row.status === 'scorer_request', requestLinesman: row.request_linesman === true || row.requestLinesman === true, requestReferee: row.request_referee === true || row.requestReferee === true,
    status: normalize(row.status) || 'scheduled', homeScore: integer(row.home_score ?? row.homeScore), awayScore: integer(row.away_score ?? row.awayScore), normalTimeHomeScore: optionalInteger(row.normal_time_home_score ?? row.normalTimeHomeScore), normalTimeAwayScore: optionalInteger(row.normal_time_away_score ?? row.normalTimeAwayScore), extraTimeHomeScore: optionalInteger(row.extra_time_home_score ?? row.extraTimeHomeScore), extraTimeAwayScore: optionalInteger(row.extra_time_away_score ?? row.extraTimeAwayScore), homeShootoutScore: integer(row.home_shootout_score ?? row.homeShootoutScore), awayShootoutScore: integer(row.away_shootout_score ?? row.awayShootoutScore), shootoutWinner: normalize(row.shootout_winner ?? row.shootoutWinner),
    phaseStartedAt: row.phase_started_at ?? row.phaseStartedAt ?? '', timerStartedAt: row.timer_started_at ?? row.timerStartedAt ?? '', timerPausedAt: row.timer_paused_at ?? row.timerPausedAt ?? '', timerElapsedSeconds: integer(row.timer_elapsed_seconds ?? row.timerElapsedSeconds), timerStatus: normalize(row.timer_status ?? row.timerStatus) || 'not_started', fullTimeResumeStatus: normalize(row.full_time_resume_status ?? row.fullTimeResumeStatus), concludedAt: row.concluded_at ?? row.concludedAt ?? '', concludedBy: row.concluded_by ?? row.concludedBy ?? '',
    presentationPriority: Number(row.presentation_priority ?? row.presentationPriority ?? 99), scheduledKickoffAt: row.scheduled_kickoff_at ?? row.scheduledKickoffAt ?? '', isToday: row.is_today === true || row.isToday === true,
    playerAvailability: (row.match_day_player_availability ?? row.playerAvailability ?? []).map(normalizeAvailability), squadDecisions: (row.match_day_player_squad_decisions ?? row.squadDecisions ?? []).map(normalizeSquadDecision), availabilityRequests: (row.match_day_availability_requests ?? row.availabilityRequests ?? []).map(normalizeRequest), roleAssignments: (row.match_day_role_assignments ?? row.roleAssignments ?? []).map(normalizeRoleAssignment),
    events: rawEvents.map(normalizeEvent).sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0)), shootoutEvents: rawKicks.map(normalizeShootoutKick),
    finalReport: finalReportRow ? { matchDayId: finalReportRow.match_day_id ?? finalReportRow.matchDayId ?? '', staffNotes: normalize(finalReportRow.staff_notes ?? finalReportRow.staffNotes), createdByName: normalize(finalReportRow.created_by_name ?? finalReportRow.createdByName), updatedByName: normalize(finalReportRow.updated_by_name ?? finalReportRow.updatedByName), updatedAt: finalReportRow.updated_at ?? finalReportRow.updatedAt ?? '' } : null,
    previousHiddenAt: row.previous_hidden_at ?? row.previousHiddenAt ?? '', deletedAt: row.deleted_at ?? row.deletedAt ?? '', updatedAt: row.updated_at ?? row.updatedAt ?? '', isHydrated: Array.isArray(row.match_day_events),
  }
}

const LIST_SELECT = `id,club_id,team_id,opponent,fixture_type,match_conclusion_rule,current_match_phase,extra_time_half_minutes,extra_time_period_count,match_date,kickoff_time,kickoff_time_tbc,arrival_time,home_away,match_clock_mode,match_duration_minutes,venue_name,venue_address,notes,request_scorer,request_linesman,request_referee,status,home_score,away_score,normal_time_home_score,normal_time_away_score,extra_time_home_score,extra_time_away_score,home_shootout_score,away_shootout_score,shootout_winner,phase_started_at,timer_started_at,timer_paused_at,timer_elapsed_seconds,timer_status,full_time_resume_status,concluded_at,concluded_by,previous_hidden_at,created_at,updated_at,teams:team_id(name)`
const DETAIL_SELECT = `*,teams:team_id(name),match_day_role_assignments(*,parent_player_links:parent_link_id(email,auth_user_id,players:player_id(player_name))),match_day_player_availability(*),match_day_player_squad_decisions(*),match_day_availability_requests(*,players:player_id(player_name),parent_player_links:parent_link_id(email,auth_user_id,players:player_id(player_name))),match_day_events(*),match_day_shootout_kicks(*),match_day_final_reports(*)`

function scoped(query, user) { return query.or(`team_id.is.null,team_id.eq.${user.activeTeamId}`) }
function assertScope(user, match) { if (match?.teamId && match.teamId !== user?.activeTeamId) throw new Error('This match day is not linked to your active Team.') }
function assertCoachMatchDayAccess(user) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  if (['admin', 'parent_portal', 'adult_player', 'super_admin'].includes(user?.role) || Number(user?.roleRank || 0) < 20) {
    throw new Error('Coach or manager access is required for Match Day.')
  }
}

export async function getCoachMatchDayList(user) {
  assertCoachMatchDayAccess(user)
  const { data, error } = await scoped(supabase.from('match_days').select(LIST_SELECT).eq('club_id', user.clubId).is('deleted_at', null).order('match_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(80), user)
  if (error) throw error
  const matches = (data || []).map(normalizeCoachMatchDay)
  const ids = matches.map((match) => match.id)
  if (!ids.length) return matches
  const { data: states, error: stateError } = await supabase.rpc('get_match_day_presentation_states', { match_day_ids_value: ids })
  if (stateError) throw stateError
  const stateMap = new Map((states || []).map((state) => [state.match_day_id ?? state.matchDayId, state]))
  return matches.map((match) => normalizeCoachMatchDay({ ...match, ...(stateMap.get(match.id) || {}) }))
}

async function sendCoachFixtureInvitations(user, match, playerIds) {
  if (!match.parentVisible || playerIds.length === 0) return null
  const accessToken = await getAccessToken()
  if (!accessToken) throw new Error('Sign in again before sending fixture invitations.')
  const { ok, response, result } = await fetchJsonWithTimeout(joinApiPath(getMobileRuntimeConfig('coach').apiBaseUrl, '.netlify/functions/send-match-day-availability-requests'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchDayId: match.id, playerIds }),
  })
  if (!ok || result?.success === false) {
    throw Object.assign(new Error(normalize(result?.message) || 'Fixture invitations could not be sent.'), { status: response.status })
  }
  return result
}

export async function createCoachMatchDayFixture(user, form) {
  assertCoachOperationalMutation(user, { minimumRank: 20, requiresTeam: true })
  const fixture = validateCoachFixtureForm(form)
  const teamId = normalize(user.activeTeamId)
  const { data: locationId, error: locationError } = await supabase.rpc('upsert_match_location_for_team', {
    p_address: fixture.venueAddress,
    p_name: fixture.venueName,
    p_notes: '',
    p_team_id: teamId,
  })
  if (locationError) throw locationError
  const requestScorer = fixture.requestScorer === true
  const { data, error } = await supabase
    .from('match_days')
    .insert({
      arrival_time: fixture.kickoffTimeTbc ? null : fixture.arrivalTime || null,
      auto_select_available_players: fixture.autoSelectAvailablePlayers,
      club_id: user.clubId,
      created_by: user.id,
      created_by_name: normalize(user.displayName || user.name || user.email),
      enable_motm_poll: fixture.enableMotmPoll,
      extra_time_half_minutes: fixture.extraTimeHalfMinutes,
      extra_time_period_count: fixture.extraTimePeriodCount,
      fixture_type: fixture.fixtureType,
      home_away: fixture.homeAway,
      kickoff_time: fixture.kickoffTime || null,
      kickoff_time_tbc: fixture.kickoffTimeTbc,
      location_id: locationId || null,
      match_clock_mode: fixture.clockMode,
      match_conclusion_rule: fixture.conclusionRule,
      match_date: fixture.matchDate,
      match_duration_minutes: fixture.matchDurationMinutes,
      motm_poll_expiry_hours: fixture.motmPollExpiryHours,
      notes: fixture.notes,
      opponent: fixture.opponent,
      parent_audience: fixture.parentAudience,
      parent_visible: fixture.parentVisible,
      request_linesman: fixture.requestLinesman,
      request_referee: fixture.requestReferee,
      request_scorer: requestScorer,
      scorer_request_message: requestScorer ? 'Can anyone help as live scorer for this match?' : '',
      status: requestScorer ? 'scorer_request' : 'scheduled',
      team_id: teamId,
      venue_address: fixture.venueAddress,
      venue_name: fixture.venueName,
    })
    .select(LIST_SELECT)
    .single()
  if (error) throw error
  const match = normalizeCoachMatchDay(data)
  await Promise.all([
    recordCoachOperationalAudit({
      action: 'match_day_created',
      entityId: match.id,
      entityType: 'match_day',
      metadata: { conclusionRule: fixture.conclusionRule, fixtureType: fixture.fixtureType, opponent: fixture.opponent, teamId },
      user,
    }),
    supabase.from('match_day_event_log').insert({
      actor_display_name: normalize(user.displayName || user.name || user.email),
      actor_role: normalize(user.role),
      actor_user_id: user.id,
      club_id: user.clubId,
      event_label: 'Fixture created',
      event_type: 'match_day_created',
      match_day_id: match.id,
      metadata: { source: 'coach_mobile' },
      new_value: { fixtureType: fixture.fixtureType, matchDate: fixture.matchDate, opponent: fixture.opponent },
      team_id: teamId,
    }).then(({ error: eventLogError }) => { if (eventLogError) console.warn(eventLogError) }),
  ])
  let invitationResult = null
  let invitationWarning = ''
  if (fixture.parentVisible) {
    try {
      invitationResult = await sendCoachFixtureInvitations(user, { ...match, parentVisible: true }, fixture.selectedPlayerIds)
    } catch (invitationError) {
      invitationWarning = normalize(invitationError?.message) || 'The fixture was saved, but Parent invitations remain unsent.'
    }
  }
  return Object.freeze({ invitationResult, invitationWarning, match })
}

export async function getCoachMatchDayDetail(user, matchDayId, { includeVolunteerEligibility = true } = {}) {
  assertCoachMatchDayAccess(user)
  if (!normalize(matchDayId)) throw new Error('Choose a Match Day fixture.')
  const { data, error } = await scoped(supabase.from('match_days').select(DETAIL_SELECT).eq('id', matchDayId).eq('club_id', user.clubId).is('deleted_at', null), user).maybeSingle()
  if (error) throw error
  if (!data?.id) throw new Error('This match day is not linked to your active Team.')
  let result = data
  if (includeVolunteerEligibility) {
    const config = getMobileRuntimeConfig('coach')
    const accessToken = await getAccessToken()
    if (!config.apiBaseUrl || !accessToken) throw new Error('Login is required to load volunteer eligibility.')
    const url = `${joinApiPath(config.apiBaseUrl, '.netlify/functions/select-match-day-volunteer')}?matchDayId=${encodeURIComponent(matchDayId)}`
    try {
      const response = await fetchJsonWithTimeout(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!response.ok || response.result?.success !== true) throw new Error(response.result?.message || 'Volunteer eligibility could not be loaded.')
      const byRequest = new Map((response.result.eligibility || []).map((item) => [String(item.request_id || ''), item]))
      result = { ...data, match_day_availability_requests: (data.match_day_availability_requests || []).map((item) => ({ ...item, scorer_eligible: byRequest.get(String(item.id))?.eligible === true, scorer_eligibility_reason: byRequest.get(String(item.id))?.reason || '', parent_link_id: byRequest.get(String(item.id))?.parent_link_id || item.parent_link_id, auth_user_id: byRequest.get(String(item.id))?.auth_user_id || item.auth_user_id })) }
    } catch (eligibilityError) {
      result = { ...data, volunteerEligibilityError: normalize(eligibilityError?.message) || 'Volunteer eligibility could not be loaded.' }
    }
  }
  return { ...normalizeCoachMatchDay(result), volunteerEligibilityError: normalize(result.volunteerEligibilityError) }
}

async function prepareMutation(user, match, minimumRank = 20) {
  assertCoachMatchDayAccess(user)
  assertCoachOperationalMutation(user, { minimumRank, requiresTeam: true })
  if (!normalize(match?.id)) throw new Error('Choose a Match Day fixture.')
  if (match?.deletedAt || match?.previousHiddenAt) throw new Error('This Match Day fixture is archived or unavailable.')
  assertScope(user, match)
}
async function rpc(name, parameters) { const { data, error } = await supabase.rpc(name, parameters); if (error) throw error; return data }

export function createCoachMatchDayCommandId() { return requestId() }

export async function runCoachMatchDayTimerAction(user, match, action) {
  await prepareMutation(user, match)
  const value = normalize(action)
  if (value === 'start') await rpc('start_match_day', { match_day_id_value: match.id })
  else if (STANDARD_TIMER_ACTIONS.has(value)) await rpc('set_match_day_timer_state', { match_day_id_value: match.id, action_value: value })
  else if (EXTENDED_TIMER_ACTIONS.has(value)) await rpc('set_match_day_extended_state', { match_day_id_value: match.id, action_value: value })
  else throw new Error('Choose a supported Match Day clock action.')
  return getCoachMatchDayDetail(user, match.id)
}

export async function setCoachMatchDaySquadDecision(user, match, playerId, decision, expectedDecidedAt = null) {
  await prepareMutation(user, match)
  await rpc('set_match_day_player_squad_decision_v2', { match_day_id_value: match.id, player_id_value: playerId, decision_value: normalizeMatchDaySquadDecision(decision), expected_decided_at_value: expectedDecidedAt || null })
  return getCoachMatchDayDetail(user, match.id)
}

export async function recordCoachMatchDayEvent(user, match, event, commandId = '') {
  await prepareMutation(user, match)
  const type = normalize(event?.eventType)
  if (type === 'goal') {
    await rpc('record_match_day_goal_v2', { match_day_id_value: match.id, parent_link_id_value: null, team_side_value: event.teamSide === 'opponent' ? 'opponent' : 'club', scorer_name_value: normalize(event.scorerName), scorer_shirt_number_value: normalize(event.scorerShirtNumber), assist_name_value: normalize(event.assistName), assist_shirt_number_value: normalize(event.assistShirtNumber), minute_value: event.minute ?? null, notes_value: normalize(event.notes), is_penalty_goal_value: event.isPenaltyGoal === true, request_id_value: normalize(commandId) || requestId() })
  } else {
    if (!STAFF_EVENT_TYPES.has(type)) throw new Error('Choose a supported Match Day event type.')
    await rpc('record_match_day_staff_event_v2', { match_day_id_value: match.id, event_type_value: type, team_side_value: event.teamSide === 'opponent' ? 'opponent' : 'club', minute_value: event.minute ?? null, player_name_value: normalize(event.playerName), player_shirt_number_value: normalize(event.playerShirtNumber), player_on_name_value: normalize(event.playerOnName), player_on_shirt_number_value: normalize(event.playerOnShirtNumber), notes_value: normalize(event.notes), request_id_value: normalize(commandId) || requestId() })
  }
  return getCoachMatchDayDetail(user, match.id)
}

export async function correctCoachMatchDayScore(user, match, homeScore, awayScore, commandId = '') {
  await prepareMutation(user, match)
  await rpc('record_match_day_score_correction_v2', { match_day_id_value: match.id, parent_link_id_value: null, home_score_value: integer(homeScore), away_score_value: integer(awayScore), notes_value: 'Score corrected in the Coach app', request_id_value: normalize(commandId) || requestId() })
  return getCoachMatchDayDetail(user, match.id)
}

export async function correctCoachMatchDayGoal(user, match, event, goal, reason = '') {
  await prepareMutation(user, match)
  await rpc('correct_match_day_goal', { match_day_id_value: match.id, goal_event_id_value: event.id, parent_link_id_value: null, team_side_value: goal.teamSide === 'opponent' ? 'opponent' : 'club', scorer_name_value: normalize(goal.scorerName), scorer_shirt_number_value: normalize(goal.scorerShirtNumber), assist_name_value: normalize(goal.assistName), assist_shirt_number_value: normalize(goal.assistShirtNumber), minute_value: goal.minute ?? null, notes_value: normalize(goal.notes), correction_reason_value: normalize(reason) })
  return getCoachMatchDayDetail(user, match.id)
}

export async function voidCoachMatchDayEvent(user, match, event, { note = '', reasonCode = '' } = {}) {
  await prepareMutation(user, match)
  const validated = validateMatchDayEventUndoInput({ eventType: event.eventType, note, reasonCode })
  await rpc('void_match_day_event', { match_day_id_value: match.id, event_id_value: event.id, reason_code_value: validated.reasonCode, note_value: validated.note })
  return getCoachMatchDayDetail(user, match.id)
}

export async function recordCoachMatchDayShootoutKick(user, match, kick) {
  await prepareMutation(user, match)
  await rpc('record_match_day_shootout_kick', { match_day_id_value: match.id, team_side_value: kick.teamSide === 'opponent' ? 'opponent' : 'club', outcome_value: kick.outcome === 'missed' ? 'missed' : 'scored', player_name_value: normalize(kick.playerName), notes_value: normalize(kick.notes) })
  return getCoachMatchDayDetail(user, match.id)
}

export async function voidCoachMatchDayShootoutKick(user, match, kickId, reason = 'Corrected shootout kick') {
  await prepareMutation(user, match)
  await rpc('void_match_day_shootout_kick', { match_day_id_value: match.id, kick_id_value: kickId, reason_value: normalize(reason) })
  return getCoachMatchDayDetail(user, match.id)
}

export async function saveCoachMatchDayFinalReport(user, match, staffNotes) {
  await prepareMutation(user, match)
  await rpc('save_match_day_final_report', { match_day_id_value: match.id, staff_notes_value: validateFinalMatchReportNotes(staffNotes) })
  return getCoachMatchDayDetail(user, match.id)
}

export async function selectCoachMatchDayVolunteer(user, match, request, role, selected = true) {
  await prepareMutation(user, match)
  if (!['scorer', 'linesman', 'referee'].includes(role)) throw new Error('Choose a valid volunteer role.')
  if (!request?.requestId) throw new Error('Choose a volunteer response first.')
  const config = getMobileRuntimeConfig('coach')
  const accessToken = await getAccessToken()
  if (!config.apiBaseUrl || !accessToken) throw new Error('Login is required.')
  const response = await fetchJsonWithTimeout(joinApiPath(config.apiBaseUrl, '.netlify/functions/select-match-day-volunteer'), { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ matchDayId: match.id, requestId: request.requestId, role, selected: selected !== false }) })
  if (!response.ok || response.result?.success === false) throw new Error(response.result?.message || 'Volunteer selection could not be updated.')
  return getCoachMatchDayDetail(user, match.id)
}
