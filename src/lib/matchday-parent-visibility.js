const MATCH_DAY_PARENT_AUDIENCES = ['none', 'involved_players', 'all_team_parents', 'all_club_parents']

export const FIXTURE_CALENDAR_AUDIENCE_OPTIONS = Object.freeze([
  { value: 'involved_players', label: 'Add to calendar of Invited players' },
  { value: 'all_team_parents', label: 'Add to calendar of Everyone' },
])

export function getFixtureCalendarAudience(value, hasTeam) {
  return hasTeam && value === 'all_team_parents' ? 'all_team_parents' : 'involved_players'
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeParentAudience(value) {
  const normalizedValue = normalizeText(value)
  return MATCH_DAY_PARENT_AUDIENCES.includes(normalizedValue) ? normalizedValue : 'none'
}

export function buildMatchDayParentVisibility(match = {}) {
  const parentVisible = match?.parentVisible === true
  const parentAudience = parentVisible ? normalizeParentAudience(match?.parentAudience || 'involved_players') : 'none'

  if (parentVisible && parentAudience === 'none') {
    throw new Error('Choose who can see this fixture in the parent portal.')
  }

  return {
    parentVisible,
    parentAudience,
  }
}
