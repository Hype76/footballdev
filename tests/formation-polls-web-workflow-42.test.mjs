import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL('../supabase/migrations/20260811164422_formation_polls_web_workflow_42.sql', import.meta.url)
const atomicSaveMigrationUrl = new URL('../supabase/migrations/20260918093022_formation_board_atomic_match_save.sql', import.meta.url)

test('Poll workflow supports unlimited multiple choice and reversible selections', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /p_max_choices is null[\s\S]*jsonb_array_length/)
  assert.match(migration, /set max_choices = null/)
  assert.match(migration, /poll_row\.allow_multiple is true[\s\S]*poll_row\.allow_vote_changes is true[\s\S]*poll_vote_removed/)
  assert.match(migration, /parent_poll_vote_removed/)
  assert.match(migration, /revoke all on function public\.submit_staff_poll_vote_workflow42_legacy[\s\S]*authenticated/)
  assert.match(migration, /grant execute on function public\.submit_parent_portal_poll_vote\(uuid, uuid, text\) to authenticated/)
})

test('Match Plan publication is immutable, parent scoped, and excludes private staff data', async () => {
  const [migration, domain, page, parentPage, matchDayDomain] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(new URL('../src/lib/domain/formation-board.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/FormationBoardsPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/ParentPortalPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/domain/match-day.js', import.meta.url), 'utf8'),
  ])

  assert.match(migration, /create table public\.formation_board_match_publications/)
  assert.match(migration, /foreign key \(board_version_id, board_id, club_id, team_id\)/)
  assert.match(migration, /row_number\(\) over[\s\S]*partition by publication\.match_day_id/)
  assert.match(migration, /publication\.withdrawn_at is null/)
  assert.match(migration, /get_parent_portal_match_days\(parent_link_id_value\)/)
  assert.match(migration, /version\.placements/)
  assert.match(migration, /version\.bench/)
  assert.doesNotMatch(migration.match(/create function public\.get_parent_portal_match_formation_plans[\s\S]*?\$\$;/)?.[0] || '', /notes|availability|unselected/i)
  assert.match(migration, /revoke all on table public\.formation_board_match_publications from public, anon, authenticated/)
  assert.match(domain, /publishFormationBoardMatchPlan/)
  assert.match(page, /Save and link to match/)
  assert.match(page, /Publish update to parents/)
  assert.match(page, /Withdraw parent plan/)
  assert.match(parentPage, /parent-match-formation-plan/)
  assert.match(parentPage, /Only the shared pitch and Bench are shown/)
  assert.match(matchDayDomain, /get_parent_portal_match_formation_plans/)
})

test('Atomic Coach Match Formation save contract protects audience and board history', async () => {
  const migration = await readFile(atomicSaveMigrationUrl, 'utf8')

  assert.match(migration, /create or replace function public\.save_coach_match_formation\(/)
  assert.match(migration, /target_match_day_id uuid/)
  assert.match(migration, /target_board_id uuid default null/)
  assert.match(migration, /expected_version_number integer default null/)
  assert.match(migration, /shared_value boolean default false/)
  assert.match(migration, /perform public\.link_formation_board_to_match/)
  assert.match(migration, /perform public\.publish_formation_board_match_plan/)
  assert.match(migration, /perform public\.withdraw_formation_board_match_plan/)
  assert.match(migration, /revoke all on function public\.save_coach_match_formation/)
  assert.match(migration, /partition by publication\.match_day_id, publication\.board_id/)
  assert.match(migration, /publication\.publication_rank = 1[\s\S]*publication\.withdrawn_at is null/)
})
