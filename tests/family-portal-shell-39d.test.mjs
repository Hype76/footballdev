import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  getParentPortalStaffReturnMode,
  PARENT_PORTAL_STAFF_RETURN_LABEL,
  resolveParentPortalShellContext,
} from '../src/lib/parent-portal-shell.js'

const shellSource = await readFile(
  new URL('../src/components/parent-portal/ParentPortalShell.jsx', import.meta.url),
  'utf8',
)
const portalSource = await readFile(
  new URL('../src/pages/ParentPortalPage.jsx', import.meta.url),
  'utf8',
)
const chatSource = await readFile(
  new URL('../src/components/chat/ParentChatWorkspace.jsx', import.meta.url),
  'utf8',
)
const pollsSource = await readFile(
  new URL('../src/pages/ParentPollsPage.jsx', import.meta.url),
  'utf8',
)

const linkedChildren = [
  {
    id: 'link-one',
    playerName: 'Child One',
    clubId: 'club-one',
    clubName: 'Club One',
    clubLogoUrl: 'https://cdn.example.test/club-one.png',
    teamId: 'team-one',
    teamName: 'U12 One',
    themeAccent: 'blue',
  },
  {
    id: 'link-two',
    playerName: 'Child Two',
    clubId: 'club-two',
    clubName: 'Club Two',
    clubLogoUrl: '',
    teamId: 'team-two',
    teamName: 'U14 Two',
    themeAccent: 'red',
  },
]

test('Family Portal context resolves club branding and multiple linked children from the allowlist', () => {
  const context = resolveParentPortalShellContext({
    links: linkedChildren,
    selectedParentLinkId: 'link-two',
  })

  assert.equal(context.activeLink.id, 'link-two')
  assert.equal(context.clubName, 'Club Two')
  assert.equal(context.childName, 'Child Two')
  assert.equal(context.teamName, 'U14 Two')
  assert.equal(context.clubLogoUrl, '')
  assert.equal(context.allowedLinks.length, 2)
})

test('wrong-club or unknown child context falls back to an authorised link', () => {
  const context = resolveParentPortalShellContext({
    links: linkedChildren,
    selectedLink: {
      id: 'spoofed-link',
      clubId: 'wrong-club',
      clubName: 'Wrong Club',
      playerName: 'Wrong Child',
    },
  })

  assert.equal(context.activeLink, linkedChildren[0])
  assert.equal(context.clubName, 'Club One')
  assert.notEqual(context.clubName, 'Wrong Club')
})

test('missing club branding uses the generic platform fallback only when unavailable', () => {
  const context = resolveParentPortalShellContext({ links: [] })

  assert.equal(context.activeLink, null)
  assert.equal(context.clubName, 'Football Player')
  assert.equal(context.clubLogoUrl, '')
  assert.equal(context.childName, 'No linked child yet')
})

test('parent-only users cannot return to staff while team-capable users can', () => {
  assert.equal(getParentPortalStaffReturnMode({ accessModeOptions: [] }), '')
  assert.equal(
    getParentPortalStaffReturnMode({
      accessModeOptions: [{ id: 'parent', label: 'Family Portal' }],
    }),
    '',
  )
  assert.equal(
    getParentPortalStaffReturnMode({
      user: {
        accessModeOptions: [{ id: 'team', label: 'Team access' }],
      },
    }),
    'team',
  )
  assert.equal(PARENT_PORTAL_STAFF_RETURN_LABEL, 'Back to club workspace')
})

test('desktop and mobile shells preserve safe context, actions, navigation, and safe areas', () => {
  assert.match(shellSource, /fallbackLogo/)
  assert.match(shellSource, /clubLogoUrl \|\| fallbackLogo/)
  assert.match(shellSource, /Family Portal context/)
  assert.match(shellSource, /parent-portal-shell-child/)
  assert.match(shellSource, /Choose child/)
  assert.match(shellSource, /PARENT_PORTAL_STAFF_RETURN_LABEL/)
  assert.match(shellSource, /selectAccessMode\('team', \{ deferCommit: true \}\)/)
  assert.match(shellSource, /TEAM_WORKSPACE_HOME_PATH/)
  assert.match(shellSource, /fixed inset-x-0 bottom-0/)
  assert.match(shellSource, /env\(safe-area-inset-bottom\)/)
  assert.match(shellSource, /min-h-11/)
  assert.doesNotMatch(shellSource, /hamburger/i)

  for (const label of [
    'Overview',
    'Calendar',
    'Invites',
    'Match cards',
    'Results',
    'Resources',
    'Chat',
    'Polls',
    'Settings',
  ]) {
    assert.match(shellSource, new RegExp(`label: '${label}'`))
  }
})

test('the main page uses a compact heading and shell context instead of the oversized repeated hero', () => {
  assert.match(portalSource, /Private family view/)
  assert.match(portalSource, /onParentLinkSelect=\{setSelectedLinkId\}/)
  assert.match(portalSource, /links=\{links\}/)
  assert.match(portalSource, /selectedLink=\{selectedLink\}/)
  assert.doesNotMatch(portalSource, /function ParentChildSelector/)
  assert.doesNotMatch(portalSource, /Child being viewed/)
})

test('Chat and Polls use the shared shell selector without duplicate child controls', () => {
  assert.doesNotMatch(chatSource, /parent-chat-child/)
  assert.doesNotMatch(chatSource, /onSelectedParentLinkChange/)
  assert.match(pollsSource, /onSelectedParentLinkChange=\{setSelectedLinkId\}/)
  assert.doesNotMatch(pollsSource, /parent-poll-child/)
  assert.doesNotMatch(pollsSource, /function ParentPollChildSelector/)
})

test('route shells apply active club accent and button branding while preserving theme mode', () => {
  assert.match(shellSource, /resolveParentPortalBranding/)
  assert.match(shellSource, /mode: getStoredThemeMode\(\)/)
  assert.match(shellSource, /accent: branding\.accent/)
  assert.match(shellSource, /buttonStyle: branding\.buttonStyle/)
})
