import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../apps/mobile-core/src/coachFixtureEditCore.js', import.meta.url), 'utf8')
const { canRemoveCoachCancelledFixture } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const context = { teamId: 'team', role: 'head_manager', roleRank: 70, paymentAccess: { canMutate: true } }
const fixture = { teamId: 'team', status: 'cancelled', sourceType: 'match_day', sourceId: 'fixture' }
test('cancelled fixture removal is limited to the active authorised team and Manager or Team Admin', () => {
  assert.equal(canRemoveCoachCancelledFixture({ context, fixture }), true)
  for (const changed of [{ ...fixture, status: 'scheduled' }, { ...fixture, teamId: 'other' }, { ...fixture, sourceType: 'calendar_event' }]) assert.equal(canRemoveCoachCancelledFixture({ context, fixture: changed }), false)
  for (const changed of [{ ...context, roleRank: 30 }, { ...context, role: 'admin' }, { ...context, paymentAccess: { canMutate: false } }]) assert.equal(canRemoveCoachCancelledFixture({ context: changed, fixture }), false)
  assert.equal(canRemoveCoachCancelledFixture({ context, fixture, stale: true }), false)
})
test('native removal rechecks cancellation and current session before using the audited server action', async () => {
  const data = readFileSync(new URL('../apps/mobile-core/src/coachMatchDayData.js', import.meta.url), 'utf8')
  const body = data.slice(data.indexOf('export async function removeCoachCancelledFixture'), data.indexOf('export async function cancelCoachMatchDayFixture')).replace('export ', '')
  let match = { id: 'fixture', status: 'cancelled' }, actor = 'coach', calls = []
  const supabase = { auth: { getSession: async () => ({ data: { session: { user: { id: actor } } } }) }, rpc: async (name, parameters) => { calls.push({ name, parameters }); return { data: { deleted: true } } } }
  const remove = new Function('getCoachMatchDayDetail', 'prepareMutation', 'supabase', `${body}; return removeCoachCancelledFixture`)(async () => match, async (_user, _match, rank) => assert.equal(rank, 50), supabase)
  await remove({ id: 'coach' }, 'fixture')
  assert.deepEqual(calls, [{ name: 'delete_previous_match_day_v2', parameters: { match_day_id_value: 'fixture' } }])
  calls = []; match = { ...match, status: 'scheduled' }
  await assert.rejects(remove({ id: 'coach' }, 'fixture'), /cancelled/)
  match = { ...match, status: 'cancelled' }; actor = 'other'
  await assert.rejects(remove({ id: 'coach' }, 'fixture'), /account changed/)
  actor = 'coach'; await assert.rejects(remove({ id: 'coach' }, 'fixture', () => false), /cancelled/)
  assert.equal(calls.length, 0)
})
