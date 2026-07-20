import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDirectory, '..')
const migrationPath = resolve(repoRoot, 'supabase/migrations/20260720173941_p2_privileged_function_authority_hardening.sql')

async function readRepoFile(path) {
  return readFile(resolve(repoRoot, path), 'utf8')
}

test('privileged mutation wrappers derive current authority and use fixed execution context', async () => {
  const migration = await readFile(migrationPath, 'utf8')
  const publicWrappers = [
    'seed_default_club_roles',
    'create_club_role',
    'upsert_match_location_for_team',
    'create_team_poll',
    'set_team_poll_status',
    'delete_team_poll',
    'submit_staff_poll_vote',
    'get_parent_portal_polls',
    'submit_parent_portal_poll_vote',
    'create_match_day_motm_poll',
    'create_match_day_motm_poll_on_full_time',
  ]

  for (const wrapper of publicWrappers) {
    const definition = new RegExp(
      `create or replace function public\\.${wrapper}\\([\\s\\S]+?security definer[\\s\\S]+?set search_path = ''`,
      'i',
    )
    assert.match(migration, definition, `${wrapper} must be SECURITY DEFINER with an empty search path`)
  }

  assert.match(migration, /app_private\.actor_can_manage_team_resource\([\s\S]+?auth\.uid\(\)/i)
  assert.match(migration, /app_user\.status = 'active'/)
  assert.match(migration, /membership\.role_rank = app_user\.role_rank/)
  assert.match(migration, /assignment\.team_id = team\.id[\s\S]+?assignment\.user_id = p_actor_id/)
  assert.match(migration, /app_user\.role not in \('parent_portal', 'super_admin'\)/)
  assert.match(migration, /for key share of app_user, membership, club/)
})

test('browser and service grants are explicit and direct mutation privileges are removed', async () => {
  const migration = await readFile(migrationPath, 'utf8')

  assert.match(migration, /grant execute on function public\.seed_default_club_roles\(\) to authenticated/)
  assert.match(migration, /grant execute on function public\.seed_default_club_roles_for_actor\(uuid, uuid, text\) to service_role/)
  assert.match(migration, /revoke all on function public\.seed_default_club_roles_for_actor\(uuid, uuid, text\)[\s\S]+?from public, anon, authenticated/)
  assert.match(migration, /revoke all on function public\.create_match_day_motm_poll\(uuid\)[\s\S]+?from public, anon, authenticated, service_role/)

  for (const table of ['match_locations', 'polls', 'poll_votes', 'club_roles']) {
    assert.match(
      migration,
      new RegExp(`revoke insert, update, delete, truncate, references, trigger\\s+on table public\\.${table} from authenticated`, 'i'),
    )
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon`, 'i'))
    assert.match(migration, new RegExp(`grant select on table public\\.${table} to authenticated`, 'i'))
  }

  assert.match(migration, /drop function if exists public\.upsert_match_location\(uuid, text, text, text\)/)
  assert.match(migration, /drop function if exists public\.seed_default_club_roles\(uuid\)/)
})

test('application callers use the narrow wrappers and no affected browser caller writes tables directly', async () => {
  const paths = [
    'src/lib/domain/match-day.js',
    'src/lib/domain/polls.js',
    'src/lib/domain/core-seeding.js',
    'src/lib/domain/role-queries.js',
  ]
  const source = (await Promise.all(paths.map(readRepoFile))).join('\n')

  for (const wrapper of [
    'upsert_match_location_for_team',
    'create_team_poll',
    'set_team_poll_status',
    'delete_team_poll',
    'submit_staff_poll_vote',
    'seed_default_club_roles',
    'create_club_role',
  ]) {
    assert.match(source, new RegExp(`rpc\\('${wrapper}'`), `application caller must use ${wrapper}`)
  }

  assert.doesNotMatch(source, /rpc\('upsert_match_location'/)
  assert.doesNotMatch(source, /\.from\('(match_locations|poll_votes)'\)\s*\.(insert|update|upsert|delete)/s)

  const polls = await readRepoFile('src/lib/domain/polls.js')
  const roles = await readRepoFile('src/lib/domain/role-queries.js')
  assert.doesNotMatch(polls, /\.from\('polls'\)\s*\.(insert|update|upsert|delete)/s)
  assert.doesNotMatch(roles, /\.from\('club_roles'\)\s*\.(insert|update|upsert|delete)/s)
  assert.match(roles, /isDemoAccountValue\(user\) \|\| user\.role !== 'admin'/)
})

test('server onboarding callers bind deliberate workflows to a revalidated actor', async () => {
  const platform = await readRepoFile('netlify/functions/platform-create-club.js')
  const signup = await readRepoFile('netlify/functions/ensure-signup-club-profile.js')

  assert.match(platform, /rpc\('seed_default_club_roles_for_actor',[\s\S]+?p_actor_id: platformAdmin\.id,[\s\S]+?p_workflow: 'platform_create_club'/)
  assert.match(signup, /rpc\('seed_default_club_roles_for_actor',[\s\S]+?p_actor_id: actorId,[\s\S]+?p_workflow: 'signup_workspace'/)
  assert.ok(
    signup.indexOf('await seedDefaultClubRoles(club.id, authUser.id)') > signup.indexOf(".from('user_club_memberships')"),
    'signup role seeding must run only after the actor membership exists',
  )
})

test('migration is metadata-only at top level and preserves protected P0 workflows', async () => {
  const migration = await readFile(migrationPath, 'utf8')
  const topLevelSql = migration.replace(/\$\$[\s\S]*?\$\$/g, '')

  assert.doesNotMatch(migration, /reset_demo_account_atomic_impl/)
  assert.doesNotMatch(migration, /delete_platform_club_cascade/)
  assert.doesNotMatch(migration, /set_club_user_role/)
  assert.doesNotMatch(topLevelSql, /\b(insert into|update|delete from)\s+public\./i)
})
