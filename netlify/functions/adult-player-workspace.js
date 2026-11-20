import { Buffer } from 'node:buffer'
import { createPublicSupabaseClient, createSupabaseAdminClient } from './lib/_supabase.js'
import { getClubPlanProfile, assertPlanEntitlement, canUsePlanEntitlement } from './lib/_plan-gate.js'
import { loadFanSchedule, loadFanMatches } from './lib/_fan-schedule.js'
import { loadFanPlayerStats } from './lib/_fan-player-stats.js'
import { listFanResources } from './lib/_player-event-resources.js'
import { loadAdultPlayerCalendarExtras, enrichAdultPlayerMatches } from './lib/_adult-player-workspace-read.js'

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }, body: JSON.stringify(body) })
const denied = () => Object.assign(new Error('Player access is not available. Sign in again or ask your club.'), { statusCode: 403 })
const one = async (query) => {
  const result = await query.maybeSingle()
  if (result.error) throw result.error
  if (!result.data) throw denied()
  return result.data
}

// This projection contains display scope only. It never represents Parent authority.
export async function loadAdultPlayerWorkspaceScope(admin, caller, token) {
  const { data: auth, error: authError } = await caller.auth.getUser(token)
  if (authError || !auth?.user?.id) throw Object.assign(new Error('Sign in to continue.'), { statusCode: 401 })
  const actor = auth.user
  if (!actor.email_confirmed_at || (actor.banned_until && Date.parse(actor.banned_until) > Date.now())) throw denied()
  const { data, error } = await caller.rpc('get_own_adult_player_account_state')
  if (error) throw error
  const states = Array.isArray(data) ? data : data ? [data] : []
  if (states.length !== 1) throw denied()
  const state = states[0]
  if (state.user_id !== actor.id || state.access_granted !== true || state.access_mode !== 'player'
    || state.link_status !== 'active' || !state.verified_at || !state.link_id || !state.player_id || !state.team_id || !state.club_id) throw denied()
  const [player, club, team, suspended] = await Promise.all([
    one(admin.from('players').select('id,player_name,club_id,team_id,status,archived_at,contact_type,parent_contacts').eq('id', state.player_id).eq('club_id', state.club_id).eq('team_id', state.team_id).eq('status', 'active').is('archived_at', null)),
    one(admin.from('clubs').select('id,name,status,archived_at').eq('id', state.club_id).eq('status', 'active').is('archived_at', null)),
    one(admin.from('teams').select('id,club_id,status,archived_at').eq('id', state.team_id).eq('club_id', state.club_id).eq('status', 'active').is('archived_at', null)),
    admin.from('users').select('id,role,club_id,status').eq('id', actor.id).eq('status', 'suspended'),
  ])
  if (suspended.error) throw suspended.error
  if ((suspended.data || []).some(user => ['parent_portal', 'adult_player'].includes(user.role) || user.club_id === club.id)) throw denied()
  const email = String(actor.email || '').trim().toLowerCase()
  const contacts = Array.isArray(player.parent_contacts) ? player.parent_contacts : []
  const selfEmails = [...new Set(contacts.filter(contact => String(contact.type ?? contact.contactType ?? '').trim().toLowerCase() === 'self').map(contact => String(contact.email ?? contact.parentEmail ?? '').trim().toLowerCase()).filter(Boolean))]
  if (!email || !['self', 'both'].includes(player.contact_type) || selfEmails.length !== 1 || selfEmails[0] !== email) throw denied()
  return { state, player, club, team, parent: { club_id: club.id, team_id: team.id }, fan: { club_id: club.id, relationship_type: 'player' }, suppressParentFormation: true }
}

export async function handleAdultPlayerWorkspace(event, {
  createAdmin = createSupabaseAdminClient,
  createCaller = (request, token) => createPublicSupabaseClient(request, { global: { headers: { Authorization: `Bearer ${token}` } } }),
  getPlan = getClubPlanProfile,
  assertEntitlement = assertPlanEntitlement,
  featureIncluded = canUsePlanEntitlement,
  loadSchedule = loadFanSchedule,
  loadMatches = loadFanMatches,
  loadStats = loadFanPlayerStats,
  loadResources = listFanResources,
  loadCalendarExtras = loadAdultPlayerCalendarExtras,
  enrichMatches = enrichAdultPlayerMatches,
} = {}) {
  if (event.httpMethod !== 'POST') return json(405, { message: 'Method not allowed.' })
  if (Buffer.byteLength(event.body || '') > 8192) return json(413, { message: 'Request is too large.' })
  try {
    const body = JSON.parse(event.body || '{}')
    if (!['profile', 'workspace', 'stats', 'openResource'].includes(body.action)) return json(400, { message: 'Choose a valid Player action.' })
    const token = String(event.headers?.authorization || event.headers?.Authorization || '').match(/^Bearer\s+(\S+)$/i)?.[1]
    if (!token) return json(401, { message: 'Sign in to continue.' })
    const admin = createAdmin(event)
    const scope = await loadAdultPlayerWorkspaceScope(admin, createCaller(event, token), token)
    if (body.expectedLinkId !== undefined && body.expectedLinkId !== scope.state.link_id) throw denied()
    const profile = { ...await getPlan(scope.club.id, { client: admin }), role: 'adult_player', roleLabel: 'Player', roleRank: 0, teamId: scope.team.id, activeTeamId: scope.team.id, playerId: scope.player.id }
    assertEntitlement(profile, 'parentPortal', { actionCategory: 'READ' })
    const featureAllowed = (feature) => featureIncluded(profile, feature)
    const link = { id: scope.state.link_id, linkType: 'adult_player', playerId: scope.player.id, playerName: scope.player.player_name, clubId: scope.club.id, clubName: scope.club.name, teamId: scope.team.id, teamName: scope.state.team_name, clubLogoUrl: scope.state.club_logo_url, themeAccent: scope.state.theme_accent, themeButtonStyle: scope.state.theme_button_style }
    const capabilities = { calendar: featureAllowed('teamCalendar'), calendarDetails: featureAllowed('teamCalendar'), calendarResources: featureAllowed('teamCalendar') && featureAllowed('resourceLibrary'), matchEvents: featureAllowed('matchDay') && featureAllowed('fixtures'), matches: featureAllowed('matchDay') && featureAllowed('fixtures'), resources: featureAllowed('resourceLibrary'), development: false, messages: false, notifications: true, chat: featureAllowed('parentChat'), polls: featureAllowed('teamPolls'), communication: false, transport: false, scorer: false, calendarFeed: false }
    const base = { link, planKey: profile.planKey, planStatus: profile.planStatus, capabilities }
    if (body.action === 'profile') return json(200, base)
    if (body.action === 'stats') {
      for (const feature of ['matchDay', 'fixtures']) assertEntitlement(profile, feature, { actionCategory: 'READ' })
      return json(200, { stats: await loadStats(admin, scope) })
    }
    if (body.action === 'openResource') {
      assertEntitlement(profile, 'resourceLibrary', { actionCategory: 'READ' })
      let resources
      if (body.calendarEventId) {
        assertEntitlement(profile, 'teamCalendar', { actionCategory: 'READ' })
        const calendar = await loadSchedule(admin, scope, new Date(), { featureAllowed, includeResources: false })
        const extras = await loadCalendarExtras(admin, scope, calendar, { includeResources: true })
        resources = extras.calendarResources.filter(resource => resource.eventId === body.calendarEventId && resource.occurrenceDate === body.calendarOccurrenceDate)
      } else resources = await loadResources(admin, scope)
      if (!resources.some(resource => resource.id === body.resourceId)) throw denied()
      const item = await one(admin.from('resource_library_items').select('id,club_id,team_id,archived_at,mime_type,storage_bucket,storage_path').eq('id', body.resourceId).eq('club_id', scope.club.id).eq('team_id', scope.team.id).is('archived_at', null))
      if (item.mime_type === 'application/vnd.footballplayer.formation-board+json') throw denied()
      const external = await admin.from('resource_library_external_links').select('external_url').eq('resource_id', item.id).eq('club_id', scope.club.id).eq('team_id', scope.team.id).maybeSingle()
      if (external.error) throw external.error
      if (external.data) {
        const url = new URL(external.data.external_url)
        if (!['http:', 'https:'].includes(url.protocol)) throw denied()
        return json(200, { accessType: 'external_link', accessUrl: url.href })
      }
      const segments = String(item.storage_path || '').split('/')
      if (item.storage_bucket !== 'resource-library' || segments.length < 3 || segments[0] !== scope.club.id || segments[1] !== scope.team.id || segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) throw denied()
      const signed = await admin.storage.from('resource-library').createSignedUrl(item.storage_path, 60)
      if (signed.error || !signed.data?.signedUrl) throw signed.error || denied()
      return json(200, { accessType: 'file', accessUrl: signed.data.signedUrl })
    }
    const errors = {}
    const read = async (key, enabled, loader) => {
      if (!enabled) return []
      try { return await loader() } catch { errors[key] = 'This information could not be loaded. Try again.'; return [] }
    }
    const [calendar, matches, resources] = await Promise.all([
      read('calendar', featureAllowed('teamCalendar'), () => loadSchedule(admin, scope, new Date(), { featureAllowed, includeResources: false })),
      read('matches', featureAllowed('matchDay') && featureAllowed('fixtures'), async () => enrichMatches(admin, scope, await loadMatches(admin, scope, '', { includeScheduled: true }))),
      read('resources', featureAllowed('resourceLibrary'), () => loadResources(admin, scope)),
    ])
    let extras = { calendarDetails: [], calendarResources: [] }
    if (calendar.length) {
      try { extras = await loadCalendarExtras(admin, scope, calendar, { includeResources: featureAllowed('resourceLibrary') }) }
      catch { errors.calendarDetails = 'Calendar details or attachments could not be loaded. Try again.'; errors.calendarResources = errors.calendarDetails }
    }
    return json(200, { ...base, calendar, matches, resources, ...extras, development: [], messages: [], notifications: [], polls: [], errors })
  } catch (error) {
    const status = error.statusCode || error.status || (error instanceof SyntaxError ? 400 : 500)
    return json(status, { message: status >= 500 ? 'Player information could not be loaded. Please try again.' : error.message })
  }
}

export const handler = (event) => handleAdultPlayerWorkspace(event)
