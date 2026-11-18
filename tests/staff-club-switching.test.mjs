import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { isClubAdmin, isSuperAdmin } from '../src/lib/auth-permissions.js'
import { getWorkspaceScope } from '../src/lib/workspace-scope.js'

process.env.VITE_SUPABASE_URL = 'https://staff-switch.example.test'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'
const { fetchUserProfile, selectUserClub, supabase } = await import('../src/lib/domain/core.js')
const { invalidateMemoryCacheByPrefix } = await import('../src/lib/domain/cache-store.js')
const authUser = { id: 'staff-switch-user', email: 'staff@example.test', user_metadata: {} }
const clubs = ['club-a', 'club-b', 'club-c'].map((id, index) => ({ id, name: 'Linked club ' + index, status: 'active', plan_key: 'small_club', plan_status: 'active' }))
const membership = club => ({ auth_user_id: authUser.id, club_id: club.id, role: 'coach', role_rank: 30, status: 'active', clubs: club })

function mockStaffServer(t) {
 const state = { activeClubId: clubs[0].id, memberships: clubs.slice(0, 2).map(membership), membershipReads: 0, activations: [] }
 invalidateMemoryCacheByPrefix('user-profile:' + authUser.id)
 for (const club of clubs) invalidateMemoryCacheByPrefix('club:' + club.id)
 t.mock.method(supabase, 'rpc', async (name, args) => {
  if (name === 'get_own_adult_player_account_state') return { data: null }
  if (['accept_own_club_user_invites', 'list_fan_connections'].includes(name)) return { data: [] }
  assert.equal(name, 'activate_own_club_membership')
  assert.ok(state.memberships.some(row => row.club_id === args.target_club_id))
  state.activeClubId = args.target_club_id; state.activations.push(args.target_club_id)
  return { data: { id: authUser.id, email: authUser.email, role: 'coach', role_rank: 30, status: 'active', club_id: state.activeClubId } }
 })
 t.mock.method(supabase, 'from', table => {
  const filters = new Map()
  const rows = () => {
   if (table === 'users') { assert.equal(filters.get('id'), authUser.id); return { id: authUser.id, email: authUser.email, role: 'coach', role_rank: 30, status: 'active', club_id: state.activeClubId } }
   if (table === 'user_club_memberships') { assert.equal(filters.get('auth_user_id'), authUser.id); state.membershipReads++; return state.memberships }
   if (table === 'parent_player_links') { assert.equal(filters.get('auth_user_id'), authUser.id); return [] }
   assert.equal(table, 'clubs'); return clubs.find(club => club.id === filters.get('id'))
  }
  const query = { select() { return query }, eq(key, value) { filters.set(key, value); return query }, order() { return query }, maybeSingle: async () => ({ data: rows() }), then: resolve => resolve({ data: rows() }) }
  return query
 })
 return state
}

test('actual staff profile refresh retains every own linked club and updates changed memberships', async t => {
 const server = mockStaffServer(t)
 const options = { selectedClubId: clubs[0].id, selectedAccessMode: 'team', loginAccessIntent: 'team' }
 const initial = await fetchUserProfile(authUser, options)
 assert.deepEqual(initial.clubOptions.map(option => option.clubId), ['club-a', 'club-b'])
 assert.equal(initial.clubId, clubs[0].id); assert.equal(initial.role, 'coach')
 server.memberships = clubs.map(membership)
 invalidateMemoryCacheByPrefix('user-profile:' + authUser.id)
 const refreshed = await fetchUserProfile(authUser, options)
 assert.deepEqual(refreshed.clubOptions.map(option => option.clubId), ['club-a', 'club-b', 'club-c'])
 assert.ok(refreshed.clubOptions.every(option => option.role === 'coach'))
 assert.equal(refreshed.clubId, clubs[0].id)
 assert.equal(server.membershipReads, 2)
 assert.deepEqual(server.activations, [])
})

function loadAuthCallback(name, nextName, dependencies) {
 const source = readFileSync('src/lib/auth.js', 'utf8')
 const start = source.indexOf('  const ' + name + ' = '), end = source.indexOf('  const ' + nextName + ' = ', start)
 assert.ok(start >= 0 && end > start)
 return new Function(...Object.keys(dependencies), source.slice(start, end) + '; return ' + name)(...Object.values(dependencies))
}

test('actual selectClub commits returned own memberships together with the selected club team', async t => {
 const server = mockStaffServer(t); server.memberships = clubs.map(membership)
 const storage = new Map([['team', 'old-club-team'], ['club', clubs[0].id]])
 const state = { clubOptions: ['old-options'], user: null, loading: [], teamOptions: null }
 const selectedTeam = { id: 'club-b-team', name: 'Linked team', assignmentRole: 'coach', assignmentRoleLabel: 'Coach', assignmentRoleRank: 30 }
 const window = { location: { pathname: '/coach' }, sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } }
 const source = readFileSync('src/lib/auth.js', 'utf8')
 const roleStart = source.indexOf('function applyContextualTeamRole('), roleEnd = source.indexOf('const PARENT_ACCESS_OPTION', roleStart)
 const applyContextualTeamRole = new Function('isClubAdmin', 'getWorkspaceScope', source.slice(roleStart, roleEnd) + '; return applyContextualTeamRole')(isClubAdmin, getWorkspaceScope)
 const applyTeamSelection = loadAuthCallback('applyTeamSelection', 'applyDemoRolePreview', {
  isSuperAdmin, isClubAdmin, applyContextualTeamRole, window, SELECTED_TEAM_STORAGE_KEY: 'team',
  setTeamOptions: value => { state.teamOptions = value },
  loadTeamDataModule: async () => ({ getTeams: () => { throw new Error('Coach must use assigned teams') }, getAssignedTeamsForUser: async profile => { assert.equal(profile.clubId, clubs[1].id); return [selectedTeam] } }),
 })
 const selectClub = loadAuthCallback('selectClub', 'selectAccessMode', {
  authUser, window, applyTeamSelection, loadAuthDataModule: async () => ({ selectUserClub }), clearLoginAccessIntent() {},
  SELECTED_ACCESS_MODE_STORAGE_KEY: 'mode', SELECTED_ACCESS_MODE_EXPLICIT_KEY: 'explicit', SELECTED_CLUB_STORAGE_KEY: 'club', SELECTED_TEAM_STORAGE_KEY: 'team',
  setAuthError: value => { state.error = value }, setIsProfileLoading: value => state.loading.push(value),
  setClubOptions: value => { state.clubOptions = value }, setUser: value => { state.user = value }, applyDemoRolePreview: value => value,
  setAccessRouteMismatch: value => { state.mismatch = value }, session: { access_token: 'local-test-token' }, recordAnalyticsEvent: async () => {},
 })
 const profile = await selectClub(clubs[1].id)
 assert.deepEqual(state.clubOptions.map(option => option.clubId), ['club-a', 'club-b', 'club-c'])
 assert.deepEqual(state.clubOptions, profile.clubOptions)
 assert.equal(state.user.clubId, clubs[1].id); assert.equal(state.user.activeTeamId, selectedTeam.id)
 assert.equal(profile.activeTeamName, selectedTeam.name); assert.equal(profile.role, 'coach')
 assert.equal(storage.get('club'), clubs[1].id); assert.equal(storage.get('team'), selectedTeam.id)
 assert.equal(storage.get('mode'), 'team'); assert.equal(storage.get('explicit'), 'true')
 assert.deepEqual(state.loading, [true, false]); assert.equal(state.error, '')
 assert.deepEqual(server.activations, [clubs[1].id])
})
