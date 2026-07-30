import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  buildEventResponseManagerModel,
  EVENT_RESPONSE_FILTERS,
  getEventResponseCategory,
  getEventResponseManagerView,
  getPlayerInitials,
} from '../src/lib/domain/event-response-manager.js'

function participant({
  canAcceptOnBehalf = false,
  deliveryError = '',
  deliveryState = 'delivered',
  id,
  invitationState = 'created',
  matchSelectionState = '',
  playerName,
  respondedAt = '',
  responseSource = '',
  responseState = 'awaiting_response',
} = {}) {
  return {
    id,
    playerId: id,
    player: {
      id,
      playerName,
    },
    invitationState,
    deliveryState,
    deliveryError,
    matchSelectionState,
    respondedAt,
    responseSource,
    responseState,
    staffActions: {
      canAcceptOnBehalf,
    },
  }
}

function mixedMatchParticipants() {
  return [
    participant({
      id: 'available-selected',
      matchSelectionState: 'selected',
      playerName: 'Alex Available',
      respondedAt: '2026-07-30T09:00:00Z',
      responseSource: 'parent',
      responseState: 'available',
    }),
    participant({
      id: 'available-unselected',
      matchSelectionState: 'not_selected',
      playerName: 'Avery Available',
      responseSource: 'adult_player',
      responseState: 'available',
    }),
    participant({
      id: 'maybe',
      matchSelectionState: 'not_selected',
      playerName: 'Morgan Maybe',
      responseSource: 'staff_on_behalf',
      responseState: 'maybe',
    }),
    participant({
      id: 'unavailable',
      matchSelectionState: 'not_selected',
      playerName: 'Una Unavailable',
      responseState: 'unavailable',
    }),
    participant({
      canAcceptOnBehalf: true,
      id: 'awaiting-selected',
      matchSelectionState: 'selected',
      playerName: 'Wendy Waiting',
    }),
    participant({
      deliveryState: 'not_requested',
      id: 'not-sent',
      invitationState: 'not_sent',
      matchSelectionState: 'not_selected',
      playerName: 'Ian Invitation',
      responseState: 'not_invited',
    }),
    participant({
      deliveryError: 'Controlled delivery failure',
      deliveryState: 'failed',
      id: 'delivery-issue',
      matchSelectionState: 'not_selected',
      playerName: 'Delia Delivery',
    }),
  ]
}

test('match summary uses exclusive response counts and separate selection counts', () => {
  const model = buildEventResponseManagerModel({
    eventType: 'match',
    participants: mixedMatchParticipants(),
  })

  assert.deepEqual(model.categoryCounts, {
    available: 2,
    maybe: 1,
    unavailable: 1,
    awaiting_response: 1,
    invitation_not_sent: 1,
    delivery_issue: 1,
    not_requested: 0,
  })
  assert.deepEqual(model.counts, {
    total: 7,
    exclusiveTotal: 7,
    selected: 2,
    notSelected: 5,
  })
  assert.equal(model.invariant.reconciles, true)
  assert.equal(model.summary.some((item) => item.key === EVENT_RESPONSE_FILTERS.notRequested), false)
})

test('training uses attending language and never creates selection state', () => {
  const model = buildEventResponseManagerModel({
    eventType: 'training',
    participants: [
      participant({ id: 'attending', playerName: 'Training One', responseState: 'available' }),
      participant({ id: 'maybe', playerName: 'Training Two', responseState: 'maybe' }),
      participant({ id: 'not-attending', playerName: 'Training Three', responseState: 'unavailable' }),
    ],
  })

  assert.deepEqual(
    model.summary.map(({ count, label }) => [label, count]),
    [['Attending', 1], ['Maybe', 1], ['Not attending', 1]],
  )
  assert.equal(model.counts.selected, 0)
  assert.equal(model.counts.notSelected, 0)
  assert.ok(model.rows.every((row) => row.selectionLabel === ''))
})

test('All view stays grouped in the approved operational order', () => {
  const model = buildEventResponseManagerModel({
    eventType: 'match',
    participants: mixedMatchParticipants(),
  })
  const view = getEventResponseManagerView({ model })

  assert.deepEqual(
    view.groups.map((group) => group.key),
    [
      EVENT_RESPONSE_FILTERS.available,
      EVENT_RESPONSE_FILTERS.maybe,
      EVENT_RESPONSE_FILTERS.awaitingResponse,
      EVENT_RESPONSE_FILTERS.unavailable,
      EVENT_RESPONSE_FILTERS.invitationNotSent,
      EVENT_RESPONSE_FILTERS.deliveryIssue,
    ],
  )
  assert.equal(view.visibleCount, 7)
})

test('every primary response filter returns only its authoritative category', () => {
  const model = buildEventResponseManagerModel({
    eventType: 'match',
    participants: mixedMatchParticipants(),
  })

  for (const filter of [
    EVENT_RESPONSE_FILTERS.available,
    EVENT_RESPONSE_FILTERS.maybe,
    EVENT_RESPONSE_FILTERS.unavailable,
    EVENT_RESPONSE_FILTERS.awaitingResponse,
    EVENT_RESPONSE_FILTERS.invitationNotSent,
    EVENT_RESPONSE_FILTERS.deliveryIssue,
  ]) {
    const view = getEventResponseManagerView({ activeFilter: filter, model })
    const rows = view.groups.flatMap((group) => group.rows)

    assert.ok(rows.length > 0, `${filter} should have a fixture row`)
    assert.ok(rows.every((row) => row.category === filter))
    assert.equal(view.visibleCount, model.categoryCounts[filter])
  }
})

test('delivery failure is attention state, not Awaiting response or Delivered', () => {
  const row = participant({
    deliveryError: 'Mailbox rejected',
    deliveryState: 'failed',
    id: 'failed',
    playerName: 'Failed Delivery',
  })
  const model = buildEventResponseManagerModel({
    eventType: 'training',
    participants: [row],
  })

  assert.equal(getEventResponseCategory(row), EVENT_RESPONSE_FILTERS.deliveryIssue)
  assert.equal(model.categoryCounts.delivery_issue, 1)
  assert.equal(model.categoryCounts.awaiting_response, 0)
  assert.equal(model.rows[0].deliveryLabel, 'Delivery issue')
  assert.equal(model.rows[0].warningLabel, 'Mailbox rejected')
})

test('search supports exact, partial and case-insensitive names within a filter', () => {
  const model = buildEventResponseManagerModel({
    eventType: 'match',
    participants: mixedMatchParticipants(),
  })

  assert.equal(getEventResponseManagerView({
    model,
    searchTerm: 'Alex Available',
  }).visibleCount, 1)
  assert.equal(getEventResponseManagerView({
    model,
    searchTerm: 'LEX AV',
  }).visibleCount, 1)
  assert.equal(getEventResponseManagerView({
    activeFilter: EVENT_RESPONSE_FILTERS.maybe,
    model,
    searchTerm: 'mOrGaN',
  }).visibleCount, 1)
  assert.equal(getEventResponseManagerView({
    activeFilter: EVENT_RESPONSE_FILTERS.unavailable,
    model,
    searchTerm: 'Morgan',
  }).visibleCount, 0)
  assert.equal(getEventResponseManagerView({
    model,
    searchTerm: '',
  }).visibleCount, model.counts.total)
  assert.equal(getEventResponseManagerView({
    model,
    searchTerm: 'Nobody',
  }).groups.length, 0)
})

test('rows retain long names, source labels, state labels and action authority', () => {
  const longName = 'Alexandria Very Long Multi Part Player Name'
  const model = buildEventResponseManagerModel({
    eventType: 'match',
    participants: [
      participant({
        canAcceptOnBehalf: true,
        id: 'staff',
        playerName: longName,
        responseSource: 'staff_on_behalf',
      }),
      participant({
        id: 'parent',
        playerName: 'Parent Player',
        responseSource: 'parent',
        responseState: 'available',
      }),
      participant({
        id: 'adult',
        playerName: 'Adult Player',
        responseSource: 'adult_player',
        responseState: 'unavailable',
      }),
    ],
  })

  const rows = Object.fromEntries(model.rows.map((row) => [row.playerId, row]))
  assert.equal(rows.staff.playerName, longName)
  assert.equal(rows.staff.initials, 'AV')
  assert.equal(rows.staff.responseSourceLabel, 'Staff on behalf')
  assert.equal(rows.staff.canAcceptOnBehalf, true)
  assert.equal(rows.parent.responseSourceLabel, 'Parent')
  assert.equal(rows.parent.responseLabel, 'Available')
  assert.equal(rows.adult.responseSourceLabel, 'Adult player')
  assert.equal(rows.adult.responseLabel, 'Unavailable')
  assert.equal(getPlayerInitials('Single'), 'S')
  assert.equal(getPlayerInitials(''), 'P')
})

test('zero-count delivery filter remains available and returns a clear empty view', () => {
  const model = buildEventResponseManagerModel({
    eventType: 'training',
    participants: [
      participant({ id: 'one', playerName: 'One Player', responseState: 'available' }),
    ],
  })
  const deliveryFilter = model.filters.find((filter) => filter.key === EVENT_RESPONSE_FILTERS.deliveryIssue)
  const view = getEventResponseManagerView({
    activeFilter: EVENT_RESPONSE_FILTERS.deliveryIssue,
    model,
  })

  assert.equal(deliveryFilter.count, 0)
  assert.equal(view.activeFilter, EVENT_RESPONSE_FILTERS.deliveryIssue)
  assert.equal(view.visibleCount, 0)
  assert.deepEqual(view.groups, [])
})

test('shared UI exposes one responsive dialog with accessible rows, filters, search and action menus', async () => {
  const [componentSource, sessionsSource] = await Promise.all([
    readFile(new URL('../src/components/sessions/EventResponseManager.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/SessionsPage.jsx', import.meta.url), 'utf8'),
  ])

  assert.match(componentSource, /role="dialog"/)
  assert.match(componentSource, /role="tablist"/)
  assert.match(componentSource, /role="table"/)
  assert.match(componentSource, /role="row"/)
  assert.match(componentSource, /role="menu"/)
  assert.match(componentSource, /type="search"/)
  assert.match(componentSource, /100dvh/)
  assert.match(componentSource, /safe-area-inset-top/)
  assert.match(componentSource, /safe-area-inset-bottom/)
  assert.match(componentSource, /break-words/)
  assert.match(sessionsSource, /EventResponseSummary/)
  assert.match(sessionsSource, /EventResponseManagerDialog/)
  assert.match(componentSource, /View responses/)
  assert.doesNotMatch(sessionsSource, /function EventInvitePlayerChip/)
})
