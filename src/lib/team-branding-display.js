// Only attach this payload from the authenticated, resource-scoped display RPC.
// It grants logo/colour display only and never changes plan or role capabilities.
export function getScopedTeamBranding(context) {
  const display = context?.teamBrandingDisplay
  const teamId = context?.teamId || context?.team_id || context?.activeTeamId
  const clubId = context?.clubId || context?.club_id
  if (!display || !teamId || !clubId || display.teamId !== teamId || display.clubId !== clubId
    || !['team', 'paid_club', 'platform'].includes(display.source)
    || typeof display.logoAllowed !== 'boolean' || typeof display.coloursAllowed !== 'boolean') return null
  const expires = display.expiresAt ? Date.parse(display.expiresAt) : null
  const expired = display.expiresAt && (!Number.isFinite(expires) || expires <= Date.now())
  const logoAllowed = expired ? display.baseLogoAllowed === true : display.logoAllowed
  const coloursAllowed = expired ? display.baseColoursAllowed === true : display.coloursAllowed
  let logoUrl = ''
  try { const url = new URL(display.logoUrl); if (url.protocol === 'https:') logoUrl = url.toString() } catch { /* No logo. */ }
  const accent = /^(yellow|blue|green|red|purple|#[0-9a-f]{6})$/i.test(display.accent || '') ? display.accent.toLowerCase() : ''
  return Object.freeze({ ...display, logoAllowed, coloursAllowed, logoUrl: logoAllowed ? logoUrl : '',
    accent: coloursAllowed ? accent : '',
    buttonStyle: coloursAllowed && display.buttonStyle === 'gradient' ? 'gradient' : 'solid' })
}

export async function loadTeamBrandingDisplay(client, context) {
  if (!context?.teamId || !context?.clubId) return context
  const { data, error } = await client.rpc('get_team_branding_display', { team_value: context.teamId, club_value: context.clubId })
  // An uninstalled dormant migration preserves the existing release behaviour.
  if (error?.code === '42883' || error?.code === 'PGRST202' || (!error && data === null)) return context
  const display = !error && getScopedTeamBranding({ ...context, teamBrandingDisplay: data })
  return { ...context, teamBrandingDisplay: display || { teamId: context.teamId, clubId: context.clubId,
    source: 'platform', logoAllowed: false, coloursAllowed: false, logoUrl: '', accent: '', buttonStyle: 'solid' } }
}
