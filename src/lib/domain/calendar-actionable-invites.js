const STATUS_LABELS = {
  available: 'Available',
  closed: 'Expired or closed',
  maybe: 'Maybe',
  not_invited: 'Not invited',
  pending: 'Invitation pending, no response',
  selected: 'Selected for invitation',
  unavailable: 'Unavailable',
}

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase()
}

function isClosedFixture(matchDay = {}) {
  return Boolean(matchDay.concludedAt)
    || ['cancelled', 'full_time', 'postponed'].includes(normalizeText(matchDay.status))
}

export function getMatchDayPlayerInviteStatus({
  matchDay = {},
  playerId = '',
  selected = false,
} = {}) {
  const normalizedPlayerId = String(playerId ?? '').trim()
  const requests = (Array.isArray(matchDay.availabilityRequests) ? matchDay.availabilityRequests : [])
    .filter((request) => String(request.playerId ?? '').trim() === normalizedPlayerId)
  const availability = (Array.isArray(matchDay.playerAvailability) ? matchDay.playerAvailability : [])
    .find((row) => String(row.playerId ?? '').trim() === normalizedPlayerId)
  const authoritativeStatus = normalizeText(availability?.status)
  const requestStatuses = requests.map((request) => normalizeText(request.status))

  if (!selected) {
    return 'not_invited'
  }

  if (['available', 'maybe', 'unavailable'].includes(authoritativeStatus)) {
    return authoritativeStatus
  }

  for (const status of ['available', 'maybe', 'unavailable']) {
    if (requestStatuses.includes(status)) {
      return status
    }
  }

  if (requests.length > 0 && (isClosedFixture(matchDay) || requestStatuses.every((status) => status === 'expired'))) {
    return 'closed'
  }

  if (requestStatuses.includes('pending')) {
    return 'pending'
  }

  return selected ? 'selected' : 'not_invited'
}

export function getMatchDayPlayerInviteStatusLabel(input = {}) {
  return STATUS_LABELS[getMatchDayPlayerInviteStatus(input)] || STATUS_LABELS.not_invited
}

export function buildMatchDayPlayerInviteStatusMap({ matchDay = {}, selectedPlayerIds = [] } = {}) {
  const selectedIds = new Set((Array.isArray(selectedPlayerIds) ? selectedPlayerIds : []).map(String))
  const playerIds = new Set([
    ...selectedIds,
    ...(Array.isArray(matchDay.availabilityRequests) ? matchDay.availabilityRequests : []).map((request) => String(request.playerId ?? '')),
    ...(Array.isArray(matchDay.playerAvailability) ? matchDay.playerAvailability : []).map((row) => String(row.playerId ?? '')),
  ])

  return Object.fromEntries([...playerIds].filter(Boolean).map((playerId) => [
    playerId,
    getMatchDayPlayerInviteStatusLabel({
      matchDay,
      playerId,
      selected: selectedIds.has(playerId),
    }),
  ]))
}
