import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [parentApp, parentScreens, parentData, squadReadModel] = await Promise.all([
  readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260903104104_parent_selected_squad.sql', import.meta.url), 'utf8'),
])

test('Parent fixture details expose an explicit read-only squad view in Home and Matchday', () => {
  assert.match(parentApp, /See squad \(\$\{squadNames\.length\}\)/)
  assert.match(parentApp, /Players selected by the coach for this match/)
  assert.match(parentScreens, /See squad \(\$\{selectedMatch\.confirmedTeam\?\.length \|\| 0\}\)/)
  assert.match(parentScreens, /Selected squad/)
  assert.doesNotMatch(`${parentApp}\n${parentScreens}`, /Available and Selected|Selected and confirmed squad/)
  assert.doesNotMatch(parentApp, /new Set\(\(match\.confirmedTeam/)
  assert.doesNotMatch(`${parentApp}\n${parentScreens}`, /parent contact|player email|selected_by_email/i)
})

test('Parent squad includes current selected players independently of attendance and keeps account scope', () => {
  assert.match(parentData, /get_parent_portal_confirmed_teams/)
  assert.match(parentData, /selected_player_names/)
  assert.match(squadReadModel, /decision\.status = 'selected'/)
  assert.doesNotMatch(squadReadModel, /match_day_player_availability|availability\.status/)
  assert.match(squadReadModel, /link\.auth_user_id = \(select auth\.uid\(\)\)/)
  assert.match(squadReadModel, /fixture\.club_id = link\.club_id[\s\S]*fixture\.team_id = link\.team_id/)
  assert.match(squadReadModel, /get_parent_portal_match_days\(link\.id\)/)
  assert.match(squadReadModel, /player\.club_id = fixture\.club_id[\s\S]*player\.team_id = fixture\.team_id/)
  assert.match(squadReadModel, /coalesce\(player\.status, 'active'\) <> 'archived'/)
  assert.doesNotMatch(squadReadModel, /selected_by_email|parent_email|contact_email/)
})
