import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const calendarModuleUrl = new URL('../netlify/functions/lib/_training-calendar.js', import.meta.url)
const responseModuleUrl = new URL('../netlify/functions/training-availability-response.js', import.meta.url)
const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)
const domainUrl = new URL('../src/lib/domain/training-availability.js', import.meta.url)
const migrationUrl = new URL('../supabase/migrations/20260801133232_calendar_email_ux_consistency_22.sql', import.meta.url)

const {
  buildOccurrences,
  buildTrainingAvailabilityCalendarIcs,
  getTrainingCalendarSummary,
} = await import(calendarModuleUrl.href)

function trainingEvent(overrides = {}) {
  return {
    id: 'calendar-event-22',
    event_type: 'training',
    title: 'U17 Green training',
    starts_at: '2026-07-05T08:00:00.000Z',
    ends_at: '2026-07-05T09:30:00.000Z',
    recurrence_frequency: 'none',
    recurrence_until: null,
    location: 'Pitch 1',
    notes: 'Bring boots, water; and kit.',
    updated_at: '2026-08-01T10:00:00.000Z',
    notification_revision: 3,
    ...overrides,
  }
}

test('calendar export covers single, short, and long finite schedules without truncation', () => {
  for (const count of [1, 2, 3, 4, 52]) {
    const recurring = count === 1 ? 'none' : 'weekly'
    const until = new Date(Date.UTC(2026, 6, 5 + ((count - 1) * 7))).toISOString().slice(0, 10)
    const event = trainingEvent({
      recurrence_frequency: recurring,
      recurrence_until: recurring === 'none' ? null : until,
    })
    const occurrences = buildOccurrences(event)
    const ics = buildTrainingAvailabilityCalendarIcs({ event, occurrences, teamName: 'U17 Green' })

    assert.equal(occurrences.length, count)
    assert.match(ics, /BEGIN:VCALENDAR\r\n/)
    assert.match(ics, /TZID:Europe\/London/)
    assert.match(ics, /DTSTART;TZID=Europe\/London:20260705T090000/)
    assert.match(ics, /DTEND;TZID=Europe\/London:20260705T103000/)
    assert.match(ics, /UID:calendar-event-calendar-event-22@footballplayer\.online/)
    assert.match(ics, /SEQUENCE:3/)
    assert.match(ics, /CATEGORIES:TRAINING/)
    assert.match(ics.replace(/\r\n /g, ''), /DESCRIPTION:Training schedule from Football Player\.\\n\\nBring boots\\, water\\; and kit\./)
    assert.equal(ics.endsWith('\r\n'), true)

    if (count > 1) {
      assert.match(ics, new RegExp(`RRULE:FREQ=WEEKLY;COUNT=${count}`))
      assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1)
    } else {
      assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1)
      assert.doesNotMatch(ics, /RRULE:FREQ=WEEKLY/)
    }

    for (const line of ics.split('\r\n')) {
      assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `ICS line exceeds 75 bytes: ${line}`)
    }
  }
})

test('calendar export handles truthful unbounded recurrence plus cancelled and rescheduled exceptions', () => {
  const unbounded = trainingEvent({ recurrence_frequency: 'fortnightly', recurrence_until: null })
  const baseOccurrences = buildOccurrences(unbounded)
  const unboundedIcs = buildTrainingAvailabilityCalendarIcs({ event: unbounded, occurrences: baseOccurrences })
  const summary = getTrainingCalendarSummary({ event: unbounded, occurrences: baseOccurrences })

  assert.equal(baseOccurrences.length, 1)
  assert.match(unboundedIcs, /RRULE:FREQ=WEEKLY;INTERVAL=2\r\n/)
  assert.doesNotMatch(unboundedIcs, /COUNT=/)
  assert.match(summary.continuation, /no end date/)

  const finite = trainingEvent({ recurrence_frequency: 'weekly', recurrence_until: '2026-07-19' })
  const occurrences = buildOccurrences(finite)
  occurrences[1] = { ...occurrences[1], status: 'cancelled' }
  occurrences[2] = {
    ...occurrences[2],
    rescheduledStartsAt: '2026-07-20T17:00:00.000Z',
    rescheduledEndsAt: '2026-07-20T18:30:00.000Z',
  }
  const exceptionIcs = buildTrainingAvailabilityCalendarIcs({ event: finite, occurrences })

  assert.equal((exceptionIcs.match(/BEGIN:VEVENT/g) || []).length, 2)
  assert.doesNotMatch(exceptionIcs, /RRULE:FREQ=WEEKLY/)
  assert.doesNotMatch(exceptionIcs, /20260712T090000/)
  assert.match(exceptionIcs, /20260720T180000/)
})

test('recipient-scoped HTTPS endpoint returns downloadable calendar headers and no private recipient data', async () => {
  process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
  const { handler } = await import(responseModuleUrl.href)
  const token = 'a'.repeat(64)
  const supabaseClient = {
    rpc: async () => ({
      data: [{
        request_player_id: 'request-player-1',
        calendar_event_id: 'calendar-event-22',
        team_name: 'U17 Green',
        parent_email: 'private@example.test',
      }],
      error: null,
    }),
  }
  const calendarEvent = trainingEvent()
  const query = {
    select() { return this },
    eq() { return this },
    is() { return this },
    async maybeSingle() { return { data: calendarEvent, error: null } },
  }
  const supabaseAdminClient = { from: () => query }
  const result = await handler({
    httpMethod: 'GET',
    queryStringParameters: { token, download: 'calendar' },
  }, { supabaseAdminClient, supabaseClient })

  assert.equal(result.statusCode, 200)
  assert.equal(result.headers['Content-Type'], 'text/calendar; charset=utf-8')
  assert.equal(result.headers['Cache-Control'], 'private, no-store')
  assert.match(result.headers['Content-Disposition'], /^attachment;/)
  assert.match(result.body, /BEGIN:VCALENDAR/)
  assert.doesNotMatch(result.body, /private@example\.test/)
  assert.doesNotMatch(result.body, new RegExp(token))
  assert.equal(result.headers.Location, undefined)
})

test('calendar modal owns validation and RSVP mode keeps one canonical communication contract', async () => {
  const [sessionsSource, domainSource, migrationSource] = await Promise.all([
    readFile(sessionsPageUrl, 'utf8'),
    readFile(domainUrl, 'utf8'),
    readFile(migrationUrl, 'utf8'),
  ])

  assert.match(sessionsSource, /<form noValidate onSubmit=\{handleModalSubmit\}/)
  assert.match(sessionsSource, /id="calendar-modal-validation-summary"[\s\S]*role="alert"[\s\S]*aria-live="assertive"/)
  assert.match(sessionsSource, /querySelector\(`\[name="\$\{fieldName\}"\]`\)/)
  assert.match(sessionsSource, /'aria-describedby': `calendar-\$\{fieldName\}-error`/)
  assert.match(sessionsSource, /setCalendarValidation\(\{[\s\S]*fieldName: error\.fieldName \|\| ''/)
  assert.doesNotMatch(sessionsSource, /title: 'Calendar not saved'/)
  assert.match(sessionsSource, /Availability requests will be sent to eligible Parents or adult Players for the selected Players, and the event will appear in their Family Portal\./)
  assert.match(sessionsSource, /isTrainingRsvpMode \|\| \(form\.shareWithParents/)
  assert.match(sessionsSource, /!isTrainingRsvpMode \? \([\s\S]*name="notifyInvitedFamilies"/)
  assert.match(sessionsSource, /requestTrainingAvailability: checked,[\s\S]*shareWithParents: true,[\s\S]*parentAudience: 'involved_players',[\s\S]*notifyInvitedFamilies: checked/)
  assert.match(domainSource, /const notifyInvitedFamilies = payload\.enabled \|\| settings\?\.notifyInvitedFamilies === true/)
  assert.match(migrationSource, /parent_visible = true/)
  assert.match(migrationSource, /parent_audience = 'involved_players'/)
  assert.match(migrationSource, /notify_requested = true/)
  assert.match(migrationSource, /response_requirement = 'response_required'/)
})
