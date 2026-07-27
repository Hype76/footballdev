import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL('../supabase/migrations/20260727210000_parent_chat_child_filter.sql', import.meta.url)
const legacyMigrationUrl = new URL('../supabase/migrations/20260714120000_parent_portal_chat_v1.sql', import.meta.url)
const domainUrl = new URL('../src/lib/domain/parent-chat.js', import.meta.url)
const activityDomainUrl = new URL('../src/lib/domain/parent-portal-activity.js', import.meta.url)
const pageUrl = new URL('../src/pages/ParentChatPage.jsx', import.meta.url)
const staffPageUrl = new URL('../src/pages/ParentChatStaffPage.jsx', import.meta.url)
const workspaceUrl = new URL('../src/components/chat/ParentChatWorkspace.jsx', import.meta.url)
const shellUrl = new URL('../src/components/parent-portal/ParentPortalShell.jsx', import.meta.url)

test('root cause remains documented by the legacy union and 07C adds a separate Parent Portal scope', async () => {
  const [legacyMigration, migration] = await Promise.all([
    readFile(legacyMigrationUrl, 'utf8'),
    readFile(migrationUrl, 'utf8'),
  ])

  assert.match(
    legacyMigration,
    /public\.parent_chat_parent_can_access_room\(room\.id, target_user_id\)\s+or public\.parent_chat_staff_can_access_team/,
  )
  assert.match(
    legacyMigration,
    /link\.auth_user_id = \(select auth\.uid\(\)\)\s+or public\.parent_chat_staff_can_access_team/,
  )
  assert.match(migration, /create or replace function public\.get_parent_portal_chat_context/)
  assert.match(migration, /create or replace function public\.get_parent_portal_chat_rooms/)
  assert.match(migration, /create or replace function public\.get_parent_portal_chat_messages/)
  assert.match(migration, /create or replace function public\.send_parent_portal_chat_message/)
  assert.match(migration, /create or replace function public\.mark_parent_portal_chat_room_read/)
  assert.match(migration, /create or replace function public\.delete_parent_portal_chat_message/)
  assert.doesNotMatch(migration, /lower\s*\(\s*email|matching email|shared email/i)
})

test('server relevance covers direct child, team and selected match rooms without widening staff authority', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /parent_link\.auth_user_id = target_user_id/)
  assert.match(migration, /parent_link\.status = 'active'/)
  assert.match(migration, /coalesce\(player\.status, 'active'\) <> 'archived'/)
  assert.match(migration, /player\.archived_at is null/)
  assert.match(migration, /room\.room_type = 'parent_staff'[\s\S]*room\.player_id = parent_link\.player_id/)
  assert.match(migration, /or room\.room_type = 'team'/)
  assert.match(migration, /room\.room_type = 'match_squad'[\s\S]*decision\.status = 'selected'/)
  assert.match(migration, /public\.parent_chat_staff_can_access_team\(\s*auth\.uid\(\)/)
  assert.match(migration, /where not child_only_value\s+or public\.parent_chat_room_matches_parent_link/)
  assert.match(migration, /This Chat room is not available for the selected child\./)
  assert.doesNotMatch(migration, /drop function public\.get_parent_chat_rooms|replace function public\.get_parent_chat_rooms/)
})

test('Chat New becomes child-scoped and only a relevant loaded room can clear it', async () => {
  const [migration, activityDomain, page, workspace] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(activityDomainUrl, 'utf8'),
    readFile(pageUrl, 'utf8'),
    readFile(workspaceUrl, 'utf8'),
  ])

  assert.match(migration, /scope_type = 'child'[\s\S]*category_key[\s\S]*'chat'/)
  assert.match(migration, /coalesce\(global_state\.last_viewed_at, statement_timestamp\(\)\)/)
  assert.match(migration, /create or replace function public\.parent_portal_latest_chat_activity/)
  assert.match(migration, /parent_chat_room_matches_parent_link\(\s*room\.id,\s*parent_link_id_value/)
  assert.match(migration, /create or replace function public\.mark_parent_portal_chat_viewed/)
  assert.match(migration, /mark_parent_portal_category_viewed\(\s*parent_link_id_value,\s*'chat'/)
  assert.match(activityDomain, /mark_parent_portal_chat_viewed/)
  assert.match(page, /observedChatState = activitySnapshot\?\.chat/)
  assert.match(page, /markParentPortalChatViewed/)
  assert.match(workspace, /activitySnapshot = await onBeforeRoomLoad/)
  assert.match(workspace, /getParentChatMessages\([\s\S]*markParentChatRoomRead\([\s\S]*onRoomLoadSuccess/)
  assert.doesNotMatch(workspace, /onCategoryLoadSuccess/)
})

test('Parent UI exposes an accessible default-off switch only after server eligibility', async () => {
  const [page, workspace, staffPage, domain, shell] = await Promise.all([
    readFile(pageUrl, 'utf8'),
    readFile(workspaceUrl, 'utf8'),
    readFile(staffPageUrl, 'utf8'),
    readFile(domainUrl, 'utf8'),
    readFile(shellUrl, 'utf8'),
  ])

  assert.match(page, /useState\(false\)/)
  assert.match(page, /getParentPortalChatContext/)
  assert.match(page, /childFilterAvailable=\{childFilterAvailable\}/)
  assert.match(workspace, /childFilterAvailable \? \(/)
  assert.match(workspace, /role="switch"/)
  assert.match(workspace, /aria-checked=\{childOnly\}/)
  assert.match(workspace, />\s*Your child only\s*</)
  assert.match(workspace, /id="parent-chat-child"/)
  assert.match(workspace, /onSelectedParentLinkChange/)
  assert.match(domain, /'get_parent_portal_chat_rooms'/)
  assert.match(domain, /'get_parent_portal_chat_messages'/)
  assert.match(domain, /'send_parent_portal_chat_message'/)
  assert.match(staffPage, /variant="staff"/)
  assert.doesNotMatch(staffPage, /childOnly|childFilterAvailable|parentLinkId/)
  assert.match(shell, /searchParams\.set\('parentLinkId', selectedParentLinkId\)/)
})

test('scope changes and slow responses cannot restore stale room metadata or duplicate subscriptions', async () => {
  const [workspace, domain] = await Promise.all([
    readFile(workspaceUrl, 'utf8'),
    readFile(domainUrl, 'utf8'),
  ])

  assert.match(workspace, /roomRequestIdRef = useRef\(0\)/)
  assert.match(workspace, /messageRequestIdRef = useRef\(0\)/)
  assert.match(workspace, /requestId !== roomRequestIdRef\.current/)
  assert.match(workspace, /requestId !== messageRequestIdRef\.current/)
  assert.match(workspace, /setRooms\(\[\]\)/)
  assert.match(workspace, /setSelectedRoomId\(''\)/)
  assert.match(workspace, /setMessages\(\[\]\)/)
  assert.match(workspace, /return subscribeToParentChatRoom/)
  assert.match(domain, /return \(\) => \{[\s\S]*supabase\.removeChannel\(channel\)/)
  assert.doesNotMatch(workspace, /localStorage|sessionStorage/)
})

test('new scoped RPCs deny anonymous execution and preserve authenticated-only Parent entry', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  for (const signature of [
    'get_parent_portal_chat_context\\(uuid\\)',
    'get_parent_portal_chat_rooms\\(uuid, boolean\\)',
    'get_parent_portal_chat_messages\\(uuid, uuid, boolean\\)',
    'send_parent_portal_chat_message\\(uuid, uuid, text, boolean\\)',
    'mark_parent_portal_chat_room_read\\(uuid, uuid, boolean\\)',
    'delete_parent_portal_chat_message\\(uuid, uuid, boolean\\)',
    'mark_parent_portal_chat_viewed\\(uuid, uuid, timestamptz\\)',
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${signature}[\\s\\S]*from public, anon`))
    assert.match(migration, new RegExp(`grant execute on function public\\.${signature}[\\s\\S]*to authenticated, service_role`))
  }
})
