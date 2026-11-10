export function calculatePlayerPlayingTime(matches = [], startingSquads = [], events = [], playerId = '') {
  let seconds = 0
  let recordedMatches = 0
  for (const match of matches) {
    const startingSquad = startingSquads.find(row => row.match_day_id === match.id)
    const matchSeconds = Number(match.timer_elapsed_seconds)
    if (!startingSquad || !Number.isFinite(matchSeconds) || matchSeconds <= 0) continue
    const timeline = events.filter(event => event.match_day_id === match.id && ['substitution', 'red_card'].includes(event.event_type)
      && event.team_side === 'club' && ['active', 'corrected'].includes(event.event_status || 'active') && !event.voided_at
      && !(event.event_type === 'red_card' && /^Coach:\s*/i.test(event.scorer_name || '')))
    const eventMinute = event => Number(event.minute) + Number(event.stoppage_minute || 0)
    if (timeline.some(event => !event.scorer_player_id || (event.event_type === 'substitution' && !event.assist_player_id)
      || event.minute == null || !Number.isFinite(eventMinute(event)) || eventMinute(event) < 0)) continue
    if (!(startingSquad.player_ids || []).includes(playerId)
      && !timeline.some(event => event.event_type === 'substitution' && event.assist_player_id === playerId)) continue
    timeline.sort((a, b) => eventMinute(a) - eventMinute(b) || String(a.created_at || '').localeCompare(String(b.created_at || '')))
    let onPitch = (startingSquad.player_ids || []).includes(playerId)
    let dismissed = false
    let enteredAt = 0
    let played = 0
    for (const event of timeline) {
      const at = Math.max(0, Math.min(matchSeconds, eventMinute(event) * 60))
      if (event.scorer_player_id === playerId && onPitch) {
        played += Math.max(0, at - enteredAt)
        onPitch = false
      }
      if (event.event_type === 'red_card' && event.scorer_player_id === playerId) dismissed = true
      if (event.event_type === 'substitution' && event.assist_player_id === playerId && !onPitch && !dismissed) {
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
