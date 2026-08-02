import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { buildEventResponseReadModel } from '../src/lib/domain/event-response-read-model.js'

const [sessionsSource, responseManagerSource, domainSource, sendSource, processorSource, migrationSource] = await Promise.all([
  readFile(new URL('../src/pages/SessionsPage.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/sessions/EventResponseManager.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/domain/event-player-removal.js', import.meta.url), 'utf8'),
  readFile(new URL('../netlify/functions/send-event-player-invitation.js', import.meta.url), 'utf8'),
  readFile(new URL('../netlify/functions/process-training-availability-requests.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260802205428_event_player_removal_26b.sql', import.meta.url), 'utf8'),
])

function buildCalendarEvent(date = '2099-01-12') {
  return {
    date,
    occurrenceDate: date,
    sourceId: 'event-1',
    sourceType: 'calendar',
    data: { eventType: 'training' },
  }
}

function invite(playerId, playerName) {
  return {
    id: `invite-${playerId}`,
    calendarEventId: 'event-1',
    inviteStatus: 'pending',
    notifyRequested: true,
    playerId,
    player: { id: playerId, playerName },
    responseRequirement: 'response_required',
  }
}

test('event workflow presents explicit safe scopes and persistent impact evidence', () => {
  for (const requiredCopy of [
    'Remove from event',
    'Remove from this occurrence',
    'Remove from this and future occurrences',
    'Team membership unchanged',
    'Previous responses and delivered communication evidence preserved',
    'No removal notification will be sent',
    'Player removed',
  ]) {
    assert.match(sessionsSource, new RegExp(requiredCopy))
  }

  assert.match(responseManagerSource, /onRemoveFromEvent/)
  assert.match(responseManagerSource, /role="menuitem"/)
  assert.match(domainSource, /blockDemoMutation/)
  assert.match(domainSource, /Coach or manager access is required/)
  assert.match(domainSource, /preview_event_player_removal/)
  assert.match(domainSource, /remove_player_from_event/)
})

test('occurrence exclusions remove only the effective Player from the operational response view', () => {
  const calendarInvites = [invite('player-1', 'First Player'), invite('player-2', 'Second Player')]
  const occurrenceRemoval = {
    effectiveFromDate: '2099-01-12',
    playerId: 'player-1',
    scope: 'occurrence',
    sourceId: 'event-1',
    sourceType: 'calendar',
  }

  const selected = buildEventResponseReadModel({
    calendarInvites,
    event: buildCalendarEvent('2099-01-12'),
    occurrenceDate: '2099-01-12',
    participationRemovals: [occurrenceRemoval],
  })
  const later = buildEventResponseReadModel({
    calendarInvites,
    event: buildCalendarEvent('2099-01-19'),
    occurrenceDate: '2099-01-19',
    participationRemovals: [occurrenceRemoval],
  })

  assert.deepEqual(selected.participants.map((row) => row.playerId), ['player-2'])
  assert.deepEqual(later.participants.map((row) => row.playerId), ['player-1', 'player-2'])
  assert.equal(selected.participationRemovals.length, 1)
})

test('this-and-future exclusions preserve earlier occurrences and remove later ones', () => {
  const calendarInvites = [invite('player-1', 'First Player')]
  const removal = {
    effectiveFromDate: '2099-01-12',
    playerId: 'player-1',
    scope: 'this_and_future',
    sourceId: 'event-1',
    sourceType: 'calendar',
  }

  const earlier = buildEventResponseReadModel({
    calendarInvites,
    event: buildCalendarEvent('2099-01-05'),
    occurrenceDate: '2099-01-05',
    participationRemovals: [removal],
  })
  const future = buildEventResponseReadModel({
    calendarInvites,
    event: buildCalendarEvent('2099-01-26'),
    occurrenceDate: '2099-01-26',
    participationRemovals: [removal],
  })

  assert.equal(earlier.participants.length, 1)
  assert.equal(future.participants.length, 0)
})

test('send and processor paths fail closed for removed participation', () => {
  assert.match(sendSource, /event_player_occurrence_exclusions/)
  assert.match(sendSource, /This Player has been removed from the selected event occurrence/)
  assert.match(processorSource, /event_player_occurrence_exclusions/)
  assert.match(processorSource, /!isOccurrenceExcluded\(exclusions, invitation\.occurrenceDate, playerId\)/)
  assert.match(processorSource, /filter\(\(playerId\) => !isOccurrenceExcluded/)
})

test('migration keeps removal atomic, idempotent, history-preserving, and communication-free', () => {
  assert.match(migrationSource, /pg_advisory_xact_lock/)
  assert.match(migrationSource, /event_player_removal_commands_actor_request_key/)
  assert.match(migrationSource, /Completed event participation cannot be removed from history/)
  assert.match(migrationSource, /provider_message_id is null/)
  assert.match(migrationSource, /delivery_state = 'cancelled'/)
  assert.match(migrationSource, /'teamMembershipUnchanged', true/)
  assert.match(migrationSource, /'playerRecordPreserved', true/)
  assert.match(migrationSource, /'historyPreserved', true/)
  assert.match(migrationSource, /'communicationSent', false/)
  assert.doesNotMatch(migrationSource, /delete from public\.(players|match_day_player_availability|training_availability_responses)/)
})
