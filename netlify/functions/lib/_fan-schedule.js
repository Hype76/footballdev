import { buildCoachCalendarOccurrenceDates } from '../../../apps/mobile-core/src/coachCalendarCore.js'
import { getParentProductDateTimeParts } from '../../../apps/mobile-core/src/parentDateTimeCore.js'

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
export async function loadFanMatches(client, scope, matchId = '') {
  let query = client.from('match_days').select('id, club_id, team_id, opponent, match_date, kickoff_time, kickoff_time_tbc, arrival_time, home_away, venue_name, status, home_score, away_score, updated_at, parent_visible, parent_audience, deleted_at, previous_hidden_at')
    .eq('club_id', scope.fan.club_id).eq('parent_visible', true).is('deleted_at', null).is('previous_hidden_at', null)
    .gte('match_date', new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)).order('match_date', { ascending: false }).limit(100)
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
    if (canFanViewMatch(match, scope.parent, involved)) {
      const { parent_visible: _visible, parent_audience: _audience, deleted_at: _deleted, previous_hidden_at: _hidden, ...safe } = match
      allowed.push(safe)
    }
  }
  return allowed
}
export async function loadFanSchedule(client, scope) {
  const [matches, invitations, shared, training, exclusions] = await Promise.all([
    loadFanMatches(client, scope),
    rows(client.from('calendar_event_invites').select('calendar_event_id, assessment_session_id').eq('club_id', scope.fan.club_id).eq('player_id', scope.player.id).neq('invite_status', 'cancelled')),
    rows(client.from('calendar_events').select('id,title,starts_at,ends_at,location,event_type,parent_visible,parent_audience,team_id,recurrence_frequency,recurrence_until')
      .eq('club_id', scope.fan.club_id).is('cancelled_at', null)),
    rows(client.from('training_availability_request_players').select('request_id,calendar_event_id').eq('club_id', scope.fan.club_id).eq('player_id', scope.player.id).neq('status', 'cancelled').neq('status', 'expired')),
    rows(client.from('event_player_occurrence_exclusions').select('calendar_event_id,scope,effective_from_date').eq('club_id', scope.fan.club_id).eq('player_id', scope.player.id)),
  ])
  const requestIds = [...new Set(training.map((item) => item.request_id))]
  const occurrences = requestIds.length ? await rows(client.from('training_availability_requests').select('calendar_event_id,occurrence_date,occurrence_starts_at,occurrence_ends_at').in('id', requestIds).neq('status', 'cancelled')) : []
  const invitedIds = new Set(invitations.map((row) => row.calendar_event_id).filter(Boolean))
  const schedule = buildFanScheduleEvents({ events: shared, invitedIds, occurrences, exclusions, parent: scope.parent })
  const assessmentIds = [...new Set(invitations.map((row) => row.assessment_session_id).filter(Boolean))]
  if (assessmentIds.length) {
    const sessions = await rows(client.from('assessment_sessions').select('id,title,session_date,start_time,end_time,location,status').in('id', assessmentIds).eq('club_id', scope.fan.club_id).neq('status', 'cancelled'))
    schedule.push(...sessions.map((session) => ({ id: session.id, title: session.title || 'Assessment', date: session.session_date, time: session.start_time, end_time: session.end_time, location: session.location })))
  }
  schedule.push(...matches.map((match) => ({ id: match.id, title: `Fixture: ${match.opponent}`, date: match.match_date, time: match.kickoff_time_tbc ? '' : match.kickoff_time, location: match.venue_name })))
  return schedule.sort((a, b) => String(a.starts_at || a.date).localeCompare(String(b.starts_at || b.date)))
}

export function buildFanScheduleEvents({ events, invitedIds, occurrences, exclusions, parent, now = new Date() }) {
  const today = getParentProductDateTimeParts(now).date
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
        if (date < today || excluded(event.id, date)) continue
        const id = `${event.id}:${date}`
        result.set(id, { id, title: event.title, date, time: start.time, end_time: end.time, location: event.location })
      }
    }
    for (const occurrence of occurrences.filter((o) => o.calendar_event_id === event.id)) {
      const date = occurrence.occurrence_date
      if (date < today || date > horizon || excluded(event.id, date)) continue
      const id = `${event.id}:${date}`
      result.set(id, { id, title: event.title, starts_at: occurrence.occurrence_starts_at, ends_at: occurrence.occurrence_ends_at, location: event.location })
    }
  }
  return [...result.values()]
}
