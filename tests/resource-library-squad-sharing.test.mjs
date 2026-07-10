import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const domainUrl = new URL('../src/lib/domain/resource-library.js', import.meta.url)
const resourcePageUrl = new URL('../src/pages/ResourceLibraryPage.jsx', import.meta.url)
const playerResourcesUrl = new URL('../src/components/players/PlayerAssignedResources.jsx', import.meta.url)
const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const migrationUrl = new URL('../supabase/migrations/20260708081841_resource_library_squad_sharing_description.sql', import.meta.url)

test('Resource Library squad sharing migration stores link descriptions and preserves parent RPC scope', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /alter table public\.resource_library_links[\s\S]*add column if not exists share_description text/i)
  assert.match(migration, /resource_library_links_share_description_length/i)
  assert.match(migration, /char_length\(share_description\) <= 500/i)
  assert.match(migration, /returns table \([\s\S]*share_description text/i)
  assert.match(migration, /coalesce\(link\.share_description, ''\) as share_description/i)
  assert.match(migration, /parent_link\.auth_user_id = auth\.uid\(\)/i)
  assert.match(migration, /link\.parent_visible is true/i)
  assert.doesNotMatch(migration, /grant execute on function public\.get_parent_portal_player_resources\(uuid\) to anon/i)
})

test('Resource Library assignment expands full squad sharing through the idempotent notification RPC', async () => {
  const domain = await readFile(domainUrl, 'utf8')

  assert.match(domain, /RESOURCE_LIBRARY_SHARE_DESCRIPTION_MAX_LENGTH = 500/)
  assert.match(domain, /shareDescription = ''/)
  assert.match(domain, /rpc\('assign_resource_library_item_with_parent_notifications'/)
  assert.match(domain, /targets_value: normalizedTargets\.map/)
  assert.match(domain, /share_description_value: normalizedShareDescription/)
  assert.match(domain, /parentVisible: target\.linkedType === 'player' && target\.parentVisible === true/)
  assert.match(domain, /unchangedCount:/)
  assert.match(domain, /notificationCount:/)
})

test('Resource Library manager UI adds a full squad option without removing individual sharing', async () => {
  const page = await readFile(resourcePageUrl, 'utf8')

  assert.match(page, /function createAssignmentDraft\(\)/)
  assert.match(page, /linkedType: 'player'/)
  assert.match(page, /linkedPlayerIds: \[\]/)
  assert.match(page, /<option value="player">Players<\/option>/)
  assert.match(page, /<option value="squad">Full squad<\/option>/)
  assert.match(page, /filteredPlayers\.map\(\(player\) => \(\{/)
  assert.match(page, /selectedPlayers\.map\(\(player\) => \(\{/)
  assert.match(page, /handlePlayerSelectionChange/)
  assert.match(page, /handleSelectAllPlayers/)
  assert.match(page, /handleClearSelectedPlayers/)
  assert.match(page, /linkedType: 'player'/)
  assert.match(page, /parentVisible: assignmentDraft\.parentVisible === true/)
  assert.match(page, /shareDescription: assignmentDraft\.shareDescription/)
  assert.match(page, /disabled=\{!canShareWithParents\}/)
})

test('Shared resource descriptions render for staff player views and parent portal resources', async () => {
  const [domain, playerResources, parentPortalPage] = await Promise.all([
    readFile(domainUrl, 'utf8'),
    readFile(playerResourcesUrl, 'utf8'),
    readFile(parentPortalPageUrl, 'utf8'),
  ])

  assert.match(domain, /shareDescription: normalizeText\(row\.share_description \?\? row\.shareDescription\)/)
  assert.match(domain, /shareDescription: row\.share_description/)
  assert.match(playerResources, /resource\.link\?\.shareDescription/)
  assert.match(parentPortalPage, /resource\.link\?\.shareDescription/)
})
