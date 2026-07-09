import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  getMatchDayVolunteerActionKey,
  reconcileMatchDayVolunteerSelection,
  reconcileMatchDayVolunteerSelectionInList,
} from '../src/lib/matchday-volunteer-state.js'
import {
  reconcileMatchDayGoalCorrection,
  reconcileMatchDayGoalCorrectionInList,
  reconcileMatchDayGoal,
  reconcileMatchDayGoalInList,
} from '../src/lib/matchday-goal-state.js'
import {
  reconcileCreatedMatchDayInList,
  reconcileMatchDayUpdate,
  reconcileMatchDayUpdateInList,
} from '../src/lib/matchday-update-state.js'

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

test('staff goal correction reconciliation replaces the goal row and score', () => {
  const match = {
    id: 'match-1',
    clubId: 'club-1',
    teamId: 'team-1',
    status: 'live',
    homeAway: 'home',
    homeScore: 1,
    awayScore: 0,
    events: [
      {
        id: 'goal-event-1',
        matchDayId: 'match-1',
        eventType: 'goal',
        teamSide: 'club',
        scorerName: 'Ava Green',
        homeScore: 1,
        awayScore: 0,
      },
    ],
    eventLog: [],
  }

  const nextMatch = reconcileMatchDayGoalCorrection(match, {
    action: 'corrected',
    result: {
      matchDayId: 'match-1',
      homeScore: 0,
      awayScore: 1,
      status: 'live',
      event: {
        id: 'goal-event-1',
        matchDayId: 'match-1',
        eventType: 'goal',
        teamSide: 'opponent',
        scorerName: 'Rovers 9',
        homeScore: 0,
        awayScore: 1,
        eventStatus: 'corrected',
        correctionReason: 'Wrong side selected',
      },
    },
    user: { email: 'coach@example.test', role: 'coach' },
  })

  assert.equal(nextMatch.homeScore, 0)
  assert.equal(nextMatch.awayScore, 1)
  assert.equal(nextMatch.events.length, 1)
  assert.equal(nextMatch.events[0].id, 'goal-event-1')
  assert.equal(nextMatch.events[0].teamSide, 'opponent')
  assert.equal(nextMatch.events[0].eventStatus, 'corrected')
  assert.equal(nextMatch.eventLog[0].eventLabel, 'Goal corrected')
  assert.equal(nextMatch.eventLog[0].metadata.correctionAction, 'corrected')
})

test('staff goal void reconciliation keeps history and prevents duplicate match changes', () => {
  const match = {
    id: 'match-1',
    clubId: 'club-1',
    teamId: 'team-1',
    status: 'live',
    homeScore: 1,
    awayScore: 0,
    events: [
      {
        id: 'goal-event-1',
        matchDayId: 'match-1',
        eventType: 'goal',
        teamSide: 'club',
        homeScore: 1,
        awayScore: 0,
      },
    ],
    eventLog: [],
  }

  const [nextMatch, untouchedMatch] = reconcileMatchDayGoalCorrectionInList([match, { id: 'match-2', homeScore: 2, events: [] }], {
    action: 'voided',
    matchId: 'match-1',
    result: {
      matchDayId: 'match-1',
      homeScore: 0,
      awayScore: 0,
      status: 'live',
      event: {
        id: 'goal-event-1',
        matchDayId: 'match-1',
        eventType: 'goal',
        teamSide: 'club',
        homeScore: 0,
        awayScore: 0,
        eventStatus: 'voided',
        correctionReason: 'Duplicate goal',
      },
    },
    user: { email: 'coach@example.test', role: 'coach' },
  })

  assert.equal(untouchedMatch.id, 'match-2')
  assert.equal(untouchedMatch.homeScore, 2)
  assert.equal(nextMatch.homeScore, 0)
  assert.equal(nextMatch.awayScore, 0)
  assert.equal(nextMatch.events.length, 1)
  assert.equal(nextMatch.events[0].eventStatus, 'voided')
  assert.equal(nextMatch.events[0].correctionReason, 'Duplicate goal')
  assert.equal(nextMatch.eventLog[0].eventLabel, 'Goal removed')
  assert.equal(nextMatch.eventLog[0].metadata.correctionAction, 'voided')
})

test('staff add goal handler locally reconciles before and after canonical load without changing push send', () => {
  const source = readFileSync(new URL('../src/pages/MatchDayPage.jsx', import.meta.url), 'utf8')
  const handlerStart = source.indexOf('const handleAddGoal = async (event, match) => {')
  const handlerEnd = source.indexOf('const openGoalCorrectionModal =', handlerStart)
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

test('match update reconciliation replaces visible status and score for one row', () => {
  const match = {
    id: 'match-1',
    status: 'scheduled',
    homeScore: 0,
    awayScore: 0,
    eventLog: [{ id: 'old-log' }],
  }
  const savedMatch = {
    id: 'match-1',
    status: 'full_time',
    homeScore: 3,
    awayScore: 2,
    eventLog: [{ id: 'server-log' }],
  }

  const [nextMatch, untouchedMatch] = reconcileMatchDayUpdateInList([match, { id: 'match-2', status: 'scheduled' }], {
    match: savedMatch,
    matchId: 'match-1',
  })

  assert.equal(nextMatch.status, 'full_time')
  assert.equal(nextMatch.homeScore, 3)
  assert.equal(nextMatch.awayScore, 2)
  assert.deepEqual(nextMatch.eventLog, [{ id: 'server-log' }])
  assert.equal(untouchedMatch.id, 'match-2')
  assert.equal(untouchedMatch.status, 'scheduled')
})

test('match update reconciliation preserves relation arrays when a partial saved match omits them', () => {
  const nextMatch = reconcileMatchDayUpdate({
    id: 'match-1',
    status: 'scheduled',
    roleAssignments: [{ id: 'role-1' }],
    availabilityRequests: [{ id: 'request-1' }],
    eventLog: [{ id: 'log-1' }],
    events: [{ id: 'event-1' }],
  }, {
    id: 'match-1',
    status: 'live',
  })

  assert.equal(nextMatch.status, 'live')
  assert.deepEqual(nextMatch.roleAssignments, [{ id: 'role-1' }])
  assert.deepEqual(nextMatch.availabilityRequests, [{ id: 'request-1' }])
  assert.deepEqual(nextMatch.eventLog, [{ id: 'log-1' }])
  assert.deepEqual(nextMatch.events, [{ id: 'event-1' }])
})

test('created fixture reconciliation inserts the saved match immediately', () => {
  const createdMatch = {
    id: 'match-new',
    opponent: 'Rovers',
    matchDate: '2026-07-12',
    status: 'scheduled',
  }
  const currentMatches = [{ id: 'match-existing', opponent: 'Town' }]

  const [nextMatch, existingMatch] = reconcileCreatedMatchDayInList(currentMatches, {
    match: createdMatch,
  })

  assert.equal(nextMatch.id, 'match-new')
  assert.equal(nextMatch.opponent, 'Rovers')
  assert.equal(existingMatch.id, 'match-existing')
})

test('created fixture reconciliation is idempotent after canonical reload', () => {
  const createdMatch = {
    id: 'match-new',
    opponent: 'Rovers',
    matchDate: '2026-07-12',
    status: 'scheduled',
    eventLog: [{ id: 'created-log' }],
  }
  const currentMatches = [
    {
      id: 'match-new',
      opponent: 'Rovers',
      roleAssignments: [{ id: 'role-1' }],
    },
    { id: 'match-existing' },
  ]

  const nextMatches = reconcileCreatedMatchDayInList(currentMatches, {
    match: createdMatch,
  })

  assert.equal(nextMatches.length, 2)
  assert.equal(nextMatches[0].id, 'match-new')
  assert.deepEqual(nextMatches[0].roleAssignments, [{ id: 'role-1' }])
  assert.deepEqual(nextMatches[0].eventLog, [{ id: 'created-log' }])
})

test('staff fixture creation handler reconciles locally around canonical load without changing sends', () => {
  const source = readFileSync(new URL('../src/pages/MatchDayPage.jsx', import.meta.url), 'utf8')
  const handlerStart = source.indexOf('const handleConfirmCreateMatch = async () => {')
  const handlerEnd = source.indexOf('const handleStatusChange = async', handlerStart)
  const handlerSource = source.slice(handlerStart, handlerEnd)

  assert.notEqual(handlerStart, -1)
  assert.notEqual(handlerEnd, -1)
  assert.match(handlerSource, /const createdMatch = await createMatchDay\(\{ user, match: form \}\)/)
  assert.match(handlerSource, /const reconcileCreatedMatch = \(currentMatches\) => reconcileCreatedMatchDayInList/)
  assert.match(handlerSource, /setMatches\(reconcileCreatedMatch\)[\s\S]*logFixtureSquadSelectionEvents/)
  assert.match(handlerSource, /logFixtureSquadSelectionEvents[\s\S]*send-match-day-availability-requests/)
  assert.match(handlerSource, /send-match-day-availability-requests[\s\S]*void sendMatchDayPushNotification/)
  assert.match(handlerSource, /await loadData\(\)[\s\S]*setMatches\(reconcileCreatedMatch\)/)
  assert.match(handlerSource, /catch \(loadError\)[\s\S]*setMatches\(reconcileCreatedMatch\)[\s\S]*Fixture was saved, but Match Day could not be refreshed\./)
})

test('staff status handler reconciles saved status before and after canonical load without changing push send', () => {
  const source = readFileSync(new URL('../src/pages/MatchDayPage.jsx', import.meta.url), 'utf8')
  const handlerStart = source.indexOf('const reconcileSavedTimerMatch = async')
  const handlerEnd = source.indexOf('const performScoreSave = async', handlerStart)
  const handlerSource = source.slice(handlerStart, handlerEnd)

  assert.notEqual(handlerStart, -1)
  assert.notEqual(handlerEnd, -1)
  assert.match(handlerSource, /const savedMatch = await setMatchDayTimerState\(\{ user, match, action \}\)/)
  assert.match(handlerSource, /const savedMatch = await updateMatchDay\(\{ user, matchId: match\.id, updates: \{ status \} \}\)/)
  assert.match(handlerSource, /const reconcileSavedMatch = \(currentMatches\) => reconcileMatchDayUpdateInList/)
  assert.match(handlerSource, /setMatches\(reconcileSavedMatch\)[\s\S]*void sendMatchDayPushNotification/)
  assert.match(handlerSource, /type: status/)
  assert.match(handlerSource, /await loadData\(\)[\s\S]*setMatches\(reconcileSavedMatch\)/)
  assert.match(handlerSource, /catch \(loadError\)[\s\S]*setMatches\(reconcileSavedMatch\)[\s\S]*Match status was saved, but Match Day could not be refreshed\./)
  assert.doesNotMatch(handlerSource, /sendEmail|scheduled_email_queue|match_day_availability|transport/i)
})

test('staff manual score handler reconciles saved score before and after canonical load without sending push', () => {
  const source = readFileSync(new URL('../src/pages/MatchDayPage.jsx', import.meta.url), 'utf8')
  const handlerStart = source.indexOf('const performScoreSave = async (match) => {')
  const handlerEnd = source.indexOf('const openVolunteerSelectionPrompt =', handlerStart)
  const handlerSource = source.slice(handlerStart, handlerEnd)

  assert.notEqual(handlerStart, -1)
  assert.notEqual(handlerEnd, -1)
  assert.match(handlerSource, /const savedMatch = await updateMatchDay\(/)
  assert.match(handlerSource, /homeScore: draft\.homeScore/)
  assert.match(handlerSource, /awayScore: draft\.awayScore/)
  assert.match(handlerSource, /const reconcileSavedMatch = \(currentMatches\) => reconcileMatchDayUpdateInList/)
  assert.match(handlerSource, /setMatches\(reconcileSavedMatch\)[\s\S]*await loadData\(\)[\s\S]*setMatches\(reconcileSavedMatch\)/)
  assert.match(handlerSource, /catch \(loadError\)[\s\S]*setMatches\(reconcileSavedMatch\)[\s\S]*Score was saved, but Match Day could not be refreshed\./)
  assert.doesNotMatch(handlerSource, /sendMatchDayPushNotification|sendEmail|scheduled_email_queue|match_day_availability|transport/i)
})
