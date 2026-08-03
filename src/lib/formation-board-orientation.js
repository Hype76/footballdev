export const FORMATION_BOARD_CANONICAL_ORIENTATION = 'portrait'
export const FORMATION_BOARD_COORDINATE_MIN = 0.04
export const FORMATION_BOARD_COORDINATE_MAX = 0.96

function roundCoordinate(value) {
  return Math.round(value * 10_000) / 10_000
}

export function normalizeFormationCoordinate(value) {
  const coordinate = Number(value)

  if (!Number.isFinite(coordinate)) {
    return 0.5
  }

  return Math.min(
    FORMATION_BOARD_COORDINATE_MAX,
    Math.max(FORMATION_BOARD_COORDINATE_MIN, roundCoordinate(coordinate)),
  )
}

export function getFormationBoardOrientation(value) {
  return String(value ?? '').trim().toLowerCase() === 'landscape' ? 'landscape' : FORMATION_BOARD_CANONICAL_ORIENTATION
}

export function convertFormationPlacementToPortrait(placement) {
  return {
    ...placement,
    x: normalizeFormationCoordinate(placement?.x),
    y: normalizeFormationCoordinate(placement?.y),
  }
}

export function convertFormationPlacementsToPortrait(placements, sourceOrientation = FORMATION_BOARD_CANONICAL_ORIENTATION) {
  const items = Array.isArray(placements) ? placements : []

  if (getFormationBoardOrientation(sourceOrientation) !== 'landscape') {
    return items
  }

  // The former landscape option changed only the viewport aspect ratio. The
  // football axes remained left to right for width and top to bottom for the
  // defensive to attacking direction, so preserving normalized x and y is the
  // only transformation that keeps the tactical layout intact.
  return items.map(convertFormationPlacementToPortrait)
}

export function adaptFormationVersionToPortrait(version) {
  if (!version) return version

  const sourceOrientation = getFormationBoardOrientation(version.pitchOrientation ?? version.pitch_orientation)
  const placements = convertFormationPlacementsToPortrait(version.placements, sourceOrientation)

  return {
    ...version,
    pitchOrientation: FORMATION_BOARD_CANONICAL_ORIENTATION,
    pitch_orientation: FORMATION_BOARD_CANONICAL_ORIENTATION,
    placements,
  }
}
