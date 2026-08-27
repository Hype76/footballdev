import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [parentApp, parentScreens, parentData, squadReadModel] = await Promise.all([
  readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260827143000_parent_portal_available_selected_squad.sql', import.meta.url), 'utf8'),
])

test('Parent fixture details expose an explicit read-only squad view in Home and Matchday', () => {
  assert.match(parentApp, /See squad \(\$\{squadNames\.length\}\)/)
  assert.match(parentApp, /Only Players who are both Available and Selected are shown/)
  assert.match(parentScreens, /See squad \(\$\{selectedMatch\.confirmedTeam\?\.length \|\| 0\}\)/)
  assert.match(parentScreens, /Selected and confirmed squad/)
  assert.doesNotMatch(`${parentApp}\n${parentScreens}`, /parent contact|player email|selected_by_email/i)
})

test('Parent squad data remains server-authoritative and includes only Available and Selected names', () => {
  assert.match(parentData, /get_parent_portal_confirmed_teams/)
  assert.match(parentData, /selected_player_names/)
  assert.match(squadReadModel, /decision\.status = 'selected'/)
  assert.match(squadReadModel, /availability\.status = 'available'/)
  assert.match(squadReadModel, /link\.auth_user_id = \(select auth\.uid\(\)\)/)
  assert.match(squadReadModel, /fixture\.club_id = link\.club_id[\s\S]*fixture\.team_id = link\.team_id/)
  assert.doesNotMatch(squadReadModel, /selected_by_email|parent_email|contact_email/)
})
