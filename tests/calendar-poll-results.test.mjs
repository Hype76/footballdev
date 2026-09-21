import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { getCalendarPollResults, isCalendarPollClosed } from '../src/lib/calendar-poll-results.js'

test('calendar poll results rank votes and retain every joint winner', () => {
  const results = getCalendarPollResults({
    options: [
      { id: 'alex', label: 'Alex' },
      { id: 'blake', label: 'Blake' },
      { id: 'casey', label: 'Casey' },
    ],
    votes: [
      { optionId: 'alex' },
      { optionId: 'blake', count: 2 },
      { optionId: 'casey', count: 2 },
    ],
  })

  assert.equal(results.totalVotes, 5)
  assert.deepEqual(results.rankedOptions.map((option) => [option.label, option.count]), [
    ['Blake', 2],
    ['Casey', 2],
    ['Alex', 1],
  ])
  assert.deepEqual(results.leaders.map((option) => option.label), ['Blake', 'Casey'])
})

test('calendar poll results do not claim a winner without recorded votes', () => {
  const results = getCalendarPollResults({
    options: [{ id: 'alex', label: 'Alex' }, { id: 'blake', label: 'Blake' }],
  })

  assert.equal(results.totalVotes, 0)
  assert.deepEqual(results.leaders, [])
  assert.deepEqual(results.rankedOptions.map((option) => option.count), [0, 0])
})

test('an expired open poll is final, matching Player of the Match award reporting', () => {
  assert.equal(isCalendarPollClosed({ status: 'open', closesAt: '2026-09-20T18:00:00.000Z' }, new Date('2026-09-21T12:00:00.000Z')), true)
  assert.equal(isCalendarPollClosed({ status: 'open', closesAt: '2026-09-22T18:00:00.000Z' }, new Date('2026-09-21T12:00:00.000Z')), false)
})

test('calendar poll deadlines bypass attendance and refresh through the permitted poll read', async () => {
  const source = await readFile(new URL('../src/pages/SessionsPage.jsx', import.meta.url), 'utf8')

  assert.match(source, /const isPollDeadline = event\?\.sourceType === 'poll'/)
  assert.match(source, /isPollDeadline \? \(\s*<CalendarPollResults poll=\{event\?\.data\} \/>/)
  assert.match(source, /\['match-day', 'calendar', 'poll'\]/)
  assert.match(source, /const refreshedPolls = await getPolls\(\{ user \}\)/)
  assert.match(source, /isPollDeadline \? 'Open poll' : 'Open item'/)
})
