import {
  normalizeThemeAccent,
  normalizeThemeButtonStyle,
  normalizeThemeMode,
} from './theme.js'

export const DEFAULT_PARENT_PORTAL_BRANDING = {
  mode: 'system',
  accent: 'yellow',
  buttonStyle: 'solid',
}

function hasLegacyThemeMode(link) {
  return Boolean(link?.themeMode)
}

function sameClub(left, right) {
  return Boolean(left?.clubId && right?.clubId && String(left.clubId) === String(right.clubId))
}

export function resolveParentPortalBranding({ selectedLink, links = [] } = {}) {
  const parentLinks = Array.isArray(links) ? links : []
  const selectedClubLinks = parentLinks.filter((link) => sameClub(link, selectedLink))
  const clubAccent = normalizeThemeAccent(
    selectedLink?.themeAccent,
    DEFAULT_PARENT_PORTAL_BRANDING.accent,
  )
  const legacyModeSource = selectedClubLinks.find(hasLegacyThemeMode)
    || (hasLegacyThemeMode(selectedLink) ? selectedLink : null)

  return {
    mode: normalizeThemeMode(legacyModeSource?.themeMode),
    accent: clubAccent,
    buttonStyle: normalizeThemeButtonStyle(selectedLink?.themeButtonStyle),
    sourceClubId: selectedLink?.clubId || '',
    sourceLinkId: selectedLink?.id || '',
  }
}
