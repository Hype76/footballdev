import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { buildParentCalendarEvents } from '../apps/mobile-core/src/parentCalendarCore.js'

const appUrl = new URL('../apps/parent-mobile/App.js', import.meta.url)
const dataUrl = new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url)
const migrationUrl = new URL('../supabase/migrations/20260827094500_parent_calendar_event_notes_read_model.sql', import.meta.url)
const screensUrl = new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url)

test('Parent Calendar keeps parent-visible notes on invitation-backed recurring occurrences', () => {
  const [event] = buildParentCalendarEvents({
    invitations: [{
      eventId: 'event-training',
      eventStart: '2026-08-27T18:45:00+01:00',
      eventTitle: 'JPL Training 3G Pitch',
      invitationId: 'training_attendance:request-player',
      invitationType: 'training_attendance',
      notes: 'Bring boots and arrive ten minutes early.',
      responseState: 'available',
      sourceRecordId: 'request-player',
      sourceType: 'training_availability',
    }],
  })

  assert.equal(event.notes, 'Bring boots and arrive ten minutes early.')
})

test('Parent Month view passes the same attachment open handler as Agenda and Home', async () => {
  const screens = await readFile(screensUrl, 'utf8')
  const selectedDayStart = screens.indexOf('{selectedDate ?')
  const selectedDayEnd = screens.indexOf("Tap a date to see its events.", selectedDayStart)
  const selectedDaySource = screens.slice(selectedDayStart, selectedDayEnd)

  assert.match(selectedDaySource, /onOpenResource=\{onOpenResource\}/)
  assert.match(screens, /onPress=\{\(\) => onOpenResource\?\.\(event, resource\)\}/)
})

test('Parent event notes load through an additive child-scoped read model', async () => {
  const [app, data, migration] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(dataUrl, 'utf8'),
    readFile(migrationUrl, 'utf8'),
  ])

  assert.match(data, /get_parent_portal_calendar_event_details/)
  assert.match(app, /detailsById\.get\(normalizeText\(invitation\.eventId\)\)\?\.notes/)
  assert.match(migration, /link\.auth_user_id = \(select auth\.uid\(\)\)/)
  assert.match(migration, /link\.status = 'active'/)
  assert.match(migration, /event\.parent_visible is true/)
  assert.match(migration, /event\.parent_audience = 'involved_players'/)
  assert.match(migration, /invite\.player_id = link\.player_id/)
  assert.match(migration, /invite\.invite_status <> 'cancelled'/)
  assert.doesNotMatch(migration, /\b(?:insert|update|delete|truncate)\b/i)
})
