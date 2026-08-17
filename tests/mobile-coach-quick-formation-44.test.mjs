import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  assignMobileFormationPlayerToSlot,
  buildMobileFormationLineup,
  createMobileFormationDraft,
  getMobileFormationPitchPercent,
  getMobileFormationPitchRatio,
  getMobileFormationSlotShortLabel,
  moveMobileFormationPlayer,
  moveMobileFormationPlayersToBench,
  placeMobileFormationPlayerInNextSlot,
  setMobileFormationSquad,
  swapMobileFormationPlayers,
} from '../apps/mobile-core/src/coachFormationBoardCore.js'
import { resolveCoachRoute } from '../apps/coach-mobile/src/coachNavigationCore.js'
import { getLinkableCoachFormationMatches } from '../apps/coach-mobile/src/coachFormationEntryCore.js'
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

test('mobile preset coordinates convert canonical zero-to-one values into visible pitch percentages', () => {
  assert.equal(getMobileFormationPitchPercent(0.14), 14)
  assert.equal(getMobileFormationPitchPercent(0.75), 75)
  assert.equal(getMobileFormationPitchPercent(50), 50)
  assert.equal(getMobileFormationPitchPercent(120), 100)
  assert.equal(getMobileFormationPitchRatio(0.75), 0.75)
  assert.equal(getMobileFormationPitchRatio(75), 0.75)
})

test('Formation Board match linking shows only current and future matches for the active Team', () => {
  const matches = [
    { id: 'past', matchDate: '2026-08-12', status: 'scheduled', teamId: 'team-1' },
    { id: 'today', matchDate: '2026-08-13', status: 'scheduled', teamId: 'team-1' },
    { id: 'future', matchDate: '2026-08-20', status: 'scheduled', teamId: 'team-1' },
    { id: 'other-team', matchDate: '2026-08-14', status: 'scheduled', teamId: 'team-2' },
    { id: 'cancelled', matchDate: '2026-08-15', status: 'cancelled', teamId: 'team-1' },
    { id: 'finished', matchDate: '2026-08-16', status: 'full_time', teamId: 'team-1' },
    { id: 'undated', matchDate: '', status: 'scheduled', teamId: 'team-1' },
  ]
  assert.deepEqual(
    getLinkableCoachFormationMatches(matches, { now: new Date('2026-08-13T09:00:00Z'), teamId: 'team-1' }).map((match) => match.id),
    ['today', 'future'],
  )
})

test('empty mobile Formation positions use compact labels that remain distinct and readable', () => {
  assert.equal(getMobileFormationSlotShortLabel({ id: 'def-left-centre', group: 'defender' }), 'LCB')
  assert.equal(getMobileFormationSlotShortLabel({ id: 'mid-centre', group: 'midfielder' }), 'CM')
  assert.equal(getMobileFormationSlotShortLabel({ id: 'forward', group: 'forward' }), 'ST')
  assert.equal(getMobileFormationSlotShortLabel({ id: 'unknown', group: 'goalkeeper' }), 'GK')
})

test('mobile Player markers can be moved freely while preserving their formation slot', () => {
  const built = buildMobileFormationLineup(setMobileFormationSquad(createMobileFormationDraft(), players), preset442)
  const moved = moveMobileFormationPlayer(built, 'player-1', { x: 0.72, y: 0.36 })
  const player = moved.placements.find((item) => item.playerId === 'player-1')
  assert.equal(player.slotId, 'slot-1')
  assert.equal(player.x, 0.72)
  assert.equal(player.y, 0.36)
  assert.equal(moveMobileFormationPlayer(moved, 'player-1', { x: -20, y: 200 }).placements.find((item) => item.playerId === 'player-1').x, 0.04)
  assert.equal(moveMobileFormationPlayer(moved, 'player-1', { x: -20, y: 200 }).placements.find((item) => item.playerId === 'player-1').y, 0.96)
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

test('slot-first assignment adds, replaces and swaps Players without a Bench-first step', () => {
  let draft = createMobileFormationDraft()
  draft = assignMobileFormationPlayerToSlot(draft, players[0], preset442.slots[0])
  draft = assignMobileFormationPlayerToSlot(draft, players[1], preset442.slots[1])
  assert.equal(draft.placements.find((player) => player.playerId === 'player-1').slotId, 'slot-1')

  const swapped = assignMobileFormationPlayerToSlot(draft, players[0], preset442.slots[1])
  assert.equal(swapped.placements.find((player) => player.playerId === 'player-1').slotId, 'slot-2')
  assert.equal(swapped.placements.find((player) => player.playerId === 'player-2').slotId, 'slot-1')

  const replaced = assignMobileFormationPlayerToSlot(swapped, players[2], preset442.slots[1])
  assert.equal(replaced.placements.find((player) => player.playerId === 'player-3').slotId, 'slot-2')
  assert.equal(replaced.bench.some((player) => player.playerId === 'player-1'), true)
})

test('Coach source wires Quick Add intents and the streamlined Formation finish', async () => {
  const [app, quick, formation, formationScreen, operations, matchDay] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachQuickActions.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachFormationBoard.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachFormationScreen.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachOperationalScreens.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachMatchDayScreen.js', import.meta.url), 'utf8'),
  ])
  assert.match(app, /<CoachQuickActions/)
  assert.match(app, /activeRoute === 'formation'/)
  assert.match(quick, /Drag to move this button/)
  assert.match(quick, /Jump straight into the job/)
  assert.match(formation, /Confirm formation/)
  assert.match(formation, /Select full squad/)
  assert.match(formation, /Load empty pitch/)
  assert.doesNotMatch(formation, /Use full squad & build team/)
  assert.match(formation, /Drag any Player marker freely around the pitch/)
  assert.match(formation, /assignMobileFormationPlayerToSlot/)
  assert.match(formation, /PanResponder\.create/)
  assert.match(formation, /moveMobileFormationPlayer/)
  assert.match(formation, /markerSilhouetteHead/)
  assert.match(formation, /markerSilhouetteShoulders/)
  assert.match(formation, /markerBadge/)
  assert.match(formation, /markerName/)
  assert.match(formation, /getMobileFormationPitchPercent\(slot\.x\)/)
  assert.match(formation, /getMobileFormationPitchPercent\(slot\.y\)/)
  assert.match(formation, /getMobileFormationSlotShortLabel\(slot\)/)
  assert.match(formation, /numberOfLines=\{1\}/)
  assert.match(formation, /Move to pitch/)
  assert.match(formation, /Continue to save/)
  assert.match(formation, /Save private Formation Board/)
  assert.match(formation, /Save and link to match/)
  assert.match(formation, /Save and publish to Team Resources/)
  assert.match(formationScreen, /Create a standalone Team plan now/)
  assert.doesNotMatch(formationScreen, /selectPreferredCoachFormationMatch/)
  assert.match(formation, /publishCoachFormationBoard/)
  for (const intent of ['create-player', 'create-session']) assert.match(operations, new RegExp(intent))
  assert.match(matchDay, /create-match/)
})

test('Coach Resources expose direct open controls and hide invalid Formation Board assignment controls', async () => {
  const [screens, data] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8'),
  ])
  assert.match(screens, /Linking\.canOpenURL/)
  assert.match(screens, /data\.map\(\(resource\)[\s\S]*label="Open Resource"/)
  assert.match(screens, /selected\.isFormationBoard \? <Text/)
  assert.match(data, /\.filter\(\(item\) => item\.teamId === user\.activeTeamId\)/)
})
