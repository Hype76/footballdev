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
const authUrl = new URL('../src/lib/auth.js', import.meta.url)
const matchDayDomainUrl = new URL('../src/lib/domain/match-day.js', import.meta.url)

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

test('stored team context cannot select an unassigned team', async () => {
  const source = await readFile(authUrl, 'utf8')
  const applyStart = source.indexOf('const applyTeamSelection = async (profile) => {')
  assert.notEqual(applyStart, -1)
  const applyEnd = source.indexOf('const applyDemoRolePreview =', applyStart)
  assert.notEqual(applyEnd, -1)
  const applySection = source.slice(applyStart, applyEnd)

  assert.match(applySection, /const assignedTeams = isClubAdmin\(profile\) \? await getTeams\(profile\) : await getAssignedTeamsForUser\(profile\)/)
  assert.match(applySection, /const selectedTeam = assignedTeams\.find\(\(team\) => String\(team\.id\) === selectedTeamId\)/)
  assert.match(applySection, /window\.sessionStorage\.removeItem\(SELECTED_TEAM_STORAGE_KEY\)/)
  assert.match(applySection, /activeTeamId: ''/)

  const selectStart = source.indexOf('const selectTeam = async (teamId) => {')
  assert.notEqual(selectStart, -1)
  const selectEnd = source.indexOf('const selectPlatformAdmin = async () => {', selectStart)
  assert.notEqual(selectEnd, -1)
  const selectSection = source.slice(selectStart, selectEnd)

  assert.match(selectSection, /let selectedTeam = teamOptions\.find\(\(team\) => String\(team\.id\) === String\(teamId\)\)/)
  assert.match(selectSection, /await getAssignedTeamsForUser\(userRef\.current\)/)
  assert.match(selectSection, /throw new Error\('This team is not linked to your account\.'\)/)
})

test('match day domain scopes reads and mutations to the active team', async () => {
  const source = await readFile(matchDayDomainUrl, 'utf8')

  assert.match(source, /!user\.activeTeamId/)
  assert.match(source, /user\.role === 'admin'/)
  assert.match(source, /function scopeMatchDayQueryToActiveTeam\(query, user\)/)
  assert.match(source, /return query\.or\(`team_id\.is\.null,team_id\.eq\.\$\{activeTeamId\}`\)/)

  const getStart = source.indexOf('export async function getMatchDays')
  const getEnd = source.indexOf('export async function getMatchLocations', getStart)
  assert.notEqual(getStart, -1)
  assert.notEqual(getEnd, -1)
  const getSection = source.slice(getStart, getEnd)
  assert.match(getSection, /query = query\.or\(`team_id\.is\.null,team_id\.eq\.\$\{user\.activeTeamId\}`\)/)

  const updateStart = source.indexOf('export async function updateMatchDay')
  const updateEnd = source.indexOf('export async function selectMatchDayScorer', updateStart)
  assert.notEqual(updateStart, -1)
  assert.notEqual(updateEnd, -1)
  const updateSection = source.slice(updateStart, updateEnd)
  assert.match(updateSection, /query = scopeMatchDayQueryToActiveTeam\(query, user\)/)

  const scorerStart = source.indexOf('export async function selectMatchDayVolunteer')
  const scorerEnd = source.indexOf('export async function addStaffMatchDayGoal', scorerStart)
  assert.notEqual(scorerStart, -1)
  assert.notEqual(scorerEnd, -1)
  const scorerSection = source.slice(scorerStart, scorerEnd)
  assert.match(scorerSection, /assertMatchInActiveTeamScope\(user, match\)/)
  assert.match(scorerSection, /await assertMatchDayRecordInActiveTeamScope\(user, match\.id\)/)

  const goalStart = source.indexOf('export async function addStaffMatchDayGoal')
  const goalEnd = source.indexOf('export async function resetPreviousMatchDayResults', goalStart)
  assert.notEqual(goalStart, -1)
  assert.notEqual(goalEnd, -1)
  const goalSection = source.slice(goalStart, goalEnd)
  assert.match(goalSection, /assertMatchInActiveTeamScope\(user, match\)/)
  assert.match(goalSection, /matchUpdateQuery = scopeMatchDayQueryToActiveTeam\(matchUpdateQuery, user\)/)
  assert.match(goalSection, /if \(!updatedMatch\?\.id\)/)

  const resetStart = source.indexOf('export async function resetPreviousMatchDayResults')
  const resetEnd = source.indexOf('export async function getParentPortalMatchDays', resetStart)
  assert.notEqual(resetStart, -1)
  assert.notEqual(resetEnd, -1)
  const resetSection = source.slice(resetStart, resetEnd)
  assert.match(resetSection, /normalizedTeamId && normalizedTeamId !== user\.activeTeamId/)
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
