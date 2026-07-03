import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  getMatchDayVolunteerActionKey,
  reconcileMatchDayVolunteerSelection,
  reconcileMatchDayVolunteerSelectionInList,
} from '../src/lib/matchday-volunteer-state.js'

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
    result: { parentLinkId: 'parent-1', authUserId: 'auth-1' },
    role: 'scorer',
    selected: true,
    user: { email: 'coach@example.test' },
    volunteer: createVolunteer(),
  })

  assert.equal(nextMatch.roleAssignments.length, 2)
  assert.deepEqual(
    nextMatch.roleAssignments.find((assignment) => assignment.role === 'scorer'),
    {
      id: 'local-match-1-scorer',
      matchDayId: 'match-1',
      role: 'scorer',
      parentLinkId: 'parent-1',
      authUserId: 'auth-1',
      parentEmail: 'parent@example.test',
      playerName: 'Ava Green',
      assignedByName: 'coach@example.test',
      isCurrentParent: false,
      createdAt: '2026-07-03T20:00:00.000Z',
      updatedAt: '2026-07-03T20:00:00.000Z',
    },
  )
  assert.equal(nextMatch.roleAssignments.find((assignment) => assignment.role === 'referee')?.parentLinkId, 'parent-referee')
  assert.equal(nextMatch.scorerAssignments[0].parentLinkId, 'parent-1')
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
    result: { parentLinkId: 'parent-2' },
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
  assert.equal(nextMatch.roleAssignments.find((assignment) => assignment.role === 'linesman')?.parentEmail, 'line@example.test')
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
