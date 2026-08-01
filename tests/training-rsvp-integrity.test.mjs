import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL(
  '../supabase/migrations/20260730113501_training_rsvp_integrity.sql',
  import.meta.url,
)
const consistencyMigrationUrl = new URL(
  '../supabase/migrations/20260801122226_training_rsvp_consistency_21a.sql',
  import.meta.url,
)
const processorUrl = new URL(
  '../netlify/functions/process-training-availability-requests.js',
  import.meta.url,
)
const domainUrl = new URL('../src/lib/domain/training-availability.js', import.meta.url)
const responseUrl = new URL(
  '../netlify/functions/training-availability-response.js',
  import.meta.url,
)

test('explicit training availability is an authenticated atomic invitation command', async () => {
  const [migration, consistencyMigration, domain] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(consistencyMigrationUrl, 'utf8'),
    readFile(domainUrl, 'utf8'),
  ])

  assert.match(migration, /create or replace function public\.save_training_availability_setting_v2/)
  assert.match(migration, /security definer[\s\S]*set search_path = public/)
  assert.match(migration, /training_availability_user_can_manage/)
  assert.match(migration, /event\.event_type = 'training'/)
  assert.match(migration, /event\.cancelled_at is null/)
  assert.match(migration, /notify_requested = true/)
  assert.match(migration, /response_requirement = 'response_required'/)
  assert.match(migration, /training_availability_requested = true/)
  assert.match(migration, /not exists \([\s\S]*training_availability_request_players/)
  assert.match(migration, /revoke all on function public\.save_training_availability_setting_v2[\s\S]*from public, anon/)
  assert.match(migration, /grant execute on function public\.save_training_availability_setting_v2[\s\S]*to authenticated/)
  assert.match(consistencyMigration, /create or replace function public\.save_training_availability_setting_v3/)
  assert.match(consistencyMigration, /notify_invited_families_value boolean/)
  assert.match(consistencyMigration, /notify_requested = normalized_notify/)
  assert.match(consistencyMigration, /response_requirement = 'response_required'/)
  assert.match(consistencyMigration, /response_requirement = 'informational'/)
  assert.match(domain, /\.rpc\('save_training_availability_setting_v3'/)
  assert.match(domain, /const notifyInvitedFamilies = payload\.enabled \|\| settings\?\.notifyInvitedFamilies === true/)
  assert.match(domain, /notify_invited_families_value: notifyInvitedFamilies/)
  assert.doesNotMatch(domain, /\.upsert\(row, \{ onConflict: 'calendar_event_id' \}\)/)
})

test('training processor uses only response-required participant invitations', async () => {
  const processor = await readFile(processorUrl, 'utf8')

  assert.match(processor, /\.select\('player_id, notify_requested, response_requirement, training_availability_requested'\)/)
  assert.match(processor, /invite\.training_availability_requested === true/)
  assert.match(processor, /invite\.notify_requested === true/)
  assert.match(processor, /response_requirement\) === 'response_required'/)
  assert.match(processor, /\.in\('id', scopedPlayerIds\)/)
  assert.match(processor, /scopedPlayerIds\.length > 0[\s\S]*await playersQuery[\s\S]*data: \[\], error: null/)
  assert.doesNotMatch(processor, /if \(scopedPlayerIds\.length > 0\) \{[\s\S]*playersQuery = playersQuery\.in/)
})

test('recipient resolution keeps parent and adult-player authority separate', async () => {
  process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
  const { getPlayerContacts } = await import(processorUrl.href)

  const parentContacts = getPlayerContacts({
    parentLinks: [{
      id: 'parent-link-1',
      player_id: 'player-1',
      email: 'PARENT@example.test',
    }],
    player: {
      id: 'player-1',
      contact_type: 'parent',
      parent_email: 'fallback@example.test',
      player_name: 'Youth Player',
    },
  })
  const adultContacts = getPlayerContacts({
    parentLinks: [],
    player: {
      id: 'adult-1',
      contact_type: 'self',
      parent_email: 'ADULT@example.test',
      player_name: 'Adult Player',
    },
  })
  const missingContacts = getPlayerContacts({
    parentLinks: [],
    player: {
      id: 'player-2',
      contact_type: 'parent',
      parent_email: '',
      player_name: 'Missing Contact',
    },
  })

  assert.deepEqual(parentContacts, [{
    email: 'parent@example.test',
    name: 'PARENT@example.test',
    parentLinkId: 'parent-link-1',
    type: 'parent',
  }])
  assert.deepEqual(adultContacts, [{
    email: 'adult@example.test',
    name: 'Adult Player',
    parentLinkId: null,
    type: 'player',
  }])
  assert.deepEqual(missingContacts, [])
})

test('missing recipients and queue failures remain visible without false delivery', async () => {
  const [migration, processor] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(processorUrl, 'utf8'),
  ])

  assert.match(migration, /recipient_type = 'unavailable'/)
  assert.match(processor, /type: 'unavailable'/)
  assert.match(processor, /No eligible parent or adult-player recipient is available\./)
  assert.match(processor, /status: 'failed'/)
  assert.match(processor, /Training availability recipient queue failed/)
  assert.match(processor, /currentStatus === 'failed'[\s\S]*status: 'failed'/)
  assert.match(processor, /summary\.failed > 0 \? 'partial_failed' : 'queued'/)
})

test('training response surfaces use attendance language with canonical status values', async () => {
  const [domain, response] = await Promise.all([
    readFile(domainUrl, 'utf8'),
    readFile(responseUrl, 'utf8'),
  ])

  assert.match(domain, /label: 'Attending'/)
  assert.match(domain, /label: 'Not attending'/)
  assert.match(response, /\['available', 'Attending'\]/)
  assert.match(response, /\['unavailable', 'Not attending'\]/)
})
