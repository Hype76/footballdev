import { getMatchDayDisplayName, getMatchDayDisplayParts, getMatchDayDisplayScore, getMatchDayShootoutScore } from '../../../src/lib/matchday-display.js'
import { resolveMatchDayNotificationTeamName } from '../../../src/lib/team-notification-display.js'
import { getGoalScorerSide } from '../../../src/lib/matchday-goal-credit.js'

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

function formatEventMinute(event) {
  const minuteValue = Number(event?.minute)
  const stoppageValue = Number(event?.stoppage_minute ?? event?.stoppageMinute ?? 0)

  if (!Number.isInteger(minuteValue) || minuteValue < 0) {
    return ''
  }

  const stoppageMinute = Number.isInteger(stoppageValue) && stoppageValue > 0
    ? `+${stoppageValue}`
    : ''

  return ` at ${minuteValue}${stoppageMinute}'`
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
  if (requestedType === 'start_penalties') return 'penalties'

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
  const cardSide = normalizeType(event?.team_side || event?.teamSide)
  const cardTeam = cardSide === 'club' ? teamName : cardSide === 'opponent' ? getOpponentName(match) : ''

  switch (notificationType) {
    case 'match_started':
      return { title: 'Match started', category: 'Match started', detail: 'The Match has started' }
    case 'goal':
      return isOpponentGoal
        ? { title: 'Opposition goal', category: 'Opposition goal', detail: 'The opposition scored' }
        : { title: 'Goal update', category: `Goal for ${teamName}`, detail: `${teamName} scored` }
    case 'yellow_card':
      return { title: 'Yellow card update', category: cardTeam ? `Yellow card for ${cardTeam}` : 'Yellow card update', detail: cardTeam ? `Yellow card for ${cardTeam}` : 'A yellow card was recorded' }
    case 'red_card':
      return { title: 'Red card update', category: cardTeam ? `Red card for ${cardTeam}` : 'Red card update', detail: cardTeam ? `Red card for ${cardTeam}` : 'A red card was recorded' }
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
      return { title: 'Penalty shootout started', category: 'Penalty shootout has started', detail: 'Penalty shootout has started' }
    case 'shootout_kick': {
      const team = isOpponentGoal ? getOpponentName(match) : teamName
      const scored = normalizeType(event?.outcome) === 'scored'
      return { title: scored ? 'Penalty scored' : 'Penalty missed or saved', category: `${team} ${scored ? 'scored' : 'missed'} a penalty`, detail: `${team} ${scored ? 'scored their penalty' : 'did not score their penalty'}` }
    }
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

function getCompactEventDetail(notificationType, event, copy) {
  const playerName = normalizeText(event?.scorer_name || event?.scorerName || event?.player_name || event?.playerName)
  const playerShirt = normalizeText(event?.scorer_shirt_number || event?.scorerShirtNumber || event?.player_shirt_number || event?.playerShirtNumber)
  const relatedName = normalizeText(event?.assist_name || event?.assistName || event?.player_on_name || event?.playerOnName)
  const relatedShirt = normalizeText(event?.assist_shirt_number || event?.assistShirtNumber || event?.player_on_shirt_number || event?.playerOnShirtNumber)
  if (notificationType === 'goal') {
    const ownGoal = event?.is_own_goal === true || event?.isOwnGoal === true
    const scorerSide = getGoalScorerSide({ teamSide: normalizeType(event?.team_side || event?.teamSide), isOwnGoal: ownGoal })
    const opponentScorer = scorerSide === 'opponent'
    const scorer = formatPerson(opponentScorer && /^player$/i.test(playerName.replace(/^Other:\s*/i, '')) ? '' : playerName, playerShirt, opponentScorer ? 'Opponent' : 'Player')
    const minute = formatEventMinute(event)
    if (ownGoal) return `Own goal${playerName || playerShirt || opponentScorer ? `: ${scorer}` : ''}${minute}.`
    const assist = relatedName || relatedShirt ? ` Assist: ${formatPerson(relatedName, relatedShirt, opponentScorer ? 'Opponent' : 'Player')}.` : ''
    return `Goal: ${scorer}${minute}.${assist}`
  }
  if (['yellow_card', 'red_card'].includes(notificationType) && (playerName || playerShirt)) {
    const colour = notificationType === 'yellow_card' ? 'Yellow' : 'Red'
    const heading = copy.category === copy.title ? colour : copy.category
    return `${heading}: ${formatPerson(playerName, playerShirt)}${formatEventMinute(event)}.`
  }
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
  const isPeriodEnd = ['half_time', 'full_time'].includes(notificationType)
  const shootoutWinner = normalizeType(match?.shootout_winner ?? match?.shootoutWinner)
  const isShootoutFinish = notificationType === 'full_time' && ['home', 'away'].includes(shootoutWinner)
  const copy = isShootoutFinish
    ? { title: 'Penalty shootout finished', category: 'Penalty shootout finished', detail: 'Penalty shootout finished' }
    : getEventCopy({ match, notificationType, event })
  const compactEventDetail = getCompactEventDetail(notificationType, event, copy)
  const opponentName = getOpponentName(match)
  const compactScore = `${score} v ${opponentName}`
  const matchId = normalizeText(match?.id) || 'unknown'
  const eventId = normalizeText(event?.id)
  const isCard = ['yellow_card', 'red_card'].includes(notificationType)
  const result = getMatchDayDisplayParts({ ...match, clubName: teamName })
  const shootoutScore = getMatchDayShootoutScore(match)
  const kickScore = `${Number(event?.home_shootout_score ?? event?.homeShootoutScore ?? 0)} - ${Number(event?.away_shootout_score ?? event?.awayShootoutScore ?? 0)}`
  const detailedScore = notificationType === 'goal' ? score : isCard && copy.category !== copy.title ? `${matchName}. Score ${score}` : compactScore
  const detailedBody = notificationType === 'shootout_kick'
    ? `${copy.category}. ${matchName}. Shootout: ${kickScore}.`
    : compactEventDetail
    ? `${compactEventDetail} ${detailedScore}.`
    : isCard
      ? `${copy.detail}. ${matchName}. Score ${score}.`
    : isShootoutFinish
      ? `Penalty shootout finished. Full time: ${result.firstTeam} ${result.firstScore} - ${result.secondScore} ${result.secondTeam} (${shootoutScore} pens). ${shootoutWinner === 'home' ? result.firstTeam : result.secondTeam} won on penalties.`
    : isPeriodEnd
      ? `${copy.title}: ${score.replaceAll(' - ', '–')}`
    : copy.includeScore === false
      ? `${copy.detail} for ${matchName}.`
      : notificationType === 'match_started'
        ? `Started v ${opponentName}. ${score}.`
        : `${copy.detail} for ${matchName}. Score ${score}.`

  return {
    title: copy.title,
    matchTitle: matchName,
    minimalBody: notificationType === 'shootout_kick' || isPeriodEnd
      ? detailedBody
      : isCard
      ? `${copy.category}. ${matchName}.`
      : notificationType === 'goal' && compactEventDetail && event
      ? detailedBody
      : `${copy.category} for ${matchName}.`,
    detailedBody,
    notificationType,
    renotify: ['goal', 'score_correction', 'full_time', 'extra_time', 'start_extra_time', 'penalties', 'shootout_kick'].includes(notificationType),
    tag: eventId
      ? `match-day-${matchId}-${notificationType}-${eventId}`
      : `match-day-${matchId}-${notificationType}`,
  }
}
