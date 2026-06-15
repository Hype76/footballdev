const MATCH_DAY_PARENT_AUDIENCES = ['none', 'involved_players', 'all_team_parents', 'all_club_parents']

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
