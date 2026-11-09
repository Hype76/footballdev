import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canPlayerJoinFixture,
  canPlayerJoinSession,
} from '../src/lib/player-participation.js'
import { isParentPortalInviteEligiblePlayer } from '../src/lib/parent-portal-invite-actions.js'
import { getFilteredSessionPlayers } from '../src/lib/session-page-utils.js'
import { getWholeSquadScopePlayerIds } from '../src/lib/domain/calendar-invite-scope.js'

test('Training-only players join training and friendlies, but not competitive fixtures', () => {
  const player = { section: 'Training-only', status: 'active' }
  assert.equal(canPlayerJoinSession(player, 'training'), true)
  assert.equal(canPlayerJoinFixture(player, 'friendly'), true)
  assert.equal(canPlayerJoinFixture(player, 'league'), false)
  assert.equal(canPlayerJoinFixture(player, 'cup'), false)
  assert.equal(canPlayerJoinFixture(player, 'tournament'), false)
})

test('Match-only players join every match class but not training', () => {
  const player = { section: 'Match-only', status: 'active' }
  assert.equal(canPlayerJoinSession(player, 'training'), false)
  for (const fixtureType of ['friendly', 'cup', 'league', 'tournament']) {
    assert.equal(canPlayerJoinFixture(player, fixtureType), true)
  }
})

test('club-defined rules control participation and archived players stay out', () => {
  const player = {
    section: 'Development',
    status: 'active',
    playerTypeRules: {
      canTraining: true,
      canFriendly: false,
      canCup: true,
      canLeague: false,
    },
  }
  assert.equal(canPlayerJoinSession(player, 'training'), true)
  assert.equal(canPlayerJoinFixture(player, 'friendly'), false)
  assert.equal(canPlayerJoinFixture(player, 'cup'), true)
  assert.equal(canPlayerJoinFixture(player, 'league'), false)
  assert.equal(canPlayerJoinFixture({ ...player, status: 'archived' }, 'cup'), false)
  assert.equal(canPlayerJoinFixture({ section: 'Unknown', status: 'active' }, 'cup'), false)
})

test('parents can be invited for active built-in and custom player types', () => {
  for (const section of ['Trial', 'Squad', 'Training-only', 'Match-only', 'Development']) {
    assert.equal(isParentPortalInviteEligiblePlayer({ section, status: 'active' }), true)
  }
  assert.equal(isParentPortalInviteEligiblePlayer({ section: 'Development', status: 'archived' }), false)
  assert.equal(isParentPortalInviteEligiblePlayer({ section: 'Development', status: 'active', archivedAt: '2026-11-09' }), false)
})

test('training roster includes every eligible custom type regardless of session section', () => {
  const players = [
    { id: 'squad', teamId: 'team-1', section: 'Squad' },
    { id: 'training', teamId: 'team-1', section: 'Training-only' },
    { id: 'match', teamId: 'team-1', section: 'Match-only' },
    { id: 'custom', teamId: 'team-1', section: 'Development', playerTypeRules: { canTraining: true } },
  ]
  assert.deepEqual(getFilteredSessionPlayers({
    activePlayerSection: 'Squad', activePlayerTeamId: 'team-1', players, sessionType: 'training',
  }).map((player) => player.id), ['squad', 'training', 'custom'])
})

test('calendar bulk selection includes non-trial custom types', () => {
  const players = [
    { id: 'squad', section: 'Squad' },
    { id: 'training', section: 'Training-only' },
    { id: 'custom', section: 'Development' },
    { id: 'trial', section: 'Trial' },
  ]
  assert.deepEqual(getWholeSquadScopePlayerIds(players), ['squad', 'training', 'custom'])
  assert.deepEqual(getWholeSquadScopePlayerIds(players, { includeTrialPlayers: true }), ['squad', 'training', 'custom', 'trial'])
})
