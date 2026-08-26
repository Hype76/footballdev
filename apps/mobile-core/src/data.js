import { getMobileRuntimeConfig } from './config'
import { fetchJsonWithTimeout, joinApiPath } from './http'
import { getParentPortalLinks, getSelectedParentLink } from './parentLinks'
import { getAccessToken, supabase } from './supabase'
import { normalizeMatchDayShirtChoice } from '../../../src/lib/matchday-model.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeCount(value) {
  return Number(value || 0)
}

async function sendCoachMobilePushNotificationSafely({ matchDayId, type }) {
  try {
    const config = getMobileRuntimeConfig('parent')
    const accessToken = await getAccessToken()

    if (!config.apiBaseUrl || !accessToken || !matchDayId) {
      return { skipped: true }
    }

    const { ok, result } = await fetchJsonWithTimeout(joinApiPath(config.apiBaseUrl, '.netlify/functions/send-coach-mobile-push'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        matchDayId,
        type,
      }),
    })

    if (!ok || result.success === false) {
      throw new Error(result.message || 'Coach notification could not be sent.')
    }

    return result
  } catch (error) {
    console.warn(error)
    return {
      error: error.message || 'Coach notification could not be sent.',
      skipped: false,
    }
  }
}

function getRelatedRow(row, key) {
  const value = row?.[key]
  return Array.isArray(value) ? value[0] : value
}

function normalizeMatchDayEvent(row) {
  return {
    assistInitials: normalizeText(row.assist_initials ?? row.assistInitials),
    assistName: normalizeText(row.assist_name ?? row.assistName),
    assistShirtNumber: normalizeText(row.assist_shirt_number ?? row.assistShirtNumber),
    createdAt: row.created_at ?? row.createdAt ?? '',
    eventType: normalizeText(row.event_type ?? row.eventType) || 'goal',
    homeScore: Number(row.home_score ?? row.homeScore ?? 0),
    id: row.id ?? '',
    minute: row.minute ?? null,
    scorerInitials: normalizeText(row.scorer_initials ?? row.scorerInitials),
    scorerName: normalizeText(row.scorer_name ?? row.scorerName),
    scorerShirtNumber: normalizeText(row.scorer_shirt_number ?? row.scorerShirtNumber),
    teamSide: normalizeText(row.team_side ?? row.teamSide) || 'club',
    awayScore: Number(row.away_score ?? row.awayScore ?? 0),
  }
}

export function normalizeMatchDay(row) {
  const team = getRelatedRow(row, 'teams')
  const rawEvents = Array.isArray(row.match_day_events) ? row.match_day_events : row.events
  const events = Array.isArray(rawEvents)
    ? rawEvents
      .map(normalizeMatchDayEvent)
      .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())
    : []

  return {
    arrivalTime: row.arrival_time ?? row.arrivalTime ?? '',
    awayScore: Number(row.away_score ?? row.awayScore ?? 0),
    availabilityRespondedAt: row.availability_responded_at ?? row.availabilityRespondedAt ?? '',
    availabilityStatus: normalizeText(row.availability_status ?? row.availabilityStatus),
    createdAt: row.created_at ?? row.createdAt ?? '',
    events,
    fixtureType: normalizeText(row.fixture_type ?? row.fixtureType) || 'match',
    hasInterest: Boolean(row.has_interest ?? row.hasInterest),
    homeAway: normalizeText(row.home_away ?? row.homeAway) || 'home',
    shirtChoice: normalizeMatchDayShirtChoice(row.shirt_choice ?? row.shirtChoice),
    homeScore: Number(row.home_score ?? row.homeScore ?? 0),
    id: row.id ?? '',
    isScorer: Boolean(row.is_scorer ?? row.isScorer),
    kickoffTime: row.kickoff_time ?? row.kickoffTime ?? '',
    kickoffTimeTbc: row.kickoff_time_tbc === true || row.kickoffTimeTbc === true,
    matchDate: row.match_date ?? row.matchDate ?? '',
    notes: normalizeText(row.notes),
    opponent: normalizeText(row.opponent || 'Opponent'),
    phaseStartedAt: row.phase_started_at ?? row.phaseStartedAt ?? '',
    requestLinesman: row.request_linesman === true || row.requestLinesman === true,
    requestReferee: row.request_referee === true || row.requestReferee === true,
    requestScorer: row.request_scorer === true || row.requestScorer === true,
    scorerRequestMessage: normalizeText(row.scorer_request_message ?? row.scorerRequestMessage),
    squadDecisionState: normalizeText(row.squad_decision_state ?? row.squadDecisionState) || 'undecided',
    status: normalizeText(row.status) || 'scheduled',
    teamId: row.team_id ?? row.teamId ?? '',
    teamName: normalizeText(team?.name ?? row.team_name ?? row.teamName) || 'Our team',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
    venueAddress: normalizeText(row.venue_address ?? row.venueAddress),
    venueName: normalizeText(row.venue_name ?? row.venueName),
    volunteerLinesmanResponse: normalizeText(row.volunteer_linesman_response ?? row.volunteerLinesmanResponse) || 'no_response',
    volunteerRefereeResponse: normalizeText(row.volunteer_referee_response ?? row.volunteerRefereeResponse) || 'no_response',
    volunteerRespondedAt: row.volunteer_responded_at ?? row.volunteerRespondedAt ?? '',
    volunteerScorerResponse: normalizeText(row.volunteer_scorer_response ?? row.volunteerScorerResponse) || 'no_response',
  }
}

export function getClubScore(match) {
  return match?.homeAway === 'away' ? match.awayScore : match.homeScore
}

export function getOpponentScore(match) {
  return match?.homeAway === 'away' ? match.homeScore : match.awayScore
}

export function formatMatchLabel(match) {
  const date = normalizeText(match?.matchDate)
  const time = normalizeText(match?.kickoffTime)

  if (!date && !time) {
    return 'Date not set'
  }

  return [date, time].filter(Boolean).join(' at ')
}

function normalizePlayer(row) {
  return {
    id: row.id || '',
    parentEmail: normalizeText(row.parent_email),
    playerName: normalizeText(row.player_name || 'Unnamed player'),
    positions: Array.isArray(row.positions) ? row.positions.map(normalizeText).filter(Boolean) : [],
    section: normalizeText(row.section || 'Trial'),
    shirtNumber: normalizeText(row.shirt_number),
    status: normalizeText(row.status || 'active'),
    team: normalizeText(row.team),
    teamId: row.team_id || '',
  }
}

function normalizeSession(row) {
  return {
    completedAt: row.completed_at || '',
    id: row.id || '',
    opponent: normalizeText(row.opponent),
    sessionDate: row.session_date || '',
    sessionType: normalizeText(row.session_type || 'training'),
    startTime: normalizeText(row.start_time).slice(0, 5),
    status: normalizeText(row.status || 'open'),
    team: normalizeText(row.team),
    teamId: row.team_id || '',
    title: normalizeText(row.title || row.team || 'Session'),
  }
}

function normalizeMessage(row) {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {}

  return {
    body: normalizeText(metadata.body),
    createdAt: row.created_at || '',
    evaluationId: normalizeText(
      row.evaluation_id
      || metadata.evaluationId
      || metadata.evaluation_id
      || metadata.reportId
      || metadata.report_id,
    ),
    id: row.id || '',
    readAt: row.read_at || '',
    senderEmail: normalizeText(row.sender_email),
    senderName: normalizeText(row.sender_name),
    subject: normalizeText(metadata.subject || 'Club message'),
    templateName: normalizeText(metadata.templateName),
  }
}

function normalizePollOption(option, index) {
  const label = normalizeText(option?.label ?? option)
  const id = normalizeText(option?.id) || `option-${index + 1}`

  return label ? {
    id,
    label,
    playerId: normalizeText(option?.player_id ?? option?.playerId),
  } : null
}

function normalizePoll(row) {
  const closesAt = row.closes_at || row.closesAt || ''

  return {
    allowMultiple: row.allow_multiple === true || row.allowMultiple === true,
    allowOwnChildVotes: row.allow_own_child_votes !== false && row.allowOwnChildVotes !== false,
    allowVoteChanges: row.allow_vote_changes !== false && row.allowVoteChanges !== false,
    closesAt,
    createdAt: row.created_at || row.createdAt || '',
    currentOptionId: normalizeText(row.current_option_id || row.currentOptionId),
    currentOptionIds: Array.isArray(row.current_option_ids)
      ? row.current_option_ids.map(normalizeText).filter(Boolean)
      : Array.isArray(row.currentOptionIds)
        ? row.currentOptionIds.map(normalizeText).filter(Boolean)
        : normalizeText(row.current_option_id || row.currentOptionId)
          ? [normalizeText(row.current_option_id || row.currentOptionId)]
          : [],
    description: normalizeText(row.description),
    id: row.id || '',
    isExpired: Boolean(closesAt && new Date(closesAt).getTime() <= Date.now()),
    maxChoices: row.max_choices ?? row.maxChoices ?? null,
    options: (Array.isArray(row.options) ? row.options : []).map(normalizePollOption).filter(Boolean),
    pollType: normalizeText(row.poll_type || 'text'),
    status: normalizeText(row.status || 'open'),
    title: normalizeText(row.title || 'Poll'),
    votes: (Array.isArray(row.votes) ? row.votes : []).map((vote) => ({
      count: Math.max(0, Number(vote?.count ?? 0) || 0),
      optionId: normalizeText(vote?.optionId ?? vote?.option_id),
    })).filter((vote) => vote.optionId),
  }
}

function normalizeCalendarEvent(row) {
  return {
    cancelledAt: row.cancelled_at ?? row.cancelledAt ?? '',
    endsAt: row.ends_at ?? row.endsAt ?? '',
    eventType: normalizeText(row.event_type ?? row.eventType) || 'general',
    id: row.id ?? '',
    location: normalizeText(row.location),
    notes: normalizeText(row.notes),
    parentAudience: normalizeText(row.parent_audience ?? row.parentAudience),
    startsAt: row.starts_at ?? row.startsAt ?? '',
    status: row.cancelled_at || row.cancelledAt ? 'cancelled' : 'scheduled',
    teamId: row.team_id ?? row.teamId ?? '',
    title: normalizeText(row.title) || 'Calendar event',
  }
}

async function getTableCount(table, queryBuilder) {
  let query = supabase.from(table).select('id', { count: 'exact', head: true })

  if (queryBuilder) {
    query = queryBuilder(query)
  }

  const { count, error } = await query

  if (error) {
    throw error
  }

  return normalizeCount(count)
}

export async function getCoachHomeSummary(user) {
  if (!user?.clubId) {
    return {
      activePlayers: 0,
      matches: 0,
      sessions: 0,
      teams: 0,
    }
  }

  const scopeToActiveTeam = (query) => user.activeTeamId ? query.eq('team_id', user.activeTeamId) : query
  const [activePlayers, sessions, teams, matches] = await Promise.all([
    getTableCount('players', (query) => scopeToActiveTeam(query.eq('club_id', user.clubId).neq('status', 'archived'))),
    getTableCount('assessment_sessions', (query) => scopeToActiveTeam(query.eq('club_id', user.clubId))),
    user.activeTeamId ? Promise.resolve(1) : getTableCount('teams', (query) => query.eq('club_id', user.clubId)),
    getTableCount('match_days', (query) => scopeToActiveTeam(query.eq('club_id', user.clubId))),
  ])

  return {
    activePlayers,
    matches,
    sessions,
    teams,
  }
}

function getMatchSelect() {
  return `
    *,
    teams:team_id (name),
    match_day_events (*)
  `
}

export async function getCoachMatchDays(user) {
  if (!user?.clubId) {
    return []
  }

  let query = supabase
    .from('match_days')
    .select(getMatchSelect())
    .eq('club_id', user.clubId)
    .order('match_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(20)

  if (user.activeTeamId) {
    query = query.or(`team_id.is.null,team_id.eq.${user.activeTeamId}`)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return (data || []).map(normalizeMatchDay)
}

export async function getCoachPlayers(user) {
  if (!user?.clubId) {
    return []
  }

  let query = supabase
    .from('players')
    .select('id, player_name, shirt_number, section, status, team, team_id, positions, parent_email')
    .eq('club_id', user.clubId)
    .neq('status', 'archived')
    .order('section', { ascending: true })
    .order('player_name', { ascending: true })
    .limit(80)

  if (user.activeTeamId) {
    query = query.eq('team_id', user.activeTeamId)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return (data || []).map(normalizePlayer)
}

export async function getCoachSessions(user) {
  if (!user?.clubId) {
    return []
  }

  let query = supabase
    .from('assessment_sessions')
    .select('id, team_id, team, title, opponent, session_type, session_date, start_time, status, completed_at')
    .eq('club_id', user.clubId)
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(30)

  if (user.activeTeamId) {
    query = query.eq('team_id', user.activeTeamId)
  }

  const { data, error } = await query

  if (error) {
    throw error
  }

  return (data || []).map(normalizeSession)
}

export async function getParentMatchDays(user) {
  const selectedLink = getSelectedParentLink(user)

  if (!selectedLink?.id) {
    return []
  }

  const [matchResult, shirtResult] = await Promise.all([
    supabase.rpc('get_parent_portal_match_days', { parent_link_id_value: selectedLink.id }),
    supabase.rpc('get_parent_portal_match_shirt_choices', { parent_link_id_value: selectedLink.id }),
  ])

  if (matchResult.error) throw matchResult.error
  if (shirtResult.error) throw shirtResult.error

  const shirtsByMatchId = new Map((shirtResult.data || []).map((row) => [String(row.match_day_id ?? row.matchDayId), row.shirt_choice ?? row.shirtChoice]))
  return (matchResult.data || []).map((row) => normalizeMatchDay({
    ...row,
    shirt_choice: shirtsByMatchId.get(String(row.id)),
  }))
}

export async function getParentCalendarEvents(user) {
  const selectedLink = getSelectedParentLink(user)

  if (!selectedLink?.id) {
    return []
  }

  const { data, error } = await supabase.rpc('get_parent_portal_shared_calendar_events', {
    parent_link_id_value: selectedLink.id,
  })

  if (error) {
    throw error
  }

  return (data || []).map(normalizeCalendarEvent)
}

export async function getParentMessages(user) {
  const selectedLink = getSelectedParentLink(user)

  if (!selectedLink?.id) {
    return []
  }

  const { data, error } = await supabase.rpc('get_parent_portal_email_messages', {
    parent_link_id_value: selectedLink.id,
  })

  if (error) {
    throw error
  }

  return (data || []).map(normalizeMessage)
}

export async function getParentPolls(user) {
  const selectedLink = getSelectedParentLink(user)

  if (!selectedLink?.id) {
    return []
  }

  const { data, error } = await supabase.rpc('get_parent_portal_polls', {
    parent_link_id_value: selectedLink.id,
  })

  if (error) {
    throw error
  }

  return (data || []).map(normalizePoll)
}

export async function markParentMessageRead(user, messageId) {
  const selectedLink = getSelectedParentLink(user)
  const normalizedMessageId = normalizeText(messageId)

  if (!selectedLink?.id || !normalizedMessageId) {
    throw new Error('Choose a message before marking it as read.')
  }

  const { data, error } = await supabase.rpc('mark_parent_portal_message_read', {
    communication_log_id_value: normalizedMessageId,
    parent_link_id_value: selectedLink.id,
  })

  if (error) {
    throw error
  }

  return data || new Date().toISOString()
}

export async function submitParentPollVote(user, pollId, optionId) {
  const selectedLink = getSelectedParentLink(user)
  const normalizedPollId = normalizeText(pollId)
  const normalizedOptionId = normalizeText(optionId)

  if (!selectedLink?.id || !normalizedPollId || !normalizedOptionId) {
    throw new Error('Choose a poll answer before voting.')
  }

  const { data, error } = await supabase.rpc('submit_parent_portal_poll_vote', {
    option_id_value: normalizedOptionId,
    parent_link_id_value: selectedLink.id,
    poll_id_value: normalizedPollId,
  })

  if (error) {
    throw error
  }

  return data
}

export async function volunteerAsMatchScorer(user, matchId) {
  const selectedLink = getSelectedParentLink(user)
  const normalizedMatchId = normalizeText(matchId)

  if (!selectedLink?.id || !normalizedMatchId) {
    throw new Error('Choose a match before volunteering.')
  }

  const { data, error } = await supabase.rpc('express_match_day_scorer_interest', {
    match_day_id_value: normalizedMatchId,
    message_value: '',
    parent_link_id_value: selectedLink.id,
  })

  if (error) {
    throw error
  }

  await sendCoachMobilePushNotificationSafely({
    matchDayId: normalizedMatchId,
    type: 'scorer_volunteer',
  })

  return data
}

export async function getParentHomeSummary(user) {
  const links = getParentPortalLinks(user)
  const selectedLink = getSelectedParentLink(user)

  if (!selectedLink?.id) {
    return {
      linkedChildren: links.length,
      messages: 0,
      polls: 0,
      upcomingMatches: 0,
    }
  }

  const [matches, messages, polls] = await Promise.all([
    getParentMatchDays(user),
    getParentMessages(user),
    getParentPolls(user),
  ])

  return {
    linkedChildren: links.length,
    messages: messages.length,
    polls: polls.length,
    upcomingMatches: matches.filter((match) => match.status !== 'full_time').length,
  }
}
