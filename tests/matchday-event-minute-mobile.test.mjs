import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  assertValidMatchDayEventMinute,
  getMatchDayEventSaveErrorMessage,
  MATCH_DAY_EVENT_MINUTE_VALIDATION_MESSAGE,
  normalizeMatchDayEventMinute,
  resolveMatchDayEventMinute,
} from '../src/lib/matchday-event-minute.js'

const matchDayPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)
const domainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)

test('event minute guard accepts manual and clock minutes only inside the database range', () => {
  assert.deepEqual(normalizeMatchDayEventMinute('88'), {
    minute: 88,
    isValid: true,
    hasValue: true,
  })
  assert.deepEqual(normalizeMatchDayEventMinute(''), {
    minute: null,
    isValid: true,
    hasValue: false,
  })
  assert.equal(normalizeMatchDayEventMinute('147').isValid, false)
  assert.equal(normalizeMatchDayEventMinute('-1').isValid, false)
  assert.equal(normalizeMatchDayEventMinute('12.5').isValid, false)

  assert.equal(assertValidMatchDayEventMinute('0'), 0)
  assert.throws(
    () => assertValidMatchDayEventMinute('147'),
    new RegExp(MATCH_DAY_EVENT_MINUTE_VALIDATION_MESSAGE),
  )
})

test('auto from clock requires manual minute when timer is outside match_day_events minute constraint', () => {
  const result = resolveMatchDayEventMinute({
    manualMinute: '',
    match: {
      status: 'live',
      timerStatus: 'running',
      timerElapsedSeconds: 147 * 60,
    },
    now: Date.now(),
  })

  assert.equal(result.isValid, false)
  assert.equal(result.minute, null)

  const manualOverride = resolveMatchDayEventMinute({
    manualMinute: '90',
    match: {
      status: 'live',
      timerStatus: 'running',
      timerElapsedSeconds: 147 * 60,
    },
    now: Date.now(),
  })

  assert.equal(manualOverride.isValid, true)
  assert.equal(manualOverride.minute, 90)
})

test('raw Supabase constraint messages are replaced with friendly event-minute copy', () => {
  const rawConstraintError = {
    message: 'new row for relation "match_day_events" violates check constraint "match_day_events_minute_check"',
  }

  assert.equal(
    getMatchDayEventSaveErrorMessage(rawConstraintError, 'Match event could not be added.'),
    MATCH_DAY_EVENT_MINUTE_VALIDATION_MESSAGE,
  )
})

test('Match Day event save validates auto minutes before inserting and keeps modal errors styled', async () => {
  const [pageSource, domainSource] = await Promise.all([
    readFile(matchDayPageUrl, 'utf8'),
    readFile(domainUrl, 'utf8'),
  ])
  const eventHandlerStart = pageSource.indexOf('const handleAddMatchEvent = async (event, match) => {')
  const eventHandlerEnd = pageSource.indexOf('const performResetPrevious = async () => {', eventHandlerStart)
  const eventHandlerSource = pageSource.slice(eventHandlerStart, eventHandlerEnd)
  const goalHandlerStart = pageSource.indexOf('const handleAddGoal = async (event, match) => {')
  const goalHandlerEnd = pageSource.indexOf('const openGoalCorrectionModal =', goalHandlerStart)
  const goalHandlerSource = pageSource.slice(goalHandlerStart, goalHandlerEnd)
  const liveEntryStart = pageSource.indexOf('function LiveMatchEntryModal')
  const liveEntryEnd = pageSource.indexOf('function getMatchEventSortMinute', liveEntryStart)
  const liveEntrySource = pageSource.slice(liveEntryStart, liveEntryEnd)

  assert.notEqual(eventHandlerStart, -1)
  assert.notEqual(eventHandlerEnd, -1)
  assert.match(eventHandlerSource, /const resolvedMinute = resolveMatchDayEventMinute\({[\s\S]*manualMinute: formEvent\.minute,[\s\S]*match,[\s\S]*now: liveClockNow/)
  assert.match(eventHandlerSource, /if \(!resolvedMinute\.isValid\) \{[\s\S]*MATCH_DAY_EVENT_MINUTE_VALIDATION_MESSAGE[\s\S]*return/)
  assert.match(eventHandlerSource, /minute: resolvedMinute\.minute \?\? ''/)
  assert.doesNotMatch(eventHandlerSource, /minute: normalizeStaffGoalText\(formEvent\.minute\) \|\| \(getCurrentMatchMinute\(match, liveClockNow\) \?\? ''\)/)
  assert.match(goalHandlerSource, /const resolvedMinute = resolveMatchDayEventMinute\({[\s\S]*manualMinute: formGoal\.minute/)
  assert.match(liveEntrySource, /errorMessage \? \([\s\S]*role="alert"[\s\S]*\{errorMessage\}/)
  assert.match(domainSource, /minute: assertValidMatchDayEventMinute\(event\?\.minute\)/)
  assert.match(domainSource, /minute: assertValidMatchDayEventMinute\(goal\?\.minute\)/)
})

test('mobile active Game Mode hides admin page sections but keeps Manage and timeline', async () => {
  const source = await readFile(matchDayPageUrl, 'utf8')
  const renderStart = source.indexOf('const isGameModeActive = Boolean(gameModeMatchId)')
  const renderEnd = source.indexOf('<ConfirmModal', renderStart)
  const renderSource = source.slice(renderStart, renderEnd)
  const gameModeStart = source.indexOf('function MatchDayGameModePanel')
  const gameModeEnd = source.indexOf('function GoalCorrectionModal', gameModeStart)
  const gameModeSource = source.slice(gameModeStart, gameModeEnd)

  assert.notEqual(renderStart, -1)
  assert.notEqual(renderEnd, -1)
  assert.match(renderSource, /isGameModeActive \? 'hidden xl:block' : ''/)
  assert.match(renderSource, /isGameModeActive \? 'hidden' : 'xl:hidden'/)
  assert.match(renderSource, /isGameModeActive \? 'hidden xl:block' : ''/)
  assert.match(renderSource, /isGameModeActive \? 'px-0 py-0 xl:px-5 xl:py-5'/)
  assert.match(gameModeSource, /onManage/)
  assert.match(gameModeSource, /Manage fixture/)
  assert.match(gameModeSource, /<MatchTimelinePanel[\s\S]*events=\{events\}[\s\S]*match=\{match\}[\s\S]*onUndoEvent=\{onUndoEvent\}/)
  assert.doesNotMatch(gameModeSource, /<MatchTimelinePanel[^>]*isReadOnly/)
})
