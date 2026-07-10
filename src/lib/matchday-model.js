export const DEFAULT_MATCH_DURATION_MINUTES = 90
export const MATCH_DURATION_MINUTES_MIN = 20
export const MATCH_DURATION_MINUTES_MAX = 140

export const MATCH_DAY_HOME_AWAY_OPTIONS = [
  { value: 'home', label: 'Home' },
  { value: 'away', label: 'Away' },
]

const LEGACY_MATCH_DAY_HOME_AWAY_VALUES = new Set(['home', 'away', 'neutral'])
const MATCH_DAY_HOME_AWAY_VALUES = new Set(MATCH_DAY_HOME_AWAY_OPTIONS.map((option) => option.value))

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function normalizeLegacyMatchHomeAway(value) {
  const homeAway = normalizeText(value)
  return LEGACY_MATCH_DAY_HOME_AWAY_VALUES.has(homeAway) ? homeAway : 'home'
}

export function normalizeNewMatchHomeAway(value) {
  const homeAway = normalizeText(value)
  return MATCH_DAY_HOME_AWAY_VALUES.has(homeAway) ? homeAway : 'home'
}

export function assertNewMatchHomeAway(value) {
  const homeAway = normalizeText(value)

  if (!MATCH_DAY_HOME_AWAY_VALUES.has(homeAway)) {
    throw new Error('Choose Home or Away for a new fixture.')
  }

  return homeAway
}

export function getMatchDurationValidationError(value) {
  const durationText = String(value ?? '').trim()

  if (!durationText) {
    return ''
  }

  const durationMinutes = Number(durationText)

  if (!Number.isInteger(durationMinutes)
    || durationMinutes < MATCH_DURATION_MINUTES_MIN
    || durationMinutes > MATCH_DURATION_MINUTES_MAX
    || durationMinutes % 2 !== 0) {
    return `Choose an even match duration between ${MATCH_DURATION_MINUTES_MIN} and ${MATCH_DURATION_MINUTES_MAX} minutes.`
  }

  return ''
}

export function normalizeMatchDurationMinutes(value) {
  return getMatchDurationValidationError(value)
    ? DEFAULT_MATCH_DURATION_MINUTES
    : Number(String(value ?? '').trim() || DEFAULT_MATCH_DURATION_MINUTES)
}

export function assertValidMatchDurationMinutes(value) {
  const validationError = getMatchDurationValidationError(value)

  if (validationError) {
    throw new Error(validationError)
  }

  return normalizeMatchDurationMinutes(value)
}
