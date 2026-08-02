import { supabase } from '../supabase-client.js'
import { clearViewCaches, invalidateMemoryCacheByPrefix } from './cache-store.js'
import { blockDemoMutation } from './demo-guards.js'

export const FORMATION_BOARD_REGISTRY_VERSION = 1

export const FORMATION_BOARD_GAME_FORMATS = Object.freeze([
  { label: '5v5', playerCount: 5, value: '5v5' },
  { label: '7v7', playerCount: 7, value: '7v7' },
  { label: '9v9', playerCount: 9, value: '9v9' },
  { label: '11v11', playerCount: 11, value: '11v11' },
])

export const FORMATION_BOARD_ORIENTATIONS = Object.freeze(['portrait', 'landscape'])
export const FORMATION_BOARD_VISIBILITY_STATES = Object.freeze(['draft', 'shared'])
export const FORMATION_BOARD_EXPORT_FORMATS = Object.freeze(['png', 'pdf'])

const FORMATION_BOARD_ERROR_MESSAGES = Object.freeze({
  formation_board_archive_forbidden: 'You do not have permission to archive this Formation Board.',
  formation_board_archived_publish_forbidden: 'Restore this Formation Board before publishing it.',
  formation_board_auth_required: 'Sign in again before using Formation Boards.',
  formation_board_bench_limit_exceeded: 'This Formation Board has too many Players on the bench.',
  formation_board_create_forbidden: 'You do not have permission to create Formation Boards for this Team.',
  formation_board_delete_confirmation_failed: 'Enter the exact Formation Board title to confirm deletion.',
  formation_board_delete_forbidden: 'Only an authorised Team Admin or Manager can delete this Formation Board.',
  formation_board_duplicate_publication: 'This saved version is already published to that Team Resource.',
  formation_board_edit_forbidden: 'You do not have permission to edit this Formation Board.',
  formation_board_export_forbidden: 'You do not have permission to export this Formation Board.',
  formation_board_forbidden: 'You do not have permission to view this Formation Board.',
  formation_board_not_found: 'This Formation Board is no longer available.',
  formation_board_payload_invalid: 'Check the Formation Board details and try again.',
  formation_board_pitch_player_limit_exceeded: 'This game format does not have enough pitch places for every selected Player.',
  formation_board_placement_invalid: 'Keep every Player marker within the pitch boundary.',
  formation_board_player_duplicate: 'A Player can only appear once on a Formation Board.',
  formation_board_player_invalid: 'One or more selected Players are not available for this Team.',
  formation_board_player_out_of_scope: 'One or more selected Players are not available for this Team.',
  formation_board_preset_invalid: 'Choose an available formation for this game format.',
  formation_board_publish_forbidden: 'You do not have permission to publish this Formation Board.',
  formation_board_published_delete_forbidden: 'Published Formation Boards must be archived and retained for resource history.',
  formation_board_resource_category_invalid: 'Choose an available Team Resource category.',
  formation_board_resource_not_linked: 'Choose a Team Resource already linked to this Formation Board.',
  formation_board_restore_forbidden: 'You do not have permission to restore this Formation Board.',
  formation_board_shirt_number_invalid: 'Use a shirt number from 0 to 999, or leave it blank.',
  formation_board_snapshot_invalid: 'Check the Player positions and bench, then try again.',
  formation_board_snapshot_must_be_arrays: 'The saved pitch and bench data is not valid.',
  formation_board_thumbnail_invalid: 'The Formation Board preview is not valid for this saved version.',
  formation_board_thumbnail_required: 'Prepare a preview before publishing, or use the safe fallback.',
  formation_board_title_invalid: 'Enter a Formation Board title between 1 and 120 characters.',
  formation_board_version_conflict: 'A newer saved version is available. Reload it before saving your changes.',
  formation_board_version_not_found: 'That Formation Board version is no longer available.',
})

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizeFormationBoardVersion(row) {
  if (!row) return null

  return {
    id: row.id ?? '',
    boardId: row.board_id ?? row.boardId ?? '',
    clubId: row.club_id ?? row.clubId ?? '',
    teamId: row.team_id ?? row.teamId ?? '',
    versionNumber: Number(row.version_number ?? row.versionNumber ?? 0),
    gameFormat: normalizeText(row.game_format ?? row.gameFormat),
    formationPresetKey: normalizeText(row.formation_preset_key ?? row.formationPresetKey),
    presetRegistryVersion: Number(row.preset_registry_version ?? row.presetRegistryVersion ?? FORMATION_BOARD_REGISTRY_VERSION),
    pitchOrientation: normalizeText(row.pitch_orientation ?? row.pitchOrientation) || 'portrait',
    placements: normalizeArray(row.placements),
    bench: normalizeArray(row.bench),
    notes: normalizeText(row.notes),
    createdByProfileId: row.created_by_profile_id ?? row.createdByProfileId ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
    versionReason: normalizeText(row.version_reason ?? row.versionReason),
    sourceVersionId: row.source_version_id ?? row.sourceVersionId ?? '',
  }
}

function normalizeFormationBoardPublication(row) {
  if (!row) return null

  return {
    id: row.id ?? '',
    boardId: row.board_id ?? row.boardId ?? '',
    boardVersionId: row.board_version_id ?? row.boardVersionId ?? '',
    clubId: row.club_id ?? row.clubId ?? '',
    teamId: row.team_id ?? row.teamId ?? '',
    resourceId: row.resource_id ?? row.resourceId ?? '',
    resourceCategory: normalizeText(row.resource_category ?? row.resourceCategory),
    publicationNumber: Number(row.publication_number ?? row.publicationNumber ?? 0),
    publicationAction: normalizeText(row.publication_action ?? row.publicationAction),
    previousPublicationId: row.previous_publication_id ?? row.previousPublicationId ?? '',
    publishedByProfileId: row.published_by_profile_id ?? row.publishedByProfileId ?? '',
    publishedByName: normalizeText(row.published_by_name ?? row.publishedByName),
    publishedAt: row.published_at ?? row.publishedAt ?? '',
    boardTitleSnapshot: normalizeText(row.board_title_snapshot ?? row.boardTitleSnapshot),
    boardDescriptionSnapshot: normalizeText(row.board_description_snapshot ?? row.boardDescriptionSnapshot),
    thumbnailBucket: normalizeText(row.thumbnail_bucket ?? row.thumbnailBucket),
    thumbnailPath: normalizeText(row.thumbnail_path ?? row.thumbnailPath),
    publicationState: normalizeText(row.publication_state ?? row.publicationState),
  }
}

export function normalizeFormationBoard(row) {
  const payload = row?.board ? row : { board: row }
  const board = payload.board

  if (!board) return null

  return {
    id: board.id ?? '',
    clubId: board.club_id ?? board.clubId ?? '',
    teamId: board.team_id ?? board.teamId ?? '',
    title: normalizeText(board.title),
    description: normalizeText(board.description),
    gameFormat: normalizeText(board.game_format ?? board.gameFormat),
    formationPresetKey: normalizeText(board.formation_preset_key ?? board.formationPresetKey),
    presetRegistryVersion: Number(board.preset_registry_version ?? board.presetRegistryVersion ?? FORMATION_BOARD_REGISTRY_VERSION),
    visibilityState: normalizeText(board.visibility_state ?? board.visibilityState) || 'draft',
    createdByProfileId: board.created_by_profile_id ?? board.createdByProfileId ?? '',
    currentVersionId: board.current_version_id ?? board.currentVersionId ?? '',
    currentVersionNumber: Number(board.current_version_number ?? board.currentVersionNumber ?? 0),
    currentPublicationId: board.current_publication_id ?? board.currentPublicationId ?? '',
    archivedAt: board.archived_at ?? board.archivedAt ?? '',
    deletedAt: board.deleted_at ?? board.deletedAt ?? '',
    createdAt: board.created_at ?? board.createdAt ?? '',
    updatedAt: board.updated_at ?? board.updatedAt ?? '',
    currentVersion: normalizeFormationBoardVersion(payload.currentVersion ?? payload.current_version),
    currentPublication: normalizeFormationBoardPublication(payload.currentPublication ?? payload.current_publication),
  }
}

export function normalizeFormationBoardPreset(row) {
  return {
    registryVersion: Number(row.registry_version ?? row.registryVersion ?? FORMATION_BOARD_REGISTRY_VERSION),
    key: normalizeText(row.preset_key ?? row.key),
    displayName: normalizeText(row.display_name ?? row.displayName),
    gameFormat: normalizeText(row.game_format ?? row.gameFormat),
    playerCount: Number(row.player_count ?? row.playerCount ?? 0),
    slots: normalizeArray(row.slots),
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
    readinessState: normalizeText(row.readiness_state ?? row.readinessState),
  }
}

export function getFormationBoardError(error) {
  const code = normalizeText(error?.message).split(/[:\s]/)[0]
  const nextError = new Error(FORMATION_BOARD_ERROR_MESSAGES[code] || error?.message || 'Formation Board request failed.')
  nextError.code = code || error?.code || 'formation_board_request_failed'
  nextError.cause = error
  return nextError
}

async function callFormationBoardRpc(name, parameters) {
  const { data, error } = await supabase.rpc(name, parameters)

  if (error) {
    throw getFormationBoardError(error)
  }

  return data
}

async function prepareFormationBoardMutation(user) {
  await blockDemoMutation(user)
}

function resolveTeamId(teamId, user) {
  const value = normalizeText(teamId) || normalizeText(user?.activeTeamId)

  if (!value) {
    throw new Error('Choose a Team before using Formation Boards.')
  }

  return value
}

export async function getFormationBoardPresets({ gameFormat = '', registryVersion = FORMATION_BOARD_REGISTRY_VERSION } = {}) {
  let query = supabase
    .from('formation_board_presets')
    .select('*')
    .eq('registry_version', registryVersion)
    .eq('readiness_state', 'ready')
    .order('sort_order', { ascending: true })

  if (normalizeText(gameFormat)) {
    query = query.eq('game_format', normalizeText(gameFormat))
  }

  const { data, error } = await query

  if (error) throw getFormationBoardError(error)
  return (data ?? []).map(normalizeFormationBoardPreset)
}

export async function getFormationBoards({ includeArchived = false, teamId = '', user } = {}) {
  const data = await callFormationBoardRpc('list_formation_boards', {
    include_archived: Boolean(includeArchived),
    target_team_id: resolveTeamId(teamId, user),
  })

  return normalizeArray(data).map(normalizeFormationBoard).filter(Boolean)
}

export async function getFormationBoard(boardId) {
  return normalizeFormationBoard(await callFormationBoardRpc('get_formation_board', { target_board_id: boardId }))
}

export async function createFormationBoard({
  bench = [],
  description = '',
  gameFormat,
  notes = '',
  pitchOrientation = 'portrait',
  placements = [],
  presetKey,
  registryVersion = FORMATION_BOARD_REGISTRY_VERSION,
  teamId = '',
  title,
  user,
  visibility = 'draft',
} = {}) {
  await prepareFormationBoardMutation(user)
  const data = await callFormationBoardRpc('create_formation_board', {
    bench_value: bench,
    description_value: description,
    game_format_value: gameFormat,
    notes_value: notes,
    pitch_orientation_value: pitchOrientation,
    placements_value: placements,
    preset_key_value: presetKey,
    registry_version_value: registryVersion,
    target_team_id: resolveTeamId(teamId, user),
    title_value: title,
    visibility_value: visibility,
  })

  return normalizeFormationBoard(data)
}

export async function saveFormationBoardVersion({
  bench = [],
  boardId,
  expectedVersionNumber,
  gameFormat,
  notes = '',
  pitchOrientation = 'portrait',
  placements = [],
  presetKey,
  registryVersion = FORMATION_BOARD_REGISTRY_VERSION,
  user,
  versionReason = 'save',
  visibility = null,
} = {}) {
  await prepareFormationBoardMutation(user)
  const data = await callFormationBoardRpc('save_formation_board_version', {
    bench_value: bench,
    expected_version_number: expectedVersionNumber,
    game_format_value: gameFormat,
    notes_value: notes,
    pitch_orientation_value: pitchOrientation,
    placements_value: placements,
    preset_key_value: presetKey,
    registry_version_value: registryVersion,
    target_board_id: boardId,
    version_reason_value: versionReason,
    visibility_value: visibility,
  })

  return normalizeFormationBoard(data)
}

export async function saveFormationBoardEditor({
  bench = [],
  boardId,
  description = '',
  expectedVersionNumber,
  gameFormat,
  notes = '',
  pitchOrientation = 'portrait',
  placements = [],
  presetKey,
  registryVersion = FORMATION_BOARD_REGISTRY_VERSION,
  title,
  user,
  versionReason = 'editor_save',
  visibility,
} = {}) {
  await prepareFormationBoardMutation(user)
  const data = await callFormationBoardRpc('save_formation_board_editor', {
    bench_value: bench,
    description_value: description,
    expected_version_number: expectedVersionNumber,
    game_format_value: gameFormat,
    notes_value: notes,
    pitch_orientation_value: pitchOrientation,
    placements_value: placements,
    preset_key_value: presetKey,
    registry_version_value: registryVersion,
    target_board_id: boardId,
    title_value: title,
    version_reason_value: versionReason,
    visibility_value: visibility,
  })

  return normalizeFormationBoard(data)
}

export async function setFormationBoardVisibility({ boardId, expectedVersionNumber, user, visibility } = {}) {
  await prepareFormationBoardMutation(user)
  return normalizeFormationBoard(await callFormationBoardRpc('set_formation_board_visibility', {
    expected_version_number: expectedVersionNumber,
    target_board_id: boardId,
    visibility_value: visibility,
  }))
}

export async function renameFormationBoard({ boardId, description = null, expectedVersionNumber, title, user } = {}) {
  await prepareFormationBoardMutation(user)
  return normalizeFormationBoard(await callFormationBoardRpc('rename_formation_board', {
    description_value: description,
    expected_version_number: expectedVersionNumber,
    target_board_id: boardId,
    title_value: title,
  }))
}

export async function duplicateFormationBoard({ boardId, title = null, user } = {}) {
  await prepareFormationBoardMutation(user)
  return normalizeFormationBoard(await callFormationBoardRpc('duplicate_formation_board', {
    source_board_id: boardId,
    title_value: title,
  }))
}

export async function archiveFormationBoard({ boardId, user } = {}) {
  await prepareFormationBoardMutation(user)
  return normalizeFormationBoard(await callFormationBoardRpc('archive_formation_board', { target_board_id: boardId }))
}

export async function restoreFormationBoard({ boardId, user } = {}) {
  await prepareFormationBoardMutation(user)
  return normalizeFormationBoard(await callFormationBoardRpc('restore_formation_board', { target_board_id: boardId }))
}

export async function deleteFormationBoard({ boardId, confirmTitle, user } = {}) {
  await prepareFormationBoardMutation(user)
  return callFormationBoardRpc('delete_formation_board', {
    confirm_title_value: confirmTitle,
    target_board_id: boardId,
  })
}

export async function getFormationBoardVersions(boardId) {
  const data = await callFormationBoardRpc('list_formation_board_versions', { target_board_id: boardId })
  return normalizeArray(data).map(normalizeFormationBoardVersion)
}

export async function restoreFormationBoardVersion({ boardId, expectedVersionNumber, user, versionId } = {}) {
  await prepareFormationBoardMutation(user)
  return normalizeFormationBoard(await callFormationBoardRpc('restore_formation_board_version', {
    expected_version_number: expectedVersionNumber,
    target_board_id: boardId,
    target_version_id: versionId,
  }))
}

export async function publishFormationBoardVersion({
  boardId,
  category,
  publicationAction = 'new_resource',
  resourceId = null,
  thumbnailFailed = false,
  thumbnailPath = null,
  user,
  versionId,
} = {}) {
  await prepareFormationBoardMutation(user)
  const data = await callFormationBoardRpc('publish_formation_board_version', {
    category_value: category,
    publication_action_value: publicationAction,
    target_board_id: boardId,
    target_resource_id: resourceId,
    target_version_id: versionId,
    thumbnail_failed_value: Boolean(thumbnailFailed),
    thumbnail_path_value: thumbnailPath,
  })

  invalidateMemoryCacheByPrefix(`resource-library:${normalizeText(user?.clubId)}:`)
  clearViewCaches()

  return {
    protectedUrl: normalizeText(data?.protectedUrl),
    publication: normalizeFormationBoardPublication(data?.publication),
    resource: data?.resource ?? null,
  }
}

export async function getFormationBoardPublications(boardId) {
  const data = await callFormationBoardRpc('list_formation_board_publications', { target_board_id: boardId })
  return normalizeArray(data).map(normalizeFormationBoardPublication)
}

export async function requestFormationBoardExport({ boardId, format, user, versionId } = {}) {
  await prepareFormationBoardMutation(user)
  return callFormationBoardRpc('request_formation_board_export', {
    export_format_value: format,
    target_board_id: boardId,
    target_version_id: versionId,
  })
}
