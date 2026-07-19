import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationsUrl = new URL('../supabase/migrations/', import.meta.url)
const dependentMigrationUrl = new URL(
  '../supabase/migrations/20260616091650_default_assessment_scores_10_point.sql',
  import.meta.url,
)
const archivedPrerequisiteUrl = new URL(
  '../supabase/archived-migrations/not-applied-production/20260609165720_add_progression_chart_field_flag.sql',
  import.meta.url,
)
const resourceLibraryConsumerUrl = new URL(
  '../supabase/migrations/20260708081841_resource_library_squad_sharing_description.sql',
  import.meta.url,
)

const prerequisitePattern = /alter table public\.form_fields\s+add column if not exists include_in_progress_chart boolean not null default false;/i

test('active migration versions are unique and the local-only prerequisite stays archived', async () => {
  const migrationFiles = (await readdir(migrationsUrl)).filter((name) => name.endsWith('.sql'))
  const versions = migrationFiles.map((name) => name.split('_', 1)[0])

  assert.equal(new Set(versions).size, versions.length)
  assert.equal(migrationFiles.some((name) => name.startsWith('20260609165720_')), false)
  assert.equal(migrationFiles.includes('20260616091650_default_assessment_scores_10_point.sql'), true)
})

test('the first active consumer establishes the archived progression-chart prerequisite before use', async () => {
  const [dependentMigration, archivedPrerequisite] = await Promise.all([
    readFile(dependentMigrationUrl, 'utf8'),
    readFile(archivedPrerequisiteUrl, 'utf8'),
  ])

  assert.match(archivedPrerequisite, prerequisitePattern)
  assert.match(dependentMigration, prerequisitePattern)

  const prerequisiteIndex = dependentMigration.search(prerequisitePattern)
  const nextColumnUse = dependentMigration.indexOf('include_in_progress_chart', prerequisiteIndex + 1)

  assert.ok(prerequisiteIndex >= 0)
  assert.ok(nextColumnUse > prerequisiteIndex)
  assert.ok(dependentMigration.indexOf('update public.form_fields', prerequisiteIndex) > prerequisiteIndex)
})

test('CREATE OR REPLACE keeps the established plan-feature parameter names stable', async () => {
  const migrationFiles = (await readdir(migrationsUrl))
    .filter((name) => name.endsWith('.sql'))
    .sort()
  const declarations = []

  for (const migrationFile of migrationFiles) {
    const source = await readFile(new URL(migrationFile, migrationsUrl), 'utf8')
    for (const match of source.matchAll(
      /create or replace function public\.can_use_plan_feature\(target_club_id uuid, ([a-z_]+) text\)/gi,
    )) {
      declarations.push({ migrationFile, parameterName: match[1] })
    }
  }

  assert.ok(declarations.length >= 2)
  assert.deepEqual(
    [...new Set(declarations.map(({ parameterName }) => parameterName))],
    ['feature_name'],
  )
})

test('the first active external-resource consumer carries its reviewed schema prerequisite', async () => {
  const migration = await readFile(resourceLibraryConsumerUrl, 'utf8')

  assert.match(migration, /alter table public\.resource_library_links[\s\S]*add column if not exists parent_visible boolean not null default false/i)
  assert.match(migration, /create table if not exists public\.resource_library_external_links/i)
  assert.match(migration, /create or replace function public\.create_external_resource_library_item\(/i)
  assert.match(migration, /alter table public\.resource_library_external_links enable row level security/i)
  assert.match(migration, /resource_library_external_links_insert_manager/i)
  assert.match(migration, /resource_library_external_links_update_manager/i)
})
