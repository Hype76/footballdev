import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  FORMATION_BOARD_GAME_FORMATS,
  FORMATION_BOARD_REGISTRY_VERSION,
  getFormationBoardError,
  normalizeFormationBoard,
  normalizeFormationBoardPreset,
} from '../src/lib/domain/formation-board.js'

const migrationUrl = new URL('../supabase/migrations/20260802130700_formation_board_foundation_25a.sql', import.meta.url)
const auditSourceRepairUrl = new URL('../supabase/migrations/20260802132311_formation_board_audit_source_25a.sql', import.meta.url)
const rollbackUrl = new URL('../supabase/repairs/FP-V1-FORMATION-BOARD-FOUNDATION-25A-rollback.sql', import.meta.url)
const supabaseFacadeUrl = new URL('../src/lib/supabase.js', import.meta.url)

test('client constants preserve the V1 registry formats', () => {
  assert.equal(FORMATION_BOARD_REGISTRY_VERSION, 1)
  assert.deepEqual(FORMATION_BOARD_GAME_FORMATS.map((format) => format.value), ['5v5', '7v7', '9v9', '11v11'])
  assert.deepEqual(FORMATION_BOARD_GAME_FORMATS.map((format) => format.playerCount), [5, 7, 9, 11])
})

test('normalizers expose board, version, publication, and preset snapshots without changing stored values', () => {
  const board = normalizeFormationBoard({
    board: {
      club_id: 'club-1',
      created_by_profile_id: 'user-1',
      current_publication_id: 'publication-1',
      current_version_id: 'version-2',
      current_version_number: 2,
      description: 'Pressing plan',
      formation_preset_key: '7v7-2-3-1',
      game_format: '7v7',
      id: 'board-1',
      preset_registry_version: 1,
      team_id: 'team-1',
      title: 'Saturday shape',
      visibility_state: 'shared',
    },
    currentPublication: {
      board_version_id: 'version-1',
      id: 'publication-1',
      publication_number: 1,
      resource_id: 'resource-1',
    },
    currentVersion: {
      bench: [{ playerId: 'player-2', shirtNumber: '12' }],
      board_id: 'board-1',
      id: 'version-2',
      placements: [{ playerId: 'player-1', shirtNumber: '7', x: 0.5, y: 0.8 }],
      version_number: 2,
    },
  })

  assert.equal(board.id, 'board-1')
  assert.equal(board.currentVersion.versionNumber, 2)
  assert.equal(board.currentVersion.placements[0].x, 0.5)
  assert.equal(board.currentPublication.resourceId, 'resource-1')

  assert.deepEqual(normalizeFormationBoardPreset({
    display_name: '2-3-1',
    game_format: '7v7',
    player_count: 7,
    preset_key: '7v7-2-3-1',
    readiness_state: 'ready',
    registry_version: 1,
    slots: [{ id: 'gk', x: 0.5, y: 0.92 }],
    sort_order: 10,
  }), {
    displayName: '2-3-1',
    gameFormat: '7v7',
    key: '7v7-2-3-1',
    playerCount: 7,
    readinessState: 'ready',
    registryVersion: 1,
    slots: [{ id: 'gk', x: 0.5, y: 0.92 }],
    sortOrder: 10,
  })
})

test('structured server errors become actionable client messages', () => {
  const conflict = getFormationBoardError({ message: 'formation_board_version_conflict' })
  const scope = getFormationBoardError({ message: 'formation_board_player_out_of_scope' })

  assert.equal(conflict.code, 'formation_board_version_conflict')
  assert.match(conflict.message, /newer saved version/i)
  assert.equal(scope.code, 'formation_board_player_out_of_scope')
  assert.match(scope.message, /not available for this Team/i)
})

test('foundation stays out of normal navigation and exposes only the domain facade', async () => {
  const [migration, supabaseFacade] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(supabaseFacadeUrl, 'utf8'),
  ])

  assert.match(supabaseFacade, /from '\.\/domain\/formation-board\.js'/)
  assert.doesNotMatch(migration, /insert\s+into\s+public\.(navigation|sidebar|feature_flags)/i)
})

test('audit source repair preserves the production source registry', async () => {
  const repair = await readFile(auditSourceRepairUrl, 'utf8')

  assert.match(repair, /'application'/)
  assert.doesNotMatch(repair, /'formation_board'\s*\)\s*returning id into audit_id/i)
})

test('prepared rollback is fail-closed and preserves Formation Board data', async () => {
  const rollback = await readFile(rollbackUrl, 'utf8')

  assert.match(rollback, /revoke select on public\.formation_boards from authenticated/i)
  assert.match(rollback, /revoke execute on function public\.publish_formation_board_version/i)
  assert.doesNotMatch(rollback, /\bdelete\s+from\b|\bdrop\s+table\b|\btruncate\b/i)
})
