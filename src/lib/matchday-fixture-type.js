export const MATCH_DAY_FIXTURE_TYPE_OPTIONS = [
  { value: 'friendly', label: 'Friendly' },
  { value: 'league', label: 'League' },
  { value: 'cup', label: 'Cup' },
  { value: 'tournament', label: 'Tournament' },
]

const MATCH_DAY_FIXTURE_TYPES = new Set(MATCH_DAY_FIXTURE_TYPE_OPTIONS.map((option) => option.value))

export function normalizeMatchDayFixtureType(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase()
  return MATCH_DAY_FIXTURE_TYPES.has(normalizedValue) ? normalizedValue : ''
}

export function assertValidMatchDayFixtureType(value) {
  const fixtureType = normalizeMatchDayFixtureType(value)

  if (!fixtureType) {
    throw new Error('Choose Friendly, League, Cup, or Tournament.')
  }

  return fixtureType
}

export function getMatchDayFixtureTypeLabel(value, fallback = 'Not set') {
  const fixtureType = normalizeMatchDayFixtureType(value)
  return MATCH_DAY_FIXTURE_TYPE_OPTIONS.find((option) => option.value === fixtureType)?.label || fallback
}
