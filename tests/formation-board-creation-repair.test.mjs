import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  canCreateFormationBoard,
  canEditFormationBoard,
  canUseFormationBoards,
} from '../src/lib/auth-permissions.js'
import {
  createNewEditorSnapshot,
  snapshotsMatch,
} from '../src/lib/formation-board-editor.js'

const activeStaffBase = {
  activeTeamId: '22222222-2222-4222-8222-222222222222',
  clubId: '11111111-1111-4111-8111-111111111111',
  id: '33333333-3333-4333-8333-333333333333',
  planKey: 'small_club',
  planStatus: 'active',
}

test('Formation Board create and existing-board permissions stay role-scoped', () => {
  const manager = { ...activeStaffBase, role: 'manager', roleRank: 50 }
  const coach = { ...activeStaffBase, role: 'coach', roleRank: 30 }
  const assistant = { ...activeStaffBase, role: 'assistant_coach', roleRank: 20 }
  const sharedBoard = { archivedAt: '', createdByProfileId: 'someone-else', visibilityState: 'shared' }
  const privateBoard = { ...sharedBoard, visibilityState: 'draft' }
  const coachBoard = { ...privateBoard, createdByProfileId: coach.id }

  assert.equal(canCreateFormationBoard(manager), true)
  assert.equal(canCreateFormationBoard(coach), true)
  assert.equal(canCreateFormationBoard(assistant), false)
  assert.equal(canEditFormationBoard(manager, privateBoard), true)
  assert.equal(canEditFormationBoard(coach, sharedBoard), true)
  assert.equal(canEditFormationBoard(coach, coachBoard), true)
  assert.equal(canEditFormationBoard(coach, privateBoard), false)
  assert.equal(canEditFormationBoard(assistant, sharedBoard), false)
})

test('Formation Board page uses create permission for a new route and labels it Not saved', async () => {
  const page = await readFile(new URL('../src/pages/FormationBoardsPage.jsx', import.meta.url), 'utf8')

  assert.match(page, /const isNewBoard = currentBoard\?\.id === 'new'/)
  assert.match(page, /const canEdit = publishedSnapshotVersion[\s\S]*?isNewBoard[\s\S]*?canCreate[\s\S]*?canEditFormationBoard\(user, currentBoard\)/)
  assert.match(page, /setSaveState\(board\.id === 'new' \? 'not_saved'/)
  assert.match(page, /saveState === 'not_saved' \? 'Not saved'/)
  assert.match(page, /snapshotsMatch\(previous, savedSnapshot\) \? \(isNewBoard \? 'not_saved' : 'saved'\)/)
})

test('Blank new boards keep Save disabled until dirty and guard dirty navigation', async () => {
  const page = await readFile(new URL('../src/pages/FormationBoardsPage.jsx', import.meta.url), 'utf8')
  const preset = { key: '11v11-4-4-2', gameFormat: '11v11', registryVersion: 1 }
  const blank = createNewEditorSnapshot(preset)

  assert.equal(snapshotsMatch(blank, blank), true)
  assert.equal(snapshotsMatch(blank, { ...blank, title: 'Saturday match shape' }), false)
  assert.match(page, /useBlocker\(\(\) => hasUnsavedChanges && !allowNavigationRef\.current\)/)
  assert.match(page, /disabled=\{!canEdit \|\| isSaving \|\| !hasUnsavedChanges \|\| pitchCapacity\.isOverCapacity\}/)
  assert.match(page, /setSaveState\('unsaved'\)/)
})
