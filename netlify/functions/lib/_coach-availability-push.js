import { buildScopedNotificationTitle } from './_notification-scope.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

export function buildCoachAvailabilityResponsePayload({ clubName = '', contextLabel = '', playerName = '', route, status, targetId, teamId, teamName = '', type } = {}) {
  const normalizedStatus = normalizeText(status).toLowerCase()
  const safePlayerName = normalizeText(playerName) || 'A player'
  const safeContext = normalizeText(contextLabel)
  const responseText = {
    available: 'is attending',
    unavailable: 'is not attending',
    maybe: 'responded Maybe',
  }[normalizedStatus] || 'updated their availability'
  const body = `${safePlayerName} ${responseText}${safeContext ? ` for ${safeContext}` : ''}.`
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

export function buildCoachAvailabilityHistoryPayload(options = {}) {
  const payload = buildCoachAvailabilityResponsePayload(options)
  const responseLabel = { available: 'Attending', unavailable: 'Not attending', maybe: 'Maybe' }[normalizeText(options.status).toLowerCase()] || 'Response updated'
  const playerName = normalizeText(options.playerName) || 'Player'
  return { ...payload, title: `${playerName} · ${responseLabel}`, body: normalizeText(options.contextLabel) || 'Open the event to view this response.', data: { ...payload.data, playerName, responseStatus: normalizeText(options.status).toLowerCase(), eventTitle: normalizeText(options.contextLabel) } }
}
