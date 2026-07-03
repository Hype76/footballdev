import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const hardeningMigrationUrl = new URL('../supabase/migrations/20260703143000_staff_chat_access_matrix_hardening.sql', import.meta.url)
const domainUrl = new URL('../src/lib/domain/staff-chat.js', import.meta.url)
const pageUrl = new URL('../src/pages/StaffChatPage.jsx', import.meta.url)

function getFunction(source, name) {
  const start = source.indexOf(`create or replace function public.${name}`)
  assert.notEqual(start, -1, `${name} function missing`)
  const next = source.indexOf('\ncreate or replace function public.', start + 1)
  const policy = source.indexOf('\ndrop policy if exists', start + 1)
  const stops = [next, policy].filter((index) => index !== -1)
  return stops.length === 0 ? source.slice(start) : source.slice(start, Math.min(...stops))
}

test('Staff Chat hardening limits Club Staff chat to club-wide staff only', async () => {
  const migration = await readFile(hardeningMigrationUrl, 'utf8')
  const clubWideHelper = getFunction(migration, 'is_staff_chat_club_wide_staff')
  const creator = getFunction(migration, 'create_staff_chat_conversation')

  assert.match(clubWideHelper, /u\.role not in \('parent_portal', 'super_admin'\)/i)
  assert.match(clubWideHelper, /coalesce\(u\.role_rank, 0\) >= 70/i)
  assert.match(creator, /normalized_type = 'club_staff' and not public\.current_user_can_use_club_staff_chat\(current_club_id\)/i)
  assert.match(creator, /where public\.is_staff_chat_club_wide_staff\(u\.id, current_club_id\)/i)
  assert.match(creator, /normalized_type = 'club_staff'[\s\S]*not public\.is_staff_chat_club_wide_staff\(member_id, current_club_id\)/i)
})

test('Staff Chat hardening requires explicit team assignment for Team Staff chat', async () => {
  const migration = await readFile(hardeningMigrationUrl, 'utf8')
  const teamHelper = getFunction(migration, 'staff_chat_user_can_access_team')
  const joinHelper = getFunction(migration, 'staff_chat_user_can_join_conversation')

  assert.match(teamHelper, /join public\.team_staff ts on ts\.user_id = u\.id/i)
  assert.match(teamHelper, /and ts\.team_id = target_team_id/i)
  assert.doesNotMatch(teamHelper, /coalesce\(u\.role_rank, 0\) >= 50\s+or/i)
  assert.doesNotMatch(teamHelper, /public\.current_user_role_rank\(\) >= 50/i)
  assert.match(joinHelper, /scc\.type = 'team_staff'[\s\S]*public\.staff_chat_user_can_access_team\(target_user_id, scc\.team_id, scc\.club_id\)/i)
})

test('Staff Chat hardening keeps direct messages and groups member-only', async () => {
  const migration = await readFile(hardeningMigrationUrl, 'utf8')
  const readHelper = getFunction(migration, 'can_read_staff_chat_conversation')

  assert.match(readHelper, /scm\.user_id = auth\.uid\(\)/i)
  assert.match(readHelper, /scm\.archived_at is null/i)
  assert.match(readHelper, /scc\.type <> 'direct'/i)
  assert.match(readHelper, /= 2/i)
  assert.match(migration, /scc\.type in \('group', 'direct'\)/i)
  assert.match(migration, /create policy staff_chat_messages_select_member[\s\S]*public\.can_read_staff_chat_conversation\(conversation_id\)/i)
  assert.match(migration, /create policy staff_chat_messages_insert_member[\s\S]*public\.can_read_staff_chat_conversation\(conversation_id\)/i)
})

test('Staff Chat client clears stale team state and validates active focus before messages or posts', async () => {
  const [domain, page] = await Promise.all([
    readFile(domainUrl, 'utf8'),
    readFile(pageUrl, 'utf8'),
  ])

  assert.match(domain, /function getReadableStaffChatConversation/)
  assert.match(domain, /conversation\.type === 'team_staff'[\s\S]*normalizeText\(conversation\.teamId\) === activeTeamId/)
  assert.match(domain, /await getReadableStaffChatConversation\(\{ conversationId, user \}\)/)
  assert.match(domain, /await getReadableStaffChatConversation\(\{ conversationId: message\.conversation_id, user \}\)/)
  assert.match(page, /conversationTabs\.filter\(\(tab\) => tab\.key !== 'club_staff'\)/)
  assert.match(page, /setMessages\(\[\]\)[\s\S]*setSelectedConversationId\(''\)[\s\S]*user\?\.activeTeamId/)
})
