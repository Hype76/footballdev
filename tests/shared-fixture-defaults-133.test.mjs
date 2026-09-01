import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildOwnTeamFixturePreferenceUpdate,
  normalizeOwnTeamFixturePreferences,
} from '../src/lib/team-fixture-preferences.js'

const source = async (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8')

test('shared fixture defaults normalize server values and reject invalid values safely', () => {
  assert.deepEqual(normalizeOwnTeamFixturePreferences({
    arrivalPreset: '45',
    arrivalTime: '',
    duration: 80,
    found: true,
  }), {
    arrivalPreset: '45',
    arrivalTime: '',
    duration: 80,
    found: true,
  })
  assert.deepEqual(normalizeOwnTeamFixturePreferences({
    arrivalPreset: 'custom',
    arrivalTime: '08:25:00',
    duration: 81,
    found: true,
  }), {
    arrivalPreset: 'custom',
    arrivalTime: '08:25',
    duration: 90,
    found: true,
  })
  assert.equal(normalizeOwnTeamFixturePreferences({ arrivalPreset: 'custom', found: true }).arrivalPreset, '30')
})

test('fixture preference updates preserve explicit checkbox intent', () => {
  assert.deepEqual(buildOwnTeamFixturePreferenceUpdate({
    arrivalPreset: '60',
    arrivalTime: '08:00',
    matchDurationMinutes: 70,
    saveArrivalAsDefault: true,
    saveDurationAsDefault: false,
  }), {
    arrivalPreset: '60',
    arrivalTime: '08:00',
    duration: 70,
    saveArrival: true,
    saveDuration: false,
  })
})

test('web loads server defaults first and saves them from create and edit flows', async () => {
  const [matchDay, sessions, teamActions] = await Promise.all([
    source('../src/pages/MatchDayPage.jsx'),
    source('../src/pages/SessionsPage.jsx'),
    source('../src/lib/domain/team-actions.js'),
  ])

  assert.match(matchDay, /await getOwnTeamFixturePreferences/)
  assert.match(matchDay, /serverPreferences\?\.found/)
  assert.match(matchDay, /await updateOwnTeamFixturePreferences/)
  assert.match(sessions, /name="saveArrivalAsDefault"/)
  assert.match(sessions, /name="saveDurationAsDefault"/)
  assert.match(sessions, /sourceType === 'match-day'[\s\S]*await updateOwnTeamFixturePreferences/)
  assert.match(teamActions, /rpc\('get_own_team_fixture_preferences'/)
  assert.match(teamActions, /rpc\('set_own_team_fixture_preferences'/)
})

test('Coach mobile loads and saves the same server defaults while retaining device fallback', async () => {
  const [form, data] = await Promise.all([
    source('../apps/coach-mobile/src/CoachFixtureForm.js'),
    source('../apps/mobile-core/src/coachTeamNotificationData.js'),
  ])

  assert.match(form, /getCoachOwnTeamFixturePreferences/)
  assert.match(form, /sharedPreferences\.found/)
  assert.match(form, /saveCoachOwnTeamFixturePreferences/)
  assert.match(form, /readCoachFixturePreferences/)
  assert.match(form, /writeCoachFixturePreferences/)
  assert.match(data, /rpc\('get_own_team_fixture_preferences'/)
  assert.match(data, /rpc\('set_own_team_fixture_preferences'/)
})

test('migration keeps preference rows private and exposes only authorised own-user RPCs', async () => {
  const migration = await source('../supabase/migrations/20260901151224_shared_fixture_defaults.sql')

  assert.match(migration, /create table if not exists app_private\.user_team_fixture_preferences/)
  assert.match(migration, /primary key \(user_id, team_id\)/)
  assert.match(migration, /app_private\.actor_can_manage_team_resource/)
  assert.match(migration, /revoke all on table app_private\.user_team_fixture_preferences from public, anon, authenticated, service_role/)
  assert.match(migration, /revoke all on function public\.get_own_team_fixture_preferences\(uuid\) from public, anon, service_role/)
  assert.match(migration, /grant execute on function public\.get_own_team_fixture_preferences\(uuid\) to authenticated/)
  assert.match(migration, /grant execute on function public\.set_own_team_fixture_preferences[\s\S]*to authenticated/)
})
