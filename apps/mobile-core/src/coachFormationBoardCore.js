export const MOBILE_FORMATION_GAME_FORMATS = Object.freeze([
  Object.freeze({ label: '5v5', playerCount: 5, value: '5v5' }),
  Object.freeze({ label: '7v7', playerCount: 7, value: '7v7' }),
  Object.freeze({ label: '9v9', playerCount: 9, value: '9v9' }),
  Object.freeze({ label: '11v11', playerCount: 11, value: '11v11' }),
])

const normalize = (value) => String(value ?? '').trim()
const coordinate = (value) => Math.max(0, Math.min(100, Number(value || 0)))

export function getMobileFormationCapacity(gameFormat) {
  return MOBILE_FORMATION_GAME_FORMATS.find((format) => format.value === normalize(gameFormat))?.playerCount || 0
}

export function createMobileFormationPreferenceKey({ clubId, teamId, userId }) {
  return ['fp.coach.formation.preferences.v1', normalize(userId), normalize(clubId), normalize(teamId)].join('.')
}

export function serializeMobileFormationPreferences({ gameFormat, presetKey }) {
  return JSON.stringify({
    gameFormat: normalize(gameFormat) || '11v11',
    presetKey: normalize(presetKey) || '11v11-4-4-2',
    version: 1,
  })
}

export function parseMobileFormationPreferences(value) {
  try {
    const parsed = JSON.parse(String(value || ''))
    if (parsed?.version !== 1) return null
    const gameFormat = normalize(parsed.gameFormat)
    const presetKey = normalize(parsed.presetKey)
    return gameFormat && presetKey ? { gameFormat, presetKey } : null
  } catch {
    return null
  }
}

export function normalizeMobileFormationPlayer(player = {}) {
  return {
    displayName: normalize(player.displayName ?? player.playerName) || 'Player',
    playerId: normalize(player.playerId ?? player.id),
    shirtNumber: normalize(player.shirtNumber),
  }
}

function normalizePlacement(player = {}) {
  return {
    ...normalizeMobileFormationPlayer(player),
    positionGroup: normalize(player.positionGroup),
    slotId: normalize(player.slotId),
    x: coordinate(player.x),
    y: coordinate(player.y),
  }
}

export function createMobileFormationDraft({ board = null, gameFormat = '11v11', presetKey = '11v11-4-4-2' } = {}) {
  const version = board?.currentVersion
  return {
    baseVersionNumber: Number(board?.currentVersionNumber || 0),
    bench: [
      ...(Array.isArray(version?.bench) ? version.bench : []),
      ...(Array.isArray(version?.unplaced) ? version.unplaced : []),
    ].map(normalizeMobileFormationPlayer).filter((player) => player.playerId),
    gameFormat: normalize(version?.gameFormat || board?.gameFormat || gameFormat) || '11v11',
    placements: (Array.isArray(version?.placements) ? version.placements : []).map(normalizePlacement).filter((player) => player.playerId),
    presetKey: normalize(version?.formationPresetKey || board?.formationPresetKey || presetKey) || '11v11-4-4-2',
    registryVersion: Number(version?.presetRegistryVersion || board?.presetRegistryVersion || 1),
  }
}

export function getMobileFormationSelectedPlayerIds(draft) {
  return new Set([
    ...(draft?.placements || []).map((player) => player.playerId),
    ...(draft?.bench || []).map((player) => player.playerId),
  ].filter(Boolean))
}

export function setMobileFormationSquad(draft, players = []) {
  const nextPlayers = players.map(normalizeMobileFormationPlayer).filter((player) => player.playerId)
  const allowed = new Set(nextPlayers.map((player) => player.playerId))
  const placements = (draft?.placements || []).filter((player) => allowed.has(player.playerId))
  const placed = new Set(placements.map((player) => player.playerId))
  return {
    ...draft,
    placements,
    bench: nextPlayers.filter((player) => !placed.has(player.playerId)),
  }
}

export function toggleMobileFormationSquadPlayer(draft, player) {
  const normalized = normalizeMobileFormationPlayer(player)
  if (!normalized.playerId) return draft
  const selected = getMobileFormationSelectedPlayerIds(draft)
  if (!selected.has(normalized.playerId)) return { ...draft, bench: [...draft.bench, normalized] }
  return {
    ...draft,
    bench: draft.bench.filter((item) => item.playerId !== normalized.playerId),
    placements: draft.placements.filter((item) => item.playerId !== normalized.playerId),
  }
}

export function applyMobileFormationPreset(draft, preset) {
  const slots = Array.isArray(preset?.slots) ? preset.slots : []
  const players = [...(draft?.placements || [])]
  const placementCount = Math.min(getMobileFormationCapacity(preset?.gameFormat), slots.length, players.length)
  return {
    ...draft,
    bench: [...(draft?.bench || []), ...players.slice(placementCount).map(normalizeMobileFormationPlayer)],
    gameFormat: normalize(preset?.gameFormat) || draft.gameFormat,
    placements: players.slice(0, placementCount).map((player, index) => ({
      ...normalizeMobileFormationPlayer(player),
      positionGroup: normalize(slots[index]?.group),
      slotId: normalize(slots[index]?.id),
      x: coordinate(slots[index]?.x),
      y: coordinate(slots[index]?.y),
    })),
    presetKey: normalize(preset?.key) || draft.presetKey,
    registryVersion: Number(preset?.registryVersion || draft.registryVersion || 1),
  }
}

export function placeMobileFormationLineup(draft, preset) {
  const slots = Array.isArray(preset?.slots) ? preset.slots : []
  const used = new Set((draft?.placements || []).map((player) => player.slotId).filter(Boolean))
  const openSlots = slots.filter((slot) => !used.has(normalize(slot.id)))
  const remainingCapacity = Math.max(0, getMobileFormationCapacity(draft?.gameFormat) - (draft?.placements || []).length)
  const additions = (draft?.bench || []).slice(0, Math.min(openSlots.length, remainingCapacity)).map((player, index) => ({
    ...normalizeMobileFormationPlayer(player),
    positionGroup: normalize(openSlots[index]?.group),
    slotId: normalize(openSlots[index]?.id),
    x: coordinate(openSlots[index]?.x),
    y: coordinate(openSlots[index]?.y),
  }))
  const placedIds = new Set(additions.map((player) => player.playerId))
  return {
    ...draft,
    bench: draft.bench.filter((player) => !placedIds.has(player.playerId)),
    placements: [...draft.placements, ...additions],
  }
}

export function placeMobileFormationPlayer(draft, playerId, slot) {
  const targetId = normalize(playerId)
  const player = draft?.bench?.find((item) => item.playerId === targetId)
  const occupied = draft?.placements?.some((item) => item.slotId === normalize(slot?.id))
  if (!player || !slot?.id || occupied || draft.placements.length >= getMobileFormationCapacity(draft.gameFormat)) return draft
  return {
    ...draft,
    bench: draft.bench.filter((item) => item.playerId !== targetId),
    placements: [...draft.placements, {
      ...normalizeMobileFormationPlayer(player),
      positionGroup: normalize(slot.group),
      slotId: normalize(slot.id),
      x: coordinate(slot.x),
      y: coordinate(slot.y),
    }],
  }
}

export function moveMobileFormationPlayersToBench(draft, playerIds = []) {
  const selected = new Set(playerIds.map(normalize).filter(Boolean))
  const removed = draft.placements.filter((player) => selected.has(player.playerId)).map(normalizeMobileFormationPlayer)
  if (!removed.length) return draft
  return {
    ...draft,
    bench: [...draft.bench, ...removed],
    placements: draft.placements.filter((player) => !selected.has(player.playerId)),
  }
}
