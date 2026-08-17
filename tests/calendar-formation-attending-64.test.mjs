import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  addPlayersToUnplaced,
  createNewEditorSnapshot,
  placeFormationLineup,
} from '../src/lib/formation-board-editor.js'

test('Calendar Match Day modal links directly to an attending-player Formation Board', async () => {
  const source = await readFile(new URL('../src/pages/SessionsPage.jsx', import.meta.url), 'utf8')
  assert.match(source, /Build Formation Board with attending players/)
  assert.match(source, /formation-boards\?action=create&match=\$\{encodeURIComponent\(matchDayId\)\}&autofill=attending/)
})

test('Formation Board route resolves the exact match and places only the formation capacity', async () => {
  const source = await readFile(new URL('../src/pages/FormationBoardsPage.jsx', import.meta.url), 'utf8')
  assert.match(source, /matchId: parameters\.get\('match'\)/)
  assert.match(source, /autoFill: parameters\.get\('autofill'\)/)
  assert.match(source, /getMatchDay\(\{ matchDayId: matchId, user \}\)/)
  assert.match(source, /filter\(\(item\) => item\.status === 'available'\)/)
  assert.match(source, /placeFormationLineup\(addPlayersToUnplaced\(nextSnapshot, attendingPlayers\), preferredPreset\)/)
})

test('attending players fill pitch slots and overflow to the Bench', () => {
  const preset = {
    gameFormat: '5v5',
    key: '5v5-1-2-1',
    registryVersion: 1,
    slots: [
      { group: 'goalkeeper', id: 'gk', x: 0.5, y: 0.88 },
      { group: 'defence', id: 'd1', x: 0.35, y: 0.65 },
      { group: 'defence', id: 'd2', x: 0.65, y: 0.65 },
      { group: 'midfield', id: 'm1', x: 0.5, y: 0.42 },
      { group: 'forward', id: 'f1', x: 0.5, y: 0.18 },
    ],
  }
  const players = Array.from({ length: 7 }, (_, index) => ({ id: `p${index + 1}`, playerName: `Player ${index + 1}` }))
  const snapshot = placeFormationLineup(addPlayersToUnplaced(createNewEditorSnapshot(preset), players), preset)
  assert.equal(snapshot.placements.length, 5)
  assert.equal(snapshot.unplaced.length, 2)
})
