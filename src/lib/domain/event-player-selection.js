function normalizeId(value) {
  return String(value ?? '').trim()
}

export function getManageableEventPlayerIds({ currentParticipants = [], rosterPlayers = [] } = {}) {
  const activeRosterIds = new Set(
    rosterPlayers
      .map((player) => normalizeId(player?.id))
      .filter(Boolean),
  )

  return [...new Set(
    currentParticipants
      .map((participant) => normalizeId(participant?.playerId))
      .filter((playerId) => playerId && activeRosterIds.has(playerId)),
  )]
}
