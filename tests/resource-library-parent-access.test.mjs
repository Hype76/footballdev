import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  validateParentCalendarEventResourceAccess,
  validateParentResourceAccess,
} from '../netlify/functions/parent-resource-access.js'

const functionUrl = new URL('../netlify/functions/parent-resource-access.js', import.meta.url)
const migrationUrl = new URL('../supabase/migrations/20260727125320_team_resource_parent_sharing_integrity.sql', import.meta.url)
const shortRpcMigrationUrl = new URL('../supabase/migrations/20260727125718_shorten_resource_parent_sharing_rpc.sql', import.meta.url)
const parentPortalUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)

const ids = {
  authUser: '10000000-0000-4000-8000-000000000001',
  club: '20000000-0000-4000-8000-000000000001',
  event: '60000000-0000-4000-8000-000000000001',
  otherClub: '20000000-0000-4000-8000-000000000002',
  team: '30000000-0000-4000-8000-000000000001',
  otherTeam: '30000000-0000-4000-8000-000000000002',
  player: '40000000-0000-4000-8000-000000000001',
  otherPlayer: '40000000-0000-4000-8000-000000000002',
  resource: '50000000-0000-4000-8000-000000000001',
}

function createCalendarInviteRecords() {
  const records = createCalendarEventRecords()
  records.calendarEvent.parent_audience = 'involved_players'
  records.calendarInvite = {
    calendar_event_id: ids.event,
    club_id: ids.club,
    team_id: ids.team,
    player_id: ids.player,
    invite_status: 'active',
    cancelled_at: null,
  }
  return records
}

function createCalendarEventRecords() {
  const records = createRecords()
  records.calendarEvent = {
    id: ids.event,
    club_id: ids.club,
    team_id: ids.team,
    parent_visible: true,
    parent_audience: 'all_team_parents',
    cancelled_at: null,
  }
  records.resourceLink = {
    ...records.resourceLink,
    linked_type: 'calendar_event',
    linked_id: ids.event,
    parent_visible: false,
  }
  return records
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

test('Parent-visible calendar attachments use event authority and do not require a player assignment', () => {
  const records = createCalendarEventRecords()

  assert.deepEqual(validateParentCalendarEventResourceAccess(records), {
    accessType: 'file',
    accessUrl: '',
    expiresInSeconds: 60,
  })

  records.calendarEvent.parent_audience = 'all_club_parents'
  records.calendarEvent.team_id = ids.otherTeam
  records.resourceLink.team_id = ids.otherTeam
  records.resource.team_id = ids.otherTeam
  records.resource.storage_path = `${ids.club}/${ids.otherTeam}/${ids.resource}/plan.pdf`

  assert.deepEqual(validateParentCalendarEventResourceAccess(records), {
    accessType: 'file',
    accessUrl: '',
    expiresInSeconds: 60,
  })
})

test('involved-player calendar attachments require an active invitation for the selected child', () => {
  const records = createCalendarInviteRecords()

  assert.deepEqual(validateParentCalendarEventResourceAccess(records), {
    accessType: 'file',
    accessUrl: '',
    expiresInSeconds: 60,
  })

  for (const mutate of [
    (candidate) => { candidate.calendarInvite = null },
    (candidate) => { candidate.calendarInvite.player_id = ids.otherPlayer },
    (candidate) => { candidate.calendarInvite.calendar_event_id = '60000000-0000-4000-8000-000000000002' },
    (candidate) => { candidate.calendarInvite.team_id = ids.otherTeam },
    (candidate) => { candidate.calendarInvite.club_id = ids.otherClub },
    (candidate) => { candidate.calendarInvite.invite_status = 'cancelled' },
    (candidate) => { candidate.calendarInvite.cancelled_at = '2026-08-26T00:00:00.000Z' },
  ]) {
    const candidate = createCalendarInviteRecords()
    mutate(candidate)
    assert.throws(() => validateParentCalendarEventResourceAccess(candidate), /not available/)
  }
})

test('calendar attachment access fails closed across event visibility, audience, link, and resource scope', () => {
  const cases = [
    (records) => { records.parentLink.auth_user_id = '10000000-0000-4000-8000-000000000002' },
    (records) => { records.player.archived_at = '2026-08-26T00:00:00.000Z' },
    (records) => { records.calendarEvent.parent_visible = false },
    (records) => { records.calendarEvent.parent_audience = 'none' },
    (records) => { records.calendarEvent.team_id = ids.otherTeam },
    (records) => { records.calendarEvent.club_id = ids.otherClub },
    (records) => { records.calendarEvent.cancelled_at = '2026-08-26T00:00:00.000Z' },
    (records) => { records.resourceLink.linked_type = 'player' },
    (records) => { records.resourceLink.linked_id = ids.player },
    (records) => { records.resourceLink.team_id = ids.otherTeam },
    (records) => { records.resourceLink.removed_at = '2026-08-26T00:00:00.000Z' },
    (records) => { records.resource.team_id = ids.otherTeam },
    (records) => { records.resource.archived_at = '2026-08-26T00:00:00.000Z' },
    (records) => { records.resource.storage_path = `${ids.club}/${ids.otherTeam}/private.pdf` },
  ]

  for (const mutate of cases) {
    const records = createCalendarEventRecords()
    mutate(records)
    assert.throws(() => validateParentCalendarEventResourceAccess(records), /not available/)
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
  assert.match(source, /action === 'list_calendar_event_resources'/)
  assert.match(source, /linked_type', 'calendar_event'/)
  assert.match(source, /calendarEventId/)
  assert.match(source, /calendar_event_invites/)
  assert.match(source, /invite_status', 'cancelled'/)
  assert.match(parentPortal, /const pendingWindow = window\.open\('', '_blank'\)/)
  assert.match(parentPortal, /pendingWindow\.location\.replace\(accessUrl\)/)
  assert.match(migration, /coalesce\(player\.status, 'active'\) <> 'archived'/i)
  assert.match(migration, /player\.archived_at is null/i)
  assert.match(migration, /''::text as external_url/i)
  assert.match(migration, /''::text as storage_path/i)
  assert.doesNotMatch(migration, /resource_library_storage_select_parent/i)
})

test('synchronised player assignments use one canonical parent_visible state and soft-remove omitted players', async () => {
  const [migration, shortRpcMigration] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(shortRpcMigrationUrl, 'utf8'),
  ])

  assert.match(migration, /sync_resource_library_player_assignments_with_parent_notifications/i)
  assert.match(migration, /jsonb_typeof\(target_value -> 'parentVisible'\) <> 'boolean'/i)
  assert.match(migration, /'parentVisible', \(target_value ->> 'parentVisible'\)::boolean/i)
  assert.match(migration, /assign_resource_library_item_with_parent_notifications/i)
  assert.match(migration, /and not \(link\.linked_id = any\(selected_player_ids\)\)/i)
  assert.match(migration, /set removed_at = timezone\('utc', now\(\)\)/i)
  assert.doesNotMatch(migration, /delete from public\.resource_library_links/i)
  assert.match(shortRpcMigration, /sync_resource_library_player_assignments\(/i)
  assert.match(shortRpcMigration, /drop function if exists public\.sync_resource_library_player_assignments_with_parent_notificati/i)
})

test('published Formation Boards open as an in-app read-only snapshot', async () => {
  const [serverSource, parentSource, screenSource] = await Promise.all([
    readFile(functionUrl, 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url), 'utf8'),
  ])
  assert.match(serverSource, /accessType: 'formation_board'/)
  assert.match(serverSource, /formation_board_publications/)
  assert.match(serverSource, /formation_board_versions/)
  assert.match(parentSource, /result\.accessType === 'formation_board'/)
  assert.match(screenSource, /formationBoard\.placements/)
  assert.match(screenSource, /Back to Resources/)
})
