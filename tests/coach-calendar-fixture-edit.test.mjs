import assert from 'node:assert/strict'
import test from 'node:test'
import { canEditCoachFixture, canRemoveCoachCancelledFixture } from '../apps/mobile-core/src/coachFixtureEditCore.js'
import { normalizeCoachCalendarEvent } from '../apps/mobile-core/src/coachCalendarCore.js'

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

test('Club Admin fixture authority is restricted to the selected team in their club', () => {
  const admin = { ...context, clubId: 'club', role: 'admin', roleRank: 90 }
  const own = { ...fixture, clubId: 'club' }
  assert.equal(canEditCoachFixture({ context: admin, fixture: own }), true)
  const cancelled = { ...own, status: 'cancelled', sourceType: 'match_day', sourceId: 'fixture' }
  assert.equal(canRemoveCoachCancelledFixture({ context: admin, fixture: cancelled }), true)
  for (const change of [{ clubId: 'other' }, { clubId: '' }, { teamId: 'other' }, { teamId: '' }]) {
    assert.equal(canEditCoachFixture({ context: admin, fixture: { ...own, ...change } }), false)
    assert.equal(canRemoveCoachCancelledFixture({ context: admin, fixture: { ...cancelled, ...change } }), false)
  }
})

test('calendar fixture retains its club for Club Admin scope checks', () => {
  const event = normalizeCoachCalendarEvent({ id: 'fixture', club_id: 'club', team_id: 'team', status: 'scheduled' }, 'match_day')
  assert.equal(event.clubId, 'club')
  assert.equal(canEditCoachFixture({ context: { ...context, clubId: 'club', role: 'admin', roleRank: 90 }, fixture: event }), true)
})
