import { supabase } from './supabase'
import {
  array,
  buildCoachFormationBoardCreatePayload,
  buildCoachFormationBoardSavePayload,
  normalize,
  normalizeCoachFormationBoard,
} from './coachFormationBoardPayload.js'

export {
  buildCoachFormationBoardCreatePayload,
  buildCoachFormationBoardSavePayload,
  normalizeCoachFormationBoard,
} from './coachFormationBoardPayload.js'

function assertFormationRead(user) {
  if (!user?.id || !user?.clubId || !user?.activeTeamId) throw new Error('Choose an authorised Team before opening formations.')
}

function assertFormationWrite(user) {
  assertFormationRead(user)
  if (Number(user.roleRank || 0) < 30 || user.hasActivePlanAccess !== true) throw new Error('Coach or manager plan access is required to save formations.')
}

async function rpc(name, params) {
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw error
  return data
}

export function normalizeCoachFormationPreset(row) {
  return {
    displayName: normalize(row.display_name ?? row.displayName),
    gameFormat: normalize(row.game_format ?? row.gameFormat),
    key: normalize(row.preset_key ?? row.key),
    playerCount: Number(row.player_count ?? row.playerCount ?? 0),
    registryVersion: Number(row.registry_version ?? row.registryVersion ?? 1),
    slots: array(row.slots),
  }
}

export async function getCoachFormationPresets(user) {
  assertFormationRead(user)
  const { data, error } = await supabase.from('formation_board_presets').select('*').eq('registry_version', 1).eq('readiness_state', 'ready').order('sort_order', { ascending: true })
  if (error) throw error
  return (data || []).map(normalizeCoachFormationPreset)
}

export async function getCoachFormationBoards(user) {
  assertFormationRead(user)
  const data = await rpc('list_formation_boards', { include_archived: false, target_team_id: user.activeTeamId })
  return array(data).map(normalizeCoachFormationBoard).filter(Boolean)
}

export async function createCoachFormationBoard(user, match, draft, title) {
  assertFormationWrite(user)
  const data = await rpc('create_formation_board', {
    ...buildCoachFormationBoardCreatePayload(match, draft, title),
    target_team_id: user.activeTeamId,
  })
  return normalizeCoachFormationBoard(data)
}

export async function saveCoachFormationBoard(user, board, draft, title) {
  assertFormationWrite(user)
  const data = await rpc('save_formation_board_editor', buildCoachFormationBoardSavePayload(board, draft, title))
  return normalizeCoachFormationBoard(data)
}

export async function saveCoachMatchFormationBoard(user, match, board, draft, title, shared = false) {
  assertFormationWrite(user)
  if (!normalize(match?.id)) throw new Error('Choose a match before saving a lineup.')
  if (board?.linkedMatchDayId && board.linkedMatchDayId !== match.id) throw new Error('This lineup belongs to another match.')
  const payload = board
    ? buildCoachFormationBoardSavePayload(board, draft, title)
    : buildCoachFormationBoardCreatePayload(match, draft, title)
  delete payload.visibility_value
  return normalizeCoachFormationBoard(await rpc('save_coach_match_formation', {
    ...payload,
    target_board_id: board?.id || null,
    target_match_day_id: match.id,
    expected_version_number: board?.currentVersionNumber ?? null,
    shared_value: shared === true,
  }))
}

export async function linkCoachFormationBoard(user, boardId, matchDayId) {
  assertFormationWrite(user)
  return normalizeCoachFormationBoard(await rpc('link_formation_board_to_match', { target_board_id: boardId, target_match_day_id: matchDayId }))
}

export async function getCoachFormationPublications(user, boardId) {
  assertFormationRead(user)
  return array(await rpc('list_formation_board_match_publications', { target_board_id: boardId }))
}

export async function getCoachFormationResourcePublications(user, boardId) {
  assertFormationRead(user)
  return array(await rpc('list_formation_board_publications', { target_board_id: boardId }))
}

export async function publishCoachFormationResource(user, board, category = 'general', resourceId = '') {
  assertFormationWrite(user)
  return rpc('publish_formation_board_version', {
    category_value: normalize(category) || 'general',
    publication_action_value: normalize(resourceId) ? 'update_resource' : 'new_resource',
    target_board_id: board.id,
    target_resource_id: normalize(resourceId) || null,
    target_version_id: board.currentVersionId,
    thumbnail_failed_value: true,
    thumbnail_path_value: null,
  })
}

export async function publishCoachFormationBoard(user, board, matchDayId) {
  assertFormationWrite(user)
  return rpc('publish_formation_board_match_plan', { target_board_id: board.id, target_match_day_id: matchDayId, target_version_id: board.currentVersionId })
}

export async function withdrawCoachFormationBoard(user, board, matchDayId) {
  assertFormationWrite(user)
  return rpc('withdraw_formation_board_match_plan', { target_board_id: board.id, target_match_day_id: matchDayId })
}
