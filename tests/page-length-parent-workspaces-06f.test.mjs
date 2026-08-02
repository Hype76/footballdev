import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)

test('parent invitations and results use bounded URL-backed pages without removing actions', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')
  const resultsStart = source.indexOf('function ParentResultsPanel')
  const resultsEnd = source.indexOf('function ParentResourcesPanel', resultsStart)
  const invitationsStart = source.indexOf('function ParentUpcomingEvents')
  const invitationsEnd = source.indexOf('function ParentPortalSignOutButton', invitationsStart)
  const results = source.slice(resultsStart, resultsEnd)
  const invitations = source.slice(invitationsStart, invitationsEnd)

  assert.match(source, /const parentResultsPageSize = 3/)
  assert.match(results, /previousMatches\.slice\(/)
  assert.match(results, /nextSearchParams\.set\('resultPage', String\(nextPage\)\)/)
  assert.match(results, /<PreviousGameCard key=\{match\.id\} match=\{match\} onOpen=\{onOpen\} \/>/)
  assert.match(source, /const parentInvitationPageSize = 3/)
  assert.match(invitations, /invitationViews\[activeTab\]\.slice\(/)
  assert.match(invitations, /nextSearchParams\.set\('inviteView', viewId\)/)
  assert.match(invitations, /nextSearchParams\.set\('invitePage', String\(nextPage\)\)/)
  assert.match(invitations, /Respond now/)
  assert.match(invitations, /View event/)
})

test('parent settings use URL-backed task areas and retain every account action', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')
  const settingsStart = source.indexOf('function ParentSettingsPanel')
  const settingsEnd = source.indexOf('function ParentAccountContactPanel', settingsStart)
  const settings = source.slice(settingsStart, settingsEnd)

  assert.match(source, /const parentSettingsAreas = \[/)
  assert.match(source, /\{ id: 'account', label: 'Account' \}/)
  assert.match(source, /\{ id: 'security', label: 'Security' \}/)
  assert.match(source, /\{ id: 'display', label: 'Display and alerts' \}/)
  assert.match(settings, /nextSearchParams\.set\('settingsArea', areaId\)/)
  assert.match(settings, /settingsArea === 'account'/)
  assert.match(settings, /settingsArea === 'security'/)
  assert.match(settings, /settingsArea === 'display'/)
  assert.match(settings, /<ParentAccountContactPanel/)
  assert.match(settings, /Update password/)
  assert.match(settings, /Send verification code/)
  assert.match(settings, /Send reset email/)
  assert.match(settings, /<PushNotificationPanel/)
  assert.match(settings, /<ParentPortalSignOutButton/)
})
