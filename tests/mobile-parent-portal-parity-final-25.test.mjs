import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { getParentParitySummary, PARENT_PARITY_MATRIX } from '../apps/parent-mobile/src/parentParityMatrix.js'
import { resolveParentNotificationOpen } from '../apps/mobile-core/src/parentNotificationsCore.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const [app, screens, data, offline, environment, developmentApi, resourceApi, fileAccessMigration, fileAccessTeamScopeMigration] = await Promise.all([
  fs.readFile(`${root}/apps/parent-mobile/App.js`, 'utf8'),
  fs.readFile(`${root}/apps/parent-mobile/src/ParentPortalScreens.js`, 'utf8'),
  fs.readFile(`${root}/apps/parent-mobile/src/parentPortalData.js`, 'utf8'),
  fs.readFile(`${root}/apps/mobile-core/src/parentOfflineCore.js`, 'utf8'),
  fs.readFile(`${root}/mobile-test-api/netlify/functions/_shared/environment.mjs`, 'utf8'),
  fs.readFile(`${root}/mobile-test-api/netlify/functions/parent-development.mjs`, 'utf8'),
  fs.readFile(`${root}/mobile-test-api/netlify/functions/parent-resource.mjs`, 'utf8'),
  fs.readFile(`${root}/mobile-test-api/migrations/20260809123000_parent_portal_file_access.sql`, 'utf8'),
  fs.readFile(`${root}/mobile-test-api/migrations/20260809124500_parent_portal_file_access_team_scope.sql`, 'utf8'),
])

test('machine-readable matrix covers every approved Parent capability', () => {
  const expected = ['Overview', 'Calendar', 'Invites', 'Match cards', 'Parent Game Day', 'Results', 'Development', 'Resources', 'Parent Chat', 'Club announcements', 'Polls', 'Child switching', 'Settings and security', 'Notifications']
  assert.deepEqual(PARENT_PARITY_MATRIX.map((row) => row.capability), expected)
  assert.deepEqual(getParentParitySummary(), { complete: true, implemented: 14, total: 14 })
  for (const row of PARENT_PARITY_MATRIX) {
    for (const field of ['mobileEquivalent', 'read', 'write', 'childScope', 'offline', 'deepLink', 'states', 'authority', 'status']) {
      assert.notEqual(row[field], undefined, `${row.capability} missing ${field}`)
    }
  }
})

test('native navigation exposes Portal parity without billing, Coach or Demo Game Day', () => {
  for (const label of ['Home', 'Calendar', 'Matchday', 'Chat', 'More']) assert.match(app, new RegExp(`label: '${label}'`))
  for (const screen of ['InvitationsScreen', 'ResultsScreen', 'DevelopmentScreen', 'ResourcesScreen', 'MessagesScreen', 'PollsScreen', 'SettingsScreen']) assert.match(app, new RegExp(screen))
  assert.match(screens, /Accepted Parent scorer/)
  assert.match(screens, /Conversations for/)
  assert.doesNotMatch(`${app}\n${screens}\n${data}`, /checkout|billing|upgrade plan|private demo|demo game day/i)
})

test('all Parent reads and writes use established child-scoped authorities', () => {
  for (const rpc of [
    'get_parent_portal_invitation_summary',
    'respond_parent_portal_training_invitation',
    'respond_parent_portal_match_day_invitation',
    'get_parent_portal_match_days',
    'get_parent_portal_match_day_extended_state',
    'get_parent_portal_confirmed_teams',
    'get_parent_scorer_game_mode_match_ids',
    'get_parent_portal_player_resources',
    'get_parent_portal_chat_rooms',
    'get_parent_portal_chat_messages',
    'send_parent_portal_chat_message',
    'mark_parent_portal_chat_room_read',
    'delete_parent_portal_chat_message',
    'express_match_day_scorer_interest',
    'record_match_day_score_correction_v2',
    'record_match_day_goal_v2',
    'correct_match_day_goal',
    'void_match_day_goal',
    'record_match_day_shootout_kick',
    'void_match_day_shootout_kick',
  ]) assert.match(data, new RegExp(rpc))
  assert.match(data, /requireSelectedLink\(user\)/)
  assert.doesNotMatch(data, /service_role|SUPABASE_SERVICE_ROLE_KEY/)
})

test('offline cache includes all read-only parity resources and leaves high-risk writes online only', () => {
  for (const resource of ['calendar', 'chatHistory', 'chatRooms', 'development', 'invitations', 'matches', 'messages', 'polls', 'resources']) assert.match(offline, new RegExp(`'${resource}'`))
  assert.doesNotMatch(offline, /chat_send|scorer|invitation_response/)
  assert.match(screens, /Controls are unavailable offline/)
  assert.match(screens, /Responses need a connection/)
})

test('normalizers preserve response authority and safe display fields', () => {
  assert.match(data, /invitationType === 'match_role'[\s\S]*Accept offer[\s\S]*Decline offer/)
  assert.match(data, /roleType: normalizeText\(row\.role_type/)
  assert.match(data, /linesman: 'Linesman'[\s\S]*referee: 'Referee'[\s\S]*scorer: 'Scorer'/)
  assert.match(screens, /Volunteer offer/)
  assert.match(screens, /This is a Parent or guardian volunteer role\. It does not select your child for the squad\./)
  assert.match(screens, /Volunteer role status/)
  assert.match(data, /unreadCount: Number\(row\.unread_count/)
  assert.match(data, /canDelete: Boolean\(row\.can_delete/)
  assert.match(data, /title: normalizeText\(row\.title\) \|\| 'Shared resource'/)
})

test('deep links cover every native Parent destination and validate target IDs', () => {
  const routes = ['calendar', 'chat', 'development', 'invites', 'matchday', 'messages', 'polls', 'resources', 'results', 'settings']
  for (const route of routes) {
    assert.deepEqual(resolveParentNotificationOpen({ app: 'parent', route, targetId: 'valid' }, { [route]: ['valid'] }), { tab: route, targetId: 'valid' })
    assert.deepEqual(resolveParentNotificationOpen({ app: 'parent', route, targetId: 'stale' }, { [route]: ['valid'] }), { tab: route, targetId: '' })
  }
  assert.equal(resolveParentNotificationOpen({ app: 'coach', route: 'chat' }, { chat: ['valid'] }), null)
})

test('test API adapters fail closed to the approved project and use Parent RLS for file access', () => {
  assert.match(environment, /projectRef !== MOBILE_TEST_SUPABASE_REF/)
  assert.match(environment, /productionAccess !== 'false'/)
  assert.match(environment, /communicationsEnabled !== 'false'/)
  assert.match(environment, /schedulesEnabled !== 'false'/)
  assert.doesNotMatch(`${developmentApi}\n${resourceApi}\n${fileAccessMigration}`, /hvapkizujvsahvgspser|llpufwzvgxyczxcjwupu/)
  assert.doesNotMatch(`${developmentApi}\n${resourceApi}`, /service.role|SUPABASE_SERVICE_ROLE_KEY/i)
  assert.match(developmentApi, /content-type': 'application\/pdf'/)
  assert.match(resourceApi, /storage\/v1\/object\/authenticated/)
  assert.match(fileAccessMigration, /mobile_test_parent_resource_objects_select/)
  assert.match(fileAccessMigration, /parent_link\.auth_user_id = auth\.uid\(\)/)
  assert.match(fileAccessMigration, /revoke execute[\s\S]*from anon/)
  assert.match(fileAccessTeamScopeMigration, /parent_link\.team_id is null or parent_link\.team_id = link\.team_id/)
  assert.match(fileAccessTeamScopeMigration, /item\.storage_path = storage\.objects\.name/)
})

test('settings include password reauthentication, biometrics, notifications and light or dark display', () => {
  assert.match(data, /signInWithPassword/)
  assert.match(data, /updateUser\(\{ password: nextPassword \}\)/)
  assert.match(app, /Biometric app lock/)
  assert.match(app, /Choose Off, Minimal or Detailed/)
  assert.match(app, /\['dark', 'light'\]/)
  assert.match(app, /PARENT_THEME_STORAGE_KEY/)
})
