// Only server-authorised, match-scoped data can enable the unconfigured fallback.
export function normalizeMatchDayParticipantRoster(data, match) {
  if (!match?.id || !match?.teamId || data?.matchId !== match.id || data?.teamId !== match.teamId || !Array.isArray(data.players)) {
    throw new Error('Match participants could not be verified. Refresh this fixture online.')
  }
  const seen = new Set()
  return data.players.map(player => {
    if (!player?.id || player.team_id !== match.teamId || seen.has(player.id) || !String(player.player_name || '').trim()) {
      throw new Error('Match participants could not be verified. Refresh this fixture online.')
    }
    seen.add(player.id)
    return { id: player.id, playerName: String(player.player_name).trim(), shirtNumber: String(player.shirt_number || ''), teamId: match.teamId }
  })
}

export function isMatchDayParticipantRosterCurrent(match) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]))
  return match?.matchDate === `${parts.year}-${parts.month}-${parts.day}` && !match.concludedAt && !['cancelled', 'postponed'].includes(match.status)
}

export function mergeMatchDayParticipantEventIdentities(events = [], data, match) {
  normalizeMatchDayParticipantRoster(data, match)
  const identities = data.eventIdentities ?? []
  if (!Array.isArray(identities)) throw new Error('Match participant identities could not be verified.')
  const byId = new Map()
  for (const identity of identities) {
    if (!identity?.id || byId.has(identity.id)) throw new Error('Match participant identities could not be verified.')
    byId.set(identity.id, identity)
  }
  return events.map(event => {
    const identity = byId.get(event.id)
    return identity ? { ...event, scorerPlayerId: identity.scorer_player_id || '', assistPlayerId: identity.assist_player_id || '', participantIdentityVersion: identity.participant_identity_version ?? null } : event
  })
}

// Preserve an existing linked person through a rename; never infer IDs from names.
export function createMatchDayGoalCorrectionDraft(event, players = []) {
  const draft = { ...event, scorerPlayerId: event.scorerPlayerId || '', assistPlayerId: event.assistPlayerId || '' }
  for (const prefix of ['scorer', 'assist']) {
    const player = players.find(item => item.id === draft[`${prefix}PlayerId`])
    if (player) {
      draft[`${prefix}Name`] = player.playerName
      draft[`${prefix}ShirtNumber`] = player.shirtNumber || ''
    }
  }
  return draft
}
