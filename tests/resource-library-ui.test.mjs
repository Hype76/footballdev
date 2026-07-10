import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const routerUrl = new URL('../src/app/router.jsx', import.meta.url)
const sidebarUrl = new URL('../src/components/layout/Sidebar.jsx', import.meta.url)
const navigationUrl = new URL('../src/app/navigation.js', import.meta.url)
const pageUrl = new URL('../src/pages/ResourceLibraryPage.jsx', import.meta.url)
const profileUrl = new URL('../src/pages/PlayerProfile.jsx', import.meta.url)
const assignedResourcesUrl = new URL('../src/components/players/PlayerAssignedResources.jsx', import.meta.url)

test('Resource Library route and navigation are staff-only gated without removing Staff Chat', async () => {
  const [router, sidebar, navigation] = await Promise.all([
    readFile(routerUrl, 'utf8'),
    readFile(sidebarUrl, 'utf8'),
    readFile(navigationUrl, 'utf8'),
  ])

  assert.match(navigation, /label: 'Staff Chat'/)
  assert.match(navigation, /path: '\/staff-chat'/)
  assert.match(navigation, /label: 'Team Resources'/)
  assert.match(navigation, /path: '\/resources'/)
  assert.match(router, /function RequireResourceLibraryAccess\(\)/)
  assert.match(router, /canUseResourceLibrary\(user\)/)
  assert.match(router, /path: 'resources'/)
  assert.match(sidebar, /item\.path === '\/resources'/)
  assert.match(sidebar, /canUseResourceLibrary\(displayUser\)/)
  assert.match(sidebar, /'\/staff-chat'/)
})

test('Resource Library UI keeps V1 staff scope and uses explicit parent sharing', async () => {
  const page = await readFile(pageUrl, 'utf8')

  assert.match(page, /Team Resource Library/)
  assert.match(page, /Team Resources/)
  assert.match(page, /Upload resource/)
  assert.match(page, /External link/)
  assert.match(page, /Save link/)
  assert.match(page, /Save assignment/)
  assert.match(page, /Shared with parents/)
  assert.match(page, /Staff only/)
  assert.match(page, /<option value="player">Players<\/option>/)
  assert.match(page, /Full squad/)
  assert.match(page, /linkedPlayerIds: \[\]/)
  assert.match(page, /selectedActivePlayerIds\.length\} selected/)
  assert.match(page, /handlePlayerSelectionChange/)
  assert.match(page, /handleSelectAllPlayers/)
  assert.match(page, /handleClearSelectedPlayers/)
  assert.match(page, /Select all/)
  assert.match(page, /checked=\{selectedPlayerIdSet\.has\(playerId\)\}/)
  assert.match(page, /Why this resource is being shared/)
  assert.match(page, /Share with \{filteredPlayers\.length\} squad players/)
  assert.match(page, /Download/)
  assert.match(page, /Archive/)
  assert.match(page, /canManageResourceLibrary/)
  assert.doesNotMatch(page, /Club-wide/i)
  assert.doesNotMatch(page, /club-wide/i)
  assert.doesNotMatch(page, /shared club/i)
  assert.doesNotMatch(page, /club resource/i)
  assert.doesNotMatch(page, /send email/i)
  assert.doesNotMatch(page, /push notification/i)
  assert.doesNotMatch(page, /chat attachment/i)
})

test('Player Profile includes the staff-only assigned resources section', async () => {
  const [profile, assignedResources] = await Promise.all([
    readFile(profileUrl, 'utf8'),
    readFile(assignedResourcesUrl, 'utf8'),
  ])

  assert.match(profile, /PlayerAssignedResources/)
  assert.match(assignedResources, /Assigned resources/)
  assert.match(assignedResources, /getAssignedResourcesForPlayer/)
  assert.match(assignedResources, /getResourceLibraryDownloadUrl/)
  assert.match(assignedResources, /Shared with linked parents/)
  assert.match(assignedResources, /canUseResourceLibrary\(user\)/)
  assert.match(assignedResources, /canManageResourceLibrary\(user\)/)
})
