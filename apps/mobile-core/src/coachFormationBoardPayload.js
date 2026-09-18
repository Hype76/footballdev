export const normalize = (value) => String(value ?? '').trim()
export const array = (value) => Array.isArray(value) ? value : []

function normalizeVersion(row) {
  if (!row) return null
  const roster = array(row.bench)
  return {
    bench: roster.filter((player) => player?.state !== 'unplaced'),
    boardId: row.board_id ?? row.boardId ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
    createdByProfileId: row.created_by_profile_id ?? row.createdByProfileId ?? '',
    formationPresetKey: normalize(row.formation_preset_key ?? row.formationPresetKey),
    gameFormat: normalize(row.game_format ?? row.gameFormat),
    id: row.id ?? '',
    notes: normalize(row.notes),
    placements: array(row.placements),
    presetRegistryVersion: Number(row.preset_registry_version ?? row.presetRegistryVersion ?? 1),
    unplaced: roster.filter((player) => player?.state === 'unplaced'),
    versionNumber: Number(row.version_number ?? row.versionNumber ?? 0),
    versionReason: normalize(row.version_reason ?? row.versionReason),
  }
}

export function normalizeCoachFormationBoard(row) {
  const payload = row?.board ? row : { board: row }
  const board = payload.board
  if (!board) return null
  return {
    clubId: board.club_id ?? board.clubId ?? '',
    isLocked: payload.isLocked === true || board.isLocked === true,
    canDelete: payload.canDelete === true || board.canDelete === true,
    createdAt: board.created_at ?? board.createdAt ?? '',
    createdByProfileId: board.created_by_profile_id ?? board.createdByProfileId ?? '',
    currentVersion: normalizeVersion(payload.currentVersion ?? payload.current_version),
    currentVersionId: board.current_version_id ?? board.currentVersionId ?? '',
    currentVersionNumber: Number(board.current_version_number ?? board.currentVersionNumber ?? 0),
    description: normalize(board.description),
    formationPresetKey: normalize(board.formation_preset_key ?? board.formationPresetKey),
    gameFormat: normalize(board.game_format ?? board.gameFormat),
    id: board.id ?? '',
    linkedMatchDayId: board.linked_match_day_id ?? board.linkedMatchDayId ?? '',
    presetRegistryVersion: Number(board.preset_registry_version ?? board.presetRegistryVersion ?? 1),
    teamId: board.team_id ?? board.teamId ?? '',
    title: normalize(board.title),
    updatedAt: board.updated_at ?? board.updatedAt ?? '',
    visibilityState: normalize(board.visibility_state ?? board.visibilityState) || 'draft',
  }
}

function playerId(player) {
  return normalize(player?.playerId ?? player?.id)
}

function serializeRosterPlayer(player, state) {
  const nextPlayer = { ...player, state }
  if (state === 'unplaced') {
    delete nextPlayer.x
    delete nextPlayer.y
    delete nextPlayer.slotId
    delete nextPlayer.positionGroup
  }
  return nextPlayer
}

function serializeBench(bench = [], unplaced = [], placedIds = new Set()) {
  const seen = new Set()
  const serializedBench = array(bench).map((player) => {
    const id = playerId(player)
    if (!id || placedIds.has(id) || seen.has(id)) return null
    seen.add(id)
    const state = player?.state === 'unplaced' || array(unplaced).some((item) => playerId(item) === id) ? 'unplaced' : 'bench'
    return serializeRosterPlayer(player, state)
  }).filter(Boolean)
  const serializedUnplaced = array(unplaced).map((player) => {
    const id = playerId(player)
    if (!id || placedIds.has(id) || seen.has(id)) return null
    seen.add(id)
    return serializeRosterPlayer(player, 'unplaced')
  }).filter(Boolean)
  return [...serializedBench, ...serializedUnplaced]
}

function draftUnplaced(draft, board) {
  if (Array.isArray(draft?.unplaced)) return draft.unplaced
  const draftPlayerIds = new Set([
    ...array(draft?.bench).map(playerId),
    ...array(draft?.placements).map(playerId),
  ].filter(Boolean))
  return array(board?.currentVersion?.unplaced).filter((player) => draftPlayerIds.has(playerId(player)))
}

function serializeDraftRoster(draft, board) {
  const placedIds = new Set(array(draft?.placements).map(playerId).filter(Boolean))
  return serializeBench(draft?.bench, draftUnplaced(draft, board), placedIds)
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key))
}

export function buildCoachFormationBoardCreatePayload(match, draft, title) {
  const matchDescription = match?.id ? `Match plan for ${match.teamName} v ${match.opponent}` : 'Standalone Team formation plan'
  return {
    bench_value: serializeDraftRoster(draft),
    description_value: matchDescription,
    game_format_value: draft.gameFormat,
    notes_value: normalize(draft?.notes),
    pitch_orientation_value: 'portrait',
    placements_value: array(draft.placements),
    preset_key_value: draft.presetKey,
    registry_version_value: draft.registryVersion || 1,
    title_value: normalize(title) || (match?.id ? `${match.teamName} v ${match.opponent}` : 'Formation Board'),
    visibility_value: 'draft',
  }
}

export function buildCoachFormationBoardSavePayload(board, draft, title) {
  const visibility = hasOwn(board, 'visibilityState')
    ? normalize(board.visibilityState) || null
    : null
  const description = hasOwn(board, 'description') ? normalize(board.description) : null
  return {
    bench_value: serializeDraftRoster(draft, board),
    description_value: description,
    expected_version_number: board.currentVersionNumber,
    game_format_value: draft.gameFormat,
    notes_value: normalize(board.currentVersion?.notes),
    pitch_orientation_value: 'portrait',
    placements_value: array(draft.placements),
    preset_key_value: draft.presetKey,
    registry_version_value: draft.registryVersion || 1,
    target_board_id: board.id,
    title_value: normalize(title) || board.title,
    version_reason_value: 'coach_mobile_save',
    visibility_value: visibility,
  }
}
