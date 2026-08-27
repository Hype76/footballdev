import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { normalizePersonName } from '../src/lib/person-name.js'

test('people names start with capitals across spaces, hyphens and apostrophes', () => {
  assert.equal(normalizePersonName('roman lawrence-alexander'), 'Roman Lawrence-Alexander')
  assert.equal(normalizePersonName('ROMAN LAWRENCE-ALEXANDER'), 'Roman Lawrence-Alexander')
  assert.equal(normalizePersonName("jamie o'neill"), "Jamie O'Neill")
  assert.equal(normalizePersonName('aimee d’angelo'), 'Aimee D’Angelo')
  assert.equal(normalizePersonName('leah McDonald'), 'Leah McDonald')
  assert.equal(normalizePersonName('  roman   lawrence-Alexander  '), 'Roman Lawrence-Alexander')
})

test('web and mobile player save and display paths use the same people-name formatter', async () => {
  const [playerNormalizers, evaluationNormalizers, playerProfile, coachPlayers, parentData] = await Promise.all([
    readFile(new URL('../src/lib/domain/player-normalizers.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/domain/evaluation-normalizers.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/PlayerProfile.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/coachPlayersCore.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url), 'utf8'),
  ])

  assert.match(playerNormalizers, /playerName: normalizePersonName/)
  assert.match(playerNormalizers, /player_name: normalizePersonName\(player\.playerName\)/)
  assert.match(evaluationNormalizers, /playerName: normalizePersonName/)
  assert.match(evaluationNormalizers, /player_name: normalizePersonName\(data\.playerName\)/)
  assert.match(playerProfile, /title=\{displayPlayerName\}/)
  assert.match(coachPlayers, /const playerName = normalizePersonName\(form\?\.playerName\)/)
  assert.match(parentData, /selected_player_names[\s\S]*map\(normalizePersonName\)/)
})
