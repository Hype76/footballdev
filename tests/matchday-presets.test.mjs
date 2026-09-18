import test from 'node:test'
import assert from 'node:assert/strict'
import { MATCHDAY_DEFAULT_FLAGS, validateMatchdayFlags } from '../src/lib/matchday-policy.js'
import { getMatchdayPreset, getMatchdayPresetFlags, getMatchdayPresetKey, MATCHDAY_PRESET_OPTIONS } from '../src/lib/matchday-presets.js'

test('presets are complete and dependency-valid', () => {
  assert.deepEqual(getMatchdayPresetFlags('standard'), MATCHDAY_DEFAULT_FLAGS)
  for (const preset of MATCHDAY_PRESET_OPTIONS) {
    assert.deepEqual(validateMatchdayFlags(preset.flags), preset.flags)
  }
})

test('fixtures-only keeps the approved fixture and parent capabilities', () => {
  const flags = getMatchdayPresetFlags('fixturesOnly')
  assert.equal(flags.players, true)
  assert.equal(flags.teamCalendar, true)
  assert.equal(flags.fixtures, true)
  assert.equal(flags.parentPortal, true)
  assert.equal(flags.parentInvitations, true)
  assert.equal(flags.parentEmails, true)
  assert.equal(flags.nativeAppEntitlement, true)
  assert.equal(flags.matchDay, false)
  assert.equal(flags.pdfReports, false)
})

test('presets do not inject baseline, role, or paid feature flags', () => {
  const flags = getMatchdayPresetFlags('fixturesOnly')
  assert.equal(Object.keys(flags).sort().join(','), Object.keys(MATCHDAY_DEFAULT_FLAGS).sort().join(','))
  assert.equal(Object.prototype.hasOwnProperty.call(flags, 'baseline'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(flags, 'roles'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(flags, 'paidFeatures'), false)
  assert.equal(flags.trainingEvents, false)
  assert.equal(flags.assessments, false)
  assert.equal(flags.customColoursBranding, false)
})

test('preset lookup is explicit and custom drafts are identifiable', () => {
  assert.equal(getMatchdayPreset('missing'), null)
  assert.equal(getMatchdayPresetKey(getMatchdayPresetFlags('standard')), 'standard')
  assert.equal(getMatchdayPresetKey({ ...MATCHDAY_DEFAULT_FLAGS, players: false }), null)
})
