export const PITCH_TYPE_OPTIONS = Object.freeze([
  Object.freeze({ value: 'grass', label: 'Grass' }),
  Object.freeze({ value: '3g', label: '3G' }),
  Object.freeze({ value: '4g', label: '4G' }),
  Object.freeze({ value: 'indoor', label: 'Indoor' }),
  Object.freeze({ value: 'other', label: 'Other' }),
])

const PITCH_TYPES = new Set(PITCH_TYPE_OPTIONS.map((option) => option.value))

export function normalizePitchType(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function assertValidPitchType(value) {
  const pitchType = normalizePitchType(value)

  if (pitchType && !PITCH_TYPES.has(pitchType)) {
    throw new Error('Choose a valid pitch type.')
  }

  return pitchType
}

export function getPitchTypeLabel(value) {
  const pitchType = normalizePitchType(value)
  return PITCH_TYPE_OPTIONS.find((option) => option.value === pitchType)?.label || ''
}
