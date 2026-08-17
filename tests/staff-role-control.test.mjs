import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const readSource = (path) => readFileSync(path, 'utf8')

const migration = readSource('supabase/migrations/20260728170000_staff_role_assignment_control.sql')
const teamPage = readSource('src/pages/TeamManagementPage.jsx')
const teamSection = readSource('src/components/teams/TeamStaffAllocationsSection.jsx')
const platformPage = readSource('src/pages/PlatformAdminPage.jsx')
const platformSection = readSource('src/components/platform/PlatformAccountManagementSection.jsx')
const roleActions = readSource('src/lib/domain/club-user-actions.js')
const auth = readSource('src/lib/auth.js')
const permissions = readSource('src/lib/auth-permissions.js')
const platformAdminFunction = readSource('netlify/functions/manage-platform-admin-staff.js')

test('contextual staff role storage uses the existing team assignment and canonical role registry', () => {
  assert.match(migration, /alter table public\.team_staff[\s\S]*add column if not exists role_key text/i)
  assert.match(migration, /from public\.club_roles role_definition/i)
  assert.match(migration, /team_staff_contextual_role_key_check/i)
  assert.match(migration, /head_manager[\s\S]*manager[\s\S]*coach[\s\S]*assistant_coach/i)
  assert.doesNotMatch(migration, /create table (?:if not exists )?public\.(?:staff_roles|team_staff_roles)/i)
})

test('role changes are server-authoritative and audit success and safe denials', () => {
  assert.match(migration, /create or replace function public\.change_staff_role_assignment/)
  assert.match(migration, /auth\.uid\(\)/)
  assert.match(migration, /actor_team_assignment\.role_key = 'head_manager'/)
  assert.match(migration, /final_team_admin/)
  assert.match(migration, /final_club_admin/)
  assert.match(migration, /final_platform_admin/)
  assert.match(migration, /protected_assignment/)
  assert.match(migration, /team_scope_forbidden/)
  assert.match(migration, /staff_role_change_denied/)
  assert.match(migration, /'previousRole', p_previous_role/)
  assert.match(migration, /'newRole', p_new_role/)
  assert.match(migration, /'requestSource',/)
  assert.match(migration, /'result', p_outcome/)
  const publicRoleChangeSignature = migration.match(
    /create or replace function public\.change_staff_role_assignment\(([\s\S]*?)\)\s*returns jsonb/i,
  )?.[1] || ''
  assert.doesNotMatch(publicRoleChangeSignature, /p_(?:actor_role|actor_rank|club_id|team_scope)/)
  assert.match(migration, /revoke insert, update, delete on table public\.team_staff from authenticated/)
  assert.match(migration, /public\.current_user_team_role_rank\(id\) >= 50/)
  assert.match(migration, /return public\.change_staff_role_assignment\(/)
})

test('team-scoped invitations no longer mutate the global profile role', () => {
  const existingUserBranch = roleActions.slice(
    roleActions.indexOf('if (existingUser) {', roleActions.indexOf('export async function createStaffInvite')),
    roleActions.indexOf('const inviteToken', roleActions.indexOf('export async function createStaffInvite')),
  )
  assert.match(existingUserBranch, /normalizedTeamId \? 'assign_team_staff_role' : 'set_club_user_role'/)
  assert.match(existingUserBranch, /p_team_id: normalizedTeamId/)
  assert.match(existingUserBranch, /target_team_id: null/)
})

test('Team Admin interface is scoped, confirmed, keyboard-usable and refreshes authority', () => {
  assert.match(permissions, /\['head_manager', 'manager'\]\.includes\(user\.role\)[\s\S]*user\.activeTeamId/)
  assert.match(teamPage, /canManageAssignedTeamRole\(user, assignment\)/)
  assert.match(teamPage, /getPermittedTeamRoleOptions/)
  assert.match(teamPage, /changeStaffRoleAssignment/)
  assert.match(teamPage, /requestSource: 'team_management'/)
  assert.match(teamPage, /await refreshTeamSelection\?\.\(\)/)
  assert.match(teamPage, /title="Confirm team role change"/)
  assert.match(teamPage, /No Coach email or notification will be sent\./)
  assert.match(teamSection, /aria-label={`Team role for \$\{getStaffDisplayName\(member\)\}`}/)
  assert.match(teamSection, /Review role change/)
  assert.match(teamSection, /canManageStaffAllocations/)
})

test('Platform Admin interface uses membership assignment ids and deliberate confirmation', () => {
  assert.match(platformSection, /member\.membershipId/)
  assert.match(platformSection, /club\?\.roles/)
  assert.match(platformSection, /Review role change/)
  assert.match(platformPage, /requestSource: 'platform_admin'/)
  assert.match(platformPage, /Current role:/)
  assert.match(platformPage, /New role:/)
  assert.match(platformPage, /Scope:/)
  assert.match(platformPage, /Consequence:/)
  assert.match(platformPage, /No Coach email or notification will be sent\./)
})

test('effective role refresh and final Platform Admin safeguards remain explicit', () => {
  assert.match(auth, /applyContextualTeamRole/)
  assert.match(auth, /assignmentRoleRank/)
  assert.match(auth, /activeTeamAssignmentId/)
  assert.match(platformAdminFunction, /activePlatformAdminCount/)
  assert.match(platformAdminFunction, /Another active Platform Admin must exist/)
})
