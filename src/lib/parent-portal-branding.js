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

function hasThemeValue(link) {
  return Boolean(link?.themeMode || link?.themeAccent || link?.themeButtonStyle)
}

function sameClub(left, right) {
  return Boolean(left?.clubId && right?.clubId && String(left.clubId) === String(right.clubId))
}

export function resolveParentPortalBranding({ selectedLink, links = [] } = {}) {
  const parentLinks = Array.isArray(links) ? links : []
  const selectedClubLinks = parentLinks.filter((link) => sameClub(link, selectedLink))
  // Clubs do not expose theme fields yet, so use the first themed link in the selected club group.
  const clubBrandingSource = selectedClubLinks.find(hasThemeValue) || (hasThemeValue(selectedLink) ? selectedLink : null)

  return {
    mode: normalizeOption(clubBrandingSource?.themeMode, THEME_MODES, DEFAULT_PARENT_PORTAL_BRANDING.mode),
    accent: normalizeOption(clubBrandingSource?.themeAccent, THEME_ACCENTS, DEFAULT_PARENT_PORTAL_BRANDING.accent),
    buttonStyle: normalizeOption(
      clubBrandingSource?.themeButtonStyle,
      THEME_BUTTON_STYLES,
      DEFAULT_PARENT_PORTAL_BRANDING.buttonStyle,
    ),
    sourceClubId: selectedLink?.clubId || '',
    sourceLinkId: clubBrandingSource?.id || '',
  }
}
