import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { migrationSourceUrl } from './helpers/migration-source.mjs'

const migrationUrl = migrationSourceUrl('20260714120000_parent_portal_chat_v1.sql', 'active')

function getFunction(source, name) {
  const startPattern = new RegExp(`create or replace function public\\.${name}\\b`, 'i')
  const start = source.search(startPattern)
  assert.notEqual(start, -1, `${name} function is missing`)
  const remainder = source.slice(start)
  const next = remainder.slice(1).search(/\ncreate or replace function public\./i)
  return next === -1 ? remainder : remainder.slice(0, next + 1)
}

test('parent Chat migration creates the controlled shared domain and forward-only room seeds', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /create table if not exists public\.parent_chat_rooms/i)
  assert.match(migration, /create table if not exists public\.parent_chat_memberships/i)
  assert.match(migration, /create table if not exists public\.parent_chat_membership_audit/i)
  assert.match(migration, /create table if not exists public\.parent_chat_messages/i)
  assert.match(migration, /room_type in \('parent_staff', 'team', 'match_squad'\)/i)
  assert.match(migration, /status in \('active', 'closed', 'archived'\)/i)
  assert.match(migration, /parent_chat_rooms_parent_staff_key/i)
  assert.match(migration, /parent_chat_rooms_team_key/i)
  assert.match(migration, /parent_chat_rooms_match_squad_key/i)
  assert.match(migration, /parent_chat_messages_room_created_idx/i)
  assert.match(migration, /char_length\(btrim\(body\)\) between 1 and 2000/i)
  assert.doesNotMatch(migration, /attachment|image_url|file_url|voice_note|typing_indicator/i)
})

test('room access fails closed against current parent, team staff and selected squad relationships', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const parentAccess = getFunction(migration, 'parent_chat_parent_can_access_room')
  const staffAccess = getFunction(migration, 'parent_chat_staff_can_access_team')
  const access = getFunction(migration, 'parent_chat_user_can_access_room')
  const post = getFunction(migration, 'parent_chat_user_can_post_room')

  assert.match(parentAccess, /link\.auth_user_id = target_user_id/i)
  assert.match(parentAccess, /link\.status = 'active'/i)
  assert.match(parentAccess, /link\.club_id = room\.club_id/i)
  assert.match(parentAccess, /link\.player_id = room\.player_id/i)
  assert.match(parentAccess, /coalesce\(link\.team_id, player\.team_id\) = room\.team_id/i)
  assert.match(parentAccess, /decision\.match_day_id = room\.match_day_id/i)
  assert.match(parentAccess, /decision\.player_id = link\.player_id/i)
  assert.match(parentAccess, /decision\.status = 'selected'/i)
  assert.doesNotMatch(parentAccess, /parent_chat_memberships/i)

  assert.match(staffAccess, /staff\.club_id = target_club_id/i)
  assert.match(staffAccess, /coalesce\(staff\.status, 'active'\) = 'active'/i)
  assert.match(staffAccess, /staff\.role not in \('parent_portal', 'super_admin'\)/i)
  assert.match(staffAccess, /coalesce\(staff\.role_rank, 0\) >= 20/i)
  assert.match(staffAccess, /assignment\.team_id = target_team_id/i)
  assert.match(staffAccess, /assignment\.user_id = staff\.id/i)

  assert.match(access, /room\.status in \('active', 'closed'\)/i)
  assert.match(access, /parent_chat_parent_can_access_room/i)
  assert.match(access, /parent_chat_staff_can_access_team/i)
  assert.doesNotMatch(access, /parent_chat_memberships/i)
  assert.match(post, /room\.status = 'active'/i)
  assert.match(post, /fixture\.status in \('scheduled', 'scorer_request', 'live', 'half_time'\)/i)
  assert.match(post, /fixture\.previous_hidden_at is null/i)
})

test('Match Squad Chat uses the saved selected decision and removes access without a deselection message', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const squadSync = getFunction(migration, 'parent_chat_sync_squad_decision')

  assert.match(squadSync, /new\.status = 'selected'/i)
  assert.match(squadSync, /room_type[\s\S]*'match_squad'/i)
  assert.match(squadSync, /parent_chat_reconcile_room\(room_id_value\)/i)
  assert.match(migration, /after insert or update of status, player_id or delete[\s\S]*on public\.match_day_player_squad_decisions/i)
  assert.doesNotMatch(squadSync, /insert into public\.parent_chat_messages/i)
  assert.doesNotMatch(migration, /deselected from chat|removed from squad chat|child was deselected/i)
})

test('membership history reconciles automatically but cannot independently grant room access', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const reconcile = getFunction(migration, 'parent_chat_reconcile_room')

  assert.match(reconcile, /parent_player_links/i)
  assert.match(reconcile, /parent_chat_staff_can_access_team/i)
  assert.match(reconcile, /parent_chat_membership_audit/i)
  assert.match(reconcile, /'joined'/i)
  assert.match(reconcile, /'removed'/i)
  assert.match(reconcile, /active = false/i)
  assert.match(reconcile, /left_at = timezone\('utc', now\(\)\)/i)
  assert.match(reconcile, /not public\.parent_chat_user_can_access_room/i)
  assert.doesNotMatch(migration, /delete from public\.parent_chat_messages/i)
  assert.doesNotMatch(migration, /delete from public\.parent_chat_membership_audit/i)
})

test('RLS, grants and RPCs deny browser-controlled room scope and participant management', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const sender = getFunction(migration, 'send_parent_chat_message')
  const reader = getFunction(migration, 'get_parent_chat_messages')
  const moderator = getFunction(migration, 'delete_parent_chat_message')

  for (const table of ['parent_chat_rooms', 'parent_chat_memberships', 'parent_chat_membership_audit', 'parent_chat_messages']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, 'i'))
    assert.match(migration, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`, 'i'))
  }

  assert.match(migration, /parent_chat_rooms_select_authorised[\s\S]*parent_chat_user_can_access_room/i)
  assert.match(migration, /parent_chat_messages_select_authorised[\s\S]*parent_chat_user_can_access_room/i)
  assert.match(migration, /parent_chat_messages_insert_authorised[\s\S]*sender_id = \(select auth\.uid\(\)\)[\s\S]*parent_chat_user_can_post_room/i)
  assert.doesNotMatch(migration, /grant (insert|update|delete) on public\.parent_chat_rooms to authenticated/i)
  assert.doesNotMatch(migration, /grant (insert|update|delete) on public\.parent_chat_memberships to authenticated/i)
  assert.doesNotMatch(migration, /grant (insert|update|delete) on public\.parent_chat_messages to authenticated/i)
  assert.match(migration, /parent_chat_messages\.sender_kind = case[\s\S]*parent_chat_staff_can_access_team/i)

  assert.match(sender, /parent_chat_user_can_post_room\(target_room_id, \(select auth\.uid\(\)\)\)/i)
  assert.match(sender, /sender_id[\s\S]*\(select auth\.uid\(\)\)/i)
  assert.doesNotMatch(sender, /team_id_value|player_id_value|match_day_id_value|member_ids/i)
  assert.match(reader, /parent_chat_user_can_access_room\(target_room_id, \(select auth\.uid\(\)\)\)/i)
  assert.match(moderator, /message_record\.sender_id <> \(select auth\.uid\(\)\) and not is_moderator/i)
  assert.doesNotMatch(migration, /create_parent_chat_room|add_parent_chat_participant|remove_parent_chat_participant/i)
})

test('realtime publication is limited to RLS-protected messages and RPCs are unavailable to anon', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /alter publication supabase_realtime add table public\.parent_chat_messages/i)
  assert.doesNotMatch(migration, /alter publication supabase_realtime add table public\.parent_chat_membership_audit/i)
  assert.match(migration, /revoke execute on function public\.get_parent_chat_rooms\(\) from anon/i)
  assert.match(migration, /revoke execute on function public\.get_parent_chat_messages\(uuid\) from anon/i)
  assert.match(migration, /revoke execute on function public\.send_parent_chat_message\(uuid, text\) from anon/i)
  assert.match(migration, /revoke execute on function public\.mark_parent_chat_room_read\(uuid\) from anon/i)
  assert.match(migration, /revoke execute on function public\.delete_parent_chat_message\(uuid\) from anon/i)
  assert.match(migration, /grant execute on function public\.get_parent_chat_rooms\(\) to authenticated, service_role/i)
})

test('parent sender identity does not expose a contact email to other parents', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const sender = getFunction(migration, 'send_parent_chat_message')

  assert.match(sender, /'Parent or guardian'/i)
  assert.match(sender, /user_metadata/i)
  assert.doesNotMatch(sender, /parent_player_links[\s\S]*\.email/i)
  assert.doesNotMatch(sender, /auth\.jwt\(\)[\s\S]*->> 'email'/i)
})
