import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCoachResourceUploadUrl, readCoachResourceUploadScope, canOpenCoachResourceUpload, isCoachResourceReturn, verifyCoachResourceUploadScope } from '../src/lib/coach-resource-upload-handoff.js'

const teamId = '30000000-0000-4000-8000-000000000040'
const clubId = '10000000-0000-4000-8000-000000000001'
const user = { id: 'actor', clubId, activeTeamId: teamId, roleRank: 50 }

test('phone upload link pins club and team without sharing credentials or arbitrary return destinations', () => {
  const url = new URL(buildCoachResourceUploadUrl('https://footballplayer.online', { ...user, access_token: 'secret' }))
  assert.equal(url.pathname, '/phone-resources')
  assert.deepEqual([...url.searchParams], [['teamId', teamId], ['clubId', clubId]])
  assert.deepEqual(readCoachResourceUploadScope(url.search), { teamId, clubId })
  for (const base of ['https://evil.test', 'https://footballplayer.online/extra', 'https://person:secret@footballplayer.online', 'https://footballplayer.online?token=secret']) assert.throws(() => buildCoachResourceUploadUrl(base, user))
  assert.equal(readCoachResourceUploadScope('?teamId=bad&clubId=' + clubId), null)
  assert.equal(isCoachResourceReturn('footballplayercoach://resources-return'), true)
  assert.equal(isCoachResourceReturn('footballplayercoach://resources-return?token=secret'), false)
})

test('upload action preserves online role and account boundary', () => {
  assert.equal(canOpenCoachResourceUpload(user), true)
  for (const blocked of [{ ...user, roleRank: 20 }, { ...user, role: 'parent_portal' }, { ...user, role: 'adult_player' }, { ...user, role: 'super_admin' }, { ...user, hasActivePlanAccess: false }, { ...user, isOfflineProfile: true }, { ...user, testerAccessExpired: true }, { ...user, accountStatus: 'suspended' }, { ...user, activeTeamId: '' }]) assert.equal(canOpenCoachResourceUpload(blocked), false)
  assert.equal(canOpenCoachResourceUpload(user, true), false)
})

function clientFor({ allowed = true, team = { id: teamId, club_id: clubId, name: 'Selected team' }, error = null } = {}) {
  const client = { calls: [], rpc: async (name, args) => { client.calls.push({ name, args }); return { data: allowed, error } } }
  client.from = () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: team, error }) }) }) }) })
  return client
}

test('fresh server authority and actual team scope are required before showing the uploader', async () => {
  const client = clientFor()
  const selected = await verifyCoachResourceUploadScope(client, user, { teamId, clubId }, 'actor')
  assert.equal(selected.activeTeamId, teamId)
  assert.equal(selected.activeTeamName, 'Selected team')
  assert.deepEqual(client.calls, [{ name: 'current_user_can_manage_resource_library', args: { target_club_id: clubId, target_team_id: teamId } }])
  for (const options of [{ allowed: false }, { allowed: null }, { error: new Error('unavailable') }, { team: { id: 'other', club_id: clubId } }, { team: { id: teamId, club_id: 'other' } }]) await assert.rejects(verifyCoachResourceUploadScope(clientFor(options), user, { teamId, clubId }, 'actor'))
  const unused = clientFor()
  await assert.rejects(verifyCoachResourceUploadScope(unused, user, { teamId, clubId }, 'someone-else'))
  await assert.rejects(verifyCoachResourceUploadScope(unused, { ...user, clubId: 'other' }, { teamId, clubId }, 'actor'))
  assert.equal(unused.calls.length, 0)
})
