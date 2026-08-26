import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const appUrl = new URL('../apps/parent-mobile/App.js', import.meta.url)
const dataUrl = new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url)
const screensUrl = new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url)
const endpointUrl = new URL('../netlify/functions/parent-resource-access.js', import.meta.url)

test('Parent calendar loader joins safe event attachment metadata to the visible event', async () => {
  const [app, data, endpoint] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(dataUrl, 'utf8'),
    readFile(endpointUrl, 'utf8'),
  ])

  assert.match(data, /action: 'list_calendar_event_resources'/)
  assert.match(data, /eventId: normalizeText\(resource\.eventId/)
  assert.match(app, /getParentCalendarEventResources\(selectedMobileUser\)/)
  assert.match(app, /resources: resourcesByEventId\.get\(String\(event\.id\)\) \|\| \[\]/)
  assert.match(endpoint, /select\('id, club_id, team_id, title, category, original_filename, file_size_bytes, archived_at'\)/)
  assert.match(endpoint, /from\('resource_library_external_links'\)/)
  assert.doesNotMatch(endpoint, /return \{[\s\S]{0,500}eventId:[\s\S]{0,500}storage_path/)
})

test('Parent Home and Calendar show direct attachment actions and pass event identity when opening', async () => {
  const [app, data, screens] = await Promise.all([
    readFile(appUrl, 'utf8'),
    readFile(dataUrl, 'utf8'),
    readFile(screensUrl, 'utf8'),
  ])

  assert.match(app, /<Text style=\{styles\.cardMeta\}>Attachments<\/Text>/)
  assert.match(app, /`Open \$\{resource\.title\}`/)
  assert.match(app, /onOpenResource=\{handleOpenCalendarResource\}/)
  assert.match(app, /calendarEventId: event\.sourceId \|\| String\(event\.id/)
  assert.match(data, /calendarEventId: normalizeText\(calendarEventId\) \|\| undefined/)
  assert.match(screens, /<Text style=\{styles\.meta\}>Attachments<\/Text>/)
  assert.match(screens, /onOpenResource\?\.\(event, resource\)/)
})

test('Parent calendar attachment access remains child, club, event, and resource scoped', async () => {
  const endpoint = await readFile(endpointUrl, 'utf8')

  assert.match(endpoint, /calendarEvent\.parent_visible === true/)
  assert.match(endpoint, /eventAudience === 'all_club_parents'/)
  assert.match(endpoint, /eventAudience === 'all_team_parents'[\s\S]*eventTeamId === parentTeamId/)
  assert.match(endpoint, /linked_type\) !== 'calendar_event'/)
  assert.match(endpoint, /normalizeText\(resource\.team_id\) !== normalizeText\(resourceLink\.team_id\)/)
  assert.match(endpoint, /createSignedUrl\(resource\.storage_path, SIGNED_URL_EXPIRY_SECONDS\)/)
})
