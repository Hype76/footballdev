import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { validateParentResourceAccess } from '../netlify/functions/parent-resource-access.js'

const functionUrl = new URL('../netlify/functions/parent-resource-access.js', import.meta.url)
const migrationUrl = new URL('../supabase/migrations/20260727125320_team_resource_parent_sharing_integrity.sql', import.meta.url)
const parentPortalUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)

const ids = {
  authUser: '10000000-0000-4000-8000-000000000001',
  club: '20000000-0000-4000-8000-000000000001',
  otherClub: '20000000-0000-4000-8000-000000000002',
  team: '30000000-0000-4000-8000-000000000001',
  otherTeam: '30000000-0000-4000-8000-000000000002',
  player: '40000000-0000-4000-8000-000000000001',
  otherPlayer: '40000000-0000-4000-8000-000000000002',
  resource: '50000000-0000-4000-8000-000000000001',
}

function createRecords() {
  return {
    authUserId: ids.authUser,
    parentLink: {
      auth_user_id: ids.authUser,
      club_id: ids.club,
      team_id: ids.team,
      player_id: ids.player,
      status: 'active',
    },
    player: {
      id: ids.player,
      club_id: ids.club,
      team_id: ids.team,
      status: 'active',
      archived_at: null,
    },
    resourceLink: {
      resource_id: ids.resource,
      club_id: ids.club,
      team_id: ids.team,
      linked_type: 'player',
      linked_id: ids.player,
      parent_visible: true,
      removed_at: null,
    },
    resource: {
      id: ids.resource,
      club_id: ids.club,
      team_id: ids.team,
      storage_bucket: 'resource-library',
      storage_path: `${ids.club}/${ids.team}/${ids.resource}/plan.pdf`,
      archived_at: null,
    },
    externalLink: null,
  }
}

test('authorised Parent file access receives a short-lived server-authorised result', () => {
  const access = validateParentResourceAccess(createRecords())

  assert.deepEqual(access, {
    accessType: 'file',
    accessUrl: '',
    expiresInSeconds: 60,
  })
})

test('authorised Parent external link access accepts only scoped http or https links', () => {
  const records = createRecords()
  records.externalLink = {
    resource_id: ids.resource,
    club_id: ids.club,
    team_id: ids.team,
    external_url: 'https://example.test/training',
  }

  assert.deepEqual(validateParentResourceAccess(records), {
    accessType: 'external_link',
    accessUrl: 'https://example.test/training',
    expiresInSeconds: null,
  })

  records.externalLink.external_url = 'javascript:alert(1)'
  assert.throws(() => validateParentResourceAccess(records), /not available/)
})

test('Parent resource access fails closed across child, team, club, sharing, removal, and archive boundaries', () => {
  const cases = [
    (records) => { records.parentLink.auth_user_id = '10000000-0000-4000-8000-000000000002' },
    (records) => { records.parentLink.status = 'revoked' },
    (records) => { records.player.id = ids.otherPlayer },
    (records) => { records.player.club_id = ids.otherClub },
    (records) => { records.player.team_id = ids.otherTeam },
    (records) => { records.player.status = 'archived' },
    (records) => { records.player.archived_at = '2026-07-27T00:00:00.000Z' },
    (records) => { records.resourceLink.linked_id = ids.otherPlayer },
    (records) => { records.resourceLink.team_id = ids.otherTeam },
    (records) => { records.resourceLink.club_id = ids.otherClub },
    (records) => { records.resourceLink.parent_visible = false },
    (records) => { records.resourceLink.removed_at = '2026-07-27T00:00:00.000Z' },
    (records) => { records.resource.team_id = ids.otherTeam },
    (records) => { records.resource.club_id = ids.otherClub },
    (records) => { records.resource.archived_at = '2026-07-27T00:00:00.000Z' },
    (records) => { records.resource.storage_bucket = 'public-files' },
    (records) => { records.resource.storage_path = `${ids.otherClub}/${ids.otherTeam}/plan.pdf` },
    (records) => { records.resource.storage_path = `${ids.club}/${ids.team}/../other-club/private.pdf` },
    (records) => { records.resource.storage_path = `${ids.club}\\${ids.team}\\private.pdf` },
    (records) => { records.resource.storage_path = `${ids.club}/${ids.team}` },
  ]

  for (const mutate of cases) {
    const records = createRecords()
    mutate(records)
    assert.throws(() => validateParentResourceAccess(records), /not available/)
  }
})

test('Parent listing and access code keep raw resource locations out of Parent payloads', async () => {
  const [source, migration, parentPortal] = await Promise.all([
    readFile(functionUrl, 'utf8'),
    readFile(migrationUrl, 'utf8'),
    readFile(parentPortalUrl, 'utf8'),
  ])

  assert.match(source, /export default async \(request\)/)
  assert.match(source, /path: '\/api\/parent-resources\/access'/)
  assert.match(source, /parent_visible/)
  assert.match(source, /removed_at/)
  assert.match(source, /pathSegments\.every\(\(segment\) => segment && segment !== '\.' && segment !== '\.\.'\)/)
  assert.match(source, /createSignedUrl\(resource\.storage_path, SIGNED_URL_EXPIRY_SECONDS\)/)
  assert.match(parentPortal, /const pendingWindow = window\.open\('', '_blank'\)/)
  assert.match(parentPortal, /pendingWindow\.location\.replace\(accessUrl\)/)
  assert.match(migration, /coalesce\(player\.status, 'active'\) <> 'archived'/i)
  assert.match(migration, /player\.archived_at is null/i)
  assert.match(migration, /''::text as external_url/i)
  assert.match(migration, /''::text as storage_path/i)
  assert.doesNotMatch(migration, /resource_library_storage_select_parent/i)
})

test('synchronised player assignments use one canonical parent_visible state and soft-remove omitted players', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /sync_resource_library_player_assignments_with_parent_notifications/i)
  assert.match(migration, /jsonb_typeof\(target_value -> 'parentVisible'\) <> 'boolean'/i)
  assert.match(migration, /'parentVisible', \(target_value ->> 'parentVisible'\)::boolean/i)
  assert.match(migration, /assign_resource_library_item_with_parent_notifications/i)
  assert.match(migration, /and not \(link\.linked_id = any\(selected_player_ids\)\)/i)
  assert.match(migration, /set removed_at = timezone\('utc', now\(\)\)/i)
  assert.doesNotMatch(migration, /delete from public\.resource_library_links/i)
})
