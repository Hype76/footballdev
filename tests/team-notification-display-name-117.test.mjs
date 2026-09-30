import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createCoachFixtureForm } from '../apps/mobile-core/src/coachFixtureCore.js'

const helperUrl = new URL('../src/lib/team-notification-display.js', import.meta.url)
const migrationUrl = new URL('../supabase/migrations/20260827134912_team_notification_display_name.sql', import.meta.url)

test('Team notification display names default to the full team name and preserve overrides', async () => {
  const {
    deriveTeamNotificationDisplayName,
    normalizeTeamNotificationDisplayName,
    resolveTeamNotificationDisplayName,
  } = await import(helperUrl.href)

  assert.equal(deriveTeamNotificationDisplayName('Tigers'), 'Tigers')
  assert.equal(deriveTeamNotificationDisplayName('U14 JPL 26/27'), 'U14 JPL 26/27')
  assert.equal(deriveTeamNotificationDisplayName('U17 Green'), 'U17 Green')
  assert.equal(deriveTeamNotificationDisplayName('First Team'), 'First Team')
  assert.equal(deriveTeamNotificationDisplayName('  Tigers   United  '), 'Tigers United')
  assert.equal(deriveTeamNotificationDisplayName(null), '')
  assert.equal(deriveTeamNotificationDisplayName('x'.repeat(41)), 'x'.repeat(40))
  assert.equal(resolveTeamNotificationDisplayName({ name: 'Tigers' }), 'Tigers')
  assert.equal(resolveTeamNotificationDisplayName({ name: 'Tigers', notification_display_name: '' }), 'Tigers')
  assert.equal(resolveTeamNotificationDisplayName({ name: 'Tigers', notification_display_name: 'T' }), 'T')
  assert.equal(resolveTeamNotificationDisplayName({ name: 'Tigers', notificationDisplayName: 'Tiger squad' }), 'Tiger squad')
  assert.equal(resolveTeamNotificationDisplayName({ name: 'U17 Green', notification_display_name: 'U17G' }), 'U17G')
  assert.equal(normalizeTeamNotificationDisplayName('  U17G  '), 'U17G')
  assert.equal(normalizeTeamNotificationDisplayName('x'.repeat(41)), '')
})

test('Coach fixture setup keeps the full default name and existing fixture overrides', async () => {
  const { resolveTeamNotificationDisplayName, resolveMatchDayNotificationTeamName } = await import(helperUrl.href)
  const team = { name: 'Tigers' }
  const form = createCoachFixtureForm({ notificationTeamName: resolveTeamNotificationDisplayName(team) })

  assert.equal(form.notificationTeamName, 'Tigers')
  assert.equal(form.rememberNotificationTeamName, true)
  assert.equal(resolveMatchDayNotificationTeamName({ teams: team }), 'Tigers')
  assert.equal(resolveMatchDayNotificationTeamName({ notification_team_name: 'T', teams: team }), 'T')
  assert.equal(createCoachFixtureForm({
    match: { id: 'existing-match', notificationTeamName: 'Tiger squad' },
    notificationTeamName: form.notificationTeamName,
  }).notificationTeamName, 'Tiger squad')
})

test('Team notification display name migration is bounded, audited, and not public', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /add column if not exists notification_display_name text/i)
  assert.match(migration, /char_length\(btrim\(notification_display_name\)\) between 1 and 40/i)
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i)
  assert.match(migration, /team_notification_display_name_updated/i)
  assert.match(migration, /revoke all on function public\.set_team_notification_display_name\(uuid, text\) from public, anon/i)
  assert.match(migration, /app_private\.actor_can_manage_team_resource\([\s\S]*20[\s\S]*\)/i)
  assert.match(migration, /revoke all on function public\.set_team_notification_display_name\(uuid, text\) from service_role/i)
  assert.match(migration, /grant execute on function public\.set_team_notification_display_name\(uuid, text\) to authenticated/i)
})
