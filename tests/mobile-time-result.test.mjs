import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeFixtureTime } from '../apps/mobile-core/src/fixtureTime.js'
import { createCoachFixtureForm, validateCoachFixtureForm, calculateCoachArrivalTime } from '../apps/mobile-core/src/coachFixtureCore.js'
import { getParentMatchResult } from '../apps/parent-mobile/src/matchResult.js'

test('existing database times save at minute precision without editing the picker', () => {
  const form = createCoachFixtureForm({ match: { id: 'fixture', opponent: 'FP TEST', fixtureType: 'league', matchDate: '2099-09-19', kickoffTime: '10:45:00', arrivalTime: '10:00:00' } })
  assert.equal(form.kickoffTime, '10:45')
  assert.equal(form.arrivalTime, '10:00')
  assert.equal(validateCoachFixtureForm(form).kickoffTime, '10:45')
  assert.equal(validateCoachFixtureForm({ ...form, kickoffTime: '23:59:59', arrivalTime: '23:00:00' }).kickoffTime, '23:59')
  assert.equal(calculateCoachArrivalTime('00:15:00', '30'), '23:45')
  for (const invalid of ['24:00', '10:60', '10:45:99', 'abc']) assert.throws(() => validateCoachFixtureForm({ ...form, kickoffTime: invalid }))
  assert.equal(normalizeFixtureTime('10:45:00.000'), '10:45')
  assert.equal(validateCoachFixtureForm({ ...form, kickoffTimeTbc: true, kickoffTime: '' }).kickoffTime, '')
})

test('results follow our team position and recorded shootout winner', () => {
  const match = { status: 'full_time', homeScore: 1, awayScore: 2 }
  assert.equal(getParentMatchResult({ ...match, homeAway: 'away' }), 'won')
  assert.equal(getParentMatchResult({ ...match, homeAway: 'home' }), 'loss')
  assert.equal(getParentMatchResult({ ...match, homeScore: 2 }), 'draw')
  assert.equal(getParentMatchResult({ ...match, homeScore: 2, shootoutWinner: 'away', homeAway: 'away' }), 'won')
  assert.equal(getParentMatchResult({ ...match, status: 'scheduled' }), null)
  assert.equal(getParentMatchResult({ ...match, homeScore: null }), null)
})
