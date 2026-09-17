import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCoachFormationBoardCreatePayload,
  buildCoachFormationBoardSavePayload,
  normalizeCoachFormationBoard,
} from '../apps/mobile-core/src/coachFormationBoardPayload.js'

const baseBoardPayload = {
  board: {
    id: 'board-1',
    club_id: 'club-1',
    team_id: 'team-1',
    title: 'Saturday plan',
    description: 'Web authored description',
    visibility_state: 'shared',
    created_by_profile_id: 'creator-1',
    current_version_id: 'version-4',
    current_version_number: 4,
    updated_at: '2026-09-17T08:00:00Z',
  },
  currentVersion: {
    id: 'version-4',
    board_id: 'board-1',
    version_number: 4,
    game_format: '7v7',
    formation_preset_key: '7v7-custom',
    preset_registry_version: 1,
    placements: [{ playerId: 'player-pitch', state: 'pitch', x: 0.5, y: 0.8 }],
    bench: [
      { playerId: 'player-bench', displayName: 'Bench Player', state: 'bench' },
      { playerId: 'player-unplaced', displayName: 'Unplaced Player', state: 'unplaced' },
    ],
    notes: 'Keep the left side compact.',
    created_by_profile_id: 'creator-1',
    version_reason: 'web_editor_save',
  },
}

const baseDraft = {
  gameFormat: '7v7',
  placements: [{ playerId: 'player-pitch', slotId: 'custom-1', positionGroup: 'goalkeeper', x: 0.5, y: 0.8 }],
  presetKey: '7v7-custom',
  registryVersion: 1,
  bench: [
    { playerId: 'player-bench', displayName: 'Bench Player' },
    { playerId: 'player-unplaced', displayName: 'Unplaced Player' },
  ],
}

test('normalizing a board retains metadata and explicit roster state', () => {
  const board = normalizeCoachFormationBoard(baseBoardPayload)

  assert.equal(board.description, 'Web authored description')
  assert.equal(board.visibilityState, 'shared')
  assert.equal(board.createdByProfileId, 'creator-1')
  assert.equal(board.currentVersion.notes, 'Keep the left side compact.')
  assert.equal(board.currentVersion.createdByProfileId, 'creator-1')
  assert.deepEqual(board.currentVersion.unplaced.map((player) => player.playerId), ['player-unplaced'])
  assert.deepEqual(board.currentVersion.bench.map((player) => player.playerId), ['player-bench'])
})

test('save payload preserves description, visibility, notes, unplaced state, and version guard', () => {
  const board = normalizeCoachFormationBoard(baseBoardPayload)
  const payload = buildCoachFormationBoardSavePayload(board, baseDraft, 'Saturday plan')

  assert.equal(payload.description_value, 'Web authored description')
  assert.equal(payload.visibility_value, 'shared')
  assert.equal(payload.notes_value, 'Keep the left side compact.')
  assert.equal(payload.expected_version_number, 4)
  assert.deepEqual(payload.bench_value.map((player) => [player.playerId, player.state]), [
    ['player-bench', 'bench'],
    ['player-unplaced', 'unplaced'],
  ])
})

test('placing a previously unplaced player removes its unplaced roster state', () => {
  const board = normalizeCoachFormationBoard(baseBoardPayload)
  const payload = buildCoachFormationBoardSavePayload(board, {
    ...baseDraft,
    placements: [...baseDraft.placements, { playerId: 'player-unplaced', slotId: 'custom-2', x: 0.5, y: 0.5 }],
    bench: [{ playerId: 'player-bench', displayName: 'Bench Player' }],
  }, 'Saturday plan')

  assert.deepEqual(payload.bench_value.map((player) => [player.playerId, player.state]), [['player-bench', 'bench']])
  assert.equal(payload.placements_value.some((player) => player.playerId === 'player-unplaced'), true)
  assert.equal(payload.expected_version_number, 4)
})

test('removing an unplaced player from the draft does not re-add it on save', () => {
  const board = normalizeCoachFormationBoard(baseBoardPayload)
  const payload = buildCoachFormationBoardSavePayload(board, {
    ...baseDraft,
    bench: [{ playerId: 'player-bench', displayName: 'Bench Player' }],
  }, 'Saturday plan')

  assert.deepEqual(payload.bench_value.map((player) => player.playerId), ['player-bench'])
})

test('explicit draft unplaced list can move a player onto the normal bench', () => {
  const board = normalizeCoachFormationBoard(baseBoardPayload)
  const payload = buildCoachFormationBoardSavePayload(board, { ...baseDraft, unplaced: [] }, 'Saturday plan')

  assert.deepEqual(payload.bench_value.map((player) => [player.playerId, player.state]), [
    ['player-bench', 'bench'],
    ['player-unplaced', 'bench'],
  ])
})

test('new board payload defaults to private draft visibility', () => {
  const payload = buildCoachFormationBoardCreatePayload({ id: 'match-1', teamName: 'U12', opponent: 'Rivals' }, baseDraft, '')

  assert.equal(payload.visibility_value, 'draft')
  assert.equal(payload.description_value, 'Match plan for U12 v Rivals')
  assert.deepEqual(payload.bench_value.map((player) => [player.playerId, player.state]), [
    ['player-bench', 'bench'],
    ['player-unplaced', 'bench'],
  ])
})
