import assert from 'node:assert/strict'
import test from 'node:test'
import { canEditCoachFixture } from '../apps/mobile-core/src/coachFixtureEditCore.js'

const context = { teamId: 'team', role: 'coach', roleRank: 30, paymentAccess: { canMutate: true } }
const fixture = { id: 'fixture', teamId: 'team', status: 'scheduled' }

test('fixture editing is available only for editable fixtures in an authorised online Team context', () => {
  for (const status of ['scheduled', 'scorer_request', 'postponed']) assert.equal(canEditCoachFixture({ context, fixture: { ...fixture, status } }), true)
  for (const status of ['live', 'full_time', 'completed', 'cancelled', '']) assert.equal(canEditCoachFixture({ context, fixture: { ...fixture, status } }), false)
  for (const change of [{ id: '' }, { teamId: 'other-team' }, { deletedAt: 'saved' }, { previousHiddenAt: 'saved' }, { concludedAt: 'saved' }]) assert.equal(canEditCoachFixture({ context, fixture: { ...fixture, ...change } }), false)
  for (const change of [{ teamId: '' }, { roleRank: 10 }, { paymentAccess: { canMutate: false } }, ...['admin', 'super_admin', 'parent_portal', 'adult_player'].map(role => ({ role }))]) assert.equal(canEditCoachFixture({ context: { ...context, ...change }, fixture }), false)
  assert.equal(canEditCoachFixture({ context, fixture, stale: true }), false)
  assert.equal(canEditCoachFixture(), false)
})
