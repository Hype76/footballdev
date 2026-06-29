import { formatUkDate } from '../../lib/date-format.js'

export const PLAYER_PAGE_SIZE = 12
export const ARCHIVED_PLAYER_PAGE_SIZE = 12

export const PLAYER_DECISION_ACTIONS = [
  ['invite_back_selected', 'Invite Back'],
  ['no_place_offered_selected', 'No Place Offered'],
  ['offer_place_selected', 'Offer Place'],
]

export function getPlayerKey(playerName) {
  return String(playerName ?? '').trim().toLowerCase()
}

export function getPlayerProfileSourceForSection(section) {
  const normalizedSection = String(section ?? '').trim().toLowerCase()

  if (normalizedSection === 'squad') {
    return 'squad'
  }

  if (normalizedSection === 'trial') {
    return 'trial'
  }

  return ''
}

export function buildPlayerProfilePath(player) {
  const playerName = String(player?.playerName ?? '').trim()
  const params = new URLSearchParams()
  const source = getPlayerProfileSourceForSection(player?.section)
  const playerId = String(player?.playerId ?? player?.id ?? '').trim()
  const teamId = String(player?.teamId ?? player?.team_id ?? '').trim()
  const clubId = String(player?.clubId ?? player?.club_id ?? '').trim()
  const membershipId = String(player?.membershipId ?? player?.membership_id ?? player?.teamPlayerId ?? player?.team_player_id ?? '').trim()

  if (source) {
    params.set('source', source)
  }

  if (playerId) {
    params.set('playerId', playerId)
  }

  if (teamId) {
    params.set('teamId', teamId)
  }

  if (clubId) {
    params.set('clubId', clubId)
  }

  if (membershipId) {
    params.set('membershipId', membershipId)
  }

  const query = params.toString()

  return `/player/${encodeURIComponent(playerName)}${query ? `?${query}` : ''}`
}

export function getAverageScore(evaluations) {
  const scoredEvaluations = evaluations.filter((evaluation) => evaluation.averageScore !== null)

  if (scoredEvaluations.length === 0) {
    return null
  }

  return scoredEvaluations.reduce((sum, evaluation) => sum + evaluation.averageScore, 0) / scoredEvaluations.length
}

export function formatPlayerDate(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return 'No date entered'
  }

  const parsedDate = new Date(normalizedValue)
  return Number.isNaN(parsedDate.getTime()) ? normalizedValue : formatUkDate(parsedDate.toISOString().slice(0, 10), normalizedValue)
}
