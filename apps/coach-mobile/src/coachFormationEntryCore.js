const normalize = (value) => String(value ?? '').trim()

function dateValue(match) {
  const timestamp = Date.parse(`${normalize(match?.matchDate) || '9999-12-31'}T${normalize(match?.kickoffTime) || '23:59:59'}`)
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER
}

export function sortCoachFormationMatches(matches = []) {
  const priority = { live: 0, half_time: 0, second_half: 0, extra_time: 0, penalties: 0, scheduled: 1, postponed: 2, full_time: 3, cancelled: 4 }
  return [...matches].sort((left, right) => {
    const statusDifference = Number(priority[normalize(left?.status)] ?? 2) - Number(priority[normalize(right?.status)] ?? 2)
    return statusDifference || dateValue(left) - dateValue(right)
  })
}

export function selectPreferredCoachFormationMatch(matches = [], selectedId = '') {
  const ordered = sortCoachFormationMatches(matches)
  return ordered.find((match) => match.id === selectedId)
    || ordered.find((match) => !['cancelled', 'full_time'].includes(normalize(match.status)))
    || ordered[0]
    || null
}
