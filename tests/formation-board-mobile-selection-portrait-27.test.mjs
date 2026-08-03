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
  assert.equal(snapshot.bench[0].playerId, 'bench-1')
  assert.equal(snapshot.unplaced[0].playerId, 'unplaced-1')
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
  assert.match(page, /data-unplaced-tray="true"/)
  assert.match(page, /overflow-x-auto/)
  assert.match(page, /touch-pan-x/)
  assert.match(page, /Selected, Unplaced/)
  assert.match(page, /aria-pressed=\{isSelected\}/)
  assert.match(page, /Remove from board/)
  assert.doesNotMatch(page, /Pitch orientation/)
  assert.doesNotMatch(page, /<option value="landscape">/)
  assert.match(pitch, /aspect-\[3\/4\]/)
  assert.match(pitch, /Press Enter to place at the centre/)
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
