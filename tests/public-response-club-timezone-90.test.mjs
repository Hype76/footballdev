import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  DEFAULT_CLUB_TIME_ZONE,
  formatClubDateTime,
  resolveClubTimeZone,
} from '../netlify/functions/lib/_club-date-time.js'

test('public response timestamps use the UK club timezone across daylight saving', () => {
  const summer = formatClubDateTime('2026-08-24T13:00:00Z', {
    options: { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' },
  })
  const winter = formatClubDateTime('2026-12-24T13:00:00Z', {
    options: { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' },
  })

  assert.match(summer, /14:00/)
  assert.match(summer, /BST/)
  assert.doesNotMatch(summer, /UTC/)
  assert.match(winter, /13:00/)
  assert.match(winter, /GMT/)
  assert.equal(resolveClubTimeZone('Invalid/Zone'), DEFAULT_CLUB_TIME_ZONE)
})

test('fixture and training response pages pass club timezone into every visible timestamp', async () => {
  const [fixture, training] = await Promise.all([
    readFile(new URL('../netlify/functions/match-day-availability-confirm.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/training-availability-response.js', import.meta.url), 'utf8'),
  ])

  assert.match(fixture, /formatReadableTimestamp\([\s\S]*response\.club_timezone \|\| response\.timezone_name/)
  assert.match(fixture, /ctz: resolveClubTimeZone\(response\.club_timezone \|\| response\.timezone_name\)/)
  assert.match(training, /formatReadableDateTime\(response\.occurrence_starts_at, response\.club_timezone \|\| response\.timezone_name\)/)
  assert.match(training, /formatReadableDateTime\(response\.responded_at, response\.club_timezone \|\| response\.timezone_name\)/)
})
