import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const sidebarUrl = new URL('../src/components/layout/Sidebar.jsx', import.meta.url)
const navigationUrl = new URL('../src/app/navigation.js', import.meta.url)
const routerUrl = new URL('../src/app/router.jsx', import.meta.url)

test('sidebar no longer renders the How to use navigation link', async () => {
  const source = await readFile(sidebarUrl, 'utf8')

  assert.doesNotMatch(source, /How to use/)
  assert.doesNotMatch(source, /sidebar-information/)
  assert.doesNotMatch(source, /to="\/information"/)
})

test('information route and page are preserved for direct URL access', async () => {
  const source = await readFile(routerUrl, 'utf8')

  assert.match(source, /const InformationPage = lazyRoute\(\(\) => import\('\.\.\/pages\/InformationPage\.jsx'\), 'InformationPage'\)/)
  assert.match(source, /path: 'information'/)
  assert.match(source, /<InformationPage \/>/)
})

test('other expected sidebar navigation entries remain defined', async () => {
  const source = await readFile(navigationUrl, 'utf8')

  assert.match(source, /label: 'Development',\s+path: '\/assess-player',\s+helper: 'Records and notes'/)
  assert.doesNotMatch(source, /label: 'Feedback',\s+path: '\/assess-player'/)

  for (const label of [
    'Calendar',
    'Players',
    'Development',
    'Development Forms',
    'Polls',
    'Game Day',
    'Teams',
    'Parent Invites',
    'Activity Log',
  ]) {
    assert.match(source, new RegExp(`label: '${label}'`))
  }
})

test('sidebar groups V1 navigation without changing routes or visibility gates', async () => {
  const source = await readFile(sidebarUrl, 'utf8')

  assert.match(source, /const coreNavigationPaths = \['\/calendar', '\/players', '\/assess-player', '\/feedback-forms'\]/)
  assert.match(source, /const communicationNavigationPaths = \['\/staff-chat', '\/parent-chat-staff', '\/parent-linking', '\/polls'\]/)
  assert.match(source, /const matchOperationsNavigationPaths = \['\/match-day', '\/resources'\]/)
  assert.match(source, /title="Team Comms"/)
  assert.match(source, /title="Match Operations"/)
  assert.ok(source.indexOf('title="Match Operations"') < source.indexOf('title="Team Comms"'))
  assert.match(source, /const teamNavigationItems = isCoachOnly \? \[\] : navigationItems\.filter\(\(item\) => !coachNavigationPaths\.includes\(item\.path\)\)/)
  assert.match(source, /if \(item\.path === '\/staff-chat' \|\| item\.path === '\/parent-chat-staff'\) \{[\s\S]*return canUseStaffChat\(displayUser\)/)
  assert.match(source, /if \(item\.path === '\/resources'\) \{[\s\S]*return canUseResourceLibrary\(displayUser\) \|\| canManageResourceLibrary\(displayUser\)/)
  assert.match(source, /if \(item\.path === '\/polls'\) \{[\s\S]*return canManagePolls\(displayUser\) && canUseUiFeature\(displayUser, CAPABILITIES\.teamPolls\)/)
  assert.match(source, /if \(item\.path === '\/match-day'\) \{[\s\S]*return canUseTeamWorkflow && canManageMatchDay\(displayUser\) && canUseUiFeature\(displayUser, CAPABILITIES\.matchDay\)/)
  assert.doesNotMatch(source, /item\.path === '\/email-queue'/)
})
