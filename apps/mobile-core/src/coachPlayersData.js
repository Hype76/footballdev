import { CAPABILITIES } from '../../../src/lib/paywall-access.js'
import {
  buildCoachPlayerPayload,
  getCoachPlayerSensitiveFieldPolicy,
  normalizeCoachPlayer,
  normalizeCoachPlayerEvaluation,
  normalizeCoachPlayerField,
} from './coachPlayersCore'
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

function normalizePlayerForUser(row, user) {
  return normalizeCoachPlayer(row, {
    canViewContacts: getCoachPlayerSensitiveFieldPolicy(user).canViewContactDetails,
  })
}

async function getCoachPlayerRows(user) {
  const { data: rpcData, error: rpcError } = await supabase.rpc('get_team_players', {
    team_id_value: user.activeTeamId,
  })
  if (!rpcError) return rpcData || []
  if (!['42883', 'PGRST202'].includes(rpcError.code)) throw rpcError
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('club_id', user.clubId)
    .eq('team_id', user.activeTeamId)
    .neq('status', 'archived')
    .order('section', { ascending: true })
    .order('player_name', { ascending: true })
    .limit(250)
  if (error) throw error
  return data || []
}

async function getCoachParentNotificationReadiness(user) {
  const { data, error } = await supabase.rpc('get_team_parent_notification_readiness', {
    team_id_value: user.activeTeamId,
  })
  if (error) return null
  return data || []
}

export async function getCoachPlayerList(user) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  const [playerRows, readinessRows] = await Promise.all([
    getCoachPlayerRows(user),
    getCoachParentNotificationReadiness(user),
  ])
  const statusAvailable = Array.isArray(readinessRows)
  const readinessByPlayer = new Map(
    (readinessRows || []).map((row) => [normalize(row.player_id ?? row.playerId), row]),
  )
  return playerRows.map((row) => {
    const readiness = readinessByPlayer.get(normalize(row.id)) || {}
    return normalizePlayerForUser({
      ...row,
      ...readiness,
      parent_notification_status_available: statusAvailable && Boolean(readiness.player_id ?? readiness.playerId),
    }, user)
  })
}

export async function getCoachPlayerDetail(user, playerId) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  const normalizedPlayerId = normalize(playerId)
  if (!normalizedPlayerId) throw new Error('Choose a Player.')
  const [playerResult, evaluationsResult, fieldsResult, sessionsResult] = await Promise.all([
    supabase
      .from('players')
      .select('*')
      .eq('id', normalizedPlayerId)
      .eq('club_id', user.clubId)
      .eq('team_id', user.activeTeamId)
      .single(),
    supabase
      .from('evaluations')
      .select('id, player_id, date, session, status, average_score, scores, form_responses, comments, created_at')
      .eq('club_id', user.clubId)
      .eq('player_id', normalizedPlayerId)
      .order('date', { ascending: false })
      .limit(30),
    supabase
      .from('form_fields')
      .select('id, label, type, options, required, is_enabled, order_index, team_id')
      .eq('club_id', user.clubId)
      .or(`team_id.eq.${user.activeTeamId},team_id.is.null`)
      .eq('is_enabled', true)
      .order('order_index', { ascending: true }),
    supabase
      .from('assessment_session_players')
      .select('id, notes, session_id, assessment_sessions:session_id(id, title, session_date, session_type, status, team_id)')
      .eq('player_id', normalizedPlayerId)
      .order('created_at', { ascending: false })
      .limit(30),
  ])
  const firstError = playerResult.error || evaluationsResult.error || fieldsResult.error || sessionsResult.error
  if (firstError) throw firstError
  const sessions = (sessionsResult.data || [])
    .map((row) => {
      const session = Array.isArray(row.assessment_sessions) ? row.assessment_sessions[0] : row.assessment_sessions
      return ({
      id: normalize(session?.id || row.session_id),
      notes: normalize(row.notes),
      sessionDate: normalize(session?.session_date),
      sessionType: normalize(session?.session_type),
      status: normalize(session?.status),
      title: normalize(session?.title) || 'Session',
      })
    })
    .filter((session) => session.id)
  return Object.freeze({
    evaluations: (evaluationsResult.data || []).map(normalizeCoachPlayerEvaluation),
    fields: (fieldsResult.data || []).map(normalizeCoachPlayerField),
    player: normalizePlayerForUser(playerResult.data, user),
    sessions,
  })
}

export async function saveCoachPlayer(user, form, existingPlayer = null) {
  assertCoachOperationalMutation(user, { requiresTeam: true })
  assertCoachCapability(user, CAPABILITIES.basicDevelopmentRecords)
  if (existingPlayer?.status === 'archived') throw new Error('Archived Players are read-only in Coach mobile.')
  const payload = buildCoachPlayerPayload({ context: user, form })
  const identity = getCoachEntryIdentity(user, 'updated')
  let query
  let action
  if (existingPlayer?.id) {
    query = supabase
      .from('players')
      .update({ ...payload, ...identity, updated_by: user.id })
      .eq('id', existingPlayer.id)
      .eq('club_id', user.clubId)
      .eq('team_id', user.activeTeamId)
    action = 'player_updated'
  } else {
    const { data: existingRows, error: existingError } = await supabase
      .from('players')
      .select('id, status')
      .eq('club_id', user.clubId)
      .eq('team_id', user.activeTeamId)
      .eq('section', payload.section)
      .eq('player_name', payload.player_name)
      .limit(1)
    if (existingError) throw existingError
    const existing = existingRows?.[0]
    if (existing?.status === 'archived') {
      throw new Error('An archived Player already has this name. Restore that record in the governed web workflow.')
    }
    query = existing?.id
      ? supabase.from('players').update({ ...payload, status: existing.status, ...identity, updated_by: user.id }).eq('id', existing.id)
      : supabase.from('players').insert({
        ...payload,
        ...getCoachEntryIdentity(user),
        ...identity,
        created_by: user.id,
        status: 'active',
        updated_by: user.id,
      })
    action = existing?.id ? 'player_updated' : 'player_created'
  }
  const { data, error } = await query.select('*').single()
  if (error) throw error
  await recordCoachOperationalAudit({
    action,
    entityId: data.id,
    entityType: 'player',
    metadata: { playerName: data.player_name, section: data.section, teamId: data.team_id },
    user,
  })
  return normalizePlayerForUser(data, user)
}

export function getCoachPlayerMobileExclusions() {
  return Object.freeze([
    Object.freeze({ capability: 'hard_delete', classification: 'web_only_governance', reason: 'Destructive retention and confirmation workflow.' }),
    Object.freeze({ capability: 'cross_team_transfer', classification: 'web_only_governance', reason: 'Canonical transfer preserves membership history and requires a dedicated governed workflow.' }),
    Object.freeze({ capability: 'archive_restore', classification: 'web_only_governance', reason: 'Retention, limits, family-link revocation, and recovery belong in the governed web workflow.' }),
  ])
}
