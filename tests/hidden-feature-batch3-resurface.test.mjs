import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  getRecoveryModuleForPath,
  isRecoveryPathVisible,
} from '../src/lib/recovery-phase.js'

const routerUrl = new URL('../src/app/router.jsx', import.meta.url)
const sidebarUrl = new URL('../src/components/layout/Sidebar.jsx', import.meta.url)
const emailQueuePageUrl = new URL('../src/pages/EmailQueuePage.jsx', import.meta.url)
const parentEmailTemplatesPageUrl = new URL('../src/pages/ParentEmailTemplatesPage.jsx', import.meta.url)
const scheduledEmailsDomainUrl = new URL('../src/lib/domain/scheduled-emails.js', import.meta.url)
const templatesDomainUrl = new URL('../src/lib/domain/parent-email-templates.js', import.meta.url)
const templatePolicyMigrationUrl = new URL('../supabase/migrations/20260511213000_align_team_email_template_policies.sql', import.meta.url)

function staffUser(overrides = {}) {
  return {
    activeTeamId: 'team-1',
    clubId: 'club-1',
    planFeatures: {
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

test('batch 3 email queue and template routes are surfaced by recovery gates', () => {
  const user = staffUser()

  assert.equal(getRecoveryModuleForPath('/email-queue'), 'emailMessages')
  assert.equal(getRecoveryModuleForPath('/parent-email-templates'), 'emailMessages')
  assert.equal(isRecoveryPathVisible('/email-queue', { user }), true)
  assert.equal(isRecoveryPathVisible('/parent-email-templates', { user }), true)
  assert.equal(isRecoveryPathVisible('/end-season-stats', { user }), true)
  assert.equal(isRecoveryPathVisible('/billing', { user }), false)
})

test('email queue route is retained for platform admin direct access only', async () => {
  const source = await readFile(routerUrl, 'utf8')
  const section = getFunctionSection(source, 'RequireEmailQueueAccess')

  assert.match(section, /useWorkspaceRouteGate\(\{ redirectSuperAdmin: false \}\)/)
  assert.match(section, /!isSuperAdmin\(user\)/)
  assert.match(section, /return <RedirectToWorkspaceHome user=\{user\} \/>/)
  assert.doesNotMatch(section, /canManageEmailQueue\(user\)/)
  assert.doesNotMatch(section, /canUseUiFeature\(user, CAPABILITIES\.parentEmails\)/)
})

test('parent email template route still requires manager permission and parentEmail plan access', async () => {
  const source = await readFile(routerUrl, 'utf8')
  const section = getFunctionSection(source, 'RequireParentEmailTemplatesAccess')

  assert.match(section, /canManageParentEmailTemplates\(user\)/)
  assert.match(section, /isRecoveryModuleVisible\('emailMessages', \{ user \}\)/)
  assert.match(section, /canUseUiFeature\(user, CAPABILITIES\.parentEmails\)/)
  assert.match(section, /return <FeatureUnavailableState capability=\{CAPABILITIES\.parentEmails\} user=\{user\} \/>/)
})

test('surfaced email queue does not send or process emails from page load', async () => {
  const pageSource = await readFile(emailQueuePageUrl, 'utf8')
  const domainSource = await readFile(scheduledEmailsDomainUrl, 'utf8')

  assert.match(pageSource, /getScheduledEmails\(\{ user \}\)/)
  assert.match(pageSource, /updateScheduledEmail\(\{/)
  assert.match(pageSource, /deleteScheduledEmail\(\{/)
  assert.doesNotMatch(pageSource, /sendScheduledEmailNow|sendNowTarget|setSendNowTarget|Send queued email now|send now/i)
  assert.doesNotMatch(pageSource, /processDueScheduledEmails/)

  const listSectionStart = domainSource.indexOf('export async function getScheduledEmails')
  assert.notEqual(listSectionStart, -1)
  const updateSectionStart = domainSource.indexOf('export async function updateScheduledEmail', listSectionStart)
  const listSection = domainSource.slice(listSectionStart, updateSectionStart)
  assert.doesNotMatch(listSection, /processDueScheduledEmails/)
  assert.match(domainSource, /export async function sendScheduledEmailNow/)
})

test('sidebar no longer loads email queue counts for visible navigation', async () => {
  const sidebarSource = await readFile(sidebarUrl, 'utf8')
  const scheduledEmailsSource = await readFile(scheduledEmailsDomainUrl, 'utf8')

  assert.doesNotMatch(sidebarSource, /getScheduledEmails/)
  assert.doesNotMatch(sidebarSource, /scheduled-email-queue-changed/)
  assert.doesNotMatch(scheduledEmailsSource, /export async function getScheduledEmails[\s\S]*processDueScheduledEmails\(\)/)
})

test('sidebar removes the customer-facing email queue navigation item', async () => {
  const sidebarSource = await readFile(sidebarUrl, 'utf8')
  const navigationSource = await readFile(new URL('../src/app/navigation.js', import.meta.url), 'utf8')

  assert.doesNotMatch(navigationSource, /path: '\/email-queue'/)
  assert.doesNotMatch(navigationSource, /Parent email queue/)
  assert.doesNotMatch(sidebarSource, /item\.path === '\/email-queue'/)
})

test('parent email templates stay team scoped and do not send messages', async () => {
  const pageSource = await readFile(parentEmailTemplatesPageUrl, 'utf8')
  const domainSource = await readFile(templatesDomainUrl, 'utf8')
  const policyMigration = await readFile(templatePolicyMigrationUrl, 'utf8')

  assert.match(pageSource, /getParentEmailTemplates\(\{ user, includeDisabled: true, audience: 'all' \}\)/)
  assert.match(pageSource, /upsertParentEmailTemplate\(\{ user, template \}\)/)
  assert.match(pageSource, /deleteParentEmailTemplate\(\{ user, template \}\)/)
  assert.doesNotMatch(pageSource, /sendParentEmail|sendPreparedParentEmail|sendEmail|send now/i)

  assert.match(domainSource, /if \(Number\(user\.roleRank \?\? 0\) < 50 \|\| user\.role === 'super_admin'\)/)
  assert.match(domainSource, /activeTeamId/)
  assert.match(domainSource, /\.eq\('team_id', activeTeamId\)/)
  assert.match(policyMigration, /parent_email_templates\.club_id = public\.current_user_club_id\(\)/i)
  assert.match(policyMigration, /parent_email_templates\.team_id is not null/i)
  assert.match(policyMigration, /public\.can_use_plan_feature\(parent_email_templates\.club_id, 'parent_email'\)/i)
})
