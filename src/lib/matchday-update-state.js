const relationArrayKeys = [
  'availabilityHistory',
  'availabilityRequests',
  'eventLog',
  'events',
  'playerAvailability',
  'roleAssignments',
  'scorerAssignments',
  'scorerInterests',
]

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

export function reconcileMatchDayUpdate(match, savedMatch = {}) {
  if (!match?.id || !savedMatch?.id || String(match.id) !== String(savedMatch.id)) {
    return match
  }

  const nextMatch = {
    ...match,
    ...savedMatch,
  }

  for (const key of relationArrayKeys) {
    if (!hasOwn(savedMatch, key) && Array.isArray(match[key])) {
      nextMatch[key] = match[key]
    }
  }

  return nextMatch
}

export function reconcileMatchDayUpdateInList(matches, {
  match,
  matchId,
} = {}) {
  const targetId = String(matchId || match?.id || '')

  return (matches || []).map((currentMatch) => (
    targetId && String(currentMatch.id) === targetId
      ? reconcileMatchDayUpdate(currentMatch, match)
      : currentMatch
  ))
}
