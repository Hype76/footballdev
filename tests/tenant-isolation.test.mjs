import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL('../supabase/migrations/20260720091524_p1_tenant_parent_player_staff_feedback_isolation.sql', import.meta.url)
const feedbackUrl = new URL('../src/lib/domain/feedback.js', import.meta.url)
const parentPortalUrl = new URL('../src/lib/domain/parent-portal.js', import.meta.url)
const coreUrl = new URL('../src/lib/domain/core.js', import.meta.url)

test('P1 migration defines focused current-state authority helpers with controlled execution', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const helpers = [
    'current_user_has_club_wide_authority',
    'current_user_has_active_team_assignment',
    'current_user_can_access_team',
    'current_user_can_access_staff_player',
    'current_user_can_access_parent_player',
    'current_user_can_access_parent_team',
    'current_user_can_read_feedback',
    'current_user_can_view_feedback_board_item',
  ]

  for (const helper of helpers) {
    assert.match(migration, new RegExp(`create or replace function public\\.${helper}\\(`, 'i'))
    assert.match(migration, new RegExp(`revoke all on function public\\.${helper}\\([^;]*from public, anon`, 'i'))
    assert.match(migration, new RegExp(`grant execute on function public\\.${helper}\\([^;]*to authenticated, service_role`, 'i'))
  }

  assert.match(migration, /set search_path = pg_catalog, public/gi)
  assert.match(migration, /current_user_has_active_authority\(\)/i)
  assert.match(migration, /join public\.team_staff assignment[\s\S]*assignment\.user_id = \(select auth\.uid\(\)\)/i)
  assert.doesNotMatch(migration, /request\.jwt\.claims|raw_user_meta_data|user_metadata/i)
})

test('parent, team, player, club and feedback policies replace broad access combinations', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /drop policy if exists clubs_select_authenticated[\s\S]*create policy clubs_select_exact_authority/i)
  assert.doesNotMatch(migration, /create policy clubs_select_exact_authority[\s\S]{0,180}?using \(true\)/i)
  assert.match(migration, /create policy players_select_exact_authority[\s\S]*current_user_can_access_parent_player\(id\)/i)
  assert.match(migration, /create policy players_update_exact_authority[\s\S]*current_user_can_access_team\(club_id, team_id\)/i)
  assert.match(migration, /create policy team_staff_select_exact_authority[\s\S]*current_user_can_access_team\(team_id\)/i)
  assert.match(migration, /create policy player_staff_notes_select_exact_team[\s\S]*current_user_can_access_staff_player\(player_id, club_id\)/i)
  assert.match(migration, /create policy match_day_availability_staff_select_exact_team[\s\S]*current_user_can_access_team\(club_id, team_id\)/i)
  assert.match(migration, /create policy match_day_assignments_staff_exact_team[\s\S]*current_user_can_access_team\(club_id, team_id\)/i)
  assert.match(migration, /create policy platform_feedback_select_owner_or_platform[\s\S]*current_user_can_read_feedback\(id\)/i)
  assert.match(migration, /platform_feedback_comments_select_inherited[\s\S]*current_user_can_read_feedback\(feedback_id\)/i)
  assert.match(migration, /platform_feedback_votes_insert_inherited[\s\S]*current_user_can_view_feedback_board_item\(feedback_id\)/i)
})

test('minimal club directory and feedback list exclude ordinary-user private metadata', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const directoryStart = migration.indexOf('create or replace function public.list_club_directory()')
  const directoryEnd = migration.indexOf('revoke all on function public.list_club_directory()', directoryStart)
  const directory = migration.slice(directoryStart, directoryEnd)

  assert.match(directory, /club_name text[\s\S]*logo_url text[\s\S]*website text[\s\S]*town_city text[\s\S]*country text/i)
  assert.doesNotMatch(directory, /contact_email|contact_phone|stripe_|plan_|owner|address_line|postcode|primary_contact|tester_access|created_at|updated_at/i)
  assert.match(migration, /case when public\.current_user_role\(\) = 'super_admin' then feedback\.created_by_email else '' end/i)
  assert.match(migration, /feedback\.status not in \('hidden', 'deleted', 'withdrawn'\)/i)
})

test('browser integrations use narrow parent actions and the minimised feedback RPC', async () => {
  const [feedback, parentPortal, core] = await Promise.all([
    readFile(feedbackUrl, 'utf8'),
    readFile(parentPortalUrl, 'utf8'),
    readFile(coreUrl, 'utf8'),
  ])

  assert.match(feedback, /supabase\.rpc\('list_platform_feedback'\)/)
  assert.match(feedback, /from\('platform_feedback_votes'\)\.insert\(/)
  assert.doesNotMatch(feedback, /from\('platform_feedback_votes'\)\.upsert\(/)
  assert.match(feedback, /error\.code !== '23505'/)
  assert.match(parentPortal, /supabase\.rpc\('update_own_parent_link_email'/)
  assert.match(parentPortal, /supabase\.rpc\('create_own_family_share_link'/)
  assert.match(core, /supabase\.rpc\('update_own_parent_link_email'/)

  const emailUpdateStart = parentPortal.indexOf('export async function updateOwnParentPortalLinksEmail')
  const emailUpdateEnd = parentPortal.indexOf('export async function prepareParentPortalEmailChange', emailUpdateStart)
  assert.doesNotMatch(parentPortal.slice(emailUpdateStart, emailUpdateEnd), /\.from\('parent_player_links'\)[\s\S]*\.update\(/)

  const familyStart = parentPortal.indexOf('export async function createFamilyShareLink')
  assert.doesNotMatch(parentPortal.slice(familyStart), /\.from\('parent_player_links'\)[\s\S]*\.(?:insert|update)\(/)
})

test('migration is metadata-only outside narrow function bodies', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const withoutBodies = migration
    .replace(/as \$\$[\s\S]*?\$\$;/gi, '')
    .replace(/language sql[\s\S]*?\$\$;/gi, '')

  assert.doesNotMatch(withoutBodies, /\b(?:insert into|update|delete from)\s+public\.(?:clubs|teams|players|parent_player_links|team_staff|platform_feedback)\b/i)
  assert.doesNotMatch(migration, /alter table\s+public\.[a-z_]+\s+(?:drop|add)\s+column/i)
})
