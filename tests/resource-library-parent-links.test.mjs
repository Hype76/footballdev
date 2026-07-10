import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const domainUrl = new URL('../src/lib/domain/resource-library.js', import.meta.url)
const supabaseUrl = new URL('../src/lib/supabase.js', import.meta.url)
const resourcePageUrl = new URL('../src/pages/ResourceLibraryPage.jsx', import.meta.url)
const playerResourcesUrl = new URL('../src/components/players/PlayerAssignedResources.jsx', import.meta.url)
const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const parentPortalShellUrl = new URL('../src/components/parent-portal/ParentPortalShell.jsx', import.meta.url)
const sqlReviewUrl = new URL('../docs/planning/fp-v1-team-resources-sql-review-12.draft.sql', import.meta.url)

test('Team Resources SQL uses the approved side table and parent player link scope', async () => {
  const sql = await readFile(sqlReviewUrl, 'utf8')

  assert.match(sql, /alter table public\.resource_library_links[\s\S]*parent_visible boolean not null default false/i)
  assert.match(sql, /create table if not exists public\.resource_library_external_links/i)
  assert.match(sql, /join public\.parent_player_links parent_link/i)
  assert.match(sql, /parent_link\.auth_user_id = auth\.uid\(\)/i)
  assert.match(sql, /parent_link\.status = 'active'/i)
  assert.match(sql, /link\.parent_visible is true/i)
  assert.match(sql, /resource_library_links_select_parent_visible/i)
  assert.match(sql, /resource_library_items_select_parent_visible/i)
  assert.match(sql, /get_parent_portal_player_resources/i)
  assert.match(sql, /revoke all on public\.resource_library_external_links from anon/i)
  assert.doesNotMatch(sql, /parent_portal_links/i)
  assert.doesNotMatch(sql, /grant .* on public\.resource_library_external_links to anon/i)
})

test('Team Resources client writes external links through RPC and stores parent sharing on links only', async () => {
  const [domain, supabaseExports] = await Promise.all([
    readFile(domainUrl, 'utf8'),
    readFile(supabaseUrl, 'utf8'),
  ])

  assert.match(domain, /export async function createExternalResourceLibraryItem/)
  assert.match(domain, /rpc\('create_external_resource_library_item'/)
  assert.match(domain, /resource_library_external_links\(external_url\)/)
  assert.match(domain, /rpc\('assign_resource_library_item_with_parent_notifications'/)
  assert.match(domain, /parentVisible: target\.linkedType === 'player' && target\.parentVisible === true/)
  assert.match(domain, /export async function getParentPortalPlayerResources/)
  assert.match(domain, /rpc\('get_parent_portal_player_resources'/)
  assert.doesNotMatch(domain, /resource_type: 'external_link'/)
  assert.doesNotMatch(domain, /\.from\('parent_player_links'\)/)
  assert.match(supabaseExports, /createExternalResourceLibraryItem/)
  assert.match(supabaseExports, /getParentPortalPlayerResources/)
})

test('Staff UI exposes explicit parent sharing without changing non-player assignments', async () => {
  const [resourcePage, playerResources] = await Promise.all([
    readFile(resourcePageUrl, 'utf8'),
    readFile(playerResourcesUrl, 'utf8'),
  ])

  assert.match(resourcePage, /createExternalResourceLibraryItem/)
  assert.match(resourcePage, /Resource type/)
  assert.match(resourcePage, /External link/)
  assert.match(resourcePage, /Shared with parents/)
  assert.match(resourcePage, /Staff only/)
  assert.match(resourcePage, /Full squad/)
  assert.match(resourcePage, /disabled=\{!canShareWithParents\}/)
  assert.match(resourcePage, /parentVisible: assignmentDraft\.linkedType === 'player' && assignmentDraft\.parentVisible === true/)
  assert.match(resourcePage, /shareDescription: assignmentDraft\.shareDescription/)
  assert.match(playerResources, /Shared with linked parents/)
  assert.match(playerResources, /resource\.link\?\.shareDescription/)
  assert.match(playerResources, /resource\.resourceType === 'external_link' \? 'Open' : 'Download'/)
})

test('Parent portal reads shared resources only through the scoped RPC helper', async () => {
  const [domain, parentPortalPage, parentPortalShell] = await Promise.all([
    readFile(domainUrl, 'utf8'),
    readFile(parentPortalPageUrl, 'utf8'),
    readFile(parentPortalShellUrl, 'utf8'),
  ])

  assert.match(domain, /function normalizeParentPortalResourceItem/)
  assert.match(domain, /delete item\.storageBucket/)
  assert.match(domain, /delete item\.storagePath/)
  assert.match(domain, /delete item\.uploadedByEmail/)
  assert.match(domain, /delete item\.description/)
  assert.match(domain, /normalizeParentPortalResourceItem\(\{[\s\S]*shareDescription: row\.share_description/)
  assert.match(parentPortalShell, /id: 'resources'/)
  assert.match(parentPortalShell, /to: '\/parent-portal\?section=resources'/)
  assert.match(parentPortalPage, /parentPortalSectionIds = new Set\(\['overview', 'calendar', 'invites', 'matches', 'results', 'resources', 'settings'\]\)/)
  assert.match(parentPortalPage, /getParentPortalPlayerResources\(\{ parentLinkId: selectedLink\.id \}\)/)
  assert.match(parentPortalPage, /function ParentResourcesPanel/)
  assert.match(parentPortalPage, /resource\.link\?\.shareDescription/)
  assert.match(parentPortalPage, /Staff-only resources do not appear here/)
  assert.doesNotMatch(parentPortalPage, /\.from\('resource_library_/)
  assert.doesNotMatch(parentPortalPage, /parent_portal_links/)
})
