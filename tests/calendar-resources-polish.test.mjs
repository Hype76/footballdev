import { migrationSourceUrl } from './helpers/migration-source.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)
const resourceDomainUrl = new URL('../src/lib/domain/resource-library.js', import.meta.url)
const calendarResourceMigrationUrl = migrationSourceUrl('20260702085846_calendar_event_resource_links.sql', 'active')
const calendarEventTypesMigrationUrl = migrationSourceUrl('20260702100653_calendar_event_training_match_types.sql', 'archivedNotAppliedProduction')
const resourceArchiveRemoveMigrationUrl = migrationSourceUrl('20260702090842_resource_library_archive_remove_rpc.sql', 'active')
const resourceArchiveRpcRepairMigrationUrl = migrationSourceUrl('20260702091258_repair_resource_library_archive_rpc_return.sql', 'active')
const navigationUrl = new URL('../src/app/navigation.js', import.meta.url)
const roleQuickLinksUrl = new URL('../src/lib/role-quick-links.js', import.meta.url)
const routerUrl = new URL('../src/app/router.jsx', import.meta.url)

function getFunction(source, name) {
  const start = source.indexOf(`create or replace function public.${name}`)
  assert.notEqual(start, -1, `${name} function missing`)
  const next = source.indexOf('\ncreate or replace function public.', start + 1)
  return next === -1 ? source.slice(start) : source.slice(start, next)
}

test('calendar event resource links are same-team only and do not change storage policies', async () => {
  const migration = await readFile(calendarResourceMigrationUrl, 'utf8')
  const eventScope = getFunction(migration, 'resource_library_calendar_event_in_scope')
  const targetAllowed = getFunction(migration, 'resource_library_link_target_allowed')

  assert.match(migration, /linked_type in \('player', 'team', 'calendar_event'\)/i)
  assert.match(migration, /where linked_type = 'calendar_event' and removed_at is null/i)
  assert.match(eventScope, /from public\.calendar_events event/i)
  assert.match(eventScope, /event\.club_id = target_club_id/i)
  assert.match(eventScope, /event\.team_id = target_team_id/i)
  assert.match(eventScope, /event\.cancelled_at is null/i)
  assert.match(targetAllowed, /target_linked_type = 'calendar_event'/i)
  assert.match(targetAllowed, /public\.resource_library_calendar_event_in_scope/i)
  assert.match(migration, /revoke execute on function public\.resource_library_calendar_event_in_scope\(uuid, uuid, uuid\) from anon/i)
  assert.doesNotMatch(migration, /create policy resource_library_storage_/i)
  assert.doesNotMatch(migration, /grant .* to anon/i)
})

test('calendar resource domain helpers validate event team resources before syncing links', async () => {
  const source = await readFile(resourceDomainUrl, 'utf8')

  assert.match(source, /export async function getCalendarEventResources/)
  assert.match(source, /export async function syncCalendarEventResourceLinks/)
  assert.match(source, /\.eq\('linked_type', 'calendar_event'\)/)
  assert.match(source, /\.eq\('team_id', eventTeamId\)/)
  assert.match(source, /\.from\('resource_library_items'\)[\s\S]*\.eq\('club_id', user\.clubId\)[\s\S]*\.eq\('team_id', eventTeamId\)[\s\S]*\.is\('archived_at', null\)[\s\S]*\.in\('id', desiredResourceIds\)/)
  assert.match(source, /remove_resource_library_link/)
  assert.match(source, /Attach resources from this event team only\./)
  assert.match(source, /resource_library_event_resources_synced/)
})

test('resource archive and assignment removal use team-scoped RPCs', async () => {
  const [migration, repairMigration, source] = await Promise.all([
    readFile(resourceArchiveRemoveMigrationUrl, 'utf8'),
    readFile(resourceArchiveRpcRepairMigrationUrl, 'utf8'),
    readFile(resourceDomainUrl, 'utf8'),
  ])

  assert.match(migration, /create or replace function public\.remove_resource_library_link/i)
  assert.match(migration, /create or replace function public\.archive_resource_library_item/i)
  assert.match(migration, /public\.current_user_can_manage_resource_library\(rli\.club_id, rli\.team_id\)/i)
  assert.match(migration, /rll\.team_id = target_team_id/i)
  assert.match(migration, /rli\.team_id = target_team_id/i)
  assert.match(migration, /revoke execute on function public\.remove_resource_library_link\(uuid, uuid, uuid\) from anon/i)
  assert.match(migration, /revoke execute on function public\.archive_resource_library_item\(uuid, uuid, uuid\) from anon/i)
  assert.match(repairMigration, /drop function if exists public\.archive_resource_library_item\(uuid, uuid, uuid\)/i)
  assert.match(repairMigration, /resource_id uuid/i)
  assert.match(repairMigration, /resource_title text/i)
  assert.match(source, /rpc\('remove_resource_library_link'/)
  assert.match(source, /rpc\('archive_resource_library_item'/)
  assert.match(source, /resource_title/)
})

test('calendar UI attaches resources only to team custom events and protects recurring edits', async () => {
  const source = await readFile(sessionsPageUrl, 'utf8')

  assert.match(source, /function isCalendarResourceEventType\(eventType\)/)
  assert.match(source, /\['general', 'availability_deadline', 'parent_cutoff', 'training', 'match'\]\.includes/)
  assert.match(source, /const defaultForm = getDefaultCalendarForm\(date\)[\s\S]*const eventType = \(isClubWideCalendar \|\| calendarOnly\) \? 'general' : defaultForm\.eventType[\s\S]*eventType,/)
  assert.match(source, /const saveTrainingAsSession = isTraining && \(calendarModal\?\.variant === 'session' \|\| sourceType === 'session'\)/)
  assert.match(source, /const canShowTeamResourceArea = Boolean\(!isSessionCreate && !clubWideOnly && safeFormTeamId && canManageResourceLibrary\(user\)\)/)
  assert.match(source, /const canUseCalendarResourceLinks = Boolean\(\(!event \|\| event\.sourceType === 'calendar'\) && isCalendarResourceEventType\(form\.eventType\)\)/)
  assert.match(source, /getResourceLibraryItems\(\{ user, teamId: calendarResourceTeamId \}\)/)
  assert.match(source, /getCalendarEventResources\(\{ user, eventId, teamId: eventTeamId \}\)/)
  assert.match(source, /syncCalendarEventResourceLinks\({[\s\S]*eventId: savedEvent\.id,[\s\S]*teamId: safeTeamId,[\s\S]*resourceIds: calendarForm\.resourceIds/)
  assert.match(source, /Attached resources/)
  assert.match(source, /Team Resource Library files from this event team only\./)
  assert.match(source, /Choose from Team Resource Library/)
  assert.match(source, /Search resources/)
  assert.match(source, /Search by title or filename/)
  assert.match(source, /No matching team resources\./)
  assert.match(source, /onResourceIdsChange=\{handleCalendarResourceIdsChange\}/)
  assert.match(source, /onSelectionChange=\{onResourceIdsChange\}/)
  assert.match(source, /No resources in this team's library yet\. Add resources from Team Resources first\./)
  assert.match(source, /Team Resource Library attachments are available for team calendar events in V1\./)
  assert.match(source, /CalendarResourceUnavailableNotice/)
  assert.match(source, /canShowTeamResourceArea \? \([\s\S]*canAttachResources \? \(/)
  assert.match(source, /function isRecurringCalendarEvent/)
  assert.match(source, /function isLegacyRecurringSessionEvent/)
  assert.match(source, /getLegacyRecurringSessionSeries/)
  assert.match(source, /This legacy training session does not have a safe repeat series link/)
  assert.match(source, /function hasRecurringCalendarDateTimeChange/)
  assert.match(source, /Choose how to update this repeating event before saving\./)
  assert.match(source, /This is a repeating event\. How should this date\/time change be applied\?/)
  assert.match(source, /required=\{repeatUpdateScopeRequired\}/)
  assert.match(source, /deleteRepeatScope/)
  assert.match(source, /Choose how to delete this repeating event before continuing\./)
  assert.match(source, /This is a repeating event\. What do you want to delete\?/)
  assert.match(source, /Entire repeat series/)
  assert.match(source, /This event only is not available in V1/)
  assert.match(source, /This and future events is not available in V1/)
})

test('calendar event schema and domain allow training and match calendar-event rows', async () => {
  const [migration, domain] = await Promise.all([
    readFile(calendarEventTypesMigrationUrl, 'utf8'),
    readFile(new URL('../src/lib/domain/calendar-events.js', import.meta.url), 'utf8'),
  ])

  assert.match(migration, /drop constraint if exists calendar_events_event_type_check/i)
  assert.match(migration, /event_type in \('general', 'availability_deadline', 'parent_cutoff', 'training', 'match'\)/i)
  assert.match(domain, /const EVENT_TYPES = \['general', 'availability_deadline', 'parent_cutoff', 'training', 'match'\]/)
})

test('Developer Fields direct route remains while normal navigation hides it', async () => {
  const [router, navigation, roleQuickLinks] = await Promise.all([
    readFile(routerUrl, 'utf8'),
    readFile(navigationUrl, 'utf8'),
    readFile(roleQuickLinksUrl, 'utf8'),
  ])

  assert.match(router, /path: 'form-builder'/)
  assert.match(router, /function RequireFormBuilderAccess/)
  assert.match(router, /title: 'Development Fields'/)
  assert.doesNotMatch(navigation, /label: 'Development Fields'[\s\S]*path: '\/form-builder'/)
  assert.doesNotMatch(roleQuickLinks, /label: 'Development Fields', path: '\/form-builder'/)
})
