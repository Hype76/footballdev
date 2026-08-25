import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  formatCoachParentAppInstallationStatus,
  normalizeCoachParentAppInstallationStatus,
  normalizeCoachPlayer,
} from '../apps/mobile-core/src/coachPlayersCore.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('Parent app installation status clamps counts and formats accessible copy', () => {
  assert.deepEqual(
    normalizeCoachParentAppInstallationStatus({
      installed_contact_count: 6,
      parent_contact_count: 4,
      parent_app_installation_status_available: true,
    }),
    { available: true, contactCount: 4, installedCount: 4 },
  )
  assert.equal(
    formatCoachParentAppInstallationStatus({ available: true, contactCount: 4, installedCount: 2 }),
    'Parent app: 2 of 4 installed',
  )
  assert.equal(
    formatCoachParentAppInstallationStatus({ available: true, contactCount: 0, installedCount: 0 }),
    'Parent app: no Parent contacts',
  )
})

test('Player normalization keeps app installation counts separate from contact details', () => {
  const player = normalizeCoachPlayer({
    id: 'player-1',
    installed_contact_count: 1,
    parent_contacts: [
      { email: 'one@example.test', name: 'One', type: 'parent' },
      { email: 'two@example.test', name: 'Two', type: 'parent' },
    ],
    parent_contact_count: 2,
    parent_app_installation_status_available: true,
    player_name: 'Test Player',
  }, { canViewContacts: false })

  assert.equal(player.parentContacts.length, 0)
  assert.equal(player.parentAppContactCount, 2)
  assert.equal(player.parentAppInstalledContactCount, 1)
  assert.equal(player.parentAppInstallationStatusAvailable, true)
})

test('Read model exposes only scoped counts and checks app installation presence', () => {
  const migration = read('supabase/migrations/20260825162000_parent_mobile_app_installation_presence.sql')

  assert.match(migration, /create table if not exists public\.parent_mobile_app_installations/i)
  assert.match(migration, /returns table \([\s\S]*player_id uuid,[\s\S]*parent_contact_count integer,[\s\S]*installed_contact_count integer[\s\S]*\)/i)
  assert.match(migration, /actor\.role_rank >= 20/i)
  assert.match(migration, /public\.team_staff assignment[\s\S]*assignment\.user_id = actor\.user_id/i)
  assert.match(migration, /join public\.parent_mobile_app_installations installation/)
  assert.doesNotMatch(migration, /returns table \([\s\S]*(email|installation_id) (text|uuid)/i)
  assert.match(migration, /security invoker/)
  assert.match(migration, /app_private\.get_team_parent_app_installation_status_internal\(team_id_value\)/)
  assert.match(migration, /revoke all on function app_private\.get_team_parent_app_installation_status_internal\(uuid\)[\s\S]*from public, anon, authenticated/i)
  assert.match(migration, /revoke all on table public\.parent_mobile_app_installations[\s\S]*from public, anon, authenticated/i)
})

test('Parent app registers presence without notification permission and Coach renders installed counts', () => {
  const data = read('apps/mobile-core/src/coachPlayersData.js')
  const screen = read('apps/coach-mobile/src/CoachOperationalScreens.js')
  const parentNotifications = read('apps/parent-mobile/src/notifications.js')
  const parentApp = read('apps/parent-mobile/App.js')

  assert.match(parentNotifications, /rpc\('register_parent_mobile_app_installation'/)
  assert.match(parentApp, /registerParentAppInstallation/)
  assert.match(data, /rpc\('get_team_parent_app_installation_status'/)
  assert.match(data, /parent_app_installation_status_available: statusAvailable && Boolean\(installation\.player_id/)
  assert.match(screen, /ParentAppInstallationStatus/)
  assert.match(screen, /styles\.readinessDotOn/)
  assert.match(screen, /styles\.readinessDotOff/)
  assert.match(screen, /backgroundColor: palette\.success/)
  assert.match(screen, /accessibilityLabel=\{label\}/)
  assert.doesNotMatch(screen, /readinessDotOff[^\n]*palette\.danger/)
  assert.doesNotMatch(screen, /of .* ready/)
})
