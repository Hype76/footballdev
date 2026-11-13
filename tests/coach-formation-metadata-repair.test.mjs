import assert from 'node:assert/strict'
import test from 'node:test'
import { getFormationBoardShirtKit, sortFormationBench } from '../src/lib/formation-board-shirt.js'

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

test('mobile drafts retain shirt snapshots and send an explicit selection', async () => {
  const { createMobileFormationDraft } = await import('../apps/mobile-core/src/coachFormationBoardCore.js')
  const { formationContentKey } = await import('../apps/mobile-core/src/coachFormationDraftCore.js')
  const shirtKit = { type: 'away', colour: '#123456', imagePath: '12345678-1234-1234-1234-123456789abc/away/shirt.png' }
  const board = normalizeCoachFormationBoard({ ...baseBoardPayload, currentVersion: { ...baseBoardPayload.currentVersion, shirt_kit: shirtKit } })
  const draft = createMobileFormationDraft({ board })
  assert.deepEqual(draft.shirtKit, shirtKit)
  assert.equal('shirt_kit_type_value' in buildCoachFormationBoardSavePayload(board, draft, board.title), false)
  assert.equal(buildCoachFormationBoardSavePayload(board, { ...draft, shirtKit: { ...shirtKit, type: 'home' } }, board.title).shirt_kit_type_value, 'home')
  assert.equal(buildCoachFormationBoardCreatePayload(null, draft, 'New').shirt_kit_type_value, 'away')
  assert.notEqual(formationContentKey(draft, board.title), formationContentKey({ ...draft, shirtKit: null }, board.title))
  assert.equal('shirt_kit_type_value' in buildCoachFormationBoardCreatePayload(null, { ...draft, shirtKit: null }, 'New'), false)
})

test('boards without a kit use the fixture kit and keep a saved kit unchanged', () => {
  const home = { colour: '#ffffff', imagePath: '12345678-1234-1234-1234-123456789abc/home/shirt.png' }
  const away = { colour: '#654321', imagePath: null }
  assert.deepEqual(getFormationBoardShirtKit(null, { home, away }), { type: 'home', ...home })
  assert.deepEqual(getFormationBoardShirtKit(null, { home, away }, 'away'), { type: 'away', ...away })
  assert.deepEqual(getFormationBoardShirtKit(null, { home }, 'away'), { type: 'home', ...home })
  const saved = { type: 'away', colour: '#123456', imagePath: null }
  assert.equal(getFormationBoardShirtKit(saved, { home, away }, 'home'), saved)
  assert.equal(getFormationBoardShirtKit(null, {}), null)
})

test('the bench displays shirt numbers numerically and unnumbered players alphabetically', () => {
  const bench = [
    { displayName: 'Zoe', shirtNumber: '' },
    { displayName: 'Ellie', shirtNumber: '11' },
    { displayName: 'Beth', shirtNumber: '2' },
    { displayName: 'Ada' },
    { displayName: 'Chloe', shirtNumber: '2' },
  ]
  assert.deepEqual(sortFormationBench(bench).map(player => player.displayName), ['Beth', 'Chloe', 'Ellie', 'Ada', 'Zoe'])
  assert.equal(bench[0].displayName, 'Zoe')
})
