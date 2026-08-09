import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getWorkspaceInviteRedirect,
  getWorkspaceScope,
  shouldPromoteWorkspaceOwnerToClubAdmin,
  WORKSPACE_SCOPES,
} from '../src/lib/workspace-scope.js'
import {
  canManageClubSettings,
  canManageTeamSettings,
  canUseClubStaffChat,
  canViewBilling,
  getRoleLabel,
  isClubAdmin,
} from '../src/lib/auth-permissions.js'

test('workspace scope resolves public, legacy and internal plans from one contract', () => {
  assert.equal(getWorkspaceScope('individual').key, WORKSPACE_SCOPES.individual)
  assert.equal(getWorkspaceScope('Individual Coach - Free').key, WORKSPACE_SCOPES.individual)
  assert.equal(getWorkspaceScope('single_team').key, WORKSPACE_SCOPES.team)
  assert.equal(getWorkspaceScope('Team').key, WORKSPACE_SCOPES.team)
  assert.equal(getWorkspaceScope('small_club').key, WORKSPACE_SCOPES.club)
  assert.equal(getWorkspaceScope('development').key, WORKSPACE_SCOPES.club)
  assert.equal(getWorkspaceScope('large_club').key, WORKSPACE_SCOPES.club)
  assert.equal(getWorkspaceScope('pilot').key, WORKSPACE_SCOPES.club)
})

test('workspace scope assigns the correct top level authority', () => {
  assert.deepEqual(getWorkspaceScope('individual').ownerRole, {
    key: 'head_manager',
    label: 'Coach Owner',
    rank: 70,
  })
  assert.deepEqual(getWorkspaceScope('single_team').ownerRole, {
    key: 'head_manager',
    label: 'Team Admin',
    rank: 70,
  })
  assert.deepEqual(getWorkspaceScope('small_club').ownerRole, {
    key: 'admin',
    label: 'Club Admin',
    rank: 90,
  })
})

test('unknown plans fail closed without owner authority or initial provisioning', () => {
  for (const value of ['', 'future_plan', '<script>']) {
    const scope = getWorkspaceScope(value)
    assert.equal(scope.key, WORKSPACE_SCOPES.unknown)
    assert.equal(scope.supported, false)
    assert.equal(scope.ownerRole.rank, 0)
    assert.equal(scope.createInitialTeam, false)
  }
})

test('only a transition into club scope promotes the workspace owner to Club Admin', () => {
  assert.equal(shouldPromoteWorkspaceOwnerToClubAdmin('individual', 'single_team'), false)
  assert.equal(shouldPromoteWorkspaceOwnerToClubAdmin('single_team', 'small_club'), true)
  assert.equal(shouldPromoteWorkspaceOwnerToClubAdmin('individual', 'development_club'), true)
  assert.equal(shouldPromoteWorkspaceOwnerToClubAdmin('small_club', 'development_club'), false)
  assert.equal(shouldPromoteWorkspaceOwnerToClubAdmin('unknown', 'small_club'), false)
})

test('invite landing routes follow scope and billing independently', () => {
  assert.equal(getWorkspaceInviteRedirect('single_team', 'unpaid'), '/coach')
  assert.equal(getWorkspaceInviteRedirect('single_team', 'paid'), '/billing')
  assert.equal(getWorkspaceInviteRedirect('small_club', 'unpaid'), '/club-settings')
  assert.equal(getWorkspaceInviteRedirect('unknown', 'paid'), '/sign-in')
})

test('Single Team owner keeps Team authority and fails closed for Club-only authority', () => {
  const teamOwner = {
    id: 'team-owner',
    clubId: 'workspace-1',
    activeTeamId: 'team-1',
    planKey: 'single_team',
    planStatus: 'active',
    role: 'head_manager',
    roleLabel: 'Team Admin',
    roleRank: 70,
    isWorkspaceOwner: true,
  }
  const staleClubAdmin = { ...teamOwner, role: 'admin', roleLabel: 'Club Admin', roleRank: 90 }

  assert.equal(getRoleLabel(teamOwner), 'Team Admin')
  assert.equal(canManageTeamSettings(teamOwner), true)
  assert.equal(canViewBilling(teamOwner), true)
  assert.equal(isClubAdmin(teamOwner), false)
  assert.equal(canManageClubSettings(teamOwner), false)
  assert.equal(canUseClubStaffChat(teamOwner), false)
  assert.equal(isClubAdmin(staleClubAdmin), false)
  assert.equal(canManageClubSettings(staleClubAdmin), false)
})

test('Club Admin retains Club authority only on Club plans', () => {
  const clubAdmin = {
    id: 'club-admin',
    clubId: 'club-1',
    planKey: 'small_club',
    planStatus: 'active',
    role: 'admin',
    roleLabel: 'Club Admin',
    roleRank: 90,
    isWorkspaceOwner: true,
  }

  assert.equal(isClubAdmin(clubAdmin), true)
  assert.equal(canManageClubSettings(clubAdmin), true)
  assert.equal(canUseClubStaffChat(clubAdmin), true)
})
