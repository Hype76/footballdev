import { buildCoachCalendarOccurrenceDates } from '../../../apps/mobile-core/src/coachCalendarCore.js'
import { getParentProductDateTimeParts } from '../../../apps/mobile-core/src/parentDateTimeCore.js'
import { upcomingFanSchedule } from '../../../src/lib/fan-schedule.js'
import { getMatchDayDisplayName } from '../../../src/lib/matchday-display.js'
import { FAN_GAME_DAY_STATUSES, isFanGameDayMatch } from '../../../src/lib/fan-game-day.js'

async function rows(query) {
  const { data, error } = await query
  if (error) throw error
  return data || []
}
export function canFanViewMatch(match, parent, involvedIds) {
  return match.parent_visible === true && match.parent_audience !== 'none' && !match.deleted_at
    && !match.previous_hidden_at && match.club_id === parent.club_id
    && (match.parent_audience === 'all_club_parents'
      || (match.parent_audience === 'all_team_parents' && match.team_id === parent.team_id)
      || (match.parent_audience === 'involved_players' && involvedIds.has(match.id)))
}
export async function addPlayerSelectedSquads(client, scope, matches) {
  if (scope.fan.relationship_type !== 'player') return matches
  const scoped = matches.filter(match => match.team_id === scope.player.team_id)
  if (!scoped.length) return matches
  const decisions = await rows(client.from('match_day_player_squad_decisions').select('match_day_id,player_id')
    .eq('club_id', scope.fan.club_id).eq('team_id', scope.player.team_id).eq('status', 'selected').in('match_day_id', scoped.map(match => match.id)))
  const ids = [...new Set(decisions.map(row => row.player_id))]
  const players = ids.length ? await rows(client.from('players').select('id,player_name,status,archived_at')
    .eq('club_id', scope.fan.club_id).eq('team_id', scope.player.team_id).in('id', ids)) : []
  const names = new Map(players.filter(player => player.status !== 'archived' && !player.archived_at && player.player_name?.trim()).map(player => [player.id, player.player_name.trim()]))
  return matches.map(match => match.team_id !== scope.player.team_id ? match : ({ ...match,
    selected_player_names: [...new Set(decisions.filter(row => row.match_day_id === match.id).map(row => row.player_id))]
      .filter(id => names.has(id)).map(id => names.get(id)).sort((a, b) => a.localeCompare(b, 'en-GB')),
  }))
}

function normalizeSharedFormationPlayer(row = {}) {
  const displayName = String(row.display_name ?? row.displayName ?? row.player_name ?? row.playerName ?? row.name ?? '').trim()
  if (!displayName) return null
  const positionGroup = String(row.position_group ?? row.positionGroup ?? '').trim().toLowerCase()
  const x = Number(row.x)
  const y = Number(row.y)
  return {
    display_name: displayName,
    player_id: String(row.player_id ?? row.playerId ?? '').trim(),
    shirt_number: String(row.shirt_number ?? row.shirtNumber ?? '').trim(),
    ...( ['goalkeeper', 'defender', 'midfielder', 'forward'].includes(positionGroup) ? { position_group: positionGroup } : {}),
    x: Number.isFinite(x) ? x : 0.5,
    y: Number.isFinite(y) ? y : 0.5,
  }
}

export async function addPublishedFormationPlans(client, scope, matches) {
  if (!matches.length || scope.fan.relationship_type !== 'player') return matches
  const matchIds = matches.map((match) => match.id).filter(Boolean)
  const createPublicationQuery = () => client.from('formation_board_match_publications')
    .select('match_day_id, board_id, id, publication_number, board_title_snapshot, published_at, withdrawn_at, board_version_id')
    .eq('club_id', scope.fan.club_id)
    .eq('team_id', scope.player.team_id)
    .in('match_day_id', matchIds)
    .order('publication_number', { ascending: false })
    .order('id', { ascending: false })
  const publicationRows = []
  for (let page = 0; ; page += 1) {
    const { data, error } = await createPublicationQuery().range(page * 1000, page * 1000 + 999)
    if (error) throw error
    publicationRows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  const latestByBoard = new Map()
  for (const row of publicationRows || []) {
    const key = `${row.match_day_id}:${row.board_id}`
    const previous = latestByBoard.get(key)
    if (!previous || Number(row.publication_number || 0) > Number(previous.publication_number || 0)) latestByBoard.set(key, row)
  }
  const latest = [...latestByBoard.values()].filter((row) => !row.withdrawn_at)
  const versionIds = latest.map((row) => row.board_version_id).filter(Boolean)
  const { data: versions, error: versionError } = versionIds.length
    ? await client.from('formation_board_versions').select('id, game_format, formation_preset_key, pitch_orientation, placements, bench').in('id', versionIds)
    : { data: [], error: null }
  if (versionError) throw versionError
  const versionsById = new Map((versions || []).map((version) => [String(version.id), version]))
  const plansByMatchId = new Map()
  for (const row of latest) {
    const version = versionsById.get(String(row.board_version_id))
    if (!version) continue
    const publicationId = String(row.publication_id ?? row.publicationId ?? row.id ?? '').trim()
    const matchId = String(row.match_day_id ?? row.matchDayId ?? '').trim()
    if (!publicationId || !matchId) continue
    const plans = plansByMatchId.get(matchId) || []
    plans.push({
      board_id: String(row.board_id ?? row.boardId ?? row.formation_board_id ?? row.formationBoardId ?? '').trim(),
      board_title_snapshot: String(row.board_title_snapshot ?? row.boardTitleSnapshot ?? row.title ?? '').trim(),
      bench: (Array.isArray(version.bench) ? version.bench : []).map(normalizeSharedFormationPlayer).filter(Boolean),
      formation: String(version.formation ?? version.formation_name ?? version.formationName ?? '').trim(),
      formation_preset_key: String(version.formation_preset_key ?? version.formationPresetKey ?? '').trim(),
      game_format: String(version.game_format ?? version.gameFormat ?? '').trim(),
      pitch_orientation: String(version.pitch_orientation ?? version.pitchOrientation ?? 'portrait').trim() || 'portrait',
      placements: (Array.isArray(version.placements) ? version.placements : []).map(normalizeSharedFormationPlayer).filter(Boolean),
      publication_id: publicationId,
      publication_number: Number(row.publication_number ?? row.publicationNumber ?? 0),
      published_at: row.published_at ?? row.publishedAt ?? '',
    })
    plansByMatchId.set(matchId, plans)
  }
  return matches.map((match) => {
    const plans = plansByMatchId.get(String(match.id)) || []
    return { ...match, formation_plans: plans, formation_plan: plans[0] || null }
  })
}

export async function loadFanMatches(client, scope, matchId = '', { includeScheduled = false } = {}) {
  const playerMatchAccess = includeScheduled && scope.fan.relationship_type === 'player'
  const scheduleAllowed = includeScheduled && scope.fan.permissions?.schedule === true
  let query = client.from('match_days').select('id, title, club_id, team_id, opponent, match_date, kickoff_time, kickoff_time_tbc, arrival_time, home_away, shirt_choice, venue_name, status, home_score, away_score, updated_at, parent_visible, parent_audience, deleted_at, previous_hidden_at')
    .eq('club_id', scope.fan.club_id).eq('parent_visible', true).is('deleted_at', null).is('previous_hidden_at', null)
    .gte('match_date', new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)).order('match_date', { ascending: false }).limit(100)
  if (playerMatchAccess) query = query.in('status', [...new Set([...FAN_GAME_DAY_STATUSES, 'scheduled'])])
  else if (!scheduleAllowed) query = query.in('status', FAN_GAME_DAY_STATUSES)
  if (matchId) query = query.eq('id', matchId)
  const candidates = await rows(query)
  const [requests, invitations, decisions] = await Promise.all([
    rows(client.from('match_day_availability_requests').select('match_day_id').eq('club_id', scope.fan.club_id).eq('player_id', scope.player.id).neq('status', 'expired')),
    rows(client.from('calendar_event_invites').select('match_day_id').eq('club_id', scope.fan.club_id).eq('player_id', scope.player.id).neq('invite_status', 'cancelled')),
    rows(client.from('match_day_player_squad_decisions').select('match_day_id,status,notified_at').eq('club_id', scope.fan.club_id).eq('team_id', scope.player.team_id).eq('player_id', scope.player.id)),
  ])
  const involved = new Set([...requests, ...invitations, ...decisions.filter((d) => d.status === 'selected' || d.notified_at)].map((row) => row.match_day_id))
  const allowed = []
  for (const match of candidates) {
    if (canFanViewMatch(match, scope.parent, involved) && (scheduleAllowed || playerMatchAccess || isFanGameDayMatch(match))) {
      const { parent_visible: _visible, parent_audience: _audience, deleted_at: _deleted, previous_hidden_at: _hidden, ...safe } = match
      allowed.push({ ...safe, club_name: scope.club.name })
    }
  }
  const withSquads = await addPlayerSelectedSquads(client, scope, allowed)
  return addPublishedFormationPlans(client, scope, withSquads)
}
export async function loadFanSchedule(client, scope, now = new Date(), { featureAllowed = () => true, includePast = false } = {}) {
  const canAssessments = featureAllowed('assessments')
  const canFixtures = featureAllowed('fixtures')
  const canGeneralEvents = featureAllowed('generalEvents')
  const canRecurringEvents = featureAllowed('recurringEvents')
  const canTrainingEvents = featureAllowed('trainingEvents')
  const canReadCalendarEvents = canGeneralEvents || canTrainingEvents
  const trainingQuery = canTrainingEvents
    ? client.from('training_availability_request_players').select('request_id,calendar_event_id').eq('club_id', scope.fan.club_id).eq('player_id', scope.player.id).neq('status', 'cancelled')
    : null
  if (trainingQuery && !includePast) trainingQuery.neq('status', 'expired')
  const [matches, invitations, shared, training, exclusions] = await Promise.all([
    canFixtures ? loadFanMatches(client, scope, '', { includeScheduled: true }) : [],
    (canReadCalendarEvents || canAssessments)
      ? rows(client.from('calendar_event_invites').select('calendar_event_id, assessment_session_id').eq('club_id', scope.fan.club_id).eq('player_id', scope.player.id).neq('invite_status', 'cancelled'))
      : [],
    canReadCalendarEvents
      ? rows(client.from('calendar_events').select('id,title,starts_at,ends_at,location,event_type,parent_visible,parent_audience,team_id,recurrence_frequency,recurrence_until')
        .eq('club_id', scope.fan.club_id).is('cancelled_at', null))
      : [],
    trainingQuery ? rows(trainingQuery) : [],
    canReadCalendarEvents
      ? rows(client.from('event_player_occurrence_exclusions').select('calendar_event_id,scope,effective_from_date').eq('club_id', scope.fan.club_id).eq('player_id', scope.player.id))
      : [],
  ])
  const requestIds = [...new Set(training.map((item) => item.request_id))]
  const occurrences = requestIds.length ? await rows(client.from('training_availability_requests').select('calendar_event_id,occurrence_date,occurrence_starts_at,occurrence_ends_at').in('id', requestIds).neq('status', 'cancelled')) : []
  const allowedEvents = shared.filter((event) => {
    const eventAllowed = event.event_type === 'training' ? canTrainingEvents
      : event.event_type === 'match' ? canFixtures
        : canGeneralEvents
    return eventAllowed && (canRecurringEvents || (event.recurrence_frequency || 'none') === 'none')
  })
  const allowedEventIds = new Set(allowedEvents.map((event) => event.id))
  const invitedIds = new Set(invitations.map((row) => row.calendar_event_id).filter((id) => allowedEventIds.has(id)))
  const schedule = buildFanScheduleEvents({ events: allowedEvents, invitedIds, occurrences, exclusions, parent: scope.parent, now, includePast })
  const assessmentIds = canAssessments ? [...new Set(invitations.map((row) => row.assessment_session_id).filter(Boolean))] : []
  if (assessmentIds.length) {
    const sessions = await rows(client.from('assessment_sessions').select('id,title,session_date,start_time,end_time,location,status').in('id', assessmentIds).eq('club_id', scope.fan.club_id).neq('status', 'cancelled'))
    schedule.push(...sessions.map((session) => ({ id: session.id, title: session.title || 'Assessment', date: session.session_date, time: session.start_time, end_time: session.end_time, location: session.location, event_type: 'assessment', status: session.status })))
  }
  schedule.push(...matches.map((match) => ({ id: match.id, title: getMatchDayDisplayName(match), date: match.match_date, time: match.kickoff_time_tbc ? '' : match.kickoff_time, location: match.venue_name, home_away: match.home_away, selected_player_names: match.selected_player_names, event_type: 'match_day', status: match.status })))
  if (includePast) {
    const earliest = getParentProductDateTimeParts(new Date(now.getTime() - 90 * 86400000)).date
    return schedule.filter(item => getParentProductDateTimeParts(item.starts_at || item.date).date >= earliest && !['cancelled', 'postponed'].includes(item.status))
  }
  return upcomingFanSchedule(schedule, now)
}

export async function loadPlayerAttendance(client, scope, now = new Date(), { featureAllowed = () => true } = {}) {
  const canAssessments = featureAllowed('assessments')
  const canFixtures = featureAllowed('fixtures')
  const canTrainingEvents = featureAllowed('trainingEvents')
  const canReadInvitations = canAssessments || canTrainingEvents || featureAllowed('generalEvents')
  const schedule = await loadFanSchedule(client, scope, now, { featureAllowed, includePast: true })
  const [matches, training, invitations] = await Promise.all([
    canFixtures ? rows(client.from('match_day_player_availability').select('match_day_id,status').eq('club_id', scope.fan.club_id).eq('player_id', scope.player.id)) : [],
    canTrainingEvents ? rows(client.from('training_availability_request_players').select('request_id,calendar_event_id').eq('club_id', scope.fan.club_id).eq('player_id', scope.player.id).neq('status', 'cancelled')) : [],
    canReadInvitations ? rows(client.from('calendar_event_invites').select('calendar_event_id,assessment_session_id,invite_status').eq('club_id', scope.fan.club_id).eq('player_id', scope.player.id).neq('invite_status', 'cancelled')) : [],
  ])
  const requestIds = [...new Set(training.map(item => item.request_id))]
  const [occurrences, responses] = requestIds.length ? await Promise.all([
    rows(client.from('training_availability_requests').select('id,calendar_event_id,occurrence_date').in('id', requestIds).neq('status', 'cancelled')),
    rows(client.from('training_availability_responses').select('request_id,status').in('request_id', requestIds).eq('player_id', scope.player.id)),
  ]) : [[], []]
  const byId = new Map(matches.map(item => [item.match_day_id, item.status]))
  for (const occurrence of occurrences) byId.set(`${occurrence.calendar_event_id}:${occurrence.occurrence_date}`, responses.find(item => item.request_id === occurrence.id)?.status || 'awaiting_response')
  return schedule.map(item => ({ ...item,
    response: byId.get(item.id) || invitations.find(invite => invite.calendar_event_id === item.id.split(':')[0] || invite.assessment_session_id === item.id)?.invite_status || 'awaiting_response',
  }))
}

export function buildFanScheduleEvents({ events, invitedIds, occurrences, exclusions, parent, now = new Date(), includePast = false }) {
  const today = getParentProductDateTimeParts(includePast ? new Date(now.getTime() - 90 * 86400000) : now).date
  const horizon = new Date(now.getTime() + 90 * 86400000).toISOString().slice(0, 10)
  const result = new Map()
  const excluded = (eventId, date) => exclusions.some((e) => e.calendar_event_id === eventId && (e.scope === 'this_and_future' ? date >= e.effective_from_date : date === e.effective_from_date))
  for (const event of events) {
    const direct = invitedIds.has(event.id)
    const shared = event.parent_visible === true && (event.parent_audience === 'all_club_parents' || (event.parent_audience === 'all_team_parents' && event.team_id === parent.team_id))
    const start = getParentProductDateTimeParts(event.starts_at)
    const end = getParentProductDateTimeParts(event.ends_at)
    if (direct || shared) {
      const dates = buildCoachCalendarOccurrenceDates({ date: start.date, recurrenceFrequency: event.recurrence_frequency, recurrenceUntil: event.recurrence_until && event.recurrence_until < horizon ? event.recurrence_until : horizon })
      for (const date of dates) {
        if (date < today || date > horizon || excluded(event.id, date)) continue
        const id = `${event.id}:${date}`
        result.set(id, { id, title: event.title, date, time: start.time, end_time: end.time, location: event.location, event_type: event.event_type })
      }
    }
    for (const occurrence of occurrences.filter((o) => o.calendar_event_id === event.id)) {
      const date = occurrence.occurrence_date
      if (date < today || date > horizon || excluded(event.id, date)) continue
      const id = `${event.id}:${date}`
      result.set(id, { id, title: event.title, starts_at: occurrence.occurrence_starts_at, ends_at: occurrence.occurrence_ends_at, location: event.location, event_type: event.event_type })
    }
  }
  return [...result.values()]
}
