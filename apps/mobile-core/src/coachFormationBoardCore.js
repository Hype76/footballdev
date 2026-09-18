export const MOBILE_FORMATION_GAME_FORMATS = Object.freeze([
  Object.freeze({ label: '5v5', playerCount: 5, value: '5v5' }),
  Object.freeze({ label: '7v7', playerCount: 7, value: '7v7' }),
  Object.freeze({ label: '9v9', playerCount: 9, value: '9v9' }),
  Object.freeze({ label: '11v11', playerCount: 11, value: '11v11' }),
])

const normalize = (value) => String(value ?? '').trim()
const coordinate = (value) => Math.max(0, Math.min(100, Number(value || 0)))

export function getMobileFormationPitchPercent(value) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  const converted = numeric >= 0 && numeric <= 1 ? Number((numeric * 100).toFixed(4)) : numeric
  return Math.max(0, Math.min(100, converted))
}

export function getMobileFormationPitchRatio(value) {
  return Number((getMobileFormationPitchPercent(value) / 100).toFixed(4))
}

export function getMobileFormationCapacity(gameFormat) {
  return MOBILE_FORMATION_GAME_FORMATS.find((format) => format.value === normalize(gameFormat))?.playerCount || 0
}

const CUSTOM_FORMATION_ROWS = Object.freeze({
  '5v5': Object.freeze([2, 2]),
  '7v7': Object.freeze([3, 2, 1]),
  '9v9': Object.freeze([3, 3, 2]),
  '11v11': Object.freeze([4, 4, 2]),
})

function isCustomMobileFormationPreset(preset) {
  const key = normalize(preset?.key).toLowerCase()
  const name = normalize(preset?.displayName ?? preset?.name).toLowerCase()
  return key.endsWith('-custom') || key === 'custom' || name === 'custom'
}

export function getMobileFormationPresetSlots(preset) {
  const existingSlots = Array.isArray(preset?.slots) ? preset.slots : []
  if (existingSlots.length || !isCustomMobileFormationPreset(preset)) return existingSlots

  const gameFormat = normalize(preset?.gameFormat)
  const capacity = getMobileFormationCapacity(gameFormat)
  const rows = CUSTOM_FORMATION_ROWS[gameFormat]
  if (!capacity || !rows) return []

  const slots = [{ group: 'goalkeeper', id: 'custom-1', x: 0.5, y: 0.92 }]
  let slotNumber = 2
  rows.forEach((rowSize, rowIndex) => {
    const yPositions = [0.72, 0.48, 0.24]
    Array.from({ length: rowSize }, (_, index) => {
      slots.push({
        group: 'custom',
        id: `custom-${slotNumber}`,
        x: Number(((index + 1) / (rowSize + 1)).toFixed(4)),
        y: yPositions[rowIndex],
      })
      slotNumber += 1
    })
  })
  return slots.slice(0, capacity)
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

function formationPlayerId(player) {
  return normalize(player?.playerId ?? player?.id)
}

function normalizeUnplacedFormationPlayer(player) {
  return { ...normalizeMobileFormationPlayer(player), state: 'unplaced' }
}

function getDraftUnplacedPlayers(draft) {
  if (Array.isArray(draft?.unplaced)) return draft.unplaced
  return (Array.isArray(draft?.bench) ? draft.bench : []).filter((player) => player?.state === 'unplaced')
}

function updateDraftRoster(draft, { bench = [], placements = [], clearUnplacedIds = [] } = {}) {
  const nextBench = Array.isArray(bench) ? bench : []
  const nextPlacements = Array.isArray(placements) ? placements : []
  const clearIds = new Set(clearUnplacedIds.map(normalize).filter(Boolean))
  const placementIds = new Set(nextPlacements.map(formationPlayerId).filter(Boolean))
  const benchIds = new Set(nextBench.map(formationPlayerId).filter(Boolean))
  const nextUnplaced = getDraftUnplacedPlayers(draft)
    .filter((player) => {
      const id = formationPlayerId(player)
      return id && !clearIds.has(id) && benchIds.has(id) && !placementIds.has(id)
    })
    .map(normalizeUnplacedFormationPlayer)
  const unplacedIds = new Set(nextUnplaced.map(formationPlayerId))
  return {
    ...draft,
    bench: nextBench.map((player) => {
      if (unplacedIds.has(formationPlayerId(player))) return { ...player, state: 'unplaced' }
      if (player?.state !== 'unplaced') return player
      const normalBenchPlayer = { ...player }
      delete normalBenchPlayer.state
      return normalBenchPlayer
    }),
    placements: nextPlacements,
    unplaced: nextUnplaced,
  }
}

function normalizePlacement(player = {}) {
  const slotId = normalize(player.slotId)
  return {
    ...normalizeMobileFormationPlayer(player),
    positionGroup: normalize(player.positionGroup) || (slotId.toLowerCase() === 'gk' ? 'goalkeeper' : ''),
    slotId,
    x: coordinate(player.x),
    y: coordinate(player.y),
  }
}

function isGoalkeeperGroup(value) {
  return ['goalkeeper', 'keeper', 'gk'].includes(normalize(value).toLowerCase())
}

function isCompatibleFormationGroup(playerGroup, slotGroup) {
  const playerValue = normalize(playerGroup).toLowerCase()
  const slotValue = normalize(slotGroup).toLowerCase()
  if (isGoalkeeperGroup(playerValue) || isGoalkeeperGroup(slotValue)) return isGoalkeeperGroup(playerValue) && isGoalkeeperGroup(slotValue)
  if (!playerValue || !slotValue || slotValue === 'custom' || playerValue === 'custom') return true
  if (playerValue === slotValue) return true
  const aliases = {
    defence: 'defender',
    defenders: 'defender',
    back: 'defender',
    backs: 'defender',
    midfield: 'midfielder',
    midfielders: 'midfielder',
    centreback: 'defender',
    centerback: 'defender',
    forward: 'attacker',
    forwards: 'attacker',
    striker: 'attacker',
    strikers: 'attacker',
    attack: 'attacker',
  }
  return (aliases[playerValue] || playerValue) === (aliases[slotValue] || slotValue)
}

function formationDistance(player, slot) {
  const playerX = getMobileFormationPitchPercent(player?.x)
  const playerY = getMobileFormationPitchPercent(player?.y)
  const slotX = getMobileFormationPitchPercent(slot?.x)
  const slotY = getMobileFormationPitchPercent(slot?.y)
  return ((playerX - slotX) ** 2) + ((playerY - slotY) ** 2)
}

function takeBestFormationPlayer(players, predicate, slot) {
  const candidates = players.filter(predicate)
  if (!candidates.length) return null
  return candidates.reduce((best, player) => {
    if (!best) return player
    const distance = formationDistance(player, slot)
    const bestDistance = formationDistance(best, slot)
    return distance < bestDistance ? player : best
  }, null)
}

export function createMobileFormationDraft({ board = null, gameFormat = '11v11', presetKey = '11v11-4-4-2' } = {}) {
  const version = board?.currentVersion
  const existingBench = (Array.isArray(version?.bench) ? version.bench : []).filter((player) => player?.state !== 'unplaced')
  const existingUnplaced = [
    ...(Array.isArray(version?.unplaced) ? version.unplaced : []),
    ...(Array.isArray(version?.bench) ? version.bench.filter((player) => player?.state === 'unplaced') : []),
  ]
  const unplacedById = new Map()
  existingUnplaced.forEach((player) => {
    const id = formationPlayerId(player)
    if (id && !unplacedById.has(id)) unplacedById.set(id, normalizeUnplacedFormationPlayer(player))
  })
  const unplaced = [...unplacedById.values()]
  return {
    baseVersionNumber: Number(board?.currentVersionNumber || 0),
    bench: [
      ...existingBench.map(normalizeMobileFormationPlayer),
      ...unplaced,
    ].filter((player) => player.playerId),
    gameFormat: normalize(version?.gameFormat || board?.gameFormat || gameFormat) || '11v11',
    placements: (Array.isArray(version?.placements) ? version.placements : []).map(normalizePlacement).filter((player) => player.playerId),
    presetKey: normalize(version?.formationPresetKey || board?.formationPresetKey || presetKey) || '11v11-4-4-2',
    registryVersion: Number(version?.presetRegistryVersion || board?.presetRegistryVersion || 1),
    unplaced,
  }
}

export function getMobileFormationSelectedPlayerIds(draft) {
  return new Set([
    ...(draft?.placements || []).map((player) => player.playerId),
    ...(draft?.bench || []).map((player) => player.playerId),
  ].filter(Boolean))
}

export function getMobileFormationPlayerAvailability(playerId, availabilityRows = []) {
  const row = (Array.isArray(availabilityRows) ? availabilityRows : []).find((item) => (
    normalize(item?.playerId ?? item?.player_id) === normalize(playerId)
  ))
  const status = normalize(row?.status).toLowerCase()
  if (status === 'available') return Object.freeze({ label: 'Available', status })
  if (status === 'unavailable') return Object.freeze({ label: 'Unavailable', status })
  if (status === 'maybe') return Object.freeze({ label: 'Maybe', status })
  return Object.freeze({ label: 'Awaiting response', status: 'pending' })
}

export function getMobileAvailableFormationPlayers(players = [], availabilityRows = []) {
  return (Array.isArray(players) ? players : []).filter((player) => (
    getMobileFormationPlayerAvailability(player?.id ?? player?.playerId, availabilityRows).status === 'available'
  ))
}

export function setMobileFormationSquad(draft, players = []) {
  const nextPlayers = players.map(normalizeMobileFormationPlayer).filter((player) => player.playerId)
  const allowed = new Set(nextPlayers.map((player) => player.playerId))
  const placements = (draft?.placements || []).filter((player) => allowed.has(player.playerId))
  const placed = new Set(placements.map((player) => player.playerId))
  return updateDraftRoster(draft, {
    placements,
    bench: nextPlayers.filter((player) => !placed.has(player.playerId)),
  })
}

export function toggleMobileFormationSquadPlayer(draft, player) {
  const normalized = normalizeMobileFormationPlayer(player)
  if (!normalized.playerId) return draft
  const selected = getMobileFormationSelectedPlayerIds(draft)
  if (!selected.has(normalized.playerId)) return updateDraftRoster(draft, {
    bench: [...draft.bench, normalized],
    placements: draft.placements,
  })
  return updateDraftRoster(draft, {
    bench: draft.bench.filter((item) => item.playerId !== normalized.playerId),
    placements: draft.placements.filter((item) => item.playerId !== normalized.playerId),
    clearUnplacedIds: [normalized.playerId],
  })
}

export function applyMobileFormationPreset(draft, preset) {
  const slots = getMobileFormationPresetSlots(preset)
  const players = [...(draft?.placements || [])].map(normalizePlacement).filter((player) => player.playerId)
  const placementCount = Math.min(getMobileFormationCapacity(preset?.gameFormat), slots.length, players.length)
  const goalkeeperSlots = slots.filter((slot) => isGoalkeeperGroup(slot?.group))
  const assignments = new Map()
  const usedPlayers = new Set()
  const assign = (slot, player) => {
    if (!slot || !player || usedPlayers.has(player.playerId)) return
    assignments.set(normalize(slot.id), player)
    usedPlayers.add(player.playerId)
  }

  goalkeeperSlots.forEach((slot) => {
    assign(slot, takeBestFormationPlayer(players, (player) => isGoalkeeperGroup(player.positionGroup), slot))
  })
  slots.forEach((slot) => {
    if (assignments.has(normalize(slot.id))) return
    assign(slot, takeBestFormationPlayer(players, (player) => !usedPlayers.has(player.playerId)
      && normalize(player.slotId) === normalize(slot.id)
      && isCompatibleFormationGroup(player.positionGroup, slot.group), slot))
  })
  slots.forEach((slot) => {
    if (assignments.has(normalize(slot.id))) return
    assign(slot, takeBestFormationPlayer(players, (player) => !usedPlayers.has(player.playerId) && isCompatibleFormationGroup(player.positionGroup, slot.group), slot))
  })
  slots.forEach((slot) => {
    if (assignments.has(normalize(slot.id)) || assignments.size >= placementCount) return
    assign(slot, takeBestFormationPlayer(players, (player) => !usedPlayers.has(player.playerId) && (goalkeeperSlots.length === 0 || !isGoalkeeperGroup(player.positionGroup)), slot))
  })
  const assignedSlots = slots.filter((slot) => assignments.has(normalize(slot.id)))
  const selectedSlots = [
    ...assignedSlots.filter((slot) => isGoalkeeperGroup(slot?.group)),
    ...assignedSlots.filter((slot) => !isGoalkeeperGroup(slot?.group)),
  ].slice(0, placementCount)
  const selectedPlayerIds = new Set(selectedSlots.map((slot) => assignments.get(normalize(slot.id))?.playerId).filter(Boolean))
  const nextPlayers = selectedSlots.map((slot) => assignments.get(normalize(slot.id)))
  const nextDraft = updateDraftRoster(draft, {
    bench: [
      ...(draft?.bench || []),
      ...players.filter((player) => !selectedPlayerIds.has(player.playerId)).map(normalizeMobileFormationPlayer),
    ],
    clearUnplacedIds: players.filter((player) => !selectedPlayerIds.has(player.playerId)).map(formationPlayerId),
    placements: nextPlayers.map((player) => {
      const slot = selectedSlots.find((item) => assignments.get(normalize(item?.id))?.playerId === player.playerId)
      return {
        ...player,
        positionGroup: normalize(slot?.group),
        slotId: normalize(slot?.id),
        x: coordinate(slot?.x),
        y: coordinate(slot?.y),
      }
    }),
  })
  return {
    ...nextDraft,
    gameFormat: normalize(preset?.gameFormat) || draft.gameFormat,
    presetKey: normalize(preset?.key) || draft.presetKey,
    registryVersion: Number(preset?.registryVersion || draft.registryVersion || 1),
  }
}

export function placeMobileFormationLineup(draft, preset) {
  const slots = getMobileFormationPresetSlots(preset)
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
  return updateDraftRoster(draft, {
    bench: draft.bench.filter((player) => !placedIds.has(player.playerId)),
    placements: [...draft.placements, ...additions],
    clearUnplacedIds: [...placedIds],
  })
}

export function buildMobileFormationLineup(draft, preset) {
  const slots = getMobileFormationPresetSlots(preset)
  const capacity = Math.min(getMobileFormationCapacity(preset?.gameFormat || draft?.gameFormat), slots.length)
  const seen = new Set()
  const players = [...(draft?.placements || []), ...(draft?.bench || [])]
    .map(normalizeMobileFormationPlayer)
    .filter((player) => {
      if (!player.playerId || seen.has(player.playerId)) return false
      seen.add(player.playerId)
      return true
    })
  const nextDraft = updateDraftRoster(draft, {
    bench: players.slice(capacity),
    placements: players.slice(0, capacity).map((player, index) => ({
      ...player,
      positionGroup: normalize(slots[index]?.group),
      slotId: normalize(slots[index]?.id),
      x: coordinate(slots[index]?.x),
      y: coordinate(slots[index]?.y),
    })),
    clearUnplacedIds: players.slice(0, capacity).map(formationPlayerId),
  })
  return {
    ...nextDraft,
    gameFormat: normalize(preset?.gameFormat) || draft.gameFormat,
    presetKey: normalize(preset?.key) || draft.presetKey,
    registryVersion: Number(preset?.registryVersion || draft.registryVersion || 1),
  }
}

export function placeMobileFormationPlayer(draft, playerId, slot) {
  const targetId = normalize(playerId)
  const player = draft?.bench?.find((item) => item.playerId === targetId)
  const occupied = draft?.placements?.some((item) => item.slotId === normalize(slot?.id))
  if (!player || !slot?.id || occupied || draft.placements.length >= getMobileFormationCapacity(draft.gameFormat)) return draft
  return updateDraftRoster(draft, {
    bench: draft.bench.filter((item) => item.playerId !== targetId),
    placements: [...draft.placements, {
      ...normalizeMobileFormationPlayer(player),
      positionGroup: normalize(slot.group),
      slotId: normalize(slot.id),
      x: coordinate(slot.x),
      y: coordinate(slot.y),
    }],
    clearUnplacedIds: [targetId],
  })
}

function mobileSlotPlacement(player, slot) {
  return {
    ...normalizeMobileFormationPlayer(player),
    positionGroup: normalize(slot?.group),
    slotId: normalize(slot?.id),
    x: coordinate(slot?.x),
    y: coordinate(slot?.y),
  }
}

export function assignMobileFormationPlayerToSlot(draft, player, slot) {
  const normalizedPlayer = normalizeMobileFormationPlayer(player)
  const slotId = normalize(slot?.id)
  if (!normalizedPlayer.playerId || !slotId) return draft

  const sourcePlacement = (draft?.placements || []).find((item) => item.playerId === normalizedPlayer.playerId) || null
  const targetPlacement = (draft?.placements || []).find((item) => item.slotId === slotId) || null
  if (sourcePlacement?.slotId === slotId) return draft

  const placements = (draft?.placements || []).filter((item) => (
    item.playerId !== normalizedPlayer.playerId && item.playerId !== targetPlacement?.playerId
  ))
  const bench = (draft?.bench || []).filter((item) => (
    item.playerId !== normalizedPlayer.playerId && item.playerId !== targetPlacement?.playerId
  ))

  placements.push(mobileSlotPlacement(normalizedPlayer, slot))
  if (targetPlacement && sourcePlacement) {
    placements.push({
      ...targetPlacement,
      positionGroup: sourcePlacement.positionGroup,
      slotId: sourcePlacement.slotId,
      x: sourcePlacement.x,
      y: sourcePlacement.y,
    })
  } else if (targetPlacement) {
    bench.push(normalizeMobileFormationPlayer(targetPlacement))
  }

  return updateDraftRoster(draft, {
    bench,
    placements,
    clearUnplacedIds: [normalizedPlayer.playerId],
  })
}

export function getMobileFormationSlotLabel(slot) {
  const slotId = normalize(slot?.id)
  const customPosition = slotId.match(/^custom-(\d+)$/)
  if (customPosition) return customPosition[1] === '1' ? 'Goalkeeper' : `Position ${customPosition[1]}`
  const labels = {
    'def-centre': 'Centre back',
    'def-left': 'Left back',
    'def-left-centre': 'Left centre back',
    'def-right': 'Right back',
    'def-right-centre': 'Right centre back',
    'def-wing-left': 'Left wing back',
    'def-wing-right': 'Right wing back',
    forward: 'Striker',
    'forward-centre': 'Centre forward',
    'forward-left': 'Left forward',
    'forward-right': 'Right forward',
    gk: 'Goalkeeper',
    mid: 'Midfielder',
    'mid-centre': 'Centre midfield',
    'mid-hold': 'Holding midfield',
    'mid-hold-left': 'Left holding midfield',
    'mid-hold-right': 'Right holding midfield',
    'mid-left': 'Left midfield',
    'mid-left-centre': 'Left centre midfield',
    'mid-right': 'Right midfield',
    'mid-right-centre': 'Right centre midfield',
    'mid-wing-left': 'Left wing',
    'mid-wing-right': 'Right wing',
  }

  if (labels[slotId]) return labels[slotId]
  return {
    defender: 'Defender',
    forward: 'Forward',
    goalkeeper: 'Goalkeeper',
    midfielder: 'Midfielder',
  }[normalize(slot?.group)] || 'Position'
}

export function getMobileFormationSlotShortLabel(slot) {
  const slotId = normalize(slot?.id)
  const customPosition = slotId.match(/^custom-(\d+)$/)
  if (customPosition) return customPosition[1] === '1' ? 'GK' : `P${customPosition[1]}`
  const labels = {
    'def-centre': 'CB',
    'def-left': 'LB',
    'def-left-centre': 'LCB',
    'def-right': 'RB',
    'def-right-centre': 'RCB',
    'def-wing-left': 'LWB',
    'def-wing-right': 'RWB',
    forward: 'ST',
    'forward-centre': 'CF',
    'forward-left': 'LF',
    'forward-right': 'RF',
    gk: 'GK',
    mid: 'CM',
    'mid-centre': 'CM',
    'mid-hold': 'DM',
    'mid-hold-left': 'LDM',
    'mid-hold-right': 'RDM',
    'mid-left': 'LM',
    'mid-left-centre': 'LCM',
    'mid-right': 'RM',
    'mid-right-centre': 'RCM',
    'mid-wing-left': 'LW',
    'mid-wing-right': 'RW',
  }

  if (labels[slotId]) return labels[slotId]
  return {
    defender: 'DEF',
    forward: 'FWD',
    goalkeeper: 'GK',
    midfielder: 'MID',
  }[normalize(slot?.group)] || 'POS'
}

export function moveMobileFormationPlayersToBench(draft, playerIds = []) {
  const selected = new Set(playerIds.map(normalize).filter(Boolean))
  const removed = draft.placements.filter((player) => selected.has(player.playerId)).map(normalizeMobileFormationPlayer)
  if (!removed.length) return draft
  return updateDraftRoster(draft, {
    bench: [...draft.bench, ...removed],
    placements: draft.placements.filter((player) => !selected.has(player.playerId)),
    clearUnplacedIds: [...selected],
  })
}

export function moveMobileFormationPlayer(draft, playerId, coordinates = {}) {
  const targetId = normalize(playerId)
  const placementIndex = (draft?.placements || []).findIndex((player) => player.playerId === targetId)
  if (!targetId || placementIndex < 0) return draft

  const placements = [...draft.placements]
  placements[placementIndex] = {
    ...placements[placementIndex],
    x: Math.max(0.04, Math.min(0.96, getMobileFormationPitchRatio(coordinates.x))),
    y: Math.max(0.04, Math.min(0.96, getMobileFormationPitchRatio(coordinates.y))),
  }
  return { ...draft, placements }
}

export function placeMobileFormationPlayerInNextSlot(draft, preset, playerId) {
  const used = new Set((draft?.placements || []).map((player) => normalize(player.slotId)).filter(Boolean))
  const nextSlot = getMobileFormationPresetSlots(preset).find((slot) => !used.has(normalize(slot?.id)))
  return nextSlot ? placeMobileFormationPlayer(draft, playerId, nextSlot) : draft
}

export function swapMobileFormationPlayers(draft, firstPlayerId, secondPlayerId) {
  const firstId = normalize(firstPlayerId)
  const secondId = normalize(secondPlayerId)
  if (!firstId || !secondId || firstId === secondId) return draft

  const placements = [...(draft?.placements || [])]
  const bench = [...(draft?.bench || [])]
  const firstPlacementIndex = placements.findIndex((player) => player.playerId === firstId)
  const secondPlacementIndex = placements.findIndex((player) => player.playerId === secondId)
  const firstBenchIndex = bench.findIndex((player) => player.playerId === firstId)
  const secondBenchIndex = bench.findIndex((player) => player.playerId === secondId)

  if (firstPlacementIndex >= 0 && secondPlacementIndex >= 0) {
    const first = placements[firstPlacementIndex]
    const second = placements[secondPlacementIndex]
    placements[firstPlacementIndex] = { ...first, positionGroup: second.positionGroup, slotId: second.slotId, x: second.x, y: second.y }
    placements[secondPlacementIndex] = { ...second, positionGroup: first.positionGroup, slotId: first.slotId, x: first.x, y: first.y }
    return { ...draft, placements }
  }

  const placedIndex = firstPlacementIndex >= 0 ? firstPlacementIndex : secondPlacementIndex
  const benchIndex = firstBenchIndex >= 0 ? firstBenchIndex : secondBenchIndex
  if (placedIndex < 0 || benchIndex < 0) return draft

  const placed = placements[placedIndex]
  const substitute = bench[benchIndex]
  placements[placedIndex] = {
    ...normalizeMobileFormationPlayer(substitute),
    positionGroup: placed.positionGroup,
    slotId: placed.slotId,
    x: placed.x,
    y: placed.y,
  }
  bench[benchIndex] = normalizeMobileFormationPlayer(placed)
  return updateDraftRoster(draft, {
    bench,
    placements,
    clearUnplacedIds: [firstId, secondId],
  })
}
