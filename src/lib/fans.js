export const FAN_ACCESS = Object.freeze([
  { key: 'schedule', label: 'Schedule', description: 'View fixtures, training and events shared for this child', icon: 'action.calendar' },
  { key: 'game_day', label: 'Game Day', description: 'View Game Day and receive Game Day notifications', icon: 'parent.match' },
  { key: 'development', label: 'Development records', description: 'View development records shared for this child', icon: 'development' },
  { key: 'resources', label: 'Include resources', description: 'View resources shared for this child', icon: 'resource' },
])

export const FAN_RELATIONSHIP_TYPES = Object.freeze(['fan', 'player'])
// Player invitations are reserved for a future release. No client can enable them.
export const PLAYER_INVITATIONS_ENABLED = false

export function normalizeFanPermissions(value = {}) {
  return { schedule: value.schedule === true, game_day: value.game_day === true, development: value.development === true, resources: value.development === true && value.resources === true }
}

export function validateFanInvite(value) {
  const name = String(value?.name || '').trim()
  const email = String(value?.email || '').trim().toLowerCase()
  const permissions = normalizeFanPermissions(value?.permissions)
  if (!name || name.length > 120) throw new Error('Enter a name of up to 120 characters.')
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new Error('Enter a valid email address.')
  if (!permissions.schedule && !permissions.game_day && !permissions.development) throw new Error('Choose at least one access option.')
  if (value?.relationship_type && value.relationship_type !== 'fan') throw new Error('Player invitations are not available yet.')
  return { name, email, permissions }
}

export function fanAccessSummary(permissions) {
  const allowed = normalizeFanPermissions(permissions)
  return FAN_ACCESS.filter((item) => allowed[item.key]).map((item) => item.description)
}

export function fanInvitationStatus(connection, now = Date.now()) {
  if (connection.status === 'pending' && Date.parse(connection.expires_at) <= now) return 'expired'
  return connection.status
}

export function fanInviteUrl(origin, token) {
  return `${String(origin).replace(/\/$/, '')}/fan-invite/${encodeURIComponent(token)}`
}

export function normalizeFanProfileLink(row) {
  return { id: row.id, linkType: 'fan', relationshipType: row.relationship_type, playerId: row.player_id, playerName: row.player_name,
    clubId: row.club_id, clubName: row.club_name, clubLogoUrl: row.club_logo_url, themeAccent: row.theme_accent, themeButtonStyle: row.theme_button_style, teamId: row.team_id, teamName: row.team_name, permissions: row.permissions }
}
