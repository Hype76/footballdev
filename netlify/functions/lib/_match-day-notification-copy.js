import { getMatchDayDisplayName, getMatchDayDisplayScore } from '../../../src/lib/matchday-display.js'
import { resolveMatchDayNotificationTeamName } from '../../../src/lib/team-notification-display.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeType(value) {
  return normalizeText(value).toLowerCase().replace(/[\s-]+/g, '_')
}

function getTeamName(match) {
  return resolveMatchDayNotificationTeamName(match) || 'Our team'
}

function getOpponentName(match) {
  return normalizeText(match?.opponent) || 'Opponent'
}

function formatPerson(name, shirtNumber, fallback = 'Player') {
  const resolvedName = normalizeText(name).replace(/^Other:\s*/i, '').trim() || fallback
  const resolvedShirtNumber = normalizeText(shirtNumber)
  return `${resolvedName}${resolvedShirtNumber ? ` #${resolvedShirtNumber}` : ''}`
}

function resolveNotificationType(type, event, match) {
  const requestedType = normalizeType(type)
  const eventType = normalizeType(event?.event_type || event?.eventType)
  const matchStatus = normalizeType(match?.status)

  if (['event', 'match_event', 'update', 'match_day_update', ''].includes(requestedType) && eventType) {
    return eventType
  }

  if (['live', 'start', 'started', 'match_started'].includes(requestedType)) {
    return 'match_started'
  }

  if (['second_half', 'resume', 'resumed'].includes(requestedType)) {
    return 'second_half'
  }

  if (['goal_correction', 'score_corrected'].includes(requestedType)) {
    return 'score_correction'
  }

  if (['card', 'card_update'].includes(requestedType) && ['yellow_card', 'red_card'].includes(eventType)) {
    return eventType
  }

  if (['status_change', 'fixture_changed', 'match_changed'].includes(requestedType) && ['cancelled', 'postponed'].includes(matchStatus)) {
    return matchStatus
  }

  return requestedType || eventType || 'match_update'
}

function getEventCopy({ match, notificationType, event }) {
  const teamName = getTeamName(match)
  const isOpponentGoal = normalizeType(event?.team_side || event?.teamSide) === 'opponent'

  switch (notificationType) {
    case 'match_started':
      return { title: 'Match started', category: 'Match started', detail: 'The Match has started' }
    case 'goal':
      return isOpponentGoal
        ? { title: 'Opposition goal', category: 'Opposition goal', detail: 'The opposition scored' }
        : { title: 'Goal update', category: `Goal for ${teamName}`, detail: `${teamName} scored` }
    case 'yellow_card':
      return { title: 'Yellow card update', category: 'Yellow card update', detail: 'A yellow card was recorded' }
    case 'red_card':
      return { title: 'Red card update', category: 'Red card update', detail: 'A red card was recorded' }
    case 'substitution':
      return { title: 'Substitution update', category: 'Substitution update', detail: 'A substitution was recorded' }
    case 'water_break':
    case 'hydration':
      return { title: 'Match pause', category: 'Match pause', detail: 'A Match pause was recorded' }
    case 'half_time':
      return { title: 'Half time', category: 'Half time', detail: 'The Match is at half time' }
    case 'second_half':
      return { title: 'Second half started', category: 'Second half', detail: 'The second half has started' }
    case 'extra_time':
    case 'start_extra_time':
      return { title: 'Extra time', category: 'Extra time', detail: 'The Match has moved to extra time' }
    case 'penalties':
    case 'start_penalties':
      return { title: 'Penalties', category: 'Penalties', detail: 'The Match has moved to penalties' }
    case 'full_time':
      return { title: 'Full time', category: 'Full time', detail: 'The Match is full time' }
    case 'score_correction':
      return { title: 'Score corrected', category: 'Score correction', detail: 'The score was corrected' }
    case 'cancelled':
      return { title: 'Match cancelled', category: 'Match cancelled', detail: 'The Match was cancelled', includeScore: false }
    case 'postponed':
      return { title: 'Match postponed', category: 'Match postponed', detail: 'The Match was postponed', includeScore: false }
    case 'scorer_selected':
      return { title: 'You are the Match Day scorer', category: 'You are the Match Day scorer', detail: 'You are the Match Day scorer', includeScore: false }
    case 'scorer_request':
      return { title: 'Scorer needed', category: 'Scorer request', detail: 'A Match Day scorer is needed', includeScore: false }
    default:
      return { title: 'Match update', category: 'Match update', detail: 'Match information was updated' }
  }
}

function getCompactEventDetail(notificationType, event) {
  const playerName = normalizeText(event?.scorer_name || event?.scorerName || event?.player_name || event?.playerName)
  const playerShirt = normalizeText(event?.scorer_shirt_number || event?.scorerShirtNumber || event?.player_shirt_number || event?.playerShirtNumber)
  const relatedName = normalizeText(event?.assist_name || event?.assistName || event?.player_on_name || event?.playerOnName)
  const relatedShirt = normalizeText(event?.assist_shirt_number || event?.assistShirtNumber || event?.player_on_shirt_number || event?.playerOnShirtNumber)
  if (notificationType === 'goal') {
    const scorer = formatPerson(playerName, playerShirt)
    const assist = relatedName || relatedShirt ? ` Assist: ${formatPerson(relatedName, relatedShirt)}.` : ''
    return `Goal: ${scorer}.${assist}`
  }
  if (notificationType === 'yellow_card') return `Yellow: ${formatPerson(playerName, playerShirt)}.`
  if (notificationType === 'red_card') return `Red: ${formatPerson(playerName, playerShirt)}.`
  if (notificationType === 'substitution') {
    return `Sub: ${formatPerson(playerName, playerShirt)} off, ${formatPerson(relatedName, relatedShirt)} on.`
  }
  return ''
}

export function buildParentMatchDayNotificationCopy({ match, type, event = null } = {}) {
  const teamName = getTeamName(match)
  const matchName = getMatchDayDisplayName({ ...match, teamName })
  const score = getMatchDayDisplayScore(match)
  const notificationType = resolveNotificationType(type, event, match)
  const copy = getEventCopy({ match, notificationType, event })
  const eventId = normalizeText(event?.id)
  const compactEventDetail = getCompactEventDetail(notificationType, event)
  const opponentName = getOpponentName(match)
  const compactScore = `${score} v ${opponentName}`
  const detailedBody = compactEventDetail
    ? `${compactEventDetail} ${compactScore}.`
    : copy.includeScore === false
      ? `${copy.detail} for ${matchName}.`
      : notificationType === 'match_started'
        ? `Started v ${opponentName}. ${score}.`
        : `${copy.detail} for ${matchName}. Score ${score}.`

  return {
    title: copy.title,
    matchTitle: `${teamName} v ${opponentName}`,
    minimalBody: `${copy.category} for ${matchName}.`,
    detailedBody,
    notificationType,
    renotify: ['goal', 'score_correction', 'full_time', 'extra_time', 'start_extra_time', 'penalties', 'start_penalties'].includes(notificationType),
    tag: `match-day-${normalizeText(match?.id) || 'unknown'}-${notificationType}${eventId ? `-${eventId}` : ''}`,
  }
}
