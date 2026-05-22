import { getMobileRuntimeConfig } from './config'
import { isAssessmentScoreField } from './assessment'
import { fetchJsonWithTimeout, joinApiPath } from './http'
import { getParentPortalLinks, getSelectedParentLink } from './parentLinks'
import { getAccessToken, supabase } from './supabase'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeCount(value) {
  return Number(value || 0)
}

async function sendMatchDayPushNotification({ eventId = '', matchDayId, type }) {
  const config = getMobileRuntimeConfig('coach')
  const accessToken = await getAccessToken()

  if (!config.apiBaseUrl || !accessToken || !matchDayId) {
    return { skipped: true }
  }

  const { ok, result } = await fetchJsonWithTimeout(joinApiPath(config.apiBaseUrl, '.netlify/functions/send-match-day-push'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      eventId,
      matchDayId,
      type,
    }),
  })

  if (!ok || result.success === false) {
    throw new Error(result.message || 'Matchday notification could not be sent.')
  }

  return result
}

async function sendMatchDayPushNotificationSafely(details) {
  try {
    return await sendMatchDayPushNotification(details)
  } catch (error) {
    console.warn(error)
    return {
      error: error.message || 'Matchday notification could not be sent.',
      skipped: false,
    }
  }
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
    awayScore: Number(row.away_score ?? row.awayScore ?? 0),
    createdAt: row.created_at ?? row.createdAt ?? '',
    events,
    hasInterest: Boolean(row.has_interest ?? row.hasInterest),
    homeAway: normalizeText(row.home_away ?? row.homeAway) || 'home',
    homeScore: Number(row.home_score ?? row.homeScore ?? 0),
    id: row.id ?? '',
    isScorer: Boolean(row.is_scorer ?? row.isScorer),
    kickoffTime: row.kickoff_time ?? row.kickoffTime ?? '',
    matchDate: row.match_date ?? row.matchDate ?? '',
    opponent: normalizeText(row.opponent || 'Opponent'),
    phaseStartedAt: row.phase_started_at ?? row.phaseStartedAt ?? '',
    scorerRequestMessage: normalizeText(row.scorer_request_message ?? row.scorerRequestMessage),
    status: normalizeText(row.status) || 'scheduled',
    teamId: row.team_id ?? row.teamId ?? '',
    teamName: normalizeText(team?.name ?? row.team_name ?? row.teamName) || 'Our team',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
    venueAddress: normalizeText(row.venue_address ?? row.venueAddress),
    venueName: normalizeText(row.venue_name ?? row.venueName),
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
    status: normalizeText(row.status || 'open'),
    team: normalizeText(row.team),
    teamId: row.team_id || '',
    title: normalizeText(row.title || row.team || 'Session'),
  }
}

function normalizeFormField(row) {
  return {
    id: row.id || '',
    isEnabled: row.is_enabled !== false,
    label: normalizeText(row.label || 'Field'),
    options: Array.isArray(row.options) ? row.options.map(normalizeText).filter(Boolean) : [],
    orderIndex: Number(row.order_index || 0),
    required: Boolean(row.required),
    type: normalizeText(row.type || 'text'),
  }
}

function normalizeMessage(row) {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {}

  return {
    body: normalizeText(metadata.body),
    createdAt: row.created_at || '',
    id: row.id || '',
    readAt: row.read_at || '',
    senderName: normalizeText(row.sender_name),
    subject: normalizeText(metadata.subject || 'Club message'),
    templateName: normalizeText(metadata.templateName),
  }
}

function normalizePollOption(option, index) {
  const label = normalizeText(option?.label ?? option)
  const id = normalizeText(option?.id) || `option-${index + 1}`

  return label ? { id, label } : null
}

function normalizePoll(row) {
  return {
    closesAt: row.closes_at || '',
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
    options: (Array.isArray(row.options) ? row.options : []).map(normalizePollOption).filter(Boolean),
    pollType: normalizeText(row.poll_type || 'text'),
    status: normalizeText(row.status || 'open'),
    title: normalizeText(row.title || 'Poll'),
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
    .select('id, team_id, team, title, opponent, session_type, session_date, status, completed_at')
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

export async function getCoachAssessmentFields(user) {
  if (!user?.clubId) {
    return []
  }

  const { data, error } = await supabase
    .from('form_fields')
    .select('id, label, type, options, required, is_enabled, order_index')
    .eq('club_id', user.clubId)
    .eq('is_enabled', true)
    .order('order_index', { ascending: true })
    .order('label', { ascending: true })

  if (error) {
    throw error
  }

  const fields = (data || []).map(normalizeFormField)

  if (fields.length > 0) {
    return fields
  }

  return [
    { id: 'technical', label: 'Technical', type: 'score_1_5', options: [], required: true, orderIndex: 1 },
    { id: 'tactical', label: 'Tactical', type: 'score_1_5', options: [], required: true, orderIndex: 2 },
    { id: 'attitude', label: 'Attitude', type: 'score_1_5', options: [], required: true, orderIndex: 3 },
    { id: 'overall-comments', label: 'Overall Comments', type: 'textarea', options: [], required: false, orderIndex: 4 },
  ]
}

function getCurrentMatchMinute(match) {
  if (['scheduled', 'scorer_request', 'full_time', 'postponed', 'cancelled'].includes(match?.status)) {
    return null
  }

  const startedAt = new Date(match.phaseStartedAt || match.updatedAt || Date.now())
  const startedAtTime = Number.isNaN(startedAt.getTime()) ? Date.now() : startedAt.getTime()

  return Math.max(Math.floor((Date.now() - startedAtTime) / 60000) + 1, 1)
}

function getInitialsFromName(value) {
  return normalizeText(value)
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 3)
    .join('')
    .toUpperCase()
}

function normalizeGoalMinute(value) {
  const normalizedValue = normalizeText(value)

  if (!normalizedValue) {
    return null
  }

  const numericValue = Number(normalizedValue)

  if (!Number.isFinite(numericValue)) {
    throw new Error('Goal minute must be a number.')
  }

  return Math.max(Math.min(Math.round(numericValue), 130), 0)
}

function canApplyMobileMatchStatusTransition(currentStatus, nextStatus) {
  const normalizedCurrentStatus = normalizeText(currentStatus) || 'scheduled'
  const allowedPreviousStatuses = {
    full_time: ['live', 'half_time', 'second_half', 'extra_time', 'penalties'],
    half_time: ['live', 'second_half'],
    live: ['scheduled', 'scorer_request', 'live'],
    second_half: ['half_time', 'live'],
  }
  const allowedStatuses = allowedPreviousStatuses[nextStatus]

  return !allowedStatuses || allowedStatuses.includes(normalizedCurrentStatus)
}

export async function updateCoachMatchStatus(user, match, status) {
  if (!user?.clubId || !match?.id) {
    throw new Error('Choose a match before updating it.')
  }

  const normalizedStatus = normalizeText(status)
  const allowedStatuses = ['scheduled', 'scorer_request', 'live', 'half_time', 'second_half', 'extra_time', 'penalties', 'full_time', 'postponed', 'cancelled']

  if (!allowedStatuses.includes(normalizedStatus)) {
    throw new Error('Choose a valid match status.')
  }

  if (!canApplyMobileMatchStatusTransition(match.status, normalizedStatus)) {
    throw new Error('This match cannot move to that status yet.')
  }

  const phaseStatuses = ['live', 'second_half', 'extra_time', 'penalties']
  const payload = {
    status: normalizedStatus,
    updated_at: new Date().toISOString(),
  }

  if (phaseStatuses.includes(normalizedStatus)) {
    payload.phase_started_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('match_days')
    .update(payload)
    .eq('id', match.id)
    .eq('club_id', user.clubId)
    .select(getMatchSelect())
    .single()

  if (error) {
    throw error
  }

  if (['half_time', 'second_half', 'extra_time', 'penalties', 'full_time'].includes(normalizedStatus)) {
    await sendMatchDayPushNotificationSafely({
      matchDayId: match.id,
      type: normalizedStatus,
    })
  }

  return normalizeMatchDay(data)
}

export async function addCoachMatchGoal(user, match, teamSide = 'club', goalDetails = {}) {
  if (!user?.clubId || !match?.id) {
    throw new Error('Choose a match before adding a goal.')
  }

  if (['full_time', 'postponed', 'cancelled'].includes(match.status)) {
    throw new Error('This match is no longer open for goals.')
  }

  const normalizedTeamSide = normalizeText(teamSide) === 'opponent' ? 'opponent' : 'club'
  const normalizedMinute = normalizeGoalMinute(goalDetails.minute)
  let nextHomeScore = Number(match.homeScore || 0)
  let nextAwayScore = Number(match.awayScore || 0)

  if (normalizedTeamSide === 'club') {
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

  const nextStatus = ['scheduled', 'scorer_request'].includes(match.status) ? 'live' : match.status
  const { error: updateError } = await supabase
    .from('match_days')
    .update({
      away_score: nextAwayScore,
      home_score: nextHomeScore,
      phase_started_at: nextStatus === 'live' && !match.phaseStartedAt ? new Date().toISOString() : match.phaseStartedAt || null,
      status: nextStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', match.id)
    .eq('club_id', user.clubId)

  if (updateError) {
    throw updateError
  }

  const { data, error } = await supabase
    .from('match_day_events')
    .insert({
      away_score: nextAwayScore,
      club_id: user.clubId,
      event_type: 'goal',
      home_score: nextHomeScore,
      match_day_id: match.id,
      assist_initials: getInitialsFromName(goalDetails.assistName),
      assist_name: normalizeText(goalDetails.assistName),
      assist_shirt_number: normalizeText(goalDetails.assistShirtNumber),
      minute: normalizedMinute ?? getCurrentMatchMinute(match),
      notes: normalizeText(goalDetails.notes),
      scorer_initials: getInitialsFromName(goalDetails.scorerName),
      scorer_name: normalizeText(goalDetails.scorerName),
      scorer_shirt_number: normalizeText(goalDetails.scorerShirtNumber),
      team_id: match.teamId || null,
      team_side: normalizedTeamSide,
      created_by: user.id,
      created_by_name: user.displayName || user.name || user.email,
    })
    .select('*')
    .single()

  if (error) {
    throw error
  }

  await sendMatchDayPushNotificationSafely({
    eventId: data.id,
    matchDayId: match.id,
    type: 'goal',
  })

  return normalizeMatchDayEvent(data)
}

export async function undoCoachLastMatchGoal(user, match) {
  if (!user?.clubId || !match?.id) {
    throw new Error('Choose a match before correcting the score.')
  }

  if (['postponed', 'cancelled'].includes(match.status)) {
    throw new Error('This match is no longer open for score corrections.')
  }

  const latestEvent = Array.isArray(match.events) ? match.events[0] : null

  if (!latestEvent || latestEvent.eventType !== 'goal') {
    throw new Error('Only the latest goal can be undone.')
  }

  let nextHomeScore = Number(match.homeScore || 0)
  let nextAwayScore = Number(match.awayScore || 0)
  const teamSide = normalizeText(latestEvent.teamSide) === 'opponent' ? 'opponent' : 'club'

  if (teamSide === 'club') {
    if (match.homeAway === 'away') {
      nextAwayScore = Math.max(nextAwayScore - 1, 0)
    } else {
      nextHomeScore = Math.max(nextHomeScore - 1, 0)
    }
  } else if (match.homeAway === 'away') {
    nextHomeScore = Math.max(nextHomeScore - 1, 0)
  } else {
    nextAwayScore = Math.max(nextAwayScore - 1, 0)
  }

  const { error: updateError } = await supabase
    .from('match_days')
    .update({
      away_score: nextAwayScore,
      home_score: nextHomeScore,
      updated_at: new Date().toISOString(),
    })
    .eq('id', match.id)
    .eq('club_id', user.clubId)

  if (updateError) {
    throw updateError
  }

  const { data, error } = await supabase
    .from('match_day_events')
    .insert({
      away_score: nextAwayScore,
      club_id: user.clubId,
      event_type: 'score_correction',
      home_score: nextHomeScore,
      match_day_id: match.id,
      notes: `Undid goal event ${latestEvent.id}`,
      team_id: match.teamId || null,
      team_side: teamSide,
      created_by: user.id,
      created_by_name: user.displayName || user.name || user.email,
    })
    .select('*')
    .single()

  if (error) {
    throw error
  }

  await sendMatchDayPushNotificationSafely({
    eventId: data.id,
    matchDayId: match.id,
    type: 'score_correction',
  })

  return normalizeMatchDayEvent(data)
}

export async function submitCoachAssessment(user, player, assessment, fields = []) {
  if (!user?.clubId || !player?.id) {
    throw new Error('Choose a player before saving an assessment.')
  }

  const configuredFields = Array.isArray(fields) && fields.length > 0 ? fields : await getCoachAssessmentFields(user)
  const fieldValues = assessment.fieldValues && typeof assessment.fieldValues === 'object' ? assessment.fieldValues : {}
  const formResponses = {}
  const scores = {}

  configuredFields.forEach((field) => {
    const value = fieldValues[field.id] ?? ''

    if (isAssessmentScoreField(field.type)) {
      const numericValue = Number(value)
      const maxScore = field.type === 'score_1_10' ? 10 : 5

      if (!Number.isFinite(numericValue)) {
        throw new Error(`${field.label} must be a number.`)
      }

      if (field.required && numericValue <= 0) {
        throw new Error(`${field.label} is required.`)
      }

      const boundedValue = Math.max(Math.min(Math.round(numericValue), maxScore), 0)
      formResponses[field.label] = boundedValue
      if (boundedValue > 0) {
        scores[field.label] = boundedValue
      }
      return
    }

    const textValue = normalizeText(value)

    if (field.required && !textValue) {
      throw new Error(`${field.label} is required.`)
    }

    formResponses[field.label] = textValue
  })

  const scoreValues = Object.values(scores)
  const averageScore = scoreValues.length > 0
    ? Number((scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length).toFixed(1))
    : null
  const notes = normalizeText(
    assessment.notes ||
      formResponses['Overall Comments'] ||
      formResponses.Comments ||
      formResponses.Summary,
  )

  const { data, error } = await supabase
    .from('evaluations')
    .insert({
      average_score: averageScore,
      club_id: user.clubId,
      coach: user.displayName || user.name || user.email,
      coach_id: user.id,
      comments: {
        improvements: '',
        overall: notes,
        selectedStrengths: [],
        strengths: '',
      },
      contact_type: 'parent',
      created_by_email: user.email,
      created_by_name: user.displayName || user.name || user.email,
      date: new Date().toISOString().slice(0, 10),
      form_responses: formResponses,
      parent_email: player.parentEmail || null,
      player_id: player.id,
      player_name: player.playerName,
      scores,
      section: player.section || 'Trial',
      session: 'Mobile assessment',
      status: 'Submitted',
      team: player.team || '',
      team_id: player.teamId || null,
      updated_by: user.id,
      updated_by_email: user.email,
      updated_by_name: user.displayName || user.name || user.email,
    })
    .select('id, player_name, average_score, status, date')
    .single()

  if (error) {
    throw error
  }

  return data
}

export async function getParentMatchDays(user) {
  const selectedLink = getSelectedParentLink(user)

  if (!selectedLink?.id) {
    return []
  }

  const { data, error } = await supabase.rpc('get_parent_portal_match_days', {
    parent_link_id_value: selectedLink.id,
  })

  if (error) {
    throw error
  }

  return (data || []).map(normalizeMatchDay)
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

  const { data: poll, error: pollError } = await supabase
    .from('polls')
    .select('id, status')
    .eq('id', normalizedPollId)
    .eq('club_id', selectedLink.clubId)
    .maybeSingle()

  if (pollError) {
    throw pollError
  }

  if (!poll || poll.status !== 'open') {
    throw new Error('This poll is closed.')
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

  const getMessageCount = async () => {
    try {
      const { data, error } = await supabase.rpc('get_parent_portal_email_messages', {
        parent_link_id_value: selectedLink.id,
      })

      if (error) {
        return 0
      }

      return Array.isArray(data) ? data.length : 0
    } catch {
      return 0
    }
  }

  const [matchResult, messageResult, pollCount] = await Promise.all([
    supabase.rpc('get_parent_portal_match_days', {
      parent_link_id_value: selectedLink.id,
    }),
    getMessageCount(),
    getTableCount('polls', (query) => query.eq('club_id', selectedLink.clubId)).catch(() => 0),
  ])

  if (matchResult.error) {
    throw matchResult.error
  }

  const matches = Array.isArray(matchResult.data) ? matchResult.data : []

  return {
    linkedChildren: links.length,
    messages: messageResult,
    polls: pollCount,
    upcomingMatches: matches.filter((match) => match.status !== 'full_time').length,
  }
}
