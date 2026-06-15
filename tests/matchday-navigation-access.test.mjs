import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  canManageMatchDay,
  hasTeamWorkflowContext,
  isParentPortalUser,
  needsTeamWorkflowContext,
} from '../src/lib/auth-permissions.js'
import {
  getRecoveryModuleForPath,
  isRecoveryPathVisible,
} from '../src/lib/recovery-phase.js'

const routerUrl = new URL('../src/app/router.jsx', import.meta.url)
const sidebarUrl = new URL('../src/components/layout/Sidebar.jsx', import.meta.url)

function staffUser(overrides = {}) {
  return {
    id: 'staff-1',
    clubId: 'club-1',
    activeTeamId: 'team-1',
    planStatus: 'active',
    role: 'coach',
    roleRank: 30,
    ...overrides,
  }
}

test('match day recovery gate is visible for active team staff roles', () => {
  const staffRoles = [
    staffUser({ role: 'head_manager', roleRank: 70 }),
    staffUser({ role: 'manager', roleRank: 50 }),
    staffUser({ role: 'coach', roleRank: 30 }),
    staffUser({ role: 'assistant_coach', roleRank: 20 }),
  ]

  assert.equal(getRecoveryModuleForPath('/match-day'), 'matchDay')

  for (const user of staffRoles) {
    assert.equal(isRecoveryPathVisible('/match-day', { user }), true)
    assert.equal(hasTeamWorkflowContext(user), true)
    assert.equal(canManageMatchDay(user), true)
    assert.equal(needsTeamWorkflowContext(user), false)
  }
})

test('match day access fails closed for parent portal users and inactive plans', () => {
  const parentUser = {
    id: 'parent-1',
    clubId: 'club-1',
    activeTeamId: 'team-1',
    planStatus: 'active',
    role: 'parent_portal',
    roleRank: 0,
  }
  const inactiveCoach = staffUser({ planStatus: 'cancelled' })

  assert.equal(isParentPortalUser(parentUser), true)
  assert.equal(canManageMatchDay(parentUser), false)
  assert.equal(hasTeamWorkflowContext(parentUser), false)
  assert.equal(needsTeamWorkflowContext(parentUser), false)

  assert.equal(canManageMatchDay(inactiveCoach), false)
  assert.equal(hasTeamWorkflowContext(inactiveCoach), false)
})

test('club admin without a selected team is blocked from the team workflow path', () => {
  const clubAdmin = staffUser({
    activeTeamId: '',
    role: 'admin',
    roleRank: 100,
  })
  const clubAdminWithTeamContext = staffUser({
    role: 'admin',
    roleRank: 100,
  })

  assert.equal(isRecoveryPathVisible('/match-day', { user: clubAdmin }), true)
  assert.equal(canManageMatchDay(clubAdmin), false)
  assert.equal(hasTeamWorkflowContext(clubAdmin), false)
  assert.equal(needsTeamWorkflowContext(clubAdmin), true)
  assert.equal(canManageMatchDay(clubAdminWithTeamContext), false)
})

test('sidebar keeps match day behind team workflow context and staff permission', async () => {
  const source = await readFile(sidebarUrl, 'utf8')
  const sectionStart = source.indexOf("if (item.path === '/match-day')")
  assert.notEqual(sectionStart, -1)
  const sectionEnd = source.indexOf("if (item.path === '/user-access')", sectionStart)
  assert.notEqual(sectionEnd, -1)
  const section = source.slice(sectionStart, sectionEnd)

  assert.match(source, /const canUseTeamWorkflow = hasTeamWorkflowContext\(displayUser\)/)
  assert.match(section, /return canUseTeamWorkflow && canManageMatchDay\(displayUser\)/)
  assert.match(source, /if \(isParentPortal\) \{/)
  assert.match(source, /return item\.path === '\/parent-portal' \|\| item\.path === '\/parent-messages' \|\| item\.path === '\/parent-polls' \|\| item\.path === '\/friends-family'/)
})

test('team chooser does not auto-select a single team for club admins', async () => {
  const source = await readFile(routerUrl, 'utf8')
  const start = source.indexOf('function TeamContextRequiredState()')
  assert.notEqual(start, -1)
  const end = source.indexOf('function isClubSuspended(user)', start)
  assert.notEqual(end, -1)
  const section = source.slice(start, end)

  const clubAdminGuardIndex = section.indexOf('isClubAdmin(user)')
  const autoSelectIndex = section.indexOf('void handleTeamSelect(teamOptions[0].id)')

  assert.notEqual(clubAdminGuardIndex, -1)
  assert.notEqual(autoSelectIndex, -1)
  assert.ok(clubAdminGuardIndex < autoSelectIndex)
})

test('direct match day route checks recovery, team context, and staff permission', async () => {
  const source = await readFile(routerUrl, 'utf8')
  const start = source.indexOf('function RequireMatchDayAccess()')
  assert.notEqual(start, -1)
  const end = source.indexOf('function RequirePlatformFeedbackAccess()', start)
  assert.notEqual(end, -1)
  const section = source.slice(start, end)

  const recoveryIndex = section.indexOf("isRecoveryModuleVisible('matchDay', { user })")
  const teamContextIndex = section.indexOf('needsTeamWorkflowContext(user)')
  const permissionIndex = section.indexOf('canManageMatchDay(user)')

  assert.notEqual(recoveryIndex, -1)
  assert.notEqual(teamContextIndex, -1)
  assert.notEqual(permissionIndex, -1)
  assert.ok(recoveryIndex < teamContextIndex)
  assert.ok(teamContextIndex < permissionIndex)
  assert.match(section, /return <TeamContextRequiredState \/>/)
  assert.match(section, /return <RedirectToWorkspaceHome user=\{user\} \/>/)
  assert.match(section, /return <Outlet \/>/)
})
