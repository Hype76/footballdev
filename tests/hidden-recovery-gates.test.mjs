import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { getRoleQuickLinks } from '../src/lib/role-quick-links.js'
import {
  getRecoveryModuleForPath,
  isRecoveryModuleVisible,
  isRecoveryPathVisible,
} from '../src/lib/recovery-phase.js'

const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)
const footballCalendarEventsUrl = new URL('../src/lib/football-calendar-events.js', import.meta.url)
const sidebarUrl = new URL('../src/components/layout/Sidebar.jsx', import.meta.url)
const routerUrl = new URL('../src/app/router.jsx', import.meta.url)
const recoveryUrl = new URL('../src/lib/recovery-phase.js', import.meta.url)

function staffUser(overrides = {}) {
  return {
    id: 'staff-1',
    clubId: 'club-1',
    activeTeamId: 'team-1',
    planFeatures: {
      auditLogs: true,
      customFormFields: true,
      parentEmail: true,
    },
    planKey: 'club',
    planStatus: 'active',
    role: 'head_manager',
    roleRank: 70,
    ...overrides,
  }
}

function getFunctionSection(source, functionName) {
  const start = source.indexOf(`function ${functionName}()`)
  assert.notEqual(start, -1, `${functionName} should exist`)
  const nextFunction = source.indexOf('\nfunction ', start + 1)
  return source.slice(start, nextFunction === -1 ? source.length : nextFunction)
}

test('batch 1 to 4 modules are visible while later modules stay hidden', () => {
  const user = staffUser()

  assert.equal(isRecoveryModuleVisible('pollsAvailability', { user }), true)
  assert.equal(isRecoveryModuleVisible('parentInvites', { user }), true)
  assert.equal(isRecoveryModuleVisible('parentMessages', { user }), true)
  assert.equal(isRecoveryModuleVisible('familySharing', { user }), true)
  assert.equal(isRecoveryModuleVisible('emailMessages', { user }), true)
  assert.equal(isRecoveryModuleVisible('reports', { user }), true)
  assert.equal(isRecoveryPathVisible('/polls', { user }), true)
  assert.equal(isRecoveryPathVisible('/parent-linking', { user }), true)
  assert.equal(isRecoveryPathVisible('/parent-polls', { user: { ...user, role: 'parent_portal', roleRank: 0 } }), true)
  assert.equal(isRecoveryPathVisible('/parent-messages', { user: { ...user, role: 'parent_portal', roleRank: 0 } }), true)
  assert.equal(isRecoveryPathVisible('/friends-family', { user: { ...user, role: 'parent_portal', roleRank: 0 } }), true)
  assert.equal(isRecoveryPathVisible('/email-queue', { user }), true)
  assert.equal(isRecoveryPathVisible('/parent-email-templates', { user }), true)
  assert.equal(isRecoveryPathVisible('/end-season-stats', { user }), true)
  assert.equal(isRecoveryPathVisible('/parent-portal', { user }), true)
  assert.equal(isRecoveryPathVisible('/match-day', { user }), true)
  assert.equal(getRecoveryModuleForPath('/sessions'), '')
})

test('sessions calendar poll loading remains explicitly gated by the poll module', async () => {
  const source = await readFile(sessionsPageUrl, 'utf8')
  const guardIndex = source.indexOf("const canShowPollsInCalendar = isRecoveryModuleVisible('pollsAvailability', { user })")
  const getPollsIndex = source.indexOf('withRequestTimeout(() => getPolls({ user })')
  const promiseFallbackIndex = source.indexOf('Promise.resolve([])', getPollsIndex)
  const calendarEventsIndex = source.indexOf('buildFootballCalendarEvents({')
  const gatedPollsIndex = source.indexOf('polls: isClubWideCalendar || !canShowPollsInCalendar ? [] : polls', calendarEventsIndex)

  assert.notEqual(guardIndex, -1)
  assert.notEqual(getPollsIndex, -1)
  assert.notEqual(promiseFallbackIndex, -1)
  assert.notEqual(gatedPollsIndex, -1)
  assert.ok(guardIndex < getPollsIndex)
  assert.ok(getPollsIndex < promiseFallbackIndex)
  assert.ok(calendarEventsIndex < gatedPollsIndex)
})

test('poll-derived calendar events stay behind the sessions poll gate', async () => {
  const sessionsSource = await readFile(sessionsPageUrl, 'utf8')
  const calendarSource = await readFile(footballCalendarEventsUrl, 'utf8')

  assert.match(calendarSource, /const pollEvents = polls[\s\S]*sourceType: 'poll'/)
  assert.match(sessionsSource, /polls: isClubWideCalendar \|\| !canShowPollsInCalendar \? \[\] : polls/)
  assert.match(sessionsSource, /canShowPollsInCalendar[\s\S]*\? withRequestTimeout\(\(\) => getPolls\(\{ user \}\)/)
})

test('staff sidebar keeps count fetches behind module checks', async () => {
  const source = await readFile(sidebarUrl, 'utf8')
  const staffPollBranch = source.indexOf('if (canManagePolls(user))')
  const pollRecoveryGate = source.indexOf("!isRecoveryModuleVisible('pollsAvailability', { user })", staffPollBranch)
  const getPollsCall = source.indexOf('const polls = await getPolls({ user })', staffPollBranch)
  const emailQueueGate = source.indexOf("!isRecoveryModuleVisible('emailMessages', { user })")
  const getScheduledEmailsCall = source.indexOf('const queuedEmails = await getScheduledEmails')

  assert.notEqual(staffPollBranch, -1)
  assert.notEqual(pollRecoveryGate, -1)
  assert.notEqual(getPollsCall, -1)
  assert.notEqual(emailQueueGate, -1)
  assert.notEqual(getScheduledEmailsCall, -1)
  assert.ok(staffPollBranch < pollRecoveryGate)
  assert.ok(pollRecoveryGate < getPollsCall)
  assert.ok(emailQueueGate < getScheduledEmailsCall)
})

test('role quick links exclude recovery gated destinations', () => {
  const managerLinks = getRoleQuickLinks(staffUser()).map((link) => link.path)
  const superAdminLinks = getRoleQuickLinks(staffUser({
    activeTeamId: '',
    clubId: '',
    role: 'super_admin',
    roleRank: 1000,
  })).map((link) => link.path)

  assert.equal(managerLinks.includes('/parent-email-templates'), true)
  assert.equal(managerLinks.includes('/activity-log'), false)
  assert.equal(managerLinks.includes('/billing'), false)
  assert.equal(managerLinks.includes('/platform-feedback'), false)
  assert.equal(managerLinks.includes('/form-builder'), true)
  assert.equal(superAdminLinks.includes('/activity-log'), false)
  assert.equal(superAdminLinks.includes('/platform-feedback'), true)
})

test('billing direct route respects recovery before billing permission', async () => {
  const source = await readFile(routerUrl, 'utf8')
  const section = getFunctionSection(source, 'RequireBillingAccess')
  const recoveryIndex = section.indexOf("isRecoveryModuleVisible('billing', { user })")
  const permissionIndex = section.indexOf('canViewBilling(user)')

  assert.notEqual(recoveryIndex, -1)
  assert.notEqual(permissionIndex, -1)
  assert.ok(recoveryIndex < permissionIndex)
  assert.match(section, /return <RecoveryPhaseBlockedState \/>/)
})

test('form builder phase config, sidebar visibility, and route access agree', async () => {
  const recoverySource = await readFile(recoveryUrl, 'utf8')
  const sidebarSource = await readFile(sidebarUrl, 'utf8')
  const routerSource = await readFile(routerUrl, 'utf8')
  const formBuilderSection = getFunctionSection(routerSource, 'RequireFormBuilderAccess')

  assert.match(recoverySource, /formBuilder: \{ phase: 1 \}/)
  assert.doesNotMatch(recoverySource, /formBuilder: \{ phase: 1, clubAdminOnlyDuringRecovery: true \}/)
  assert.match(sidebarSource, /if \(!isRecoveryPathVisible\(item\.path, \{ user: displayUser \}\)\) \{/)
  assert.doesNotMatch(sidebarSource, /item\.path !== '\/form-builder'/)
  assert.match(formBuilderSection, /isRecoveryModuleVisible\('formBuilder', \{ user \}\)/)
  assert.match(formBuilderSection, /canManageFormFields\(user\)/)
  assert.match(formBuilderSection, /hasPlanFeature\(user, 'customFormFields'\)/)
  assert.equal(isRecoveryPathVisible('/form-builder', { user: staffUser() }), true)
})

test('direct routes for hidden modules remain protected', async () => {
  const source = await readFile(routerUrl, 'utf8')

  for (const moduleKey of ['parentInvites', 'emailMessages', 'pollsAvailability', 'reports', 'activityLog']) {
    assert.match(source, new RegExp(`isRecoveryModuleVisible\\('${moduleKey}', \\{ user \\}\\)`))
  }

  assert.equal(isRecoveryPathVisible('/parent-messages', { user: staffUser() }), true)
  assert.equal(isRecoveryPathVisible('/parent-polls', { user: staffUser() }), true)
  assert.equal(isRecoveryPathVisible('/friends-family', { user: staffUser() }), true)
  assert.equal(isRecoveryPathVisible('/parent-linking', { user: staffUser() }), true)
  assert.equal(isRecoveryPathVisible('/email-queue', { user: staffUser() }), true)
  assert.equal(isRecoveryPathVisible('/parent-email-templates', { user: staffUser() }), true)
  assert.equal(isRecoveryPathVisible('/end-season-stats', { user: staffUser() }), true)
  assert.equal(isRecoveryPathVisible('/activity-log', { user: staffUser() }), false)
})
