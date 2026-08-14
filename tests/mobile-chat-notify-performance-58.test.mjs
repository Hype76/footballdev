import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildCoachCalendarPayload } from '../apps/mobile-core/src/coachCalendarCore.js'
import { mergeCoachHomeOperationalSnapshots } from '../apps/mobile-core/src/coachPhase31GCore.js'
import { buildParentCalendarEvents } from '../apps/mobile-core/src/parentCalendarCore.js'

test('Parent Calendar removes cancelled items but retains other canonical states', () => {
  const events = buildParentCalendarEvents({
    calendarEvents: [
      { id: 'cancelled', startsAt: '2026-08-20T09:00:00Z', status: 'cancelled', title: 'Cancelled training' },
      { id: 'closed', startsAt: '2026-08-21T09:00:00Z', status: 'closed', title: 'Closed training' },
      { id: 'scheduled', startsAt: '2026-08-22T09:00:00Z', status: 'scheduled', title: 'Scheduled training' },
    ],
    invitations: [],
    matches: [
      { id: 'cancelled-match', matchDate: '2026-08-23', opponent: 'Red FC', status: 'cancelled', teamName: 'Blue FC' },
      { id: 'scheduled-match', matchDate: '2026-08-24', opponent: 'Green FC', status: 'scheduled', teamName: 'Blue FC' },
    ],
  })

  assert.deepEqual(events.map((event) => event.sourceId), ['closed', 'scheduled', 'scheduled-match'])
})

test('Coach match creation asks for opponent and generates the title', () => {
  const context = {
    clubId: 'club-1',
    paymentAccess: { canMutate: true },
    role: 'manager',
    roleRank: 40,
    teamId: 'team-1',
    teamName: 'U17 Green',
  }
  const baseForm = {
    date: '20-08-2026',
    endTime: '20:00',
    eventType: 'match',
    parentAudience: 'none',
    parentVisible: false,
    recurrenceFrequency: 'none',
    startTime: '18:00',
  }

  assert.throws(() => buildCoachCalendarPayload({ context, form: baseForm }), /Add the opponent/)
  const payload = buildCoachCalendarPayload({ context, form: { ...baseForm, opponent: 'City Juniors' } })
  assert.equal(payload.title, 'U17 Green v City Juniors')
})

test('Coach staged home loading preserves primary data when attention arrives', () => {
  const primary = {
    calendar: [{ id: 'calendar-1' }],
    errors: [],
    matches: [{ id: 'match-1' }],
    nextCalendar: { id: 'calendar-1' },
    nextMatch: { id: 'match-1' },
    nextSession: { id: 'session-1' },
    partial: false,
    sessions: [{ id: 'session-1' }],
    summary: { players: 16 },
  }
  const attention = {
    activePolls: 2,
    chatRooms: [{ id: 'room-1' }],
    developmentRecords: 4,
    errors: ['polls:unavailable'],
    messages: [{ id: 'message-1' }],
    partial: true,
    pendingAvailability: 3,
    polls: [{ id: 'poll-1' }],
    unreadChat: 5,
    unreadCommunication: 1,
  }

  const merged = mergeCoachHomeOperationalSnapshots(primary, attention)
  assert.deepEqual(merged.matches, primary.matches)
  assert.deepEqual(merged.calendar, primary.calendar)
  assert.deepEqual(merged.sessions, primary.sessions)
  assert.deepEqual(merged.chatRooms, attention.chatRooms)
  assert.deepEqual(merged.errors, ['polls:unavailable'])
  assert.equal(merged.partial, true)
})

test('mobile sources protect notification recovery, chat retries, and keyboard-safe rooms', async () => {
  const [
    notifications,
    parentData,
    parentApp,
    parentScreens,
    coachData,
    coachScreens,
    migration,
    buildGuard,
    submitGuard,
  ] = await Promise.all([
    readFile(new URL('../apps/parent-mobile/src/notifications.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260814143539_mobile_chat_reliability_58.sql', import.meta.url), 'utf8'),
    readFile(new URL('../apps/scripts/mobile-build-guard.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../apps/scripts/mobile-submit-guard.mjs', import.meta.url), 'utf8'),
  ])

  assert.match(notifications, /PARENT_MOBILE_INSTALLATION_OWNED/)
  assert.match(notifications, /rotateInstallationId/)
  assert.match(notifications, /result = await register\(installationId\)/)

  assert.match(parentData, /request_id_value: requestId/)
  assert.match(parentData, /isTransientChatError/)
  assert.match(coachData, /request_id_value: chatRequestId/)
  assert.match(coachData, /sendChatWithSafeRetry/)
  assert.match(migration, /client_request_id uuid/)
  assert.match(migration, /unique index if not exists parent_chat_messages_sender_request_key/)
  assert.match(migration, /unique index if not exists staff_chat_messages_sender_request_key/)

  assert.doesNotMatch(parentApp, /getParentChatHistory/)
  assert.match(parentApp, /chatHistory: \(\) => Promise\.resolve/)
  assert.match(parentScreens, /invitation=\{invitationById\.get\(event\.invitationId\)\}/)
  assert.match(parentScreens, /onRespond=\{onRespond\}/)
  assert.match(coachScreens, /<Modal[\s\S]*<KeyboardAvoidingView/)
  assert.match(coachScreens, /behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}/)

  assert.match(buildGuard, /authorisedParentProductionReferences[\s\S]*FP-MOBILE-CHAT-NOTIFY-PERF-58/)
  assert.match(buildGuard, /authorisedCoachProductionReferences[\s\S]*FP-MOBILE-CHAT-NOTIFY-PERF-58/)
  assert.match(submitGuard, /promotionReference === 'FP-MOBILE-CHAT-NOTIFY-PERF-58'/)
})

test('Coach and Parent native versions move together for the release', async () => {
  const [coachConfig, coachPackage, parentConfig, parentPackage] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/app.config.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/package.json', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/app.config.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/package.json', import.meta.url), 'utf8'),
  ])
  assert.match(coachConfig, /version: '1\.0\.13'/)
  assert.equal(JSON.parse(coachPackage).version, '1.0.13')
  assert.match(parentConfig, /version: '1\.0\.10'/)
  assert.equal(JSON.parse(parentPackage).version, '1.0.10')
})
