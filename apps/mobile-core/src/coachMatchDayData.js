import { normalizeCoachMatchDay } from './coachMatchDayNormalization.js'
export { normalizeCoachMatchDay } from './coachMatchDayNormalization.js'
import * as Crypto from 'expo-crypto'
import { normalizeMatchDayConclusionRule } from '../../../src/lib/matchday-extended-ops.js'
import { assertMatchDayShirtChoice, assertNewMatchHomeAway, assertValidMatchDurationMinutes } from '../../../src/lib/matchday-model.js'
import { normalizeTeamNotificationDisplayName } from '../../../src/lib/team-notification-display.js'
import { normalizeMatchDaySquadDecision } from '../../../src/lib/matchday-squad-selection.js'
import { isMatchDayParticipantRosterCurrent, mergeMatchDayParticipantEventIdentities, normalizeMatchDayParticipantRoster } from './matchDayParticipantRoster.js'
import { validateFinalMatchReportNotes } from '../../../src/lib/matchday-final-report.js'
import { validateMatchDayEventUndoInput } from '../../../src/lib/matchday-event-undo.js'
import { validateCoachFixtureForm } from './coachFixtureCore.js'
import { isCoachFixtureEditable } from './coachFixtureEditCore.js'
import { COACH_MATCH_DAY_PAGE_SIZE } from './coachMatchDayCore.js'
import { settleCoachFixtureAudit } from './coachFixtureAuditCore.js'
import { getMobileRuntimeConfig } from './config'
import { fetchJsonWithTimeout, joinApiPath } from './http'
import { assertCoachOperationalMutation, assertCoachOperationalRead, recordCoachOperationalAudit } from './coachOperationalData'
import { getAccessToken, supabase } from './supabase'
import { saveCoachTeamNotificationDisplayName } from './coachTeamNotificationData'
import { mergeMatchDayCommandSnapshot } from './matchDayOutboxCore'

const STANDARD_TIMER_ACTIONS = new Set(['pause', 'half_time', 'hydration', 'resume', 'full_time', 'conclude'])
const EXTENDED_TIMER_ACTIONS = new Set(['normal_time_complete', 'start_extra_time', 'extra_time_half_time', 'start_extra_time_second_half', 'complete_extra_time', 'start_penalties'])
const STAFF_EVENT_TYPES = new Set(['yellow_card', 'red_card', 'substitution'])

function normalize(value) { return String(value ?? '').trim() }
function integer(value) { const number = Number(value ?? 0); return Number.isFinite(number) ? Math.max(Math.floor(number), 0) : 0 }
function requestId() { return Crypto.randomUUID() }

const LIST_SELECT = `id,title,club_id,team_id,notification_team_name,opponent,fixture_type,pitch_type,carpool_enabled,match_conclusion_rule,current_match_phase,extra_time_half_minutes,extra_time_period_count,match_date,kickoff_time,kickoff_time_tbc,arrival_time,home_away,shirt_choice,match_clock_mode,match_duration_minutes,venue_name,venue_address,notes,request_scorer,request_linesman,request_referee,parent_visible,parent_audience,status,cancellation_reason,home_score,away_score,normal_time_home_score,normal_time_away_score,extra_time_home_score,extra_time_away_score,home_shootout_score,away_shootout_score,shootout_winner,phase_started_at,timer_started_at,timer_paused_at,timer_elapsed_seconds,timer_status,full_time_resume_status,concluded_at,concluded_by,previous_hidden_at,created_at,updated_at,teams:team_id(name,notification_display_name)`

function scoped(query, user) { return query.or(`team_id.is.null,team_id.eq.${user.activeTeamId}`) }
function assertScope(user, match) {
  if ((match?.teamId && match.teamId !== user?.activeTeamId) || (match?.clubId && match.clubId !== user?.clubId)) {
    throw new Error('This match day is not linked to your active Team.')
  }
}
function assertCoachMatchDayAccess(user) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  if (['parent_portal', 'adult_player', 'super_admin'].includes(user?.role)) {
    throw new Error('Coach or manager access is required for Match Day.')
  }
}

export async function getCoachMatchDayList(user, offset = 0) {
  assertCoachMatchDayAccess(user)
  const query = supabase.from('match_days').select(LIST_SELECT).eq('club_id', user.clubId).is('deleted_at', null)
    .order('match_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .order('id')
    .range(offset, offset + COACH_MATCH_DAY_PAGE_SIZE - 1)
  const { data, error } = await scoped(query, user)
  if (error) throw error
  const matches = (data || []).map((row) => normalizeCoachMatchDay({ ...row, clubName: user.clubName }))
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

function fixtureInvitationWarning(result) {
  if (!result || result.complete !== false) return ''
  const count = Math.max(Number(result.missingContactCount) || 0, 0)
  return `${count || 'Some'} player ${count === 1 ? 'invitation could' : 'invitations could'} not be sent. Check player contact details and account setup, then resend.`
}

export async function getCoachFixtureInvitedPlayerIds(user, match) {
  assertCoachMatchDayAccess(user)
  assertScope(user, match)
  const result = await rpc('preview_event_player_changes', {
    source_type_value: 'match-day', event_id_value: match.id, selected_player_ids_value: [],
  })
  return Array.isArray(result?.currentPlayerIds) ? result.currentPlayerIds : []
}

export async function addCoachFixtureParents(user, match, playerIds) {
  await prepareMutation(user, match)
  if (!['scheduled', 'scorer_request'].includes(normalize(match.status))) {
    throw new Error('Parents can only be added before the fixture starts.')
  }
  const currentPlayerIds = await getCoachFixtureInvitedPlayerIds(user, match)
  const addedIds = [...new Set((playerIds || []).map(normalize).filter(Boolean))]
    .filter(id => !currentPlayerIds.includes(id))
  if (!addedIds.length) throw new Error('Choose at least one new player to add.')
  const selectedIds = [...currentPlayerIds, ...addedIds]
  const preview = await rpc('preview_event_player_changes', {
    source_type_value: 'match-day', event_id_value: match.id, selected_player_ids_value: selectedIds,
  })
  if ((preview?.removedPlayerIds || []).length || (preview?.addedPlayerIds || []).length !== addedIds.length) {
    throw new Error('The fixture changed. Refresh invited players before saving.')
  }
  await rpc('enable_match_day_parent_sharing', {
    match_day_id_value: match.id, selected_player_ids_value: selectedIds,
    expected_player_ids_value: currentPlayerIds, request_token_value: requestId(),
  })
  let warning = ''
  try { warning = fixtureInvitationWarning(await sendCoachFixtureInvitations(user, { ...match, parentVisible: true }, addedIds)) }
  catch (error) { warning = normalize(error?.message) || 'Parents were added, but invitations could not be confirmed.' }
  return { match: await getCoachMatchDayDetail(user, match.id), warning }
}

export async function createCoachMatchDayFixture(user, form, { calendarOnly = false, calendarTarget = '' } = {}) {
  assertCoachOperationalMutation(user, { minimumRank: 20, requiresTeam: true })
  const normalizedCalendarTarget = ['coach', 'squad'].includes(normalize(calendarTarget))
    ? normalize(calendarTarget)
    : calendarOnly
      ? 'coach'
      : ''
  const fixture = validateCoachFixtureForm(
    normalizedCalendarTarget === 'coach'
      ? { ...form, parentAudience: 'none', parentVisible: false, selectedPlayerIds: [] }
      : normalizedCalendarTarget === 'squad'
        ? { ...form, parentAudience: 'involved_players', parentVisible: true }
        : form,
    { requireSelectedPlayers: true },
  )
  const teamId = normalize(user.activeTeamId)
  if (fixture.rememberNotificationTeamName) {
    await saveCoachTeamNotificationDisplayName(user, teamId, fixture.notificationTeamName)
  }
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
      pitch_type: fixture.pitchType,
      home_away: fixture.homeAway,
      shirt_choice: fixture.shirtChoice,
      kickoff_time: fixture.kickoffTime || null,
      kickoff_time_tbc: fixture.kickoffTimeTbc,
      location_id: locationId || null,
      match_clock_mode: fixture.clockMode,
      match_conclusion_rule: fixture.conclusionRule,
      notification_team_name: normalizeTeamNotificationDisplayName(fixture.notificationTeamName),
      match_date: fixture.matchDate,
      match_duration_minutes: fixture.matchDurationMinutes,
      motm_notify_results_on_close: fixture.motmNotifyResultsOnClose,
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
  const match = normalizeCoachMatchDay({ ...data, clubName: user.clubName })
  const auditWarning = await settleCoachFixtureAudit(
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
    }),
  )
  let calendarScopeResult = null
  let calendarScopeWarning = ''
  if (normalizedCalendarTarget === 'squad') {
    const { data: scopeResult, error: scopeError } = await supabase.rpc('sync_calendar_event_parent_scope_v2', {
      calendar_event_id_value: null,
      include_trial_players_value: false,
      match_day_id_value: match.id,
      player_ids_value: fixture.selectedPlayerIds,
      selection_mode_value: 'manual',
    })
    if (scopeError) {
      calendarScopeWarning = normalize(scopeError.message) || 'Squad calendars could not be updated.'
    } else {
      calendarScopeResult = scopeResult
    }
  }
  let invitationResult = null
  let invitationWarning = ''
  if (fixture.parentVisible && !normalizedCalendarTarget) {
    try {
      invitationResult = await sendCoachFixtureInvitations(user, { ...match, parentVisible: true }, fixture.selectedPlayerIds)
      invitationWarning = fixtureInvitationWarning(invitationResult)
    } catch (invitationError) {
      invitationWarning = normalize(invitationError?.message) || 'The fixture was saved, but Parent invitations remain unsent.'
    }
  }
  return Object.freeze({ auditWarning, calendarScopeResult, calendarScopeWarning, calendarTarget: normalizedCalendarTarget, invitationResult, invitationWarning, match })
}

export async function getCoachMatchLocations(user, matches = []) {
  assertCoachMatchDayAccess(user)
  const { data, error } = await supabase
    .from('match_locations')
    .select('id,name,address,notes,archived_at')
    .eq('club_id', user.clubId)
    .order('name', { ascending: true })
  if (error) throw error
  const archived = new Set((data || []).filter((row) => row.archived_at).map((row) => `${normalize(row.name).toLowerCase()}|${normalize(row.address).toLowerCase()}`))
  const rows = [
    ...(data || []).filter((row) => !row.archived_at),
    ...(matches || []).filter((match) => !archived.has(`${normalize(match.venueName).toLowerCase()}|${normalize(match.venueAddress).toLowerCase()}`)).map((match) => ({ id: normalize(match.locationId) || `used:${normalize(match.venueName).toLowerCase()}:${normalize(match.venueAddress).toLowerCase()}`, name: match.venueName, address: match.venueAddress, notes: '' })),
  ]
  const seen = new Set()
  return rows.filter((row) => {
    const key = `${normalize(row.name).toLowerCase()}|${normalize(row.address).toLowerCase()}`
    if (!normalize(row.name) || seen.has(key)) return false
    seen.add(key)
    return true
  }).map((row) => ({
    id: row.id,
    name: normalize(row.name),
    address: normalize(row.address),
    label: [normalize(row.name), normalize(row.address)].filter(Boolean).join(' | '),
  }))
}

export async function archiveCoachMatchLocation(user, location) {
  assertCoachOperationalMutation(user, { minimumRank: 20, requiresTeam: true })
  const rawId = normalize(location?.id)
  const { data, error } = await supabase.rpc('archive_match_location_for_team', {
    p_address: normalize(location?.address),
    p_location_id: rawId && !rawId.startsWith('used:') ? rawId : null,
    p_name: normalize(location?.name),
    p_team_id: user.activeTeamId,
  })
  if (error) throw error
  return data
}

export function buildCoachFixtureUpdatePayload(form = {}, fixture = {}, locationId = '') {
  const fixtureUpdate = {
    arrivalTime: fixture.kickoffTimeTbc ? '' : fixture.arrivalTime,
    conclusionRule: normalizeMatchDayConclusionRule(fixture.conclusionRule),
    extraTimeHalfMinutes: fixture.extraTimeHalfMinutes,
    extraTimePeriodCount: fixture.extraTimePeriodCount,
    fixtureType: fixture.fixtureType,
    pitchType: fixture.pitchType,
    homeAway: assertNewMatchHomeAway(fixture.homeAway),
    kickoffTime: fixture.kickoffTime,
    kickoffTimeTbc: fixture.kickoffTimeTbc,
    locationId: locationId || '',
    matchDate: fixture.matchDate,
    matchDurationMinutes: assertValidMatchDurationMinutes(fixture.matchDurationMinutes),
    notes: fixture.notes,
    notificationTeamName: normalizeTeamNotificationDisplayName(fixture.notificationTeamName),
    opponent: fixture.opponent,
    shirtChoice: assertMatchDayShirtChoice(fixture.shirtChoice),
    venueAddress: fixture.venueAddress,
    venueName: fixture.venueName,
  }
  // A failed optional default lookup must never guess a Car pool value for an existing fixture.
  if (typeof form.carpoolEnabled === 'boolean') fixtureUpdate.carpoolEnabled = fixture.carpoolEnabled
  return fixtureUpdate
}

export async function updateCoachMatchDayFixture(user, match, form) {
  await prepareMutation(user, match)
  if (!isCoachFixtureEditable(match)) {
    throw new Error('Edit fixture details before kick-off.')
  }
  const fixture = validateCoachFixtureForm({ ...form, parentVisible: false, selectedPlayerIds: [] })
  if (fixture.rememberNotificationTeamName) {
    await saveCoachTeamNotificationDisplayName(user, user.activeTeamId, fixture.notificationTeamName)
  }
  const { data: locationId, error: locationError } = await supabase.rpc('upsert_match_location_for_team', {
    p_address: fixture.venueAddress,
    p_name: fixture.venueName,
    p_notes: '',
    p_team_id: user.activeTeamId,
  })
  if (locationError) throw locationError
  const fixtureUpdate = buildCoachFixtureUpdatePayload(form, fixture, locationId)
  const { data, error } = await supabase.rpc('update_match_day_fixture_for_team', {
    p_fixture: fixtureUpdate,
    p_match_day_id: match.id,
    p_team_id: user.activeTeamId,
  })
  if (error) throw error
  return normalizeCoachMatchDay({ ...data, clubName: user.clubName })
}

export async function deleteCoachMatchDayFixture(user, match) {
  await prepareMutation(user, match, 30)
  const result = await rpc('delete_match_day_fixture_for_team', {
    p_match_day_id: match.id,
    p_team_id: user.activeTeamId,
  })
  if (result?.deleted !== true) throw new Error('Match deletion could not be confirmed. Refresh Game Day before retrying.')
  return result
}

export async function removeCoachCancelledFixture(user, matchDayId, isCurrent = () => true) {
  const match = await getCoachMatchDayDetail(user, matchDayId, { includeVolunteerEligibility: false })
  await prepareMutation(user, match, 50)
  if (!isCurrent() || match.status !== 'cancelled') throw new Error('Only a cancelled fixture can be removed here. Refresh Calendar and try again.')
  const { data: sessionData } = await supabase.auth.getSession()
  if (!isCurrent() || sessionData.session?.user?.id !== user.id) throw new Error('The signed-in account changed. Reopen Calendar.')
  const { data, error } = await supabase.rpc('delete_previous_match_day_v2', { match_day_id_value: match.id })
  if (error) throw error
  if (data?.deleted !== true) throw new Error('Fixture removal could not be confirmed. Refresh Calendar before retrying.')
  return data
}

export async function cancelCoachMatchDayFixture(user, match, cancellationReason = '') {
  await prepareMutation(user, match)
  if (match.concludedAt || !['scheduled', 'scorer_request', 'postponed'].includes(normalize(match.status))) {
    throw new Error('Only a fixture that has not started can be cancelled.')
  }
  const { data, error } = await supabase.rpc('cancel_match_day_fixture_for_team', {
    p_match_day_id: match.id,
    p_team_id: user.activeTeamId,
    p_reason: normalize(cancellationReason),
  })
  if (error) throw error
  return normalizeCoachMatchDay({ ...data, clubName: user.clubName })
}

export async function getCoachMatchDayDetail(user, matchDayId, { includeVolunteerEligibility = true } = {}) {
  assertCoachMatchDayAccess(user)
  if (!normalize(matchDayId)) throw new Error('Choose a Match Day fixture.')
  const { data, error } = await supabase.rpc('get_staff_match_day_detail', {
    active_team_id_value: user.activeTeamId,
    target_match_day_id_value: matchDayId,
  })
  if (error) throw error
  if (!data?.id) throw new Error('This match day is not linked to your active Team.')
  const upcoming = ['scheduled', 'scorer_request'].includes(data.status)
  const canLoadContacts = upcoming && Number(user.roleRank || 0) >= 20
  const loadEligibility = async () => {
    try {
      const config = getMobileRuntimeConfig('coach')
      const accessToken = await getAccessToken()
      if (!config.apiBaseUrl || !accessToken) throw new Error('Login is required to load volunteer eligibility.')
      const url = `${joinApiPath(config.apiBaseUrl, '.netlify/functions/select-match-day-volunteer')}?matchDayId=${encodeURIComponent(matchDayId)}`
      const response = await fetchJsonWithTimeout(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (!response.ok || response.result?.success !== true) throw new Error(response.result?.message || 'Volunteer eligibility could not be loaded.')
      return response.result
    } catch (eligibilityError) {
      return { volunteerEligibilityError: normalize(eligibilityError?.message) || 'Volunteer eligibility could not be loaded.' }
    }
  }
  const [contacts, eligibility, presentation] = await Promise.all([
    canLoadContacts ? supabase.rpc('get_match_day_squad_notification_contacts', { match_id: matchDayId }) : null,
    includeVolunteerEligibility && upcoming ? loadEligibility() : null,
    upcoming ? supabase.rpc('get_match_day_presentation_states', { match_day_ids_value: [matchDayId] }) : null,
  ])
  if (presentation?.error) throw presentation.error
  const result = { ...data }
  // Missing contact metadata disables Notify without blocking the fixture or live controller.
  if (canLoadContacts) result.squad_notification_contacts = !contacts?.error && Array.isArray(contacts?.data) ? contacts.data : []
  if (eligibility && !eligibility.volunteerEligibilityError) {
    const byRequest = new Map((eligibility.eligibility || []).map(item => [String(item.request_id || ''), item]))
    result.eligibleParents = eligibility.eligibleParents || []
    result.match_day_availability_requests = (result.match_day_availability_requests || []).map(item => {
      const eligible = byRequest.get(String(item.id))
      return { ...item, scorer_eligible: eligible?.eligible === true, scorer_eligibility_reason: eligible?.reason || '',
        parent_link_id: eligible?.parent_link_id || item.parent_link_id, auth_user_id: eligible?.auth_user_id || item.auth_user_id,
        recipient_email: eligible?.recipient_email || item.recipient_email, recipient_name: eligible?.recipient_name || item.recipient_name }
    })
  }
  const match = { ...normalizeCoachMatchDay({ ...result, ...(presentation?.data?.[0] || {}), clubName: user.clubName }), volunteerEligibilityError: normalize(eligibility?.volunteerEligibilityError) }
  if (isMatchDayParticipantRosterCurrent(match)) {
    const roster = await supabase.rpc('get_match_day_event_participants', { match_day_id_value: match.id, parent_link_id_value: null })
    if (roster.error) throw roster.error
    match.eventParticipants = normalizeMatchDayParticipantRoster(roster.data, match)
    match.substitutionParticipants = normalizeMatchDayParticipantRoster(roster.data, match, 'substitutionPlayers')
    match.events = mergeMatchDayParticipantEventIdentities(match.events, roster.data, match)
  }
  return match
}

async function prepareMutation(user, match, minimumRank = 20) {
  assertCoachMatchDayAccess(user)
  assertCoachOperationalMutation(user, { minimumRank, requiresTeam: true })
  if (!normalize(match?.id)) throw new Error('Choose a Match Day fixture.')
  if (match?.deletedAt || match?.previousHiddenAt) throw new Error('This Match Day fixture is archived or unavailable.')
  assertScope(user, match)
}
async function rpc(name, parameters) { const { data, error } = await supabase.rpc(name, parameters); if (error) throw error; return data }

async function sendCoachMatchDayPush(match, type, eventId = '') {
  const normalizedType = normalize(type)
  if (!normalizedType) return null
  const config = getMobileRuntimeConfig('coach')
  const accessToken = await getAccessToken()
  if (!config.apiBaseUrl || !accessToken) return null
  const url = joinApiPath(config.apiBaseUrl, '.netlify/functions/send-match-day-push')
  const options = {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: normalize(eventId), matchDayId: match.id, type: normalizedType }),
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchJsonWithTimeout(url, options)
      if (response.ok && response.result?.success !== false) return response.result
    } catch {
      if (attempt === 1) return null
    }
  }
  return null
}

export function createCoachMatchDayCommandId() { return requestId() }

export async function syncCoachMatchDayCommand(user, command, baseMatch) {
  await prepareMutation(user, baseMatch)
  const result = await rpc(command.payload?.participantRosterVersion === 1 ? 'apply_coach_match_day_command_v2' : 'apply_coach_match_day_command', {
    command_id_value: command.id, match_day_id_value: command.matchId,
    kind_value: command.kind, payload_value: command.payload, captured_at_value: command.capturedAt,
    expected_updated_at_value: command.expectedUpdatedAt, previous_command_id_value: command.previousCommandId,
  })
  const config = getMobileRuntimeConfig('coach')
  const token = await getAccessToken()
  if (config.apiBaseUrl && token) {
    // The saved server command also has a scheduled retry if this immediate request is lost.
    void fetchJsonWithTimeout(joinApiPath(config.apiBaseUrl, '.netlify/functions/send-coach-match-day-command-notification'), {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: command.id }),
    }).catch(() => {})
  }
  const events = result.savedEvent
    ? [...(baseMatch.events || []).filter(event => event.requestId !== command.id), result.savedEvent]
    : baseMatch.events || []
  return { ...normalizeCoachMatchDay({ ...mergeMatchDayCommandSnapshot(baseMatch, result), events }), isHydrated: baseMatch.isHydrated }
}

export async function runCoachMatchDayTimerAction(user, match, action) {
  await prepareMutation(user, match)
  const value = normalize(action)
  if (value === 'start') await rpc('start_match_day', { match_day_id_value: match.id })
  else if (STANDARD_TIMER_ACTIONS.has(value)) await rpc('set_match_day_timer_state', { match_day_id_value: match.id, action_value: value })
  else if (EXTENDED_TIMER_ACTIONS.has(value)) await rpc('set_match_day_extended_state', { match_day_id_value: match.id, action_value: value })
  else throw new Error('Choose a supported Match Day clock action.')
  const pushType = value === 'start'
    ? 'live'
    : value === 'resume' && normalize(match?.status).toLowerCase() === 'half_time'
      ? 'second_half'
      : ['half_time', 'full_time'].includes(value)
        ? value
        : value === 'start_extra_time'
          ? 'extra_time'
          : value === 'start_penalties'
            ? 'penalties'
          : ['pause', 'hydration', 'resume'].includes(value)
            ? 'live_clock_refresh'
            : ''
  await sendCoachMatchDayPush(match, pushType)
  return getCoachMatchDayDetail(user, match.id)
}

export async function endCoachMatchDayWithoutShootoutResult(user, match) {
  await prepareMutation(user, match)
  if (normalize(match?.currentMatchPhase) !== 'penalties' || normalize(match?.status) !== 'penalties') {
    throw new Error('Refresh Match Day before ending this shootout.')
  }
  await rpc('end_match_day_without_shootout_result', { match_day_id_value: match.id })
  await sendCoachMatchDayPush(match, 'full_time')
  return getCoachMatchDayDetail(user, match.id)
}

export async function setCoachMatchDaySquadDecision(user, match, playerId, decision, expectedDecidedAt = null) {
  await prepareMutation(user, match)
  await rpc('set_match_day_player_squad_decision_v2', { match_day_id_value: match.id, player_id_value: playerId, decision_value: normalizeMatchDaySquadDecision(decision), expected_decided_at_value: expectedDecidedAt || null })
  // Read the authoritative revisions without reloading volunteer eligibility,
  // contacts and presentation data for every player in the save sequence.
  const detail = await rpc('get_staff_match_day_detail', { active_team_id_value: user.activeTeamId, target_match_day_id_value: match.id })
  if (!detail?.id || detail.id !== match.id) throw new Error('This match day is not linked to your active Team.')
  const latest = normalizeCoachMatchDay(detail)
  if (latest.status !== match.status) return getCoachMatchDayDetail(user, match.id)
  return { ...match, squadDecisions: latest.squadDecisions, updatedAt: latest.updatedAt }
}

export async function setCoachMatchDaySquadDecisions(user, match, choices) {
  await prepareMutation(user, match)
  const detail = await rpc('set_match_day_squad_decisions_batch', {
    match_day_id_value: match.id, active_team_id_value: user.activeTeamId,
    decisions_value: choices.map(({ player, decision }) => ({ playerId: player.id, decision: normalizeMatchDaySquadDecision(decision), expectedDecidedAt: player.decidedAt || null })),
  })
  if (!detail?.id || detail.id !== match.id) throw new Error('This match day is not linked to your active Team.')
  const latest = normalizeCoachMatchDay(detail)
  if (latest.status !== match.status) return getCoachMatchDayDetail(user, match.id)
  return { ...match, squadDecisions: latest.squadDecisions, updatedAt: latest.updatedAt }
}

export async function notifyCoachMatchDaySquadDecision(user, match, playerId, revision) {
  await prepareMutation(user, match)
  const config = getMobileRuntimeConfig('coach')
  if (!config.isProduction) throw new Error('Parent notifications are disabled in the test app.')
  const token = await getAccessToken()
  if (!token) throw new Error('Sign in again before notifying parents.')
  const { ok, result } = await fetchJsonWithTimeout(joinApiPath(config.apiBaseUrl, '.netlify/functions/notify-match-day-squad'), {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchId: match.id, playerId, revision }),
  })
  if (!ok || result?.sent !== true) throw new Error(result?.message || 'The parent notification could not be confirmed.')
  return getCoachMatchDayDetail(user, match.id)
}

export async function notifyCoachMatchDaySquadDecisions(user, match, decisions) {
  await prepareMutation(user, match)
  const config = getMobileRuntimeConfig('coach')
  if (!config.isProduction) throw new Error('Parent notifications are disabled in the test app.')
  const token = await getAccessToken()
  if (!token) throw new Error('Sign in again before notifying parents.')
  const { ok, result } = await fetchJsonWithTimeout(joinApiPath(config.apiBaseUrl, '.netlify/functions/notify-match-day-squad'), {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchId: match.id, decisions: decisions.map(({ id, decisionRevision }) => ({ playerId: id, revision: decisionRevision })) }),
  })
  if (!ok || !Array.isArray(result?.results)) throw new Error(result?.message || 'Notifications could not be confirmed. Try again.')
  return result.results
}

export async function recordCoachMatchDayEvent(user, match, event, commandId = '') {
  await prepareMutation(user, match)
  const type = normalize(event?.eventType)
  let savedEvent = null
  if (type === 'goal') {
    savedEvent = await rpc('record_match_day_goal_v4', { match_day_id_value: match.id, parent_link_id_value: null, team_side_value: event.teamSide === 'opponent' ? 'opponent' : 'club', scorer_player_id_value: normalize(event.scorerPlayerId) || null, assist_player_id_value: event.isOwnGoal ? null : normalize(event.assistPlayerId) || null, scorer_name_value: normalize(event.scorerName), scorer_shirt_number_value: normalize(event.scorerShirtNumber), assist_name_value: normalize(event.assistName), assist_shirt_number_value: normalize(event.assistShirtNumber), minute_value: event.minute ?? null, notes_value: normalize(event.notes), is_penalty_goal_value: event.isPenaltyGoal === true, is_own_goal_value: event.isOwnGoal === true, stoppage_minute_value: event.stoppageMinute ? Number(event.stoppageMinute) : null, request_id_value: normalize(commandId) || requestId() })
  } else {
    if (!STAFF_EVENT_TYPES.has(type)) throw new Error('Choose a supported Match Day event type.')
    savedEvent = await rpc('record_match_day_scorer_event_v2', { match_day_id_value: match.id, parent_link_id_value: null, stoppage_minute_value: event.stoppageMinute ? Number(event.stoppageMinute) : null, event_type_value: type, team_side_value: event.teamSide === 'opponent' ? 'opponent' : 'club', minute_value: event.minute ?? null, player_id_value: normalize(event.playerPlayerId) || null, player_on_id_value: normalize(event.playerOnPlayerId) || null, player_name_value: normalize(event.playerName), player_shirt_number_value: normalize(event.playerShirtNumber), player_on_name_value: normalize(event.playerOnName), player_on_shirt_number_value: normalize(event.playerOnShirtNumber), notes_value: normalize(event.notes), request_id_value: normalize(commandId) || requestId() })
  }
  if (type === 'goal' || type === 'yellow_card' || type === 'red_card' || type === 'substitution') await sendCoachMatchDayPush(match, type, savedEvent?.id)
  return getCoachMatchDayDetail(user, match.id)
}

export async function correctCoachMatchDayScore(user, match, homeScore, awayScore, commandId = '') {
  await prepareMutation(user, match)
  const savedEvent = await rpc('record_match_day_score_correction_v2', { match_day_id_value: match.id, parent_link_id_value: null, home_score_value: integer(homeScore), away_score_value: integer(awayScore), notes_value: 'Score corrected in the Coach app', request_id_value: normalize(commandId) || requestId() })
  await sendCoachMatchDayPush(match, 'score_correction', savedEvent?.id)
  return getCoachMatchDayDetail(user, match.id)
}

export async function correctCoachMatchDayGoal(user, match, event, goal, reason = '') {
  await prepareMutation(user, match)
  await rpc('correct_coach_match_day_goal_v2', { scorer_player_id_value: normalize(goal.scorerPlayerId) || null, assist_player_id_value: goal.isOwnGoal ? null : normalize(goal.assistPlayerId) || null, match_day_id_value: match.id, goal_event_id_value: event.id, team_side_value: goal.teamSide === 'opponent' ? 'opponent' : 'club', scorer_name_value: normalize(goal.scorerName), scorer_shirt_number_value: normalize(goal.scorerShirtNumber), assist_name_value: normalize(goal.assistName), assist_shirt_number_value: normalize(goal.assistShirtNumber), minute_value: goal.minute ?? null, notes_value: normalize(goal.notes), correction_reason_value: normalize(reason), is_own_goal_value: goal.isOwnGoal === true, is_penalty_goal_value: goal.isOwnGoal !== true && goal.isPenaltyGoal === true, stoppage_minute_value: goal.stoppageMinute ? Number(goal.stoppageMinute) : null })
  return getCoachMatchDayDetail(user, match.id)
}

export async function saveCoachConcludedMatchEvent(user, match, { changeId, details, eventId, expectedUpdatedAt, operation }) {
  await prepareMutation(user, match, 30)
  await rpc('save_coach_concluded_match_event', {
    change_id: changeId,
    details,
    event_id: eventId || null,
    expected_updated_at: expectedUpdatedAt,
    match_id: match.id,
    operation,
  })
  return getCoachMatchDayDetail(user, match.id, { includeVolunteerEligibility: false })
}

export async function voidCoachMatchDayEvent(user, match, event, { note = '', reasonCode = '' } = {}) {
  await prepareMutation(user, match)
  const validated = validateMatchDayEventUndoInput({ eventType: event.eventType, note, reasonCode })
  await rpc('void_coach_match_day_event_v1', { match_day_id_value: match.id, event_id_value: event.id, reason_code_value: validated.reasonCode, note_value: validated.note })
  return getCoachMatchDayDetail(user, match.id)
}

export async function recordCoachMatchDayShootoutKick(user, match, kick) {
  await prepareMutation(user, match)
  const saved = await rpc('record_match_day_shootout_kick', { match_day_id_value: match.id, team_side_value: kick.teamSide === 'opponent' ? 'opponent' : 'club', outcome_value: kick.outcome === 'missed' ? 'missed' : 'scored', player_name_value: normalize(kick.playerName), notes_value: normalize(kick.notes) })
  if (saved?.id) void sendCoachMatchDayPush(match, 'shootout_kick', saved.id)
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
  if (selected !== false && !request?.requestId && !request?.directParentLinkId) throw new Error('Choose a parent or volunteer response first.')
  if (selected === false && !request?.parentLinkId) throw new Error('Choose the current volunteer assignment first.')
  const config = getMobileRuntimeConfig('coach')
  const accessToken = await getAccessToken()
  if (!config.apiBaseUrl || !accessToken) throw new Error('Login is required.')
  const response = await fetchJsonWithTimeout(joinApiPath(config.apiBaseUrl, '.netlify/functions/select-match-day-volunteer'), { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request.directParentLinkId ? { matchDayId: match.id, directParentLinkId: request.directParentLinkId, role, selected: true } : { matchDayId: match.id, parentLinkId: request.parentLinkId, requestId: request.requestId || '', role, selected: selected !== false }) })
  if (!response.ok || response.result?.success === false) throw new Error(response.result?.message || 'Volunteer selection could not be updated.')
  const detail = await getCoachMatchDayDetail(user, match.id)
  return { ...detail, volunteerSelectionWarning: normalize(response.result?.warning) }
}
