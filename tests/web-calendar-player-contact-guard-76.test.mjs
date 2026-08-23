import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL(
  '../supabase/migrations/20260823125202_web_calendar_player_contact_guard_76.sql',
  import.meta.url,
)
const migration = await readFile(migrationUrl, 'utf8')

test('Match player review uses every canonical current-participation source', () => {
  assert.match(migration, /public\.calendar_event_invites invite/)
  assert.match(migration, /public\.match_day_availability_requests request/)
  assert.match(migration, /public\.match_day_player_availability availability/)
  assert.match(migration, /public\.match_day_player_squad_decisions decision/)
  assert.match(migration, /public\.event_player_removal_commands removal/)
  assert.match(migration, /removal\.scope = 'event'/)
  assert.match(migration, /array_agg\(distinct evidence\.player_id/)
})

test('Match player review still fails closed for wrong team and inactive Players', () => {
  assert.match(migration, /player\.club_id = source_club_id/)
  assert.match(migration, /player\.team_id = source_team_id/)
  assert.match(migration, /coalesce\(player\.status, 'active'\) <> 'archived'/)
  assert.match(migration, /actor\.role <> 'admin'/)
  assert.match(migration, /assignment\.team_id = source_team_id/)
})

test('section changes preserve an existing contact only when the submitted contact is fully empty', () => {
  assert.match(migration, /create or replace function public\.preserve_player_contacts_on_section_change_v1/)
  assert.match(migration, /new\.section is distinct from old\.section/)
  assert.match(migration, /and old_has_contact/)
  assert.match(migration, /and new_has_no_contact/)
  assert.match(migration, /new\.parent_name := old\.parent_name/)
  assert.match(migration, /new\.parent_email := old\.parent_email/)
  assert.match(migration, /new\.parent_contacts := old\.parent_contacts/)
  assert.match(migration, /new\.contact_type := old\.contact_type/)
  assert.match(migration, /before update of section on public\.players/)
})

test('ordinary contact edits remain outside the section-transfer guard', () => {
  assert.doesNotMatch(migration, /before update on public\.players/)
  assert.doesNotMatch(migration, /before update of parent_email/)
  assert.match(migration, /Contact edits that do not move section remain unchanged/)
})
