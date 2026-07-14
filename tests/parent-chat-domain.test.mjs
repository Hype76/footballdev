import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const domainUrl = new URL('../src/lib/domain/parent-chat.js', import.meta.url)

test('parent Chat browser calls submit only room and message identifiers to server-authoritative RPCs', async () => {
  const source = await readFile(domainUrl, 'utf8')
  const sendStart = source.indexOf('export async function sendParentChatMessage')
  const sendEnd = source.indexOf('export async function markParentChatRoomRead', sendStart)
  const sendSource = source.slice(sendStart, sendEnd)

  assert.match(source, /supabase\.rpc\('get_parent_chat_rooms'\)/)
  assert.match(source, /supabase\.rpc\('get_parent_chat_messages'/)
  assert.match(source, /supabase\.rpc\('send_parent_chat_message'/)
  assert.match(source, /target_room_id: normalizedRoomId/)
  assert.match(source, /body_value: normalizedBody/)
  assert.match(source, /supabase\.rpc\('mark_parent_chat_room_read'/)
  assert.match(source, /supabase\.rpc\('delete_parent_chat_message'/)
  assert.doesNotMatch(sendSource, /memberIds|participantIds|childId|teamId|fixtureId|senderRole/)
})

test('realtime events trigger a protected reload instead of rendering event payloads directly', async () => {
  const source = await readFile(domainUrl, 'utf8')

  assert.match(source, /\(\) => onChange\(\)/)
  assert.doesNotMatch(source, /payload\.(new|old)/)
  assert.match(source, /supabase\.removeChannel\(channel\)/)
})
