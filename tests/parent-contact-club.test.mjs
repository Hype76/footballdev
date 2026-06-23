import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const coreDomainUrl = new URL('../src/lib/domain/core.js', import.meta.url)
const parentPortalDomainUrl = new URL('../src/lib/domain/parent-portal.js', import.meta.url)

test('parent settings renders display name and email as club-managed read-only details', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')
  const panelStart = source.indexOf('function ParentAccountContactPanel')
  const panelEnd = source.indexOf('function toDateOnly', panelStart)
  const panelSection = source.slice(panelStart, panelEnd)

  assert.match(panelSection, /Club-managed contact details/)
  assert.match(panelSection, /Display name and email changes are managed by the club\./)
  assert.match(panelSection, /Display name/)
  assert.match(panelSection, /Email address/)
  assert.match(panelSection, /Read-only/)
  assert.match(panelSection, /parentName/)
  assert.match(panelSection, /parentEmail/)
  assert.doesNotMatch(panelSection, /<input/)
  assert.doesNotMatch(panelSection, /type="email"/)
  assert.doesNotMatch(panelSection, /type="submit"/)
})

test('parent settings contact notice prefers Team Admin email then falls back safely', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')
  const resolverStart = source.indexOf('function getParentSettingsContact')
  const resolverEnd = source.indexOf('function getParentEngagementSummary', resolverStart)
  const resolverSection = source.slice(resolverStart, resolverEnd)
  const panelStart = source.indexOf('function ParentAccountContactPanel')
  const panelEnd = source.indexOf('function toDateOnly', panelStart)
  const panelSection = source.slice(panelStart, panelEnd)

  assert.match(source, /function getTeamAdminContactEmails\(selectedLink\)/)
  assert.match(resolverSection, /label: 'Team Admin'/)
  assert.match(resolverSection, /Please contact your Team Admin if these details need updating\./)
  assert.match(resolverSection, /selectedLink\?\.clubContactEmail/)
  assert.match(resolverSection, /label: 'Club Admin'/)
  assert.match(resolverSection, /Please contact your Club Admin if these details need updating\./)
  assert.match(resolverSection, /Please contact your club directly\./)
  assert.match(panelSection, /href=\{`mailto:\$\{emailAddress\}`\}/)
  assert.match(panelSection, /\{contact\.label\} contact/)
})

test('parent settings no longer exposes parent-side display-name or email mutation calls', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')
  const settingsStart = source.indexOf('function ParentSettingsPanel')
  const settingsEnd = source.indexOf('function ParentAccountContactPanel', settingsStart)
  const settingsSection = source.slice(settingsStart, settingsEnd)

  assert.match(settingsSection, /<ParentAccountContactPanel/)
  assert.doesNotMatch(settingsSection, /handleDisplayNameSubmit/)
  assert.doesNotMatch(settingsSection, /handleEmailSubmit/)
  assert.doesNotMatch(source, /Save display name/)
  assert.doesNotMatch(source, /Change email/)
  assert.doesNotMatch(source, /requestLoginEmailChange/)
  assert.doesNotMatch(source, /prepareParentPortalEmailChange/)
  assert.doesNotMatch(source, /updateParentPortalDisplayName/)
  assert.doesNotMatch(source, /parent-portal-email-change/)
  assert.doesNotMatch(source, /supabase\.auth\.updateUser/)
  assert.doesNotMatch(source, /updateUser\(/)
  assert.doesNotMatch(source, /Email not updated/)
})

test('parent profile links carry selected club contact email without new unscoped staff lookup', async () => {
  const [coreSource, parentPortalSource] = await Promise.all([
    readFile(coreDomainUrl, 'utf8'),
    readFile(parentPortalDomainUrl, 'utf8'),
  ])
  const combinedSource = `${coreSource}\n${parentPortalSource}`
  const membershipsStart = coreSource.indexOf('async function getParentPortalMemberships')
  const membershipsEnd = coreSource.indexOf('function normalizeParentPortalProfile', membershipsStart)
  const membershipsSection = coreSource.slice(membershipsStart, membershipsEnd)

  assert.match(combinedSource, /clubs:club_id \(name, logo_url, contact_email\)/)
  assert.match(combinedSource, /clubContactEmail: String\(club\?\.contact_email \?\? ''\)\.trim\(\)/)
  assert.doesNotMatch(membershipsSection, /\.from\('team_staff'\)/)
  assert.doesNotMatch(parentPortalSource, /\.from\('team_staff'\)/)
})
