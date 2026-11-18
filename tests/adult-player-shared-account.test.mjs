import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { resolveAccessModeForRoute } from '../src/lib/parent-auth-intent.js'

process.env.VITE_SUPABASE_URL ||= 'https://adult-player-route.example.test'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||= 'test-publishable-key'
const { fetchUserProfile, supabase } = await import('../src/lib/domain/core.js')
const { invalidateMemoryCacheByPrefix } = await import('../src/lib/domain/cache-store.js')

const core = await readFile(new URL('../src/lib/domain/core.js', import.meta.url), 'utf8')
const profiles = core.slice(core.indexOf('function normalizeAdultPlayerProfile('), core.indexOf('function buildParentAccessModeOptions('))
const start = core.indexOf('export async function fetchUserProfile(')
const resolver = core.slice(start, core.indexOf('\nexport ', start + 1)).replace('export ', '')
const childLinks = [{ id: 'child-link', playerId: 'child', clubId: 'child-club', teamId: 'child-team' }]
const adult = { linkId: 'adult-link', playerId: 'adult', clubId: 'adult-club', teamId: 'adult-team', accessGranted: true }

function resolve(accountState, links, options) {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null }) }
  const dependencies = {
    PLAN_KEYS: { individual: 'individual' }, USER_PROFILE_SELECT: '*',
    supabase: { from: () => query },
    getCachedResource: (_key, load) => load(), isDemoAccountValue: () => false,
    getAdultPlayerAccountState: async () => accountState,
    getParentPortalMemberships: async () => ({ links, lookupFailed: false }),
  }
  return new Function(...Object.keys(dependencies), `${profiles}\n${resolver}\nreturn fetchUserProfile({id:'same-account',email:'self@example.test'}, arguments[arguments.length-1])`)(...Object.values(dependencies), options)
}

test('shared login selects adult and Parent scopes without mixing player identifiers', async () => {
  for (const options of [{ selectedAccessMode: 'player' }, { loginAccessIntent: 'player' }]) {
    const result = await resolve(adult, childLinks, options)
    assert.equal(result.role, 'adult_player')
    assert.equal(result.selectedPlayerId, 'adult')
    assert.equal(result.clubId, 'adult-club')
    assert.equal(result.parentPortalLinks, undefined)
    assert.deepEqual(result.accessModeOptions.map(option => option.id), ['parent'])
  }
  for (const options of [{}, { selectedAccessMode: 'parent' }]) {
    const result = await resolve(adult, childLinks, options)
    assert.equal(result.role, 'parent_portal')
    assert.equal(result.selectedPlayerId, 'child')
    assert.equal(result.clubId, 'child-club')
    assert.deepEqual(result.accessModeOptions.map(option => option.id), ['player'])
    assert.deepEqual(result.parentPortalLinks, childLinks)
  }
})

test('revoked adult access does not remove child access or offer an inactive Player switch', async () => {
  const revoked = { ...adult, accessGranted: false, denialCategory: 'link_revoked' }
  const parent = await resolve(revoked, childLinks, { selectedAccessMode: 'parent' })
  assert.equal(parent.role, 'parent_portal')
  assert.deepEqual(parent.accessModeOptions, [])
  const player = await resolve(revoked, childLinks, { selectedAccessMode: 'player' })
  assert.equal(player.adultPlayerAccessUnavailable, true)
  assert.equal(player.adultPlayerAccessReason, 'link_revoked')
})

test('adult-only login retains its existing Player profile', async () => {
  const result = await resolve(adult, [], {})
  assert.equal(result.role, 'adult_player')
  assert.deepEqual(result.accessModeOptions, [])
})

test('main Player links resolve the real verified shared profile while Parent host and revoked access stay bounded', async t => {
  const account = { id: 'real-shared-player-entry', email: 'self@example.test', user_metadata: {} }
  let granted = true
  let hasAdult = true
  let hasChildren = true
  const links = [{ id: 'child-link', auth_user_id: account.id, club_id: 'child-club', team_id: 'child-team', player_id: 'child', email: account.email,
    players: { player_name: 'Child' }, teams: { name: 'Child team' }, clubs: { name: 'Child club' } }]
  t.mock.method(supabase, 'rpc', async name => {
    if (name === 'get_own_adult_player_account_state') return { data: hasAdult ? [{ link_id: 'adult-link', user_id: account.id, player_id: 'adult', club_id: 'adult-club', team_id: 'adult-team', access_granted: granted, denial_category: granted ? '' : 'link_revoked' }] : [] }
    if (name === 'list_fan_connections') return { data: [] }
    if (name === 'get_team_branding_display') return { data: null }
    throw new Error('Unexpected authority mutation: ' + name)
  })
  t.mock.method(supabase, 'from', table => {
    const query = { select: () => query, eq: () => query, order: () => query,
      maybeSingle: async () => { assert.equal(table, 'users'); return { data: null } },
      then: resolve => { assert.ok(['parent_player_links', 'user_club_memberships'].includes(table)); return resolve({ data: table === 'parent_player_links' && hasChildren ? links : [] }) },
    }
    return query
  })
  const profile = async isParentHost => {
    invalidateMemoryCacheByPrefix('user-profile:' + account.id)
    const selectedAccessMode = resolveAccessModeForRoute({ isParentHost, pathname: '/player', selectedAccessMode: 'parent' })
    return fetchUserProfile(account, { selectedAccessMode })
  }
  const player = await profile(false)
  assert.equal(player.role, 'adult_player'); assert.equal(player.selectedPlayerId, 'adult')
  assert.deepEqual(player.accessModeOptions.map(option => option.id), ['parent'])
  const parent = await profile(true)
  assert.equal(parent.role, 'parent_portal'); assert.equal(parent.selectedPlayerId, 'child')
  granted = false
  const revoked = await profile(false)
  assert.equal(revoked.adultPlayerAccessUnavailable, true)
  assert.equal(revoked.adultPlayerAccessReason, 'link_revoked')
  assert.equal((await profile(true)).selectedPlayerId, 'child')
  hasAdult = false
  const parentOnly = await profile(false)
  assert.equal(parentOnly.role, 'parent_portal')
  assert.notEqual(parentOnly.role, 'adult_player')
  assert.equal(parentOnly.selectedPlayerId, 'child')
  hasChildren = false
  const unlinked = await profile(false)
  assert.equal(unlinked.teamAccessUnavailable, true)
  assert.equal(unlinked.role, undefined)
})
