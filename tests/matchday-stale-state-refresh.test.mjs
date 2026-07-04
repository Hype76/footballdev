import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  getMatchDayVolunteerActionKey,
  reconcileMatchDayVolunteerSelection,
  reconcileMatchDayVolunteerSelectionInList,
} from '../src/lib/matchday-volunteer-state.js'
import {
  reconcileMatchDayGoal,
  reconcileMatchDayGoalInList,
} from '../src/lib/matchday-goal-state.js'

function createMatch() {
  return {
    id: 'match-1',
    roleAssignments: [
      {
        id: 'existing-referee',
        matchDayId: 'match-1',
        role: 'referee',
        parentLinkId: 'parent-referee',
        parentEmail: 'referee@example.test',
        playerName: 'Ref Player',
      },
    ],
    scorerAssignments: [],
  }
}

function createVolunteer(overrides = {}) {
  return {
    requestId: 'request-1',
    parentLinkId: 'parent-1',
    authUserId: 'auth-1',
    parentEmail: 'parent@example.test',
    parentName: 'Pat Parent',
    playerName: 'Ava Green',
    response: 'yes',
    ...overrides,
  }
}

test('scorer select reconciles the visible row immediately and keeps adjacent roles', () => {
  const nextMatch = reconcileMatchDayVolunteerSelection(createMatch(), {
    matchId: 'match-1',
    now: '2026-07-03T20:00:00.000Z',
    result: {
      parentLinkId: 'parent-1',
      authUserId: 'auth-1',
      assignment: {
        id: 'role-assignment-scorer-1',
        matchDayId: 'match-1',
        role: 'scorer',
        parentLinkId: 'parent-1',
        authUserId: 'auth-1',
        parentEmail: 'saved-parent@example.test',
        playerName: 'Ava Saved',
        assignedByName: 'Saved Coach',
        createdAt: '2026-07-03T19:59:00.000Z',
        updatedAt: '2026-07-03T20:00:00.000Z',
      },
    },
    role: 'scorer',
    selected: true,
    user: { email: 'coach@example.test' },
    volunteer: createVolunteer(),
  })

  assert.equal(nextMatch.roleAssignments.length, 2)
  assert.deepEqual(
    nextMatch.roleAssignments.find((assignment) => assignment.role === 'scorer'),
    {
      id: 'role-assignment-scorer-1',
      matchDayId: 'match-1',
      role: 'scorer',
      parentLinkId: 'parent-1',
      authUserId: 'auth-1',
      parentEmail: 'saved-parent@example.test',
      playerName: 'Ava Saved',
      assignedByName: 'Saved Coach',
      isCurrentParent: false,
      createdAt: '2026-07-03T19:59:00.000Z',
      updatedAt: '2026-07-03T20:00:00.000Z',
    },
  )
  assert.equal(nextMatch.roleAssignments.find((assignment) => assignment.role === 'referee')?.parentLinkId, 'parent-referee')
  assert.equal(nextMatch.scorerAssignments[0].parentLinkId, 'parent-1')
  assert.equal(nextMatch.scorerAssignments[0].id, 'role-assignment-scorer-1')
})

test('linesman select replaces only the linesman assignment and persists through list reconciliation', () => {
  const match = {
    ...createMatch(),
    roleAssignments: [
      ...createMatch().roleAssignments,
      {
        id: 'existing-linesman',
        matchDayId: 'match-1',
        role: 'linesman',
        parentLinkId: 'old-parent',
        parentEmail: 'old@example.test',
        playerName: 'Old Player',
      },
    ],
  }

  const [nextMatch, untouchedMatch] = reconcileMatchDayVolunteerSelectionInList([match, { id: 'match-2', roleAssignments: [] }], {
    matchId: 'match-1',
    now: '2026-07-03T20:05:00.000Z',
    result: {
      parentLinkId: 'parent-2',
      assignment: {
        id: 'role-assignment-linesman-1',
        matchDayId: 'match-1',
        role: 'linesman',
        parentLinkId: 'parent-2',
        parentEmail: 'saved-line@example.test',
        playerName: 'Mia Saved',
        assignedByName: 'Coach Green',
        createdAt: '2026-07-03T20:05:00.000Z',
        updatedAt: '2026-07-03T20:05:00.000Z',
      },
    },
    role: 'linesman',
    selected: true,
    user: { name: 'Coach Green' },
    volunteer: createVolunteer({
      requestId: 'request-2',
      parentLinkId: 'parent-2',
      parentEmail: 'line@example.test',
      playerName: 'Mia Shah',
    }),
  })

  assert.equal(untouchedMatch.id, 'match-2')
  assert.equal(nextMatch.roleAssignments.filter((assignment) => assignment.role === 'linesman').length, 1)
  assert.equal(nextMatch.roleAssignments.find((assignment) => assignment.role === 'linesman')?.id, 'role-assignment-linesman-1')
  assert.equal(nextMatch.roleAssignments.find((assignment) => assignment.role === 'linesman')?.parentEmail, 'saved-line@example.test')
  assert.equal(nextMatch.roleAssignments.find((assignment) => assignment.role === 'linesman')?.playerName, 'Mia Saved')
  assert.equal(nextMatch.roleAssignments.find((assignment) => assignment.role === 'referee')?.parentLinkId, 'parent-referee')
})

test('deselect removes only the selected role so later select actions remain possible', () => {
  const match = {
    ...createMatch(),
    roleAssignments: [
      ...createMatch().roleAssignments,
      {
        id: 'existing-scorer',
        matchDayId: 'match-1',
        role: 'scorer',
        parentLinkId: 'parent-1',
        parentEmail: 'parent@example.test',
        playerName: 'Ava Green',
      },
    ],
    scorerAssignments: [{ parentLinkId: 'parent-1' }],
  }

  const nextMatch = reconcileMatchDayVolunteerSelection(match, {
    role: 'scorer',
    selected: false,
    volunteer: createVolunteer(),
  })

  assert.equal(nextMatch.roleAssignments.some((assignment) => assignment.role === 'scorer'), false)
  assert.equal(nextMatch.roleAssignments.some((assignment) => assignment.role === 'referee'), true)
  assert.deepEqual(nextMatch.scorerAssignments, [])
})

test('volunteer action keys are stable for row-level loading and status feedback', () => {
  assert.equal(
    getMatchDayVolunteerActionKey({ matchId: 'match-1', role: 'scorer', requestId: 'request-1' }),
    'match-1:scorer:request-1',
  )
})

test('Match Day volunteer selection uses app modal and local reconciliation instead of native confirm', () => {
  const source = readFileSync(new URL('../src/pages/MatchDayPage.jsx', import.meta.url), 'utf8')
  const handlerStart = source.indexOf('const handleVolunteerSelection = async () => {')
  const handlerEnd = source.indexOf('const updateGoalForm =', handlerStart)
  const handlerSource = source.slice(handlerStart, handlerEnd)
  const promptStart = source.indexOf('const openVolunteerSelectionPrompt =')
  const promptEnd = source.indexOf('const handleVolunteerSelection = async', promptStart)
  const promptSource = source.slice(promptStart, promptEnd)

  assert.match(source, /<ConfirmModal[\s\S]*onConfirm=\{handleVolunteerSelection\}/)
  assert.match(promptSource, /setVolunteerSelectionPrompt\(/)
  assert.match(handlerSource, /reconcileMatchDayVolunteerSelectionInList/)
  assert.match(handlerSource, /setMatches\(reconcileSavedSelection\)[\s\S]*await loadData\(\)[\s\S]*setMatches\(reconcileSavedSelection\)/)
  assert.match(handlerSource, /setVolunteerSelectionStatus\(/)
  assert.match(handlerSource, /showToast\(\{ title: `\$\{roleLabel\} not updated`/)
  assert.doesNotMatch(handlerSource, /confirmMatchDayAction|window\.confirm/)
  assert.doesNotMatch(promptSource, /window\.confirm/)
})

test('staff goal reconciliation updates score, timeline, and event log source immediately', () => {
  const match = {
    id: 'match-1',
    clubId: 'club-1',
    teamId: 'team-1',
    status: 'scheduled',
    homeAway: 'home',
    homeScore: 0,
    awayScore: 0,
    events: [],
    eventLog: [],
  }
  const savedEvent = {
    id: 'goal-event-1',
    matchDayId: 'match-1',
    eventType: 'goal',
    teamSide: 'club',
    minute: 12,
    scorerName: 'Ava Green',
    scorerInitials: 'AG',
    scorerShirtNumber: '9',
    homeScore: 1,
    awayScore: 0,
    createdByName: 'Coach One',
    createdAt: '2026-07-04T18:30:00.000Z',
  }

  const nextMatch = reconcileMatchDayGoal(match, {
    event: savedEvent,
    user: { email: 'coach@example.test', role: 'coach' },
  })

  assert.equal(nextMatch.homeScore, 1)
  assert.equal(nextMatch.awayScore, 0)
  assert.equal(nextMatch.status, 'live')
  assert.equal(nextMatch.events.length, 1)
  assert.equal(nextMatch.events[0].id, 'goal-event-1')
  assert.equal(nextMatch.events[0].scorerName, 'Ava Green')
  assert.equal(nextMatch.eventLog.length, 1)
  assert.equal(nextMatch.eventLog[0].eventType, 'scorer_updated')
  assert.equal(nextMatch.eventLog[0].eventLabel, 'Goal added')
  assert.equal(nextMatch.eventLog[0].metadata.goalEventId, 'goal-event-1')
  assert.deepEqual(nextMatch.eventLog[0].newValue, {
    homeScore: 1,
    awayScore: 0,
    status: 'live',
  })
})

test('staff goal reconciliation is idempotent across canonical reload follow-up', () => {
  const match = {
    id: 'match-1',
    clubId: 'club-1',
    teamId: 'team-1',
    status: 'live',
    homeScore: 1,
    awayScore: 1,
    events: [
      {
        id: 'goal-event-1',
        matchDayId: 'match-1',
        eventType: 'goal',
        teamSide: 'opponent',
        homeScore: 1,
        awayScore: 1,
      },
    ],
    eventLog: [
      {
        id: 'server-log-1',
        matchDayId: 'match-1',
        eventType: 'scorer_updated',
        metadata: {
          goalEventId: 'goal-event-1',
        },
      },
    ],
  }
  const [nextMatch, untouchedMatch] = reconcileMatchDayGoalInList([match, { id: 'match-2', events: [], eventLog: [] }], {
    event: {
      id: 'goal-event-1',
      matchDayId: 'match-1',
      eventType: 'goal',
      teamSide: 'opponent',
      homeScore: 1,
      awayScore: 1,
    },
    matchId: 'match-1',
    user: { name: 'Coach One' },
  })

  assert.equal(untouchedMatch.id, 'match-2')
  assert.equal(nextMatch.events.length, 1)
  assert.equal(nextMatch.eventLog.length, 1)
  assert.equal(nextMatch.eventLog[0].id, 'server-log-1')
})

test('staff add goal handler locally reconciles before and after canonical load without changing push send', () => {
  const source = readFileSync(new URL('../src/pages/MatchDayPage.jsx', import.meta.url), 'utf8')
  const handlerStart = source.indexOf('const handleAddGoal = async (event, match) => {')
  const handlerEnd = source.indexOf('const handleResetPrevious = async', handlerStart)
  const handlerSource = source.slice(handlerStart, handlerEnd)

  assert.notEqual(handlerStart, -1)
  assert.notEqual(handlerEnd, -1)
  assert.match(handlerSource, /const savedEvent = await addStaffMatchDayGoal\(\{ user, match, goal \}\)/)
  assert.match(handlerSource, /const reconcileSavedGoal = \(currentMatches\) => reconcileMatchDayGoalInList/)
  assert.match(handlerSource, /setMatches\(reconcileSavedGoal\)[\s\S]*void sendMatchDayPushNotification/)
  assert.match(handlerSource, /eventId: savedEvent\.id/)
  assert.match(handlerSource, /await loadData\(\)[\s\S]*setMatches\(reconcileSavedGoal\)/)
  assert.match(handlerSource, /catch \(loadError\)[\s\S]*setMatches\(reconcileSavedGoal\)[\s\S]*Goal was added, but the latest Match Day data could not be refreshed\./)
  assert.doesNotMatch(handlerSource, /sendEmail|scheduled_email_queue|match_day_availability|transport/i)
})
