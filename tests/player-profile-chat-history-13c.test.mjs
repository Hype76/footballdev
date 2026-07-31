import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { buildEventResponsePlayerNavigation } from '../src/lib/domain/player-profile-navigation.js'

const migrationUrl = new URL('../supabase/migrations/20260731190000_player_linked_chat_history_13c.sql', import.meta.url)
const responseManagerUrl = new URL('../src/components/sessions/EventResponseManager.jsx', import.meta.url)
const sessionsUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)
const playerChatSectionUrl = new URL('../src/components/players/PlayerChatSection.jsx', import.meta.url)
const playerChatDomainUrl = new URL('../src/lib/domain/player-chat.js', import.meta.url)
const staffChatUrl = new URL('../src/lib/domain/staff-chat.js', import.meta.url)

function responseRow({ section = 'Squad' } = {}) {
  return {
    playerId: 'player-13c',
    playerName: 'FP TEST Player 13C',
    sourceRow: {
      clubId: 'club-13c',
      teamId: 'team-13c',
      player: {
        id: 'player-13c',
        playerName: 'FP TEST Player 13C',
        section,
      },
    },
  }
}

test('Match response navigation preserves exact saved player, team, club, and Back context', () => {
  const navigation = buildEventResponsePlayerNavigation({
    currentSearch: 'view=month',
    event: {
      sourceId: 'match-13c',
      sourceType: 'match-day',
    },
    row: responseRow(),
  })

  assert.equal(
    navigation.profilePath,
    '/player/FP%20TEST%20Player%2013C?source=squad&playerId=player-13c&teamId=team-13c&clubId=club-13c',
  )
  assert.equal(
    navigation.returnSearch,
    'view=month&action=view-responses&eventId=match-13c&source=match-day',
  )
})

test('Training response navigation uses the authoritative trial profile route', () => {
  const navigation = buildEventResponsePlayerNavigation({
    event: {
      sourceId: 'training-13c',
      sourceType: 'calendar',
    },
    row: responseRow({ section: 'Trial' }),
  })

  assert.equal(
    navigation.profilePath,
    '/player/FP%20TEST%20Player%2013C?source=trial&playerId=player-13c&teamId=team-13c&clubId=club-13c',
  )
  assert.equal(navigation.returnSearch, 'action=view-responses&eventId=training-13c&source=calendar')
})

test('response navigation fails closed without resolved player or event IDs', () => {
  assert.throws(
    () => buildEventResponsePlayerNavigation({ event: {}, row: {} }),
    /resolved saved player profile/i,
  )
})

test('response player name is a keyboard button while Expand and Actions remain separate', async () => {
  const source = await readFile(responseManagerUrl, 'utf8')
  const rowStart = source.indexOf('function ResponseManagerRow')
  const rowEnd = source.indexOf('export function EventResponseManagerDialog', rowStart)
  const rowSource = source.slice(rowStart, rowEnd)

  assert.match(rowSource, /aria-label={`Open \$\{row\.playerName\} player profile`}/)
  assert.match(rowSource, /onOpenPlayerProfile\?\.\(row\)/)
  assert.match(rowSource, /\{expanded \? 'Collapse' : 'Expand'\}/)
  assert.match(rowSource, /aria-label={`Actions for \$\{row\.playerName\}`}/)
  assert.doesNotMatch(rowSource, /onOpenPlayerProfile\?\.\(row\)[\s\S]{0,180}onAcceptOnBehalf/)
})

test('Sessions Back deep link reloads authoritative evidence and reopens responses', async () => {
  const source = await readFile(sessionsUrl, 'utf8')

  assert.match(source, /\['manage-players', 'view-responses'\]\.includes\(requestedAction\)/)
  assert.match(source, /getEventResponseEvidenceForEvent\(\{ event, user \}\)/)
  assert.match(source, /openResponseManager: requestedAction === 'view-responses'/)
  assert.match(source, /window\.history\.replaceState\(window\.history\.state, '', returnUrl\)/)
  assert.match(source, /openResponseManagerOnMount=\{calendarModal\?\.openResponseManager === true\}/)
})

test('migration adds only an explicit player relationship and canonical duplicate key', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /add column if not exists player_id uuid references public\.players \(id\)/i)
  assert.match(migration, /type = 'player_staff' and player_id is not null/i)
  assert.match(migration, /staff_chat_player_staff_unique_key/i)
  assert.match(migration, /\(club_id, team_id, player_id\)[\s\S]*where type = 'player_staff'/i)
  assert.doesNotMatch(migration, /message\.body\s*(=|ilike|like)/i)
  assert.doesNotMatch(migration, /player_name\s*=\s*(message|conversation|room)/i)
  assert.doesNotMatch(migration, /recipient_email\s*=\s*player/i)
})

test('server start and reuse resolves actor, player, team, recipients, and audit without message bodies', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const start = migration.indexOf('create or replace function public.start_or_reuse_player_chat')
  const end = migration.indexOf('create or replace function public.audit_player_linked_chat_message', start)
  const functionSource = migration.slice(start, end)

  assert.match(functionSource, /actor_id uuid := auth\.uid\(\)/i)
  assert.match(functionSource, /player\.id = player_id_value/i)
  assert.match(functionSource, /player\.club_id = actor_club_id/i)
  assert.match(functionSource, /parent_chat_staff_can_access_team\(\s*actor_id,\s*actor_club_id,\s*player_record\.team_id\s*\)/i)
  assert.match(functionSource, /parent_chat_ensure_rooms_for_current_user/i)
  assert.match(functionSource, /on conflict \(club_id, team_id, player_id\) where type = 'player_staff'/i)
  assert.match(functionSource, /participantIds/i)
  assert.match(functionSource, /player_chat_conversation_created/i)
  assert.match(functionSource, /player_chat_conversation_reused/i)
  assert.doesNotMatch(functionSource, /message body|body_value|message_body/i)
})

test('history is restricted to exact parent rooms and exact player staff discussions', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const start = migration.indexOf('create or replace function public.get_player_linked_chat_context')
  const end = migration.indexOf('create or replace function public.start_or_reuse_player_chat', start)
  const functionSource = migration.slice(start, end)

  assert.match(functionSource, /room\.player_id = player_record\.id/i)
  assert.match(functionSource, /room\.room_type = 'parent_staff'/i)
  assert.match(functionSource, /conversation\.player_id = player_record\.id/i)
  assert.match(functionSource, /conversation\.type = 'player_staff'/i)
  assert.match(functionSource, /public\.staff_chat_user_can_join_conversation\(conversation\.id, actor_id\)/i)
  assert.doesNotMatch(functionSource, /room_type = 'team'/i)
  assert.doesNotMatch(functionSource, /club_staff|team_staff'\s+as conversation_type/i)
})

test('player-linked message audit captures identifiers and never captures message bodies', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const start = migration.indexOf('create or replace function public.audit_player_linked_chat_message')
  const end = migration.indexOf('drop trigger if exists audit_player_linked_parent_chat_message', start)
  const functionSource = migration.slice(start, end)

  assert.match(functionSource, /'player_chat_message_sent'/)
  assert.match(functionSource, /'messageId', new\.id/)
  assert.match(functionSource, /'playerId', linked_player_id/)
  assert.match(functionSource, /'conversationId', linked_conversation_id/)
  assert.doesNotMatch(functionSource, /new\.body|message_row->>'body'/i)
})

test('client submits only player ID and type to authoritative Chat RPCs', async () => {
  const source = await readFile(playerChatDomainUrl, 'utf8')
  const startRpcStart = source.indexOf("supabase.rpc('start_or_reuse_player_chat'")
  const startRpcEnd = source.indexOf('\n  })', startRpcStart) + 5
  const startRpc = source.slice(startRpcStart, startRpcEnd)

  assert.match(source, /supabase\.rpc\('get_player_linked_chat_context'/)
  assert.match(source, /player_id_value: normalizedPlayerId/)
  assert.match(source, /supabase\.rpc\('start_or_reuse_player_chat'/)
  assert.match(source, /conversation_type_value: normalizedConversationType/)
  assert.doesNotMatch(startRpc, /participantIds|memberIds|clubId:|teamId:/)
  assert.match(startRpc, /conversation_type_value: normalizedConversationType/)
  assert.match(startRpc, /player_id_value: normalizedPlayerId/)
})

test('player profile renders metadata only and opens canonical parent or staff routes', async () => {
  const source = await readFile(playerChatSectionUrl, 'utf8')

  assert.match(source, /Participants:/)
  assert.match(source, /Last message:/)
  assert.match(source, /unread/)
  assert.match(source, /conversation\.status/)
  assert.match(source, /\/staff-chat\?/)
  assert.match(source, /\/parent-chat-staff\?/)
  assert.doesNotMatch(source, /conversation\.messages|message\.body|latestMessage/)
})

test('existing Staff Chat recognises player discussions but still requires team context', async () => {
  const source = await readFile(staffChatUrl, 'utf8')

  assert.match(source, /'player_staff'/)
  assert.match(source, /conversation\.type === 'player_staff'/)
  assert.match(source, /normalizeText\(conversation\.teamId\) === activeTeamId/)
  assert.match(source, /Number\(user\?\.roleRank \?\? 0\) >= 50/)
})
