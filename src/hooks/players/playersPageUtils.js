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
