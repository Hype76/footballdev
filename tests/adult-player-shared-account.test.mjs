import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

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
