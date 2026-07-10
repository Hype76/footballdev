import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

import { MIGRATION_SOURCE_MODES, migrationSourceUrl } from './helpers/migration-source.mjs'

test('active migration mode resolves only active production source', () => {
  const url = migrationSourceUrl(
    '20260710094600_match_day_duration_home_away_timer.sql',
    MIGRATION_SOURCE_MODES.active,
  )

  assert.match(fileURLToPath(url), /supabase[\\/]migrations[\\/]20260710094600_match_day_duration_home_away_timer\.sql$/)
  assert.throws(
    () => migrationSourceUrl(
      '20260527093802_match_day_arrival_and_availability.sql',
      MIGRATION_SOURCE_MODES.active,
    ),
    /Required active migration is missing/,
  )
})

test('archived mode resolves only preserved migrations not applied to production', () => {
  const url = migrationSourceUrl(
    '20260527093802_match_day_arrival_and_availability.sql',
    MIGRATION_SOURCE_MODES.archivedNotAppliedProduction,
  )

  assert.match(
    fileURLToPath(url),
    /supabase[\\/]archived-migrations[\\/]not-applied-production[\\/]20260527093802_match_day_arrival_and_availability\.sql$/,
  )
  assert.throws(
    () => migrationSourceUrl(
      '20260710094600_match_day_duration_home_away_timer.sql',
      MIGRATION_SOURCE_MODES.archivedNotAppliedProduction,
    ),
    /Required archivedNotAppliedProduction migration is missing/,
  )
})

test('any-known mode resolves one source and fails on missing migration', () => {
  assert.match(
    fileURLToPath(migrationSourceUrl(
      '20260625083639_harden_tester_feedback_reports_grants.sql',
      MIGRATION_SOURCE_MODES.anyKnownMigration,
    )),
    /supabase[\\/]migrations[\\/]20260625083639_harden_tester_feedback_reports_grants\.sql$/,
  )
  assert.match(
    fileURLToPath(migrationSourceUrl(
      '20260617191000_harden_parent_poll_vote_visibility.sql',
      MIGRATION_SOURCE_MODES.anyKnownMigration,
    )),
    /supabase[\\/]archived-migrations[\\/]not-applied-production/,
  )
  assert.throws(
    () => migrationSourceUrl(
      '20990101000000_missing_migration.sql',
      MIGRATION_SOURCE_MODES.anyKnownMigration,
    ),
    /Known migration is missing/,
  )
})

test('any-known mode fails when a filename exists in both intended sources', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'fp-migration-source-'))
  const helperPath = fileURLToPath(new URL('./helpers/migration-source.mjs', import.meta.url))
  const temporaryHelper = join(temporaryRoot, 'tests', 'helpers', 'migration-source.mjs')
  const filename = '20990101000001_ambiguous_migration.sql'

  try {
    await mkdir(dirname(temporaryHelper), { recursive: true })
    await mkdir(join(temporaryRoot, 'supabase', 'migrations'), { recursive: true })
    await mkdir(join(temporaryRoot, 'supabase', 'archived-migrations', 'not-applied-production'), { recursive: true })
    await cp(helperPath, temporaryHelper)
    await cp(
      fileURLToPath(new URL('../supabase/migrations/20260710094600_match_day_duration_home_away_timer.sql', import.meta.url)),
      join(temporaryRoot, 'supabase', 'migrations', filename),
    )
    await cp(
      fileURLToPath(new URL('../supabase/migrations/20260710094600_match_day_duration_home_away_timer.sql', import.meta.url)),
      join(temporaryRoot, 'supabase', 'archived-migrations', 'not-applied-production', filename),
    )

    const temporaryModule = await import(`${pathToFileURL(temporaryHelper).href}?test=${Date.now()}`)
    assert.throws(
      () => temporaryModule.migrationSourceUrl(filename, temporaryModule.MIGRATION_SOURCE_MODES.anyKnownMigration),
      /Known migration is ambiguous/,
    )
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
