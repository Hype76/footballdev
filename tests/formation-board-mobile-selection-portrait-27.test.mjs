import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  addPlayersToUnplaced,
  applyFormationPreset,
  createEditorSnapshot,
  getFormationPlayerState,
  moveBenchPlayerToUnplaced,
  movePitchPlayerToUnplaced,
  movePitchPlayersToUnplaced,
  moveUnplacedPlayerToBench,
  moveUnplacedPlayerToPitch,
  parseFormationDraft,
  removeFormationPlayer,
  serializeFormationDraft,
  snapshotsMatch,
  updateFormationPlayerNumber,
} from '../src/lib/formation-board-editor.js'
import {
  adaptFormationVersionToPortrait,
  convertFormationPlacementToPortrait,
  convertFormationPlacementsToPortrait,
} from '../src/lib/formation-board-orientation.js'
import {
  createMobileFormationDraft,
  getMobileFormationDraftSlots,
  moveMobileFormationSlot,
} from '../apps/mobile-core/src/coachFormationBoardCore.js'

const preset = {
  gameFormat: '5v5',
  key: '5v5-1-2-1',
  playerCount: 5,
  registryVersion: 1,
  slots: [
    { group: 'goalkeeper', id: 'gk', x: 0.5, y: 0.92 },
    { group: 'defender', id: 'def-left', x: 0.3, y: 0.68 },
    { group: 'defender', id: 'def-right', x: 0.7, y: 0.68 },
    { group: 'midfielder', id: 'mid', x: 0.5, y: 0.46 },
    { group: 'forward', id: 'forward', x: 0.5, y: 0.2 },
  ],
}

function player(index, overrides = {}) {
  return {
    id: `player-${index}`,
    playerName: `Player ${index}`,
    shirtNumber: index === 2 ? '' : String(index),
    ...overrides,
  }
}

function emptySnapshot() {
  return createEditorSnapshot({
    board: {
      currentVersionNumber: 1,
      formationPresetKey: preset.key,
      gameFormat: preset.gameFormat,
      title: 'Mobile selection board',
      visibilityState: 'draft',
      currentVersion: { bench: [], placements: [], pitchOrientation: 'portrait' },
    },
  })
}

test('shared landscape conversion preserves tactical axes and safely clamps marker centres', () => {
  const cases = [
    [{ x: 0, y: 0 }, { x: 0.04, y: 0.04 }],
    [{ x: 1, y: 1 }, { x: 0.96, y: 0.96 }],
    [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }],
    [{ x: 0.5, y: 0.92 }, { x: 0.5, y: 0.92 }],
    [{ x: Number.NaN, y: Number.POSITIVE_INFINITY }, { x: 0.5, y: 0.5 }],
  ]

  for (const [source, expected] of cases) {
    const converted = convertFormationPlacementToPortrait(source)
    assert.deepEqual({ x: converted.x, y: converted.y }, expected)
    assert.equal(Number.isFinite(converted.x), true)
    assert.equal(Number.isFinite(converted.y), true)
  }

  const portrait = [{ x: 0.1, y: 0.9 }]
  assert.equal(convertFormationPlacementsToPortrait(portrait, 'portrait'), portrait)
})

test('legacy landscape snapshot opens as portrait without losing pitch, bench, or Unplaced membership', () => {
  const board = {
    currentVersionNumber: 6,
    formationPresetKey: preset.key,
    gameFormat: preset.gameFormat,
    title: 'Legacy board',
    visibilityState: 'shared',
    currentVersion: {
      bench: [
        { displayName: 'Bench Player', playerId: 'bench-1', shirtNumber: '12', state: 'bench' },
        { displayName: 'Unplaced Player', playerId: 'unplaced-1', shirtNumber: '8', state: 'unplaced' },
      ],
      pitchOrientation: 'landscape',
      placements: [
        { displayName: 'Goalkeeper', playerId: 'pitch-1', shirtNumber: '1', x: 0.5, y: 0.92 },
      ],
    },
  }
  const snapshot = createEditorSnapshot({ board })

  assert.equal(snapshot.pitchOrientation, 'portrait')
  assert.equal(snapshot.placements[0].playerId, 'pitch-1')
  assert.equal(snapshot.bench.length, 0)
  assert.deepEqual(snapshot.unplaced.map((player) => player.playerId), ['bench-1', 'unplaced-1'])
  assert.equal(new Set([...snapshot.placements, ...snapshot.bench, ...snapshot.unplaced].map((item) => item.playerId)).size, 3)
})

test('portrait versions are not coordinate-transformed', () => {
  const version = {
    pitchOrientation: 'portrait',
    placements: [{ playerId: 'one', x: 0.12345, y: 0.87654 }],
  }
  const adapted = adaptFormationVersionToPortrait(version)

  assert.equal(adapted.pitchOrientation, 'portrait')
  assert.equal(adapted.placements, version.placements)
})

test('empty custom positions move before Players are selected while fixed presets stay fixed', () => {
  const custom = { displayName: 'Custom', gameFormat: '5v5', key: '5v5-custom', slots: [] }
  const draft = createMobileFormationDraft({ gameFormat: '5v5', presetKey: custom.key })
  const moved = moveMobileFormationSlot(draft, custom, 'custom-2', { x: 0.18, y: 0.37 })
  const slot = getMobileFormationDraftSlots(moved, custom).find((item) => item.id === 'custom-2')
  assert.deepEqual({ x: slot.x, y: slot.y }, { x: 0.18, y: 0.37 })
  assert.equal(moved.placements.length, 0)
  assert.equal(moveMobileFormationSlot(draft, preset, 'def-left', { x: 0.1, y: 0.1 }), draft)
})

test('moving a populated custom position keeps the saved slot and Player coordinates together', () => {
  const custom = { displayName: 'Custom', gameFormat: '5v5', key: '5v5-custom', slots: [] }
  const draft = {
    ...createMobileFormationDraft({ gameFormat: '5v5', presetKey: custom.key }),
    placements: [{ displayName: 'Keeper', playerId: 'keeper', positionGroup: 'goalkeeper', shirtNumber: '1', slotId: 'custom-1', x: 0.5, y: 0.92 }],
  }
  const moved = moveMobileFormationSlot(draft, custom, 'custom-1', { x: 0.4, y: 0.84 })
  assert.deepEqual(moved.customSlots, [{ id: 'custom-1', x: 0.4, y: 0.84 }])
  assert.deepEqual({ x: moved.placements[0].x, y: moved.placements[0].y }, { x: 0.4, y: 0.84 })
})

test('mobile custom position controls remain keyboard and screen-reader operable', async () => {
  const coachBoard = await readFile(new URL('../apps/coach-mobile/src/CoachFormationBoard.js', import.meta.url), 'utf8')
  const emptyStart = coachBoard.indexOf('if (this.props.empty)')
  const emptyMarker = coachBoard.slice(emptyStart, coachBoard.indexOf('    return (', emptyStart))
  assert.match(emptyMarker, /accessibilityRole=\{canEdit \? 'button' : 'image'\}/)
  assert.match(emptyMarker, /onAccessibilityTap=\{\(\) => \{ if \(canEdit\)/)
  assert.match(emptyMarker, /this\.props\.onPress\?\.\(\)/)
})

test('custom Formation positions are included in mobile payloads and restored from saved versions', async () => {
  const { buildCoachFormationBoardCreatePayload, buildCoachFormationBoardSavePayload, normalizeCoachFormationBoard } = await import('../apps/mobile-core/src/coachFormationBoardPayload.js')
  const customSlots = [{ id: 'custom-1', x: 0.42, y: 0.88 }]
  const draft = { bench: [], customSlots, gameFormat: '5v5', placements: [], presetKey: '5v5-custom', registryVersion: 1 }
  assert.deepEqual(buildCoachFormationBoardCreatePayload({}, draft, 'Custom').custom_slots_value, customSlots)
  assert.deepEqual(buildCoachFormationBoardSavePayload({ id: 'board', currentVersionNumber: 1, currentVersion: {} }, draft, 'Custom').custom_slots_value, customSlots)
  const board = normalizeCoachFormationBoard({ board: { id: 'board' }, currentVersion: { custom_slots: customSlots } })
  assert.deepEqual(board.currentVersion.customSlots, customSlots)
})

test('custom Formation positions have an immutable server round trip', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261018162711_fix_carpool_read_and_5v5_label.sql', import.meta.url), 'utf8')
  assert.match(migration, /add column custom_slots jsonb not null default '\[\]'::jsonb/)
  assert.match(migration, /formation_board_normalize_custom_slots/)
  assert.match(migration, /create or replace function public\.create_formation_board_v2/)
  assert.match(migration, /create or replace function public\.save_formation_board_editor_v2/)
  assert.match(migration, /create or replace function public\.save_coach_match_formation_v2/)
  assert.match(migration, /insert into public\.formation_board_versions \([\s\S]*custom_slots/)
})

test('multi-add accepts several Players together, blocks duplicates, and keeps them Unplaced', () => {
  const snapshot = emptySnapshot()
  const added = addPlayersToUnplaced(snapshot, [player(1), player(2), player(3), player(1)])
  const duplicateAttempt = addPlayersToUnplaced(added, [player(2), player(4)])

  assert.equal(added.unplaced.length, 3)
  assert.equal(added.placements.length, 0)
  assert.equal(added.bench.length, 0)
  assert.equal(duplicateAttempt.unplaced.length, 4)
  assert.equal(duplicateAttempt.unplaced.find((item) => item.playerId === 'player-2').shirtNumber, '')
  assert.equal(getFormationPlayerState(duplicateAttempt, 'player-3'), 'unplaced')
})

test('all Unplaced transitions preserve identity and prevent multi-state membership', () => {
  let snapshot = addPlayersToUnplaced(emptySnapshot(), [player(1), player(2)])
  snapshot = updateFormationPlayerNumber(snapshot, 'player-1', '91')
  snapshot = moveUnplacedPlayerToPitch(snapshot, 'player-1', { x: 0.4, y: 0.7 })
  snapshot = movePitchPlayerToUnplaced(snapshot, 'player-1')
  snapshot = moveUnplacedPlayerToBench(snapshot, 'player-1')
  snapshot = moveBenchPlayerToUnplaced(snapshot, 'player-1')
  snapshot = removeFormationPlayer(snapshot, 'player-2')

  const all = [...snapshot.placements, ...snapshot.bench, ...snapshot.unplaced]
  assert.equal(all.length, 1)
  assert.equal(all[0].playerId, 'player-1')
  assert.equal(all[0].shirtNumber, '91')
  assert.equal(getFormationPlayerState(snapshot, 'player-1'), 'unplaced')
  assert.equal(getFormationPlayerState(snapshot, 'player-2'), 'available')
})

test('lineup edit moves several pitch Players to the Bench in one reversible editor change', () => {
  let snapshot = addPlayersToUnplaced(emptySnapshot(), [player(1), player(2), player(3)])
  snapshot = moveUnplacedPlayerToPitch(snapshot, 'player-1', { x: 0.25, y: 0.5 })
  snapshot = moveUnplacedPlayerToPitch(snapshot, 'player-2', { x: 0.5, y: 0.5 })
  snapshot = moveUnplacedPlayerToPitch(snapshot, 'player-3', { x: 0.75, y: 0.5 })

  const updated = movePitchPlayersToUnplaced(snapshot, ['player-1', 'player-3', 'missing-player'])

  assert.deepEqual(updated.placements.map((item) => item.playerId), ['player-2'])
  assert.deepEqual(updated.unplaced.map((item) => item.playerId), ['player-1', 'player-3'])
  assert.equal(updated.bench.length, 0)
  assert.equal(snapshot.placements.length, 3)
})

test('formation changes preserve bench and existing Unplaced Players while moving overflow to Unplaced', () => {
  const pitchPlayers = Array.from({ length: 7 }, (_, index) => ({
    displayName: `Pitch ${index + 1}`,
    playerId: `pitch-${index + 1}`,
    positionGroup: index === 0 ? 'goalkeeper' : 'defender',
    shirtNumber: String(index + 1),
    slotId: `slot-${index + 1}`,
    x: 0.5,
    y: 0.5,
  }))
  const changed = applyFormationPreset({
    ...emptySnapshot(),
    bench: [{ displayName: 'Bench', playerId: 'bench-1', shirtNumber: '12', state: 'bench' }],
    placements: pitchPlayers,
    unplaced: [{ displayName: 'Waiting', playerId: 'wait-1', shirtNumber: '14', state: 'unplaced' }],
  }, preset)

  assert.equal(changed.placements.length, 5)
  assert.equal(changed.bench.length, 1)
  assert.equal(changed.bench[0].playerId, 'bench-1')
  assert.equal(changed.unplaced.length, 3)
  assert.equal(changed.unplaced.some((item) => item.playerId === 'wait-1'), true)
  assert.equal(changed.placements[0].playerId, 'pitch-1')
})

test('local draft round trip and comparison include Unplaced state', () => {
  const snapshot = addPlayersToUnplaced(emptySnapshot(), [player(1), player(2)])
  const parsed = parseFormationDraft(serializeFormationDraft(snapshot, 'board-1'))

  assert.equal(parsed.version, 2)
  assert.equal(parsed.snapshot.unplaced.length, 2)
  assert.equal(snapshotsMatch(parsed.snapshot, snapshot), true)

  const legacy = parseFormationDraft(JSON.stringify({ boardId: 'board-1', version: 1, snapshot: { ...snapshot, unplaced: undefined } }))
  assert.deepEqual(legacy.snapshot.unplaced, [])
})

test('Players sheet and tray expose required mobile multi-selection and accessibility controls', async () => {
  const [page, pitch] = await Promise.all([
    readFile(new URL('../src/pages/FormationBoardsPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/formation-board/FormationBoardPitch.jsx', import.meta.url), 'utf8'),
  ])

  assert.match(page, /selectedPlayerIds/)
  assert.match(page, /togglePlayer/)
  assert.match(page, /\{selectedCount\} selected/)
  assert.match(page, /Add \{selectedCount\}/)
  assert.match(page, /Clear selection/)
  assert.match(page, /Select all/)
  assert.match(page, /Edit lineup/)
  assert.match(page, /Move selected to Bench/)
  assert.match(page, /Nobody is removed from the board/)
  assert.match(page, /lineupEditPlayerIds/)
  assert.match(page, /data-bench-tray="true"/)
  assert.match(page, /Fill empty positions/)
  assert.match(page, /isBenchExpanded/)
  assert.match(page, /overflow-x-auto/)
  assert.match(page, /touch-pan-x/)
  assert.match(page, /Selected, Bench/)
  assert.match(page, /aria-pressed=\{isSelected\}/)
  assert.match(page, /Remove from board/)
  assert.doesNotMatch(page, /Pitch orientation/)
  assert.doesNotMatch(page, /<option value="landscape">/)
  assert.match(pitch, /aspect-\[3\/4\]/)
  assert.match(pitch, /Press Enter to place at the centre/)
  assert.match(pitch, /selectionMode/)
})

test('server, export, and immutable history paths use explicit state and canonical portrait compatibility', async () => {
  const [domain, migration, pdfBuilder, pdfDocument, serverExport] = await Promise.all([
    readFile(new URL('../src/lib/domain/formation-board.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260803045754_formation_board_mobile_selection_portrait_27.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/pdf-builder.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/pdf-document.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/formation-board-export.js', import.meta.url), 'utf8'),
  ])

  assert.match(domain, /state: 'unplaced'/)
  assert.match(domain, /bench_value: serializeFormationBoardRoster/)
  assert.match(domain, /pitch_orientation_value: 'portrait'/)
  assert.match(migration, /roster_state not in \('bench', 'unplaced'\)/)
  assert.match(migration, /before insert on public\.formation_board_versions/)
  assert.match(migration, /new\.pitch_orientation := 'portrait'/)
  assert.doesNotMatch(migration, /update\s+public\.formation_board_versions/i)
  assert.match(pdfBuilder, /width: 1100, height: 1600/)
  assert.match(pdfDocument, /A4 portrait/)
  assert.match(serverExport, /adaptFormationVersionToPortrait/)
  assert.match(serverExport, /player\?\.state === 'unplaced'/)
  assert.match(serverExport, /unplaced: document\.unplaced/)
  assert.doesNotMatch(serverExport, /send-email|send-sms|send-push|create-chat/i)
})
