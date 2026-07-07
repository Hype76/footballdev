import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const domainUrl = new URL('../src/lib/domain/resource-library.js', import.meta.url)
const pageUrl = new URL('../src/pages/ResourceLibraryPage.jsx', import.meta.url)
const playerResourcesUrl = new URL('../src/components/players/PlayerAssignedResources.jsx', import.meta.url)
const parentPortalUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const navUrl = new URL('../src/components/parent-portal/ParentPortalShell.jsx', import.meta.url)
const migrationUrl = new URL('../supabase/migrations/20260707090000_resource_library_external_links_parent_visibility.sql', import.meta.url)

test('resource library supports external links without changing file validation', async () => {
  const [domain, page] = await Promise.all([
    readFile(domainUrl, 'utf8'),
    readFile(pageUrl, 'utf8'),
  ])

  assert.match(domain, /export async function createExternalResourceLibraryItem/)
  assert.match(domain, /resource_type: 'external_link'/)
  assert.match(domain, /normalizeExternalResourceUrl/)
  assert.match(page, /Resource type/)
  assert.match(page, /External link/)
  assert.match(page, /createExternalResourceLibraryItem/)
  assert.match(page, /uploadResourceLibraryItem/)
})

test('parent share is explicit, player-only, and staff profile marks shared resources', async () => {
  const [domain, page, playerResources] = await Promise.all([
    readFile(domainUrl, 'utf8'),
    readFile(pageUrl, 'utf8'),
    readFile(playerResourcesUrl, 'utf8'),
  ])

  assert.match(domain, /parentVisible: Boolean\(row\.parent_visible/)
  assert.match(domain, /parent_visible: target\.linkedType === 'player' && target\.parentVisible === true/)
  assert.match(page, /Parent share/)
  assert.match(page, /disabled=\{assignmentDraft\.linkedType !== 'player'\}/)
  assert.match(playerResources, /Shared with linked parents/)
})

test('parent portal resources use a parent-visible RPC and do not expose staff-only resources', async () => {
  const [domain, parentPortal, nav, migration] = await Promise.all([
    readFile(domainUrl, 'utf8'),
    readFile(parentPortalUrl, 'utf8'),
    readFile(navUrl, 'utf8'),
    readFile(migrationUrl, 'utf8'),
  ])

  assert.match(domain, /export async function getParentPortalPlayerResources/)
  assert.match(domain, /rpc\('get_parent_portal_player_resources'/)
  assert.match(parentPortal, /getParentPortalPlayerResources\(\{ parentLinkId: selectedLink\.id \}\)/)
  assert.match(parentPortal, /function ParentResourcesPanel/)
  assert.match(parentPortal, /Staff-only resources do not appear here/)
  assert.match(nav, /id: 'resources'/)
  assert.match(migration, /link\.parent_visible is true/)
  assert.match(migration, /parent_link\.user_id = auth\.uid\(\)/)
  assert.match(migration, /parent_link\.revoked_at is null/)
  assert.match(migration, /revoke execute on function public\.get_parent_portal_player_resources\(uuid\) from anon/i)
})
