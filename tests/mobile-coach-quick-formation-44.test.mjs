import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildMobileFormationLineup,
  createMobileFormationDraft,
  moveMobileFormationPlayersToBench,
  placeMobileFormationPlayerInNextSlot,
  setMobileFormationSquad,
  swapMobileFormationPlayers,
} from '../apps/mobile-core/src/coachFormationBoardCore.js'
import { resolveCoachRoute } from '../apps/coach-mobile/src/coachNavigationCore.js'
import {
  clampCoachQuickActionPosition,
  getCoachQuickActions,
  parseCoachQuickActionPosition,
  serializeCoachQuickActionPosition,
} from '../apps/coach-mobile/src/coachQuickActionsCore.js'

const preset442 = {
  gameFormat: '11v11',
  key: '11v11-4-4-2',
  registryVersion: 1,
  slots: Array.from({ length: 11 }, (_, index) => ({ group: index === 0 ? 'goalkeeper' : 'outfield', id: `slot-${index + 1}`, x: 12 + ((index % 4) * 24), y: 5 + (index * 8) })),
}
const players = Array.from({ length: 16 }, (_, index) => ({ id: `player-${index + 1}`, playerName: `Player ${index + 1}`, shirtNumber: String(index + 1) }))
const teamContext = { role: 'manager', roleRank: 70, teamId: 'team-1' }

test('movable Quick Add exposes direct, role-aware Coach actions and persists a safe position', () => {
  const actions = getCoachQuickActions(teamContext)
  assert.deepEqual(actions.map((action) => action.label), ['Add Player', 'Add Session', 'Add Assessment', 'Add Event', 'Add Match', 'Game Day', 'Create Poll', 'Formation Board'])
  const clamped = clampCoachQuickActionPosition({ x: 999, y: 999 }, { height: 800, width: 390 }, 34)
  assert.ok(clamped.x <= 318)
  assert.ok(clamped.y <= 656)
  assert.deepEqual(parseCoachQuickActionPosition(serializeCoachQuickActionPosition(clamped)), clamped)
})

test('Formation Board is a direct authorised Coach route without becoming a bottom navigation tab', () => {
  assert.equal(resolveCoachRoute('formation-board', teamContext), 'formation')
  assert.equal(resolveCoachRoute('formation', { roleRank: 70, teamId: '' }), '')
})

test('one-tap lineup build places only formation capacity and keeps the rest on one Bench', () => {
  const squad = setMobileFormationSquad(createMobileFormationDraft(), players)
  const built = buildMobileFormationLineup(squad, preset442)
  assert.equal(built.placements.length, 11)
  assert.equal(built.bench.length, 5)
  assert.equal(new Set([...built.placements, ...built.bench].map((player) => player.playerId)).size, 16)
})

test('two-tap swaps work between starters and between the pitch and Bench', () => {
  const built = buildMobileFormationLineup(setMobileFormationSquad(createMobileFormationDraft(), players), preset442)
  const starterSwap = swapMobileFormationPlayers(built, 'player-1', 'player-2')
  assert.equal(starterSwap.placements.find((player) => player.playerId === 'player-1').slotId, 'slot-2')
  assert.equal(starterSwap.placements.find((player) => player.playerId === 'player-2').slotId, 'slot-1')
  const benchSwap = swapMobileFormationPlayers(starterSwap, 'player-1', 'player-16')
  assert.equal(benchSwap.placements.some((player) => player.playerId === 'player-16'), true)
  assert.equal(benchSwap.bench.some((player) => player.playerId === 'player-1'), true)
})

test('a Player moved to the Bench can be returned to the next empty pitch slot', () => {
  const built = buildMobileFormationLineup(setMobileFormationSquad(createMobileFormationDraft(), players), preset442)
  const benched = moveMobileFormationPlayersToBench(built, ['player-4'])
  const restored = placeMobileFormationPlayerInNextSlot(benched, preset442, 'player-4')
  assert.equal(restored.placements.some((player) => player.playerId === 'player-4'), true)
  assert.equal(restored.bench.some((player) => player.playerId === 'player-4'), false)
  assert.equal(restored.placements.length, 11)
})

test('Coach source wires Quick Add intents and the streamlined Formation finish', async () => {
  const [app, quick, formation, formationScreen, operations] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachQuickActions.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachFormationBoard.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachFormationScreen.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachOperationalScreens.js', import.meta.url), 'utf8'),
  ])
  assert.match(app, /<CoachQuickActions/)
  assert.match(app, /activeRoute === 'formation'/)
  assert.match(quick, /Drag to move this button/)
  assert.match(quick, /Jump straight into the job/)
  assert.match(formation, /Use full squad & build team/)
  assert.match(formation, /Move to pitch/)
  assert.match(formation, /Fill empty pitch positions/)
  assert.match(formation, /Save private Formation Board/)
  assert.match(formation, /Save and link to match/)
  assert.match(formation, /Save and publish to Team Resources/)
  assert.match(formationScreen, /Create a standalone Team plan now/)
  assert.doesNotMatch(formationScreen, /selectPreferredCoachFormationMatch/)
  assert.match(formation, /publishCoachFormationBoard/)
  for (const intent of ['create-player', 'create-session', 'create-match']) assert.match(operations, new RegExp(intent))
})
