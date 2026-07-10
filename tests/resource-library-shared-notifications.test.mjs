import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const domainUrl = new URL('../src/lib/domain/resource-library.js', import.meta.url)
const resourcePageUrl = new URL('../src/pages/ResourceLibraryPage.jsx', import.meta.url)
const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const migrationUrl = new URL('../supabase/migrations/20260710180206_resource_library_shared_parent_notifications.sql', import.meta.url)

test('shared resource assignment uses one trusted RPC for allocation, transition, and notification', async () => {
  const [domain, migration] = await Promise.all([
    readFile(domainUrl, 'utf8'),
    readFile(migrationUrl, 'utf8'),
  ])
  const assignmentSource = domain.slice(
    domain.indexOf('export async function assignResourceLibraryItem'),
    domain.indexOf('export async function removeResourceLibraryLink'),
  )

  assert.match(domain, /rpc\('assign_resource_library_item_with_parent_notifications'/)
  assert.doesNotMatch(assignmentSource, /\.from\('resource_library_links'\)/)
  assert.match(migration, /security definer[\s\S]*current_user_can_manage_resource_library\(target_club_id, target_team_id\)/i)
  assert.match(migration, /resource_library_link_target_allowed\([\s\S]*target_type_value[\s\S]*target_id_value/i)
  assert.match(migration, /target_type_value not in \('player', 'team'\)/i)
  assert.match(migration, /targets_value is null/i)
  assert.match(migration, /jsonb_array_length\(targets_value\) > 200/i)
})

test('only new shared player allocations and internal-to-shared transitions queue parent email', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /requested_parent_visible := target_type_value = 'player'/i)
  assert.match(migration, /and requested_parent_visible[\s\S]*and not previous_parent_visible then/i)
  assert.match(migration, /case when requested_parent_visible then nullif\(normalized_share_description, ''\) else null end/i)
  assert.match(migration, /insert into public\.scheduled_email_queue/i)
  assert.match(migration, /'requiredFeature', 'parentEmails'/i)
  assert.doesNotMatch(migration, /communicationLog/i)
  assert.doesNotMatch(migration, /push/i)
})

test('parent recipients are active authenticated child links in the exact club and team scope', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /parent_link\.club_id = target_club_id/i)
  assert.match(migration, /parent_link\.player_id = target_id_value/i)
  assert.match(migration, /parent_link\.team_id = target_team_id or parent_link\.team_id is null/i)
  assert.match(migration, /parent_link\.status = 'active'/i)
  assert.match(migration, /parent_link\.auth_user_id is not null/i)
  assert.match(migration, /parent_link\.email\) ~\* '\^\[\^\[:space:\]@\]/i)
  assert.match(migration, /distinct on \(lower\(btrim\(parent_link\.email\)\)\)/i)
})

test('notification ledger and active resource link make retries and repeat saves idempotent', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /create table if not exists public\.resource_library_parent_notifications/i)
  assert.match(migration, /resource_library_parent_notifications_link_recipient_key/i)
  assert.match(migration, /\(link_id, lower\(recipient_email\)\)/i)
  assert.match(migration, /on conflict do nothing[\s\S]*returning id into notification_id_value/i)
  assert.match(migration, /when previous_parent_visible = requested_parent_visible[\s\S]*then 'unchanged'/i)
  assert.match(migration, /resource_library_links_active_target_key|link\.removed_at is null/i)
})

test('parent portal RPC is child scoped and returns no staff-only metadata', async () => {
  const [domain, migration, parentPortalPage] = await Promise.all([
    readFile(domainUrl, 'utf8'),
    readFile(migrationUrl, 'utf8'),
    readFile(parentPortalPageUrl, 'utf8'),
  ])

  assert.match(domain, /delete item\.description/)
  assert.match(migration, /security definer[\s\S]*get_parent_portal_player_resources/i)
  assert.match(migration, /parent_link\.id = parent_link_id_value/i)
  assert.match(migration, /parent_link\.auth_user_id = auth\.uid\(\)/i)
  assert.match(migration, /parent_link\.status = 'active'/i)
  assert.match(migration, /link\.parent_visible is true/i)
  assert.match(migration, /''::text as description/i)
  assert.match(migration, /''::text as storage_path/i)
  assert.match(migration, /null::uuid as uploaded_by_profile_id/i)
  assert.match(migration, /null::timestamptz as assigned_at/i)
  assert.match(migration, /drop policy if exists resource_library_items_select_parent_visible/i)
  assert.match(migration, /drop policy if exists resource_library_links_select_parent_visible/i)
  assert.match(migration, /using \(public\.current_user_can_view_resource_library\(club_id, team_id\)\)/i)
  assert.doesNotMatch(parentPortalPage, /resource\.description/)
})

test('staff UI distinguishes internal-only and parent-shared allocation modes', async () => {
  const page = await readFile(resourcePageUrl, 'utf8')

  assert.match(page, /assignmentDraft\.parentVisible \? 'Shared with parents' : 'Staff only'/)
  assert.match(page, /Shared with linked parents\./)
  assert.match(page, /Staff can now see the assignment in the permitted scope\./)
})

test('resource notification email contains only safe child and resource context', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /New resource shared for/)
  assert.match(migration, /A new resource has been shared for/)
  assert.match(migration, /https:\/\/parent\.footballplayer\.online\//)
  assert.doesNotMatch(migration, /resource_row\.description/)
  assert.doesNotMatch(migration, /share_description.*email_html_value/i)
  assert.doesNotMatch(migration, /storage_path.*email_html_value/i)
})
