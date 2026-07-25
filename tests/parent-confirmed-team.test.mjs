import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../supabase/migrations/20260725151941_parent_portal_confirmed_team_read_model.sql',
  import.meta.url,
)
const matchDayDomainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)
const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)

const [migration, matchDayDomain, parentPortalPage] = await Promise.all([
  readFile(migrationUrl, 'utf8'),
  readFile(matchDayDomainUrl, 'utf8'),
  readFile(parentPortalPageUrl, 'utf8'),
])

test('Parent Portal displays the Confirmed Team heading and exact empty state', () => {
  assert.match(parentPortalPage, />Confirmed Team</)
  assert.match(parentPortalPage, />Team not confirmed yet\.<\/p>/)
  assert.match(parentPortalPage, /match\.confirmedTeam\?\.length > 0/)
})

test('confirmed names are loaded through the existing safe fixture refresh', () => {
  assert.match(matchDayDomain, /Promise\.all\(\[[\s\S]*get_parent_portal_confirmed_teams/)
  assert.match(matchDayDomain, /confirmedTeamByMatchId\.get\(row\.id\) \?\? \[\]/)
  assert.match(matchDayDomain, /confirmedTeam: Array\.isArray/)
})

test('read model uses only authoritative selected squad decisions for names', () => {
  assert.match(migration, /join public\.match_day_player_squad_decisions decision/)
  assert.match(migration, /decision\.status = 'selected'/)
  assert.match(migration, /join public\.players player/)
  assert.doesNotMatch(migration, /selected_players[\s\S]*join public\.match_day_player_availability\b/)
  assert.doesNotMatch(migration, /selected_players[\s\S]*join public\.match_day_availability_requests\b/)
})

test('read model is exact-link, exact-team, exact-club and has no fixture-id input', () => {
  assert.match(migration, /link\.id = parent_link_id_value/)
  assert.match(migration, /link\.auth_user_id = \(select auth\.uid\(\)\)/)
  assert.match(migration, /fixture\.club_id = link\.club_id/)
  assert.match(migration, /fixture\.team_id = link\.team_id/)
  assert.match(migration, /decision\.club_id = fixture\.club_id/)
  assert.match(migration, /decision\.team_id = fixture\.team_id/)
  assert.match(migration, /player\.club_id = fixture\.club_id/)
  assert.match(migration, /player\.team_id = fixture\.team_id/)
  assert.doesNotMatch(migration, /match_day_id_value uuid/)
})

test('read model returns display names only with stable ordering and player deduplication', () => {
  assert.match(migration, /returns table \(\s*match_day_id uuid,\s*selected_player_names text\[\]\s*\)/)
  assert.match(migration, /select distinct\s+fixture\.match_day_id,\s+decision\.player_id/)
  assert.match(
    migration,
    /order by pg_catalog\.lower\(selected\.player_name\), selected\.player_name, selected\.player_id/,
  )
  for (const privateField of [
    'parent_name',
    'guardian_name',
    'email',
    'telephone',
    'phone',
    'address',
    'selection_notes',
    'decided_by',
    'staff_notes',
  ]) {
    assert.doesNotMatch(
      migration.match(/returns table \([\s\S]*?\)\s*language sql/i)?.[0] ?? '',
      new RegExp(`\\b${privateField}\\b`, 'i'),
    )
  }
})

test('read model does not load unrelated Match Day relationship data', () => {
  for (const relation of [
    'match_day_events',
    'match_day_event_log',
    'match_day_role_assignments',
    'match_day_scorer_assignments',
    'match_day_shootout_kicks',
    'match_day_final_reports',
    'match_day_player_availability_history',
  ]) {
    assert.doesNotMatch(migration, new RegExp(`public\\.${relation}\\b`))
  }
})

test('read model exposes execute only to authenticated and service roles', () => {
  assert.match(migration, /security definer\s+set search_path = ''/)
  assert.match(migration, /revoke all on function public\.get_parent_portal_confirmed_teams\(uuid\) from public;/)
  assert.match(migration, /revoke execute on function public\.get_parent_portal_confirmed_teams\(uuid\) from anon;/)
  assert.match(migration, /grant execute on function public\.get_parent_portal_confirmed_teams\(uuid\) to authenticated;/)
  assert.match(migration, /grant execute on function public\.get_parent_portal_confirmed_teams\(uuid\) to service_role;/)
  assert.doesNotMatch(migration, /grant execute[\s\S]*to anon;/)
})

test('Confirmed Team names are plain non-clickable list items', () => {
  const section = parentPortalPage.match(
    /<section className=\{`\$\{softPanelClass\} mt-4`\} aria-labelledby=\{`confirmed-team-\$\{match\.id\}`\}>[\s\S]*?<\/section>/,
  )?.[0] ?? ''

  assert.match(section, /<li/)
  assert.doesNotMatch(section, /<a\b|<button\b|onClick=/)
})
