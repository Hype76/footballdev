import { createParentMobileTheme, getParentThemeContrastRatio, resolveParentMobileBranding } from '../../apps/mobile-core/src/parentThemeCore.js'

export function fanBrandingLink(source = {}, matchdayPolicy) {
  source ||= {}
  const selectedLink = {
    clubId: source.club_id || source.clubId || '',
    clubLogoUrl: source.club_logo_url || source.clubLogoUrl || '',
    id: source.id || '',
    matchdayPolicy,
    planKey: source.plan_key || source.planKey || '',
    themeAccent: source.theme_accent || source.themeAccent || 'green',
    themeButtonStyle: source.theme_button_style || source.themeButtonStyle || 'solid',
  }
  const branding = resolveParentMobileBranding(selectedLink)
  return {
    id: selectedLink.id,
    clubId: selectedLink.clubId,
    clubName: source.club_name || source.clubName || '',
    clubLogoUrl: branding.clubLogoUrl,
    matchdayPolicy,
    planKey: selectedLink.planKey,
    themeAccent: branding.accent,
    themeButtonStyle: branding.buttonStyle,
  }
}

export function fanBrandTheme(source, mode = 'light', matchdayPolicy) {
  const theme = createParentMobileTheme({ selectedLink: fanBrandingLink(source, matchdayPolicy), mode })
  const { tokens } = theme
  const backgrounds = [tokens.portalSurface, tokens.portalBackground, tokens.surfaceRaised]
  const readable = (colour) => backgrounds.every((background) => getParentThemeContrastRatio(colour, background) >= 4.5)
  if (readable(tokens.accentText)) return theme
  const target = theme.mode === 'dark' ? 255 : 0
  for (let step = 1; step <= 20; step++) {
    const colour = `#${[1, 3, 5].map((offset) => {
      const channel = Number.parseInt(tokens.accentText.slice(offset, offset + 2), 16)
      return Math.round(channel + (target - channel) * step / 20).toString(16).padStart(2, '0')
    }).join('')}`
    if (readable(colour)) return { ...theme, tokens: { ...tokens, accentText: colour } }
  }
  return { ...theme, tokens: { ...tokens, accentText: tokens.textPrimary } }
}

export function fanBrandWebStyle(source, mode, matchdayPolicy) {
  const { tokens: t } = fanBrandTheme(source, mode, matchdayPolicy)
  return {
    '--app-bg': t.portalBackground, '--panel-bg': t.portalSurface, '--panel-soft': t.surfaceRaised,
    '--text-primary': t.textPrimary, '--text-muted': t.textSecondary, '--text-secondary': t.accentText,
    '--accent': t.accent, '--accent-soft': t.accentSoft, '--border-color': t.border,
    '--button-primary': t.buttonPrimary, '--button-primary-text': t.accentForeground,
    '--danger-text': t.danger,
  }
}
