import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { getMobileChatMessagesFingerprint } from '../apps/mobile-core/src/mobileChatCore.js'

const coachDataUrl = new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url)
const coachScreenUrl = new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url)
const parentAppUrl = new URL('../apps/parent-mobile/App.js', import.meta.url)
const parentDataUrl = new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url)
const realtimeUrl = new URL('../apps/mobile-core/src/chatRealtime.js', import.meta.url)
const realtimeMigrationUrl = new URL('../supabase/migrations/20260827132000_staff_chat_realtime_mobile.sql', import.meta.url)

test('mobile Chat fingerprint detects new, edited, and deleted messages', () => {
  const original = [{ id: 'message-1', updatedAt: '2026-08-27T10:00:00Z', deletedAt: '' }]
  const inserted = [...original, { id: 'message-2', updatedAt: '2026-08-27T10:01:00Z', deletedAt: '' }]
  const edited = [{ ...original[0], updatedAt: '2026-08-27T10:02:00Z' }]
  const deleted = [{ ...original[0], deletedAt: '2026-08-27T10:03:00Z' }]

  assert.equal(getMobileChatMessagesFingerprint(original), getMobileChatMessagesFingerprint([...original]))
  assert.notEqual(getMobileChatMessagesFingerprint(original), getMobileChatMessagesFingerprint(inserted))
  assert.notEqual(getMobileChatMessagesFingerprint(original), getMobileChatMessagesFingerprint(edited))
  assert.notEqual(getMobileChatMessagesFingerprint(original), getMobileChatMessagesFingerprint(deleted))
})

test('mobile Chat subscribes to the scoped room and always removes its channel', async () => {
  const source = await readFile(realtimeUrl, 'utf8')
  assert.match(source, /table: 'parent_chat_messages'/)
  assert.match(source, /column: 'room_id'/)
  assert.match(source, /table: 'staff_chat_messages'/)
  assert.match(source, /column: 'conversation_id'/)
  assert.match(source, /filter: `\$\{target\.column\}=eq\.\$\{normalizedRoomId\}`/)
  assert.match(source, /supabase\.removeChannel\(channel\)/)
})

test('Parent and Coach open rooms refresh on Realtime, foreground, and a bounded fallback', async () => {
  const [coachScreen, coachData, parentApp, parentData] = await Promise.all([
    readFile(coachScreenUrl, 'utf8'),
    readFile(coachDataUrl, 'utf8'),
    readFile(parentAppUrl, 'utf8'),
    readFile(parentDataUrl, 'utf8'),
  ])

  assert.match(coachScreen, /subscribeToCoachChatRoom\(user, room/)
  assert.match(coachScreen, /setInterval\(\(\) => void refreshOpenRoom\(\), 15000\)/)
  assert.match(coachScreen, /AppState\.addEventListener\('change'/)
  assert.match(coachData, /subscribeToMobileChatRoom/)
  assert.match(parentApp, /subscribeToParentChatRoom\(selectedMobileUser, selectedRoomId/)
  assert.match(parentApp, /setInterval\(refreshOpenRoom, 15000\)/)
  assert.match(parentApp, /reloadSelectedChatRoomRef\.current/)
  assert.match(parentData, /subscribeToMobileChatRoom/)
})

test('Coach mobile exposes staff on-behalf actions through the canonical secured RPCs', async () => {
  const [screen, data] = await Promise.all([
    readFile(coachScreenUrl, 'utf8'),
    readFile(coachDataUrl, 'utf8'),
  ])

  assert.match(screen, /Accept on behalf of player/)
  assert.match(screen, /Mark unavailable/)
  assert.match(screen, /It does not sign in as or impersonate the Parent or Player/)
  assert.match(screen, /Squad selection is unchanged/)
  assert.match(data, /accept_event_player_availability_on_behalf/)
  assert.match(data, /mark_event_player_unavailable_on_behalf/)
  assert.match(data, /assertCanonicalMutation\(user, \{ minimumRank: 20, requiresTeam: true \}\)/)
  assert.match(data, /from\('match_day_player_availability'\)/)
  const actionSource = data.slice(data.indexOf('export async function setCoachInviteAvailabilityOnBehalf'))
  assert.doesNotMatch(actionSource, /sendEmail|sendSms|sendParentMobilePushNotification|service_role/i)
})

test('staff Chat publication migration is additive, guarded, and contains no customer data mutation', async () => {
  const migration = await readFile(realtimeMigrationUrl, 'utf8')
  assert.match(migration, /not exists[\s\S]*tablename = 'staff_chat_messages'/)
  assert.match(migration, /alter publication supabase_realtime add table public\.staff_chat_messages/)
  assert.doesNotMatch(migration, /\b(?:insert into|update public\.|delete from)\b/i)
})
