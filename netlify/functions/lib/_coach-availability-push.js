function normalizeText(value) {
  return String(value ?? '').trim()
}

export function buildCoachAvailabilityResponsePayload({ contextLabel = '', detailLevel = 'minimal', playerName = '', route, status, targetId, teamId, type } = {}) {
  const normalizedStatus = normalizeText(status).toLowerCase()
  const safePlayerName = normalizeText(playerName) || 'A player'
  const safeContext = normalizeText(contextLabel)
  const body = detailLevel === 'detailed'
    ? `${safePlayerName} is ${normalizedStatus}${safeContext ? ` for ${safeContext}` : ''}.`
    : 'A player availability response has been updated.'
  return {
    body,
    data: {
      app: 'coach',
      route: normalizeText(route) || 'calendar',
      targetId,
      teamId,
      type: normalizeText(type) || 'availability_response',
    },
    title: 'Availability updated',
    type: 'coach_update',
  }
}
