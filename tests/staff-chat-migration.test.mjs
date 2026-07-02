import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL('../supabase/migrations/20260702120000_staff_chat_v1.sql', import.meta.url)

function getFunction(source, name) {
  const start = source.indexOf(`create or replace function public.${name}`)
  assert.notEqual(start, -1, `${name} function missing`)
  const next = source.indexOf('\ncreate or replace function public.', start + 1)
  return next === -1 ? source.slice(start) : source.slice(start, next)
}

test('Staff Chat migration creates the V1 tables and conversation types', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /create table if not exists public\.staff_chat_conversations/i)
  assert.match(migration, /create table if not exists public\.staff_chat_members/i)
  assert.match(migration, /create table if not exists public\.staff_chat_messages/i)
  assert.match(migration, /type in \('club_staff', 'team_staff', 'group', 'direct'\)/i)
  assert.match(migration, /staff_chat_direct_unique_key/i)
  assert.match(migration, /char_length\(body\) <= 5000/i)
})

test('Staff Chat staff helper fails closed for parents, platform admins, and low-rank users', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const helper = getFunction(migration, 'is_staff_chat_staff')

  assert.match(helper, /u\.club_id = target_club_id/i)
  assert.match(helper, /u\.role not in \('parent_portal', 'super_admin'\)/i)
  assert.match(helper, /coalesce\(u\.role_rank, 0\) >= 20/i)
})

test('Staff Chat creation validates same-club members, team access, direct count, and group count', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const creator = getFunction(migration, 'create_staff_chat_conversation')

  assert.match(creator, /public\.current_user_can_use_staff_chat\(current_club_id\)/i)
  assert.match(creator, /public\.staff_chat_user_can_access_team\(auth\.uid\(\), team_id_value, current_club_id\)/i)
  assert.match(creator, /not public\.is_staff_chat_staff\(member_id, current_club_id\)/i)
  assert.match(creator, /Direct Messages must include exactly two authorised staff members/i)
  assert.match(creator, /Group Chat needs at least two authorised staff members/i)
  assert.match(creator, /direct_key_value/i)
})

test('Staff Chat RLS and grants do not expose anonymous or cross-club access', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /alter table public\.staff_chat_conversations enable row level security;/i)
  assert.match(migration, /alter table public\.staff_chat_members enable row level security;/i)
  assert.match(migration, /alter table public\.staff_chat_messages enable row level security;/i)
  assert.match(migration, /public\.current_user_can_use_staff_chat\(club_id\)/i)
  assert.match(migration, /scc\.club_id = public\.current_user_club_id\(\)/i)
  assert.match(migration, /revoke all on public\.staff_chat_conversations from anon;/i)
  assert.match(migration, /revoke all on public\.staff_chat_members from anon;/i)
  assert.match(migration, /revoke all on public\.staff_chat_messages from anon;/i)
  assert.match(migration, /revoke all on public\.staff_chat_messages from authenticated;/i)
  assert.match(migration, /revoke execute on function public\.create_staff_chat_conversation\(text, text, uuid, uuid\[\]\) from anon;/i)
  assert.doesNotMatch(migration, /grant execute on function public\.create_staff_chat_conversation\(text, text, uuid, uuid\[\]\) to anon;/i)
  assert.doesNotMatch(migration, /grant (select|insert|update|delete).* on public\.staff_chat_.* to anon/i)
  assert.doesNotMatch(migration, /grant delete on public\.staff_chat_messages/i)
})
