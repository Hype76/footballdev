import { buildPlayerProfilePath } from '../../hooks/players/playersPageUtils.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

export function buildEventResponsePlayerNavigation({ currentSearch = '', event, players = [], row, user } = {}) {
  const sourceRow = row?.sourceRow ?? {}
  const sourcePlayer = sourceRow.player ?? {}
  const playerId = normalizeText(row?.playerId)
  const playerName = normalizeText(row?.playerName)
  const eventId = normalizeText(event?.sourceId)
  const eventSource = normalizeText(event?.sourceType)
  const savedPlayer = players.find((player) => normalizeText(player?.id) === playerId) ?? {}

  if (!playerId || !playerName || !eventId || !eventSource) {
    throw new Error('The selected response does not include a resolved saved player profile.')
  }

  const profilePath = buildPlayerProfilePath({
    ...savedPlayer,
    ...sourcePlayer,
    clubId: sourceRow.clubId || event?.data?.clubId || user?.clubId,
    id: playerId,
    playerId,
    playerName,
    section: sourcePlayer.section || savedPlayer.section,
    teamId: sourceRow.teamId || event?.teamId || event?.data?.teamId || savedPlayer.teamId || user?.activeTeamId,
  })
  const returnSearchParams = new URLSearchParams(currentSearch)
  returnSearchParams.set('action', 'view-responses')
  returnSearchParams.set('eventId', eventId)
  returnSearchParams.set('source', eventSource)

  return {
    profilePath,
    returnSearch: returnSearchParams.toString(),
  }
}
