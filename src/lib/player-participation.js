export const PLAYER_SECTIONS = Object.freeze(['Trial', 'Squad', 'Training-only', 'Match-only'])

export function normalizeClubPlayerType(row = {}) {
  return {
    id: row.id || '',
    clubId: row.club_id || row.clubId || '',
    name: String(row.name || '').trim(),
    canTraining: Boolean(row.can_training ?? row.canTraining),
    canFriendly: Boolean(row.can_friendly ?? row.canFriendly),
    canCup: Boolean(row.can_cup ?? row.canCup),
    canLeague: Boolean(row.can_league ?? row.canLeague),
    chatGroup: row.chat_group || row.chatGroup || 'none',
    isDefault: Boolean(row.is_default ?? row.isDefault),
  }
}

export function attachPlayerTypeRules(players, types) {
  const byName = new Map(types.map((type) => [type.name, type]))
  return players.map((player) => ({ ...player, playerTypeRules: byName.get(player.section) || null }))
}

const DEFAULT_RULES = Object.freeze({
  Trial: { canTraining: true, canFriendly: true, canCup: true, canLeague: true, chatGroup: 'team' },
  Squad: { canTraining: true, canFriendly: true, canCup: true, canLeague: true, chatGroup: 'team' },
  'Training-only': { canTraining: true, canFriendly: true, canCup: false, canLeague: false, chatGroup: 'training' },
  'Match-only': { canTraining: false, canFriendly: true, canCup: true, canLeague: true, chatGroup: 'match' },
})

export function normalizePlayerSection(value) {
  const section = String(value ?? '').trim().toLowerCase()
  return PLAYER_SECTIONS.find((candidate) => candidate.toLowerCase() === section) || ''
}

export function getPlayerTypeRules(player) {
  if (player?.playerTypeRules) return player.playerTypeRules
  return DEFAULT_RULES[normalizePlayerSection(player?.section)] || null
}

export function canPlayerJoinFixture(player, fixtureType, { allowTrial = true } = {}) {
  if (String(player?.status ?? 'active').trim().toLowerCase() === 'archived' || player?.archivedAt || player?.archived_at) return false
  if (normalizePlayerSection(player?.section) === 'Trial' && !allowTrial) return false
  const rules = getPlayerTypeRules(player)
  const type = String(fixtureType ?? '').trim().toLowerCase() || 'league'
  if (type === 'friendly') return rules?.canFriendly === true
  if (type === 'cup' || type === 'tournament') return rules?.canCup === true
  if (type === 'league') return rules?.canLeague === true
  return false
}

export function canPlayerJoinSession(player, sessionType) {
  if (String(player?.status ?? 'active').trim().toLowerCase() === 'archived' || player?.archivedAt || player?.archived_at) return false
  const rules = getPlayerTypeRules(player)
  const type = String(sessionType || 'training').trim().toLowerCase()
  if (type === 'training') return rules?.canTraining === true
  if (type === 'match') return rules?.canLeague === true
  if (type === 'tournament') return rules?.canCup === true
  if (['general', 'meeting', 'social', 'other'].includes(type)) return Boolean(rules)
  return false
}
