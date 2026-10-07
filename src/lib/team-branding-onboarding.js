import { getWorkspaceScope } from './workspace-scope.js'

export const TEAM_BRANDING_SETUP_PATH = '/team-branding'
export const COACH_BRANDING_RETURN_URL = 'footballplayercoach://branding-return'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const API_ORIGINS = new Set(['https://footballplayer.online', 'https://footballplayer-mobile-test-api.netlify.app'])

export function readBrandingSetupSelection(search = '') {
  const params = new URLSearchParams(search)
  const teamId = params.get('teamId') || ''
  return { teamId: UUID.test(teamId) ? teamId : '', fromCoach: params.get('from') === 'coach' }
}

export function buildTeamBrandingSetupUrl(apiBaseUrl, teamId) {
  const base = new URL(apiBaseUrl)
  if (!UUID.test(teamId || '') || !API_ORIGINS.has(base.origin) || base.username || base.password
    || base.pathname !== '/' || base.search || base.hash) throw new Error('Team branding link is unavailable.')
  const url = new URL(TEAM_BRANDING_SETUP_PATH, base.origin)
  url.searchParams.set('teamId', teamId)
  url.searchParams.set('from', 'coach')
  return url.toString()
}

export function isCoachBrandingReturn(url) {
  // Only this fixed return signal is accepted. It carries no authority or save result.
  return url === COACH_BRANDING_RETURN_URL
}

export function canOfferTeamBrandingSetup(context, user) {
  const club = getWorkspaceScope(user).key === 'club'
  return Boolean(user?.id && !user.isOfflineProfile && (context?.teamId || club) && context?.clubId
    && !user.testerAccessExpired && (user.accountStatus || 'active') === 'active'
    && (club ? user.role === 'admin' && Number(user.roleRank) >= 90
      : context.role === 'admin' || (context.role === 'head_manager' && Number(context.roleRank) >= 70)))
}

export function buildClubAppearanceSetupUrl(apiBaseUrl, clubId) {
  const base = new URL(apiBaseUrl)
  if (!UUID.test(clubId || '') || !API_ORIGINS.has(base.origin) || base.username || base.password
    || base.pathname !== '/' || base.search || base.hash) throw new Error('Club branding link is unavailable.')
  const url = new URL('/club-appearance', base.origin)
  url.searchParams.set('clubId', clubId)
  return url.toString()
}

export function assertTeamBrandingManagementScope(value, teamId, clubId = '') {
  if (value?.enabled === false) return value
  if (value?.enabled !== true || value.teamId !== teamId || !UUID.test(value.clubId || '')
    || (clubId && value.clubId !== clubId)
    || !['unclaimed', 'provisional', 'grandfathered', 'permanent', 'failed'].includes(value.state)
    || typeof value.logoAllowed !== 'boolean' || typeof value.coloursAllowed !== 'boolean') {
    throw new Error('Team branding could not be verified. Try again.')
  }
  return value
}

export async function requestTeamBrandingSetup({ client, fetcher = fetch, teamId, action = 'read', extra = {}, signal, expectedActorId = '' }) {
  if (!UUID.test(teamId || '') || !['read', 'claim', 'save'].includes(action)) throw new Error('Choose a valid team.')
  const { data } = await client.auth.getSession()
  const token = data.session?.access_token
  if (!token || (expectedActorId && data.session?.user?.id !== expectedActorId)) throw new Error('Sign in to manage team branding.')
  const response = await fetcher('/.netlify/functions/manage-team-branding', {
    method: 'POST', signal, cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...extra, action, teamId }),
  })
  const value = await response.json()
  if (!response.ok) {
    const error = new Error(value.message || 'Team branding could not be updated.')
    error.status = response.status
    throw error
  }
  return assertTeamBrandingManagementScope(value, teamId)
}
