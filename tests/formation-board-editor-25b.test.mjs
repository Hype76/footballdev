import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  canArchiveFormationBoard,
  canCreateFormationBoard,
  canEditFormationBoard,
  canUseFormationBoards,
} from '../src/lib/auth-permissions.js'
import {
  applyFormationPreset,
  assignPlayerToPitch,
  benchFormationPlayer,
  createEditorSnapshot,
  createFormationBoardDraftKey,
  moveFormationPlayer,
  parseFormationDraft,
  replaceFormationPlayer,
  serializeFormationDraft,
  updateFormationPlayerNumber,
} from '../src/lib/formation-board-editor.js'

const activeStaffBase = {
  activeTeamId: '22222222-2222-4222-8222-222222222222',
  clubId: '11111111-1111-4111-8111-111111111111',
  id: '33333333-3333-4333-8333-333333333333',
  planKey: 'small_club',
  planStatus: 'active',
}

const sevenPreset = {
  gameFormat: '7v7',
  key: '7v7-2-3-1',
  playerCount: 7,
  registryVersion: 1,
  slots: [
    { group: 'goalkeeper', id: 'gk', x: 0.5, y: 0.92 },
    { group: 'defender', id: 'def-left', x: 0.3, y: 0.72 },
    { group: 'defender', id: 'def-right', x: 0.7, y: 0.72 },
    { group: 'midfielder', id: 'mid-left', x: 0.2, y: 0.48 },
    { group: 'midfielder', id: 'mid-centre', x: 0.5, y: 0.5 },
    { group: 'midfielder', id: 'mid-right', x: 0.8, y: 0.48 },
    { group: 'forward', id: 'forward', x: 0.5, y: 0.2 },
  ],
}

function emptySnapshot() {
  return createEditorSnapshot({
    board: {
      currentVersionNumber: 1,
      formationPresetKey: sevenPreset.key,
      gameFormat: sevenPreset.gameFormat,
      title: 'Test board',
      visibilityState: 'draft',
      currentVersion: { bench: [], placements: [] },
    },
  })
}

test('Formation Board access follows Team role ceilings and Club Admin assignment context', () => {
  const manager = { ...activeStaffBase, role: 'manager', roleRank: 50 }
  const coach = { ...activeStaffBase, role: 'coach', roleRank: 30 }
  const assistant = { ...activeStaffBase, role: 'assistant_coach', roleRank: 20 }
  const parent = { ...activeStaffBase, role: 'parent_portal', roleRank: 0 }
  const unassignedClubAdmin = { ...activeStaffBase, role: 'admin', roleRank: 90, activeTeamAssignmentRoleRank: 0 }
  const assignedClubAdmin = { ...unassignedClubAdmin, activeTeamAssignmentRoleRank: 50 }

  assert.equal(canUseFormationBoards(manager), true)
  assert.equal(canCreateFormationBoard(manager), true)
  assert.equal(canCreateFormationBoard(coach), true)
  assert.equal(canCreateFormationBoard(assistant), false)
  assert.equal(canUseFormationBoards(assistant), true)
  assert.equal(canUseFormationBoards(parent), false)
  assert.equal(canUseFormationBoards(unassignedClubAdmin), true)
  assert.equal(canCreateFormationBoard(unassignedClubAdmin), false)
  assert.equal(canCreateFormationBoard(assignedClubAdmin), true)
})

test('Formation Board editing follows Manager, Coach shared or own, and Assistant ceilings', () => {
  const manager = { ...activeStaffBase, role: 'manager', roleRank: 50 }
  const coach = { ...activeStaffBase, role: 'coach', roleRank: 30 }
  const assistant = { ...activeStaffBase, role: 'assistant_coach', roleRank: 20 }
  const sharedBoard = { archivedAt: '', createdByProfileId: 'someone-else', visibilityState: 'shared' }
  const privateBoard = { ...sharedBoard, visibilityState: 'draft' }
  const ownBoard = { ...privateBoard, createdByProfileId: coach.id }

  assert.equal(canEditFormationBoard(manager, privateBoard), true)
  assert.equal(canEditFormationBoard(coach, sharedBoard), true)
  assert.equal(canEditFormationBoard(coach, privateBoard), false)
  assert.equal(canEditFormationBoard(coach, ownBoard), true)
  assert.equal(canEditFormationBoard(assistant, sharedBoard), false)
  assert.equal(canEditFormationBoard(manager, { ...privateBoard, archivedAt: '2026-08-02' }), false)
  assert.equal(canArchiveFormationBoard(manager, sharedBoard), true)
  assert.equal(canArchiveFormationBoard(coach, sharedBoard), false)
  assert.equal(canArchiveFormationBoard(coach, ownBoard), true)
  assert.equal(canArchiveFormationBoard(assistant, ownBoard), false)
})

test('assignment, duplicate prevention, movement, number change, replacement, and bench are deterministic', () => {
  const playerOne = { id: 'player-1', playerName: 'Alex One', shirtNumber: '7' }
  const playerTwo = { id: 'player-2', playerName: 'Casey Two', shirtNumber: '9' }
  const assigned = assignPlayerToPitch(emptySnapshot(), playerOne, { x: 0.2, y: 0.3 }, sevenPreset.slots[1])
  const duplicate = assignPlayerToPitch(assigned, playerOne, { x: 0.8, y: 0.8 })
  const moved = moveFormationPlayer(duplicate, playerOne.id, { x: -2, y: 2 })
  const renumbered = updateFormationPlayerNumber(moved, playerOne.id, '17')
  const replaced = replaceFormationPlayer(renumbered, playerOne.id, playerTwo)
  const benched = benchFormationPlayer(replaced, playerTwo.id)

  assert.equal(duplicate.placements.length, 1)
  assert.equal(moved.placements[0].x, 0.04)
  assert.equal(moved.placements[0].y, 0.96)
  assert.equal(renumbered.placements[0].shirtNumber, '17')
  assert.equal(replaced.placements[0].displayName, 'Casey Two')
  assert.equal(benched.placements.length, 0)
  assert.equal(benched.bench[0].playerId, playerTwo.id)
})

test('formation changes preserve goalkeeper mapping and bench every unmatched Player', () => {
  const elevenPlayers = Array.from({ length: 11 }, (_, index) => ({
    displayName: `Player ${index + 1}`,
    playerId: `player-${index + 1}`,
    positionGroup: index === 0 ? 'goalkeeper' : index < 5 ? 'defender' : index < 9 ? 'midfielder' : 'forward',
    shirtNumber: String(index + 1),
    slotId: `slot-${index}`,
    x: 0.5,
    y: 0.5,
  }))
  const changed = applyFormationPreset({ ...emptySnapshot(), placements: elevenPlayers }, sevenPreset)

  assert.equal(changed.placements.length, 7)
  assert.equal(changed.bench.length, 4)
  assert.equal(changed.placements[0].playerId, 'player-1')
  assert.equal(changed.placements[0].slotId, 'gk')
  assert.equal(new Set([...changed.placements, ...changed.bench].map((item) => item.playerId)).size, 11)
})

test('local drafts are scoped and reject invalid payloads', () => {
  const snapshot = emptySnapshot()
  const key = createFormationBoardDraftKey({ boardId: 'board-1', clubId: 'club-1', teamId: 'team-1', userId: 'user-1' })
  const parsed = parseFormationDraft(serializeFormationDraft(snapshot, 'board-1'))

  assert.equal(key, 'football-player:formation-board-draft:v1:user-1:club-1:team-1:board-1')
  assert.equal(parsed.boardId, 'board-1')
  assert.deepEqual(parsed.snapshot.placements, [])
  assert.equal(parseFormationDraft('{bad json'), null)
})

test('Formation Board route, Team Resources entry, and quick action stay staff-scoped', async () => {
  const [layout, page, resourcePage, router] = await Promise.all([
    readFile(new URL('../src/components/layout/Layout.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/FormationBoardsPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/ResourceLibraryPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/router.jsx', import.meta.url), 'utf8'),
  ])

  assert.match(layout, /label: 'Formation Board', href: '\/resources\/formation-boards\?action=create'/)
  assert.match(layout, /canCreateFormationBoard\(user\)/)
  assert.match(layout, /!isFormationBoardEditor/)
  assert.match(resourcePage, /Open Formation Boards/)
  assert.match(router, /function RequireFormationBoardAccess\(\)/)
  assert.match(router, /path: 'resources\/formation-boards'/)
  assert.match(page, /Shared with authorised Team staff/)
  assert.doesNotMatch(page, /Coming Soon/i)
  assert.doesNotMatch(page, /send email|push notification|Parent sharing/i)
})

test('editor includes Pointer Events, tap positioning, keyboard movement, local draft, conflict, and mobile controls', async () => {
  const [page, pitch] = await Promise.all([
    readFile(new URL('../src/pages/FormationBoardsPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/formation-board/FormationBoardPitch.jsx', import.meta.url), 'utf8'),
  ])

  assert.match(pitch, /onPointerDown/)
  assert.match(pitch, /setPointerCapture/)
  assert.match(pitch, /ArrowDown/)
  assert.match(pitch, /event\.shiftKey \? 0\.05 : 0\.01/)
  assert.match(pitch, /Delete|Backspace/)
  assert.match(page, /Tap the pitch to position/)
  assert.match(page, /beforeunload/)
  assert.match(page, /Restore draft/)
  assert.match(page, /Save as new board/)
  assert.match(page, /Players and bench/)
  assert.match(page, /env\(safe-area-inset-bottom\)/)
  assert.match(page, /Promise\.allSettled/)
  assert.match(page, /error\.code !== 'formation_board_version_conflict'/)
  assert.match(page, /allowNavigationRef\.current = true[\s\S]*board=\$\{savedBoard\.id\}/)
})

test('editor metadata and immutable version use one atomic server transaction', async () => {
  const [conflictRepair, domain, migration, page] = await Promise.all([
    readFile(new URL('../supabase/migrations/20260802161500_formation_board_conflict_error_code_25b.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/domain/formation-board.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260802155000_formation_board_editor_save_25b.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/FormationBoardsPage.jsx', import.meta.url), 'utf8'),
  ])

  assert.match(domain, /saveFormationBoardEditor/)
  assert.match(domain, /save_formation_board_editor/)
  assert.match(page, /saveFormationBoardEditor/)
  assert.match(migration, /security definer/)
  assert.match(migration, /saved_board := public\.save_formation_board_version/)
  assert.match(migration, /return public\.rename_formation_board/)
  assert.match(migration, /revoke all[\s\S]*from public, anon/)
  assert.match(migration, /grant execute[\s\S]*to authenticated/)
  assert.doesNotMatch(conflictRepair, /40001/)
  assert.equal(conflictRepair.match(/errcode = 'P0001'/g)?.length, 4)
})
