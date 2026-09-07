import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { hardeningMigrationScope, matchesHardeningMigrationScope } from '../scripts/v1-hardening-migration-scope.mjs'

test('combined migration exception accepts only the exact added files and verified base', () => {
  const entries = Object.keys(hardeningMigrationScope.hashes).sort().map((path) => ({ path, status: 'A', source: readFileSync(path, 'utf8') }))
  assert.equal(matchesHardeningMigrationScope(hardeningMigrationScope.base, entries), true)
  assert.equal(matchesHardeningMigrationScope('wrong-base', entries), false)
  assert.equal(matchesHardeningMigrationScope(hardeningMigrationScope.base, [...entries, entries[0]]), false)
  assert.equal(matchesHardeningMigrationScope(hardeningMigrationScope.base, [{ ...entries[0], status: 'M' }, entries[1]]), false)
  assert.equal(matchesHardeningMigrationScope(hardeningMigrationScope.base, [{ ...entries[0], source: entries[0].source + 'select 1;' }, entries[1]]), false)
})
