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
  normalizeAssessmentSessionGameRow,
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
  const sessionType = ['training', 'match', 'tournament'].includes(requestedSessionType) ? requestedSessionType : 'training'
  const sessionOpponentName = sessionType === 'match' ? opponentName : ''

  if (!teamId) {
    throw new Error('Choose a team before creating a session.')
  }

  const { data, error } = await supabase
    .from('assessment_sessions')
    .insert({
      club_id: user.clubId,
      team_id: teamId,
      team: teamName,
      opponent: sessionOpponentName,
      session_type: sessionType,
      session_date: sessionDate,
      title: sessionType === 'tournament' ? `${teamName} Tournament` : sessionOpponentName ? `${teamName} vs ${sessionOpponentName}` : teamName,
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

export async function getAssessmentSessionGames({ user, sessionId } = {}) {
  if (!user?.clubId || !sessionId || user.role === 'super_admin') {
    return []
  }

  return getCachedResource(`assessment-session-games:${sessionId}`, async () => {
    const { data, error } = await supabase
      .from('assessment_session_games')
      .select('*')
      .eq('session_id', sessionId)
      .eq('club_id', user.clubId)
      .order('game_date', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      console.error(error)
      throw error
    }

    return (data ?? []).map(normalizeAssessmentSessionGameRow)
  })
}

export async function createAssessmentSessionGame({ user, sessionId, game }) {
  await blockDemoMutation(user)

  if (!user?.clubId || !sessionId) {
    throw new Error('Session and club are required.')
  }

  const opponent = String(game?.opponent ?? '').trim()
  const teamScore = game?.teamScore === '' || game?.teamScore == null ? null : Number(game.teamScore)
  const opponentScore = game?.opponentScore === '' || game?.opponentScore == null ? null : Number(game.opponentScore)
  const gameDate = normalizeDateOnly(game?.gameDate)

  if (!opponent) {
    throw new Error('Opponent is required.')
  }

  if (!Number.isFinite(teamScore) || !Number.isFinite(opponentScore)) {
    throw new Error('Enter both scores.')
  }

  const { data, error } = await supabase
    .from('assessment_session_games')
    .insert({
      session_id: sessionId,
      club_id: user.clubId,
      opponent,
      team_score: teamScore,
      opponent_score: opponentScore,
      game_date: gameDate || null,
      notes: String(game?.notes ?? '').trim(),
      created_by: getEntryUserId(user),
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

  invalidateMemoryCacheByPrefix(`assessment-session-games:${sessionId}`)
  await createAuditLog({
    user,
    action: 'assessment_session_game_added',
    entityType: 'assessment_session_game',
    entityId: data.id,
    metadata: {
      sessionId,
      opponent,
      score: `${teamScore}-${opponentScore}`,
    },
  })

  return normalizeAssessmentSessionGameRow(data)
}

export async function deleteAssessmentSessionGame({ user, gameId }) {
  await blockDemoMutation(user)

  if (!user?.clubId || !gameId) {
    throw new Error('Game result is required.')
  }

  const { data, error } = await supabase
    .from('assessment_session_games')
    .delete()
    .eq('id', gameId)
    .eq('club_id', user.clubId)
    .select('id, session_id, opponent')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`assessment-session-games:${data.session_id}`)
  await createAuditLog({
    user,
    action: 'assessment_session_game_deleted',
    entityType: 'assessment_session_game',
    entityId: gameId,
    metadata: {
      sessionId: data.session_id,
      opponent: data.opponent,
    },
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
    throw new Error('This session has assessments and cannot be deleted.')
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
  invalidateMemoryCacheByPrefix(`assessment-session-games:${sessionId}`)
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
