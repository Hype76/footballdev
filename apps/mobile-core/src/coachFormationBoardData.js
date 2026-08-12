import { supabase } from './supabase'

const normalize = (value) => String(value ?? '').trim()
const array = (value) => Array.isArray(value) ? value : []

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

function normalizeVersion(row) {
  if (!row) return null
  const roster = array(row.bench)
  return {
    bench: roster.filter((player) => player?.state !== 'unplaced'),
    boardId: row.board_id ?? row.boardId ?? '',
    formationPresetKey: normalize(row.formation_preset_key ?? row.formationPresetKey),
    gameFormat: normalize(row.game_format ?? row.gameFormat),
    id: row.id ?? '',
    notes: normalize(row.notes),
    placements: array(row.placements),
    presetRegistryVersion: Number(row.preset_registry_version ?? row.presetRegistryVersion ?? 1),
    unplaced: roster.filter((player) => player?.state === 'unplaced'),
    versionNumber: Number(row.version_number ?? row.versionNumber ?? 0),
  }
}

export function normalizeCoachFormationBoard(row) {
  const payload = row?.board ? row : { board: row }
  const board = payload.board
  if (!board) return null
  return {
    clubId: board.club_id ?? board.clubId ?? '',
    createdAt: board.created_at ?? board.createdAt ?? '',
    currentVersion: normalizeVersion(payload.currentVersion ?? payload.current_version),
    currentVersionId: board.current_version_id ?? board.currentVersionId ?? '',
    currentVersionNumber: Number(board.current_version_number ?? board.currentVersionNumber ?? 0),
    formationPresetKey: normalize(board.formation_preset_key ?? board.formationPresetKey),
    gameFormat: normalize(board.game_format ?? board.gameFormat),
    id: board.id ?? '',
    linkedMatchDayId: board.linked_match_day_id ?? board.linkedMatchDayId ?? '',
    presetRegistryVersion: Number(board.preset_registry_version ?? board.presetRegistryVersion ?? 1),
    teamId: board.team_id ?? board.teamId ?? '',
    title: normalize(board.title),
  }
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

function serializeBench(bench = []) {
  return bench.map((player) => ({ ...player, state: 'bench' }))
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
  const matchDescription = match?.id ? `Match plan for ${match.teamName} v ${match.opponent}` : 'Standalone Team formation plan'
  const data = await rpc('create_formation_board', {
    bench_value: serializeBench(draft.bench),
    description_value: matchDescription,
    game_format_value: draft.gameFormat,
    notes_value: '',
    pitch_orientation_value: 'portrait',
    placements_value: draft.placements,
    preset_key_value: draft.presetKey,
    registry_version_value: draft.registryVersion || 1,
    target_team_id: user.activeTeamId,
    title_value: normalize(title) || (match?.id ? `${match.teamName} v ${match.opponent}` : 'Formation Board'),
    visibility_value: 'draft',
  })
  return normalizeCoachFormationBoard(data)
}

export async function saveCoachFormationBoard(user, board, draft, title) {
  assertFormationWrite(user)
  const data = await rpc('save_formation_board_editor', {
    bench_value: serializeBench(draft.bench),
    description_value: board.linkedMatchDayId ? `Match plan for ${normalize(title) || board.title}` : 'Standalone Team formation plan',
    expected_version_number: board.currentVersionNumber,
    game_format_value: draft.gameFormat,
    notes_value: '',
    pitch_orientation_value: 'portrait',
    placements_value: draft.placements,
    preset_key_value: draft.presetKey,
    registry_version_value: draft.registryVersion || 1,
    target_board_id: board.id,
    title_value: normalize(title) || board.title,
    version_reason_value: 'coach_mobile_save',
    visibility_value: 'draft',
  })
  return normalizeCoachFormationBoard(data)
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
