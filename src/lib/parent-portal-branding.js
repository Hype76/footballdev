import {
  normalizeThemeAccent,
  normalizeThemeButtonStyle,
  normalizeThemeMode,
} from './theme.js'
import { CAPABILITIES, getFeatureAccess } from './paywall-access.js'

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

export function resolveParentPortalDisplayLink(selectedLink, matchdayPolicy) {
  if (!selectedLink) return selectedLink
  const planKey = String(selectedLink.planKey || selectedLink.plan_key || '').trim().toLowerCase()
  if (!['matchday', 'team', 'club'].includes(planKey)) return selectedLink
  const context = { ...selectedLink, matchdayPolicy, planKey }
  const logoAllowed = getFeatureAccess(context, CAPABILITIES.basicLogoBranding).allowed
  const coloursAllowed = getFeatureAccess(context, CAPABILITIES.customColoursBranding).allowed
  return {
    ...selectedLink,
    ...(logoAllowed ? {} : { clubLogoUrl: '' }),
    ...(coloursAllowed ? {} : { themeAccent: '', themeButtonStyle: '' }),
  }
}

export function resolveParentPortalBranding({ selectedLink, links = [], matchdayPolicy } = {}) {
  const displayLink = resolveParentPortalDisplayLink(selectedLink, matchdayPolicy)
  const parentLinks = Array.isArray(links) ? links : []
  const selectedClubLinks = parentLinks.filter((link) => sameClub(link, displayLink))
  const clubAccent = normalizeThemeAccent(
    displayLink?.themeAccent,
    DEFAULT_PARENT_PORTAL_BRANDING.accent,
  )
  const legacyModeSource = selectedClubLinks.find(hasLegacyThemeMode)
    || (hasLegacyThemeMode(displayLink) ? displayLink : null)

  return {
    mode: normalizeThemeMode(legacyModeSource?.themeMode),
    accent: clubAccent,
    buttonStyle: normalizeThemeButtonStyle(displayLink?.themeButtonStyle),
    sourceClubId: displayLink?.clubId || '',
    sourceLinkId: displayLink?.id || '',
  }
}
