import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  expiryDurationToHours,
  expiryDurationToIso,
  formatExpiryDurationFromHours,
  parseExpiryDuration,
} from '../src/lib/expiry-duration.js'

test('DD:HH:MM expiry accepts days, hours, and minutes without losing precision', () => {
  const duration = parseExpiryDuration('02:06:30')

  assert.equal(duration.days, 2)
  assert.equal(duration.hours, 6)
  assert.equal(duration.minutes, 30)
  assert.equal(duration.totalMinutes, 3270)
  assert.equal(expiryDurationToHours('00:00:01'), 1 / 60)
  assert.equal(formatExpiryDurationFromHours(54.5), '02:06:30')
  assert.equal(
    expiryDurationToIso('00:01:30', { now: Date.parse('2026-08-25T12:00:00.000Z') }),
    '2026-08-25T13:30:00.000Z',
  )
})

test('DD:HH:MM expiry allows an optional blank but rejects invalid or unsafe durations', () => {
  assert.equal(parseExpiryDuration('', { allowBlank: true }), null)
  assert.equal(expiryDurationToIso('', { allowBlank: true }), '')
  for (const invalid of ['00:00:00', '00:24:00', '00:02:60', '31:00:00', '2 hours']) {
    assert.throws(() => parseExpiryDuration(invalid), /Use DD:HH:MM/)
  }
})

test('web and Coach app use the same DD:HH:MM expiry contract', async () => {
  const [matchDay, polls, coachFixture, coachPolls, migration] = await Promise.all([
    readFile(new URL('../src/pages/MatchDayPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/PollsPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachFixtureForm.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260825160000_poll_expiry_dd_hh_mm_102.sql', import.meta.url), 'utf8'),
  ])

  assert.match(matchDay, /Vote expiry \(DD:HH:MM\)/)
  assert.match(polls, /Poll expiry \(DD:HH:MM\)/)
  assert.match(coachFixture, /Poll expiry \(DD:HH:MM\)/)
  assert.match(coachPolls, /Poll expiry \(DD:HH:MM\), optional/)
  assert.match(migration, /motm_poll_expiry_hours type numeric\(8, 4\)/)
  assert.match(migration, /make_interval\([\s\S]*mins =>/)
})
