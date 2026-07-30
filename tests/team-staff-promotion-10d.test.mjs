import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  canManageAssignedTeamRole,
  getPermittedTeamRoleOptions,
  getTeamRoleAuthorityMessage,
} from '../src/lib/team-staff-role-policy.js'

const roles = [
  { roleKey: 'admin', roleLabel: 'Club Admin', roleRank: 90 },
  { roleKey: 'head_manager', roleLabel: 'Team Admin', roleRank: 70 },
  { roleKey: 'manager', roleLabel: 'Manager', roleRank: 50 },
  { roleKey: 'coach', roleLabel: 'Coach', roleRank: 30 },
  { roleKey: 'assistant_coach', roleLabel: 'Assistant Coach', roleRank: 20 },
]

const migration = readFileSync(
  new URL('../supabase/migrations/20260730194500_team_staff_promotion_10d.sql', import.meta.url),
  'utf8',
)
const teamPage = readFileSync(new URL('../src/pages/TeamManagementPage.jsx', import.meta.url), 'utf8')
const teamSection = readFileSync(
  new URL('../src/components/teams/TeamStaffAllocationsSection.jsx', import.meta.url),
  'utf8',
)
const permissions = readFileSync(new URL('../src/lib/auth-permissions.js', import.meta.url), 'utf8')

test('Team Admin and Manager receive only their canonical destination roles', () => {
  const teamAdmin = { id: 'team-admin', role: 'head_manager', roleRank: 70 }
  const manager = { id: 'manager', role: 'manager', roleRank: 50 }
  const teamAdminAssignment = {
    userId: teamAdmin.id,
    roleKey: 'head_manager',
    roleRank: 70,
  }
  const managerAssignment = {
    userId: manager.id,
    roleKey: 'manager',
    roleRank: 50,
  }

  assert.equal(canManageAssignedTeamRole(teamAdmin, teamAdminAssignment), true)
  assert.equal(canManageAssignedTeamRole(manager, managerAssignment), true)
  assert.deepEqual(
    getPermittedTeamRoleOptions({ roles, user: teamAdmin, assignment: teamAdminAssignment })
      .map((role) => role.roleKey),
    ['head_manager', 'manager', 'coach', 'assistant_coach'],
  )
  assert.deepEqual(
    getPermittedTeamRoleOptions({ roles, user: manager, assignment: managerAssignment })
      .map((role) => role.roleKey),
    ['manager', 'coach', 'assistant_coach'],
  )
  assert.match(getTeamRoleAuthorityMessage({ user: manager, assignment: managerAssignment }), /Team Admin.*remain unavailable/i)
})

test('unassigned and lower-ranked staff cannot render promotion destinations', () => {
  const manager = { id: 'manager', role: 'manager', roleRank: 50 }
  const otherManagerAssignment = {
    userId: 'other-manager',
    roleKey: 'manager',
    roleRank: 50,
  }
  const coachAssignment = {
    userId: manager.id,
    roleKey: 'coach',
    roleRank: 30,
  }

  assert.equal(canManageAssignedTeamRole(manager, otherManagerAssignment), false)
  assert.equal(canManageAssignedTeamRole(manager, coachAssignment), false)
  assert.deepEqual(
    getPermittedTeamRoleOptions({ roles, user: manager, assignment: otherManagerAssignment }),
    [],
  )
})

test('the UI exposes managed teams to contextual Managers and refreshes authority after change', () => {
  assert.match(permissions, /\['head_manager', 'manager'\]\.includes\(user\.role\)/)
  assert.match(permissions, /Number\(user\.roleRank \?\? 0\) >= 50/)
  assert.match(teamPage, /canManageAssignedTeamRole\(user, assignment\)/)
  assert.match(teamPage, /getPermittedTeamRoleOptions/)
  assert.match(teamPage, /getTeamRoleAuthorityMessage/)
  assert.match(teamPage, /await refreshTeamSelection\?\.\(\)/)
  assert.match(teamSection, /teamRoleAuthorityMessage/)
  assert.match(teamSection, /aria-label={`Team role for \$\{getStaffDisplayName\(member\)\}`}/)
  assert.match(teamSection, /Review role change/)
})

test('the server derives actor rank and enforces scope, ceilings, protected roles and final admin', () => {
  assert.match(migration, /actor_team_assignment\.role_key in \('head_manager', 'manager'\)/)
  assert.match(migration, /actor_team_assignment\.role_rank >= 50/)
  assert.match(migration, /approved_role\.role_rank > actor_team_assignment\.role_rank/)
  assert.match(migration, /team_assignment\.role_rank > actor_team_assignment\.role_rank/)
  assert.match(migration, /cross_club_target/)
  assert.match(migration, /team_scope_forbidden/)
  assert.match(migration, /target_above_grant_ceiling/)
  assert.match(migration, /grant_ceiling_exceeded/)
  assert.match(migration, /protected_assignment/)
  assert.match(migration, /final_team_admin/)
  assert.match(migration, /app_private\.record_staff_role_change_audit/)
  assert.doesNotMatch(
    migration.match(/create or replace function public\.change_staff_role_assignment\(([\s\S]*?)\)\s*returns jsonb/i)?.[1] ?? '',
    /actor_role|actor_rank|club_id|team_id/,
  )
})
