import {
  FORMATION_BOARD_CANONICAL_ORIENTATION,
  convertFormationPlacementsToPortrait,
  getFormationBoardOrientation,
  normalizeFormationCoordinate,
} from './formation-board-orientation.js'

const UNDO_LIMIT = 30

function normalizeText(value) {
  return String(value ?? '').trim()
}

export function clampFormationCoordinate(value) {
  return normalizeFormationCoordinate(value)
}

export function createFormationBoardDraftKey({ boardId = 'new', clubId, teamId, userId }) {
  return [
    'football-player:formation-board-draft:v1',
    normalizeText(userId),
    normalizeText(clubId),
    normalizeText(teamId),
    normalizeText(boardId) || 'new',
  ].join(':')
}

export function createEditorSnapshot({ board, preset }) {
  const version = board?.currentVersion
  const sourceOrientation = getFormationBoardOrientation(version?.pitchOrientation)
  const placements = Array.isArray(version?.placements) ? version.placements.map(normalizePlacement) : []
  const roster = [
    ...(Array.isArray(version?.bench) ? version.bench : []),
    ...(Array.isArray(version?.unplaced) ? version.unplaced.map((item) => ({ ...item, state: 'unplaced' })) : []),
  ]

  return {
    baseVersionNumber: Number(board?.currentVersionNumber ?? 0),
    bench: roster.filter((item) => item?.state !== 'unplaced').map(normalizeBenchPlayer),
    description: normalizeText(board?.description),
    gameFormat: normalizeText(version?.gameFormat || board?.gameFormat || preset?.gameFormat || '7v7'),
    notes: normalizeText(version?.notes),
    pitchOrientation: FORMATION_BOARD_CANONICAL_ORIENTATION,
    placements: convertFormationPlacementsToPortrait(placements, sourceOrientation),
    presetKey: normalizeText(version?.formationPresetKey || board?.formationPresetKey || preset?.key),
    registryVersion: Number(version?.presetRegistryVersion || board?.presetRegistryVersion || preset?.registryVersion || 1),
    title: normalizeText(board?.title),
    unplaced: roster.filter((item) => item?.state === 'unplaced').map(normalizeUnplacedPlayer),
    visibility: normalizeText(board?.visibilityState) || 'draft',
  }
}

export function createNewEditorSnapshot(preset) {
  return createEditorSnapshot({
    board: {
      currentVersionNumber: 0,
      formationPresetKey: preset?.key,
      gameFormat: preset?.gameFormat || '7v7',
      title: '',
      visibilityState: 'draft',
    },
    preset,
  })
}

function normalizePlacement(item) {
  return {
    displayName: normalizeText(item?.displayName),
    playerId: normalizeText(item?.playerId),
    positionGroup: normalizeText(item?.positionGroup),
    shirtNumber: normalizeText(item?.shirtNumber ?? item?.displayedShirtNumber),
    slotId: normalizeText(item?.slotId),
    x: clampFormationCoordinate(item?.x),
    y: clampFormationCoordinate(item?.y),
  }
}

function normalizeBenchPlayer(item) {
  return {
    displayName: normalizeText(item?.displayName),
    playerId: normalizeText(item?.playerId),
    shirtNumber: normalizeText(item?.shirtNumber ?? item?.displayedShirtNumber),
    state: 'bench',
  }
}

function normalizeUnplacedPlayer(item) {
  return {
    displayName: normalizeText(item?.displayName),
    playerId: normalizeText(item?.playerId),
    shirtNumber: normalizeText(item?.shirtNumber ?? item?.displayedShirtNumber),
    state: 'unplaced',
  }
}

export function createFormationPlayer(player) {
  return {
    displayName: normalizeText(player?.displayName || player?.playerName),
    playerId: normalizeText(player?.playerId || player?.id),
    shirtNumber: normalizeText(player?.shirtNumber),
  }
}

export function isPlayerAssigned(snapshot, playerId) {
  const targetId = normalizeText(playerId)

  return (snapshot.placements ?? []).some((item) => item.playerId === targetId)
    || (snapshot.bench ?? []).some((item) => item.playerId === targetId)
    || (snapshot.unplaced ?? []).some((item) => item.playerId === targetId)
}

export function getFormationPlayerState(snapshot, playerId) {
  const targetId = normalizeText(playerId)

  if ((snapshot.placements ?? []).some((item) => item.playerId === targetId)) return 'pitch'
  if ((snapshot.bench ?? []).some((item) => item.playerId === targetId)) return 'bench'
  if ((snapshot.unplaced ?? []).some((item) => item.playerId === targetId)) return 'unplaced'
  return 'available'
}

export function addPlayersToUnplaced(snapshot, players) {
  const seen = new Set()
  const additions = []

  for (const player of Array.isArray(players) ? players : []) {
    const formationPlayer = createFormationPlayer(player)

    if (!formationPlayer.playerId
      || seen.has(formationPlayer.playerId)
      || isPlayerAssigned(snapshot, formationPlayer.playerId)) {
      continue
    }

    seen.add(formationPlayer.playerId)
    additions.push(normalizeUnplacedPlayer(formationPlayer))
  }

  if (additions.length === 0) return snapshot

  return {
    ...snapshot,
    unplaced: [...(snapshot.unplaced ?? []), ...additions],
  }
}

export function assignPlayerToPitch(snapshot, player, coordinates, slot = null) {
  const formationPlayer = createFormationPlayer(player)

  if (!formationPlayer.playerId || isPlayerAssigned(snapshot, formationPlayer.playerId)) {
    return snapshot
  }

  return {
    ...snapshot,
    placements: [
      ...snapshot.placements,
      {
        ...formationPlayer,
        positionGroup: normalizeText(slot?.group),
        slotId: normalizeText(slot?.id),
        x: clampFormationCoordinate(coordinates?.x ?? slot?.x),
        y: clampFormationCoordinate(coordinates?.y ?? slot?.y),
      },
    ],
  }
}

export function replaceFormationPlayer(snapshot, targetPlayerId, player) {
  const formationPlayer = createFormationPlayer(player)

  if (!formationPlayer.playerId || isPlayerAssigned(snapshot, formationPlayer.playerId)) {
    return snapshot
  }

  return {
    ...snapshot,
    placements: snapshot.placements.map((item) => (
      item.playerId === normalizeText(targetPlayerId)
        ? { ...item, ...formationPlayer }
        : item
    )),
  }
}

export function moveFormationPlayer(snapshot, playerId, coordinates) {
  return {
    ...snapshot,
    placements: snapshot.placements.map((item) => (
      item.playerId === normalizeText(playerId)
        ? {
            ...item,
            slotId: '',
            x: clampFormationCoordinate(coordinates?.x),
            y: clampFormationCoordinate(coordinates?.y),
          }
        : item
    )),
  }
}

export function benchFormationPlayer(snapshot, playerId) {
  const targetId = normalizeText(playerId)
  const placement = snapshot.placements.find((item) => item.playerId === targetId)

  if (!placement) {
    return snapshot
  }

  return {
    ...snapshot,
    bench: [...snapshot.bench, normalizeBenchPlayer(placement)],
    placements: snapshot.placements.filter((item) => item.playerId !== targetId),
  }
}

export function movePitchPlayerToUnplaced(snapshot, playerId) {
  const targetId = normalizeText(playerId)
  const placement = snapshot.placements.find((item) => item.playerId === targetId)

  if (!placement) return snapshot

  return {
    ...snapshot,
    placements: snapshot.placements.filter((item) => item.playerId !== targetId),
    unplaced: [...snapshot.unplaced, normalizeUnplacedPlayer(placement)],
  }
}

export function moveBenchPlayerToPitch(snapshot, playerId, coordinates, slot = null) {
  const targetId = normalizeText(playerId)
  const player = snapshot.bench.find((item) => item.playerId === targetId)

  if (!player) {
    return snapshot
  }

  return {
    ...snapshot,
    bench: snapshot.bench.filter((item) => item.playerId !== targetId),
    placements: [
      ...snapshot.placements,
      {
        ...player,
        positionGroup: normalizeText(slot?.group),
        slotId: normalizeText(slot?.id),
        x: clampFormationCoordinate(coordinates?.x ?? slot?.x),
        y: clampFormationCoordinate(coordinates?.y ?? slot?.y),
      },
    ],
  }
}

export function moveBenchPlayerToUnplaced(snapshot, playerId) {
  const targetId = normalizeText(playerId)
  const player = snapshot.bench.find((item) => item.playerId === targetId)

  if (!player) return snapshot

  return {
    ...snapshot,
    bench: snapshot.bench.filter((item) => item.playerId !== targetId),
    unplaced: [...snapshot.unplaced, normalizeUnplacedPlayer(player)],
  }
}

export function moveUnplacedPlayerToPitch(snapshot, playerId, coordinates, slot = null) {
  const targetId = normalizeText(playerId)
  const player = snapshot.unplaced.find((item) => item.playerId === targetId)

  if (!player) return snapshot

  return {
    ...snapshot,
    placements: [
      ...snapshot.placements,
      {
        displayName: player.displayName,
        playerId: player.playerId,
        positionGroup: normalizeText(slot?.group),
        shirtNumber: player.shirtNumber,
        slotId: normalizeText(slot?.id),
        x: clampFormationCoordinate(coordinates?.x ?? slot?.x),
        y: clampFormationCoordinate(coordinates?.y ?? slot?.y),
      },
    ],
    unplaced: snapshot.unplaced.filter((item) => item.playerId !== targetId),
  }
}

export function moveUnplacedPlayerToBench(snapshot, playerId) {
  const targetId = normalizeText(playerId)
  const player = snapshot.unplaced.find((item) => item.playerId === targetId)

  if (!player) return snapshot

  return {
    ...snapshot,
    bench: [...snapshot.bench, normalizeBenchPlayer(player)],
    unplaced: snapshot.unplaced.filter((item) => item.playerId !== targetId),
  }
}

export function addPlayerToBench(snapshot, player) {
  const formationPlayer = createFormationPlayer(player)

  if (!formationPlayer.playerId || isPlayerAssigned(snapshot, formationPlayer.playerId)) {
    return snapshot
  }

  return {
    ...snapshot,
    bench: [...snapshot.bench, formationPlayer],
  }
}

export function removeFormationPlayer(snapshot, playerId) {
  const targetId = normalizeText(playerId)

  return {
    ...snapshot,
    bench: snapshot.bench.filter((item) => item.playerId !== targetId),
    placements: snapshot.placements.filter((item) => item.playerId !== targetId),
    unplaced: snapshot.unplaced.filter((item) => item.playerId !== targetId),
  }
}

export function updateFormationPlayerNumber(snapshot, playerId, shirtNumber) {
  const targetId = normalizeText(playerId)
  const normalizedNumber = normalizeText(shirtNumber)

  return {
    ...snapshot,
    bench: snapshot.bench.map((item) => item.playerId === targetId ? { ...item, shirtNumber: normalizedNumber } : item),
    placements: snapshot.placements.map((item) => item.playerId === targetId ? { ...item, shirtNumber: normalizedNumber } : item),
    unplaced: snapshot.unplaced.map((item) => item.playerId === targetId ? { ...item, shirtNumber: normalizedNumber } : item),
  }
}

export function applyFormationPreset(snapshot, nextPreset) {
  if (nextPreset.key.endsWith('-custom')) {
    const placementLimit = Number(nextPreset.playerCount || 0)
    const keptPlacements = snapshot.placements.slice(0, placementLimit)
    const overflowUnplaced = snapshot.placements.slice(placementLimit).map(normalizeUnplacedPlayer)

    return {
      ...snapshot,
      gameFormat: nextPreset.gameFormat,
      placements: keptPlacements,
      presetKey: nextPreset.key,
      registryVersion: Number(nextPreset.registryVersion || 1),
      unplaced: [...snapshot.unplaced, ...overflowUnplaced],
    }
  }

  const availableSlots = [...(nextPreset?.slots ?? [])]
  const unmatchedPlayers = []
  const nextPlacements = []
  const orderedPlayers = [
    ...snapshot.placements.filter((item) => item.positionGroup === 'goalkeeper'),
    ...snapshot.placements.filter((item) => item.positionGroup !== 'goalkeeper'),
  ]

  for (const player of orderedPlayers) {
    const sameGroupIndex = availableSlots.findIndex((slot) => slot.group === player.positionGroup)
    const slotIndex = sameGroupIndex >= 0 ? sameGroupIndex : (availableSlots.length > 0 ? 0 : -1)

    if (slotIndex < 0) {
      unmatchedPlayers.push(normalizeUnplacedPlayer(player))
      continue
    }

    const [slot] = availableSlots.splice(slotIndex, 1)
    nextPlacements.push({
      ...player,
      positionGroup: normalizeText(slot.group),
      slotId: normalizeText(slot.id),
      x: clampFormationCoordinate(slot.x),
      y: clampFormationCoordinate(slot.y),
    })
  }

  return {
    ...snapshot,
    gameFormat: nextPreset.gameFormat,
    placements: nextPlacements,
    presetKey: nextPreset.key,
    registryVersion: Number(nextPreset.registryVersion || 1),
    unplaced: [...snapshot.unplaced, ...unmatchedPlayers],
  }
}

export function getFirstAvailablePresetSlot(snapshot, preset) {
  const usedSlotIds = new Set(snapshot.placements.map((item) => item.slotId).filter(Boolean))
  return (preset?.slots ?? []).find((slot) => !usedSlotIds.has(slot.id)) || null
}

export function pushFormationHistory(history, snapshot) {
  return [...history, snapshot].slice(-UNDO_LIMIT)
}

export function serializeFormationDraft(snapshot, boardId) {
  return JSON.stringify({
    boardId: normalizeText(boardId) || 'new',
    savedAt: new Date().toISOString(),
    snapshot,
    version: 2,
  })
}

export function parseFormationDraft(value) {
  try {
    const parsed = JSON.parse(value)

    if (![1, 2].includes(parsed?.version) || !parsed?.snapshot) {
      return null
    }

    return {
      ...parsed,
      snapshot: {
        ...parsed.snapshot,
        bench: Array.isArray(parsed.snapshot.bench) ? parsed.snapshot.bench.map(normalizeBenchPlayer) : [],
        placements: Array.isArray(parsed.snapshot.placements) ? parsed.snapshot.placements.map(normalizePlacement) : [],
        pitchOrientation: FORMATION_BOARD_CANONICAL_ORIENTATION,
        unplaced: Array.isArray(parsed.snapshot.unplaced) ? parsed.snapshot.unplaced.map(normalizeUnplacedPlayer) : [],
      },
    }
  } catch {
    return null
  }
}

export function snapshotsMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}
