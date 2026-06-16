import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  consumeFixtureSetupIntent,
  FIXTURE_SETUP_EVENT,
  openMatchDayFixtureSetup,
} from '../src/lib/matchday-workflow.js'
import {
  getTodayMatchDayDateValue,
  isPastMatchDayDate,
} from '../src/lib/domain/match-day.js'

function createWindowStub() {
  const values = new Map()
  const dispatchedEvents = []

  return {
    dispatchedEvents,
    dispatchEvent(event) {
      dispatchedEvents.push(event.type)
    },
    sessionStorage: {
      getItem(key) {
        return values.get(key) ?? null
      },
      removeItem(key) {
        values.delete(key)
      },
      setItem(key, value) {
        values.set(key, String(value))
      },
    },
  }
}

test('calendar fixture setup opens the real Match Day workflow with a safe intent', () => {
  const windowRef = createWindowStub()
  const navigations = []

  openMatchDayFixtureSetup({
    kickoffTime: '10:30',
    matchDate: '2026-06-21',
    opponent: 'Riverside Juniors',
    parentAudience: 'involved_players',
    parentVisible: true,
    teamId: 'team-1',
    venueName: 'Main Pitch',
  }, {
    navigate: (url) => navigations.push(url),
    windowRef,
  })

  assert.deepEqual(navigations, ['/match-day'])

  const setupIntent = consumeFixtureSetupIntent({ windowRef })
  assert.equal(setupIntent.matchDate, '2026-06-21')
  assert.equal(setupIntent.opponent, 'Riverside Juniors')
  assert.equal(setupIntent.parentAudience, 'involved_players')
  assert.equal(setupIntent.parentVisible, true)
  assert.equal(consumeFixtureSetupIntent({ windowRef }), null)
})

test('fixture setup dispatches locally when no router navigate function is supplied', () => {
  const windowRef = createWindowStub()

  openMatchDayFixtureSetup({ opponent: 'Riverside Juniors' }, { windowRef })

  assert.deepEqual(windowRef.dispatchedEvents, [FIXTURE_SETUP_EVENT])
})

test('match day date helper blocks past dates and allows today', () => {
  const now = new Date('2026-06-16T12:00:00Z')

  assert.equal(getTodayMatchDayDateValue(now), '2026-06-16')
  assert.equal(isPastMatchDayDate('2026-06-15', now), true)
  assert.equal(isPastMatchDayDate('2026-06-16', now), false)
  assert.equal(isPastMatchDayDate('2026-06-17', now), false)
})
