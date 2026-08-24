import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildFootballCalendarEvents } from '../src/lib/football-calendar-events.js'

test('missed Development review reminders remain editable and the latest schedule wins', () => {
  const events = buildFootballCalendarEvents({
    assessmentReminders: [
      { createdAt: '2026-08-01T10:00:00Z', evaluationId: 'evaluation-1', id: 'original', metadata: { dueDate: '2026-08-20', evaluationId: 'evaluation-1' } },
      { createdAt: '2026-08-24T10:00:00Z', evaluationId: 'evaluation-1', id: 'rescheduled', metadata: { dueDate: '2026-08-28', evaluationId: 'evaluation-1', rescheduledFromReminderId: 'original' } },
    ],
    evaluations: [{ id: 'evaluation-1', playerId: 'player-1', playerName: 'FP TEST Player', team: 'FP TEST Team' }],
  })
  const reminders = events.filter((event) => event.sourceType === 'assessment-reminder')

  assert.equal(reminders.length, 1)
  assert.equal(reminders[0].sourceId, 'rescheduled')
  assert.equal(reminders[0].date, '2026-08-28')
  assert.equal(reminders[0].editable, true)
})

test('Calendar rescheduling preserves Development reminder history and Player linkage', async () => {
  const source = await readFile(new URL('../src/pages/SessionsPage.jsx', import.meta.url), 'utf8')
  const saveStart = source.indexOf("if (sourceType === 'assessment-reminder')", source.indexOf('const handleCalendarSave'))
  const saveEnd = source.indexOf("if (!canCreateClubCalendarEvent", saveStart)
  const saveFlow = source.slice(saveStart, saveEnd)

  assert.match(source, /Reschedule Development review/)
  assert.match(source, /New review date/)
  assert.match(source, /The original reminder remains in the audit history/)
  assert.match(saveFlow, /createAssessmentReminderOnce/)
  assert.match(saveFlow, /evaluationId: evaluation\.id/)
  assert.match(saveFlow, /playerId: evaluation\.playerId/)
  assert.match(saveFlow, /rescheduledFromReminderId/)
  assert.match(saveFlow, /getAssessmentReminderLogs/)
  assert.match(saveFlow, /writeCalendarAwareCache\(\{ assessmentReminders: nextAssessmentReminders \}\)/)
  assert.match(source, /const canDeleteEvent = Boolean\(event && editableSource && !isAssessmentReminder\)/)
})
