export const FORMATION_BOARD_GAME_FORMATS = Object.freeze([
  { label: '5v5', playerCount: 5, value: '5v5' },
  { label: '7v7', playerCount: 7, value: '7v7' },
  { label: '9v9', playerCount: 9, value: '9v9' },
  { label: '11v11', playerCount: 11, value: '11v11' },
])

export function getFormationBoardPlayerCapacity(gameFormat) {
  return FORMATION_BOARD_GAME_FORMATS.find((format) => format.value === String(gameFormat ?? '').trim())?.playerCount ?? 0
}

export function getFormationBoardCapacityMessage(gameFormat) {
  const normalizedFormat = String(gameFormat ?? '').trim()
  const capacity = getFormationBoardPlayerCapacity(normalizedFormat)

  return capacity > 0
    ? `This ${normalizedFormat} pitch already has ${capacity} Players. Move a Player to Unplaced or the bench first.`
    : 'This pitch is full. Move a Player to Unplaced or the bench first.'
}
