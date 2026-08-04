import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  buildEventResponseReadModel,
  getEventResponseDisplayState,
} from '../src/lib/domain/event-response-read-model.js'

const MATCH_ID = '10000000-0000-4000-8000-000000000001'
const CALENDAR_ID = '10000000-0000-4000-8000-000000000002'
const OTHER_ID = '10000000-0000-4000-8000-000000000003'

function playerInvite({
  calendarEventId = '',
  id,
  matchDayId = '',
  notifyRequested = false,
  playerId,
  playerName,
  recipientType = 'parent_guardian',
  responseRequirement = 'informational',
} = {}) {
  return {
    id,
    calendarEventId,
    matchDayId,
    playerId,
    recipientType,
    responseRequirement,
    notifyRequested,
    invitedAt: '2026-07-30T08:00:00Z',
    createdAt: '2026-07-30T08:00:00Z',
    player: {
      id: playerId,
      playerName,
    },
  }
}

function matchEvent(overrides = {}) {
  return {
    sourceId: MATCH_ID,
    sourceType: 'match-day',
    title: 'FP TEST Liverpool',
    data: {
      availabilityRequests: [],
      playerAvailability: [],
      squadDecisions: [],
      eventLog: [],
      ...overrides,
    },
  }
}

test('historical Match Day requests remain visible without calendar invite rows', () => {
  const event = matchEvent({
    availabilityRequests: [
      {
        id: 'request-1',
        playerId: 'player-1',
        playerName: 'Historical Player',
        recipientType: 'parent',
        status: 'available',
        sentAt: '2026-07-30T08:01:00Z',
        respondedAt: '2026-07-30T08:02:00Z',
      },
    ],
    playerAvailability: [{
      id: 'availability-1',
      playerId: 'player-1',
      playerName: 'Historical Player',
      status: 'available',
      selectedByParentLinkId: 'parent-link-1',
      selectedAt: '2026-07-30T08:02:00Z',
    }],
  })

  const model = buildEventResponseReadModel({ event })

  assert.equal(model.participants.length, 1)
  assert.equal(model.participants[0].player.playerName, 'Historical Player')
  assert.equal(model.participants[0].invitationState, 'created')
  assert.equal(model.participants[0].deliveryState, 'delivered')
  assert.equal(model.participants[0].responseState, 'available')
  assert.equal(model.participants[0].responseSource, 'parent')
})

test('current Match Day links merge with request, response, delivery and selection truth', () => {
  const event = matchEvent({
    availabilityRequests: [
      {
        id: 'request-1',
        playerId: 'player-1',
        playerName: 'Selected Player',
        recipientType: 'player',
        status: 'available',
        sentAt: '2026-07-30T08:01:00Z',
        respondedAt: '2026-07-30T08:02:00Z',
      },
    ],
    playerAvailability: [{
      id: 'availability-1',
      playerId: 'player-1',
      playerName: 'Selected Player',
      status: 'available',
      selectedAt: '2026-07-30T08:02:00Z',
    }],
    squadDecisions: [{
      id: 'decision-1',
      playerId: 'player-1',
      status: 'selected',
      decidedByName: 'FP TEST Manager',
    }],
    eventLog: [{
      id: 'log-1',
      playerId: 'player-1',
      eventType: 'player_availability_changed',
      createdAt: '2026-07-30T08:02:00Z',
      metadata: {
        source: 'availability_auto_selection',
      },
    }],
  })
  const calendarInvites = [
    playerInvite({
      id: 'invite-1',
      matchDayId: MATCH_ID,
      notifyRequested: true,
      playerId: 'player-1',
      playerName: 'Selected Player',
      recipientType: 'player',
      responseRequirement: 'response_required',
    }),
  ]
  const auditEvents = [{
    id: 'audit-1',
    createdAt: '2026-07-30T08:02:00Z',
    metadata: {
      outcome: 'success',
      playerId: 'player-1',
      responseSource: 'adult_player',
    },
  }]

  const model = buildEventResponseReadModel({
    auditEvents,
    calendarInvites,
    event,
  })
  const row = model.participants[0]

  assert.equal(row.responseState, 'available')
  assert.equal(row.responseSource, 'adult_player')
  assert.equal(row.matchSelectionState, 'selected')
  assert.equal(row.selectionSource, 'automatic')
  assert.equal(row.display.primaryLabel, 'Selected')
  assert.match(row.display.secondaryLabel, /Available/)
  assert.match(row.display.secondaryLabel, /Delivered/)
})

test('an attached player without communication is labelled Invitation not sent', () => {
  const calendarInvites = [
    playerInvite({
      calendarEventId: CALENDAR_ID,
      id: 'invite-added-only',
      notifyRequested: false,
      playerId: 'player-added-only',
      playerName: 'Added Only Player',
    }),
  ]
  const event = {
    sourceId: CALENDAR_ID,
    sourceType: 'calendar',
    data: {
      eventType: 'general',
    },
  }

  const model = buildEventResponseReadModel({ calendarInvites, event })
  const row = model.participants[0]

  assert.equal(row.participantState, 'attached')
  assert.equal(row.invitationState, 'not_sent')
  assert.equal(row.responseState, 'not_invited')
  assert.equal(row.display.primaryLabel, 'Invitation not sent')
  assert.equal(row.staffActions.canAcceptOnBehalf, false)
})

test('an event with no authoritative participants has a truthful empty model', () => {
  const model = buildEventResponseReadModel({
    event: {
      sourceId: CALENDAR_ID,
      sourceType: 'calendar',
      data: {
        eventType: 'general',
      },
    },
  })

  assert.deepEqual(model.participants, [])
  assert.equal(model.counts.total, 0)
})

test('historical assessment-session participants remain visible without invite rows', () => {
  const model = buildEventResponseReadModel({
    event: {
      sourceId: CALENDAR_ID,
      sourceType: 'session',
      data: {
        sessionType: 'training',
      },
    },
    sessionParticipants: [{
      id: 'session-player-1',
      sessionId: CALENDAR_ID,
      playerId: 'session-player',
      playerName: 'Historical Session Player',
      section: 'Development',
      createdAt: '2026-06-01T08:00:00Z',
    }],
  })
  const row = model.participants[0]

  assert.equal(model.participants.length, 1)
  assert.equal(row.player.playerName, 'Historical Session Player')
  assert.equal(row.participantState, 'attached')
  assert.equal(row.invitationState, 'not_sent')
  assert.equal(row.display.primaryLabel, 'Invitation not sent')
})

test('calendar and Match Day identifiers do not mix participant rows', () => {
  const calendarInvites = [
    playerInvite({
      calendarEventId: CALENDAR_ID,
      id: 'calendar-invite',
      notifyRequested: true,
      playerId: 'calendar-player',
      playerName: 'Calendar Player',
    }),
    playerInvite({
      id: 'match-invite',
      matchDayId: CALENDAR_ID,
      notifyRequested: true,
      playerId: 'match-player',
      playerName: 'Match Player',
      responseRequirement: 'response_required',
    }),
    playerInvite({
      calendarEventId: OTHER_ID,
      id: 'other-calendar-invite',
      notifyRequested: true,
      playerId: 'other-player',
      playerName: 'Other Player',
    }),
  ]
  const model = buildEventResponseReadModel({
    calendarInvites,
    event: {
      sourceId: CALENDAR_ID,
      sourceType: 'calendar',
      data: {
        eventType: 'general',
      },
    },
  })

  assert.deepEqual(model.participants.map((row) => row.playerId), ['calendar-player'])
})

test('training occurrences keep their own recipient and response state', () => {
  const event = {
    sourceId: CALENDAR_ID,
    sourceType: 'calendar',
    data: {
      eventType: 'training',
    },
  }
  const trainingAvailabilitySummary = {
    details: [
      {
        requestId: 'request-a',
        requestPlayerId: 'request-player-a',
        occurrenceDate: '2026-08-01',
        playerId: 'player-1',
        playerName: 'Occurrence One',
        recipientStatus: 'responded',
        recipientType: 'parent',
        parentLinkId: 'parent-link-1',
        responseStatus: 'available',
        respondedAt: '2026-07-30T08:00:00Z',
      },
      {
        requestId: 'request-b',
        requestPlayerId: 'request-player-b',
        occurrenceDate: '2026-08-08',
        playerId: 'player-2',
        playerName: 'Occurrence Two',
        recipientStatus: 'responded',
        recipientType: 'player',
        responseStatus: 'unavailable',
        respondedAt: '2026-07-30T08:00:00Z',
      },
    ],
  }

  const firstOccurrence = buildEventResponseReadModel({
    event,
    occurrenceDate: '2026-08-01',
    trainingAvailabilitySummary,
  })
  const secondOccurrence = buildEventResponseReadModel({
    event,
    occurrenceDate: '2026-08-08',
    trainingAvailabilitySummary,
  })

  assert.deepEqual(firstOccurrence.participants.map((row) => row.playerId), ['player-1'])
  assert.equal(firstOccurrence.participants[0].display.primaryLabel, 'Attending')
  assert.equal(firstOccurrence.participants[0].responseSource, 'parent')
  assert.deepEqual(secondOccurrence.participants.map((row) => row.playerId), ['player-2'])
  assert.equal(secondOccurrence.participants[0].display.primaryLabel, 'Not attending')
  assert.equal(secondOccurrence.participants[0].responseSource, 'adult_player')
})

test('training states use attending language and remain separate from attendance', () => {
  const event = {
    sourceId: CALENDAR_ID,
    sourceType: 'calendar',
    data: {
      eventType: 'training',
    },
  }
  const trainingAvailabilitySummary = {
    details: [
      {
        occurrenceDate: '2026-08-01',
        playerId: 'available-player',
        playerName: 'Available Player',
        recipientStatus: 'responded',
        responseStatus: 'available',
      },
      {
        occurrenceDate: '2026-08-01',
        playerId: 'maybe-player',
        playerName: 'Maybe Player',
        recipientStatus: 'responded',
        responseStatus: 'maybe',
      },
      {
        occurrenceDate: '2026-08-01',
        playerId: 'unavailable-player',
        playerName: 'Unavailable Player',
        recipientStatus: 'responded',
        responseStatus: 'unavailable',
      },
    ],
  }

  const model = buildEventResponseReadModel({
    event,
    occurrenceDate: '2026-08-01',
    trainingAvailabilitySummary,
  })
  const rows = Object.fromEntries(model.participants.map((row) => [row.playerId, row]))

  assert.equal(rows['available-player'].display.primaryLabel, 'Attending')
  assert.equal(rows['maybe-player'].display.primaryLabel, 'Maybe')
  assert.equal(rows['unavailable-player'].display.primaryLabel, 'Not attending')
  assert.equal(rows['available-player'].attendanceState, 'not_recorded')
  assert.equal(rows['maybe-player'].matchSelectionState, '')
})

test('delivery failures remain visible beside an awaiting response', () => {
  const event = matchEvent({
    availabilityRequests: [{
      id: 'request-failed',
      playerId: 'player-failed',
      playerName: 'Failed Delivery Player',
      status: 'pending',
    }],
  })
  const model = buildEventResponseReadModel({
    deliveryEvents: [{
      id: 'delivery-failed',
      playerId: 'player-failed',
      status: 'failed',
      lastError: 'Synthetic provider failure',
      createdAt: '2026-07-30T08:00:00Z',
    }],
    event,
  })
  const row = model.participants[0]

  assert.equal(row.responseState, 'awaiting_response')
  assert.equal(row.deliveryState, 'failed')
  assert.equal(row.warningState, 'delivery_issue')
  assert.equal(row.display.primaryLabel, 'Awaiting response')
  assert.match(row.display.secondaryLabel, /Delivery issue/)
})

test('staff response source is shown without collapsing selection or attendance', () => {
  const event = matchEvent({
    availabilityRequests: [{
      id: 'request-staff',
      playerId: 'player-staff',
      playerName: 'Staff Response Player',
      status: 'available',
      sentAt: '2026-07-30T08:00:00Z',
      respondedAt: '2026-07-30T08:01:00Z',
    }],
    playerAvailability: [{
      id: 'availability-staff',
      playerId: 'player-staff',
      status: 'available',
      selectedAt: '2026-07-30T08:01:00Z',
    }],
  })
  const auditEvents = [{
    id: 'audit-staff',
    createdAt: '2026-07-30T08:01:00Z',
    metadata: {
      eventId: MATCH_ID,
      outcome: 'success',
      playerId: 'player-staff',
      source: 'staff_on_behalf',
    },
  }]

  const row = buildEventResponseReadModel({ auditEvents, event }).participants[0]

  assert.equal(row.responseSource, 'staff_on_behalf')
  assert.equal(row.matchSelectionState, 'undecided')
  assert.equal(row.attendanceState, 'not_recorded')
})

test('Maybe, unavailable, awaiting and selected counts reconcile exactly', () => {
  const event = matchEvent({
    availabilityRequests: [
      { id: 'r1', playerId: 'p1', playerName: 'One', status: 'available', sentAt: '2026-07-30T08:00:00Z' },
      { id: 'r2', playerId: 'p2', playerName: 'Two', status: 'maybe', sentAt: '2026-07-30T08:00:00Z' },
      { id: 'r3', playerId: 'p3', playerName: 'Three', status: 'unavailable', sentAt: '2026-07-30T08:00:00Z' },
      { id: 'r4', playerId: 'p4', playerName: 'Four', status: 'pending', sentAt: '2026-07-30T08:00:00Z' },
    ],
    squadDecisions: [
      { id: 'd1', playerId: 'p1', status: 'selected' },
      { id: 'd2', playerId: 'p2', status: 'not_selected' },
    ],
  })

  const model = buildEventResponseReadModel({ event })

  assert.deepEqual(model.counts, {
    available: 1,
    awaitingResponse: 1,
    deliveryIssues: 0,
    invitationNotSent: 0,
    maybe: 1,
    selected: 1,
    total: 4,
    unavailable: 1,
  })
})

test('the read path contains no full-squad cosmetic fallback', () => {
  const event = matchEvent({
    availabilityRequests: [{
      id: 'request-1',
      playerId: 'invited-player',
      playerName: 'Invited Player',
      status: 'pending',
    }],
  })
  const model = buildEventResponseReadModel({ event })

  assert.deepEqual(model.participants.map((row) => row.playerId), ['invited-player'])
  assert.equal(model.participants.some((row) => row.playerId === 'active-squad-player'), false)
})

test('display state keeps match selection independent from availability', () => {
  const display = getEventResponseDisplayState({
    deliveryState: 'delivered',
    eventType: 'match',
    invitationState: 'created',
    matchSelectionState: 'selected',
    responseState: 'unavailable',
  })

  assert.equal(display.primaryLabel, 'Selected')
  assert.match(display.secondaryLabel, /Unavailable/)
  assert.match(display.secondaryLabel, /Delivered/)
})

test('server evidence loading is club scoped, source scoped and staff gated', async () => {
  const source = await readFile(
    new URL('../src/lib/domain/event-response-read-model.js', import.meta.url),
    'utf8',
  )

  assert.match(source, /Number\(user\.roleRank \?\? 0\) < 20/)
  assert.match(source, /\.eq\('club_id', user\.clubId\)/)
  assert.match(source, /query\.eq\('calendar_event_id', sourceId\)/)
  assert.match(source, /query\.eq\('match_day_id', sourceId\)/)
  assert.match(source, /query\.eq\('assessment_session_id', sourceId\)/)
  assert.match(source, /from\('event_player_change_commands'\)/)
  assert.match(source, /from\('assessment_session_players'\)/)
  assert.match(source, /\.eq\('assessment_sessions\.club_id', user\.clubId\)/)
  assert.match(source, /rpc\('get_event_response_delivery_evidence'/)
  assert.doesNotMatch(source, /from\('calendar_event_notification_events'\)/)
  assert.match(source, /\.in\('command_id', commandIds\)/)
  assert.match(source, /\.eq\('metadata->>eventId', source\.sourceId\)/)
  assert.doesNotMatch(
    source,
    /from\('event_player_notification_events'\)[\s\S]{0,500}\.eq\('(calendar_event_id|match_day_id|assessment_session_id)'/,
  )
  assert.doesNotMatch(source, /from\('players'\)[\s\S]*\.eq\('club_id'/)
})

test('the Calendar modal refreshes authoritative event evidence after mutations', async () => {
  const source = await readFile(
    new URL('../src/pages/SessionsPage.jsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /getEventResponseEvidenceForEvent\(\{ event, user \}\)/)
  assert.match(source, /window\.setInterval\([\s\S]*refreshAvailability[\s\S]*10000/)
  assert.match(source, /const evidence = await getEventResponseEvidenceForEvent/)
  assert.match(source, /No players have been added to this event\./)
  assert.match(
    source,
    /canResolveAuthoritativeMatchDay = requestedSource === 'match-day'[\s\S]*if \(!requestedEvent && !canResolveAuthoritativeMatchDay\)[\s\S]*openAuthoritativePlayerManagement[\s\S]*matchDayId: requestedEventId[\s\S]*buildFootballCalendarEvents\(\{ matchDays: \[matchDay\] \}\)[\s\S]*await getEventResponseEvidenceForEvent[\s\S]*setCalendarModal\(\{[\s\S]*mode: requestedAction === 'manage-players' \? 'manage-players' : 'view',[\s\S]*event/,
  )
})
