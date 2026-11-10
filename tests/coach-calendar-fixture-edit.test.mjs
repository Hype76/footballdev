import assert from 'node:assert/strict'
import test from 'node:test'
import { canDeleteCoachFixture, canEditCoachFixture } from '../apps/mobile-core/src/coachFixtureEditCore.js'
import { createCoachFixtureForm, validateCoachFixtureForm } from '../apps/mobile-core/src/coachFixtureCore.js'

const context = { teamId: 'team', role: 'coach', roleRank: 30, paymentAccess: { canMutate: true } }
const fixture = { id: 'fixture', teamId: 'team', status: 'scheduled' }

test('fixture editing is available only for editable fixtures in an authorised online Team context', () => {
  for (const status of ['scheduled', 'scorer_request', 'postponed']) assert.equal(canEditCoachFixture({ context, fixture: { ...fixture, status } }), true)
  for (const status of ['live', 'full_time', 'completed', 'cancelled', '']) assert.equal(canEditCoachFixture({ context, fixture: { ...fixture, status } }), false)
  for (const change of [{ id: '' }, { teamId: 'other-team' }, { deletedAt: 'saved' }, { previousHiddenAt: 'saved' }]) assert.equal(canEditCoachFixture({ context, fixture: { ...fixture, ...change } }), false)
  for (const change of [{ teamId: '' }, { roleRank: 10 }, { paymentAccess: { canMutate: false } }, ...['admin', 'super_admin', 'parent_portal', 'adult_player'].map(role => ({ role }))]) assert.equal(canEditCoachFixture({ context: { ...context, ...change }, fixture }), false)
  assert.equal(canEditCoachFixture({ context, fixture, stale: true }), false)
  assert.equal(canEditCoachFixture(), false)
})

test('concluded matches can be edited on their original historical dates', () => {
  const historical = { ...fixture, status: 'full_time', matchDate: '2025-03-15', concludedAt: '2025-03-15T16:00:00Z', opponent: 'Historic FC' }
  assert.equal(canEditCoachFixture({ context, fixture: historical }), true)
  assert.equal(canEditCoachFixture({ context, fixture: { ...historical, previousHiddenAt: 'saved' } }), false)
  const form = createCoachFixtureForm({ match: historical })
  assert.equal(validateCoachFixtureForm(form, { concludedFixture: true }).matchDate, '2025-03-15')
  assert.throws(() => validateCoachFixtureForm({ ...form, fixtureType: 'league' }), /today or a future match date/)
  assert.throws(() => validateCoachFixtureForm({ ...form, matchDate: '2099-01-01' }, { concludedFixture: true }), /cannot be in the future/)
})

test('assigned coaches can delete a scheduled or historical match, with active and stale contexts protected', () => {
  const today = '2026-11-10'
  for (const state of [
    { status: 'scheduled', matchDate: '2026-11-15' },
    { status: 'full_time', matchDate: '2026-01-01' },
    { status: 'live', timerStatus: 'running', matchDate: '2026-01-01' },
  ]) assert.equal(canDeleteCoachFixture({ context, fixture: { ...fixture, ...state }, today }), true)
  for (const state of [
    { status: 'live', timerStatus: 'running', matchDate: today },
    { timerStatus: 'paused' }, { teamId: 'another-team' }, { deletedAt: 'saved' },
  ]) assert.equal(canDeleteCoachFixture({ context, fixture: { ...fixture, ...state }, today }), false)
  assert.equal(canDeleteCoachFixture({ context, fixture, stale: true }), false)
  assert.equal(canDeleteCoachFixture({ context: { ...context, role: 'assistant_coach', roleRank: 20 }, fixture }), false)
})
