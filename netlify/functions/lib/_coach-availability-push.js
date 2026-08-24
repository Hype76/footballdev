import { buildScopedNotificationTitle } from './_notification-scope.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

export function buildCoachAvailabilityResponsePayload({ clubName = '', contextLabel = '', detailLevel = 'minimal', playerName = '', route, status, targetId, teamId, teamName = '', type } = {}) {
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
      clubName: normalizeText(clubName),
      route: normalizeText(route) || 'calendar',
      targetId,
      teamId,
      teamName: normalizeText(teamName),
      type: normalizeText(type) || 'availability_response',
    },
    title: buildScopedNotificationTitle('Availability updated', { clubName, teamName }),
    type: 'coach_update',
  }
}
