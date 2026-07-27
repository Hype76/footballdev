export const DEFAULT_PARENT_PORTAL_BRANDING = {
  mode: 'system',
  accent: 'yellow',
  buttonStyle: 'solid',
}

const THEME_MODES = ['system', 'dark', 'light']
const THEME_ACCENTS = ['yellow', 'blue', 'green', 'red', 'purple']
const THEME_BUTTON_STYLES = ['solid', 'gradient']

function normalizeOption(value, options, fallback) {
  return options.includes(value) ? value : fallback
}

function hasLegacyThemeValue(link) {
  return Boolean(link?.themeMode || link?.themeButtonStyle)
}

function sameClub(left, right) {
  return Boolean(left?.clubId && right?.clubId && String(left.clubId) === String(right.clubId))
}

export function resolveParentPortalBranding({ selectedLink, links = [] } = {}) {
  const parentLinks = Array.isArray(links) ? links : []
  const selectedClubLinks = parentLinks.filter((link) => sameClub(link, selectedLink))
  const clubAccent = normalizeOption(
    selectedLink?.themeAccent,
    THEME_ACCENTS,
    DEFAULT_PARENT_PORTAL_BRANDING.accent,
  )
  const legacyBrandingSource = selectedClubLinks.find(hasLegacyThemeValue)
    || (hasLegacyThemeValue(selectedLink) ? selectedLink : null)

  return {
    mode: normalizeOption(legacyBrandingSource?.themeMode, THEME_MODES, DEFAULT_PARENT_PORTAL_BRANDING.mode),
    accent: clubAccent,
    buttonStyle: normalizeOption(
      legacyBrandingSource?.themeButtonStyle,
      THEME_BUTTON_STYLES,
      DEFAULT_PARENT_PORTAL_BRANDING.buttonStyle,
    ),
    sourceClubId: selectedLink?.clubId || '',
    sourceLinkId: selectedLink?.id || '',
  }
}
