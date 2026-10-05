import { isMobileCapabilityAllowed } from '../../mobile-core/src/matchdayPolicyCore.js'
import { getFeatureAccess } from '../../../src/lib/paywall-access.js'
import { getScopedTeamBranding } from '../../../src/lib/team-branding-display.js'

const text = value => String(value ?? '').trim()

// Use only the selected, authorised Parent link, never the staff account context.
export function withParentMatchReportBranding(match = {}, link = {}, matchdayPolicy = null) {
  link = link || {}
  const clubId = text(match.clubId ?? match.club_id)
  const teamId = text(match.teamId ?? match.team_id)
  const sameClub = Boolean(clubId && clubId === text(link.clubId))
  const sameTeam = sameClub && Boolean(teamId && teamId === text(link.teamId))
  const planKey = text(link.planKey ?? link.plan_key)
  const context = { ...link, matchdayPolicy }
  const modern = ['matchday', 'team', 'club'].includes(planKey)
  const allowed = capability => sameTeam && Boolean(planKey)
    && isMobileCapabilityAllowed(context, capability, matchdayPolicy)
    && (!modern || getFeatureAccess(context, capability).allowed)
  const display = sameTeam ? getScopedTeamBranding(link) : null
  const logoAllowed = display ? display.logoAllowed : allowed('basicLogoBranding')
  const coloursAllowed = display ? display.coloursAllowed : allowed('customColoursBranding')
  return {
    ...match,
    clubName: text(match.clubName ?? match.club_name) || (sameClub ? text(link.clubName) : ''),
    clubLogoUrl: logoAllowed ? text(display ? display.logoUrl : link.clubLogoUrl) : '',
    themeAccent: coloursAllowed ? text(display ? display.accent : link.themeAccent) : '',
    // Clear cached image bytes and entitlements before binding the current link.
    clubLogoData: '', club_logo_data: '', club_logo_url: '', theme_accent: '', clubAccent: '', club_accent: '',
    planKey: sameTeam && planKey ? planKey : 'matchday',
    planStatus: sameTeam ? text(link.planStatus) : '',
    matchdayPolicy: sameTeam ? matchdayPolicy : null,
    teamBrandingDisplay: display,
  }
}
