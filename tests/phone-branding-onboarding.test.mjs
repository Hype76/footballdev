import assert from 'node:assert/strict'
import test from 'node:test'
import { buildClubAppearanceSetupUrl } from '../src/lib/team-branding-onboarding.js'
import { assertTeamBrandingManagementScope, buildTeamBrandingSetupUrl, canOfferTeamBrandingSetup,
  COACH_BRANDING_RETURN_URL, isCoachBrandingReturn, readBrandingSetupSelection, requestTeamBrandingSetup } from '../src/lib/team-branding-onboarding.js'

const teamId = '30000000-0000-4000-8000-000000000040'
const clubId = '10000000-0000-4000-8000-000000000001'
const actorId = '20000000-0000-4000-8000-000000000001'
const state = { enabled: true, teamId, clubId, state: 'unclaimed', logoAllowed: false, coloursAllowed: false }

test('setup links retain only allowlisted origin, fixed path and non-secret team selector', () => {
  const url = new URL(buildTeamBrandingSetupUrl('https://footballplayer.online', teamId))
  assert.equal(url.pathname, '/team-branding'); assert.deepEqual([...url.searchParams], [['teamId', teamId], ['from', 'coach']])
  assert.equal(new URL(buildTeamBrandingSetupUrl('https://footballplayer-mobile-test-api.netlify.app', teamId)).hostname, 'footballplayer-mobile-test-api.netlify.app')
  for (const origin of ['https://evil.test', 'http://footballplayer.online', 'https://footballplayer.online.evil.test',
    'https://user:password@footballplayer.online', 'https://footballplayer.online/path', 'https://footballplayer.online?token=secret']) {
    assert.throws(() => buildTeamBrandingSetupUrl(origin, teamId))
  }
  assert.throws(() => buildTeamBrandingSetupUrl('https://footballplayer.online', 'not-a-team'))
})
test('incoming return destinations and tokens are never reflected or accepted', () => {
  assert.deepEqual(readBrandingSetupSelection(`?teamId=${teamId}&from=coach&returnTo=https://evil.test&token=secret`), { teamId, fromCoach: true })
  assert.equal(readBrandingSetupSelection('?teamId=invalid').teamId, '')
  assert.equal(isCoachBrandingReturn(COACH_BRANDING_RETURN_URL), true)
  for (const url of [`${COACH_BRANDING_RETURN_URL}?token=secret`, 'evil://branding-return', 'footballplayercoach://branding-return/other', null]) assert.equal(isCoachBrandingReturn(url), false)
})
test('native prompt requires an online active team authority and excludes ordinary Coaches and offline/suspended users', () => {
  const context = { teamId, clubId, role: 'head_manager', roleRank: 70 }
  const user = { id: actorId, accountStatus: 'active' }
  assert.equal(canOfferTeamBrandingSetup(context, user), true)
  assert.equal(canOfferTeamBrandingSetup({ ...context, role: 'admin' }, user), true)
  for (const denied of [{ ...context, role: 'coach' }, { ...context, roleRank: 50 }, { ...context, teamId: '' }]) assert.equal(canOfferTeamBrandingSetup(denied, user), false)
  for (const denied of [{ ...user, isOfflineProfile: true }, { ...user, testerAccessExpired: true }, { ...user, accountStatus: 'suspended' }]) assert.equal(canOfferTeamBrandingSetup(context, denied), false)
})
test('management response cannot grant another team/club or malformed entitlement', () => {
  assert.equal(assertTeamBrandingManagementScope(state, teamId, clubId), state)
  assert.deepEqual(assertTeamBrandingManagementScope({ enabled: false }, teamId), { enabled: false })
  for (const invalid of [{ ...state, teamId: actorId }, { ...state, clubId: actorId }, { ...state, logoAllowed: 'true' }, { ...state, state: 'unknown' }, null]) {
    assert.throws(() => assertTeamBrandingManagementScope(invalid, teamId, clubId))
  }
})
test('browser request authenticates independently in a header, fixes team/action and rejects account changes before mutation', async () => {
  const calls = []
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-browser-token', user: { id: actorId } } } }) } }
  const fetcher = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => state } }
  await requestTeamBrandingSetup({ client, fetcher, teamId, action: 'claim', expectedActorId: actorId, extra: { teamId: clubId, action: 'save', termsVersion: 'v1' } })
  assert.equal(calls[0].url, '/.netlify/functions/manage-team-branding')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer synthetic-browser-token')
  assert.deepEqual(JSON.parse(calls[0].options.body), { teamId, action: 'claim', termsVersion: 'v1' })
  await assert.rejects(requestTeamBrandingSetup({ client, fetcher, teamId, action: 'save', expectedActorId: clubId }), /Sign in/)
  assert.equal(calls.length, 1)
})
test('exhausted places and upload failures surface server errors without fabricating a reservation', async () => {
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic' } } }) } }
  await assert.rejects(requestTeamBrandingSetup({ client, teamId, action: 'claim', fetcher: async () => ({ ok: false, status: 409, json: async () => ({ message: 'All promotional places have been claimed.' }) }) }), error => error.status === 409 && /All promotional/.test(error.message))
  await assert.rejects(requestTeamBrandingSetup({ client, teamId, action: 'save', fetcher: async () => ({ ok: false, status: 502, json: async () => ({ message: 'Saved artwork was kept.' }) }) }), /Saved artwork was kept/)
})
test('paid Club phone setup is Club-admin-only even without an active team and fixes the browser target', () => {
  const context = { clubId, role: 'admin', roleRank: 90 }
  const admin = { id: 'actor', clubId, role: 'admin', roleRank: 90, planKey: 'club' }
  assert.equal(canOfferTeamBrandingSetup(context, admin), true)
  assert.equal(canOfferTeamBrandingSetup({ ...context, teamId, role: 'head_manager', roleRank: 70 }, { ...admin, role: 'head_manager', roleRank: 70 }), false)
  assert.equal(buildClubAppearanceSetupUrl('https://footballplayer.online', clubId), `https://footballplayer.online/club-appearance?clubId=${clubId}`)
  assert.throws(() => buildClubAppearanceSetupUrl('https://footballplayer.online?token=secret', clubId))
})
