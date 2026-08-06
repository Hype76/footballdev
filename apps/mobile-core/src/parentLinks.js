export function getParentPortalLinks(user) {
  const links = Array.isArray(user?.parentPortalLinks) ? user.parentPortalLinks : []
  const seenPlayers = new Set()

  return links.filter((link) => {
    const playerId = String(link?.playerId ?? '').trim()
    const linkId = String(link?.id ?? '').trim()

    if (!playerId || !linkId || seenPlayers.has(playerId)) {
      return false
    }

    seenPlayers.add(playerId)
    return true
  })
}

export function getSelectedParentLink(user, selectedLinkId = '') {
  const links = getParentPortalLinks(user)
  const preferredLinkId = selectedLinkId || user?.selectedParentLinkId || ''

  return links.find((link) => link.id === preferredLinkId) || links[0] || null
}

export function withSelectedParentLink(user, selectedLink) {
  return user
    ? {
        ...user,
        selectedParentLinkId: selectedLink?.id || '',
      }
    : user
}
