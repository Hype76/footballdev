export const PARENT_PORTAL_STAFF_RETURN_LABEL = 'Return to Coach platform'

function normalizeLinks(links) {
  return Array.isArray(links)
    ? links.filter((link) => link && String(link.id ?? '').trim())
    : []
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

export function resolveParentPortalShellContext({
  links = [],
  selectedLink = null,
  selectedParentLinkId = '',
} = {}) {
  const allowedLinks = normalizeLinks(links)
  const requestedLinkId = normalizeText(selectedLink?.id || selectedParentLinkId)
  const activeLink = allowedLinks.find((link) => String(link.id) === requestedLinkId)
    ?? allowedLinks[0]
    ?? null

  return {
    activeLink,
    allowedLinks,
    childName: normalizeText(activeLink?.playerName) || 'No linked child yet',
    clubLogoUrl: normalizeText(activeLink?.clubLogoUrl),
    clubName: normalizeText(activeLink?.clubName) || 'Football Player',
    teamName: normalizeText(activeLink?.teamName) || 'No team assigned',
  }
}

export function getParentPortalStaffReturnMode({
  accessModeOptions = [],
  user = null,
} = {}) {
  const options = [
    ...(Array.isArray(accessModeOptions) ? accessModeOptions : []),
    ...(Array.isArray(user?.accessModeOptions) ? user.accessModeOptions : []),
  ]

  return options.some((option) => option?.id === 'team') ? 'team' : ''
}
