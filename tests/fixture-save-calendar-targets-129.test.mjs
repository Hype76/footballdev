import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { isEventResponseSourceId } from '../src/lib/domain/event-response-read-model.js'

const source = async (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8')

test('Calendar-only route renders its reschedule notification choice', async () => {
  const sessions = await source('../src/pages/SessionsPage.jsx')
  const modalDeclaration = sessions.indexOf('const calendarChangeConfirmModal = (')
  const calendarRoute = sessions.indexOf('if (calendarOnly) {', modalDeclaration)
  const historyRoute = sessions.indexOf('if (historyOnly) {', calendarRoute)
  const calendarRouteSource = sessions.slice(calendarRoute, historyRoute)

  assert.notEqual(modalDeclaration, -1)
  assert.notEqual(calendarRoute, -1)
  assert.notEqual(historyRoute, -1)
  assert.match(calendarRouteSource, /<CalendarEventModal[\s\S]*\{calendarChangeConfirmModal\}/)
  assert.match(sessions, /if \(isRescheduled && !decision\)[\s\S]*setCalendarChangePrompt/)
  assert.match(sessions, /onSecondaryAction=\{\(\) => resumeCalendarChange\(false\)\}/)
})

test('synthetic history identifiers are not sent to UUID-backed response evidence queries', () => {
  assert.equal(isEventResponseSourceId('history:2026-06-18%7CU17%20Green%7CSquad'), false)
  assert.equal(isEventResponseSourceId('6f89ffc1-ce63-45da-964b-0c8715f06b75'), true)
  assert.equal(isEventResponseSourceId(''), false)
})

test('web and Coach app calendar actions keep communications off and sync squad scope', async () => {
  const [web, coachForm, coachData] = await Promise.all([
    source('../src/pages/MatchDayPage.jsx'),
    source('../apps/coach-mobile/src/CoachFixtureForm.js'),
    source('../apps/mobile-core/src/coachMatchDayData.js'),
  ])

  for (const label of ['Add to Coach calendars', 'Add to squad calendars']) {
    assert.match(web, new RegExp(label))
    assert.match(coachForm, new RegExp(label))
  }

  assert.match(web, /normalizedCalendarTarget === 'coach'[\s\S]*parentAudience: 'none', parentVisible: false/)
  assert.match(web, /normalizedCalendarTarget === 'squad'[\s\S]*parentAudience: 'involved_players', parentVisible: true/)
  assert.match(web, /const squadCalendarPlayerIds = fixturePlayers[\s\S]*section[\s\S]*=== 'squad'[\s\S]*\.map\(\(player\) => player\.id\)/)
  assert.match(web, /syncCalendarEventParentScope\(\{[\s\S]*eventSource: 'match-day'[\s\S]*includeTrialPlayers: false[\s\S]*playerIds: squadCalendarPlayerIds[\s\S]*selectionMode: 'manual'/)
  assert.match(web, /const canSendAvailabilityRequests = !calendarOnly/)
  assert.match(web, /if \(!calendarOnly && allowsCommunication/)

  assert.match(coachData, /normalizedCalendarTarget === 'coach'[\s\S]*parentAudience: 'none', parentVisible: false/)
  assert.match(coachData, /normalizedCalendarTarget === 'squad'[\s\S]*parentAudience: 'involved_players', parentVisible: true/)
  assert.match(coachData, /sync_calendar_event_parent_scope_v2/)
  assert.match(coachForm, /calendarTarget === 'squad'[\s\S]*squadCalendarPlayerIds/)
  assert.match(coachData, /player_ids_value: fixture\.selectedPlayerIds/)
  assert.match(coachData, /selection_mode_value: 'manual'/)
  assert.match(coachData, /if \(fixture\.parentVisible && !normalizedCalendarTarget\)/)
})
