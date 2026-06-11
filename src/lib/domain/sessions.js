import { supabase } from '../supabase-client.js'
import {
  getCachedResource,
  invalidateMemoryCacheByPrefix,
} from './cache-store.js'
import { createAuditLog } from './audit.js'
import {
  normalizeParentContacts,
} from './contact-utils.js'
import {
  getEntryIdentity,
  getEntryUserEmail,
  getEntryUserId,
  getEntryUserName,
  normalizeDateOnly,
} from './core-normalizers.js'
import {
  normalizeAssessmentSessionPlayerRow,
  normalizeAssessmentSessionRow,
} from './session-normalizers.js'
import {
  getSessionTeamsForUser,
} from './team-actions.js'
import {
  blockDemoMutation,
} from './demo-guards.js'

export async function getAssessmentSessions({ user } = {}) {
  if (!user?.clubId || user.role === 'super_admin') {
    return []
  }

  const activeTeamId = String(user.activeTeamId ?? '').trim()
  const cacheKey = `assessment-sessions:${user.clubId}:${user.id}:${user.roleRank}:${activeTeamId || 'assigned'}`

  return getCachedResource(cacheKey, async () => {
    const teams = await getSessionTeamsForUser(user)
    const teamIds = teams.map((team) => String(team.id ?? '').trim()).filter(Boolean)
    const teamNames = teams.map((team) => String(team.name ?? '').trim().toLowerCase()).filter(Boolean)

    if (teamIds.length === 0 && teamNames.length === 0) {
      return []
    }

    const { data, error } = await supabase
      .from('assessment_sessions')
      .select('*')
      .eq('club_id', user.clubId)
      .order('session_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      console.error(error)
      throw error
    }

    const normalizedSessions = (data ?? []).map(normalizeAssessmentSessionRow)

    if (teamNames.length === 0) {
      return normalizedSessions
    }

    return normalizedSessions.filter((session) => {
      const sessionTeamId = String(session.teamId ?? '').trim()
      const sessionTeamName = String(session.team ?? '').trim().toLowerCase()
      return teamIds.includes(sessionTeamId) || teamNames.includes(sessionTeamName)
    })
  })
}

async function assertSessionTeamAccess({ user, teamId }) {
  if (user?.role === 'admin') {
    return
  }

  const normalizedTeamId = String(teamId ?? '').trim()

  if (!normalizedTeamId) {
    throw new Error('Choose your assigned team before saving this session.')
  }

  const teams = await getSessionTeamsForUser(user)
  const allowedTeamIds = teams.map((team) => String(team.id ?? '').trim()).filter(Boolean)

  if (!allowedTeamIds.includes(normalizedTeamId)) {
    throw new Error('Team staff can only save sessions against their assigned team.')
  }
}

function isValidSessionTime(value) {
  return /^\d{2}:\d{2}$/.test(String(value ?? '').trim())
}

function isSessionTimeAfter(leftTime, rightTime) {
  const leftValue = String(leftTime ?? '').trim()
  const rightValue = String(rightTime ?? '').trim()

  return isValidSessionTime(leftValue) && isValidSessionTime(rightValue) && leftValue > rightValue
}

export async function createAssessmentSession({ user, session }) {
  await blockDemoMutation(user)

  if (!user?.clubId || user.role === 'super_admin') {
    throw new Error('A club user is required to create sessions.')
  }

  const sessionDate = normalizeDateOnly(session.sessionDate)

  if (!sessionDate) {
    throw new Error('Session date is required.')
  }

  const teamName = String(session.team ?? '').trim()
  const teamId = String(session.teamId ?? '').trim()
  const opponentName = String(session.opponent ?? '').trim()
  const requestedSessionType = String(session.sessionType ?? '').trim()
  const sessionType = ['training', 'match'].includes(requestedSessionType) ? requestedSessionType : 'training'
  const sessionOpponentName = sessionType === 'match' ? opponentName : ''
  const arrivalTime = String(session.arrivalTime ?? '').trim()
  const startTime = String(session.startTime ?? '').trim()
  const endTime = String(session.endTime ?? '').trim()
  const requestedTitle = String(session.title ?? '').trim()

  if (!isValidSessionTime(startTime)) {
    throw new Error(sessionType === 'match' ? 'Kick-off time is required for a fixture.' : 'Choose a start time.')
  }

  if (sessionType === 'match' && !sessionOpponentName && !requestedTitle) {
    throw new Error('Add an opponent or event title for this fixture.')
  }

  if (sessionType === 'match' && arrivalTime && isSessionTimeAfter(arrivalTime, startTime)) {
    throw new Error('Arrival time must be before kick-off time.')
  }

  if (!teamId) {
    throw new Error('Choose a team before creating a session.')
  }

  const title = requestedTitle || (sessionOpponentName ? `Match vs ${sessionOpponentName}` : 'Training session')

  await assertSessionTeamAccess({ user, teamId })

  const { data, error } = await supabase
    .from('assessment_sessions')
    .insert({
      club_id: user.clubId,
      team_id: teamId,
      team: teamName,
      opponent: sessionOpponentName,
      session_type: sessionType,
      session_date: sessionDate,
      arrival_time: sessionType === 'match' && /^\d{2}:\d{2}$/.test(arrivalTime) ? arrivalTime : null,
      start_time: isValidSessionTime(startTime) ? startTime : null,
      end_time: isValidSessionTime(endTime) ? endTime : null,
      location: String(session.location ?? '').trim(),
      notes: String(session.notes ?? '').trim(),
      title,
      created_by: user.id,
      ...getEntryIdentity(user),
      updated_by: getEntryUserId(user),
      ...getEntryIdentity(user, 'updated_by'),
    })
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`assessment-sessions:${user.clubId}:`)
  await createAuditLog({
    user,
    action: 'assessment_session_created',
    entityType: 'assessment_session',
    entityId: data.id,
    metadata: {
      team: teamName,
      opponent: sessionOpponentName,
      sessionType,
      sessionDate,
    },
  })

  return normalizeAssessmentSessionRow(data)
}

export async function updateAssessmentSession({ user, sessionId, session }) {
  await blockDemoMutation(user)

  if (!user?.clubId || !sessionId) {
    throw new Error('Session and club are required.')
  }

  const sessionDate = normalizeDateOnly(session.sessionDate)

  if (!sessionDate) {
    throw new Error('Session date is required.')
  }

  const teamName = String(session.team ?? '').trim()
  const teamId = String(session.teamId ?? '').trim()
  const opponentName = String(session.opponent ?? '').trim()
  const requestedSessionType = String(session.sessionType ?? '').trim()
  const sessionType = ['training', 'match'].includes(requestedSessionType) ? requestedSessionType : 'training'
  const sessionOpponentName = sessionType === 'match' ? opponentName : ''
  const arrivalTime = String(session.arrivalTime ?? '').trim()
  const startTime = String(session.startTime ?? '').trim()
  const endTime = String(session.endTime ?? '').trim()
  const requestedTitle = String(session.title ?? '').trim()

  if (!isValidSessionTime(startTime)) {
    throw new Error(sessionType === 'match' ? 'Kick-off time is required for a fixture.' : 'Choose a start time.')
  }

  if (sessionType === 'match' && !sessionOpponentName && !requestedTitle) {
    throw new Error('Add an opponent or event title for this fixture.')
  }

  if (sessionType === 'match' && arrivalTime && isSessionTimeAfter(arrivalTime, startTime)) {
    throw new Error('Arrival time must be before kick-off time.')
  }

  if (!teamId) {
    throw new Error('Choose a team before updating the session.')
  }

  const title = requestedTitle || (sessionOpponentName ? `Match vs ${sessionOpponentName}` : 'Training session')

  await assertSessionTeamAccess({ user, teamId })

  const { data, error } = await supabase
    .from('assessment_sessions')
    .update({
      team_id: teamId,
      team: teamName,
      opponent: sessionOpponentName,
      session_type: sessionType,
      session_date: sessionDate,
      arrival_time: sessionType === 'match' && /^\d{2}:\d{2}$/.test(arrivalTime) ? arrivalTime : null,
      start_time: isValidSessionTime(startTime) ? startTime : null,
      end_time: isValidSessionTime(endTime) ? endTime : null,
      location: String(session.location ?? '').trim(),
      notes: String(session.notes ?? '').trim(),
      title,
      updated_by: getEntryUserId(user),
      ...getEntryIdentity(user, 'updated_by'),
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .eq('club_id', user.clubId)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`assessment-sessions:${user.clubId}:`)
  await createAuditLog({
    user,
    action: 'assessment_session_updated',
    entityType: 'assessment_session',
    entityId: data.id,
    metadata: {
      team: teamName,
      opponent: sessionOpponentName,
      sessionType,
      sessionDate,
    },
  })

  return normalizeAssessmentSessionRow(data)
}

export async function completeAssessmentSession({ user, sessionId }) {
  await blockDemoMutation(user)

  if (!user?.clubId || !sessionId) {
    throw new Error('Session and club are required.')
  }

  if (Number(user.roleRank ?? 0) < 50) {
    throw new Error('Only managers and team admins can complete sessions.')
  }

  const { data, error } = await supabase
    .from('assessment_sessions')
    .update({
      status: 'completed',
      completed_by: getEntryUserId(user),
      completed_by_name: getEntryUserName(user),
      completed_by_email: getEntryUserEmail(user),
      completed_at: new Date().toISOString(),
      updated_by: getEntryUserId(user),
      ...getEntryIdentity(user, 'updated_by'),
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .eq('club_id', user.clubId)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`assessment-sessions:${user.clubId}:`)
  await createAuditLog({
    user,
    action: 'assessment_session_completed',
    entityType: 'assessment_session',
    entityId: sessionId,
    metadata: {
      title: data.title,
      team: data.team,
      sessionDate: data.session_date,
    },
  })

  return normalizeAssessmentSessionRow(data)
}

export async function getAssessmentSessionPlayers({ user, sessionId } = {}) {
  if (!user?.clubId || !sessionId || user.role === 'super_admin') {
    return []
  }

  return getCachedResource(`assessment-session-players:${sessionId}`, async () => {
    const { data, error } = await supabase
      .from('assessment_session_players')
      .select(
        '*, players:player_id (player_name, section, team, parent_name, parent_email, parent_contacts)',
      )
      .eq('session_id', sessionId)
      .order('player_name', { ascending: true })

    if (error) {
      console.error(error)
      throw error
    }

    return (data ?? []).map(normalizeAssessmentSessionPlayerRow)
  })
}

export async function deleteAssessmentSession({ user, sessionId }) {
  await blockDemoMutation(user)

  if (!user?.clubId || !sessionId) {
    throw new Error('Session and club are required.')
  }

  if (Number(user.roleRank ?? 0) < 50) {
    throw new Error('Only managers and team admins can delete sessions.')
  }

  const { data: session, error: sessionError } = await supabase
    .from('assessment_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('club_id', user.clubId)
    .single()

  if (sessionError) {
    console.error(sessionError)
    throw sessionError
  }

  const sessionDate = normalizeDateOnly(session.session_date)
  const sessionTeamId = String(session.team_id ?? '').trim()
  const sessionTeam = String(session.team ?? '').trim().toLowerCase()
  let evaluationQuery = supabase
    .from('evaluations')
    .select('id, session, date, team, team_id')
    .eq('club_id', user.clubId)

  if (sessionTeamId) {
    evaluationQuery = evaluationQuery.eq('team_id', sessionTeamId)
  } else if (sessionTeam) {
    evaluationQuery = evaluationQuery.eq('team', session.team)
  }

  const { data: evaluationRows, error: evaluationsError } = await evaluationQuery.limit(1000)

  if (evaluationsError) {
    console.error(evaluationsError)
    throw evaluationsError
  }

  const hasLinkedAssessment = (evaluationRows ?? []).some((evaluation) => {
    const evaluationDate = normalizeDateOnly(evaluation.session || evaluation.date)
    const evaluationTeamId = String(evaluation.team_id ?? '').trim()
    const evaluationTeam = String(evaluation.team ?? '').trim().toLowerCase()

    if (sessionDate && evaluationDate && sessionDate !== evaluationDate) {
      return false
    }

    if (sessionTeamId && evaluationTeamId) {
      return sessionTeamId === evaluationTeamId
    }

    return Boolean(sessionTeam && evaluationTeam && sessionTeam === evaluationTeam)
  })

  if (hasLinkedAssessment) {
    throw new Error('This session has development records and cannot be deleted.')
  }

  const { data, error } = await supabase
    .from('assessment_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('club_id', user.clubId)
    .select('id, title, team, session_date')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`assessment-sessions:${user.clubId}:`)
  invalidateMemoryCacheByPrefix(`assessment-session-players:${sessionId}`)
  await createAuditLog({
    user,
    action: 'assessment_session_deleted',
    entityType: 'assessment_session',
    entityId: sessionId,
    metadata: {
      title: data.title,
      team: data.team,
      sessionDate: data.session_date,
    },
  })
}

export async function addPlayersToAssessmentSession({ user, sessionId, players }) {
  await blockDemoMutation(user)

  if (!user?.clubId || !sessionId) {
    throw new Error('Session and club are required.')
  }

  const normalizedPlayers = (players ?? []).filter((player) => player?.id)

  if (normalizedPlayers.length === 0) {
    return getAssessmentSessionPlayers({ user, sessionId })
  }

  const { data, error } = await supabase
    .from('assessment_session_players')
    .upsert(
      normalizedPlayers.map((player) => ({
        session_id: sessionId,
        player_id: player.id,
        player_name: player.playerName,
        section: player.section,
        team: player.team,
        parent_name: player.parentName,
        parent_email: player.parentEmail,
        parent_contacts: normalizeParentContacts(player.parentContacts, {
          parentName: player.parentName,
          parentEmail: player.parentEmail,
        }),
        created_by: getEntryUserId(user),
        ...getEntryIdentity(user),
        updated_by: getEntryUserId(user),
        ...getEntryIdentity(user, 'updated_by'),
      })),
      {
        onConflict: 'session_id,player_id',
      },
    )
    .select('*, players:player_id (player_name, section, team, parent_name, parent_email, parent_contacts)')

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`assessment-session-players:${sessionId}`)
  await createAuditLog({
    user,
    action: 'assessment_session_players_added',
    entityType: 'assessment_session',
    entityId: sessionId,
    metadata: {
      playerCount: normalizedPlayers.length,
    },
  })

  return (data ?? []).map(normalizeAssessmentSessionPlayerRow)
}

export async function updateAssessmentSessionPlayer({ user, sessionPlayerId, notes }) {
  await blockDemoMutation(user)

  if (!user?.clubId || !sessionPlayerId) {
    throw new Error('Session player is required.')
  }

  const { data, error } = await supabase
    .from('assessment_session_players')
    .update({
      notes: String(notes ?? '').trim(),
      updated_by: getEntryUserId(user),
      ...getEntryIdentity(user, 'updated_by'),
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionPlayerId)
    .select('*, players:player_id (player_name, section, team, parent_name, parent_email, parent_contacts)')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`assessment-session-players:${data.session_id}`)
  return normalizeAssessmentSessionPlayerRow(data)
}

export async function clearAssessmentSessionPlayers({ user, sessionId }) {
  await blockDemoMutation(user)

  if (!user?.clubId || !sessionId) {
    throw new Error('Session and club are required.')
  }

  const { error } = await supabase.from('assessment_session_players').delete().eq('session_id', sessionId)

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`assessment-session-players:${sessionId}`)
  await createAuditLog({
    user,
    action: 'assessment_session_players_cleared',
    entityType: 'assessment_session',
    entityId: sessionId,
  })
}
