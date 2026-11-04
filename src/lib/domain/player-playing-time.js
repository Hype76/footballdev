export function calculatePlayerPlayingTime(matches = [], startingSquads = [], events = [], playerId = '') {
  let seconds = 0
  let recordedMatches = 0
  for (const match of matches) {
    const startingSquad = startingSquads.find(row => row.match_day_id === match.id)
    const matchSeconds = Number(match.timer_elapsed_seconds)
    if (!startingSquad || !Number.isFinite(matchSeconds) || matchSeconds <= 0) continue
    const substitutions = events.filter(event => event.match_day_id === match.id && event.event_type === 'substitution'
      && event.team_side === 'club' && (event.event_status || 'active') === 'active' && !event.voided_at)
    if (substitutions.some(event => !event.scorer_player_id || !event.assist_player_id || !Number.isFinite(Number(event.minute)))) continue
    if (!(startingSquad.player_ids || []).includes(playerId)
      && !substitutions.some(event => event.assist_player_id === playerId)) continue
    substitutions.sort((a, b) => Number(a.minute) - Number(b.minute) || String(a.created_at || '').localeCompare(String(b.created_at || '')))
    let onPitch = (startingSquad.player_ids || []).includes(playerId)
    let enteredAt = 0
    let played = 0
    for (const substitution of substitutions) {
      const at = Math.max(0, Math.min(matchSeconds, Number(substitution.minute) * 60))
      if (substitution.scorer_player_id === playerId && onPitch) {
        played += Math.max(0, at - enteredAt)
        onPitch = false
      }
      if (substitution.assist_player_id === playerId && !onPitch) {
        onPitch = true
        enteredAt = at
      }
    }
    if (onPitch) played += Math.max(0, matchSeconds - enteredAt)
    seconds += played
    recordedMatches += 1
  }
  return { minutes: recordedMatches ? Math.round(seconds / 60) : null, recordedMatches }
}
