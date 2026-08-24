import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  formatCoachParentNotificationReadiness,
  normalizeCoachParentNotificationReadiness,
  normalizeCoachPlayer,
} from '../apps/mobile-core/src/coachPlayersCore.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('Player notification readiness clamps counts and formats accessible copy', () => {
  assert.deepEqual(
    normalizeCoachParentNotificationReadiness({
      notification_ready_contact_count: 6,
      parent_notification_contact_count: 4,
      parent_notification_status_available: true,
    }),
    { available: true, contactCount: 4, readyCount: 4 },
  )
  assert.equal(
    formatCoachParentNotificationReadiness({ available: true, contactCount: 4, readyCount: 2 }),
    'Parent app: 2 of 4 ready',
  )
  assert.equal(
    formatCoachParentNotificationReadiness({ available: true, contactCount: 0, readyCount: 0 }),
    'Parent app: no Parent contacts',
  )
})

test('Player normalization keeps notification readiness separate from contact details', () => {
  const player = normalizeCoachPlayer({
    id: 'player-1',
    notification_ready_contact_count: 1,
    parent_contacts: [
      { email: 'one@example.test', name: 'One', type: 'parent' },
      { email: 'two@example.test', name: 'Two', type: 'parent' },
    ],
    parent_notification_contact_count: 2,
    parent_notification_status_available: true,
    player_name: 'Test Player',
  }, { canViewContacts: false })

  assert.equal(player.parentContacts.length, 0)
  assert.equal(player.parentNotificationContactCount, 2)
  assert.equal(player.parentNotificationReadyCount, 1)
  assert.equal(player.parentNotificationStatusAvailable, true)
})

test('Read model exposes only scoped counts and checks notification delivery readiness', () => {
  const migration = read('supabase/migrations/20260824082411_coach_mobile_parent_notification_readiness.sql')
  const hardening = read('supabase/migrations/20260824084025_coach_mobile_parent_notification_readiness_hardening.sql')

  assert.match(migration, /returns table \([\s\S]*player_id uuid,[\s\S]*parent_contact_count integer,[\s\S]*notification_ready_contact_count integer[\s\S]*\)/i)
  assert.match(migration, /actor\.role_rank >= 20/i)
  assert.match(migration, /public\.team_staff assignment[\s\S]*assignment\.user_id = actor\.user_id/i)
  assert.match(migration, /public\.parent_mobile_push_installations/)
  assert.match(migration, /public\.mobile_test_parent_push_installations/)
  assert.match(migration, /installation\.status = 'active'[\s\S]*installation\.enabled[\s\S]*installation\.expo_push_token is not null/i)
  assert.match(migration, /join app_private\.parent_notification_ready_accounts ready_account/)
  assert.doesNotMatch(migration, /returns table \([\s\S]*(email|expo_push_token) text/i)
  assert.match(migration, /revoke all on function public\.get_team_parent_notification_readiness\(uuid\)[\s\S]*from public, anon, authenticated/i)
  assert.match(hardening, /set schema app_private/)
  assert.match(hardening, /security invoker/)
  assert.match(hardening, /app_private\.get_team_parent_notification_readiness_internal\(team_id_value\)/)
  assert.match(hardening, /revoke all on function app_private\.get_team_parent_notification_readiness_internal\(uuid\)[\s\S]*from public, anon, authenticated/i)
})

test('Coach Player list merges the readiness RPC and renders green or neutral dots with text', () => {
  const data = read('apps/mobile-core/src/coachPlayersData.js')
  const screen = read('apps/coach-mobile/src/CoachOperationalScreens.js')

  assert.match(data, /rpc\('get_team_parent_notification_readiness'/)
  assert.match(data, /parent_notification_status_available: statusAvailable && Boolean\(readiness\.player_id/)
  assert.match(screen, /ParentNotificationReadiness/)
  assert.match(screen, /styles\.readinessDotOn/)
  assert.match(screen, /styles\.readinessDotOff/)
  assert.match(screen, /backgroundColor: palette\.success/)
  assert.match(screen, /accessibilityLabel=\{label\}/)
  assert.doesNotMatch(screen, /readinessDotOff[^\n]*palette\.danger/)
})
