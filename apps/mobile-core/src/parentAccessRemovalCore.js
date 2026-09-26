import { getSelectedParentLink } from './parentLinks.js'

export function canRemoveOwnParentAccess(link) {
  return Boolean(link?.id && link?.playerId && ['parent', 'family'].includes(link.linkType || 'parent'))
}

export function buildParentProfileAfterAccessRemoval(user, playerId) {
  const links = Array.isArray(user?.parentPortalLinks) ? user.parentPortalLinks : []
  const removedLinks = links.filter(link => link.playerId === playerId && canRemoveOwnParentAccess(link))
  if (!user?.id || !playerId || !removedLinks.length) throw new Error('Choose a player linked to your Parent account.')
  const removedIds = new Set(removedLinks.map(link => link.id))
  const retainedLinks = links.filter(link => !removedIds.has(link.id))
  const selected = getSelectedParentLink({ ...user, parentPortalLinks: retainedLinks })
  return {
    removedLinkIds: [...removedIds],
    profile: {
      ...user,
      hasParentAccess: retainedLinks.length > 0,
      parentPortalLinks: retainedLinks,
      selectedParentLinkId: selected?.id || '',
      selectedPlayerId: selected?.playerId || '',
      selectedPlayerName: selected?.playerName || '',
      activeTeamId: selected?.teamId || '',
      activeTeamName: selected?.teamName || '',
      clubId: selected?.clubId || '',
      clubName: selected?.clubName || '',
    },
  }
}

export function validateParentAccessRemovalResult(result, playerId) {
  if (result?.player_id !== playerId || !Number.isInteger(result?.revoked_count) || result.revoked_count < 0) {
    throw new Error('The access removal could not be confirmed. Refresh your linked players before trying again.')
  }
  return result
}

export function pruneRemovedParentOfflineScopes(document, removedLinkIds) {
  if (!document) return document
  const removed = new Set(removedLinkIds)
  return {
    ...document,
    journal: (document.journal || []).filter(command => !removed.has(command.childScope)),
    resources: Object.fromEntries(Object.entries(document.resources || {}).filter(([linkId]) => !removed.has(linkId))),
    parentScorerOutboxes: Object.fromEntries(Object.entries(document.parentScorerOutboxes || {}).filter(([linkId]) => !removed.has(linkId))),
  }
}
