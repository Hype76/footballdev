import { CAPABILITIES } from '../../../src/lib/paywall-access.js'
import {
  buildCoachSessionPayload,
  normalizeCoachSession,
  normalizeCoachSessionPlayer,
} from './coachSessionsCore'
import {
  assertCoachCapability,
  assertCoachOperationalMutation,
  assertCoachOperationalRead,
  getCoachEntryIdentity,
  recordCoachOperationalAudit,
} from './coachOperationalData'
import { supabase } from './supabase'

function normalize(value) {
  return String(value ?? '').trim()
}

export async function getCoachSessionList(user) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  const { data, error } = await supabase
    .from('assessment_sessions')
    .select('*')
    .eq('club_id', user.clubId)
    .eq('team_id', user.activeTeamId)
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return (data || []).map(normalizeCoachSession)
}

export async function getCoachSessionDetail(user, sessionId) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  const id = normalize(sessionId)
  if (!id) throw new Error('Choose a Session.')
  const [sessionResult, playersResult] = await Promise.all([
    supabase
      .from('assessment_sessions')
      .select('*')
      .eq('id', id)
      .eq('club_id', user.clubId)
      .eq('team_id', user.activeTeamId)
      .single(),
    supabase
      .from('assessment_session_players')
      .select('*, players:player_id(player_name, section, team, status)')
      .eq('session_id', id)
      .order('player_name', { ascending: true }),
  ])
  const error = sessionResult.error || playersResult.error
  if (error) throw error
  return Object.freeze({
    players: (playersResult.data || []).map(normalizeCoachSessionPlayer),
    session: normalizeCoachSession(sessionResult.data),
  })
}

export async function saveCoachSession(user, form, existingSession = null) {
  assertCoachOperationalMutation(user, { requiresTeam: true })
  assertCoachCapability(user, CAPABILITIES.assessments)
  if (existingSession && existingSession.status !== 'open') throw new Error('Only open Sessions can be edited.')
  const payload = buildCoachSessionPayload({ context: user, form })
  const updatedIdentity = getCoachEntryIdentity(user, 'updated')
  let query
  let action
  if (existingSession?.id) {
    query = supabase
      .from('assessment_sessions')
      .update({ ...payload, ...updatedIdentity, updated_at: new Date().toISOString(), updated_by: user.id })
      .eq('id', existingSession.id)
      .eq('club_id', user.clubId)
      .eq('team_id', user.activeTeamId)
    action = 'assessment_session_updated'
  } else {
    query = supabase
      .from('assessment_sessions')
      .insert({
        ...payload,
        ...getCoachEntryIdentity(user),
        ...updatedIdentity,
        created_by: user.id,
        status: 'open',
        updated_by: user.id,
      })
    action = 'assessment_session_created'
  }
  const { data, error } = await query.select('*').single()
  if (error) throw error
  await recordCoachOperationalAudit({
    action,
    entityId: data.id,
    entityType: 'assessment_session',
    metadata: { sessionDate: data.session_date, sessionType: data.session_type, teamId: data.team_id },
    user,
  })
  return normalizeCoachSession(data)
}

export async function completeCoachSession(user, session) {
  assertCoachOperationalMutation(user, { minimumRank: 50, requiresTeam: true })
  if (!session?.id || session.status !== 'open') throw new Error('Choose an open Session.')
  const { data, error } = await supabase
    .from('assessment_sessions')
    .update({
      ...getCoachEntryIdentity(user, 'completed'),
      ...getCoachEntryIdentity(user, 'updated'),
      completed_at: new Date().toISOString(),
      completed_by: user.id,
      status: 'completed',
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq('id', session.id)
    .eq('club_id', user.clubId)
    .eq('team_id', user.activeTeamId)
    .eq('status', 'open')
    .select('*')
    .single()
  if (error) throw error
  await recordCoachOperationalAudit({
    action: 'assessment_session_completed',
    entityId: data.id,
    entityType: 'assessment_session',
    metadata: { sessionDate: data.session_date, teamId: data.team_id },
    user,
  })
  return normalizeCoachSession(data)
}

export async function addCoachSessionPlayers(user, session, players) {
  assertCoachOperationalMutation(user, { requiresTeam: true })
  if (!session?.id || session.status !== 'open') throw new Error('Choose an open Session.')
  const rows = (players || []).filter((player) => player?.id && player.teamId === user.activeTeamId)
  if (rows.length === 0) return []
  const { data, error } = await supabase
    .from('assessment_session_players')
    .upsert(rows.map((player) => ({
      ...getCoachEntryIdentity(user),
      ...getCoachEntryIdentity(user, 'updated'),
      created_by: user.id,
      player_id: player.id,
      player_name: player.playerName,
      section: player.section,
      session_id: session.id,
      team: player.team,
      updated_by: user.id,
    })), { onConflict: 'session_id,player_id' })
    .select('*, players:player_id(player_name, section, team, status)')
  if (error) throw error
  await recordCoachOperationalAudit({
    action: 'assessment_session_players_added',
    entityId: session.id,
    entityType: 'assessment_session',
    metadata: { playerCount: rows.length, teamId: user.activeTeamId },
    user,
  })
  return (data || []).map(normalizeCoachSessionPlayer)
}

export async function updateCoachSessionPlayerNotes(user, session, sessionPlayerId, notes) {
  assertCoachOperationalMutation(user, { requiresTeam: true })
  if (!session?.id || session.status !== 'open') throw new Error('Choose an open Session.')
  const { data, error } = await supabase
    .from('assessment_session_players')
    .update({
      ...getCoachEntryIdentity(user, 'updated'),
      notes: normalize(notes),
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq('id', sessionPlayerId)
    .eq('session_id', session.id)
    .select('*, players:player_id(player_name, section, team, status)')
    .single()
  if (error) throw error
  return normalizeCoachSessionPlayer(data)
}
