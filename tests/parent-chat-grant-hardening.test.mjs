import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { migrationSourceUrl } from './helpers/migration-source.mjs'

const hardeningMigrationUrl = migrationSourceUrl(
  '20260714120001_parent_chat_trigger_grant_hardening.sql',
  'active',
)

const triggerFunctions = [
  'parent_chat_sync_parent_link',
  'parent_chat_sync_team_staff',
  'parent_chat_sync_squad_decision',
  'parent_chat_sync_match_day',
]

test('Parent Chat trigger grant hardening revokes every application-facing role', async () => {
  const migration = await readFile(hardeningMigrationUrl, 'utf8')
  const statements = migration
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)

  assert.equal(statements.length, triggerFunctions.length)

  for (const functionName of triggerFunctions) {
    assert.match(
      migration,
      new RegExp(
        `revoke execute on function public\\.${functionName}\\(\\) from public, anon, authenticated;`,
        'i',
      ),
    )
  }
})

test('Parent Chat trigger grant hardening is limited to the four intended functions', async () => {
  const migration = await readFile(hardeningMigrationUrl, 'utf8')
  const referencedFunctions = [
    ...migration.matchAll(/function\s+public\.([a-z0-9_]+)\s*\(/gi),
  ].map((match) => match[1])

  assert.deepEqual([...new Set(referencedFunctions)].sort(), [...triggerFunctions].sort())
  assert.doesNotMatch(migration, /\bgrant\b/i)
  assert.doesNotMatch(migration, /\bcreate\b/i)
  assert.doesNotMatch(migration, /\bdrop\b/i)
  assert.doesNotMatch(migration, /\balter\b/i)
  assert.doesNotMatch(migration, /\binsert\b/i)
  assert.doesNotMatch(migration, /\bupdate\b/i)
  assert.doesNotMatch(migration, /\bdelete\b/i)
  assert.doesNotMatch(migration, /\btruncate\b/i)
  assert.doesNotMatch(migration, /\bservice_role\b/i)
})
