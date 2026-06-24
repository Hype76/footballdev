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

test('email queue route still requires email queue permission and parentEmail plan access', async () => {
  const source = await readFile(routerUrl, 'utf8')
  const section = getFunctionSection(source, 'RequireEmailQueueAccess')

  assert.match(section, /isRecoveryModuleVisible\('emailMessages', \{ user \}\)/)
  assert.match(section, /needsTeamWorkflowContext\(user\)/)
  assert.match(section, /canManageEmailQueue\(user\)/)
  assert.match(section, /canUseUiFeature\(user, CAPABILITIES\.parentEmails\)/)
  assert.match(section, /return <FeatureUnavailableState capability=\{CAPABILITIES\.parentEmails\} user=\{user\} \/>/)
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

test('sidebar email queue count can load without processing due sends', async () => {
  const sidebarSource = await readFile(sidebarUrl, 'utf8')
  const scheduledEmailsSource = await readFile(scheduledEmailsDomainUrl, 'utf8')

  assert.match(sidebarSource, /!isRecoveryModuleVisible\('emailMessages', \{ user \}\)/)
  assert.match(sidebarSource, /getScheduledEmails\(\{ silentUnavailable: true, user \}\)/)
  assert.doesNotMatch(scheduledEmailsSource, /export async function getScheduledEmails[\s\S]*processDueScheduledEmails\(\)/)
})

test('sidebar keeps email queue reachable even when no messages are queued', async () => {
  const sidebarSource = await readFile(sidebarUrl, 'utf8')
  const emailQueueFilterStart = sidebarSource.indexOf("if (item.path === '/email-queue')")
  assert.notEqual(emailQueueFilterStart, -1)
  const emailQueueFilterEnd = sidebarSource.indexOf("if (item.path === '/polls')", emailQueueFilterStart)
  assert.notEqual(emailQueueFilterEnd, -1)
  const emailQueueFilter = sidebarSource.slice(emailQueueFilterStart, emailQueueFilterEnd)

  assert.match(emailQueueFilter, /canUseTeamWorkflow/)
  assert.match(emailQueueFilter, /canManageEmailQueue\(displayUser\)/)
  assert.match(emailQueueFilter, /canUseUiFeature\(displayUser, CAPABILITIES\.parentEmails\)/)
  assert.doesNotMatch(emailQueueFilter, /queuedEmailCount\s*>\s*0/)
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
