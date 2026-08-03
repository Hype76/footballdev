import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  applyFormationPreset,
  canPlaceFormationPlayer,
  getFormationPitchCapacityState,
  moveBenchPlayerToPitch,
  moveUnplacedPlayerToPitch,
} from '../src/lib/formation-board-editor.js'
import {
  FORMATION_BOARD_GAME_FORMATS,
  getFormationBoardCapacityMessage,
  getFormationBoardPlayerCapacity,
} from '../src/lib/formation-board-registry.js'
import {
  buildFormationBoardDocument,
  renderPdfDocumentHtml,
} from '../src/lib/pdf-document.js'

function placement(index, group = 'defender') {
  return {
    displayName: `Player with a deliberately long name ${index}`,
    playerId: `player-${index}`,
    positionGroup: index === 1 ? 'goalkeeper' : group,
    shirtNumber: index === 2 ? '' : index === 3 ? '999' : String(index),
    slotId: `slot-${index}`,
    x: 0.15 + ((index % 4) * 0.2),
    y: 0.15 + ((index % 5) * 0.15),
  }
}

function snapshot(gameFormat, count) {
  return {
    baseVersionNumber: 1,
    bench: [{ displayName: 'Bench Player', playerId: 'bench-player', shirtNumber: '12', state: 'bench' }],
    gameFormat,
    placements: Array.from({ length: count }, (_, index) => placement(index + 1)),
    presetKey: `${gameFormat}-custom`,
    registryVersion: 1,
    unplaced: [{ displayName: 'Unplaced Player', playerId: 'unplaced-player', shirtNumber: '', state: 'unplaced' }],
  }
}

test('canonical game-format registry enforces 5v5, 7v7, 9v9, and 11v11 pitch capacities', () => {
  assert.deepEqual(FORMATION_BOARD_GAME_FORMATS.map(({ playerCount, value }) => [value, playerCount]), [
    ['5v5', 5],
    ['7v7', 7],
    ['9v9', 9],
    ['11v11', 11],
  ])

  for (const { playerCount, value } of FORMATION_BOARD_GAME_FORMATS) {
    const onePlaceOpen = snapshot(value, playerCount - 1)
    const full = snapshot(value, playerCount)
    assert.equal(getFormationBoardPlayerCapacity(value), playerCount)
    assert.equal(canPlaceFormationPlayer(onePlaceOpen), true)
    assert.equal(canPlaceFormationPlayer(full), false)
    assert.deepEqual(getFormationPitchCapacityState(full), {
      capacity: playerCount,
      gameFormat: value,
      isAtCapacity: true,
      isOverCapacity: false,
      message: `This ${value} pitch already has ${playerCount} Players. Move a Player to Unplaced or the bench first.`,
      pitchPlayerCount: playerCount,
    })
    assert.equal(getFormationBoardCapacityMessage(value), getFormationPitchCapacityState(full).message)
  }
})

test('bench and Unplaced placement attempts stay in their safe state when the pitch is full', () => {
  const full = snapshot('7v7', 7)
  const benchAttempt = moveBenchPlayerToPitch(full, 'bench-player', { x: 0.5, y: 0.5 })
  const unplacedAttempt = moveUnplacedPlayerToPitch(full, 'unplaced-player', { x: 0.5, y: 0.5 })

  assert.equal(benchAttempt, full)
  assert.equal(unplacedAttempt, full)
  assert.equal(benchAttempt.bench.some((player) => player.playerId === 'bench-player'), true)
  assert.equal(unplacedAttempt.unplaced.some((player) => player.playerId === 'unplaced-player'), true)
})

test('smaller-format conversion preserves goalkeeper and bench, moves excess to Unplaced, and drops nobody', () => {
  const source = snapshot('11v11', 11)
  const fivePreset = {
    gameFormat: '5v5',
    key: '5v5-custom',
    playerCount: 5,
    registryVersion: 1,
    slots: [],
  }
  const converted = applyFormationPreset(source, fivePreset)
  const allIds = [...converted.placements, ...converted.bench, ...converted.unplaced].map((player) => player.playerId)

  assert.equal(converted.placements.length, 5)
  assert.equal(converted.placements[0].playerId, 'player-1')
  assert.equal(converted.bench[0].playerId, 'bench-player')
  assert.equal(converted.unplaced.length, 7)
  assert.equal(new Set(allIds).size, 13)
  assert.equal(allIds.length, 13)
})

test('editor, preview, mobile sheet, and exports use neutral silhouettes and optional number badges without question marks', async () => {
  const [page, pitch, visual, pdfSource] = await Promise.all([
    readFile(new URL('../src/pages/FormationBoardsPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/formation-board/FormationBoardPitch.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/formation-board/FormationPlayerMarkerVisual.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/pdf-document.js', import.meta.url), 'utf8'),
  ])

  assert.match(visual, /FORMATION_PLAYER_SILHOUETTE/)
  assert.match(visual, /normalizedNumber \?/)
  assert.match(pitch, /FormationPlayerMarkerVisual/)
  assert.match(pitch, /data-dragging/)
  assert.match(page, /BoardThumbnail[\s\S]*FormationPlayerMarkerVisual[\s\S]*item\.displayName/)
  assert.match(page, /matchMedia\('\(max-width: 1023px\)'\)[\s\S]*setIsRosterOpen\(true\)/)
  assert.match(page, /Remove Player from this board\?[\s\S]*Team membership, Calendar events, and Match events will not change/)
  assert.doesNotMatch(`${page}\n${pitch}\n${pdfSource}`, /shirtNumber \|\| '\?'/)

  const document = buildFormationBoardDocument({
    clubName: 'FP TEST Club',
    teamName: 'FP TEST Team',
    reportDate: '03 Aug 2026',
    title: 'Marker evidence',
    description: '',
    gameFormat: '5v5',
    formation: '5v5-custom',
    orientation: 'portrait',
    placements: [placement(1), placement(2), placement(3)],
    bench: [{ displayName: 'Bench no number', playerId: 'bench-1', shirtNumber: '' }],
    unplaced: [{ displayName: 'Unplaced numbered', playerId: 'unplaced-1', shirtNumber: '8' }],
    notes: '',
  })
  const html = renderPdfDocumentHtml(document)

  assert.match(html, /formation-player-visual/)
  assert.match(html, /formation-silhouette/)
  assert.match(html, /formation-shirt-badge[^>]*>1</)
  assert.match(html, /formation-shirt-badge[^>]*>999</)
  assert.doesNotMatch(html, /formation-number/)
  assert.doesNotMatch(html, />\?</)
})

test('existing over-capacity boards are visible but cannot be silently saved or extended', async () => {
  const page = await readFile(new URL('../src/pages/FormationBoardsPage.jsx', import.meta.url), 'utf8')
  const overCapacity = getFormationPitchCapacityState(snapshot('5v5', 6))

  assert.equal(overCapacity.isOverCapacity, true)
  assert.equal(canPlaceFormationPlayer(snapshot('5v5', 6)), false)
  assert.match(page, /Pitch capacity must be corrected/)
  assert.match(page, /No Player has been removed/)
  assert.match(page, /pitchCapacity\.isOverCapacity[\s\S]*Move the excess Players to Unplaced or the bench before saving/)
  assert.match(page, /disabled=\{!canEdit \|\| isSaving \|\| !hasUnsavedChanges \|\| pitchCapacity\.isOverCapacity\}/)
})
