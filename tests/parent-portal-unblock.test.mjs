import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  CURRENT_RECOVERY_PHASE,
  getRecoveryModuleForPath,
  isRecoveryModuleVisible,
  isRecoveryPathVisible,
} from '../src/lib/recovery-phase.js'

const routerUrl = new URL('../src/app/router.jsx', import.meta.url)
const auditUrl = new URL('../src/lib/domain/audit.js', import.meta.url)
const authUrl = new URL('../src/lib/auth.js', import.meta.url)

test('phase 1 keeps the signed-in parent portal route visible', () => {
  const parentUser = {
    role: 'parent_portal',
    roleRank: 0,
  }

  assert.equal(CURRENT_RECOVERY_PHASE, 1)
  assert.equal(getRecoveryModuleForPath('/parent-portal'), 'parentPortal')
  assert.equal(isRecoveryModuleVisible('parentPortal', { user: parentUser }), true)
  assert.equal(isRecoveryPathVisible('/parent-portal', { user: parentUser }), true)
})

test('parent adjacent routes remain recovery gated until their own modules are ready', () => {
  const parentUser = {
    role: 'parent_portal',
    roleRank: 0,
  }

  assert.equal(getRecoveryModuleForPath('/parent-messages'), 'emailMessages')
  assert.equal(getRecoveryModuleForPath('/parent-polls'), 'pollsAvailability')
  assert.equal(getRecoveryModuleForPath('/friends-family'), 'parentInvites')
  assert.equal(isRecoveryPathVisible('/parent-messages', { user: parentUser }), false)
  assert.equal(isRecoveryPathVisible('/parent-polls', { user: parentUser }), false)
  assert.equal(isRecoveryPathVisible('/friends-family', { user: parentUser }), false)
})

test('match day is restored while unrelated recovery routes stay hidden for non-admin users', () => {
  const coachUser = {
    role: 'coach',
    roleRank: 30,
  }

  assert.equal(isRecoveryPathVisible('/match-day', { user: coachUser }), true)
  assert.equal(isRecoveryPathVisible('/parent-linking', { user: coachUser }), false)
  assert.equal(isRecoveryPathVisible('/activity-log', { user: coachUser }), false)
  assert.equal(isRecoveryPathVisible('/platform-feedback', { user: coachUser }), false)
})

test('parent portal route still requires parent portal role before rendering children', async () => {
  const source = await readFile(routerUrl, 'utf8')
  const start = source.indexOf('function RequireParentPortalAccess()')
  assert.notEqual(start, -1)
  const end = source.indexOf('function RequireParentLinkingAccess()', start)
  assert.notEqual(end, -1)
  const section = source.slice(start, end)

  assert.match(section, /if \(!isParentPortalUser\(user\)\) \{/)
  assert.match(section, /return <RedirectToWorkspaceHome user=\{user\} \/>/)
  assert.match(section, /const location = useLocation\(\)/)
  assert.match(section, /if \(!isRecoveryPathVisible\(location\.pathname, \{ user \}\)\) \{/)
  assert.match(section, /return <Outlet \/>/)
})

test('parent host does not probe platform admin access', async () => {
  const source = await readFile(authUrl, 'utf8')
  const start = source.indexOf('const refreshPlatformAdminAccess = async')
  assert.notEqual(start, -1)
  const end = source.indexOf('const openPlatformAdminProfile = async', start)
  assert.notEqual(end, -1)
  const section = source.slice(start, end)
  const parentHostIndex = section.indexOf('if (isParentPortalHost())')
  const fetchIndex = section.indexOf("fetch('/.netlify/functions/platform-admin-access'")

  assert.match(source, /import \{ isParentPortalHost \} from '\.\/app-origins\.js'/)
  assert.notEqual(parentHostIndex, -1)
  assert.notEqual(fetchIndex, -1)
  assert.ok(parentHostIndex < fetchIndex)
})

test('parent portal audit logging is skipped before client audit_logs insert', async () => {
  const source = await readFile(auditUrl, 'utf8')
  const functionStart = source.indexOf('export async function createAuditLog')
  assert.notEqual(functionStart, -1)
  const insertIndex = source.indexOf(".from('audit_logs').insert", functionStart)
  const skipIndex = source.indexOf('if (isParentPortalUser(user))', functionStart)

  assert.notEqual(skipIndex, -1)
  assert.notEqual(insertIndex, -1)
  assert.ok(skipIndex < insertIndex)
  assert.doesNotMatch(source, /grant\s+insert\s+on\s+.*audit_logs/i)
})
