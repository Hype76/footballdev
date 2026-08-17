import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  getPermittedTeamRoleOptions,
} from '../src/lib/team-staff-role-policy.js'
import { normalizeTeamRow } from '../src/lib/domain/team-normalizers.js'

const userAccessPage = readFileSync(new URL('../src/pages/UserAccessPage.jsx', import.meta.url), 'utf8')
const activeUsersSection = readFileSync(
  new URL('../src/components/user-access/ActiveUsersSection.jsx', import.meta.url),
  'utf8',
)
const roleAction = readFileSync(new URL('../src/lib/domain/club-user-actions.js', import.meta.url), 'utf8')
const canonicalRoleMigration = readFileSync(
  new URL('../supabase/migrations/20260728170000_staff_role_assignment_control.sql', import.meta.url),
  'utf8',
)
const roleMigration = readFileSync(
  new URL('../supabase/migrations/20260730194500_team_staff_promotion_10d.sql', import.meta.url),
  'utf8',
)

const roles = [
  { roleKey: 'super_admin', roleLabel: 'Platform Admin', roleRank: 100 },
  { roleKey: 'admin', roleLabel: 'Club Admin', roleRank: 90 },
  { roleKey: 'head_manager', roleLabel: 'Team Admin', roleRank: 70 },
  { roleKey: 'manager', roleLabel: 'Manager', roleRank: 50 },
  { roleKey: 'coach', roleLabel: 'Coach', roleRank: 30 },
  { roleKey: 'assistant_coach', roleLabel: 'Assistant Coach', roleRank: 20 },
]

test('Manager and Team Admin selectors expose only canonical grantable team roles', () => {
  const manager = { id: 'manager', role: 'manager', roleRank: 50 }
  const teamAdmin = { id: 'team-admin', role: 'head_manager', roleRank: 70 }

  assert.deepEqual(
    getPermittedTeamRoleOptions({
      roles,
      user: manager,
      assignment: { userId: manager.id, roleKey: 'manager', roleRank: 50 },
    }).map((role) => role.roleKey),
    ['manager', 'coach', 'assistant_coach'],
  )
  assert.deepEqual(
    getPermittedTeamRoleOptions({
      roles,
      user: teamAdmin,
      assignment: { userId: teamAdmin.id, roleKey: 'head_manager', roleRank: 70 },
    }).map((role) => role.roleKey),
    ['head_manager', 'manager', 'coach', 'assistant_coach'],
  )
})

test('normal User Access loads accepted assignment context and preserves pending allocations', () => {
  assert.match(userAccessPage, /getVisibleClubUsers\(user\)/)
  assert.match(userAccessPage, /getTeamStaffAssignments\(user\)/)
  assert.match(userAccessPage, /getTeams\(user\)/)
  assert.match(userAccessPage, /!String\(assignment\.userId\)\.startsWith\('invite:'\)/)
  assert.match(userAccessPage, /<PendingAllocationsSection/)
  assert.match(userAccessPage, /teamAssignments:/)
  assert.match(activeUsersSection, /Club role:/)
  assert.match(activeUsersSection, /Club-level role/)
  assert.match(activeUsersSection, /Review club role change/)
  assert.match(activeUsersSection, /Team assignments/)
  assert.match(activeUsersSection, /No accepted team assignment is visible in this access scope\./)
})

test('each team assignment remains independent and offers a confirmed keyboard-usable transition', () => {
  assert.match(activeUsersSection, /key={`\$\{assignment\.assignmentId\}:\$\{assignment\.teamRoleKey\}`}/)
  assert.match(activeUsersSection, /aria-label={`Team role for \$\{member\.name \|\| member\.email \|\| 'Coach'\} in \$\{assignment\.teamName\}`}/)
  assert.match(activeUsersSection, /assignment\.roleOptions\.map/)
  assert.match(activeUsersSection, /Review role change/)
  assert.match(userAccessPage, /title="Confirm team role change"/)
  assert.match(userAccessPage, /title="Confirm club role change"/)
  assert.match(userAccessPage, /Current role:/)
  assert.match(userAccessPage, /New role:/)
  assert.match(userAccessPage, /Team scope:/)
  assert.match(userAccessPage, /requirePassword/)
})

test('role mutation uses the canonical assignment RPC and refreshes assignment and session authority', () => {
  assert.match(userAccessPage, /changeStaffRoleAssignment\(/)
  assert.match(userAccessPage, /assignmentId: roleChangeTarget\.assignment\.assignmentId/)
  assert.match(userAccessPage, /requestSource: 'user_access'/)
  assert.match(userAccessPage, /safeTeamRoleDenialCategories/)
  assert.match(userAccessPage, /The assignment may be protected or outside your authority\./)
  assert.match(userAccessPage, /await refreshAccessData\(\)/)
  assert.match(userAccessPage, /await refreshTeamSelection\?\.\(\)/)
  assert.match(roleAction, /supabase\.rpc\('change_staff_role_assignment'/)
  assert.match(roleAction, /clearViewCaches\(\)/)
  assert.match(userAccessPage, /assignClubUserRole\(/)
  assert.match(userAccessPage, /Existing team roles remain unchanged\./)
  assert.match(userAccessPage, /The role may be protected or outside your authority\./)
})

test('fresh assignment data replaces the normalized profile fallback during permission refresh', () => {
  const normalizedProfileTeam = normalizeTeamRow({
    id: 'team-one',
    club_id: 'club-one',
    name: 'Team One',
  })
  const refreshedTeam = normalizeTeamRow({
    ...normalizedProfileTeam,
    assignment_id: 'assignment-one',
    assignment_role: 'coach',
    assignment_role_label: 'Coach',
    assignment_role_rank: 30,
  })

  assert.equal(refreshedTeam.assignmentId, 'assignment-one')
  assert.equal(refreshedTeam.assignmentRole, 'coach')
  assert.equal(refreshedTeam.assignmentRoleLabel, 'Coach')
  assert.equal(refreshedTeam.assignmentRoleRank, 30)
})

test('server boundary retains scope, ceiling, protected-role, final-admin and audit enforcement', () => {
  assert.match(roleMigration, /cross_club_target/)
  assert.match(roleMigration, /team_scope_forbidden/)
  assert.match(roleMigration, /target_above_grant_ceiling/)
  assert.match(roleMigration, /grant_ceiling_exceeded/)
  assert.match(roleMigration, /protected_assignment/)
  assert.match(roleMigration, /final_team_admin/)
  assert.match(roleMigration, /app_private\.record_staff_role_change_audit/)
  assert.match(roleMigration, /p_request_source/)
  assert.match(canonicalRoleMigration, /'requestSource',/)
  assert.match(canonicalRoleMigration, /'result', p_outcome/)
})
