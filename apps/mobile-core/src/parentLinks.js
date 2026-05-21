export function getParentPortalLinks(user) {
  return Array.isArray(user?.parentPortalLinks) ? user.parentPortalLinks : []
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
