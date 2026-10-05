const URL_ERROR = 'Enter an HTTP or HTTPS league website address without spaces or sign-in details, or leave it blank.'

export function coachTeamLeagueScope(user, teamId = user?.activeTeamId, canMutate = user?.hasActivePlanAccess === true) {
  return { kind: 'coach', userId: user?.id, clubId: user?.clubId, teamId,
    role: user?.role, roleRank: user?.roleRank, canMutate,
    offline: user?.isOfflineProfile === true,
    active: Boolean(user?.clubId && user?.role !== 'super_admin' && Number(user?.roleRank) >= 20 && (!user.accountStatus || user.accountStatus === 'active')) }
}

export function parentPlayerTeamLeagueScope(user, link, offline = false) {
  const kind = link?.linkType === 'parent' ? 'parent' : link?.linkType === 'fan' && link.relationshipType === 'player' ? 'player' : ''
  return { kind, userId: user?.id, clubId: link?.clubId, teamId: link?.teamId, linkId: link?.id, playerId: link?.playerId,
    offline: offline || user?.isOfflineProfile === true,
    active: Boolean(kind && user?.parentPortalLinks?.some(candidate => candidate.id === link.id && candidate.playerId === link.playerId && candidate.teamId === link.teamId && candidate.clubId === link.clubId) && (!user.accountStatus || user.accountStatus === 'active')) }
}

export function normalizeTeamLeagueUrl(value) {
  const raw = String(value ?? '')
  const text = raw.trim()
  if (!text) return ''
  if (/[\s\\]/u.test(text) || [...text].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || text.length > 2048 || !/^https?:\/\//i.test(text)) throw new Error(URL_ERROR)
  let url
  try { url = new URL(text) } catch { throw new Error(URL_ERROR) }
  const authority = text.split('/')[2] || ''
  const labels = url.hostname.split('.')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || authority.includes('@')
    || !labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
    || (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)) || url.href.length > 2048) throw new Error(URL_ERROR)
  return url.href
}

export function teamLeagueScopeKey(scope) {
  if (!scope?.userId || !scope?.teamId || scope.offline || scope.active === false) return ''
  if (scope.kind === 'coach') return JSON.stringify(['coach', scope.userId, scope.clubId, scope.teamId, scope.role, scope.roleRank, scope.canMutate])
  if (scope.kind === 'parent' || scope.kind === 'player') {
    if (!scope.linkId || !scope.playerId) return ''
    return JSON.stringify([scope.kind, scope.userId, scope.clubId, scope.teamId, scope.linkId, scope.playerId])
  }
  return ''
}

export function normalizeTeamLeagueState(data, scope) {
  const row = Array.isArray(data) ? data[0] : data
  if (!row || row.team_id !== scope.teamId) throw new Error('The selected team league is unavailable. Refresh your team access.')
  return Object.freeze({
    teamId: row.team_id,
    teamName: String(row.team_name || ''),
    url: normalizeTeamLeagueUrl(row.league_url),
    enabled: row.league_link_enabled === true,
    canEdit: scope.kind === 'coach' && scope.canMutate === true && row.can_edit === true,
  })
}

export async function readTeamLeagueLink(client, scope) {
  if (!teamLeagueScopeKey(scope)) throw new Error('Connect and choose an authorised team or player first.')
  const coach = scope.kind === 'coach'
  const { data, error } = await client.rpc(coach ? 'get_team_league_url' : 'get_parent_player_team_league_url', coach
    ? { team_id_value: scope.teamId }
    : { link_id_value: scope.linkId, link_type_value: scope.kind })
  if (error) throw new Error('The team league link could not be loaded. Refresh your team access and try again.')
  return normalizeTeamLeagueState(data, scope)
}

export async function saveTeamLeagueLink(client, scope, values) {
  if (!teamLeagueScopeKey(scope) || scope.kind !== 'coach' || scope.canMutate !== true) throw new Error('Team Admin access is required for this team.')
  const url = normalizeTeamLeagueUrl(values.url)
  const { data, error } = await client.rpc('set_team_league_url', {
    team_id_value: scope.teamId, url_value: url || null, enabled_value: values.enabled === true,
  })
  if (error) throw new Error('The league link could not be saved. Refresh your Team Admin access and try again.')
  return normalizeTeamLeagueState(data, scope)
}

export async function openTeamLeagueWebsite(value, opener, isCurrent = () => true) {
  const url = normalizeTeamLeagueUrl(value)
  if (!url) throw new Error('No league website is available.')
  if (!isCurrent()) return false
  const supported = await opener.canOpenURL(url)
  if (!isCurrent()) return false
  if (!supported) throw new Error('No browser is available to open the league website.')
  try { await opener.openURL(url) } catch { throw new Error('The league website could not be opened. Try again later.') }
  return true
}

// Every visit gets a new gate, including A to B to A switches. No URL is cached.
export function createTeamLeagueRequestGate() {
  let generation = 0, active = true, saving = null
  return {
    begin: () => ++generation,
    beginSave: () => { if (!active || saving !== null) return null; saving = ++generation; return saving },
    finishSave: token => { if (saving === token) saving = null },
    isActive: () => active,
    activate: () => { active = true },
    isCurrent: token => active && token === generation,
    invalidate: () => { active = false; generation += 1; saving = null },
  }
}
