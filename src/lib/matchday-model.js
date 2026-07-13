export const DEFAULT_MATCH_DURATION_MINUTES = 90
export const MATCH_DURATION_MINUTES_MIN = 20
export const MATCH_DURATION_MINUTES_MAX = 140
export const MATCH_CLOCK_MODE_FIXED = 'fixed'
export const MATCH_CLOCK_MODE_CONTINUOUS = 'continuous'

export const MATCH_CLOCK_MODE_OPTIONS = [
  { value: MATCH_CLOCK_MODE_FIXED, label: 'Fixed duration' },
  { value: MATCH_CLOCK_MODE_CONTINUOUS, label: 'Continuous clock' },
]

export const MATCH_DAY_HOME_AWAY_OPTIONS = [
  { value: 'home', label: 'Home' },
  { value: 'away', label: 'Away' },
]

const LEGACY_MATCH_DAY_HOME_AWAY_VALUES = new Set(['home', 'away', 'neutral'])
const MATCH_DAY_HOME_AWAY_VALUES = new Set(MATCH_DAY_HOME_AWAY_OPTIONS.map((option) => option.value))
const MATCH_CLOCK_MODE_VALUES = new Set(MATCH_CLOCK_MODE_OPTIONS.map((option) => option.value))

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

export function normalizeMatchClockMode(value) {
  const clockMode = normalizeText(value)
  return MATCH_CLOCK_MODE_VALUES.has(clockMode) ? clockMode : MATCH_CLOCK_MODE_FIXED
}

export function assertValidMatchClockMode(value) {
  const clockMode = normalizeText(value)

  if (!MATCH_CLOCK_MODE_VALUES.has(clockMode)) {
    throw new Error('Choose Fixed duration or Continuous clock.')
  }

  return clockMode
}

export function isContinuousMatchClock(match = {}) {
  return normalizeMatchClockMode(match.clockMode ?? match.match_clock_mode) === MATCH_CLOCK_MODE_CONTINUOUS
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

export function getRequiredMatchDurationValidationError(value) {
  const durationText = String(value ?? '').trim()

  if (!durationText) {
    return 'Enter a custom match duration.'
  }

  return getMatchDurationValidationError(value)
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
