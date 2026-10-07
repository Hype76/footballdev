const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ORIGINS = new Set(['https://footballplayer.online', 'https://footballplayer-mobile-test-api.netlify.app'])
export const COACH_RESOURCE_RETURN_URL = 'footballplayercoach://resources-return'

export function buildCoachResourceUploadUrl(apiBaseUrl, user) {
  const base = new URL(apiBaseUrl)
  if (!ORIGINS.has(base.origin) || base.username || base.password || base.pathname !== '/' || base.search || base.hash
    || !UUID.test(user?.activeTeamId || '') || !UUID.test(user?.clubId || '')) throw new Error('Choose a team before uploading resources.')
  const url = new URL('/phone-resources', base.origin)
  url.searchParams.set('teamId', user.activeTeamId)
  url.searchParams.set('clubId', user.clubId)
  return url.toString()
}

export function readCoachResourceUploadScope(search) {
  const params = new URLSearchParams(search)
  const teamId = params.get('teamId') || ''
  const clubId = params.get('clubId') || ''
  return UUID.test(teamId) && UUID.test(clubId) ? { teamId, clubId } : null
}

export function isCoachResourceReturn(url) { return url === COACH_RESOURCE_RETURN_URL }

export function canOpenCoachResourceUpload(user, stale = false) {
  return Boolean(!stale && user?.id && !user.isOfflineProfile && !user.testerAccessExpired
    && (user.accountStatus || 'active') === 'active' && Number(user.roleRank) >= 50
    && !['parent_portal', 'adult_player', 'super_admin'].includes(user.role) && user.hasActivePlanAccess !== false
    && UUID.test(user.activeTeamId || '') && UUID.test(user.clubId || ''))
}

export async function verifyCoachResourceUploadScope(client, user, scope, actorId) {
  if (!scope || !UUID.test(scope.teamId || '') || !UUID.test(scope.clubId || '') || !actorId || user?.id !== actorId || user.clubId !== scope.clubId) throw new Error('Sign in to the same club account you use in Coach.')
  const [{ data: allowed, error: accessError }, { data: authority, error: authorityError }, { data: team, error: teamError }] = await Promise.all([
    client.rpc('current_user_can_manage_resource_library', { target_club_id: scope.clubId, target_team_id: scope.teamId }),
    client.rpc('get_phone_resource_upload_scope', { target_club_id: scope.clubId, target_team_id: scope.teamId }),
    client.from('teams').select('id,club_id,name').eq('id', scope.teamId).eq('club_id', scope.clubId).maybeSingle(),
  ])
  if (accessError || authorityError || teamError || allowed !== true || team?.id !== scope.teamId || team.club_id !== scope.clubId
    || authority?.actorId !== actorId || authority.clubId !== scope.clubId || authority.teamId !== scope.teamId
    || !Number.isFinite(Number(authority.roleRank)) || Number(authority.roleRank) < 50 || !['head_manager', 'manager', 'admin'].includes(authority.role)) throw new Error('You do not have resource upload access to this team. Your existing resources have not changed.')
  return { ...user, activeTeamId: team.id, activeTeamName: team.name, role: authority.role, roleRank: Number(authority.roleRank), roleLabel: authority.roleLabel }
}
