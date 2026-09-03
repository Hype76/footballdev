export const SCORER_EVENT_LABELS = Object.freeze({ yellow_card: 'Yellow card', red_card: 'Red card', substitution: 'Substitution' })

export function validateScorerMatchEvent(event = {}) {
  if (!Object.hasOwn(SCORER_EVENT_LABELS, event.eventType)) throw new Error('Choose a card or substitution.')
  const minute = Number(event.minute)
  const stoppageMinute = Number(event.stoppageMinute || 0)
  if (event.minute == null || event.minute === '' || !Number.isInteger(minute) || minute < 0 || minute > 999) throw new Error('Enter a whole match minute from 0 to 999.')
  if (!Number.isInteger(stoppageMinute) || stoppageMinute < 0 || stoppageMinute > 30) throw new Error('Enter added time from 0 to 30 minutes.')
  const playerName = String(event.playerName || '').trim()
  const playerOnName = String(event.playerOnName || '').trim()
  if (event.teamSide === 'club' && !playerName) throw new Error('Choose a player from the selected match squad.')
  if (event.eventType === 'substitution') {
    if (event.teamSide === 'club' && !playerOnName) throw new Error('Choose the player coming on.')
    if (playerName && playerName === playerOnName && String(event.playerShirtNumber || '') === String(event.playerOnShirtNumber || '')) throw new Error('Choose a different player coming on.')
  }
  return { ...event, minute, stoppageMinute: stoppageMinute || null, playerName, playerOnName }
}
